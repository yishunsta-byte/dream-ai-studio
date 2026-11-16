import { spawn } from "node:child_process";

// Owned FFmpeg/ffprobe runs for P2-5B. Arguments are an array (no shell); stdout can be streamed to a callback;
// stderr is kept up to a bound. A run ends on exit, on the caller's AbortSignal (CANCELED) or on its own timeout
// (TIMEOUT); in both cases the child is killed and awaited before the promise settles, so no process outlives it.
export type AudioErrorCode="INVALID_INPUT"|"SOURCE_UNSUPPORTED"|"SOURCE_TOO_SHORT"|"SOURCE_CHANGED"|"STATS_MISMATCH"|"LOUDNESS_UNMEASURABLE"|"LOUDNESS_OUT_OF_RANGE"|"OUTPUT_INVALID"|"OUTPUT_EXISTS"|"DISK_FULL"|"CANCELED"|"TIMEOUT"|"TOOL_FAILED";
export class AudioError extends Error{constructor(readonly code:AudioErrorCode,message:string,readonly detail:string|null=null){super(message);this.name="AudioError";}}
const STDERR_LIMIT=1024*1024;
const DISK_FULL=/No space left on device|ENOSPC|disk quota exceeded/i;
export type ToolRun={stderr:string;pids:number[]};
export type RunOptions={signal?:AbortSignal;deadline?:number;onStdout?:(chunk:Buffer)=>void;onPid?:(pid:number)=>void};
export type ToolRunner=(binary:string,args:readonly string[],options:RunOptions)=>Promise<ToolRun>;
export const runTool:ToolRunner=(binary,args,options)=>new Promise((resolve,reject)=>{
  if(options.signal?.aborted)return reject(new AudioError("CANCELED","소리 처리를 취소했어요."));
  const left=options.deadline===undefined?null:options.deadline-Date.now();
  if(left!==null&&left<=0)return reject(new AudioError("TIMEOUT","소리 처리 시간이 너무 오래 걸려 멈췄어요."));
  const child=spawn(binary,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});let stderr="",ended:AudioError|null=null;
  if(child.pid)options.onPid?.(child.pid);
  const stop=(error:AudioError)=>{if(ended)return;ended=error;child.kill("SIGKILL");};
  const onAbort=()=>stop(new AudioError("CANCELED","소리 처리를 취소했어요."));options.signal?.addEventListener("abort",onAbort,{once:true});
  const timer=left===null?null:setTimeout(()=>stop(new AudioError("TIMEOUT","소리 처리 시간이 너무 오래 걸려 멈췄어요.")),left);
  child.stdout.on("data",(chunk:Buffer)=>{if(!ended){try{options.onStdout?.(chunk);}catch(error){stop(error instanceof AudioError?error:new AudioError("TOOL_FAILED","소리 처리 결과를 읽지 못했어요.",String(error)));}}});
  child.stderr.on("data",chunk=>{if(stderr.length<STDERR_LIMIT)stderr+=String(chunk);});
  child.on("error",error=>{stop(new AudioError("TOOL_FAILED","소리 처리 도구를 실행하지 못했어요.",(error as NodeJS.ErrnoException).code??null));});
  child.on("close",code=>{
    if(timer)clearTimeout(timer);options.signal?.removeEventListener("abort",onAbort);
    if(ended)return reject(ended);
    if(code===0)return resolve({stderr,pids:child.pid?[child.pid]:[]});
    if(DISK_FULL.test(stderr))return reject(new AudioError("DISK_FULL","저장 공간이 부족해 소리를 처리하지 못했어요."));
    reject(new AudioError("TOOL_FAILED","소리 처리 도구가 실패했어요.",lastLines(stderr)));
  });
});
// The last lines of a tool's error text, with paths removed (for logs; never shown as a file path).
export function lastLines(text:string){return text.trim().split(/\r?\n/).slice(-3).join(" | ").replace(/[A-Za-z]:[\\/][^\s'"]*/g,"<path>").replace(/\/[^\s'"]*\/[^\s'"]*/g,"<path>").slice(0,300);}
// fs errors: no space → DISK_FULL; anything else stays a tool failure with its errno (no path).
export function fsFailure(error:unknown):AudioError{
  if(error instanceof AudioError)return error;const code=(error as NodeJS.ErrnoException)?.code;
  if(code==="ENOSPC"||code==="EDQUOT")return new AudioError("DISK_FULL","저장 공간이 부족해 소리를 처리하지 못했어요.",code);
  return new AudioError("TOOL_FAILED","소리 작업 파일을 쓰지 못했어요.",code??null);
}
