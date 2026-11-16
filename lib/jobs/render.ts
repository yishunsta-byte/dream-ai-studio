import "server-only";
import { existsSync, linkSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { DatabaseHandle } from "@/lib/db/connection";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository } from "@/lib/repo/renders";
import { resolveStoredFile } from "@/lib/storage/paths";
import { storageDirectory } from "@/lib/storage/upload";
import { runtimeRoot } from "@/lib/config/runtime";
import { jobsService } from "@/lib/services/jobs";
import { freeBytes, neededBytes, renderInputSchema, sha256Text, type RenderInput } from "@/lib/render/input";
import { startFileServer, type FileServer, type ServedFile } from "@/lib/render/file-server";
import { renderProps } from "@/lib/render/props";
import { runRenderAttempt } from "@/lib/render/run";
import { checkBrowser, compositionSourceSha256, COMPOSITION_ID, fileSha256 } from "@/lib/render/tools";
import { verifyRender, type VerifyResult } from "@/lib/render/verify";
import { RENDER_MESSAGES, RENDER_RETRYABLE, type RenderErrorCode } from "@/lib/render/errors";

// P2-4b worker side of one render attempt (T-101 2.3·2.5·2.7). The claim already set the row running/prepare.
// prepare: the fixed input is read back and every file it names is measured again (pinned browser, composition
// source, media, fonts, free space) → compose: owned child process (lib/render/run.ts) → verify: the app's ffprobe
// → publish: the verified file is linked to its fixed path (never overwriting) and the row and job are finished in
// one transaction. A cancel that arrives after the file passed keeps it as canceled_late (never selected).
// Failures carry a code; only a crash of the browser/child or a transient storage error is retried (T-105 by cause).
export const RENDER_TIME_LIMIT_MS=30*60000;
export class RenderFailure extends Error{constructor(readonly code:RenderErrorCode,message:string,readonly retryable=false,readonly verify:VerifyResult|null=null){super(message);this.name="RenderFailure";}}
const RETRYABLE=new Set<RenderErrorCode>(RENDER_RETRYABLE);
const MIME:Record<string,string>={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".mp4":"video/mp4",".webm":"video/webm",".mov":"video/quicktime",".woff2":"font/woff2",".woff":"font/woff",".ttf":"font/ttf",".otf":"font/otf"};
const mimeOf=(path:string)=>MIME[extname(path).toLowerCase()]??"application/octet-stream";
export const renderTempName=(renderId:string,attempt:number)=>`render-${renderId}-${attempt}`;
export const renderFileRel=(projectId:string,renderId:string)=>`projects/${projectId}/renders/${renderId}.mp4`;
const fontsRoot=()=>join(/*turbopackIgnore: true*/process.cwd(),"public","fonts");
const appRoot=()=>/*turbopackIgnore: true*/process.cwd();

// prepare: everything the input names must still be the measured bytes.
export async function recheckInput(input:RenderInput,signal?:AbortSignal){
  const browser=await checkBrowser({fresh:true});
  if(!browser.ok)throw new RenderFailure("RENDER_BROWSER_MISSING",RENDER_MESSAGES.RENDER_BROWSER_MISSING);
  if(browser.sha256!==input.renderer.browserSha256||browser.version!==input.renderer.browser)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
  if(compositionSourceSha256()!==input.renderer.compositionSourceSha256)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
  const media:ServedFile[]=[],fonts:ServedFile[]=[];
  for(const item of input.media){
    const file=resolveStoredFile(item.relPath);if(!file)throw new RenderFailure("RENDER_INPUT_MISSING",RENDER_MESSAGES.RENDER_INPUT_MISSING);
    const digest=await fileSha256(file,{fresh:true,signal});if(digest.sha256!==item.sha256||digest.sizeBytes!==item.sizeBytes)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
    media.push({absolute:file,mime:mimeOf(file),sizeBytes:digest.sizeBytes});
  }
  for(const font of input.fonts){
    const file=join(/*turbopackIgnore: true*/fontsRoot(),font.relPath),inside=relative(fontsRoot(),file);
    if(inside.startsWith("..")||!existsSync(/*turbopackIgnore: true*/file))throw new RenderFailure("FONT_MISSING",RENDER_MESSAGES.FONT_MISSING);
    const digest=await fileSha256(file,{fresh:true,signal});if(digest.sha256!==font.sha256||digest.sizeBytes!==font.sizeBytes)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
    fonts.push({absolute:file,mime:mimeOf(file),sizeBytes:digest.sizeBytes});
  }
  return {browser,media,fonts};
}

// Removes a folder; returns the paths (relative to the runtime root) it could not remove.
function removeAll(path:string):string[]{
  try{rmSync(/*turbopackIgnore: true*/path,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{/* reported below */}
  return existsSync(/*turbopackIgnore: true*/path)?[relative(runtimeRoot(),path).replaceAll("\\","/")]:[];
}
// Worker start: render work folders of attempts that are not running now (crash, power loss). Returns what is left.
// A running job whose lease ran out is not running anywhere (its worker stopped): its folder goes too.
export async function cleanStaleRenderTemps(handle:DatabaseHandle,now:()=>number=Date.now){
  const at=new Date(now()).toISOString(),tmp=await storageDirectory("tmp");
  const running=new Set(jobsRepository(handle).running().filter(job=>job.kind==="render"&&!!job.leaseUntil&&job.leaseUntil>at).map(job=>renderTempName(job.refId,job.attempts)));
  const left:string[]=[];
  for(const name of readdirSync(/*turbopackIgnore: true*/tmp))if(/^render-[0-9a-f-]{36}-\d+$/.test(name)&&!running.has(name))left.push(...removeAll(join(tmp,name)));
  return left;
}

export type RenderRunOptions={now?:()=>number;bundleRoot?:string;netLog?:boolean;graceMs?:number;pollMs?:number;onChild?:(pid:number)=>void};
export async function runClaimedRender(handle:DatabaseHandle,job:{id:string;attempts:number;refId:string;startedAt:string},options:RenderRunOptions={}){
  const now=options.now??Date.now,service=jobsService(handle,now),renders=rendersRepository(handle),jobs=jobsRepository(handle),stamp=()=>new Date(now()).toISOString();
  const row=renders.row(job.refId);if(!row||row.jobId!==job.id){service.fail(job.id,job.attempts,"RENDER_FAILED",RENDER_MESSAGES.RENDER_FAILED,{retryable:false});return;}
  let stop:"cancel"|"timeout"|null=null;const controller=new AbortController();
  const check=()=>{if(stop)return stop;if(service.job(job.id)?.cancelRequestedAt)stop="cancel";else if(now()-Date.parse(job.startedAt)>RENDER_TIME_LIMIT_MS)stop="timeout";if(stop)controller.abort();return stop;};
  const timer=setInterval(check,options.pollMs??250);
  let work:string|null=null,server:FileServer|null=null;const cleanup:string[]=[];
  const finishFailure=(failure:RenderFailure)=>{
    if(stop==="cancel"||failure.code==="RENDER_CANCELED"){service.canceled(job.id,job.attempts);return;}
    service.fail(job.id,job.attempts,failure.code,failure.message,{retryable:failure.retryable,verifyJson:failure.verify?JSON.stringify(failure.verify):null});
  };
  try{
    if(sha256Text(row.inputJson)!==row.inputSha256)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
    const input=renderInputSchema.parse(JSON.parse(row.inputJson));
    if(check())throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",stop==="timeout"?RENDER_MESSAGES.TIMEOUT:RENDER_MESSAGES.RENDER_CANCELED);
    const checked=await recheckInput(input,controller.signal);
    const need=neededBytes(input.durationInFrames,input.output.width,input.output.height),tmp=await storageDirectory("tmp");
    // Frames, the browser profile and the output all live in the work folder under storage/tmp (one volume).
    {let free=Infinity;try{free=await freeBytes(tmp);}catch{/* unknown: the render reports a real ENOSPC */}if(free<need)throw new RenderFailure("DISK_FULL",RENDER_MESSAGES.DISK_FULL);}
    work=join(/*turbopackIgnore: true*/tmp,renderTempName(row.id,job.attempts));removeAll(work);mkdirSync(/*turbopackIgnore: true*/join(work,"os-tmp"),{recursive:true});
    server=await startFileServer(checked.media,checked.fonts);
    const output=join(work,"out.mp4"),bundleRoot=options.bundleRoot??join(appRoot(),"tmp","render-bundle");let lastWrite=0;
    if(check())throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",RENDER_MESSAGES.RENDER_CANCELED);
    const attempt=await runRenderAttempt({appRoot:appRoot(),bundleDir:join(bundleRoot,input.renderer.compositionSourceSha256),sourceSha256:input.renderer.compositionSourceSha256,browserPath:checked.browser.path,output,
      compositionId:COMPOSITION_ID,props:renderProps(input,{media:server.mediaUrl,font:server.fontUrl}),netLog:options.netLog?join(work,"net-log.json"):null,graceMs:options.graceMs,pollMs:options.pollMs,onChild:options.onChild,tempDir:join(work,"os-tmp"),
      shouldCancel:check,
      onStage:stage=>{if(stage==="compose")renders.progress(row.id,{stage:"compose",progressPermille:0,framesDone:0});},
      onProgress:value=>{const at=now();if(at-lastWrite<1000&&value.progress<1)return;lastWrite=at;
        renders.progress(row.id,{progressPermille:Math.max(0,Math.min(1000,Math.floor(value.progress*1000))),framesDone:Math.max(0,Math.min(row.framesTotal,value.renderedFrames))});}});
    await server.close();server=null;
    if(!attempt.ok){
      if(attempt.code==="RENDER_CANCELED"||attempt.code==="TIMEOUT")throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",stop==="timeout"?RENDER_MESSAGES.TIMEOUT:RENDER_MESSAGES.RENDER_CANCELED);
      const code=(attempt.code in RENDER_MESSAGES?attempt.code:"RENDER_FAILED") as RenderErrorCode;
      throw new RenderFailure(code,RENDER_MESSAGES[code],RETRYABLE.has(code));
    }
    if(!existsSync(/*turbopackIgnore: true*/output))throw new RenderFailure("RENDER_FAILED",RENDER_MESSAGES.RENDER_FAILED);
    renders.progress(row.id,{stage:"verify",progressPermille:1000,framesDone:row.framesTotal});
    let verify:VerifyResult;
    try{verify=await verifyRender(output,{width:input.output.width,height:input.output.height,fps:input.output.fps,frames:input.durationInFrames});}
    catch{throw new RenderFailure("RENDER_VERIFY_FAILED",RENDER_MESSAGES.RENDER_VERIFY_FAILED);}
    if(verify.result!=="passed")throw new RenderFailure("RENDER_VERIFY_FAILED",RENDER_MESSAGES.RENDER_VERIFY_FAILED,false,verify);
    const digest=await fileSha256(output,{fresh:true});
    // publish: a new name only (link fails if the path exists); an earlier attempt that linked but did not commit
    // left the same verified bytes, which are accepted only when their hash matches this attempt's file.
    const rel=renderFileRel(row.projectId,row.id),folder=await storageDirectory(`projects/${row.projectId}/renders`),final=join(/*turbopackIgnore: true*/folder,`${row.id}.mp4`);
    let linked=false;
    try{linkSync(/*turbopackIgnore: true*/output,final);linked=true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw new RenderFailure("STORAGE_FAILED",RENDER_MESSAGES.STORAGE_FAILED,true);
      const existing=await fileSha256(final,{fresh:true});if(existing.sha256!==digest.sha256||existing.sizeBytes!==digest.sizeBytes)throw new RenderFailure("STORAGE_FAILED",RENDER_MESSAGES.STORAGE_FAILED);}
    try{
      handle.sqlite.transaction(()=>{
        const claimed=service.assertClaim(job.id,job.attempts),late=!!claimed.cancelRequestedAt,at=stamp();
        renders.finish(row.id,{status:late?"canceled":"succeeded",finishedAt:at,filePath:rel,sha256:digest.sha256,sizeBytes:digest.sizeBytes,verifyJson:JSON.stringify(verify),canceledLate:late,stage:"verify",progressPermille:1000,framesDone:row.framesTotal,errorCode:late?"RENDER_CANCELED":null,errorMessage:null});
        jobs.update(job.id,{status:late?"canceled":"succeeded",leaseUntil:null,finishedAt:at,updatedAt:at,errorCode:null,errorMessage:null});
        jobs.log(row.projectId,late?"render.canceled_late":"render.succeeded",{renderId:row.id,jobId:job.id,sha256:digest.sha256,sizeBytes:digest.sizeBytes,isSample:!!row.isSample});
      }).immediate();
    }catch(error){if(linked){try{unlinkSync(/*turbopackIgnore: true*/final);}catch{/* the next attempt accepts the same verified bytes */}}throw error;}
  }catch(error){
    const failure=error instanceof RenderFailure?error:stop?new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",stop==="timeout"?RENDER_MESSAGES.TIMEOUT:RENDER_MESSAGES.RENDER_CANCELED)
      :(error as NodeJS.ErrnoException)?.code==="ENOSPC"?new RenderFailure("DISK_FULL",RENDER_MESSAGES.DISK_FULL)
      :error instanceof Error&&error.message.includes("다른 처리기")?null
      :new RenderFailure("STORAGE_FAILED",RENDER_MESSAGES.STORAGE_FAILED,["EBUSY","EAGAIN"].includes((error as NodeJS.ErrnoException)?.code??""));
    if(failure){try{finishFailure(failure);}catch{/* the claim moved on: the new owner finishes it */}}
  }finally{
    clearInterval(timer);
    if(server)await server.close().catch(()=>{});
    if(work)cleanup.push(...removeAll(work));
    if(cleanup.length){try{renders.recordCleanup(row.id,cleanup);}catch{/* recorded by the next worker start */}}
  }
}
