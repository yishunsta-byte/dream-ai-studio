import { createAdminReferenceHttp } from "@/lib/reference-analysis/admin-reference-http";

export const runtime = "nodejs";
export const maxDuration = 45;

export const POST = createAdminReferenceHttp().analyze;
