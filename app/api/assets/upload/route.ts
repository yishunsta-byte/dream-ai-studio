import { requireApiAuth } from "@/lib/auth/api";
import { uploadAsset } from "@/lib/services/library";
import { mediaErrorResponse } from "@/lib/services/http-error";
export const runtime="nodejs";
export async function POST(request:Request){
 if (process.env.DREAM_PRIVATE_UPLOAD_BACKEND === "owned-pg17" && new URL(request.url).searchParams.get("format") === "wav") {
   const { localPrivateWav } = await import("@/lib/cloud/local-private-wav");
   return localPrivateWav(request);
 }
 if (process.env.DREAM_PRIVATE_UPLOAD_BACKEND !== undefined && process.env.DREAM_PRIVATE_UPLOAD_BACKEND !== "sqlite") {
   const { localPrivateImageUpload } = await import("@/lib/cloud/local-private-image-upload");
   return localPrivateImageUpload(request);
 }
 const denied=await requireApiAuth();if(denied)return denied;

 if(!request.body)return Response.json({error:"올릴 파일을 선택해 주세요."},{status:400});
 const url=new URL(request.url);
 try{return Response.json({id:await uploadAsset(request.body,url.searchParams.get("filename")??"",url.searchParams.get("rightsNote"),request.signal)},{status:201});}
 catch(error){return mediaErrorResponse(error);}
}
