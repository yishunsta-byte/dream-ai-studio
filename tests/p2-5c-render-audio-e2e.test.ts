// T-137 P2-5C real renders with sound through the worker path on a copy of the fixed s5 backup (virtual data, OS temp
// folder): request → runNextJob → owned child (Remotion muted render → lib/audio mix + AAC + mux in the same child) →
// app ffprobe + the worker's own sound checks → publish → download route. Runs only with DREAM_RENDER_E2E=1 and the
// pinned browser. Each render is 30 s (the s5 disclosure is fixed to 0–900 frames). Sound files are synthetic
// (FFmpeg lavfi), written into the copy's library; nothing is listened to (measurements only).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import type { DatabaseHandle } from "@/lib/db/connection";
import { checkRenderRows, renderFileReferences } from "@/lib/db/render-data";
import { runNextJob } from "@/lib/jobs/runner";
import { descendants } from "@/lib/render/run";
import { checkBrowser } from "@/lib/render/tools";
import type { RenderAudioRecord, VerifyResult } from "@/lib/render/verify";
import { mediaBinary } from "@/lib/media/tools";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository } from "@/lib/repo/renders";
import { jobsService } from "@/lib/services/jobs";
import { rendersService } from "@/lib/services/renders";
import { GET as fileRoute } from "@/app/api/renders/[id]/file/route";
import { addSound, clip, P, s5Copy, saveTimeline } from "./p2-5c-helpers";

const enabled=process.env.DREAM_RENDER_E2E==="1";
let root:string,handle:DatabaseHandle,storage:string;const started=Date.now();
const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
const walk=(dir:string):string[]=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]):[];
const inventory=()=>new Map(walk(storage).filter(file=>!relative(storage,file).replaceAll("\\","/").startsWith("tmp/")).map(file=>[relative(storage,file).replaceAll("\\","/"),sha(file)]));
const tmpRenders=()=>existsSync(join(storage,"tmp"))?readdirSync(join(storage,"tmp")).filter(name=>name.startsWith("render-")):[];
const project=()=>jobsRepository(handle).project(P)!;
const body=()=>({revision:project().contentRevision,timelineId:project().currentTimelineRevId!});
const row=(id:string)=>rendersRepository(handle).row(id)!;
const verifyOf=(id:string)=>JSON.parse(row(id).verifyJson!) as VerifyResult&{audio?:RenderAudioRecord};
async function renderOnce(expectStatus="succeeded"){const {renderId,jobId}=await rendersService(handle).request(P,body());await runNextJob(handle);
  expect(row(renderId).status,JSON.stringify({...row(renderId),inputJson:undefined})).toBe(expectStatus);return {renderId,jobId};}
// Render-related processes (render child, browser, compositor, FFmpeg/ffprobe) started by this test process, still alive.
async function leftovers(){
  if(process.platform!=="win32")return [];
  const tree=new Set(await descendants(process.pid,started));
  const out=execFileSync("powershell.exe",["-NoProfile","-Command","Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome-headless-shell.exe','remotion.exe','ffmpeg.exe','ffprobe.exe') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*child.ts*') } | ForEach-Object { \"$($_.ProcessId) $($_.Name)\" }"],{encoding:"utf8",windowsHide:true});
  return out.split(/\r?\n/).filter(Boolean).map(line=>line.split(" ")).filter(([pid])=>tree.has(Number(pid))).map(([,name])=>name);
}
const until=async(test:()=>boolean,ms=180000)=>{const end=Date.now()+ms;while(!test()){if(Date.now()>end)throw new Error("timed out");await new Promise(resolve=>setTimeout(resolve,100));}};
// Decoded PCM (f32) of a file's first audio stream: one channel (left) at 48 kHz.
function pcm(file:string){const bytes=execFileSync(mediaBinary("ffmpeg"),["-v","error","-nostdin","-i",file,"-map","0:a:0","-af","pan=mono|c0=c0","-ar","48000","-f","f32le","-"],{maxBuffer:1024*1024*1024,windowsHide:true});
  return new Float32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.length/4));}
// The lag (in samples) at which `source` best matches `output` around `expected` (normalized cross-correlation).
function bestLag(output:Float32Array,source:Float32Array,from:number,length:number,expected:number,radius:number){
  let best={lag:Number.NaN,score:-Infinity};
  for(let lag=expected-radius;lag<=expected+radius;lag++){let dot=0,a=0,b=0;
    for(let i=from;i<from+length;i++){const x=output[i],y=source[i-lag];dot+=x*y;a+=x*x;b+=y*y;}
    const score=dot/Math.sqrt(a*b||1);if(score>best.score)best={lag,score};}
  return best;
}

describe.skipIf(!enabled)("실제 렌더 + 소리 e2e (가상 s5)",()=>{
  let music:{id:string;file:string},voice:{id:string;file:string},before:Map<string,string>;
  beforeAll(async()=>{
    expect((await checkBrowser({fresh:true})).ok).toBe(true);
    root=await realpath(await mkdtemp(join(tmpdir(),"dream-t137-e2e-")));vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));
    ({handle,storage}=await s5Copy(join(root,"s5")));
    music=addSound(handle,storage,"음악(잡음)","anoisesrc=d=30:c=pink:r=48000:a=0.3:seed=11");
    voice=addSound(handle,storage,"목소리","aevalsrc=0.3*sin(2*PI*300*t)*lt(mod(t\\,1)\\,0.6):s=44100:d=12","wav",["-ac","1"]);
    before=inventory();
  },180000);
  afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});
  beforeEach(()=>{const active=rendersRepository(handle).active(P);if(active)jobsService(handle).cancel(active.jobId);});

  let first:{renderId:string;jobId:string};
  it("음악+목소리(덮킹) 9:16: 성공·AAC 1개·디코드 샘플 정확·최종 -14±1·TP≤-1·영상 패킷 그대로, 정렬 지연 0(상관), 받기 바이트=행 sha",async()=>{
    saveTimeline(handle,{audio:[clip(music.id,{startFrame:30,sourceInFrame:15,durationFrames:840,duckUnderVoice:true}),clip(voice.id,{role:"voice",startFrame:400,durationFrames:300,fadeInFrames:3,fadeOutFrames:3})]});
    first=await renderOnce();const value=row(first.renderId),verify=verifyOf(first.renderId),file=join(storage,value.filePath!);
    expect(verify.result,JSON.stringify(verify.items.filter(item=>!item.pass))).toBe("passed");
    const items=Object.fromEntries(verify.items.map(item=>[item.item,item]));
    expect(items.audioStreams).toMatchObject({expected:1,actual:1});expect(items.audioCodec.actual).toBe("aac");expect(items.audioProfile.actual).toBe("LC");
    expect(items.audioDecodedSamples).toMatchObject({expected:900*1600,actual:900*1600,pass:true});expect(items.videoStreamSha256.pass).toBe(true);expect(items.frames).toMatchObject({actual:900,pass:true});
    const audio=verify.audio!;expect(audio).toMatchObject({mode:"aac",profile:"p2-5-local-v1",status:"normalized",accepted:true});
    expect(Math.abs(audio.final.integrated!+14)).toBeLessThanOrEqual(1);expect(audio.final.truePeak!).toBeLessThanOrEqual(-1);expect(audio.childFinal.integrated).not.toBeNull();
    expect(audio.tools.ffmpegSha256).toBe(sha(mediaBinary("ffmpeg")));expect(audio.sources.map(item=>item.channels).sort()).toEqual([1,1]);
    // alignment: the music part before the voice starts is the source shifted by (startFrame-sourceInFrame)×1600 samples
    const out=pcm(file),src=pcm(music.file),lag=bestLag(out,src,60*1600,48000,(30-15)*1600,800);
    console.log(`T137_EVIDENCE mix ${JSON.stringify({final:audio.final,childFinal:audio.childFinal,loudness:audio.loudness,padding:audio.output.initialPadding,lag,sizeBytes:value.sizeBytes})}`);
    expect(lag.lag,JSON.stringify(lag)).toBe((30-15)*1600);expect(lag.score).toBeGreaterThan(0.9);
    expect(sha(file)).toBe(value.sha256);
    const full=await fileRoute(new Request(`http://127.0.0.1/api/renders/${first.renderId}/file?download`),{params:Promise.resolve({id:first.renderId})});
    expect(full.status).toBe(200);expect(createHash("sha256").update(Buffer.from(await full.arrayBuffer())).digest("hex")).toBe(value.sha256);
    const view=(await rendersService(handle).list(P,{check:false})).renders.find(item=>item.id===first.renderId)!;
    expect(view).toMatchObject({audioMode:"aac",audioStreams:1,fileExists:true,audio:{status:"normalized",accepted:true,clips:2,hasMusic:true}});
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();expect(renderFileReferences(handle.sqlite).map(item=>item.filePath)).toContain(value.filePath);
    const after=inventory();for(const [path,hash] of before)expect(after.get(path),path).toBe(hash);
    expect(tmpRenders()).toEqual([]);expect(await leftovers()).toEqual([]);
  },900000);

  it("원본 형식 혼합(MP3 스테레오·M4A 모노 44.1kHz·WAV) 16:9 성공, 소리 없는 v2(mode none) 1:1은 소리 트랙 0",async()=>{
    const mp3=addSound(handle,storage,"MP3","sine=f=440:d=10:sample_rate=44100","mp3",["-ac","2","-c:a","libmp3lame","-b:a","128k"]);
    const m4a=addSound(handle,storage,"M4A","sine=f=660:d=10:sample_rate=44100","m4a",["-ac","1","-c:a","aac"]);
    saveTimeline(handle,{audio:[clip(mp3.id,{durationFrames:270}),clip(m4a.id,{role:"voice",startFrame:270,durationFrames:270}),clip(music.id,{role:"effect",startFrame:600,durationFrames:200})]},"16:9");
    const mixed=await renderOnce(),verify=verifyOf(mixed.renderId);
    expect(verify.result,JSON.stringify(verify.items.filter(item=>!item.pass))).toBe("passed");expect(verify.audio).toMatchObject({status:"normalized",accepted:true});
    expect(verify.items.find(item=>item.item==="width")!.actual).toBe(1920);expect(verify.audio!.sources.map(item=>item.channels).sort()).toEqual([1,1,2]);
    saveTimeline(handle,{audio:[]},"1:1");
    const silent=await renderOnce(),plain=verifyOf(silent.renderId);
    expect(plain.result).toBe("passed");expect(plain.probe.audioStreams).toBe(0);expect("audio" in plain).toBe(false);
    expect(JSON.parse(row(silent.renderId).inputJson)).toMatchObject({audioPlan:{schemaVersion:1,mode:"none"},output:{audio:"none"}});
    expect((await rendersService(handle).list(P,{check:false})).renders.find(item=>item.id===silent.renderId)).toMatchObject({audioMode:"none",audio:null});
    expect(tmpRenders()).toEqual([]);expect(await leftovers()).toEqual([]);
  },1200000);

  it("디지털 무음은 silent 성공(정규화 없음·accepted null), 띄엄띄엄 클릭은 AUDIO_LOUDNESS_FAILED(파일 없음·재시도 없음)",async()=>{
    const quiet=addSound(handle,storage,"무음","anullsrc=r=48000:cl=stereo","wav",["-t","10"]);
    saveTimeline(handle,{audio:[clip(quiet.id,{durationFrames:270})]});
    const silent=await renderOnce(),verify=verifyOf(silent.renderId);
    expect(verify.result).toBe("passed");expect(verify.audio).toMatchObject({status:"silent",accepted:null,loudness:null});
    expect(verify.items.some(item=>item.item==="loudnessIntegrated")).toBe(false);
    const clicks=addSound(handle,storage,"클릭","aevalsrc=0.9*sin(2*PI*2000*t)*lt(mod(t\\,0.5)\\,0.01):s=48000:d=6");
    saveTimeline(handle,{audio:[clip(clicks.id,{role:"effect",durationFrames:150})]});
    const inv=inventory(),failed=await renderOnce("failed");
    expect(row(failed.renderId)).toMatchObject({errorCode:"AUDIO_LOUDNESS_FAILED",filePath:null,sha256:null});expect(jobsRepository(handle).job(failed.jobId)!.attempts).toBe(1);
    const log=handle.sqlite.prepare("SELECT detail_json AS payload_json FROM activity_log WHERE action='render.audio_failed' ORDER BY rowid DESC LIMIT 1").get() as {payload_json:string}|undefined;
    console.log(`T137_EVIDENCE silent ${JSON.stringify(verify.audio!.final)} clicks ${log?.payload_json}`);
    expect(log?.payload_json).toMatch(/LOUDNESS_OUT_OF_RANGE/);expect(log?.payload_json).not.toMatch(/[A-Za-z]:\\\\|\/Users\//);
    expect(inventory()).toEqual(inv);expect(tmpRenders()).toEqual([]);expect(await leftovers()).toEqual([]);
  },1200000);

  it("소리 단계 중 취소 → canceled·파일 없음·FFmpeg·폴더 0, 요청 뒤 소리 파일이 바뀌면 재시도 없이 RENDER_INPUT_CHANGED",async()=>{
    saveTimeline(handle,{audio:[clip(music.id,{durationFrames:840})]});
    const {renderId,jobId}=await rendersService(handle).request(P,body()),running=runNextJob(handle);
    const audioDir=()=>walk(join(storage,"tmp")).some(path=>/[\\/]audio[\\/]dream-audio-/.test(path));
    await until(audioDir);jobsService(handle).cancel(jobId);await running;
    expect(row(renderId)).toMatchObject({status:"canceled",canceledLate:false,filePath:null,errorCode:"RENDER_CANCELED"});
    expect(tmpRenders()).toEqual([]);expect(await leftovers()).toEqual([]);
    const next=await rendersService(handle).request(P,body()),original=readFileSync(music.file);appendFileSync(music.file,"x");
    try{await runNextJob(handle);}finally{writeFileSync(music.file,original);}
    expect(row(next.renderId)).toMatchObject({status:"failed",errorCode:"RENDER_INPUT_CHANGED",filePath:null});expect(jobsRepository(handle).job(next.jobId)!.attempts).toBe(1);
    expect(tmpRenders()).toEqual([]);expect(await leftovers()).toEqual([]);
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  },1200000);
});
