// T-108 toolchain smoke check (not product code). Builds a tiny composition in a new OS temp folder, bundles it with
// @remotion/bundler, renders 9:16, 16:9 and 1:1 clips with the pinned headless shell, checks each file with the app's
// own ffprobe, then checks cancel cleanup and the missing-browser error. Rules it holds: browserExecutable is always
// explicit (the renderer never downloads a browser), licenseKey null (no usage event), concurrency 1, muted (no
// audio track). Node-level connections to anything but loopback are refused and recorded; browser/compositor TCP
// connections are sampled from Windows while rendering. Nothing under data/, storage/ or backups/ is read.
// Usage: node scripts/remotion/smoke.mjs [--out <folder for result.json>]
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const pin=JSON.parse(readFileSync(join(app,"scripts/remotion/browser-pin.json"),"utf8"));
const browser=join(app,pin.installDir,pin.executable.path);
const ffprobe=join(app,".tools/ffmpeg/ffprobe.exe");
const outArg=process.argv.indexOf("--out"),outDir=outArg>0?resolve(process.argv[outArg+1]):null;
const result={startedAt:new Date().toISOString(),node:process.version,versions:{},browser:{version:pin.version},renders:[],cancel:null,missingBrowser:null,network:{node:[],browser:[]},autoDownload:{called:false,remotionCacheBefore:false,remotionCacheAfter:false},processesLeft:[],ok:false};
const t0=Date.now(),log=(stage)=>process.stderr.write(`[smoke +${((Date.now()-t0)/1000).toFixed(1)}s] ${stage} [open servers ${process.getActiveResourcesInfo().filter(name=>name==="TCPServerWrap").length}]\n`);
const openServers=()=>process.getActiveResourcesInfo().filter(name=>name==="TCPServerWrap").length;
// The check the render worker runs before any Remotion call: a missing or different browser stops here, with nothing
// started. (Remotion 4.0.543 selectComposition() starts its file server alongside the browser; when the browser
// launch fails first, that server is never closed and keeps the process alive — found by this smoke, so the worker
// never lets Remotion meet a missing browser.)
const browserCheck=(path)=>!existsSync(path)?"RENDER_BROWSER_MISSING":sha256(path)!==pin.executable.sha256?"RENDER_BROWSER_MISMATCH":null;
const sha256=(file)=>createHash("sha256").update(readFileSync(file)).digest("hex");
const rel=(path)=>path.startsWith(app)?path.slice(app.length+1).replaceAll("\\","/"):path.startsWith(tmpdir())?"<os-temp>"+path.slice(tmpdir().length).replaceAll("\\","/"):"<other>";

// Node-level guard: any connection to a non-loopback host from this process is refused and recorded.
const loopback=(host)=>!host||host==="localhost"||host==="::1"||/^127\./.test(host)||host==="0.0.0.0";
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const options=typeof args[0]==="object"&&args[0]!==null?args[0]:{port:args[0],host:typeof args[1]==="string"?args[1]:undefined};const host=options.host??options.path;
  if(!options.path&&!loopback(host)){result.network.node.push({host:String(host),port:options.port??null});throw new Error(`T-108 network guard: refused ${host}`);}
  return originalConnect.apply(this,args);};

function processesUnder(){
  const script="Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -like '*\\remotion-browser\\*' -or $_.ExecutablePath -like '*compositor-win32-x64-msvc*') } | ForEach-Object { \"$($_.ProcessId)`t$($_.Name)\" }";
  return execFileSync("powershell.exe",["-NoProfile","-Command",script],{encoding:"utf8",windowsHide:true}).split(/\r?\n/).filter(Boolean);
}
// Samples TCP connections owned by the pinned browser / compositor processes; anything not loopback is recorded.
function startConnectionMonitor(file){
  const script=`$ErrorActionPreference='SilentlyContinue'; while($true){ $ids=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -like '*\\remotion-browser\\*' -or $_.ExecutablePath -like '*compositor-win32-x64-msvc*') } | ForEach-Object { $_.ProcessId }); if($ids.Count){ Get-NetTCPConnection | Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notmatch '^(127\\.|::1$|0\\.0\\.0\\.0$|::$)' } | ForEach-Object { Add-Content -LiteralPath '${file}' -Value ("{0}\`t{1}\`t{2}\`t{3}" -f $_.OwningProcess,$_.RemoteAddress,$_.RemotePort,$_.State) }; Add-Content -LiteralPath '${file}' -Value ("sample\`t" + $ids.Count) }; Start-Sleep -Milliseconds 400 }`;
  return spawn("powershell.exe",["-NoProfile","-Command",script],{windowsHide:true,stdio:"ignore"});
}
function probe(file){
  const raw=JSON.parse(execFileSync(ffprobe,["-v","error","-count_frames","-show_streams","-show_format","-of","json",file],{encoding:"utf8",windowsHide:true,timeout:60000}));
  const video=raw.streams.filter(s=>s.codec_type==="video"),audio=raw.streams.filter(s=>s.codec_type==="audio"),other=raw.streams.length-video.length-audio.length;
  const v=video[0]??{};
  return {videoStreams:video.length,codec:v.codec_name,pixFmt:v.pix_fmt,width:v.width,height:v.height,colorRange:v.color_range,colorSpace:v.color_space,colorPrimaries:v.color_primaries,colorTransfer:v.color_transfer,rFrameRate:v.r_frame_rate,avgFrameRate:v.avg_frame_rate,frames:Number(v.nb_read_frames),durationSec:Number(raw.format.duration),audioStreams:audio.length,otherStreams:other};
}

const work=mkdtempSync(join(tmpdir(),"dream-t108-smoke-"));
const monitorFile=join(work,"connections.tsv");
let monitor=null;
try{
  const preflight=browserCheck(browser);
  if(preflight==="RENDER_BROWSER_MISSING")throw new Error("RENDER_BROWSER_MISSING: 고정 브라우저가 없어요. scripts/remotion/install-browser.ps1로 설치해 주세요.");
  if(preflight==="RENDER_BROWSER_MISMATCH")throw new Error("RENDER_BROWSER_MISMATCH: 설치된 브라우저가 고정 버전과 달라요. scripts/remotion/install-browser.ps1로 다시 확인해 주세요.");
  if(!existsSync(ffprobe))throw new Error("ffprobe가 없어요. scripts/install-media.ps1을 먼저 실행해 주세요.");
  const remotionCache=join(app,"node_modules/.remotion");result.autoDownload.remotionCacheBefore=existsSync(remotionCache);
  const require=createRequire(join(app,"package.json"));
  for(const name of ["remotion","@remotion/renderer","@remotion/bundler","@remotion/compositor-win32-x64-msvc"])result.versions[name]=require(`${name}/package.json`).version;
  const {bundle}=await import(pathToFileURL(require.resolve("@remotion/bundler")).href);
  const {selectComposition,renderMedia,makeCancelSignal,openBrowser}=await import(pathToFileURL(require.resolve("@remotion/renderer")).href);

  // A minimal composition, written only into the temp folder (no app component is reused here).
  const src=join(work,"src");mkdirSync(src);mkdirSync(join(work,"public"));
  writeFileSync(join(src,"index.jsx"),`import React from "react";
import {AbsoluteFill,Composition,interpolate,registerRoot,useCurrentFrame} from "remotion";
const Smoke=({label})=>{const frame=useCurrentFrame();return <AbsoluteFill style={{backgroundColor:"#1e3a5f",justifyContent:"center",alignItems:"center"}}><div style={{color:"#ffffff",fontSize:72,fontFamily:"sans-serif",opacity:interpolate(frame,[0,15],[0,1],{extrapolateRight:"clamp"})}}>{label} {frame}</div></AbsoluteFill>;};
const Fail=()=>{const frame=useCurrentFrame();if(frame>=10)throw new Error("T-108 planned failure");return <AbsoluteFill style={{backgroundColor:"#000000"}}/>;};
const SIZES=[["Smoke916",1080,1920,45],["Smoke169",1920,1080,45],["Smoke11",1080,1080,45],["SmokeLong",1080,1920,900]];
const Root=()=> <>{SIZES.map(([id,width,height,frames])=><Composition key={id} id={id} component={Smoke} width={width} height={height} fps={30} durationInFrames={frames} defaultProps={{label:id}}/>)}<Composition id="SmokeFail" component={Fail} width={1080} height={1920} fps={30} durationInFrames={45}/></>;
registerRoot(Root);
`);
  log("bundle start");const bundleStart=Date.now();let bundleStep=-1;
  const serveUrl=await bundle({entryPoint:join(src,"index.jsx"),outDir:join(work,"bundle"),publicDir:join(work,"public"),enableCaching:false,onProgress:(step)=>{if(step>=bundleStep+20||step===100){bundleStep=step;log(`bundle ${step}%`);}},
    webpackOverride:(config)=>({...config,resolve:{...config.resolve,modules:[join(app,"node_modules"),"node_modules"]}})});
  result.bundleSeconds=(Date.now()-bundleStart)/1000;log("bundle done");
  monitor=startConnectionMonitor(monitorFile);
  const common={serveUrl,browserExecutable:browser,chromeMode:"headless-shell",logLevel:"warn",onBrowserDownload:()=>{result.autoDownload.called=true;throw new Error("T-108: browser download refused");}};
  for(const [id,width,height] of [["Smoke916",1080,1920],["Smoke169",1920,1080],["Smoke11",1080,1080]]){
    log(`select ${id}`);const composition=await selectComposition({...common,id,inputProps:{label:id}});log(`render ${id}`);
    const output=join(work,`${id}.mp4`),start=Date.now();let last=0;
    await renderMedia({...common,composition,inputProps:{label:id},codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",muted:true,outputLocation:output,concurrency:1,licenseKey:null,overwrite:false,onProgress:({progress})=>{last=progress;}});
    log(`probe ${id}`);const checked=probe(output),expectedFrames=composition.durationInFrames;
    const pass=checked.videoStreams===1&&checked.codec==="h264"&&checked.pixFmt==="yuv420p"&&checked.colorRange==="tv"&&checked.colorSpace==="bt709"&&checked.width===width&&checked.height===height&&checked.rFrameRate==="30/1"&&checked.avgFrameRate==="30/1"&&checked.frames===expectedFrames&&Math.abs(checked.durationSec-expectedFrames/30)<=1/30&&checked.audioStreams===0&&checked.otherStreams===0;
    result.renders.push({id,expected:{width,height,fps:30,frames:expectedFrames,audioStreams:0},probe:checked,pass,sha256:sha256(output),sizeBytes:statSync(output).size,seconds:(Date.now()-start)/1000,lastProgress:last,leftovers:readdirSync(work).filter(name=>name.includes("remotion-in-progress"))});
  }
  log("cancel check");
  // Cancel: a 900-frame render is cancelled once it has started; the child processes must be gone afterwards.
  {
    const composition=await selectComposition({...common,id:"SmokeLong",inputProps:{label:"SmokeLong"}});
    const output=join(work,"SmokeLong.mp4"),{cancelSignal,cancel}=makeCancelSignal();let progressAtCancel=null,during=[];
    const started=Date.now();
    const error=await renderMedia({...common,composition,inputProps:{label:"SmokeLong"},codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",muted:true,outputLocation:output,concurrency:1,licenseKey:null,overwrite:false,cancelSignal,
      onProgress:({progress})=>{if(progressAtCancel===null&&progress>=0.05){progressAtCancel=progress;during=processesUnder();cancel();}}}).then(()=>null,(caught)=>caught);
    const settledSeconds=(Date.now()-started)/1000;await delay(1500);
    result.cancel={errorMessage:error?String(error.message).split("\n")[0]:null,progressAtCancel,processesDuring:during.length,processesAfter:processesUnder(),serversOpenAfter:openServers(),outputExists:existsSync(output),leftovers:readdirSync(work).filter(name=>name.startsWith("SmokeLong")),settledSeconds};
  }
  log("failure check");
  // Failure: the composition throws at frame 10; the render rejects and leaves no process, server or output behind.
  {
    const composition=await selectComposition({...common,id:"SmokeFail",inputProps:{}});
    const output=join(work,"SmokeFail.mp4");
    const error=await renderMedia({...common,composition,inputProps:{},codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",muted:true,outputLocation:output,concurrency:1,licenseKey:null,overwrite:false}).then(()=>null,(caught)=>caught);
    await delay(1500);
    result.failure={errorMessage:error?String(error.message).split("\n")[0]:null,processesAfter:processesUnder(),serversOpenAfter:openServers(),outputExists:existsSync(output),leftovers:readdirSync(work).filter(name=>name.startsWith("SmokeFail"))};
  }
  log("missing-browser check");
  // Missing browser: the worker's own check names it first; Remotion's launch with that explicit path (openBrowser,
  // which starts no file server) also fails at once. Nothing is downloaded and no server is left open.
  {
    const missing=join(work,"no-browser","chrome-headless-shell.exe"),serversBefore=openServers();
    const error=await openBrowser("chrome",{browserExecutable:missing,chromeMode:"headless-shell",logLevel:"warn",onBrowserDownload:common.onBrowserDownload}).then(async(opened)=>{await opened.close?.({silent:true});return null;},(caught)=>caught);
    await delay(500);
    result.missingBrowser={precheck:browserCheck(missing),errorMessage:error?String(error.message).split("\n")[0].replace(missing,"<missing path>"):null,downloadCalled:result.autoDownload.called,processesAfter:processesUnder(),serversLeftOpen:openServers()-serversBefore};
  }
  result.autoDownload.remotionCacheAfter=existsSync(remotionCache);
}catch(error){result.error=String(error?.message??error).split("\n")[0];}
finally{
  log("finish");
  if(monitor){monitor.kill();await delay(300);}
  const lines=existsSync(monitorFile)?readFileSync(monitorFile,"utf8").split(/\r?\n/).filter(Boolean):[];
  result.network.browser=lines.filter(line=>!line.startsWith("sample"));result.network.browserSamples=lines.filter(line=>line.startsWith("sample")).length;
  await delay(500);result.processesLeft=processesUnder();result.openServersAtEnd=openServers();
  result.ok=!result.error&&result.renders.length===3&&result.renders.every(r=>r.pass&&!r.leftovers.length)&&!!result.cancel&&/cancel/i.test(result.cancel.errorMessage??"")&&!result.cancel.processesAfter.length&&result.cancel.serversOpenAfter===0&&!result.cancel.outputExists&&!result.cancel.leftovers.length&&!!result.failure&&/planned failure/.test(result.failure.errorMessage??"")&&!result.failure.processesAfter.length&&result.failure.serversOpenAfter===0&&!result.failure.outputExists&&!result.failure.leftovers.length&&!!result.missingBrowser?.errorMessage&&result.missingBrowser.precheck==="RENDER_BROWSER_MISSING"&&result.missingBrowser.serversLeftOpen===0&&!result.missingBrowser.processesAfter.length&&result.openServersAtEnd===0&&!result.autoDownload.called&&!result.autoDownload.remotionCacheAfter&&!result.network.node.length&&!result.network.browser.length&&!result.processesLeft.length;
  result.workFolder=rel(work);result.finishedAt=new Date().toISOString();
  rmSync(work,{recursive:true,force:true,maxRetries:5,retryDelay:200});result.workFolderRemoved=!existsSync(work);
  const text=JSON.stringify(result,null,2);
  if(outDir){mkdirSync(outDir,{recursive:true});writeFileSync(join(outDir,"smoke-result.json"),text);}
  console.log(text);
  process.exitCode=result.ok?0:1;
  log("handles at end: "+process.getActiveResourcesInfo().join(","));
}
