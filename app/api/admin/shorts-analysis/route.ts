import { createShortsAnalysisHttp } from "@/lib/reference-analysis/shorts-analysis-http";

export const runtime = "nodejs";
export const maxDuration = 35;

const handlers = createShortsAnalysisHttp();
export const GET = handlers.get;
export const POST = handlers.post;
