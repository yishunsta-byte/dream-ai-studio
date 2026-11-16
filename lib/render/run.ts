import "server-only";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChildMessage, ChildStart } from "@/render/child";
import type { RenderProps } from "./props";

// P2-4b one render attempt in an owned child process (T-101 2.3, T-113 F113-1). Everything Remotion starts (bundler,
// browser, its file and frame servers, the compositor) lives inside this child, so whatever a failed launch or a
// crash leaves open ends with it. The parent never trusts the child to clean up:
// - cancel: IPC "cancel", then if the child has not exited in 10 s its whole tree is killed (taskkill /T /F);
// - time limit / caller abort: the same as cancel;
// - the child ends in any way: its own descendants that are still alive are found by parent chain (created after the
//   child started, so a reused pid is not touched) and killed;
// - the worker dies: the child sees the IPC disconnect and cancels itself (child.ts).
// - temp files: the child's TEMP/TMP/TMPDIR point at `tempDir` (inside the attempt's work folder), so the browser
//   profile and Remotion's frame folders are removed with that folder even when the tree was killed.
const run=promisify(execFile);
export const CANCEL_GRACE_MS=10000;
export type AttemptResult={ok:true}|{ok:false;code:string;detail:string;signal:string|null;exitCode:number|null};
export type AttemptOptions={appRoot:string;bundleDir:string;sourceSha256:string;browserPath:string;output:string;props:RenderProps;compositionId:string;netLog?:string|null;
  onStage?:(stage:"bundle"|"browser"|"compose")=>void;onProgress?:(value:{renderedFrames:number;encodedFrames:number;progress:number})=>void;
  shouldCancel?:()=>"cancel"|"timeout"|null;pollMs?:number;graceMs?:number;onChild?:(pid:number)=>void;tempDir?:string};

type Proc={pid:number;parent:number;created:number};
async function processTable():Promise<Proc[]>{
  if(process.platform!=="win32")return [];
  const script="Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')})\" }";
  const {stdout}=await run("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  return String(stdout).split(/\r?\n/).filter(Boolean).map(line=>{const [pid,parent,created]=line.split("\t");return {pid:Number(pid),parent:Number(parent),created:Date.parse(created)};}).filter(row=>Number.isSafeInteger(row.pid));
}
// Descendants of `root` (started at `since` or later), alive now.
export async function descendants(root:number,since:number):Promise<number[]>{
  const table=await processTable(),found:number[]=[],queue=[root];
  while(queue.length){const parent=queue.pop()!;for(const row of table)if(row.parent===parent&&row.pid!==root&&!found.includes(row.pid)&&Number.isFinite(row.created)&&row.created>=since-1000){found.push(row.pid);queue.push(row.pid);}}
  return found;
}
export async function killTree(pid:number){if(process.platform!=="win32"){try{process.kill(pid,"SIGKILL");}catch{/* gone */}return;}await run("taskkill",["/PID",String(pid),"/T","/F"],{windowsHide:true,timeout:30000}).catch(()=>{});}

export async function runRenderAttempt(options:AttemptOptions):Promise<AttemptResult>{
  const script=join(options.appRoot,"render","child.ts");if(!existsSync(/*turbopackIgnore: true*/script))return {ok:false,code:"RENDER_FAILED",detail:"render child missing",signal:null,exitCode:null};
  const started=Date.now();
  const child:ChildProcess=fork(script,[],{cwd:options.appRoot,execArgv:["--import","tsx"],stdio:["ignore","pipe","pipe","ipc"],windowsHide:true,serialization:"json",
    env:options.tempDir?{...process.env,TEMP:options.tempDir,TMP:options.tempDir,TMPDIR:options.tempDir}:process.env});
  options.onChild?.(child.pid!);
  let tail="";const keep=(chunk:Buffer)=>{tail=(tail+chunk.toString("utf8")).slice(-4000);};child.stdout?.on("data",keep);child.stderr?.on("data",keep);
  let result:{code:string;detail:string}|null=null,done=false,stop:"cancel"|"timeout"|null=null,forced=false;
  child.on("message",(message:ChildMessage)=>{
    if(message.type==="stage")options.onStage?.(message.stage);
    else if(message.type==="progress")options.onProgress?.({renderedFrames:message.renderedFrames,encodedFrames:message.encodedFrames,progress:message.progress});
    else if(message.type==="done")done=true;
    else if(message.type==="error")result={code:message.code,detail:message.detail};
  });
  const exited=new Promise<{code:number|null;signal:string|null}>(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));
  const start:ChildStart={type:"start",appRoot:options.appRoot,entry:join(options.appRoot,"render","entry.tsx"),bundleDir:options.bundleDir,sourceSha256:options.sourceSha256,browserPath:options.browserPath,output:options.output,props:options.props,compositionId:options.compositionId,netLog:options.netLog??null};
  child.send(start);
  // Cancel / time limit: ask once, then kill the tree after the grace period.
  let deadline:number|null=null;
  const watcher=setInterval(()=>{
    if(!stop){const want=options.shouldCancel?.()??null;if(want){stop=want;deadline=Date.now()+(options.graceMs??CANCEL_GRACE_MS);if(child.connected)child.send({type:"cancel"});}}
    else if(deadline!==null&&Date.now()>deadline&&!forced){forced=true;void killTree(child.pid!);}
  },options.pollMs??250);
  const exit=await exited;clearInterval(watcher);
  // Whatever the child left (a browser it could not close, a stuck compositor) ends now.
  for(const pid of await descendants(child.pid!,started).catch(()=>[] as number[]))await killTree(pid);
  if(stop)return {ok:false,code:stop==="timeout"?"TIMEOUT":"RENDER_CANCELED",detail:forced?"child tree killed after grace period":"child stopped",signal:exit.signal,exitCode:exit.code};
  // (set inside the message handler; read through a cast because TypeScript narrows the closure variable to null)
  const reported=result as {code:string;detail:string}|null;
  if(done&&!reported)return {ok:true};
  if(reported)return {ok:false,code:reported.code,detail:reported.detail,signal:exit.signal,exitCode:exit.code};
  // No result: the child died (signal, crash, killed from outside).
  return {ok:false,code:"RENDER_BROWSER_CRASHED",detail:`child ended without a result (${exit.signal??exit.code}) ${tail.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0,200)??""}`,signal:exit.signal,exitCode:exit.code};
}
