import "server-only";
import { statSync } from "node:fs";
import { mediaBinary, runMedia } from "@/lib/media/tools";
import { ACCEPT, LOUDNESS, PROFILE_ID, SAMPLES_PER_FRAME } from "@/lib/audio/profile";
import { runTool } from "@/lib/audio/run";
import { ebur128Summary, type ProcessedMix } from "@/lib/audio/mix";

// P2-4b output check (T-101 2.5, T-106 D-3, T-108 colour finding). The app's own ffprobe (not the renderer's
// ffmpeg) reads the file; every item must match or the render fails with RENDER_VERIFY_FAILED. P2-4 expects no audio
// track at all. Each item is recorded with its expected and actual value (T-102 14장).
// audio: "none" (default, P2-4 items unchanged) or "aac" (T-137 envelope B mix: one AAC-LC 48 kHz stereo stream).
export type VerifyExpect={width:number;height:number;fps:number;frames:number;audio?:"none"|"aac"};
export type VerifyItem={item:string;expected:string|number;actual:string|number|null;pass:boolean};
export type VerifyResult={result:"passed"|"failed";items:VerifyItem[];probe:{codec:string|null;pixFmt:string|null;width:number|null;height:number|null;fps:string|null;frames:number|null;durationSec:number|null;audioStreams:number;otherStreams:number;sizeBytes:number}};
type Stream={profile?:string;sample_rate?:string;channels?:number;codec_type?:string;codec_name?:string;pix_fmt?:string;width?:number;height?:number;r_frame_rate?:string;avg_frame_rate?:string;nb_read_frames?:string;color_range?:string;color_space?:string};
export function judge(raw:{streams?:Stream[];format?:{format_name?:string;duration?:string}},expect:VerifyExpect,sizeBytes:number):VerifyResult{
  const streams=raw.streams??[],video=streams.filter(s=>s.codec_type==="video"),audio=streams.filter(s=>s.codec_type==="audio"),other=streams.length-video.length-audio.length,v=video[0]??{};
  const frames=v.nb_read_frames!==undefined&&/^\d+$/.test(v.nb_read_frames)?Number(v.nb_read_frames):null,duration=raw.format?.duration!==undefined&&Number.isFinite(Number(raw.format.duration))?Number(raw.format.duration):null;
  const rate=`${expect.fps}/1`,item=(name:string,expected:string|number,actual:string|number|null|undefined,pass?:boolean):VerifyItem=>({item:name,expected,actual:actual??null,pass:pass??actual===expected});
  const items=[
    item("container","mp4",raw.format?.format_name?.split(",").includes("mp4")?"mp4":raw.format?.format_name??null),
    item("videoStreams",1,video.length),item("codec","h264",v.codec_name),item("pixelFormat","yuv420p",v.pix_fmt),
    item("colorRange","tv",v.color_range),item("colorSpace","bt709",v.color_space),
    item("width",expect.width,v.width),item("height",expect.height,v.height),
    item("frameRate",rate,v.r_frame_rate),item("averageFrameRate",rate,v.avg_frame_rate),
    item("frames",expect.frames,frames),
    item("durationSec",Number((expect.frames/expect.fps).toFixed(3)),duration,duration!==null&&Math.abs(duration-expect.frames/expect.fps)<=1/expect.fps),
    item("audioStreams",expect.audio==="aac"?1:0,audio.length),item("otherStreams",0,other),item("sizeBytes",">0",sizeBytes,sizeBytes>0),
  ];
  if(expect.audio==="aac"){const a=audio[0]??{};
    items.push(item("audioCodec","aac",a.codec_name),item("audioProfile","LC",a.profile),item("audioSampleRate",48000,a.sample_rate!==undefined?Number(a.sample_rate):null),item("audioChannels",2,a.channels));}
  return {result:items.every(entry=>entry.pass)?"passed":"failed",items,probe:{codec:v.codec_name??null,pixFmt:v.pix_fmt??null,width:v.width??null,height:v.height??null,fps:v.r_frame_rate??null,frames,durationSec:duration,audioStreams:audio.length,otherStreams:other,sizeBytes}};
}
export async function verifyRender(file:string,expect:VerifyExpect,signal?:AbortSignal):Promise<VerifyResult>{
  const sizeBytes=statSync(/*turbopackIgnore: true*/file).size;
  const {stdout}=await runMedia(mediaBinary("ffprobe"),["-v","error","-count_frames","-show_streams","-show_format","-of","json",file],{windowsHide:true,timeout:120000,maxBuffer:8*1024*1024,signal});
  return judge(JSON.parse(String(stdout)),expect,sizeBytes);
}

// T-137 sound checks of an envelope B mix result, measured by the worker on the final file with the app's tools:
// the decoded sample count is exactly frames × 1600; the video packets are the silent render's (no re-encode); a
// normalized result is measured again (ebur128) and judged against the fixed acceptance. Non-finite values are null.
export type AudioMeasure={integrated:number|null;range:number|null;truePeak:number|null};
export type RenderAudioRecord={mode:"aac";profile:typeof PROFILE_ID;tools:{ffmpeg:string;ffmpegSha256:string;ffprobeSha256:string};
  status:"normalized"|"silent"|"too_short";accepted:boolean|null;
  target:{integrated:number;truePeak:number;range:number;tolerance:number;truePeakMax:number};
  sources:{assetId:string;sha256:string;channels:1|2;decodedSamples:number}[];
  mix:{sha256:string;samples:number;peak:number};
  loudness:null|{preGainDb:number;inputI:number|null;inputTp:number|null;inputLra:number|null;inputThresh:number|null;targetOffset:number|null;normalizationType:string;outputI:number|null;outputTp:number|null};
  final:AudioMeasure;childFinal:AudioMeasure;
  output:{decodedSamples:number;initialPadding:number|null;videoStreamSha256:string}};
export const finiteOrNull=(value:number|null|undefined)=>typeof value==="number"&&Number.isFinite(value)?value:null;
const measureOf=(value:{integrated:number;range:number;truePeak:number}):AudioMeasure=>({integrated:finiteOrNull(value.integrated),range:finiteOrNull(value.range),truePeak:finiteOrNull(value.truePeak)});
async function streamHash(file:string,signal?:AbortSignal){let text="";await runTool(mediaBinary("ffmpeg"),["-v","error","-nostdin","-i",file,"-map","0:v:0","-c","copy","-f","streamhash","-hash","sha256","-"],{signal,onStdout:chunk=>{text+=String(chunk);}});
  return /SHA256=([0-9a-f]{64})/i.exec(text)?.[1].toLowerCase()??null;}
export async function verifyAudio(file:string,silentVideo:string,frames:number,mix:ProcessedMix,signal?:AbortSignal):Promise<{items:VerifyItem[];record:RenderAudioRecord}>{
  const ffmpeg=mediaBinary("ffmpeg");let bytes=0;
  await runTool(ffmpeg,["-v","error","-nostdin","-i",file,"-map","0:a:0","-ac","2","-ar","48000","-f","f32le","-"],{signal,onStdout:chunk=>{bytes+=chunk.length;}});
  const decoded=Math.floor(bytes/8),expectedHash=await streamHash(silentVideo,signal),actualHash=await streamHash(file,signal);
  const final=measureOf(ebur128Summary((await runTool(ffmpeg,["-hide_banner","-nostdin","-i",file,"-map","0:a:0","-af","ebur128=peak=true:framelog=quiet","-f","null","-"],{signal})).stderr));
  const normalized=mix.status==="normalized";
  const items:VerifyItem[]=[
    {item:"audioDecodedSamples",expected:frames*SAMPLES_PER_FRAME,actual:decoded,pass:decoded===frames*SAMPLES_PER_FRAME},
    {item:"audioInitialPadding",expected:"record",actual:mix.output.audio.initialPadding,pass:true},
    {item:"videoStreamSha256",expected:expectedHash??"unknown",actual:actualHash,pass:!!expectedHash&&actualHash===expectedHash},
    {item:"audioStatus",expected:"normalized|silent|too_short",actual:mix.status,pass:true},
  ];
  if(normalized)items.push(
    {item:"loudnessIntegrated",expected:`${LOUDNESS.integrated}±${ACCEPT.integratedTolerance}`,actual:final.integrated,pass:final.integrated!==null&&Math.abs(final.integrated-LOUDNESS.integrated)<=ACCEPT.integratedTolerance},
    {item:"truePeak",expected:`<=${ACCEPT.truePeakMax}`,actual:final.truePeak,pass:final.truePeak!==null&&final.truePeak<=ACCEPT.truePeakMax});
  const loud=mix.loudness;
  const record:RenderAudioRecord={mode:"aac",profile:PROFILE_ID,tools:{...mix.tools},status:mix.status,accepted:normalized?items.every(entry=>entry.pass):null,
    target:{integrated:LOUDNESS.integrated,truePeak:LOUDNESS.truePeak,range:LOUDNESS.range,tolerance:ACCEPT.integratedTolerance,truePeakMax:ACCEPT.truePeakMax},
    sources:mix.sources.map(source=>({...source})),mix:{sha256:mix.mix.sha256,samples:mix.mix.samples,peak:mix.mix.peak},
    loudness:loud?{preGainDb:loud.stats.preGainDb,inputI:finiteOrNull(loud.stats.inputI),inputTp:finiteOrNull(loud.stats.inputTp),inputLra:finiteOrNull(loud.stats.inputLra),inputThresh:finiteOrNull(loud.stats.inputThresh),targetOffset:finiteOrNull(loud.stats.targetOffset),
      normalizationType:loud.secondPass.normalizationType,outputI:finiteOrNull(loud.secondPass.outputI),outputTp:finiteOrNull(loud.secondPass.outputTp)}:null,
    final,childFinal:measureOf(mix.final),output:{decodedSamples:decoded,initialPadding:mix.output.audio.initialPadding,videoStreamSha256:actualHash??""}};
  return {items,record};
}
