// T-138: regressions for the T-135 independent review of the P2-5B sound module (F135-1~4, O135-1·2). Each case is
// the reviewer's reproduction run against the fixed module with the bundled FFmpeg 9.0.2 on synthetic signals in OS
// temp folders (no user audio). File system failures at the publish step are injected (not a real full disk).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import * as realFs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
// Fault injection for the publish staging file only (paths ending in ".part"); every other file use is real.
const faults=vi.hoisted(()=>({write:null as null|string,read:null as null|string}));
vi.mock("node:fs",async original=>{const fs=await original<typeof import("node:fs")>();
  return {...fs,
    createWriteStream:(path:string,options?:object)=>{const stream=fs.createWriteStream(path,options as never);
      if(faults.write&&String(path).endsWith(".part")){const code=faults.write;stream._write=(_chunk,_encoding,done)=>{fs.appendFileSync(path,"PARTIAL-AUDIO");done(Object.assign(new Error("injected"),{code}));};}
      return stream;},
    createReadStream:(path:string,options?:object)=>{const stream=fs.createReadStream(path,options as never);
      if(faults.read&&String(path).endsWith(".part")){const code=faults.read;stream._read=()=>{stream.destroy(Object.assign(new Error("injected"),{code}));};}
      return stream;}};});
import { mixAudio, type MixOptions, type ProcessedMix } from "@/lib/audio/mix";
import { runTool, type ToolRunner } from "@/lib/audio/run";
import { mediaBinary } from "@/lib/media/tools";

const ffmpeg=mediaBinary("ffmpeg"),ffprobe=mediaBinary("ffprobe");
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t138-")));faults.write=null;faults.read=null;});
afterEach(()=>{faults.write=null;faults.read=null;if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");
  for(const name of readdirSync(root))if(name.endsWith(".exe"))try{chmodSync(join(root,name),0o666);}catch{/* removed below */}
  rmSync(root,{recursive:true,force:true,maxRetries:3});});

const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
function source(name:string,lavfi:string,extra:string[]=[],inputs:string[]=[]){const path=join(root,name);execFileSync(ffmpeg,["-v","error",...inputs,"-f","lavfi","-i",lavfi,...extra,path]);const bytes=readFileSync(path);return {path,sha256:createHash("sha256").update(bytes).digest("hex"),sizeBytes:bytes.length};}
const tone=(name:string,sec:number)=>source(name,`aevalsrc=0.2*sin(2*PI*330*t)|0.2*sin(2*PI*330*t):s=48000:d=${sec}`);
const video=(name:string,frames:number,rate=30)=>source(name,`color=c=0x335577:s=160x120:r=${rate}`,["-frames:v",String(frames),"-c:v","libx264","-pix_fmt","yuv420p"]);
let n=0;const id=()=>`019b9138-0000-7000-8000-${String(++n).padStart(12,"0")}`;
function request(frames:number,sources:Record<string,{path:string;sha256:string;sizeBytes:number}>,over:Record<string,unknown>={}){
  const audio=Object.keys(sources).map(assetId=>({id:id(),assetId,role:"music",startFrame:0,sourceInFrame:0,durationFrames:frames,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}));
  return {outputFrames:frames,audio,audioJoins:[],sources,video:null,outputPath:join(root,`out-${++n}.m4a`),workRoot:root,...over};
}
const left=()=>readdirSync(root).filter(name=>name.startsWith("dream-audio-")||name.endsWith(".part"));
// a writable copy of an installed tool (the installed files are never touched)
function toolCopy(name:"ffmpeg"|"ffprobe"){const path=join(root,`${name}-copy.exe`);copyFileSync(name==="ffmpeg"?ffmpeg:ffprobe,path);const at=new Date("2026-01-01T00:00:00Z");utimesSync(path,at,at);return path;}
// one byte of the DOS stub changed (the program still runs), size and modification time kept
function flipStub(path:string){const stat=statSync(path);chmodSync(path,0o666);const bytes=readFileSync(path);bytes[0x50]^=0xff;writeFileSync(path,bytes);utimesSync(path,stat.atime,stat.mtime);}
const isLoudnormFirst=(args:readonly string[])=>args.some(arg=>arg.includes("loudnorm=")&&arg.includes("print_format=json")&&!arg.includes("measured_I"));
const isFinalMeasure=(args:readonly string[])=>args.some(arg=>arg.startsWith("ebur128="));

describe("F135-1 도구 고정: 실행한 바이트와 보고한 해시가 같다",()=>{
  it("처리 중 설치본을 같은 크기·시각으로 바꿔도 이 요청은 고정 사본으로 끝까지 돌고, 보고 해시는 실제 실행 사본의 해시",async()=>{
    const installed=toolCopy("ffmpeg"),original=sha(installed),a=id(),ran=new Set<string>();
    const run:ToolRunner=async(binary,args,options)=>{ran.add(binary);const result=await runTool(binary,args,options);if(isLoudnormFirst(args))flipStub(installed);return result;};
    const result=await mixAudio(request(150,{[a]:tone("a.wav",6)}),{run,tools:{ffmpeg:installed,ffprobe}}) as ProcessedMix;
    expect(result.accepted).toBe(true);expect(sha(installed)).not.toBe(original);
    expect(result.tools.ffmpegSha256).toBe(original);expect(result.loudness!.stats.ffmpegSha256).toBe(original);
    // every run used this call's pinned copies inside its work folder, never the installed paths
    expect([...ran].every(binary=>/dream-audio-[^\\/]+[\\/]tools[\\/]ff(mpeg|probe)/.test(binary)),[...ran].join(",")).toBe(true);
    // the next request reads the tool again (no size/mtime cache): it reports the new bytes, or refuses with a pin
    const b=id(),next=await mixAudio(request(150,{[b]:tone("b.wav",6)}),{tools:{ffmpeg:installed,ffprobe}}) as ProcessedMix;
    expect(next.tools.ffmpegSha256).toBe(sha(installed));
    const c=id(),pinned=request(150,{[c]:tone("c.wav",6)});
    await expect(mixAudio(pinned,{tools:{ffmpeg:installed,ffprobe,ffmpegSha256:original}})).rejects.toMatchObject({code:"TOOL_CHANGED"});
    expect(existsSync(pinned.outputPath)).toBe(false);expect(left()).toEqual([]);
  },240000);
  it("고정 사본 자체가 첫 측정 뒤 바뀌면 두 번째 pass 전에 STATS_MISMATCH, ffprobe도 기대 해시가 다르면 TOOL_CHANGED",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)});
    const run:ToolRunner=async(binary,args,options)=>{const result=await runTool(binary,args,options);if(isLoudnormFirst(args))flipStub(binary);return result;};
    await expect(mixAudio(value,{run})).rejects.toMatchObject({code:"STATS_MISMATCH"});expect(existsSync(value.outputPath)).toBe(false);
    const b=id(),other=request(150,{[b]:tone("b.wav",6)});
    await expect(mixAudio(other,{tools:{ffmpeg,ffprobe,ffprobeSha256:"0".repeat(64)}})).rejects.toMatchObject({code:"TOOL_CHANGED"});
    expect(left()).toEqual([]);
  },240000);
});

describe("F135-2 게시: 실패하면 목적지에 아무것도 없고, 남의 파일은 지우지 않는다",()=>{
  it("임시 게시 파일 쓰기 ENOSPC(부분 기록 뒤) → DISK_FULL, 목적지·임시 파일·작업 폴더 없음",async()=>{
    const a=id(),file=tone("a.wav",6),value=request(150,{[a]:file});faults.write="ENOSPC";
    await expect(mixAudio(value)).rejects.toMatchObject({code:"DISK_FULL"});
    expect(existsSync(value.outputPath)).toBe(false);expect(left()).toEqual([]);expect(sha(file.path)).toBe(file.sha256);
  },120000);
  it("임시 게시 파일을 다시 읽다 EIO → 실패, 목적지·임시 파일 없음",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)});faults.read="EIO";
    await expect(mixAudio(value)).rejects.toMatchObject({code:"TOOL_FAILED",detail:"EIO"});
    expect(existsSync(value.outputPath)).toBe(false);expect(left()).toEqual([]);
  },120000);
  it("게시 직전 다른 쪽이 같은 이름을 만들면 OUTPUT_EXISTS, 그 파일은 그대로; 연결 ENOSPC는 DISK_FULL, 목적지 없음",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)});
    const race:MixOptions["link"]=(from,to)=>{writeFileSync(to,"EXTERNAL-SENTINEL");realFs.linkSync(from,to);};
    await expect(mixAudio(value,{link:race})).rejects.toMatchObject({code:"OUTPUT_EXISTS"});
    expect(readFileSync(value.outputPath,"utf8")).toBe("EXTERNAL-SENTINEL");expect(left()).toEqual([]);
    const b=id(),full=request(150,{[b]:tone("b.wav",6)});
    await expect(mixAudio(full,{link:()=>{throw Object.assign(new Error("injected"),{code:"ENOSPC"});}})).rejects.toMatchObject({code:"DISK_FULL"});
    expect(existsSync(full.outputPath)).toBe(false);expect(left()).toEqual([]);
  },180000);
});

describe("F135-3 마지막 측정 뒤 취소·기한",()=>{
  it("최종 측정이 끝난 직후 취소 → CANCELED, 결과 없음",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)}),controller=new AbortController();
    const run:ToolRunner=async(binary,args,options)=>{const result=await runTool(binary,args,options);if(isFinalMeasure(args))controller.abort();return result;};
    await expect(mixAudio(value,{run,signal:controller.signal})).rejects.toMatchObject({code:"CANCELED"});
    expect(existsSync(value.outputPath)).toBe(false);expect(left()).toEqual([]);
  },120000);
  it("최종 측정이 기한을 넘겨 돌아오면 TIMEOUT, 결과 없음",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)}),timeoutMs=15000,started=Date.now();
    const run:ToolRunner=async(binary,args,options)=>{const result=await runTool(binary,args,options);if(isFinalMeasure(args))await new Promise(resolve=>setTimeout(resolve,Math.max(0,started+timeoutMs+100-Date.now())));return result;};
    await expect(mixAudio(value,{run,timeoutMs})).rejects.toMatchObject({code:"TIMEOUT"});
    expect(Date.now()-started).toBeGreaterThan(timeoutMs);expect(existsSync(value.outputPath)).toBe(false);expect(left()).toEqual([]);
  },120000);
  it("게시(연결)가 끝난 뒤 온 취소는 결과를 되돌리지 않는다(호출자가 늦은 결과로 다룸)",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)}),controller=new AbortController();
    const result=await mixAudio(value,{signal:controller.signal,link:(from,to)=>{realFs.linkSync(from,to);controller.abort();}}) as ProcessedMix;
    expect(result.accepted).toBe(true);expect(sha(value.outputPath)).toBe(result.output.sha256);expect(left()).toEqual([]);
  },120000);
  it("큰 원본 복사 중 기한이 지나면 TIMEOUT, 작업 폴더 없음",async()=>{
    const a=id(),big=source("big.wav","anoisesrc=d=600:c=white:r=48000:a=0.1"),value=request(600*30,{[a]:big});
    await expect(mixAudio(value,{timeoutMs:1500})).rejects.toMatchObject({code:"TIMEOUT"});
    expect(left()).toEqual([]);expect(sha(big.path)).toBe(big.sha256);
  },120000);
});

describe("F135-4 영상 길이: 소리로 영상을 늘리거나 자르지 않는다",()=>{
  it("2초·6초 영상 + 4초 소리, 25fps 영상은 VIDEO_MISMATCH(결과 없음); 4초 30fps 영상은 프레임 수·영상 패킷 해시가 결과와 같다",async()=>{
    for(const [frames,rate] of [[60,30],[180,30],[100,25]] as const){
      const a=id(),movie=video(`v${frames}-${rate}.mp4`,frames,rate),value=request(120,{[a]:tone(`a${frames}.wav`,4)},{video:movie,outputPath:join(root,`out-${frames}.mp4`)});
      await expect(mixAudio(value),`${frames}@${rate}`).rejects.toMatchObject({code:"VIDEO_MISMATCH"});expect(existsSync(value.outputPath)).toBe(false);expect(sha(movie.path)).toBe(movie.sha256);
    }
    const a=id(),movie=video("v120.mp4",120),value=request(120,{[a]:tone("a120.wav",4)},{video:movie,outputPath:join(root,"good.mp4")});
    const result=await mixAudio(value) as ProcessedMix;
    expect(result.output.videoCheck?.frames).toBe(120);expect(result.output.decodedSamples).toBe(120*1600);
    const streamHash=(file:string)=>/SHA256=([0-9a-f]{64})/i.exec(execFileSync(ffmpeg,["-v","error","-i",file,"-map","0:v:0","-c","copy","-f","streamhash","-hash","sha256","-"],{encoding:"utf8"}))![1].toLowerCase();
    expect(streamHash(value.outputPath)).toBe(streamHash(movie.path));expect(result.output.videoCheck?.streamSha256).toBe(streamHash(movie.path));
    const durations=execFileSync(ffprobe,["-v","error","-show_entries","stream=codec_type,duration","-of","csv=p=0",value.outputPath],{encoding:"utf8"}).trim().split(/\r?\n/);
    expect(durations.sort()).toEqual(["audio,4.000000","video,4.000000"]);expect(left()).toEqual([]);
  },240000);
});

describe("O135 관찰 2건",()=>{
  it("소리 트랙이 둘인 파일은 첫 트랙만 몰래 쓰지 않고 SOURCE_UNSUPPORTED",async()=>{
    const path=join(root,"two.m4a");execFileSync(ffmpeg,["-v","error","-f","lavfi","-i","sine=f=440:d=4","-f","lavfi","-i","sine=f=660:d=4","-map","0","-map","1","-c:a","aac",path]);
    const bytes=readFileSync(path),a=id(),value=request(120,{[a]:{path,sha256:createHash("sha256").update(bytes).digest("hex"),sizeBytes:bytes.length}});
    await expect(mixAudio(value)).rejects.toMatchObject({code:"SOURCE_UNSUPPORTED"});expect(left()).toEqual([]);
  },120000);
  it("onWork 관찰 함수가 실패해도 작업 폴더를 지운다",async()=>{
    const a=id(),value=request(120,{[a]:tone("a.wav",4)});
    await expect(mixAudio(value,{onWork:()=>{throw new Error("observer failed");}})).rejects.toBeTruthy();
    expect(left()).toEqual([]);expect(existsSync(value.outputPath)).toBe(false);
  },60000);
});
