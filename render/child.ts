// P2-4b render child (T-101 2.3, T-108). Started by the worker with child_process.fork for one render attempt and
// talks to it only over IPC. It never opens the database: it gets the props (file server URLs), the pinned browser
// path and the output path. Order: bundle (reused per composition source hash) → openBrowser first (a missing or
// broken browser fails here, before any Remotion file server exists) → selectComposition → renderMedia → close.
// Node connections to anything but loopback are refused. If the worker goes away (IPC disconnect) the render is
// cancelled and the child ends.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderProps } from "../lib/render/props";

// netLog: optional Chrome network log file (evidence runs): every request and connection the browser made.
export type ChildStart={type:"start";appRoot:string;entry:string;bundleDir:string;sourceSha256:string;browserPath:string;output:string;props:RenderProps;compositionId:string;netLog:string|null};
// The browser reaches only loopback: names other than localhost fail to resolve, and anything not bypassed goes to a
// closed loopback proxy (so an IP address cannot slip past the resolver rule either).
export const chromiumFlags=(netLog:string|null):Record<string,string|boolean>=>({"host-resolver-rules":"MAP localhost 127.0.0.1 , MAP * ~NOTFOUND , EXCLUDE 127.0.0.1","proxy-server":"http://127.0.0.1:9","proxy-bypass-list":"<-loopback>;127.0.0.1;localhost",...(netLog?{"log-net-log":netLog,"net-log-capture-mode":"Default"}:{})});
export type ChildMessage=
  |{type:"stage";stage:"bundle"|"browser"|"compose"}
  |{type:"progress";renderedFrames:number;encodedFrames:number;progress:number}
  |{type:"done"}
  |{type:"error";code:string;detail:string};
const send=(message:ChildMessage)=>new Promise<void>(done=>{if(!process.send||!process.connected)return done();process.send(message,undefined,{},()=>done());});

const loopback=(host:unknown)=>host===undefined||host===null||host==="localhost"||host==="::1"||(typeof host==="string"&&/^127\./.test(host));
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){
  const first=args[0],options=(typeof first==="object"&&first!==null?first:{port:first,host:typeof args[1]==="string"?args[1]:undefined}) as {host?:unknown;path?:unknown};
  if(!options.path&&!loopback(options.host))throw new Error(`RENDER_NETWORK_REFUSED: ${String(options.host)}`);
  return (connect as (...values:unknown[])=>net.Socket).apply(this,args);
} as typeof net.Socket.prototype.connect;

// Error → code. Kept to the reasons the worker may act on; the detail is a short first line for its log only.
export function classify(error:unknown):{code:string;detail:string}{
  const message=String((error as {message?:unknown})?.message??error),first=message.split("\n")[0].slice(0,300),code=(error as {code?:unknown})?.code;
  if(/got cancelled|cancelled|canceled/i.test(message))return {code:"RENDER_CANCELED",detail:first};
  const font=/FONT_MISSING:([^\n]*)/.exec(message);if(font)return {code:"FONT_MISSING",detail:font[1].slice(0,80)};
  if(code==="ENOSPC"||/ENOSPC|no space left/i.test(message))return {code:"DISK_FULL",detail:first};
  if(/RENDER_BROWSER_MISSING/.test(message))return {code:"RENDER_BROWSER_MISSING",detail:first};
  if(/RENDER_NETWORK_REFUSED/.test(message))return {code:"RENDER_FAILED",detail:first};
  if(/Compositor (exited|quit)|Target closed|Browser (closed|has disconnected)|crash|Protocol error|Session closed|ECONNRESET|socket hang up|Navigation failed because browser has disconnected/i.test(message))return {code:"RENDER_BROWSER_CRASHED",detail:first};
  if(code==="EBUSY"||code==="EAGAIN")return {code:"STORAGE_FAILED",detail:first};
  return {code:"RENDER_FAILED",detail:first};
}

let cancel:(()=>void)|null=null,canceled=false;
async function run(start:ChildStart){
  const require=createRequire(join(start.appRoot,"package.json"));
  const load=async<T>(name:string)=>await import(pathToFileURL(require.resolve(name)).href) as T;
  await send({type:"stage",stage:"bundle"});
  if(!existsSync(join(start.bundleDir,"index.html"))){
    const {bundle}=await load<typeof import("@remotion/bundler")>("@remotion/bundler");
    const part=`${start.bundleDir}.part-${process.pid}`;rmSync(part,{recursive:true,force:true});mkdirSync(dirname(part),{recursive:true});
    await bundle({entryPoint:start.entry,outDir:part,enableCaching:false,publicDir:join(part,"..","empty-public"),
      webpackOverride:config=>({...config,resolve:{...config.resolve,alias:{...(config.resolve?.alias as Record<string,string>|undefined),"@":start.appRoot},modules:[join(start.appRoot,"node_modules"),"node_modules"]}})});
    writeFileSync(join(part,"render-source.json"),JSON.stringify({sourceSha256:start.sourceSha256}));
    try{renameSync(part,start.bundleDir);}catch{rmSync(part,{recursive:true,force:true});if(!existsSync(join(start.bundleDir,"index.html")))throw new Error("bundle folder could not be placed");}
  }
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
    const common={serveUrl:start.bundleDir,browserExecutable:start.browserPath,chromeMode:"headless-shell" as const,logLevel:"warn" as const,onBrowserDownload:refuseDownload,puppeteerInstance:browser,chromiumOptions,inputProps:start.props,timeoutInMilliseconds:60000};
    const composition=await selectComposition({...common,id:start.compositionId});
    if(canceled)throw new Error("render got cancelled before compose");
    await send({type:"stage",stage:"compose"});
    // a cancel that arrived while compose was starting is applied now
    const signal=makeCancelSignal();cancel=signal.cancel;if(canceled)signal.cancel();let last=0;
    await renderMedia({...common,composition,codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",muted:true,outputLocation:start.output,overwrite:false,concurrency:1,licenseKey:null,cancelSignal:signal.cancelSignal,
      onProgress:({progress,renderedFrames,encodedFrames})=>{const now=Date.now();if(now-last<1000&&progress<1)return;last=now;void send({type:"progress",renderedFrames,encodedFrames,progress});}});
  }finally{cancel=null;await browser.close({silent:true}).catch(()=>{});}
}

process.on("message",(message:ChildStart|{type:"cancel"})=>{
  if(message.type==="cancel"){canceled=true;cancel?.();return;}
  if(message.type!=="start")return;
  void run(message).then(async()=>{await send({type:"done"});},async error=>{const result=classify(error);await send({type:"error",...(canceled?{code:"RENDER_CANCELED",detail:result.detail}:result)});})
    .finally(()=>{if(process.connected)process.disconnect?.();setTimeout(()=>process.exit(0),200);});
});
// The worker went away (closed, crashed or killed): stop rendering, give the browser a moment to close, then end
// this process together with everything it started (browser, compositor) so nothing outlives the worker.
export function killOwnTree(){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(process.pid),"/T","/F"],{windowsHide:true,timeout:15000});process.exit(0);}
process.on("disconnect",()=>{canceled=true;cancel?.();setTimeout(killOwnTree,3000);});
