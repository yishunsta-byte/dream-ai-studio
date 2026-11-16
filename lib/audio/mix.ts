import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { audioClipV2Schema, audioIssues, audioJoinSchema } from "@/lib/edit/timeline";
import { mixGraph, type GraphClip } from "./graph";
import { scanner, sha256File, type PcmScan } from "./pcm";
import { AAC, ACCEPT, CHANNELS, DEFAULT_TIMEOUT_MS, LOUDNESS, MAX_CLIPS, MAX_OUTPUT_FRAMES, MIN_NORMALIZE_FRAMES, PREGAIN_ABOVE_LUFS, PROFILE_ID, SAMPLE_RATE, SAMPLES_PER_FRAME } from "./profile";
import { AudioError, fsFailure, runTool, type ToolRunner } from "./run";

// P2-5B offline sound processing (T-130 5장 1~7, T-134). Not connected to the render worker yet (step C).
// One call: pin the source files (hash while copying into an owned work folder), check each source (one audio stream,
// mono or stereo, enough decoded samples), build the fixed mix as f32 PCM of exactly outputFrames × 1600 samples,
// classify it (digital silence / too short / measurable), measure loudness once, apply the second pass only to the
// same mix bytes with the same profile and tools, encode AAC-LC (optionally muxed with a given silent video), check the
// result (stream, decoded length) and measure it again. Only a checked result is copied to `outputPath`; the work
// folder is removed on every exit (success, failure, cancel, timeout) unless keepWork.
const hex64=z.string().regex(/^[0-9a-f]{64}$/);
const pinned=z.strictObject({path:z.string().min(1).refine(isAbsolute,{message:"absolute path"}),sha256:hex64,sizeBytes:z.number().int().min(1)});
export const mixRequestSchema=z.strictObject({
  outputFrames:z.number().int().min(1).max(MAX_OUTPUT_FRAMES),
  audio:z.array(audioClipV2Schema).max(MAX_CLIPS),audioJoins:z.array(audioJoinSchema).max(MAX_CLIPS),
  sources:z.record(z.uuid(),pinned),video:pinned.nullable(),
  outputPath:z.string().min(1).refine(isAbsolute,{message:"absolute path"}),workRoot:z.string().min(1).refine(isAbsolute,{message:"absolute path"}),
});
export type MixRequest=z.infer<typeof mixRequestSchema>;
export type MixOptions={signal?:AbortSignal;timeoutMs?:number;keepWork?:boolean;tools?:{ffmpeg:string;ffprobe:string};run?:ToolRunner;onWork?:(path:string)=>void;onPid?:(pid:number)=>void};
export type LoudnessStats={profile:typeof PROFILE_ID;preGainDb:number;mixSha256:string;ffmpegSha256:string;inputI:number;inputTp:number;inputLra:number;inputThresh:number;targetOffset:number};
export type FinalMeasure={integrated:number;range:number;truePeak:number};
export type ProcessedMix={status:"normalized"|"silent"|"too_short";profile:typeof PROFILE_ID;tools:{ffmpeg:string;ffmpegSha256:string};
    sources:{assetId:string;sha256:string;channels:1|2;decodedSamples:number}[];
    mix:{sha256:string;samples:number;peak:number;firstAboveSample:number|null};
    loudness:null|{stats:LoudnessStats;secondPass:{normalizationType:string;outputI:number;outputTp:number}};
    output:{path:string;sha256:string;sizeBytes:number;container:"mp4"|"m4a";audio:{codec:string;profile:string;sampleRate:number;channels:number;bitRate:number|null;initialPadding:number|null};
      decodedSamples:number;firstAboveSample:number|null;video:boolean};
    final:FinalMeasure;accepted:boolean|null};
export type MixResult={status:"no_audio"}|ProcessedMix;

const toolCache=new Map<string,{key:string;sha256:string;version:string}>();
async function toolIdentity(ffmpeg:string,run:ToolRunner,deadline:number,signal?:AbortSignal){
  let key:string;try{const stat=statSync(ffmpeg);key=`${stat.size}:${stat.mtimeMs}`;}catch{throw new AudioError("TOOL_FAILED","소리 처리 도구를 찾지 못했어요.");}
  const cached=toolCache.get(ffmpeg);if(cached&&cached.key===key)return cached;
  const {sha256}=await sha256File(ffmpeg);let out="";await run(ffmpeg,["-hide_banner","-version"],{deadline,signal,onStdout:chunk=>{out+=String(chunk);}});
  const value={key,sha256,version:out.split(/\r?\n/)[0]?.replace(/^ffmpeg version\s+/,"").split(" ")[0]??"unknown"};toolCache.set(ffmpeg,value);return value;
}
// loudnorm prints its JSON block last on stderr; values are strings ("-inf" when nothing passes the gate).
export function loudnormJson(stderr:string){const at=stderr.lastIndexOf("{"),end=stderr.lastIndexOf("}");if(at<0||end<at)throw new AudioError("LOUDNESS_UNMEASURABLE","소리의 음량을 재지 못했어요.");
  return JSON.parse(stderr.slice(at,end+1)) as Record<string,string>;}
const finite=(text:string|undefined)=>{const value=Number(text);if(text===undefined||!Number.isFinite(value))throw new AudioError("LOUDNESS_UNMEASURABLE","소리의 음량을 재지 못했어요. 아주 작은 소리만 있으면 음량을 맞추지 않아요.",String(text));return value;};
// ebur128 summary: integrated, range and (peak=true) true peak, all on the decoded final audio.
export function ebur128Summary(stderr:string):FinalMeasure{
  const summary=stderr.slice(stderr.lastIndexOf("Summary:"));const pick=(pattern:RegExp)=>{const match=pattern.exec(summary);return match?Number(match[1]):Number.NaN;};
  return {integrated:pick(/I:\s+(-?[\d.]+|-inf)\s+LUFS/),range:pick(/LRA:\s+(-?[\d.]+)\s+LU/),truePeak:pick(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/)};
}
// The second pass is allowed only for the same mix bytes, profile and tool that the first pass measured.
export function checkSecondPass(stats:LoudnessStats,current:{mixSha256:string;ffmpegSha256:string;profile:string}){
  if(stats.profile!==current.profile||stats.mixSha256!==current.mixSha256||stats.ffmpegSha256!==current.ffmpegSha256)throw new AudioError("STATS_MISMATCH","처음 잰 소리와 지금 소리가 달라 음량 맞추기를 하지 않았어요.");
  const n=(value:number)=>Number(value.toFixed(2));
  return `loudnorm=I=${LOUDNESS.integrated}:TP=${LOUDNESS.truePeak}:LRA=${LOUDNESS.range}:measured_I=${n(stats.inputI)}:measured_TP=${n(stats.inputTp)}:measured_LRA=${n(stats.inputLra)}:measured_thresh=${n(stats.inputThresh)}:offset=${n(stats.targetOffset)}:linear=true:print_format=json,aresample=${SAMPLE_RATE}`;
}
async function copyPinned(from:string,to:string,expect:{sha256:string;sizeBytes:number},what:string){
  const hash=createHash("sha256");let size=0;
  try{await pipeline(createReadStream(from),async function*(source){for await(const chunk of source){hash.update(chunk as Buffer);size+=(chunk as Buffer).length;yield chunk;}},createWriteStream(to,{flags:"wx"}));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new AudioError("SOURCE_CHANGED",`${what} 파일을 찾지 못했어요.`);throw fsFailure(error);}
  if(hash.digest("hex")!==expect.sha256||size!==expect.sizeBytes)throw new AudioError("SOURCE_CHANGED",`${what} 파일이 고를 때와 달라졌어요.`);
  chmodSync(to,0o444);
}

export async function mixAudio(input:unknown,options:MixOptions={}):Promise<MixResult>{
  const parsed=mixRequestSchema.safeParse(input);if(!parsed.success)throw new AudioError("INVALID_INPUT","소리 설정을 확인해 주세요.",parsed.error.issues[0]?.message??null);
  const request=parsed.data,rights=[...new Set(request.audio.map(clip=>clip.assetId))].map(assetId=>({assetId,sourceUrl:null,planName:null,createdOn:null,licenseNote:null}));
  const issues=audioIssues({video:[{durationFrames:request.outputFrames}],text:[],audio:request.audio,audioJoins:request.audioJoins,audioRights:rights});
  if(issues.length)throw new AudioError("INVALID_INPUT",issues[0].message,issues[0].path.join("."));
  for(const clip of request.audio)if(!request.sources[clip.assetId])throw new AudioError("INVALID_INPUT","소리 파일 정보가 빠졌어요.",clip.assetId);
  if(existsSync(request.outputPath))throw new AudioError("OUTPUT_EXISTS","결과 파일이 이미 있어요. 덮어쓰지 않아요.");
  if(options.signal?.aborted)throw new AudioError("CANCELED","소리 처리를 취소했어요.");
  if(!request.audio.length)return {status:"no_audio"};// nothing to add: the caller keeps its silent path (0 audio streams)
  const run=options.run??runTool,ffmpeg=options.tools?.ffmpeg??(await import("@/lib/media/tools")).mediaBinary("ffmpeg"),ffprobe=options.tools?.ffprobe??(await import("@/lib/media/tools")).mediaBinary("ffprobe");
  const deadline=Date.now()+(options.timeoutMs??DEFAULT_TIMEOUT_MS),signal=options.signal,base={deadline,signal,onPid:options.onPid};
  let work:string;try{work=mkdtempSync(join(request.workRoot,"dream-audio-"));}catch(error){throw fsFailure(error);}
  options.onWork?.(work);
  try{
    const tool=await toolIdentity(ffmpeg,run,deadline,signal),total=request.outputFrames*SAMPLES_PER_FRAME;
    // 1. pinned copies, read-only, hashed while copied (the originals are only read)
    mkdirSync(join(work,"in"));const assetIds=[...new Set(request.audio.map(clip=>clip.assetId))],copies=new Map<string,string>();
    for(const [index,assetId] of assetIds.entries()){const to=join(work,"in",`a${index}`);await copyPinned(request.sources[assetId].path,to,request.sources[assetId],"소리");copies.set(assetId,to);}
    let video:string|null=null;if(request.video){video=join(work,"in","video");await copyPinned(request.video.path,video,request.video,"영상");}
    // 2. each source: one audio stream, mono/stereo, decoded length covers every part used
    const sources:ProcessedMix["sources"]=[];
    for(const assetId of assetIds){
      const copy=copies.get(assetId)!;let probe="";
      try{await run(ffprobe,["-v","error","-select_streams","a","-show_entries","stream=index,channels,codec_name","-of","json",copy],{...base,onStdout:chunk=>{probe+=String(chunk);}});}
      catch(error){if(error instanceof AudioError&&error.code==="TOOL_FAILED")throw new AudioError("SOURCE_UNSUPPORTED","소리 파일을 읽지 못했어요. 다른 파일이나 변환한 파일을 골라 주세요.",assetId);throw error;}
      const streams=(JSON.parse(probe||"{}") as {streams?:{channels?:number}[]}).streams??[];
      if(!streams.length)throw new AudioError("SOURCE_UNSUPPORTED","소리가 들어 있지 않은 파일이에요.",assetId);
      const channels=streams[0].channels;if(channels!==1&&channels!==2)throw new AudioError("SOURCE_UNSUPPORTED","한 채널이나 두 채널 소리만 쓸 수 있어요.",assetId);
      let bytes=0;
      try{await run(ffmpeg,["-v","error","-i",copy,"-map","0:a:0","-ac","1","-ar",String(SAMPLE_RATE),"-f","f32le","-"],{...base,onStdout:chunk=>{bytes+=chunk.length;}});}
      catch(error){if(error instanceof AudioError&&error.code==="TOOL_FAILED")throw new AudioError("SOURCE_UNSUPPORTED","소리 파일을 끝까지 읽지 못했어요. 손상됐거나 지원하지 않는 형식이에요.",assetId);throw error;}
      const decoded=Math.floor(bytes/4),need=Math.max(...request.audio.filter(clip=>clip.assetId===assetId).map(clip=>(clip.sourceInFrame+clip.durationFrames)*SAMPLES_PER_FRAME));
      if(decoded<need)throw new AudioError("SOURCE_TOO_SHORT","소리 파일이 쓰려는 구간보다 짧아요. 늘리거나 반복하지 않아요.",assetId);
      sources.push({assetId,sha256:request.sources[assetId].sha256,channels,decodedSamples:decoded});
    }
    // 3. the fixed mix (f32 PCM, exactly outputFrames × 1600 sample frames)
    const incoming=new Map(request.audioJoins.map(join=>[join.toClipId,join.durationFrames])),outgoing=new Map(request.audioJoins.map(join=>[join.fromClipId,join.durationFrames]));
    const graph:GraphClip[]=request.audio.map((clip,index)=>({input:index,channels:sources.find(item=>item.assetId===clip.assetId)!.channels,role:clip.role,startFrame:clip.startFrame,sourceInFrame:clip.sourceInFrame,durationFrames:clip.durationFrames,gainDb:clip.gainDb,
      fadeIn:incoming.has(clip.id)?{frames:incoming.get(clip.id)!,curve:"qsin"}:{frames:clip.fadeInFrames,curve:"tri"},fadeOut:outgoing.has(clip.id)?{frames:outgoing.get(clip.id)!,curve:"qsin"}:{frames:clip.fadeOutFrames,curve:"tri"},duck:clip.duckUnderVoice}));
    const mixPath=join(work,"mix.f32");
    await run(ffmpeg,["-v","error","-nostdin",...request.audio.flatMap(clip=>["-i",copies.get(clip.assetId)!]),"-filter_complex",mixGraph(graph,request.outputFrames),"-map","[out]","-c:a","pcm_f32le","-f","f32le",mixPath],base);
    const mix:PcmScan=await (async()=>{const scan=scanner(CHANNELS);for await(const chunk of createReadStream(mixPath))scan.push(chunk as Buffer);return scan.done();})();
    if(mix.frames!==total||mix.bytes!==total*CHANNELS*4||mix.nonFinite)throw new AudioError("OUTPUT_INVALID","만든 소리의 길이나 값이 맞지 않아요.",`${mix.frames}/${total} nonFinite ${mix.nonFinite}`);
    // 4. classify; measure once; second pass only on the same bytes/profile/tool
    const status:"normalized"|"silent"|"too_short"=mix.peak===0?"silent":request.outputFrames<MIN_NORMALIZE_FRAMES?"too_short":"normalized";
    const rawOf=(path:string)=>["-f","f32le","-ar",String(SAMPLE_RATE),"-ac",String(CHANNELS),"-i",path];let measured=mixPath;
    let loudness:ProcessedMix["loudness"]=null,filter:string|null=null;
    if(status==="normalized"){
      const measure=async(path:string)=>{const first=loudnormJson((await run(ffmpeg,["-hide_banner","-nostdin",...rawOf(path),"-af",`loudnorm=I=${LOUDNESS.integrated}:TP=${LOUDNESS.truePeak}:LRA=${LOUDNESS.range}:print_format=json`,"-f","null","-"],base)).stderr);
        return {inputI:finite(first.input_i),inputTp:finite(first.input_tp),inputLra:finite(first.input_lra),inputThresh:finite(first.input_thresh),targetOffset:finite(first.target_offset)};};
      let values=await measure(mixPath),preGainDb=0,measuredSha=mix.sha256;
      if(values.inputI>PREGAIN_ABOVE_LUFS){
        preGainDb=Number((LOUDNESS.integrated-values.inputI).toFixed(2));measured=join(work,"level.f32");
        await run(ffmpeg,["-v","error","-nostdin",...rawOf(mixPath),"-af",`volume=${preGainDb}dB`,"-c:a","pcm_f32le","-f","f32le",measured],base);
        const level=scanner(CHANNELS);for await(const chunk of createReadStream(measured))level.push(chunk as Buffer);const scan=level.done();
        if(scan.frames!==total||scan.nonFinite)throw new AudioError("OUTPUT_INVALID","음량을 낮춘 소리의 길이나 값이 맞지 않아요.");
        measuredSha=scan.sha256;values=await measure(measured);
      }
      const stats:LoudnessStats={profile:PROFILE_ID,preGainDb,mixSha256:measuredSha,ffmpegSha256:tool.sha256,...values};
      filter=checkSecondPass(stats,{mixSha256:(await sha256File(measured)).sha256,ffmpegSha256:tool.sha256,profile:PROFILE_ID});
      loudness={stats,secondPass:{normalizationType:"",outputI:Number.NaN,outputTp:Number.NaN}};
    }
    // 5. AAC-LC 48 kHz stereo 192k, muxed with the pinned silent video when given (video copied, never re-encoded)
    const container=video?"mp4":"m4a",outPath=join(work,`out.${container}`);
    const encoded=await run(ffmpeg,["-hide_banner","-nostdin",...(video?["-i",video]:[]),...rawOf(measured),...(video?["-map","0:v:0","-map","1:a:0","-c:v","copy"]:["-map","0:a:0"]),...(filter?["-af",filter]:[]),
      "-c:a",AAC.codec,"-profile:a",AAC.profile,"-b:a",AAC.bitrate,"-ar",String(SAMPLE_RATE),"-ac",String(CHANNELS),"-map_metadata","-1","-fflags","+bitexact","-flags:a","+bitexact",outPath],base);
    if(loudness){const second=loudnormJson(encoded.stderr);loudness.secondPass={normalizationType:String(second.normalization_type),outputI:Number(second.output_i),outputTp:Number(second.output_tp)};}
    // 6. check the file: one AAC-LC 48 kHz stereo stream (and the video), exact decoded length; measure it again
    let probe="";await run(ffprobe,["-v","error","-show_entries","stream=codec_type,codec_name,profile,sample_rate,channels,bit_rate,initial_padding","-of","json",outPath],{...base,onStdout:chunk=>{probe+=String(chunk);}});
    const streams=(JSON.parse(probe) as {streams:{codec_type:string;codec_name:string;profile?:string;sample_rate?:string;channels?:number;bit_rate?:string;initial_padding?:number}[]}).streams;
    const audio=streams.filter(item=>item.codec_type==="audio"),videos=streams.filter(item=>item.codec_type==="video");
    if(audio.length!==1||audio[0].codec_name!=="aac"||audio[0].profile!=="LC"||audio[0].sample_rate!==String(SAMPLE_RATE)||audio[0].channels!==CHANNELS||videos.length!==(video?1:0))throw new AudioError("OUTPUT_INVALID","만든 파일의 소리 형식이 맞지 않아요.",JSON.stringify(audio.map(item=>[item.codec_name,item.profile,item.sample_rate,item.channels])));
    const decoded=scanner(CHANNELS);await run(ffmpeg,["-v","error","-nostdin","-i",outPath,"-map","0:a:0","-ac",String(CHANNELS),"-ar",String(SAMPLE_RATE),"-f","f32le","-"],{...base,onStdout:chunk=>decoded.push(chunk)});
    const decodedScan=decoded.done();if(decodedScan.frames!==total)throw new AudioError("OUTPUT_INVALID","만든 파일의 소리 길이가 영상과 달라요.",`${decodedScan.frames}/${total}`);
    const final=ebur128Summary((await run(ffmpeg,["-hide_banner","-nostdin","-i",outPath,"-map","0:a:0","-af","ebur128=peak=true:framelog=quiet","-f","null","-"],base)).stderr);
    let accepted:boolean|null=null;
    if(status==="normalized"){accepted=Number.isFinite(final.integrated)&&Math.abs(final.integrated-LOUDNESS.integrated)<=ACCEPT.integratedTolerance&&Number.isFinite(final.truePeak)&&final.truePeak<=ACCEPT.truePeakMax;
      if(!accepted)throw new AudioError("LOUDNESS_OUT_OF_RANGE","음량을 맞춘 결과가 기준(-14±1 LUFS, 최대 -1 dBTP)을 벗어났어요.",JSON.stringify(final));}
    // 7. publish the checked file (never over an existing one)
    const out=await sha256File(outPath);
    try{copyFileSync(outPath,request.outputPath,constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")throw new AudioError("OUTPUT_EXISTS","결과 파일이 이미 있어요. 덮어쓰지 않아요.");throw fsFailure(error);}
    const published=await sha256File(request.outputPath);if(published.sha256!==out.sha256){unlinkSync(request.outputPath);throw new AudioError("OUTPUT_INVALID","결과 파일을 옮기는 중 내용이 달라졌어요.");}
    return {status,profile:PROFILE_ID,tools:{ffmpeg:tool.version,ffmpegSha256:tool.sha256},sources,mix:{sha256:mix.sha256,samples:mix.frames,peak:mix.peak,firstAboveSample:mix.firstAbove},loudness,
      output:{path:request.outputPath,sha256:out.sha256,sizeBytes:out.sizeBytes,container,audio:{codec:audio[0].codec_name,profile:audio[0].profile!,sampleRate:Number(audio[0].sample_rate),channels:audio[0].channels!,bitRate:audio[0].bit_rate?Number(audio[0].bit_rate):null,initialPadding:audio[0].initial_padding??null},
        decodedSamples:decodedScan.frames,firstAboveSample:decodedScan.firstAbove,video:!!video},final,accepted};
  }catch(error){throw fsFailure(error);}
  finally{if(!options.keepWork)rmSync(work,{recursive:true,force:true,maxRetries:3});}
}
