import { requireApiAuth } from "@/lib/auth/api";
import { saveProjectTimeline } from "@/lib/cloud/local-timeline-audio";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  if (process.env.DREAM_PROJECT_CREATE_BACKEND!=="owned-pg17" || process.env.DREAM_PRIVATE_UPLOAD_BACKEND!=="owned-pg17") {
    return await requireApiAuth() ?? Response.json({code:"TIMELINE_UNAVAILABLE"},{status:503,headers:{"cache-control":"no-store"}});
  }
  return saveProjectTimeline(request,params,"audio");
}
