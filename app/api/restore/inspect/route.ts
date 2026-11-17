import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { inspectRestore } from "@/lib/services/restore";
import { WorkflowError } from "@/lib/domain/stages";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
const schema=z.strictObject({backupId:z.uuidv7(),destination:z.string().trim().min(1).max(4096)});
export async function POST(request:Request){
 const denied=await requireApiAuth();if(denied)return denied;
try{const body=schema.parse(await request.json());return Response.json(await inspectRestore(body),{headers:{"cache-control":"no-store"}});}catch(error){if(error instanceof WorkflowError)return Response.json({error:error.message,code:error.code},{status:error.status});return mediaErrorResponse(error);}}
