import { createGeminiCredentialHttp } from "@/lib/reference-analysis/analysis-credential-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = createGeminiCredentialHttp().test;
