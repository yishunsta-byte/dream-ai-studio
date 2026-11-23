import { createShortsAnalysisHttp } from "@/lib/reference-analysis/shorts-analysis-http";
import { currentGeminiSettings } from "@/lib/reference-analysis/analysis-gemini-settings";

export const runtime = "nodejs";
export const maxDuration = 120;

const handlers = createShortsAnalysisHttp({ loadSettings: owner => currentGeminiSettings(owner, "shorts") });
export const GET = handlers.get;
export const POST = handlers.post;
