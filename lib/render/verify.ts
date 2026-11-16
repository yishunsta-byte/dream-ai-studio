import "server-only";
import { statSync } from "node:fs";
import { mediaBinary, runMedia } from "@/lib/media/tools";

// P2-4b output check (T-101 2.5, T-106 D-3, T-108 colour finding). The app's own ffprobe (not the renderer's
// ffmpeg) reads the file; every item must match or the render fails with RENDER_VERIFY_FAILED. P2-4 expects no audio
// track at all. Each item is recorded with its expected and actual value (T-102 14장).
export type VerifyExpect={width:number;height:number;fps:number;frames:number};
export type VerifyItem={item:string;expected:string|number;actual:string|number|null;pass:boolean};
export type VerifyResult={result:"passed"|"failed";items:VerifyItem[];probe:{codec:string|null;pixFmt:string|null;width:number|null;height:number|null;fps:string|null;frames:number|null;durationSec:number|null;audioStreams:number;otherStreams:number;sizeBytes:number}};
type Stream={codec_type?:string;codec_name?:string;pix_fmt?:string;width?:number;height?:number;r_frame_rate?:string;avg_frame_rate?:string;nb_read_frames?:string;color_range?:string;color_space?:string};
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
    item("audioStreams",0,audio.length),item("otherStreams",0,other),item("sizeBytes",">0",sizeBytes,sizeBytes>0),
  ];
  return {result:items.every(entry=>entry.pass)?"passed":"failed",items,probe:{codec:v.codec_name??null,pixFmt:v.pix_fmt??null,width:v.width??null,height:v.height??null,fps:v.r_frame_rate??null,frames,durationSec:duration,audioStreams:audio.length,otherStreams:other,sizeBytes}};
}
export async function verifyRender(file:string,expect:VerifyExpect,signal?:AbortSignal):Promise<VerifyResult>{
  const sizeBytes=statSync(/*turbopackIgnore: true*/file).size;
  const {stdout}=await runMedia(mediaBinary("ffprobe"),["-v","error","-count_frames","-show_streams","-show_format","-of","json",file],{windowsHide:true,timeout:120000,maxBuffer:8*1024*1024,signal});
  return judge(JSON.parse(String(stdout)),expect,sizeBytes);
}
