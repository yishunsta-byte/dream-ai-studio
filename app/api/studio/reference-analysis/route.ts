import { studioAnalysisConnection } from "@/lib/reference-analysis/studio-analysis-connection";
import { createStudioAnalysisPost } from "@/lib/reference-analysis/studio-analysis-http";

export const runtime = "nodejs";

export const POST = createStudioAnalysisPost(studioAnalysisConnection?.post);
