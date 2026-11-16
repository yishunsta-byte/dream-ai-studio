// T-134 P2-5B offline sound processing, measured on real FFmpeg output (bundled 9.0.2): synthetic tones, a gated
// voice-like signal and digital silence, all generated into OS temp folders (no user audio, no downloads). Levels are
// read back with a Goertzel filter at each test frequency, so trim, placement, gain, fades, equal-power joins and
// ducking are checked by numbers, not by listening (no listening test was done).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { mixGraph } from "@/lib/audio/graph";
import { checkSecondPass, ebur128Summary, mixAudio, type LoudnessStats, type ProcessedMix } from "@/lib/audio/mix";
import { ACCEPT, LOUDNESS, PROFILE_ID, SAMPLES_PER_FRAME } from "@/lib/audio/profile";
import { AudioError, runTool } from "@/lib/audio/run";
import { mediaBinary } from "@/lib/media/tools";

const ffmpeg=mediaBinary("ffmpeg"),SR=48000,F=SAMPLES_PER_FRAME;
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-p25b-")));});
afterEach(()=>{if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true,maxRetries:3});});

const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
// A virtual source made by FFmpeg's own generators; returns the pinned record the module expects.
function source(name:string,lavfi:string,extra:string[]=[]){const path=join(root,name);execFileSync(ffmpeg,["-v","error","-f","lavfi","-i",lavfi,...extra,path]);const bytes=readFileSync(path);return {path,sha256:createHash("sha256").update(bytes).digest("hex"),sizeBytes:bytes.length};}
const tone=(name:string,freq:number,sec:number,amp=0.25,sr=44100,extra:string[]=[])=>source(name,`aevalsrc=${amp}*sin(2*PI*${freq}*t):s=${sr}:d=${sec}`,extra);
const silence=(name:string,sec:number)=>source(name,`anullsrc=r=48000:cl=mono:d=${sec}`);
const video=(frames:number)=>source("video.mp4",`color=c=0x335577:s=320x240:r=30`,["-frames:v",String(frames),"-c:v","libx264","-pix_fmt","yuv420p"]);
let n=0;const id=()=>`019b9134-0000-7000-8000-${String(++n).padStart(12,"0")}`;
type Clip={id:string;assetId:string;role:"voice"|"music"|"effect";startFrame:number;sourceInFrame:number;durationFrames:number;gainDb:number;fadeInFrames:number;fadeOutFrames:number;duckUnderVoice:boolean};
const clip=(assetId:string,over:Partial<Clip>={}):Clip=>({id:id(),assetId,role:"music",startFrame:0,sourceInFrame:0,durationFrames:60,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false,...over});
function request(outputFrames:number,audio:Clip[],sources:Record<string,{path:string;sha256:string;sizeBytes:number}>,over:Record<string,unknown>={}){return {outputFrames,audio,audioJoins:[] as {fromClipId:string;toClipId:string;type:string;durationFrames:number;curve:string}[],sources,video:null,outputPath:join(root,`out-${++n}.m4a`),workRoot:root,...over};}
// Runs a mix and keeps its work folder so the f32 mix (before loudness) can be read; the folder is removed afterwards.
async function withMix(value:ReturnType<typeof request>){let work="";const result=await mixAudio(value,{keepWork:true,onWork:path=>{work=path;}}) as ProcessedMix;const mix=f32(join(work,"mix.f32"));rmSync(work,{recursive:true,force:true});return {result,mix};}
function f32(file:string){const bytes=readFileSync(file),out=new Float32Array(bytes.length/4);for(let i=0;i<out.length;i++)out[i]=bytes.readFloatLE(i*4);return out;}
// Left channel amplitude of `freq` over [from, to) sample frames (Goertzel; a pure tone of amplitude A reads ≈ A).
function amp(pcm:Float32Array,freq:number,from:number,to:number){const k=2*Math.cos(2*Math.PI*freq/SR);let s1=0,s2=0;for(let i=from;i<to;i++){const s0=pcm[i*2]+k*s1-s2;s2=s1;s1=s0;}const length=to-from;return 2*Math.sqrt(Math.max(0,s1*s1+s2*s2-k*s1*s2))/length;}
const firstNonZero=(pcm:Float32Array)=>{for(let i=0;i<pcm.length;i++)if(pcm[i]!==0)return Math.floor(i/2);return -1;};
const lastNonZero=(pcm:Float32Array)=>{for(let i=pcm.length-1;i>=0;i--)if(pcm[i]!==0)return Math.floor(i/2);return -1;};
const dB=(ratio:number)=>20*Math.log10(ratio);
function decode(file:string){const out=execFileSync(ffmpeg,["-v","error","-i",file,"-map","0:a:0","-ac","2","-ar","48000","-f","f32le","-"],{maxBuffer:1<<28});const pcm=new Float32Array(out.length/4);for(let i=0;i<pcm.length;i++)pcm[i]=out.readFloatLE(i*4);return pcm;}
// lag in [-300, 300] samples that maximizes the normalized correlation of the left channels over [from, to)
function bestLag(a:Float32Array,b:Float32Array,from:number,to:number){let best=0,score=-Infinity;for(let lag=-300;lag<=300;lag++){let ab=0,aa=0,bb=0;for(let i=from;i<to;i++){const x=a[i*2],y=b[(i+lag)*2];ab+=x*y;aa+=x*x;bb+=y*y;}const value=ab/Math.sqrt(aa*bb||1);if(value>score){score=value;best=lag;}}return best;}
const workLeft=()=>readdirSync(root).filter(name=>name.startsWith("dream-audio-"));

describe("필터 구성",()=>{
  it("정수·고정 단어만 쓰고, 이상한 숫자는 거절한다",()=>{
    const text=mixGraph([{input:0,channels:1,role:"music",startFrame:3,sourceInFrame:2,durationFrames:10,gainDb:-6,fadeIn:{frames:2,curve:"tri"},fadeOut:{frames:3,curve:"qsin"},duck:false}],20);
    expect(text).toBe("[0:a:0]aresample=48000,pan=stereo|c0=c0|c1=c0,atrim=start_sample=3200:end_sample=19200,asetpts=N/SR/TB,volume=-6dB,afade=t=in:ss=0:ns=3200:curve=tri,afade=t=out:ss=11200:ns=4800:curve=qsin,adelay=delays=4800S:all=1,apad=whole_len=32000,atrim=end_sample=32000[c0];[c0]anull[music];[music]atrim=end_sample=32000,aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo[out]");
    for(const bad of [{gainDb:Number.NaN},{gainDb:13},{startFrame:1.5},{sourceInFrame:-1}])expect(()=>mixGraph([{input:0,channels:2,role:"voice",startFrame:0,sourceInFrame:0,durationFrames:10,gainDb:0,fadeIn:{frames:0,curve:"tri"},fadeOut:{frames:0,curve:"tri"},duck:false,...bad}],20)).toThrow();
  });
});

describe("실제 믹스 (정규화 전 f32)",()=>{
  it("사용 구간·배치·gain: 원본 1초 뒤 구간이 정확한 샘플 위치에 -6dB로, 앞뒤는 디지털 무음, 길이는 출력 길이 그대로",async()=>{
    const marker=source("marker.wav","aevalsrc=0.25*sin(2*PI*if(lt(t\\,1)\\,440\\,880)*t):s=44100:d=3");// 0–1 s 440 Hz, then 880 Hz
    const a=id(),{result,mix}=await withMix(request(120,[clip(a,{sourceInFrame:30,startFrame:45,durationFrames:30,gainDb:-6})],{[a]:marker}));
    expect(mix.length/2).toBe(120*F);expect(result.mix.samples).toBe(120*F);
    // everything before the placed part is digital zero; the tone itself starts on a zero crossing (first sample 0)
    expect(firstNonZero(mix)-45*F).toBeGreaterThanOrEqual(0);expect(firstNonZero(mix)-45*F).toBeLessThanOrEqual(1);expect(mix.subarray(0,45*F*2).every(value=>value===0)).toBe(true);
    expect(75*F-1-lastNonZero(mix)).toBeLessThanOrEqual(1);expect(mix.subarray(75*F*2).every(value=>value===0)).toBe(true);
    const inside=amp(mix,880,45*F+2400,75*F-2400);expect(dB(inside/0.25)).toBeCloseTo(-6,1);expect(amp(mix,440,45*F+2400,75*F-2400)).toBeLessThan(0.002);
    expect(result.sources[0]).toMatchObject({channels:1,decodedSamples:3*SR});
  },60000);
  it("서서히: 직선 처음·끝, 0이면 바로 시작",async()=>{
    const a=id(),{mix}=await withMix(request(120,[clip(a,{startFrame:0,durationFrames:90,fadeInFrames:30,fadeOutFrames:30})],{[a]:tone("t.wav",500,4)}));
    const at=(frame:number)=>amp(mix,500,frame*F-480,frame*F+480);
    expect(at(15)/at(45)).toBeCloseTo(0.5,1);expect(at(75)/at(45)).toBeCloseTo(0.5,1);expect(at(45)).toBeCloseTo(0.25,2);
    expect(Math.abs(mix[1*2])).toBeLessThan(1e-4);// the very first sample of a fade-in is (near) silent
  },60000);
  it("두 곡 crossfade(등전력): 겹친 구간 내내 a²+b²가 일정, 영상 길이는 줄지 않음, 두 곡만",async()=>{
    const a=id(),b=id(),first=clip(a,{startFrame:0,durationFrames:90}),second=clip(b,{startFrame:60,durationFrames:90});
    const value={...request(150,[first,second],{[a]:tone("a.wav",440,4),[b]:tone("b.wav",660,4)}),audioJoins:[{fromClipId:first.id,toClipId:second.id,type:"crossfade",durationFrames:30,curve:"equalPower"}]};
    const {mix}=await withMix(value);expect(mix.length/2).toBe(150*F);
    // 4800-sample windows hold whole cycles of both tones (44 and 66), so neither leaks into the other
    for(const frame of [63,68,75,82,87]){const x=amp(mix,440,frame*F-2400,frame*F+2400)/0.25,y=amp(mix,660,frame*F-2400,frame*F+2400)/0.25;expect(x*x+y*y,`frame ${frame}`).toBeCloseTo(1,1);}
    expect(amp(mix,440,30*F,50*F)).toBeCloseTo(0.25,2);expect(amp(mix,660,30*F,50*F)).toBeLessThan(0.002);
    expect(amp(mix,660,100*F,140*F)).toBeCloseTo(0.25,2);expect(amp(mix,440,100*F,140*F)).toBeLessThan(0.002);
    expect(lastNonZero(mix)).toBe(150*F-1);
  },60000);
  it("목소리 신호로 음악 낮춤: 낮춤 켠 음악만 목소리 구간에서 내려가고 사이에서 돌아옴, 낮춤 끈 음악·목소리·효과음은 그대로",async()=>{
    const m=id(),v=id(),e=id();
    const voice=source("voice.wav","aevalsrc=0.3*sin(2*PI*1000*t)*lt(mod(t\\,1)\\,0.5):s=48000:d=4");// on 0–0.5 s, 1–1.5 s, …
    const run=(duck:boolean)=>withMix(request(120,[clip(m,{durationFrames:120,duckUnderVoice:duck}),clip(v,{role:"voice",durationFrames:120}),clip(e,{role:"effect",durationFrames:120})],{[m]:tone(`m${duck}.wav`,220,4,0.2),[v]:voice,[e]:tone(`e${duck}.wav`,3000,4,0.1)}));
    const ducked=(await run(true)).mix,plain=(await run(false)).mix;
    // whole-cycle windows: 0.25 s (55 cycles of 220 Hz) inside a voice-on part after the attack, 0.125 s in a gap
    const on=(pcm:Float32Array,freq:number)=>amp(pcm,freq,Math.round(1.2*SR),Math.round(1.45*SR)),off=(pcm:Float32Array,freq:number)=>amp(pcm,freq,Math.round(1.85*SR),Math.round(1.975*SR));
    expect(dB(on(ducked,220)/0.2)).toBeLessThan(-6);expect(dB(off(ducked,220)/0.2)).toBeGreaterThan(-3);
    expect(dB(on(plain,220)/0.2)).toBeCloseTo(0,0);expect(dB(off(plain,220)/0.2)).toBeCloseTo(0,0);
    expect(dB(on(ducked,3000)/0.1)).toBeCloseTo(0,0);expect(dB(on(ducked,1000)/0.3)).toBeCloseTo(0,0);// effect and voice untouched
    expect(amp(ducked,220,Math.round(3.6*SR),Math.round(3.95*SR))/0.2).toBeGreaterThan(0.1);expect(120*F-1-lastNonZero(ducked)).toBeLessThanOrEqual(1);// music keeps playing to the end (recovering from the last voice part)
  },60000);
  it("목소리 없음·무음 목소리: 낮춤 켠 음악도 줄지 않음(신호 없는 목소리로 음악을 자르지 않음)",async()=>{
    const m=id(),v=id();
    const none=await withMix(request(120,[clip(m,{durationFrames:120,duckUnderVoice:true})],{[m]:tone("m1.wav",220,4,0.2)}));
    expect(dB(amp(none.mix,220,SR,3*SR)/0.2)).toBeCloseTo(0,1);
    const quiet=await withMix(request(120,[clip(m,{durationFrames:120,duckUnderVoice:true}),clip(v,{role:"voice",durationFrames:120})],{[m]:tone("m2.wav",220,4,0.2),[v]:silence("v.wav",4)}));
    expect(dB(amp(quiet.mix,220,SR,3*SR)/0.2)).toBeCloseTo(0,1);
  },60000);
});

describe("음량 맞춤·AAC·검사",()=>{
  it("정상: 같은 믹스 2회 loudnorm → AAC-LC 48k 2ch를 무음 영상에 결합, 최종 I·TP를 다시 재서 기준 안, 길이·지연·원본 그대로",async()=>{
    const m=id(),v=id(),music=tone("music.wav",220,6,0.1),voice=source("v.wav","aevalsrc=0.4*sin(2*PI*1000*t)*lt(mod(t\\,1)\\,0.5):s=48000:d=6"),movie=video(150);
    const before=[music,voice,movie].map(item=>sha(item.path)),out=join(root,"final.mp4");
    let work="";const result=await mixAudio({...request(150,[clip(m,{durationFrames:150,duckUnderVoice:true,fadeInFrames:15,fadeOutFrames:15}),clip(v,{role:"voice",startFrame:15,durationFrames:120,gainDb:-3})],{[m]:music,[v]:voice}),video:movie,outputPath:out},{keepWork:true,onWork:path=>{work=path;}}) as ProcessedMix;
    writeFileSync(join(root,"mix-copy.f32"),readFileSync(join(work,"mix.f32")));rmSync(work,{recursive:true,force:true});
    expect(result.status).toBe("normalized");expect(result.accepted).toBe(true);expect(result.profile).toBe(PROFILE_ID);
    expect(Math.abs(result.final.integrated-LOUDNESS.integrated)).toBeLessThanOrEqual(ACCEPT.integratedTolerance);expect(result.final.truePeak).toBeLessThanOrEqual(ACCEPT.truePeakMax);
    expect(result.loudness!.stats.mixSha256).toBe(result.mix.sha256);expect(["linear","dynamic"]).toContain(result.loudness!.secondPass.normalizationType);
    expect(result.output).toMatchObject({container:"mp4",video:true,decodedSamples:150*F,audio:{codec:"aac",profile:"LC",sampleRate:48000,channels:2}});
    expect(result.output.audio.initialPadding).toBe(1024);// encoder delay is signalled and removed on decode
    // first sample above -60 dBFS: AAC pre-echo may start it a little early, never late
    expect(result.mix.firstAboveSample!-result.output.firstAboveSample!).toBeGreaterThanOrEqual(0);expect(result.mix.firstAboveSample!-result.output.firstAboveSample!).toBeLessThanOrEqual(256);
    // alignment: the decoded AAC matches the f32 mix best at lag 0 (encoder delay removed, nothing shifted)
    expect(bestLag(f32(join(root,"mix-copy.f32")),decode(out),Math.round(2.0*SR),Math.round(2.5*SR))).toBe(0);
    expect(sha(out)).toBe(result.output.sha256);expect([music,voice,movie].map(item=>sha(item.path))).toEqual(before);
    expect(workLeft()).toEqual([]);
    const summary=JSON.stringify({final:result.final,loudness:result.loudness,output:{...result.output,path:"<out>"},mix:result.mix,tools:result.tools});writeFileSync(join(root,"x.json"),summary);
    console.log(`T134-EVIDENCE ${summary}`);
  },120000);
  it("디지털 무음은 음량을 맞추지 않음(silent), 3초 미만은 too_short, 소리 없음은 아무 파일도 만들지 않음(no_audio)",async()=>{
    const s=id(),silent=await mixAudio(request(120,[clip(s,{durationFrames:120})],{[s]:silence("s.wav",4)})) as ProcessedMix;
    expect(silent.status).toBe("silent");expect(silent.loudness).toBeNull();expect(silent.accepted).toBeNull();expect(silent.mix.peak).toBe(0);expect(silent.output.decodedSamples).toBe(120*F);
    const t=id(),short=await mixAudio(request(60,[clip(t,{durationFrames:60})],{[t]:tone("short.wav",440,2)})) as ProcessedMix;
    expect(short.status).toBe("too_short");expect(short.loudness).toBeNull();expect(short.output.decodedSamples).toBe(60*F);
    const none=request(60,[],{});expect(await mixAudio(none)).toEqual({status:"no_audio"});expect(existsSync(none.outputPath)).toBe(false);
    expect(workLeft()).toEqual([]);
  },120000);
  it("측정 불가(게이트 아래 아주 작은 소리)는 실패로 구분, 결과 파일 없음",async()=>{
    const q=id(),value=request(120,[clip(q,{durationFrames:120})],{[q]:tone("quiet.wav",440,4,0.00001,48000,["-c:a","pcm_f32le"])});
    await expect(mixAudio(value)).rejects.toMatchObject({code:"LOUDNESS_UNMEASURABLE"});expect(existsSync(value.outputPath)).toBe(false);expect(workLeft()).toEqual([]);
  },60000);
  it("음량 범위: 아주 작은 믹스는 올리고, 0 LUFS를 넘는 믹스는 고정 사전 감쇠 뒤 맞추고, 띄엄띄엄 클릭은 기준 밖이라 실패(기준을 바꾸지 않음)",async()=>{
    const q=id(),quiet=await mixAudio(request(150,[clip(q,{durationFrames:150})],{[q]:tone("lo.wav",220,6,0.01)})) as ProcessedMix;
    expect(quiet.loudness!.stats.inputI).toBeLessThan(-35);expect(quiet.loudness!.stats.preGainDb).toBe(0);expect(quiet.accepted).toBe(true);expect(Math.abs(quiet.final.integrated+14)).toBeLessThanOrEqual(1);
    const m=id(),v=id(),loud=await mixAudio(request(150,[clip(m,{durationFrames:150}),clip(v,{role:"voice",durationFrames:150})],{[m]:tone("hi1.wav",220,6,0.9),[v]:tone("hi2.wav",330,6,0.9)})) as ProcessedMix;
    expect(loud.mix.peak).toBeGreaterThan(1);// the f32 sum goes above full scale; nothing is clipped before loudness
    expect(loud.loudness!.stats.preGainDb).toBeLessThan(-14);expect(loud.loudness!.stats.mixSha256).not.toBe(loud.mix.sha256);
    expect(loud.accepted).toBe(true);expect(Math.abs(loud.final.integrated+14)).toBeLessThanOrEqual(1);expect(loud.final.truePeak).toBeLessThanOrEqual(-1);
    const c=id(),value=request(150,[clip(c,{role:"effect",durationFrames:150})],{[c]:source("clicks.wav","aevalsrc=0.9*sin(2*PI*2000*t)*lt(mod(t\\,0.5)\\,0.01):s=48000:d=6")});
    await expect(mixAudio(value)).rejects.toMatchObject({code:"LOUDNESS_OUT_OF_RANGE"});expect(existsSync(value.outputPath)).toBe(false);expect(workLeft()).toEqual([]);
  },120000);
  it("두 번째 pass는 같은 믹스·프로필·도구만",()=>{
    const stats:LoudnessStats={profile:PROFILE_ID,preGainDb:0,mixSha256:"a".repeat(64),ffmpegSha256:"b".repeat(64),inputI:-20,inputTp:-5,inputLra:3,inputThresh:-30,targetOffset:0.2};
    expect(checkSecondPass(stats,{mixSha256:"a".repeat(64),ffmpegSha256:"b".repeat(64),profile:PROFILE_ID})).toBe("loudnorm=I=-14:TP=-2:LRA=7:measured_I=-20:measured_TP=-5:measured_LRA=3:measured_thresh=-30:offset=0.2:linear=true:print_format=json,aresample=48000");
    for(const other of [{mixSha256:"c".repeat(64)},{ffmpegSha256:"c".repeat(64)},{profile:"other"}])expect(()=>checkSecondPass(stats,{mixSha256:"a".repeat(64),ffmpegSha256:"b".repeat(64),profile:PROFILE_ID,...other})).toThrow(expect.objectContaining({code:"STATS_MISMATCH"}));
    expect(ebur128Summary("Summary:\n  Integrated loudness:\n    I:         -14.2 LUFS\n  Loudness range:\n    LRA:         3.1 LU\n  True peak:\n    Peak:       -2.4 dBFS")).toEqual({integrated:-14.2,range:3.1,truePeak:-2.4});
  });
});

describe("입력·원본·실패 구분과 정리",()=>{
  it("거절: 잘못된 설정·빠진 원본·바뀐 원본·짧은 원본·채널 수·소리 아닌 파일·이미 있는 결과, 모두 결과·작업 폴더 없음",async()=>{
    const a=id(),good=tone("g.wav",440,2),cases:[unknown,string][]=[
      [request(60,[clip(a,{durationFrames:70})],{[a]:good}),"INVALID_INPUT"],
      [request(60,[clip(a)],{}),"INVALID_INPUT"],
      [{...request(60,[clip(a)],{[a]:good}),workRoot:"relative"},"INVALID_INPUT"],
      [request(60,[clip(a)],{[a]:{...good,sha256:"0".repeat(64)}}),"SOURCE_CHANGED"],
      [request(60,[clip(a,{sourceInFrame:31,durationFrames:30})],{[a]:good}),"SOURCE_TOO_SHORT"],
      [request(60,[clip(a)],{[a]:source("six.wav","aevalsrc=0.1*sin(2*PI*440*t)|0|0|0|0|0:s=48000:d=2")}),"SOURCE_UNSUPPORTED"],
    ];
    const text=join(root,"note.wav");writeFileSync(text,"not audio at all");cases.push([request(60,[clip(a)],{[a]:{path:text,sha256:sha(text),sizeBytes:readFileSync(text).length}}),"SOURCE_UNSUPPORTED"]);
    const exists=join(root,"exists.m4a");writeFileSync(exists,"keep");cases.push([{...request(60,[clip(a)],{[a]:good}),outputPath:exists},"OUTPUT_EXISTS"]);
    for(const [value,code] of cases){await expect(mixAudio(value),code).rejects.toMatchObject({code});}
    expect(readFileSync(exists,"utf8")).toBe("keep");expect(sha(good.path)).toBe(good.sha256);expect(workLeft()).toEqual([]);
  },120000);
  it("취소·시간 초과: 도구 프로세스를 끝내고 기다린 뒤 작업 폴더를 지움, 결과 없음",async()=>{
    const a=id(),long=tone("long.wav",440,600,0.2,48000);
    for(const kind of ["cancel","timeout"] as const){
      const controller=new AbortController(),pids:number[]=[],value=request(600*30,[clip(a,{durationFrames:600*30})],{[a]:long});
      const promise=mixAudio(value,{signal:controller.signal,timeoutMs:kind==="timeout"?2500:undefined,onPid:pid=>{pids.push(pid);if(kind==="cancel"&&pids.length===3)setTimeout(()=>controller.abort(),300);}});
      await expect(promise).rejects.toMatchObject({code:kind==="cancel"?"CANCELED":"TIMEOUT"});
      for(const pid of pids)expect(()=>process.kill(pid,0),`pid ${pid}`).toThrow();
      expect(existsSync(value.outputPath)).toBe(false);expect(workLeft()).toEqual([]);
    }
  },180000);
  it("저장 공간 부족: 도구 오류 문구와 파일 쓰기 ENOSPC 모두 DISK_FULL, 작업 폴더 정리",async()=>{
    await expect(runTool(process.execPath,["-e","console.error('Error writing trailer: No space left on device');process.exit(1)"],{})).rejects.toMatchObject({code:"DISK_FULL"});
    await expect(runTool(process.execPath,["-e","process.exit(3)"],{})).rejects.toMatchObject({code:"TOOL_FAILED"});
    const a=id(),value=request(120,[clip(a,{durationFrames:120})],{[a]:tone("d.wav",440,4)});let calls=0;
    const full=async(binary:string,args:readonly string[],options:Parameters<typeof runTool>[2])=>{if(args.includes("-filter_complex")&&++calls)throw Object.assign(new Error("write failed"),{code:"ENOSPC"});return runTool(binary,args,options);};
    await expect(mixAudio(value,{run:full})).rejects.toMatchObject({code:"DISK_FULL"});expect(calls).toBe(1);expect(workLeft()).toEqual([]);expect(existsSync(value.outputPath)).toBe(false);
    expect(new AudioError("CANCELED","x").name).toBe("AudioError");
  },60000);
});
