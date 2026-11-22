import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
export function GET(_request: Request, route: { params: Promise<{ id: string; media: string }> }) {
  return styleDnaHttp.media(route);
}
