import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
export const maxDuration = 55;
export const GET = styleDnaHttp.list;
export const POST = styleDnaHttp.analyze;
