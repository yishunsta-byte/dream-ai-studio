import { adminAudioUploads } from "@/lib/reference-analysis/admin-audio-upload-http";

export const runtime = "nodejs";
export const maxDuration = 180;
export function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  return adminAudioUploads.get(route, request);
}
export const POST = adminAudioUploads.command;
