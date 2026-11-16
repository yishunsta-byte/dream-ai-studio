import "server-only";
import { createHash } from "node:crypto";
import { chmodSync, createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extname, join, relative } from "node:path";
import type { DatabaseHandle } from "@/lib/db/connection";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository } from "@/lib/repo/renders";
import { resolveStoredFile } from "@/lib/storage/paths";
import { storageDirectory } from "@/lib/storage/upload";
import { runtimeRoot } from "@/lib/config/runtime";
import { jobsService } from "@/lib/services/jobs";
import { audioModeOf, audioNeededBytes, checkAudioTools, freeBytes, mixPlan, neededBytes, renderInputSchema, sha256Text, type RenderInput } from "@/lib/render/input";
import { mediaBinary } from "@/lib/media/tools";
import type { AudioStart } from "@/render/child";
import { startFileServer, type FileServer, type ServedFile } from "@/lib/render/file-server";
import { renderProps } from "@/lib/render/props";
import { runRenderAttempt } from "@/lib/render/run";
import { checkBrowser, compositionSourceSha256, COMPOSITION_ID, fileSha256 } from "@/lib/render/tools";
import { verifyAudio, verifyRender, type RenderAudioRecord, type VerifyResult } from "@/lib/render/verify";
import { RENDER_MESSAGES, RENDER_RETRYABLE, storageFailure, type RenderErrorCode } from "@/lib/render/errors";

// P2-4b worker side of one render attempt (T-101 2.3·2.5·2.7). The claim already set the row running/prepare.
// prepare: the fixed input is read back and every file it names is measured again (pinned browser, composition
// source, media, fonts, free space) → compose: owned child process (lib/render/run.ts) → verify: the app's ffprobe
// → publish: the verified file is linked to its fixed path (never overwriting) and the row and job are finished in
// one transaction. A cancel that arrives after the file passed keeps it as canceled_late (never selected).
// Failures carry a code; only a crash of the browser/child or a transient storage error is retried (T-105 by cause).
// T-137 (T-136 2.2-2.6): an envelope B mix renders the video muted to work/video.mp4, then the same child processes
// the sound (lib/audio, sources pinned by absolute path + hash, tools by hash) and writes work/out.mp4. The worker
// checks the tools again before starting, verifies the result (P2-4 items with one AAC stream, the exact decoded
// sample count, the video packets of the muted render, and for a normalized result its own loudness measurement)
// and keeps the processing record in verify_json.audio. Envelope A and mode none take the P2-4 path unchanged.
export const RENDER_TIME_LIMIT_MS=30*60000;
// errno: the original system error code, kept for the activity log (never a path).
export class RenderFailure extends Error{constructor(readonly code:RenderErrorCode,message:string,readonly retryable=false,readonly verify:VerifyResult|null=null,readonly errno:string|null=null){super(message);this.name="RenderFailure";}}
const errnoOf=(error:unknown)=>{const code=(error as NodeJS.ErrnoException)?.code;return typeof code==="string"&&/^E[A-Z0-9]+$/.test(code)?code:null;};
// A failed write, classified once (lib/render/errors storageFailure) with its cause kept.
export function storageError(error:unknown){const errno=errnoOf(error),kind=storageFailure(errno);return new RenderFailure(kind.code,RENDER_MESSAGES[kind.code],kind.retryable,null,errno);}
const RETRYABLE=new Set<RenderErrorCode>(RENDER_RETRYABLE);
const MIME:Record<string,string>={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".mp4":"video/mp4",".webm":"video/webm",".mov":"video/quicktime",".woff2":"font/woff2",".woff":"font/woff",".ttf":"font/ttf",".otf":"font/otf"};
const mimeOf=(path:string)=>MIME[extname(path).toLowerCase()]??"application/octet-stream";
export const renderTempName=(renderId:string,attempt:number)=>`render-${renderId}-${attempt}`;
export const renderFileRel=(projectId:string,renderId:string)=>`projects/${projectId}/renders/${renderId}.mp4`;
const fontsRoot=()=>join(/*turbopackIgnore: true*/process.cwd(),"public","fonts");
const appRoot=()=>/*turbopackIgnore: true*/process.cwd();

// prepare: the pinned browser and the composition source are measured again, then every media and font file is
// copied into the attempt's own folder while hashing (T-116 F116-2). The render serves only these copies, through
// handles the file server opens once; the copies are what matched the fixed input, and they are checked again before
// the result is published. A source changed after this copy cannot reach the render.
export type StagedFile=ServedFile&{sha256:string};
async function copyHashed(source:string,target:string,signal?:AbortSignal){
  const hash=createHash("sha256");let size=0;
  const tap=new Transform({transform(chunk:Buffer,_encoding,done){hash.update(chunk);size+=chunk.length;done(null,chunk);}});
  await pipeline(createReadStream(/*turbopackIgnore: true*/source),tap,createWriteStream(/*turbopackIgnore: true*/target,{flags:"wx"}),{signal});
  return {size,sha256:hash.digest("hex")};
}
const MISSING_ERRNO=new Set(["ENOENT","ENOTDIR","EISDIR"]);
export async function recheckInput(input:RenderInput,work:string,signal?:AbortSignal){
  const browser=await checkBrowser({fresh:true});
  if(!browser.ok)throw new RenderFailure("RENDER_BROWSER_MISSING",RENDER_MESSAGES.RENDER_BROWSER_MISSING);
  if(browser.sha256!==input.renderer.browserSha256||browser.version!==input.renderer.browser)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
  if(compositionSourceSha256()!==input.renderer.compositionSourceSha256)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
  const folder=join(/*turbopackIgnore: true*/work,"inputs");try{mkdirSync(/*turbopackIgnore: true*/folder,{recursive:true});}catch(error){throw storageError(error);}
  const stage=async(source:string|null,name:string,expected:{sha256:string;sizeBytes:number},missing:"RENDER_INPUT_MISSING"|"FONT_MISSING"):Promise<StagedFile>=>{
    if(!source)throw new RenderFailure(missing,RENDER_MESSAGES[missing]);
    const target=join(folder,name);let copied;
    try{copied=await copyHashed(source,target,signal);}
    catch(error){if(signal?.aborted)throw error;if(MISSING_ERRNO.has(errnoOf(error)??""))throw new RenderFailure(missing,RENDER_MESSAGES[missing],false,null,errnoOf(error));throw storageError(error);}
    if(copied.sha256!==expected.sha256||copied.size!==expected.sizeBytes)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
    try{chmodSync(/*turbopackIgnore: true*/target,0o444);}catch{/* read-only is an extra guard; the check before publishing decides */}
    return {absolute:target,mime:mimeOf(source),sizeBytes:copied.size,sha256:copied.sha256};
  };
  const media:StagedFile[]=[],fonts:StagedFile[]=[];
  for(const [n,item] of input.media.entries()){const file=resolveStoredFile(item.relPath);media.push(await stage(file,`m${n}${extname(file??"").toLowerCase()}`,item,"RENDER_INPUT_MISSING"));}
  for(const [n,font] of input.fonts.entries()){
    const file=join(/*turbopackIgnore: true*/fontsRoot(),font.relPath),inside=relative(fontsRoot(),file);
    fonts.push(await stage(inside.startsWith("..")?null:file,`f${n}${extname(file).toLowerCase()}`,font,"FONT_MISSING"));
  }
  return {browser,media,fonts};
}
// Before publishing: the copies the render read are still the accepted bytes.
export async function verifyStaged(files:readonly StagedFile[]){
  for(const file of files){let digest;try{digest=await fileSha256(file.absolute,{fresh:true});}catch{throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);}
    if(digest.sha256!==file.sha256||digest.sizeBytes!==file.sizeBytes)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);}
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

// attempt/link: replaceable only by tests (composition and the final link are the real ones otherwise).
export type RenderRunOptions={now?:()=>number;bundleRoot?:string;netLog?:boolean;graceMs?:number;pollMs?:number;onChild?:(pid:number)=>void;onBundle?:(result:"hit"|"built",rejected:string|null)=>void;
  attempt?:typeof runRenderAttempt;link?:(from:string,to:string)=>void};
export async function runClaimedRender(handle:DatabaseHandle,job:{id:string;attempts:number;refId:string;startedAt:string},options:RenderRunOptions={}){
  const now=options.now??Date.now,service=jobsService(handle,now),renders=rendersRepository(handle),jobs=jobsRepository(handle),stamp=()=>new Date(now()).toISOString();
  const row=renders.row(job.refId);if(!row||row.jobId!==job.id){service.fail(job.id,job.attempts,"RENDER_FAILED",RENDER_MESSAGES.RENDER_FAILED,{retryable:false});return;}
  let stop:"cancel"|"timeout"|null=null;const controller=new AbortController();
  const check=()=>{if(stop)return stop;if(service.job(job.id)?.cancelRequestedAt)stop="cancel";else if(now()-Date.parse(job.startedAt)>RENDER_TIME_LIMIT_MS)stop="timeout";if(stop)controller.abort();return stop;};
  const timer=setInterval(check,options.pollMs??250);
  let work:string|null=null,server:FileServer|null=null;const cleanup:string[]=[];
  const finishFailure=(failure:RenderFailure)=>{
    if(stop==="cancel"||failure.code==="RENDER_CANCELED"){service.canceled(job.id,job.attempts);return;}
    if(failure.errno){try{jobs.log(row.projectId,"render.io_error",{renderId:row.id,jobId:job.id,code:failure.code,errno:failure.errno,retryable:failure.retryable});}catch{/* the failure itself is still recorded */}}
    service.fail(job.id,job.attempts,failure.code,failure.message,{retryable:failure.retryable,verifyJson:failure.verify?JSON.stringify(failure.verify):null});
  };
  try{
    if(sha256Text(row.inputJson)!==row.inputSha256)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
    const input=renderInputSchema.parse(JSON.parse(row.inputJson));
    if(check())throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",stop==="timeout"?RENDER_MESSAGES.TIMEOUT:RENDER_MESSAGES.RENDER_CANCELED);
    // Sound: the tools are still the pinned ones and every source still exists at its stored path (its bytes are
    // checked by lib/audio while it copies them: a change is RENDER_INPUT_CHANGED).
    const plan=mixPlan(input);let soundSources:AudioStart["request"]["sources"]|null=null;
    if(plan){
      const tools=await checkAudioTools();if(!tools)throw new RenderFailure("AUDIO_FAILED",RENDER_MESSAGES.AUDIO_FAILED);
      if(tools.ffmpegSha256!==plan.tools.ffmpegSha256||tools.ffprobeSha256!==plan.tools.ffprobeSha256)throw new RenderFailure("RENDER_INPUT_CHANGED",RENDER_MESSAGES.RENDER_INPUT_CHANGED);
      soundSources={};
      for(const source of plan.sources){const file=resolveStoredFile(source.relPath);if(!file||!existsSync(/*turbopackIgnore: true*/file))throw new RenderFailure("RENDER_INPUT_MISSING",RENDER_MESSAGES.RENDER_INPUT_MISSING);
        soundSources[source.assetId]={path:file,sha256:source.sha256,sizeBytes:source.sizeBytes};}
    }
    // The work folder also holds the input copies (T-116 F116-2), the attempt's bundle and (sound) the processing.
    const need=neededBytes(input.durationInFrames,input.output.width,input.output.height)+[...input.media,...input.fonts].reduce((sum,item)=>sum+item.sizeBytes,0)+audioNeededBytes(plan,input.durationInFrames,input.output.width,input.output.height),tmp=await storageDirectory("tmp");
    // Frames, the browser profile and the output all live in the work folder under storage/tmp (one volume).
    {let free=Infinity;try{free=await freeBytes(tmp);}catch{/* unknown: the render reports a real ENOSPC */}if(free<need)throw new RenderFailure("DISK_FULL",RENDER_MESSAGES.DISK_FULL);}
    work=join(/*turbopackIgnore: true*/tmp,renderTempName(row.id,job.attempts));removeAll(work);
    try{mkdirSync(/*turbopackIgnore: true*/join(work,"os-tmp"),{recursive:true});}catch(error){throw storageError(error);}
    const checked=await recheckInput(input,work,controller.signal);
    server=await startFileServer(checked.media,checked.fonts);
    const output=join(work,"out.mp4"),bundleRoot=options.bundleRoot??join(appRoot(),"tmp","render-bundle");let lastWrite=0;
    const silentVideo=join(work,"video.mp4");let audio:AudioStart|null=null;
    if(plan&&soundSources&&input.timeline.schemaVersion===2){
      try{mkdirSync(/*turbopackIgnore: true*/join(work,"audio"));}catch(error){throw storageError(error);}
      audio={request:{outputFrames:plan.outputFrames,audio:input.timeline.audio,audioJoins:input.timeline.audioJoins,sources:soundSources},
        tools:{ffmpeg:mediaBinary("ffmpeg"),ffprobe:mediaBinary("ffprobe"),ffmpegSha256:plan.tools.ffmpegSha256,ffprobeSha256:plan.tools.ffprobeSha256},
        workRoot:join(work,"audio"),videoPath:silentVideo,deadline:Date.parse(job.startedAt)+RENDER_TIME_LIMIT_MS-30000};
    }
    if(check())throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",RENDER_MESSAGES.RENDER_CANCELED);
    const attempt=await (options.attempt??runRenderAttempt)({appRoot:appRoot(),bundleRoot,sourceSha256:input.renderer.compositionSourceSha256,workBundle:join(work,"bundle"),fileBase:server.base,onBundle:options.onBundle,browserPath:checked.browser.path,output,
      compositionId:COMPOSITION_ID,props:renderProps(input,{media:server.mediaUrl,font:server.fontUrl}),audio,netLog:options.netLog?join(work,"net-log.json"):null,graceMs:options.graceMs,pollMs:options.pollMs,onChild:options.onChild,tempDir:join(work,"os-tmp"),
      shouldCancel:check,
      onStage:stage=>{if(stage==="compose")renders.progress(row.id,{stage:"compose",progressPermille:0,framesDone:0});},
      onProgress:value=>{const at=now();if(at-lastWrite<1000&&value.progress<1)return;lastWrite=at;
        renders.progress(row.id,{progressPermille:Math.max(0,Math.min(1000,Math.floor(value.progress*1000))),framesDone:Math.max(0,Math.min(row.framesTotal,value.renderedFrames))});}});
    await server.close();server=null;
    if(!attempt.ok){
      if(attempt.code==="RENDER_CANCELED"||(attempt.code==="TIMEOUT"&&stop))throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",stop==="timeout"?RENDER_MESSAGES.TIMEOUT:RENDER_MESSAGES.RENDER_CANCELED);
      const code=(attempt.code in RENDER_MESSAGES?attempt.code:"RENDER_FAILED") as RenderErrorCode;
      // a sound failure: the processor's own code and measurement detail go to the activity log (no path in it)
      if(plan&&/^[A-Z_]+( |$)/.test(attempt.detail)){try{jobs.log(row.projectId,"render.audio_failed",{renderId:row.id,jobId:job.id,code,detail:attempt.detail.slice(0,300)});}catch{/* the failure itself is still recorded */}}
      throw new RenderFailure(code,RENDER_MESSAGES[code],RETRYABLE.has(code));
    }
    if(!existsSync(/*turbopackIgnore: true*/output)||(plan&&!attempt.audio))throw new RenderFailure("RENDER_FAILED",RENDER_MESSAGES.RENDER_FAILED);
    await verifyStaged([...checked.media,...checked.fonts]);
    renders.progress(row.id,{stage:"verify",progressPermille:1000,framesDone:row.framesTotal});
    let verify:VerifyResult&{audio?:RenderAudioRecord};
    try{verify=await verifyRender(output,{width:input.output.width,height:input.output.height,fps:input.output.fps,frames:input.durationInFrames,...(plan?{audio:audioModeOf(input)}:{})});
      if(plan&&attempt.audio){const sound=await verifyAudio(output,silentVideo,input.durationInFrames,attempt.audio,controller.signal);
        const items=[...verify.items,...sound.items];verify={...verify,result:items.every(item=>item.pass)?"passed":"failed",items,audio:sound.record};}}
    catch{if(stop)throw new RenderFailure(stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",stop==="timeout"?RENDER_MESSAGES.TIMEOUT:RENDER_MESSAGES.RENDER_CANCELED);throw new RenderFailure("RENDER_VERIFY_FAILED",RENDER_MESSAGES.RENDER_VERIFY_FAILED);}
    if(verify.result!=="passed")throw new RenderFailure("RENDER_VERIFY_FAILED",RENDER_MESSAGES.RENDER_VERIFY_FAILED,false,verify);
    const digest=await fileSha256(output,{fresh:true});
    // publish: a new name only (link fails if the path exists); an earlier attempt that linked but did not commit
    // left the same verified bytes, which are accepted only when their hash matches this attempt's file.
    const rel=renderFileRel(row.projectId,row.id),folder=await storageDirectory(`projects/${row.projectId}/renders`),final=join(/*turbopackIgnore: true*/folder,`${row.id}.mp4`);
    let linked=false;
    try{(options.link??linkSync)(/*turbopackIgnore: true*/output,final);linked=true;}
    catch(error){if(errnoOf(error)!=="EEXIST")throw storageError(error);
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
      :error instanceof Error&&error.message.includes("다른 처리기")?null
      :storageError(error);
    if(failure){try{finishFailure(failure);}catch{/* the claim moved on: the new owner finishes it */}}
  }finally{
    clearInterval(timer);
    if(server)await server.close().catch(()=>{});
    if(work)cleanup.push(...removeAll(work));
    if(cleanup.length){try{renders.recordCleanup(row.id,cleanup);}catch{/* recorded by the next worker start */}}
  }
}
