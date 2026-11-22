import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
export const maxDuration = 55;
export function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return styleDnaHttp.refine(request, route);
}
