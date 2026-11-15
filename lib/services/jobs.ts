import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { v7 } from "uuid";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { assertRevision, nextVersion, WorkflowError } from "@/lib/domain/stages";
import { generationInputSchema, scenarioSchema, type GenerationInput } from "@/lib/jobs/schema";
import { jobsRepository } from "@/lib/repo/jobs";
import { providerConfig } from "@/lib/providers/config";
import { storedFileExists } from "@/lib/storage/paths";
import { workflowService } from "./workflow";
import { checkStartup } from "./startup";
export const enqueueSchema=z.strictObject({projectId:z.uuidv7(),sceneId:z.uuidv7(),revision:z.number().int().positive(),kind:z.enum(["image","video","speech"]),scenario:scenarioSchema.default("success")});
const retryable=new Set(["PROVIDER_DOWN","RATE_LIMITED","TIMEOUT","STORAGE_FAILED"]);
export function jobsService(handle:DatabaseHandle,now:()=>number=Date.now){
 const repo=jobsRepository(handle),workflow=workflowService(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();const stamp=()=>new Date(now()).toISOString();
 function claimValid(jobId:string,attempt:number){const row=repo.job(jobId);if(!row||row.status!=="running"||row.attempts!==attempt||!row.leaseUntil||row.leaseUntil<=stamp())throw new WorkflowError("CONFLICT","다른 처리기가 작업을 이어받았어요.");return row;}
 const service={
 enqueue:(input:unknown)=>atomic(()=>{
  if(process.env.MOCK_MODE==="false")throw new WorkflowError("STAGE_LOCKED","실제 AI 연결은 아직 준비 중이에요.");
  const args=enqueueSchema.parse(input),project=repo.project(args.projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);assertRevision(args.revision,project.contentRevision);
  if(!project.approvedPlanId)throw new WorkflowError("PLAN_NOT_APPROVED","기획을 먼저 승인해 주세요.");const plan=workflow.requireApprovedPlan(project.id,project.approvedPlanId);
  const scene=repo.scene(args.sceneId);if(!scene||scene.projectId!==project.id||scene.archivedAt)throw new WorkflowError("NOT_FOUND","장면을 찾을 수 없어요.",404);
  const steps=z.array(z.object({sceneId:z.string(),assetIds:z.array(z.string())})).parse(JSON.parse(plan.stepsJson));const source=steps.find(row=>row.sceneId===scene.id);if(!source)throw new WorkflowError("PLAN_NOT_APPROVED","승인한 장면표를 확인해 주세요.");
  const characterIds=z.array(z.string()).parse(JSON.parse(scene.characterIdsJson)),characters=repo.characters(characterIds);const refIds=[...new Set([...source.assetIds,...characters.flatMap(character=>z.array(z.string()).parse(JSON.parse(character.refAssetIdsJson)))])].sort();const refs=repo.assets(refIds);
  if(refs.length!==refIds.length||refs.some(asset=>asset.kind!=="link"&&!storedFileExists(asset.filePath)))throw new WorkflowError("STAGE_LOCKED","참조 자료 파일을 확인해 주세요.");
  const config=providerConfig();const scenario=args.scenario==="success"&&config.manualQa.randomFailureEnabled&&Math.random()<config.manualQa.failureRate?"fail:PROVIDER_DOWN":args.scenario;
  const snapshot=generationInputSchema.parse({schemaVersion:1,projectId:project.id,planId:plan.id,planVersion:plan.version,sceneId:scene.id,title:scene.title,description:scene.description,dialogue:z.array(z.object({text:z.string()})).parse(JSON.parse(scene.dialogueJson)).map(row=>row.text).join("\n"),aspect:project.aspect,durationSec:scene.durationSec,kind:args.kind,model:config.mock[args.kind],scenario,refs:refs.sort((a,b)=>a.id.localeCompare(b.id)).map(({id,sha256,rightsNote})=>({id,sha256,rightsNote})),characters:characters.sort((a,b)=>a.id.localeCompare(b.id)).map(({id,lockedJson,refAssetIdsJson,voiceProfileJson})=>({id,lockedJson,refAssetIdsJson,voiceProfileJson}))});
  const inputJson=JSON.stringify(snapshot),hash=createHash("sha256").update(inputJson).digest("hex"),base=`${scene.id}:${args.kind}:${hash}`;
  const existing=repo.all().find(job=>(job.status==="queued"||job.status==="running")&&job.idempotencyKey.startsWith(base+":"));if(existing)return {jobId:existing.id,duplicate:true};
  const version=nextVersion(repo.versions(scene.id).map(row=>row.version)),jobId=v7(),versionId=v7();
  repo.insert({id:jobId,kind:"generate",inputSnapshotJson:inputJson,status:"queued",projectId:project.id,refType:"scene",refId:scene.id,provider:"mock",idempotencyKey:`${base}:${version}`,nextRunAt:stamp()});
  repo.insertVersion({id:versionId,sceneId:scene.id,version,planId:plan.id,kind:args.kind,inputSnapshotJson:inputJson,jobId,status:"queued"});repo.log(project.id,"job.enqueue",{jobId,sceneId:scene.id,version},"local-user");return {jobId,versionId,duplicate:false};
 }),
 list:()=>{const heartbeat=repo.setting("worker.heartbeat");let heartbeatAt:number;try{heartbeatAt=Date.parse(JSON.parse(heartbeat?.valueJson??"null")?.at??"");}catch{heartbeatAt=0;}return {workerOnline:Number.isFinite(heartbeatAt)&&now()-heartbeatAt<45000,jobs:repo.all().filter(job=>job.status!=="succeeded"&&job.status!=="canceled"||Date.parse(job.finishedAt??job.createdAt)>now()-86400000).map(job=>({id:job.id,status:job.status,projectId:job.projectId,projectTitle:job.projectId?repo.project(job.projectId)?.title??"보관한 프로젝트":"작업",sceneTitle:repo.scene(job.refId)?.title??"장면",kind:repo.versionForJob(job.id)?.kind??"image",attempts:job.attempts,createdAt:job.createdAt,finishedAt:job.finishedAt,cancelRequested:!!job.cancelRequestedAt,errorCode:job.errorCode,errorMessage:job.errorMessage,retryable:job.status==="failed"&&retryable.has(job.errorCode??""),provider:job.provider,late:job.status==="succeeded"&&!!job.cancelRequestedAt}))};},
 heartbeatWorker:()=>repo.setSetting("worker.heartbeat",{at:stamp()}),
 recover:()=>atomic(()=>{let count=0;for(const job of repo.running()){if(job.leaseUntil&&job.leaseUntil>stamp())continue;repo.update(job.id,{status:job.cancelRequestedAt&&!job.providerJobId?"canceled":"queued",leaseUntil:null,nextRunAt:stamp(),updatedAt:stamp()});const version=repo.versionForJob(job.id);if(version)repo.updateVersion(version.id,{status:job.cancelRequestedAt&&!job.providerJobId?"canceled":"queued"});repo.log(job.projectId,"job.recover",{jobId:job.id,pollOnly:!!job.providerJobId});count++;}return count;}),
 claim:()=>atomic(()=>{service.recover();if(repo.running().length)return null;const job=repo.queued().find(row=>!row.nextRunAt||row.nextRunAt<=stamp());if(!job)return null;const attempts=job.attempts+1;repo.update(job.id,{status:"running",attempts,heartbeatAt:stamp(),leaseUntil:new Date(now()+60000).toISOString(),updatedAt:stamp()});const version=repo.versionForJob(job.id)!;repo.updateVersion(version.id,{status:"running"});let generation=repo.generation(job.id);if(!generation){const input=generationInputSchema.parse(JSON.parse(job.inputSnapshotJson));const id=v7();repo.insertGeneration({id,jobId:job.id,provider:"mock",model:input.model,paramsJson:JSON.stringify(input),referenceSnapshotJson:JSON.stringify({refs:input.refs,characters:input.characters}),costEstimateMicros:0,currency:"KRW",settlement:"none",startedAt:stamp()});repo.updateVersion(version.id,{generationId:id});generation=repo.generation(job.id)!;}return {...repo.job(job.id)!,version:version.version,generationId:generation.id,startedAt:generation.startedAt};}),
 heartbeat:(id:string,attempt:number)=>atomic(()=>{claimValid(id,attempt);repo.update(id,{heartbeatAt:stamp(),leaseUntil:new Date(now()+60000).toISOString(),updatedAt:stamp()});}),
 providerStarted:(id:string,attempt:number,providerJobId:string)=>atomic(()=>{claimValid(id,attempt);repo.update(id,{providerJobId,updatedAt:stamp()});}),
 canceled:(id:string,attempt:number)=>atomic(()=>{const job=claimValid(id,attempt);repo.update(id,{status:"canceled",finishedAt:stamp(),leaseUntil:null});repo.updateVersion(repo.versionForJob(id)!.id,{status:"canceled"});repo.log(job.projectId,"job.canceled",{jobId:id});}),
 cancel:(id:string)=>atomic(()=>{const job=repo.job(id);if(!job)throw new WorkflowError("NOT_FOUND","작업을 찾을 수 없어요.",404);if(!["running","queued"].includes(job.status))return;repo.update(id,{cancelRequestedAt:stamp(),...(job.status==="queued"&&!job.providerJobId?{status:"canceled",finishedAt:stamp()}:{}),updatedAt:stamp()});if(job.status==="queued"&&!job.providerJobId)repo.updateVersion(repo.versionForJob(id)!.id,{status:"canceled"});repo.log(job.projectId,"job.cancel_requested",{jobId:id},"local-user");}),
 retry:(id:string)=>atomic(()=>{const job=repo.job(id);if(!job||job.status!=="failed"||!retryable.has(job.errorCode??""))throw new WorkflowError("INVALID_TRANSITION","다시 시도할 수 없는 작업이에요.");const project=job.projectId?repo.project(job.projectId):undefined;const input=generationInputSchema.parse(JSON.parse(job.inputSnapshotJson));if(!project||project.approvedPlanId!==input.planId)throw new WorkflowError("PLAN_NOT_APPROVED","현재 승인 기획으로 새 작업을 만들어 주세요.");workflow.requireApprovedPlan(project.id,input.planId);repo.update(id,{status:"queued",attempts:0,nextRunAt:stamp(),finishedAt:null,cancelRequestedAt:null,errorCode:null,errorMessage:null});repo.updateVersion(repo.versionForJob(id)!.id,{status:"queued"});repo.log(job.projectId,"job.retry",{jobId:id},"local-user");}),
 fail:(id:string,attempt:number,code:string,message:string)=>atomic(()=>{const job=claimValid(id,attempt),willRetry=!job.cancelRequestedAt&&retryable.has(code)&&job.attempts<job.maxAttempts;repo.update(id,{status:job.cancelRequestedAt?"canceled":willRetry?"queued":"failed",errorCode:code,errorMessage:message,leaseUntil:null,nextRunAt:willRetry?new Date(now()+30000*2**(job.attempts-1)).toISOString():null,finishedAt:willRetry?null:stamp(),updatedAt:stamp()});repo.updateVersion(repo.versionForJob(id)!.id,{status:job.cancelRequestedAt?"canceled":willRetry?"queued":"failed"});repo.log(job.projectId,"job.failed",{jobId:id,code,retryScheduled:willRetry});}),
 finish:(id:string,attempt:number,asset:Parameters<ReturnType<typeof jobsRepository>["insertAsset"]>[0])=>atomic(()=>{const job=claimValid(id,attempt),version=repo.versionForJob(id)!,input=generationInputSchema.parse(JSON.parse(job.inputSnapshotJson));if(!storedFileExists(asset.filePath??null))throw new WorkflowError("INVALID_VERSION","결과 파일이 없어요.");repo.insertAsset(asset);repo.updateVersion(version.id,{status:"succeeded",resultAssetId:asset.id});repo.update(id,{status:"succeeded",leaseUntil:null,finishedAt:stamp(),updatedAt:stamp(),errorCode:null,errorMessage:null});const generation=repo.generation(id)!;repo.updateGeneration(generation.id,{costActualMicros:0,settlement:"settled",finishedAt:stamp()});const project=repo.project(input.projectId),scene=repo.scene(input.sceneId);let selected=false;
  if(!job.cancelRequestedAt&&project?.approvedPlanId===input.planId&&scene&&!scene.archivedAt&&!scene.selectedVersionId){workflow.changeContent(project.id,project.contentRevision,"produce","scene.first_result",()=>{repo.select(scene.id,version.id);});selected=true;}
  repo.log(job.projectId,"job.succeeded",{jobId:id,versionId:version.id,selected,late:!!job.cancelRequestedAt});return {selected};}),
 job:(id:string)=>repo.job(id),
 };
 return service;
}
function ready(){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);}
export function listJobs(){return withDatabase(handle=>jobsService(handle).list());}
export function enqueueGeneration(input:unknown){ready();return withDatabase(handle=>jobsService(handle).enqueue(input));}
export function updateJob(id:string,action:"cancel"|"retry"){ready();return withDatabase(handle=>jobsService(handle)[action](id));}
export type JobsData=ReturnType<typeof listJobs>;
export type {GenerationInput};
