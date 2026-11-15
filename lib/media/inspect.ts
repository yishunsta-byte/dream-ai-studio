import "server-only";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import { z } from "zod";
import { mediaBinary, runMedia } from "./tools";

export class MediaError extends Error {constructor(public code:string,message:string,public status=400){super(message);}}
const formats:Record<string,{kind:"image"|"video"|"audio"|"doc";extensions:string[];extension:string}>={
 "image/png":{kind:"image",extensions:["png"],extension:"png"},"image/jpeg":{kind:"image",extensions:["jpg","jpeg"],extension:"jpg"},"image/webp":{kind:"image",extensions:["webp"],extension:"webp"},
 "video/mp4":{kind:"video",extensions:["mp4"],extension:"mp4"},"video/quicktime":{kind:"video",extensions:["mov"],extension:"mov"},"video/webm":{kind:"video",extensions:["webm"],extension:"webm"},
 "audio/mpeg":{kind:"audio",extensions:["mp3"],extension:"mp3"},"audio/wav":{kind:"audio",extensions:["wav"],extension:"wav"},"audio/x-wav":{kind:"audio",extensions:["wav"],extension:"wav"},"audio/mp4":{kind:"audio",extensions:["m4a"],extension:"m4a"},"audio/x-m4a":{kind:"audio",extensions:["m4a"],extension:"m4a"},
 "application/pdf":{kind:"doc",extensions:["pdf"],extension:"pdf"},
};
const probeSchema=z.object({streams:z.array(z.object({codec_type:z.string(),width:z.number().optional(),height:z.number().optional(),duration:z.string().optional()})),format:z.object({duration:z.string().optional()})});
async function validateText(path:string) {
 const decoder=new TextDecoder("utf-8",{fatal:true});
 try{
  for await(const chunk of createReadStream(path)) {
   const text=decoder.decode(chunk as Buffer,{stream:true});
   for(let index=0;index<text.length;index++){const code=text.charCodeAt(index);if(code<32&&![9,10,13].includes(code))throw new Error("binary");}
  }
  decoder.decode();
 }catch{throw new MediaError("UNSUPPORTED_FORMAT","UTF-8 글자 파일이 아니에요. 실제 파일 형식을 확인해 주세요.");}
}
export async function inspectMedia(path:string,filename:string) {
 let detected;try{detected=await fileTypeFromFile(path,{signal:AbortSignal.timeout(5000)});}catch{throw new MediaError("INVALID_FILE","파일 내용을 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.");}
 const extension=extname(filename).slice(1).toLowerCase();
 if(!detected && ["txt","md"].includes(extension)) {
  await validateText(path);return {kind:"text" as const,mime:extension==="md"?"text/markdown":"text/plain",extension,width:null,height:null,durationMs:null};
 }
 const format=detected ? formats[detected.mime]:undefined;
 if(!detected || !format)throw new MediaError("UNSUPPORTED_FORMAT","지원하지 않는 형식이에요. 실제 내용이 지원 형식인 파일을 선택해 주세요.");
 if(!format.extensions.includes(extension))throw new MediaError("EXTENSION_MISMATCH",`파일 이름의 .${extension||"없음"} 확장자와 실제 ${format.extension} 형식이 달라요. 파일을 확인해 주세요.`);
 let width:number|null=null,height:number|null=null,durationMs:number|null=null;
 if(format.kind==="image") {
  try{const image=sharp(path,{limitInputPixels:40000000,failOn:"error"});const metadata=await image.metadata();await image.stats();width=metadata.width??null;height=metadata.height??null;if(!width||!height)throw new Error("dimensions");}
  catch{throw new MediaError("INVALID_IMAGE","이미지를 열 수 없거나 해상도가 너무 커요. 손상되지 않은 4천만 화소 이하 이미지를 선택해 주세요.");}
 }
 if(format.kind==="audio"||format.kind==="video") {
  let output;
  try{output=await runMedia(mediaBinary("ffprobe"),["-v","error","-protocol_whitelist","file,pipe","-show_streams","-show_format","-of","json",path],{timeout:30000,maxBuffer:1024*1024,windowsHide:true});}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new MediaError("MEDIA_TOOL_MISSING","미디어 검사 도구가 없어요. README의 미디어 도구 설치를 완료해 주세요.",503);throw new MediaError("INVALID_MEDIA","미디어 파일을 열 수 없어요. 손상되지 않은 파일을 선택해 주세요.");}
  let json:unknown;try{json=JSON.parse(output.stdout);}catch{throw new MediaError("INVALID_MEDIA","미디어 검사 응답을 확인하지 못했어요.");}
  const result=probeSchema.safeParse(json);
  if(!result.success)throw new MediaError("INVALID_MEDIA","미디어 정보를 확인하지 못했어요.");
  const stream=result.data.streams.find((item)=>item.codec_type===format.kind);
  const duration=Number(result.data.format.duration??stream?.duration);
  if(!stream || !Number.isFinite(duration)||duration<=0)throw new MediaError("INVALID_MEDIA","재생 가능한 미디어와 길이를 확인하지 못했어요.");
  durationMs=Math.round(duration*1000);width=stream.width??null;height=stream.height??null;
 }
 return {kind:format.kind,mime:detected.mime,extension:format.extension,width,height,durationMs};
}
