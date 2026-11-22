import { adminAudioUploads } from "@/lib/reference-analysis/admin-audio-upload-http";

export const runtime = "nodejs";
export const maxDuration = 30;
export const PUT = adminAudioUploads.append;
