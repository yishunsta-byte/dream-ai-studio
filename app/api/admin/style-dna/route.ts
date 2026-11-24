import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
// The analysis pipeline can take 60 seconds before the final storage write.
export const maxDuration = 90;
export const GET = styleDnaHttp.list;
export const POST = styleDnaHttp.analyze;
