import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
export const maxDuration = 55;
export function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  return styleDnaHttp.generationStatus(request, route);
}
export function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return styleDnaHttp.test(request, route);
}
