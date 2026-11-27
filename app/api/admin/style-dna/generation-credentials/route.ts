import { createStyleDnaGenerationCredentialHttp } from "@/lib/reference-analysis/style-dna-generation-credential-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createStyleDnaGenerationCredentialHttp();
export const GET = handlers.get;
export const PUT = handlers.put;
