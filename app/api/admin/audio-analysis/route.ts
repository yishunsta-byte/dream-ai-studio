import { createAdminAudioAnalysisPost } from "@/lib/reference-analysis/admin-audio-analysis-server";
import { currentGeminiSettings } from "@/lib/reference-analysis/analysis-gemini-settings";

export const runtime = "nodejs";
export const maxDuration = 90;

export const POST = createAdminAudioAnalysisPost({ settings: owner => currentGeminiSettings(owner, "music") });
