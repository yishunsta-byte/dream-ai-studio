// P2-4b render child (T-101 2.3, T-108, T-116). Started by the worker with child_process.fork for one render attempt
// and talks to it only over IPC. It never opens the database: it gets the props (file server URLs), the pinned
// browser path and the output path. Order: props check (only this attempt's file server) → bundle (a trusted cache
// copy verified file by file into the attempt folder, or a fresh build there) → openBrowser first (a missing or
// broken browser fails here, before any Remotion file server exists) → selectComposition → renderMedia → close.
// Node connections to anything but loopback are refused (render/guard.ts). If the worker goes away (IPC disconnect)
// the render is cancelled and the child ends.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderProps } from "../lib/render/props";
import { assertOwnedProps, chromiumFlags, classify, installNetGuard } from "./guard";
import { copyTrustedBundle, manifestOf, storeBundle, type BundleFile, type TrustedBundle } from "./bundle-cache";
import { audioFailureCode } from "../lib/render/errors";
import type { MixRequest, ProcessedMix } from "../lib/audio/mix";

export { chromiumFlags, classify };
// bundleRoot: the cache folder; trustedBundle: the worker's own record of a cached build (null → build);
// workBundle: the attempt's folder the render serves. fileBase: the attempt's file server (the only allowed source).
// netLog: optional Chrome network log file (evidence runs).
// T-137 sound (envelope B mix; T-136 2.3): after the muted render to videoPath, the same child processes the sound
// with lib/audio (pinned sources by absolute path and hash, the tools with their expected hashes) and muxes it with
// that video into `output`. The sound step is cancelled by the same cancel/disconnect path; deadline is absolute.
export type AudioStart={request:Pick<MixRequest,"outputFrames"|"audio"|"audioJoins"|"sources">;
  tools:{ffmpeg:string;ffprobe:string;ffmpegSha256:string;ffprobeSha256:string};workRoot:string;videoPath:string;deadline:number};
export type ChildStart={type:"start";appRoot:string;entry:string;bundleRoot:string;bundleKey:string;trustedBundle:TrustedBundle|null;workBundle:string;
  browserPath:string;output:string;props:RenderProps;fileBase:string;compositionId:string;netLog:string|null;audio:AudioStart|null};
export const AUDIO_STEP_MAX_MS=10*60000;
export type ChildMessage=
  |{type:"stage";stage:"bundle"|"browser"|"compose"|"audio"}
  |{type:"audio";result:ProcessedMix}
  |{type:"bundle";result:"hit"}|{type:"bundle";result:"built";dir:string;files:BundleFile[];rejected:string|null}
  |{type:"progress";renderedFrames:number;encodedFrames:number;progress:number}
  |{type:"done"}
  |{type:"error";code:string;detail:string};
const send=(message:ChildMessage)=>new Promise<void>(done=>{if(!process.send||!process.connected)return done();process.send(message,undefined,{},()=>done());});

let cancel:(()=>void)|null=null,canceled=false;
async function prepareBundle(start:ChildStart,load:<T>(name:string)=>Promise<T>){
  const rejected=start.trustedBundle?await copyTrustedBundle(start.trustedBundle,start.workBundle):"no trusted build";
  if(rejected===null){await send({type:"bundle",result:"hit"});return;}
  rmSync(start.workBundle,{recursive:true,force:true});
  const {bundle}=await load<typeof import("@remotion/bundler")>("@remotion/bundler");
  await bundle({entryPoint:start.entry,outDir:start.workBundle,enableCaching:false,publicDir:join(dirname(start.workBundle),"empty-public"),
    webpackOverride:config=>({...config,resolve:{...config.resolve,alias:{...(config.resolve?.alias as Record<string,string>|undefined),"@":start.appRoot},modules:[join(start.appRoot,"node_modules"),"node_modules"]}})});
  const files=await manifestOf(start.workBundle);if(!files)throw new Error("bundle output has a linked or unreadable entry");
  // A new, uniquely named cache folder; the worker trusts it only through this file list.
  const dir=join(start.bundleRoot,`${start.bundleKey}_${randomBytes(6).toString("hex")}`);
  try{await storeBundle(start.workBundle,files,dir);await send({type:"bundle",result:"built",dir,files,rejected});}
  catch{rmSync(`${dir}.part`,{recursive:true,force:true});/* no cache this time; the attempt copy is still used */}
}
async function run(start:ChildStart){
  assertOwnedProps(start.props,start.fileBase);
  const require=createRequire(join(start.appRoot,"package.json"));
  const load=async<T>(name:string)=>await import(pathToFileURL(require.resolve(name)).href) as T;
  await send({type:"stage",stage:"bundle"});
  await prepareBundle(start,load);
  if(canceled)throw new Error("render got cancelled before the browser started");
  const {openBrowser,selectComposition,renderMedia,makeCancelSignal}=await load<typeof import("@remotion/renderer")>("@remotion/renderer");
  await send({type:"stage",stage:"browser"});
  const refuseDownload=()=>{throw new Error("RENDER_BROWSER_MISSING: download refused");};
  const chromiumOptions={flags:chromiumFlags(start.netLog)};
  // A launch that fails after the preflight (file removed, replaced or not runnable) is the missing-browser case.
  let browser:Awaited<ReturnType<typeof openBrowser>>;
  try{browser=await openBrowser("chrome",{browserExecutable:start.browserPath,chromeMode:"headless-shell",logLevel:"warn",chromiumOptions});}
  catch(error){throw new Error(`RENDER_BROWSER_MISSING: ${String((error as {message?:unknown})?.message??error).split(/\r?\n/)[0].slice(0,200)}`,{cause:error});}
  try{
    const common={serveUrl:start.workBundle,browserExecutable:start.browserPath,chromeMode:"headless-shell" as const,logLevel:"warn" as const,onBrowserDownload:refuseDownload,puppeteerInstance:browser,chromiumOptions,inputProps:start.props,timeoutInMilliseconds:60000};
    const composition=await selectComposition({...common,id:start.compositionId});
    if(canceled)throw new Error("render got cancelled before compose");
    await send({type:"stage",stage:"compose"});
    // a cancel that arrived while compose was starting is applied now
    const signal=makeCancelSignal();cancel=signal.cancel;if(canceled)signal.cancel();let last=0;
    await renderMedia({...common,composition,codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",muted:true,outputLocation:start.audio?start.audio.videoPath:start.output,overwrite:false,concurrency:1,licenseKey:null,cancelSignal:signal.cancelSignal,
      onProgress:({progress,renderedFrames,encodedFrames})=>{const now=Date.now();if(now-last<1000&&progress<1)return;last=now;void send({type:"progress",renderedFrames,encodedFrames,progress});}});
  }finally{cancel=null;await browser.close({silent:true}).catch(()=>{});}
  if(start.audio)await processSound(start.audio,start.output);
}
async function sha256File(path:string){const hash=createHash("sha256");let size=0;for await(const chunk of createReadStream(path)){hash.update(chunk as Buffer);size+=(chunk as Buffer).length;}return {sha256:hash.digest("hex"),sizeBytes:size};}
async function processSound(audio:AudioStart,output:string){
  if(canceled)throw new Error("render got cancelled before sound");
  await send({type:"stage",stage:"audio"});
  const controller=new AbortController();cancel=()=>controller.abort();if(canceled)controller.abort();
  try{
    const timeoutMs=Math.min(AUDIO_STEP_MAX_MS,audio.deadline-Date.now());
    if(timeoutMs<=0)throw Object.assign(new Error("sound step has no time left"),{name:"AudioError",code:"TIMEOUT",detail:null});
    const video={path:audio.videoPath,...await sha256File(audio.videoPath)};
    const {mixAudio}=await import("../lib/audio/mix");
    const result=await mixAudio({...audio.request,video,outputPath:output,workRoot:audio.workRoot},{signal:controller.signal,timeoutMs,tools:audio.tools});
    if(result.status==="no_audio")throw new Error("sound plan without sound clips");
    await send({type:"audio",result});
  }finally{cancel=null;}
}
// A sound processing failure keeps its own code (mapped once, lib/render/errors); detail never holds a path.
function failureOf(error:unknown){
  const audio=error as {name?:string;code?:unknown;detail?:unknown};
  if(audio?.name==="AudioError"&&typeof audio.code==="string")return {code:audioFailureCode(audio.code),detail:`${audio.code}${typeof audio.detail==="string"?` ${audio.detail}`:""}`.slice(0,300)};
  return classify(error);
}

// Only when started as the render child (forked by lib/render/run.ts with IPC and this flag), never on import.
if(process.send&&process.env.DREAM_RENDER_CHILD==="1"){
  installNetGuard();
  process.on("message",(message:ChildStart|{type:"cancel"})=>{
    if(message.type==="cancel"){canceled=true;cancel?.();return;}
    if(message.type!=="start")return;
    void run(message).then(async()=>{await send({type:"done"});},async error=>{const result=failureOf(error);await send({type:"error",...(canceled?{code:"RENDER_CANCELED",detail:result.detail}:result)});})
      .finally(()=>{if(process.connected)process.disconnect?.();setTimeout(()=>process.exit(0),200);});
  });
  // The worker went away (closed, crashed or killed): stop rendering, give the browser a moment to close, then end
  // this process together with everything it started (browser, compositor) so nothing outlives the worker.
  process.on("disconnect",()=>{canceled=true;cancel?.();setTimeout(killOwnTree,3000);});
}
export function killOwnTree(){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(process.pid),"/T","/F"],{windowsHide:true,timeout:15000});process.exit(0);}
