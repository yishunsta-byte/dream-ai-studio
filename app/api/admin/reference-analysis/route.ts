import { createAdminReferenceHttp } from "@/lib/reference-analysis/admin-reference-http";
import { analyzeLocalMediaUrl } from "@/lib/reference-analysis/local-media-url";

export const runtime = "nodejs";
export const maxDuration = 45;

export const POST = createAdminReferenceHttp({ analyze: analyzeLocalMediaUrl }).analyze;
