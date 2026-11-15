import { registerCharacter } from "@/lib/services/library";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
export async function POST(request:Request){try{return Response.json({id:registerCharacter(await request.json())},{status:201});}catch(error){return mediaErrorResponse(error);}}
