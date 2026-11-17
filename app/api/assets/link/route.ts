import { requireApiAuth } from "@/lib/auth/api";
import { registerLink } from "@/lib/services/library";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
export async function POST(request:Request){
 const denied=await requireApiAuth();if(denied)return denied;
try{return Response.json({id:registerLink(await request.json())},{status:201});}catch(error){return mediaErrorResponse(error);}}
