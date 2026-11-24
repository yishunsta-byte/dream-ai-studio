import { requireApiAuth } from "@/lib/auth/api";
import { localProjectAudio } from "@/lib/cloud/local-project-audio";
export const runtime="nodejs";
async function projectAudioRequest(request:Request,{params}:{params:Promise<{id:string;assetId:string}>}) {
  if (process.env.DREAM_PROJECT_CREATE_BACKEND !== "owned-pg17" || process.env.DREAM_PRIVATE_UPLOAD_BACKEND !== "owned-pg17") {
    const denied = await requireApiAuth();
    if (denied) return denied;
    return Response.json({code:"PROJECT_AUDIO_UNAVAILABLE"},{status:503,headers:{"cache-control":"no-store"}});
  }
  return localProjectAudio(request,params);
}

export { projectAudioRequest as GET, projectAudioRequest as PUT };
