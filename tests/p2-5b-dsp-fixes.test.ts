// T-138: regressions for the T-135 independent review of the P2-5B sound module (F135-1~4, O135-1·2). Each case is
// the reviewer's reproduction run against the fixed module with the bundled FFmpeg 9.0.2 on synthetic signals in OS
// temp folders (no user audio). File system failures at the publish step are injected (not a real full disk).
// T-140: the cleanup after a committed result (F139-1) is reported, never turned into a failure; and every test that
// changes a tool binary works on a copy inside its own temp folder: a path outside it is refused (fail closed), and
// the installed FFmpeg/ffprobe hashes are checked to be unchanged after the file.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import * as realFs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
// Fault injection for the publish staging file only (paths ending in ".part"); every other file use is real.
const faults=vi.hoisted(()=>({write:null as null|string,read:null as null|string,rm:null as null|RegExp,hide:false}));
vi.mock("node:fs",async original=>{const fs=await original<typeof import("node:fs")>();
  return {...fs,
    // a lasting EBUSY for removals of names matching faults.rm (the work folder or the staging file)
    // with faults.hide the same names also look absent to existsSync (a removal error followed by a false "gone")
    existsSync:(path:string)=>{if(faults.rm&&faults.hide&&faults.rm.test(String(path).replaceAll("\\","/").split("/").pop()!))return false;return fs.existsSync(path);},
    rmSync:(path:string,options?:object)=>{if(faults.rm&&faults.rm.test(String(path).replaceAll("\\","/").split("/").pop()!))throw Object.assign(new Error("injected busy"),{code:"EBUSY"});return fs.rmSync(path,options as never);},
    createWriteStream:(path:string,options?:object)=>{const stream=fs.createWriteStream(path,options as never);
      if(faults.write&&String(path).endsWith(".part")){const code=faults.write;stream._write=(_chunk,_encoding,done)=>{fs.appendFileSync(path,"PARTIAL-AUDIO");done(Object.assign(new Error("injected"),{code}));};}
      return stream;},
    createReadStream:(path:string,options?:object)=>{const stream=fs.createReadStream(path,options as never);
      if(faults.read&&String(path).endsWith(".part")){const code=faults.read;stream._read=()=>{stream.destroy(Object.assign(new Error("injected"),{code}));};}
      return stream;}};});
import { mixAudio, type MixOptions, type ProcessedMix } from "@/lib/audio/mix";
import { AudioError, runTool, type ToolRunner } from "@/lib/audio/run";
import { mediaBinary } from "@/lib/media/tools";

const ffmpeg=mediaBinary("ffmpeg"),ffprobe=mediaBinary("ffprobe");
let root:string,installed:{ffmpeg:string;ffprobe:string};
const fileSha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
beforeAll(()=>{installed={ffmpeg:fileSha(ffmpeg),ffprobe:fileSha(ffprobe)};});
afterAll(()=>{expect({ffmpeg:fileSha(ffmpeg),ffprobe:fileSha(ffprobe)},"installed tools must stay unchanged").toEqual(installed);});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t138-")));faults.write=null;faults.read=null;faults.rm=null;faults.hide=false;});
afterEach(()=>{faults.write=null;faults.read=null;faults.rm=null;faults.hide=false;if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");
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
function flipStub(path:string){
  // fail closed: only a copy inside this test's temp folder is ever changed (never an installed or shared binary)
  const real=realpathSync(path);if(!real.startsWith(root+sep))throw new Error("refusing to change a binary outside the test folder");
  const stat=statSync(path);chmodSync(path,0o666);const bytes=readFileSync(path);bytes[0x50]^=0xff;
  // a freshly copied exe can be held briefly by the system's file scanner right after it ran: retry the write only
  for(let attempt=0;;attempt++){try{writeFileSync(path,bytes);break;}catch(error){const code=(error as NodeJS.ErrnoException).code;
    if(attempt>=40||!["EBUSY","EPERM","EACCES"].includes(code??""))throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}}
  utimesSync(path,stat.atime,stat.mtime);}
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

describe("F139-1 commit 뒤 정리: 결과와 정리 상태를 따로 알린다",()=>{
  const name=/^dream-audio-/;
  it("정상: 정리 완료",async()=>{
    const a=id(),result=await mixAudio(request(150,{[a]:tone("a.wav",6)})) as ProcessedMix;
    expect(result.cleanup).toEqual({complete:true,left:[]});expect(left()).toEqual([]);
  },120000);
  for(const late of [false,true])it(`commit 뒤 작업 폴더 EBUSY${late?"(늦은 취소와 함께)":""}: 성공 결과 그대로, 정리 미완료와 남은 이름을 보고`,async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)}),controller=new AbortController();
    const result=await mixAudio(value,{signal:controller.signal,link:(from,to)=>{realFs.linkSync(from,to);faults.rm=name;if(late)controller.abort();}}) as ProcessedMix;
    expect(result.accepted).toBe(true);expect(sha(value.outputPath)).toBe(result.output.sha256);
    expect(result.cleanup.complete).toBe(false);expect(result.cleanup.left).toHaveLength(1);
    expect(result.cleanup.left[0]).toMatchObject({kind:"work"});expect(result.cleanup.left[0].name).toMatch(name);expect(result.cleanup.left[0].name).not.toMatch(/[\\/:]/);
    expect(existsSync(join(root,result.cleanup.left[0].name))).toBe(true);
    faults.rm=null;rmSync(join(root,result.cleanup.left[0].name),{recursive:true,force:true});expect(left()).toEqual([]);expect(existsSync(value.outputPath)).toBe(true);
  },120000);
  it("commit 뒤 임시 게시 이름 EBUSY: 결과 파일은 그대로, 남은 임시 이름을 보고",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)});
    const result=await mixAudio(value,{link:(from,to)=>{realFs.linkSync(from,to);faults.rm=/\.part$/;}}) as ProcessedMix;
    expect(sha(value.outputPath)).toBe(result.output.sha256);expect(result.cleanup.complete).toBe(false);
    expect(result.cleanup.left.map(item=>item.kind)).toEqual(["staging"]);
    faults.rm=null;rmSync(join(root,result.cleanup.left[0].name));expect(sha(value.outputPath)).toBe(result.output.sha256);expect(left()).toEqual([]);
  },120000);
  it("commit 전 실패 + 정리 EBUSY: 원래 원인(VIDEO_MISMATCH·CANCELED)을 그대로 던지고 정리 상태를 붙인다",async()=>{
    const a=id(),movie=video("short.mp4",60),value=request(120,{[a]:tone("a.wav",4)},{video:movie,outputPath:join(root,"x.mp4")});faults.rm=name;
    const error=await mixAudio(value).then(()=>null,(caught:unknown)=>caught as AudioError);
    expect(error).toBeInstanceOf(AudioError);expect(error!.code).toBe("VIDEO_MISMATCH");expect(error!.cleanup).toMatchObject({complete:false,left:[{kind:"work"}]});
    const b=id(),controller=new AbortController(),other=request(150,{[b]:tone("b.wav",6)});
    const run:ToolRunner=async(binary,args,options)=>{const result=await runTool(binary,args,options);if(isFinalMeasure(args))controller.abort();return result;};
    const canceled=await mixAudio(other,{run,signal:controller.signal}).then(()=>null,(caught:unknown)=>caught as AudioError);
    expect(canceled!.code).toBe("CANCELED");expect(canceled!.cleanup?.complete).toBe(false);expect(existsSync(other.outputPath)).toBe(false);
    faults.rm=null;for(const item of [...error!.cleanup!.left,...canceled!.cleanup!.left])rmSync(join(root,item.name),{recursive:true,force:true});expect(left()).toEqual([]);
  },180000);
  it("commit 전 실패에서 정리가 끝나면 complete=true",async()=>{
    const a=id(),movie=video("short2.mp4",60),value=request(120,{[a]:tone("a.wav",4)},{video:movie,outputPath:join(root,"y.mp4")});
    const error=await mixAudio(value).then(()=>null,(caught:unknown)=>caught as AudioError);
    expect(error!.code).toBe("VIDEO_MISMATCH");expect(error!.cleanup).toEqual({complete:true,left:[]});
  },60000);
  it("F141-1 삭제 오류 뒤 존재 확인이 '없음'이어도 정리 완료로 확정하지 않는다(work·staging, commit 뒤·전)",async()=>{
    // commit 뒤 work: 결과 성공 그대로, work 이름 유지
    const a=id(),value=request(150,{[a]:tone("a.wav",6)});
    const result=await mixAudio(value,{link:(from,to)=>{realFs.linkSync(from,to);faults.rm=name;faults.hide=true;}}) as ProcessedMix;
    faults.rm=null;faults.hide=false;
    expect(result.accepted).toBe(true);expect(sha(value.outputPath)).toBe(result.output.sha256);
    expect(result.cleanup.complete).toBe(false);expect(result.cleanup.left.map(item=>item.kind)).toEqual(["work"]);expect(result.cleanup.left[0].name).toMatch(name);
    rmSync(join(root,result.cleanup.left[0].name),{recursive:true,force:true});
    // commit 뒤 staging
    const b=id(),other=request(150,{[b]:tone("b.wav",6)});
    const second=await mixAudio(other,{link:(from,to)=>{realFs.linkSync(from,to);faults.rm=/\.part$/;faults.hide=true;}}) as ProcessedMix;
    faults.rm=null;faults.hide=false;
    expect(sha(other.outputPath)).toBe(second.output.sha256);expect(second.cleanup).toMatchObject({complete:false,left:[{kind:"staging"}]});
    rmSync(join(root,second.cleanup.left[0].name));
    // commit 전 실패: 원래 원인 유지
    const c=id(),movie=video("short3.mp4",60),failing=request(120,{[c]:tone("c.wav",4)},{video:movie,outputPath:join(root,"z.mp4")});faults.rm=name;faults.hide=true;
    const error=await mixAudio(failing).then(()=>null,(caught:unknown)=>caught as AudioError);faults.rm=null;faults.hide=false;
    expect(error!.code).toBe("VIDEO_MISMATCH");expect(error!.cleanup).toMatchObject({complete:false,left:[{kind:"work"}]});
    for(const item of error!.cleanup!.left)rmSync(join(root,item.name),{recursive:true,force:true});expect(left()).toEqual([]);
  },180000);
  it("keepWork로 보관한 작업 폴더는 남은 것으로 세지 않는다",async()=>{
    const a=id(),value=request(150,{[a]:tone("a.wav",6)});let kept="";
    const result=await mixAudio(value,{keepWork:true,onWork:dir=>{kept=dir;}}) as ProcessedMix;
    expect(result.cleanup).toEqual({complete:true,left:[]});expect(existsSync(kept)).toBe(true);
    rmSync(kept,{recursive:true,force:true});expect(left()).toEqual([]);
  },120000);
});

describe("도구 변경 시험의 보호 장치",()=>{
  it("시험 폴더 밖 실행 파일은 바꾸지 않고 거절한다(설치본 경로 포함)",()=>{
    expect(()=>flipStub(ffmpeg)).toThrow(/outside the test folder/);expect(()=>flipStub(ffprobe)).toThrow(/outside the test folder/);
    expect(fileSha(ffmpeg)).toBe(installed.ffmpeg);
  });
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
