import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
export function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  return styleDnaHttp.get(route);
}
export function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  return styleDnaHttp.compare(request, route);
}

export function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  return styleDnaHttp.remove(request, route);
}
