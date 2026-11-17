import { requireApiAuth } from "@/lib/auth/api";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { WorkflowError } from "@/lib/domain/stages";
import { exportDownload } from "@/lib/services/exports";
import { MediaError } from "@/lib/media/inspect";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireApiAuth();if(denied)return denied;
try{const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"파일을 찾을 수 없어요."},{status:404});const file=await exportDownload(id);return new Response(Readable.toWeb(createReadStream(file.filename)) as ReadableStream,{headers:{"content-type":"application/zip","content-length":String(file.sizeBytes),"content-disposition":`attachment; filename="editing-bundle.zip"; filename*=UTF-8''${encodeURIComponent(file.title)}`,"x-content-type-options":"nosniff","cache-control":"private, no-store"}});}catch(error){return Response.json({error:error instanceof WorkflowError||error instanceof MediaError?error.message:"파일을 읽지 못했어요. 저장 위치를 확인해 주세요."},{status:error instanceof WorkflowError||error instanceof MediaError?error.status:503});}}
