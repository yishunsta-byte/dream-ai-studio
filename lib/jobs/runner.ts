import "server-only";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { generationInputSchema } from "./schema";
import { jobsService } from "@/lib/services/jobs";
import { createMockProvider } from "@/lib/providers/mock";
import { ProviderFailure, type Provider } from "@/lib/providers/types";
import { receiveUpload } from "@/lib/storage/upload";
import { MediaError } from "@/lib/media/inspect";
import { WorkflowError } from "@/lib/domain/stages";
const outputSchema=z.strictObject({type:z.literal("media"),files:z.array(z.object({bytes:z.instanceof(Uint8Array),mime:z.enum(["image/png","video/mp4","audio/wav"])})).length(1),usage:z.object({costMicros:z.literal(0),currency:z.literal("KRW")}).optional()});
export async function runNextJob(handle:DatabaseHandle,options:{now?:()=>number;sleep?:(ms:number)=>Promise<void>;provider?:(input:ReturnType<typeof generationInputSchema.parse>,version:number,attempt:number)=>Provider}={}){
 const now=options.now??Date.now,sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))),service=jobsService(handle,now);service.heartbeatWorker();const job=service.claim();if(!job)return false;
 let lost=false;const heartbeat=setInterval(()=>{try{service.heartbeat(job.id,job.attempts);service.heartbeatWorker();}catch{lost=true;}},20000);
 try {
  const input=generationInputSchema.parse(JSON.parse(job.inputSnapshotJson)),provider=options.provider?.(input,job.version,job.attempts)??createMockProvider(input,job.version,job.attempts,now);
  let providerId=job.providerJobId;if(!providerId){const submitted=await provider.submit({capability:input.kind,model:input.model,prompt:input.description,params:{aspect:input.aspect,durationSec:input.durationSec}},job.idempotencyKey);if(!submitted.providerJobId)throw new ProviderFailure("UNKNOWN","샘플 제공자의 작업 번호가 없어요.");providerId=submitted.providerJobId;service.providerStarted(job.id,job.attempts,providerId);}
  let pollWait=5000;const started=Date.parse(job.startedAt);if(!job.providerJobId)await sleep(750);
  for(;;){if(lost)throw new WorkflowError("CONFLICT","작업 처리권이 만료됐어요.");const current=service.job(job.id)!;if(current.cancelRequestedAt)await provider.cancel?.(providerId);if(now()-started>15*60000)throw new ProviderFailure("TIMEOUT","작업 시간이 초과됐어요.",true);const polled=await provider.poll(providerId);
   if(polled.state==="pending"){await sleep(pollWait);pollWait=Math.min(30000,pollWait*2);service.heartbeat(job.id,job.attempts);service.heartbeatWorker();continue;}
   if(polled.state==="canceled"){service.canceled(job.id,job.attempts);break;}
   if(polled.state==="failed")throw new ProviderFailure(polled.error?.code??"UNKNOWN",polled.error?.message??"샘플 작업을 마치지 못했어요.",polled.error?.retryable);
   const output=outputSchema.parse(polled.output),file=output.files[0],extension=file.mime==="image/png"?"png":file.mime==="video/mp4"?"mp4":"wav";
   const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(file.bytes);controller.close();}});
   await receiveUpload(body,`장면-${job.version}_SAMPLE.${extension}`,asset=>{
    if(asset.mime!==file.mime)throw new ProviderFailure("UNKNOWN","결과 파일 형식을 확인할 수 없어요.");
    service.finish(job.id,job.attempts,{id:asset.id,kind:asset.kind,title:asset.title,role:"intermediate",origin:"generated",filePath:asset.filePath,mime:asset.mime,sizeBytes:asset.sizeBytes,sha256:asset.sha256,width:asset.width,height:asset.height,durationMs:asset.durationMs,generationId:job.generationId,isMock:true,rightsNote:input.kind==="video"&&file.mime==="image/png"?"샘플 · 영상 도구가 없어 이미지로 대체했어요.":"시험용 샘플 · 실제 생성 결과가 아니에요."});
   },undefined,input.projectId);break;
  }
 }catch(error){if(error instanceof WorkflowError&&error.code==="CONFLICT")return true;const code=error instanceof ProviderFailure?error.code:error instanceof MediaError?"STORAGE_FAILED":"UNKNOWN";const message=error instanceof ProviderFailure||error instanceof MediaError?error.message:"샘플 결과를 처리하지 못했어요. 입력과 저장 공간을 확인해 주세요.";try{service.fail(job.id,job.attempts,code,message);}catch(failure){if(!(failure instanceof WorkflowError&&failure.code==="CONFLICT"))throw failure;}}
 finally{clearInterval(heartbeat);}
 return true;
}
