import { createYouTubeCredentialHttp } from "@/lib/reference-analysis/youtube-credential-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createYouTubeCredentialHttp();
export const GET = handlers.get;
export const PUT = handlers.put;
