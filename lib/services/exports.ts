import "server-only";
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { linkSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import { v7 } from "uuid";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { assertRevision, WorkflowError } from "@/lib/domain/stages";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { generationInputSchema } from "@/lib/jobs/schema";
import { exportJobSchema, manifestSchema, type BundleManifest } from "@/lib/export/schema";
import { fileDigest, verifyZip, writeZip, type BundleSource } from "@/lib/export/zip";
import { srtText } from "@/lib/edit/schema";
import { finishingRepository } from "@/lib/repo/finishing";
import { jobsRepository } from "@/lib/repo/jobs";
import { planningRepository } from "@/lib/repo/planning";
import { workflowRepository } from "@/lib/repo/workflow";
import { resolveStoredFile } from "@/lib/storage/paths";
import { storageDirectory } from "@/lib/storage/upload";
import { MediaError } from "@/lib/media/inspect";
import { workflowService } from "./workflow";
import { editingService } from "./editing";
import { jobsService } from "./jobs";
import { checkStartup } from "./startup";
export function exportService(handle:DatabaseHandle){const repo=finishingRepository(handle),jobs=jobsRepository(handle),states=workflowRepository(handle),workflow=workflowService(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function context(projectId:string,revision:number){const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);assertRevision(revision,project.contentRevision);if(!project.approvedPlanId)throw new WorkflowError("PLAN_NOT_APPROVED","현재 기획을 승인해 주세요.");const plan=workflow.requireApprovedPlan(projectId,project.approvedPlanId);workflow.requireApprovedReview(projectId);const edit=editingService(handle).current(projectId);if(!edit.value)throw new WorkflowError("STAGE_LOCKED","저장한 글자 설정을 확인해 주세요.");const selected=states.scenes(projectId).map(scene=>{const version=scene.selectedVersionId?jobs.versions(scene.id).find(row=>row.id===scene.selectedVersionId):undefined;const asset=version?.resultAssetId?jobs.assets([version.resultAssetId])[0]:undefined;const filename=asset?resolveStoredFile(asset.filePath):null;if(scene.needsRecheck||!version||version.status!=="succeeded"||!asset||!filename)throw new WorkflowError("INVALID_VERSION","모든 장면의 선택 결과 파일과 기획 변경 확인을 마쳐 주세요.");return {scene,version,asset,filename};});if(!selected.length)throw new WorkflowError("INVALID_VERSION","선택한 장면이 없어요.");return {project,plan,edit,selected,snapshot:menuSnapshotSchema.parse(JSON.parse(project.templateSnapshotJson)),reviews:repo.reviews(projectId,revision)};}
 return {
  context,
  request:(projectId:string,revision:number)=>atomic(()=>{const data=context(projectId,revision);const base=`export:${projectId}:r${revision}:${data.plan.id}:`;const old=jobs.all().find(job=>job.idempotencyKey.startsWith(base)&&["queued","running"].includes(job.status));if(old)return {id:old.refId,jobId:old.id,duplicate:true};const id=v7(),jobId=v7();repo.insertExport({id,projectId,contentRevision:revision,status:"running"});jobs.insert({id:jobId,kind:"export",inputSnapshotJson:JSON.stringify({schemaVersion:1,projectId,revision,planId:data.plan.id,exportId:id}),status:"queued",projectId,refType:"export",refId:id,provider:"local",idempotencyKey:base+id,nextRunAt:new Date().toISOString()});jobs.log(projectId,"export.enqueue",{exportId:id,jobId,contentRevision:revision},"local-user");return {id,jobId,duplicate:false};}),
  list:(projectId:string)=>{const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);const allJobs=jobs.all();return {projectId,revision:project.contentRevision,canCreate:states.stages(projectId).some(state=>state.stage==="review"&&state.status==="approved"&&state.approvedRevision===project.contentRevision),rows:repo.exports(projectId).map(row=>{const job=allJobs.find(job=>job.kind==="export"&&job.refId===row.id);const manifest=row.manifestJson?manifestSchema.safeParse(JSON.parse(row.manifestJson)):null;return {id:row.id,revision:row.contentRevision,status:row.status,jobId:job?.id??null,jobStatus:job?.status??null,error:row.error,createdAt:row.createdAt,completedAt:row.completedAt,available:row.status==="succeeded"&&!!resolveStoredFile(row.filePath),isMock:manifest?.success?manifest.data.isMock:null,fileCount:manifest?.success?manifest.data.files.length:0,sha256:row.sha256};})};},
 };
}
export async function runClaimedExport(handle:DatabaseHandle,job:{id:string;attempts:number;inputSnapshotJson:string;startedAt:string},now:()=>number=Date.now){
 const input=exportJobSchema.parse(JSON.parse(job.inputSnapshotJson)),service=jobsService(handle,now),repo=finishingRepository(handle),jobs=jobsRepository(handle),states=workflowRepository(handle);const record=repo.export(input.exportId);if(!record||record.projectId!==input.projectId||record.contentRevision!==input.revision)throw new MediaError("EXPORT_INVALID","내보내기 입력을 확인해 주세요.");
 const controller=new AbortController();let canceled=false,timedOut=false;const timer=setInterval(()=>{if(service.job(job.id)?.cancelRequestedAt){canceled=true;controller.abort();}else if(now()-Date.parse(job.startedAt)>10*60000){timedOut=true;controller.abort();}},250);
 let temp:string|undefined,tempCreated=false,final:string|undefined;
 try {
  if(service.job(job.id)?.cancelRequestedAt){canceled=true;throw new MediaError("EXPORT_CANCELED","내보내기를 취소했어요.");}
  let data;try{data=exportService(handle).context(input.projectId,input.revision);if(data.plan.id!==input.planId)throw new Error("plan changed");}catch{throw new MediaError("EXPORT_INVALID","내용이 바뀌었거나 검수가 유효하지 않아요. 현재 내용을 다시 검수해 주세요.",409);}
  const sources:BundleSource[]=[],files:BundleManifest["files"]=[];
  async function addFile(path:string,filename:string,mime:string,extra:Partial<BundleManifest["files"][number]>={}){const digest=await fileDigest(filename,controller.signal);sources.push({path,filename});files.push({...extra,path,mime,...digest});}
  function addText(path:string,text:string,mime="text/plain"){const bytes=Buffer.from(text,"utf8");sources.push({path,bytes});files.push({path,mime,sizeBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});}
  for(const [index,item] of data.selected.entries()){
   const path=`scenes/${String(index+1).padStart(2,"0")}_${item.scene.id}_v${item.version.version}${item.asset.isMock?"_SAMPLE":""}${extname(item.asset.filePath!)}`;await addFile(path,item.filename,item.asset.mime!,{sceneId:item.scene.id,versionId:item.version.id,width:item.asset.width,height:item.asset.height,durationMs:item.asset.durationMs,rights:item.asset.rightsNote});const measured=files.at(-1)!;if(measured.sha256!==item.asset.sha256||measured.sizeBytes!==item.asset.sizeBytes)throw new MediaError("EXPORT_INVALID","결과 파일의 해시가 등록 기록과 달라요. 파일을 확인해 주세요.",409);
  }
  addText("README.txt",`P1 편집용 묶음입니다. 완성 영상은 포함하지 않습니다.\n${data.selected.some(item=>item.asset.isMock)?"샘플 포함 · 실제 생성 결과가 아닌 시험용 자료입니다.\n":""}영상 조립과 글자 합성은 P2 범위입니다. SRT는 직접 입력한 시간만 사용합니다.\n`);
  addText("script/script.txt",data.plan.script);addText("script/plan.md",`# 승인 기획 v${data.plan.version}\n\n${data.plan.script}\n\n${JSON.stringify(JSON.parse(data.plan.stepsJson),null,2)}`);
  addText("edit/text_overlays.json",JSON.stringify({revisionId:data.edit.id,...data.edit.snapshot},null,2),"application/json");const subtitles=srtText(data.edit.value!.layers);if(subtitles)addText("subtitles/manual.srt",subtitles,"application/x-subrip");
  const generations=data.selected.map(item=>{const generation=item.version.jobId?jobs.generation(item.version.jobId):undefined;const params=generation?generationInputSchema.safeParse(JSON.parse(generation.paramsJson)):null;return {sceneId:item.scene.id,versionId:item.version.id,generationId:generation?.id??null,provider:generation?.provider??null,model:generation?.model??null,params:params?.success?params.data:null,costActualMicros:generation?.costActualMicros??null,currency:generation?.currency??null,isMock:item.asset.isMock};});
  addText("provenance/generations.json",JSON.stringify(generations,null,2),"application/json");const original=planningRepository(handle).assets(input.projectId),inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(data.project.inputsJson));addText("provenance/rights.md",`# 출처·권리 기록\n\n프로젝트 사용권 입력: ${String(inputs.usageRights??"기록 없음")}\n\n${original.map(asset=>`- ${asset.title}: ${asset.rightsNote??"자료 메모 없음 · 직접 확인 필요"}`).join("\n")}\n\n${data.selected.map(item=>`- 선택 ${item.scene.title}: ${item.asset.rightsNote??"권리 메모 없음"}`).join("\n")}`);
  addText("review/checklist.md",`# 내용 버전 r${input.revision} 검수\n\n${data.reviews.map(item=>`- [${item.status==="pass"?"x":" "}] ${item.label}${item.required?" (필수)":""}${item.note?` · ${item.note}`:""}`).join("\n")}`);
  await addFile("fonts/PretendardVariable.woff2",join(process.cwd(),"public/fonts/PretendardVariable.woff2"),"font/woff2");addText("LICENSES/Pretendard-OFL.txt",await readFile(join(process.cwd(),"public/fonts/OFL.txt"),"utf8"));
  const manifest=manifestSchema.parse({manifestVersion:1,project:{id:data.project.id,title:data.project.title,aspect:data.project.aspect,lengthSec:data.project.lengthSec},menu:{id:data.snapshot.menu.id,label:data.snapshot.menu.label},templateVersion:data.project.templateVersion,contentRevision:input.revision,planId:data.plan.id,exportedAt:record.createdAt,isMock:data.selected.some(item=>item.asset.isMock),kind:"editing-bundle",files});
  const relative=`projects/${input.projectId}/exports/${input.exportId}.zip`,existing=resolveStoredFile(relative);const destination=await storageDirectory(`projects/${input.projectId}/exports`);final=join(/*turbopackIgnore: true*/destination,`${input.exportId}.zip`);
  if(existing)await verifyZip(existing,manifest,controller.signal);else{const tempDir=await storageDirectory("tmp");temp=join(/*turbopackIgnore: true*/tempDir,`${input.exportId}-${v7()}.zip.part`);await writeZip(temp,sources,manifest,controller.signal);tempCreated=true;await verifyZip(temp,manifest,controller.signal);}
  const digest=await fileDigest(existing??temp!,controller.signal);
  handle.sqlite.transaction(()=>{
   const claimed=service.assertClaim(job.id,job.attempts);if(claimed.cancelRequestedAt)throw new MediaError("EXPORT_CANCELED","내보내기를 취소했어요.");const current=exportService(handle).context(input.projectId,input.revision);if(current.plan.id!==input.planId)throw new MediaError("EXPORT_INVALID","승인 기획이 바뀌었어요.");let linked=false;
   try{if(!existing){linkSync(temp!,final!);linked=true;}else if(!resolveStoredFile(relative))throw new MediaError("STORAGE_FAILED","내보낸 파일이 없어졌어요.",503);
    repo.updateExport(input.exportId,{status:"succeeded",filePath:relative,manifestJson:JSON.stringify(manifest),sha256:digest.sha256,completedAt:new Date(now()).toISOString(),error:null});jobs.update(job.id,{status:"succeeded",leaseUntil:null,finishedAt:new Date(now()).toISOString(),errorCode:null,errorMessage:null});states.updateStage(input.projectId,"export",{status:"approved",approvedRevision:input.revision,approvedAt:new Date(now()).toISOString()});jobs.log(input.projectId,"export.succeeded",{exportId:input.exportId,contentRevision:input.revision,sha256:digest.sha256,isMock:manifest.isMock});
   }catch(error){if(linked){try{unlinkSync(final!);}catch{/* 확정되지 않은 파일은 다음 처리기가 검증 후 이어받을 수 있다. */}}throw error;}
  }).immediate();
 }catch(error){if(canceled){service.canceled(job.id,job.attempts);return;}if(timedOut)throw new MediaError("TIMEOUT","내보내기 제한 시간이 지났어요.");if(error instanceof MediaError||error instanceof WorkflowError)throw error;throw new MediaError("STORAGE_FAILED","편집용 묶음을 저장하거나 검증하지 못했어요. 저장 공간과 파일을 확인해 주세요.",503);}
 finally{clearInterval(timer);if(temp&&tempCreated)await unlink(temp).catch(()=>{});}
}
export function readExports(id:string){return withDatabase(handle=>exportService(handle).list(id));}
export function requestExport(id:string,revision:number){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>exportService(handle).request(id,revision));}
export async function exportDownload(id:string){const row=withDatabase(handle=>finishingRepository(handle).export(id));if(!row||row.status!=="succeeded"||!row.manifestJson||!row.sha256)throw new WorkflowError("NOT_FOUND","내보낸 파일을 찾을 수 없어요.",404);const filename=resolveStoredFile(row.filePath);if(!filename)throw new MediaError("STORAGE_FAILED","내보낸 파일이 없어요. 저장 위치를 확인해 주세요.",503);const digest=await fileDigest(filename);if(digest.sha256!==row.sha256)throw new MediaError("STORAGE_FAILED","내보낸 파일이 저장 기록과 달라요. 파일을 확인해 주세요.",503);return {filename,sizeBytes:digest.sizeBytes,title:`editing-${id}${manifestSchema.parse(JSON.parse(row.manifestJson)).isMock?"_SAMPLE":""}.zip`};}
export type ExportsData=ReturnType<typeof readExports>;
