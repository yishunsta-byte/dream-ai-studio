import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { GenerationInput } from "@/lib/jobs/schema";
import { mediaBinary, runMedia } from "@/lib/media/tools";
import { ProviderFailure, type Provider, type ProviderOutput, type GenerationRequest } from "./types";
const dimensions={"9:16":[1080,1920],"16:9":[1920,1080],"1:1":[1080,1080]} as const;
const escape=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
export async function mockImage(input:Pick<GenerationInput,"aspect"|"title">,version:number,seed:string){const [width,height]=dimensions[input.aspect];const color=createHash("sha256").update(seed).digest("hex").slice(0,6);return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#${color}"/><rect x="40" y="40" width="${width-80}" height="${height-80}" rx="30" fill="#172636"/><g fill="white" font-family="Malgun Gothic, sans-serif" text-anchor="middle"><text x="50%" y="35%" font-size="58">샘플 · SAMPLE</text><text x="50%" y="48%" font-size="36">${escape(input.title.slice(0,24))}</text><text x="50%" y="58%" font-size="42">v${version}</text><text x="50%" y="72%" font-size="28">실제 생성 결과가 아닌 시험용 자료</text></g></svg>`)).png().toBuffer();}
export function mockSpeech(seconds:number){const sampleRate=16000,samples=Math.round(seconds*sampleRate),result=Buffer.alloc(44+samples*2);result.write("RIFF");result.writeUInt32LE(result.length-8,4);result.write("WAVEfmt ",8);result.writeUInt32LE(16,16);result.writeUInt16LE(1,20);result.writeUInt16LE(1,22);result.writeUInt32LE(sampleRate,24);result.writeUInt32LE(sampleRate*2,28);result.writeUInt16LE(2,32);result.writeUInt16LE(16,34);result.write("data",36);result.writeUInt32LE(samples*2,40);return result;}
async function mockVideo(png:Buffer,seconds:number){const root=await mkdtemp(join(tmpdir(),"dream-ai-mock-"));try{const source=join(root,"sample.png"),target=join(root,"sample.mp4");await writeFile(source,png,{flag:"wx"});await runMedia(mediaBinary("ffmpeg"),["-hide_banner","-loglevel","error","-nostdin","-loop","1","-i",source,"-t",String(Math.max(3,Math.min(5,seconds))),"-r","10","-an","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-movflags","+faststart",target],{timeout:30000,maxBuffer:1024*1024});return {bytes:await readFile(/*turbopackIgnore: true*/target),mime:"video/mp4"};}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {bytes:png,mime:"image/png"};throw new ProviderFailure("UNKNOWN","샘플 영상을 만들지 못했어요. 미디어 도구를 확인해 주세요.");}finally{if(resolve(root).startsWith(resolve(tmpdir())+sep))await rm(root,{recursive:true,force:true});}}
export function createMockProvider(input:GenerationInput,version:number,attempt=1,now:()=>number=Date.now):Provider {
 let canceled=false;let request:GenerationRequest|undefined;
 return {id:"mock",capabilities:["text","image","video","speech"],estimateCost:()=>({micros:0,currency:"KRW"}),
  submit:async(req,key)=>{if(!["text","image","video","speech"].includes(req.capability))throw new ProviderFailure("INVALID_INPUT","지원하지 않는 샘플 종류예요.");request=req;if(input.scenario==="fail:CONTENT_REJECTED")throw new ProviderFailure("CONTENT_REJECTED","시험용 콘텐츠 거절 시나리오예요. 내용을 바꾼 뒤 새로 요청해 주세요.");if(input.scenario==="fail:PROVIDER_DOWN"&&attempt===1)throw new ProviderFailure("PROVIDER_DOWN","시험용 일시 중단이에요. 잠시 뒤 다시 시도해요.",true);return {providerJobId:`mock:${now()}:${createHash("sha256").update(key).digest("hex")}`};},
  cancel:async()=>{canceled=true;},
  poll:async(id)=>{const match=/^mock:(\d+):([a-f0-9]{64})$/.exec(id);if(!match)throw new ProviderFailure("INVALID_INPUT","샘플 작업 번호를 확인해 주세요.");if(canceled&&input.scenario!=="cancel-late")return {state:"canceled"};const wait=input.scenario==="delay:10s"||input.scenario==="cancel-late"?10000:750;if(now()-Number(match[1])<wait)return {state:"pending"};let output:ProviderOutput;
   if(request?.capability==="text"){const labels=z.array(z.string()).parse(request.params.planSteps);output={type:"structured",data:labels.map(label=>({label,description:`샘플 기획 · ${label}`}))};}
   else if(input.kind==="speech")output={type:"media",files:[{bytes:mockSpeech(input.durationSec),mime:"audio/wav"}]};
   else {const png=await mockImage(input,version,match[2]);output={type:"media",files:[input.kind==="video"?await mockVideo(png,input.durationSec):{bytes:png,mime:"image/png"}]};}
   return {state:"succeeded",output:{...output,usage:{costMicros:0,currency:"KRW"}}};},
 };
}
