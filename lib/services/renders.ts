import "server-only";
import { statSync } from "node:fs";
import { z } from "zod";
import { v7 } from "uuid";
import type { DatabaseHandle } from "@/lib/db/connection";
import { openDatabase } from "@/lib/db/connection";
import { verifyMigrations } from "@/lib/db/migrate";
import { WorkflowError } from "@/lib/domain/stages";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository, type RenderRow } from "@/lib/repo/renders";
import { resolveStoredFile } from "@/lib/storage/paths";
import { prepareRender, renderInputJson, renderInputSchema, sha256Text, type PrepareDeps, type RenderBlocker, type RenderInput } from "@/lib/render/input";
import { renderFileName } from "@/lib/render/name";
import { RENDER_MESSAGES, renderRetryable } from "@/lib/render/errors";
import type { VerifyResult } from "@/lib/render/verify";
import { jobsService } from "./jobs";
import { checkStartup } from "./startup";

// P2-4b render requests, list, cancel and download (T-101 2.9, T-102 14장 values). The heavy work is the worker's;
// this service fixes the input (pre-check, CAS against the screen's revision and saved timeline) and reads rows.
export const RENDER_MAX_ATTEMPTS=3;// first try + at most 2 automatic retries (T-105)
export class RenderRequestError extends Error{constructor(readonly code:string,message:string,readonly status=409,readonly blockers:RenderBlocker[]=[]){super(message);this.name="RenderRequestError";}}
export const renderRequestSchema=z.strictObject({revision:z.number().int().positive(),timelineId:z.uuid()});
// The request reads files between database reads, so it holds one handle across awaits (the sync withDatabase
// closes before the first await). The handle is closed on every path.
async function withDatabaseAsync<T>(operation:(handle:DatabaseHandle)=>Promise<T>):Promise<T>{
  const handle=openDatabase(undefined,{fileMustExist:true},{wal:false});
  try{verifyMigrations(handle.sqlite);handle.sqlite.pragma("journal_mode = WAL");return await operation(handle);}finally{handle.close();}
}
function ready(){if(!checkStartup().canStart)throw new RenderRequestError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);}
const BLOCKER_MESSAGE:Record<RenderBlocker["code"],string>={
  RENDER_INPUT_MISSING:"영상에 쓸 장면 결과나 파일을 확인해 주세요.",FONT_MISSING:"글자에 쓴 글꼴을 확인해 주세요.",TIMELINE_STALE:"선택한 장면 결과가 바뀌었어요. 편집 화면에서 다시 저장해 주세요.",
  RENDER_BROWSER_MISSING:"영상 만들기 도구를 확인해 주세요.",DISK_FULL:"저장 공간이 부족해요.",RENDER_ACTIVE:"이 프로젝트의 다른 영상을 만들고 있어요.",
};

type VerifyView={result:"passed"|"failed";items:VerifyResult["items"]};
export type RenderView={
  id:string;jobId:string;status:RenderRow["status"];stage:RenderRow["stage"];progress:number|null;renderedFrames:number;totalFrames:number;
  createdAt:string;startedAt:string|null;finishedAt:string|null;elapsedSec:number|null;attempt:number;maxAttempts:number;cancelRequested:boolean;
  waiting:null|{reason:"worker_off"}|{reason:"behind_job";kind:string}|{reason:"retry_scheduled";at:string};
  timelineRevision:number;contentRevision:number;stale:boolean;isSample:boolean;fileName:string;sizeBytes:number|null;fileExists:boolean;
  width:number;height:number;fps:number;codec:string|null;durationSec:number;audioStreams:number|null;
  verify:VerifyView|null;canceledLate:boolean;cleanupLeft:string[];
  errorCode:string|null;errorMessage:string|null;error:null|{code:string;retryable:boolean;attempts:number;maxAttempts:number};
  subtitleMeasure:null;phonePlayback:null;textOnlyChange:boolean|null;etaSec:number|null;
};
const parseJson=<T>(text:string|null):T|null=>{if(!text)return null;try{return JSON.parse(text) as T;}catch{return null;}};
const seconds=(from:string|null,to:string|null)=>from&&to?Math.max(0,Math.round((Date.parse(to)-Date.parse(from))/1000)):null;
// "Only the texts changed": the same scenes (media and clips) as the newest earlier success, and different texts.
function textOnly(input:RenderInput|null,previous:RenderInput|null){
  if(!input||!previous)return null;
  const scenes=(value:RenderInput)=>JSON.stringify({media:value.media,video:value.timeline.video,aspect:value.timeline.aspect});
  return scenes(input)===scenes(previous)&&JSON.stringify(input.timeline.text)!==JSON.stringify(previous.timeline.text);
}

export function rendersService(handle:DatabaseHandle,now:()=>number=Date.now){
  const renders=rendersRepository(handle),jobs=jobsRepository(handle),service=jobsService(handle,now),stamp=()=>new Date(now()).toISOString();
  const project=(id:string)=>{const value=jobs.project(id);if(!value)throw new RenderRequestError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);return value;};
  async function check(projectId:string,deps?:PrepareDeps){
    const prepared=await prepareRender(handle,projectId,deps),blockers=[...prepared.blockers],active=renders.active(projectId);
    if(active)blockers.push({code:"RENDER_ACTIVE",params:{renderId:active.id}});
    return {...prepared,blockers,active};
  }
  function workerOnline(){const value=parseJson<{at?:string}>(jobs.setting("worker.heartbeat")?.valueJson??null);const at=Date.parse(value?.at??"");return Number.isFinite(at)&&now()-at<45000;}
  function view(row:RenderRow,context:{contentRevision:number;currentTimelineRevId:string|null;online:boolean;previous:RenderInput|null;secondsPerFrame:number|null}):RenderView{
    const job=jobs.job(row.jobId),input=(()=>{try{return renderInputSchema.parse(JSON.parse(row.inputJson));}catch{return null;}})();
    const verifyRaw=parseJson<VerifyResult>(row.verifyJson),probe=verifyRaw?.probe;
    let fileExists=false;if(row.filePath){const file=resolveStoredFile(row.filePath);try{fileExists=!!file&&statSync(/*turbopackIgnore: true*/file).size===row.sizeBytes;}catch{fileExists=false;}}
    const running=row.status==="running",queued=row.status==="queued",other=queued?jobs.running().find(item=>item.id!==row.jobId):undefined;
    const waiting:RenderView["waiting"]=!queued?null:!context.online?{reason:"worker_off"}:other?{reason:"behind_job",kind:other.kind}:job?.nextRunAt&&Date.parse(job.nextRunAt)>now()?{reason:"retry_scheduled",at:job.nextRunAt}:null;
    const code=row.errorCode??(row.status==="failed"?job?.errorCode??null:null);
    return {id:row.id,jobId:row.jobId,status:row.status,stage:row.stage,progress:row.stage==="compose"?row.progressPermille/1000:null,renderedFrames:row.framesDone,totalFrames:row.framesTotal,
      createdAt:row.createdAt,startedAt:row.startedAt,finishedAt:row.finishedAt,elapsedSec:seconds(row.startedAt,row.finishedAt??(running?stamp():null)),
      attempt:job?.attempts??0,maxAttempts:job?.maxAttempts??RENDER_MAX_ATTEMPTS,cancelRequested:!!job?.cancelRequestedAt,waiting,
      timelineRevision:row.timelineRevision,contentRevision:row.contentRevision,stale:row.contentRevision!==context.contentRevision||row.timelineRevId!==context.currentTimelineRevId,
      isSample:!!row.isSample,fileName:row.displayName,sizeBytes:row.sizeBytes??null,fileExists,
      width:input?.output.width??0,height:input?.output.height??0,fps:input?.output.fps??30,codec:probe?.codec??null,durationSec:row.framesTotal/30,audioStreams:probe?probe.audioStreams:null,
      verify:verifyRaw?{result:verifyRaw.result,items:verifyRaw.items}:null,canceledLate:!!row.canceledLate,cleanupLeft:parseJson<string[]>(row.cleanupLeftJson)??[],
      errorCode:code,errorMessage:row.errorMessage??null,error:code&&code!=="RENDER_CANCELED"?{code,retryable:renderRetryable(code),attempts:job?.attempts??0,maxAttempts:job?.maxAttempts??RENDER_MAX_ATTEMPTS}:null,
      subtitleMeasure:null,phonePlayback:null,textOnlyChange:textOnly(input,context.previous),
      etaSec:(running||queued)&&context.secondsPerFrame!==null?Math.round((row.framesTotal-row.framesDone)*context.secondsPerFrame):null};
  }
  return {
    check,
    async list(projectId:string,options:{check?:boolean;deps?:PrepareDeps}={}){
      const value=project(projectId),rows=renders.list(projectId),online=workerOnline();
      // Rate from earlier successes on this PC (T-102 ⑨): none → no estimate.
      const done=rows.filter(row=>row.status==="succeeded"&&row.startedAt&&row.finishedAt).slice(0,5);
      const secondsPerFrame=done.length?done.reduce((sum,row)=>sum+seconds(row.startedAt,row.finishedAt)!/row.framesTotal,0)/done.length:null;
      const items=rows.map((row,index)=>{const previousRow=rows.slice(index+1).find(other=>other.status==="succeeded");let previous:RenderInput|null=null;
        if(previousRow){try{previous=renderInputSchema.parse(JSON.parse(previousRow.inputJson));}catch{previous=null;}}
        return view(row,{contentRevision:value.contentRevision,currentTimelineRevId:value.currentTimelineRevId??null,online,previous,secondsPerFrame});});
      let checked:{ready:boolean;blockers:RenderBlocker[]}|null=null;
      if(options.check!==false){try{const result=await check(projectId,options.deps);checked={ready:!result.blockers.length&&!!result.input,blockers:result.blockers};}
        catch(error){if(error instanceof WorkflowError&&error.code==="STAGE_LOCKED")checked={ready:false,blockers:[]};else throw error;}}
      return {workerOnline:online,contentRevision:value.contentRevision,timelineId:value.currentTimelineRevId??null,check:checked,renders:items};
    },
    // POST: pre-check (every blocker) + CAS, then the job and the row in one transaction. The same input while a
    // render of it is still queued/running returns that one (existing: true).
    async request(projectId:string,body:unknown,deps?:PrepareDeps){
      const args=renderRequestSchema.parse(body),before=project(projectId);
      if(before.contentRevision!==args.revision||before.currentTimelineRevId!==args.timelineId)throw new RenderRequestError("CONFLICT","다른 창에서 내용이나 타임라인이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.");
      let prepared;try{prepared=await prepareRender(handle,projectId,deps);}catch(error){if(error instanceof WorkflowError)throw new RenderRequestError(error.code,error.message,error.status);throw error;}
      const json=prepared.input?renderInputJson(prepared.input):null,inputSha=json?sha256Text(json):null;
      return handle.sqlite.transaction(()=>{
        const current=project(projectId);
        if(current.contentRevision!==args.revision||current.currentTimelineRevId!==args.timelineId)throw new RenderRequestError("CONFLICT","다른 창에서 내용이나 타임라인이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.");
        const active=renders.active(projectId);
        if(active&&inputSha&&active.inputSha256===inputSha)return {renderId:active.id,jobId:active.jobId,existing:true};
        const blockers=[...prepared.blockers];if(active)blockers.push({code:"RENDER_ACTIVE",params:{renderId:active.id}});
        if(blockers.length||!prepared.input||!json||!inputSha||!prepared.row)throw new RenderRequestError(blockers[0]?.code??"RENDER_INPUT_MISSING",BLOCKER_MESSAGE[blockers[0]?.code??"RENDER_INPUT_MISSING"],409,blockers);
        const input=prepared.input,renderId=v7(),jobId=v7(),seq=renders.nextNameSeq(projectId,input.timelineRevId),at=stamp();
        const displayName=renderFileName({title:current.title,aspect:input.timeline.aspect,timelineRevision:input.timelineRevision,isSample:input.sample,seq});
        jobs.insert({id:jobId,kind:"render",payloadVersion:1,inputSnapshotJson:JSON.stringify({schemaVersion:1,renderId,inputSha256:inputSha}),status:"queued",projectId,refType:"render",refId:renderId,provider:"local",idempotencyKey:`render:${projectId}:${inputSha}:${seq}`,maxAttempts:RENDER_MAX_ATTEMPTS,nextRunAt:at});
        renders.insert({id:renderId,projectId,jobId,timelineRevId:input.timelineRevId,timelineRevision:input.timelineRevision,contentRevision:input.contentRevision,inputJson:json,inputSha256:inputSha,framesTotal:input.durationInFrames,displayName,nameSeq:seq,isSample:input.sample,createdAt:at});
        jobs.log(projectId,"render.requested",{renderId,jobId,inputSha256:inputSha,timelineRevision:input.timelineRevision,isSample:input.sample},"local-user");
        return {renderId,jobId,existing:false};
      }).immediate();
    },
    cancel(renderId:string){const row=renders.row(renderId);if(!row)throw new RenderRequestError("NOT_FOUND","영상 기록을 찾을 수 없어요.",404);if(row.status!=="queued"&&row.status!=="running")return {status:row.status,changed:false};service.cancel(row.jobId);return {status:renders.row(renderId)!.status,changed:true};},
    // Download: a verified success only (never a late result after cancel), with the stored size.
    file(renderId:string){
      const row=renders.row(renderId);if(!row||row.status!=="succeeded"||row.canceledLate||!row.filePath||!row.sha256||!row.sizeBytes)throw new RenderRequestError("NOT_FOUND","받을 수 있는 영상이 없어요.",404);
      const file=resolveStoredFile(row.filePath);if(!file)throw new RenderRequestError("STORAGE_FAILED","영상 파일이 없어요. 저장 위치를 확인해 주세요.",503);
      const size=statSync(/*turbopackIgnore: true*/file).size;if(size!==row.sizeBytes)throw new RenderRequestError("STORAGE_FAILED","영상 파일 크기가 저장 기록과 달라요.",409);
      return {absolute:file,sizeBytes:size,fileName:row.displayName,sha256:row.sha256};
    },
  };
}
export const RENDER_FAILURE_MESSAGES=RENDER_MESSAGES;
export function readRenders(projectId:string){return withDatabaseAsync(handle=>rendersService(handle).list(projectId));}
export function requestRender(projectId:string,body:unknown){ready();return withDatabaseAsync(handle=>rendersService(handle).request(projectId,body));}
export function cancelRender(renderId:string){ready();return withDatabaseAsync(async handle=>rendersService(handle).cancel(renderId));}
export function renderFile(renderId:string){return withDatabaseAsync(async handle=>rendersService(handle).file(renderId));}
export function renderErrorBody(error:unknown):{status:number;body:{error:string;code:string;blockers?:RenderBlocker[]}}{
  if(error instanceof RenderRequestError)return {status:error.status,body:{error:error.message,code:error.code,...(error.blockers.length?{blockers:error.blockers}:{})}};
  if(error instanceof WorkflowError)return {status:error.status,body:{error:error.message,code:error.code}};
  if(error instanceof z.ZodError||error instanceof SyntaxError)return {status:400,body:{error:"요청 값을 확인해 주세요.",code:"INVALID_INPUT"}};
  return {status:503,body:{error:"영상 만들기 요청을 처리하지 못했어요. 시작 점검과 저장 상태를 확인해 주세요.",code:"STORAGE_FAILED"}};
}
