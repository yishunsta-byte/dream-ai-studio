import { requireApiAuth } from "@/lib/auth/api";
import { z } from "zod";
import { cancelRender, renderErrorBody } from "@/lib/services/renders";
export const runtime="nodejs";
// P2-4b cancel request (T-101 2.7): a queued render ends now; a running one is stopped by the worker.
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireApiAuth();if(denied)return denied;
try{const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"영상 기록을 찾을 수 없어요.",code:"NOT_FOUND"},{status:404});return Response.json({result:await cancelRender(id)});}catch(error){const {status,body}=renderErrorBody(error);return Response.json(body,{status});}}
