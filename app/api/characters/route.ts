import { requireApiAuth } from "@/lib/auth/api";
import { registerCharacter } from "@/lib/services/library";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
export async function POST(request:Request){
 const denied=await requireApiAuth();if(denied)return denied;
try{return Response.json({id:registerCharacter(await request.json())},{status:201});}catch(error){return mediaErrorResponse(error);}}
