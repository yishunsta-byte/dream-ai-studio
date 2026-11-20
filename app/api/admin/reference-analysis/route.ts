import { createAdminReferenceHttp } from "@/lib/reference-analysis/admin-reference-http";
import { createGeminiImageAnalysis } from "@/lib/reference-analysis/image-semantic-gemini";
import { analyzeLocalMediaUpload, analyzeLocalMediaUrl } from "@/lib/reference-analysis/local-media-url";

export const runtime = "nodejs";
export const maxDuration = 45;

const route = createAdminReferenceHttp({
  analyze: analyzeLocalMediaUrl,
  analyzeUpload: analyzeLocalMediaUpload,
  analyzeImageSemantics: createGeminiImageAnalysis(process.env),
});

export const GET = route.capabilities;
export const POST = route.analyze;
