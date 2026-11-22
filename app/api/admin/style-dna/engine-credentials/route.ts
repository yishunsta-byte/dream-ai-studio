import { createStyleDnaEngineCredentialHttp } from "@/lib/reference-analysis/style-dna-engine-credential-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createStyleDnaEngineCredentialHttp();
export const GET = handlers.get;
export const PUT = handlers.put;
