import { createAdminReferenceHttp } from "@/lib/reference-analysis/admin-reference-http";
import { currentGeminiSettings } from "@/lib/reference-analysis/analysis-gemini-settings";
import { geminiImageAnalyzer } from "@/lib/reference-analysis/image-semantic-gemini";
import { analyzeLocalMediaUpload, analyzeLocalMediaUrl } from "@/lib/reference-analysis/local-media-url";

export const runtime = "nodejs";
export const maxDuration = 45;

const route = createAdminReferenceHttp({
  analyze: analyzeLocalMediaUrl,
  analyzeUpload: analyzeLocalMediaUpload,
  async loadImageSemantics(owner) {
    const settings = await currentGeminiSettings(owner, "image");
    return settings && geminiImageAnalyzer(settings);
  },
});

export const GET = route.capabilities;
export const POST = route.analyze;
