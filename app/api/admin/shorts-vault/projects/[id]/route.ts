import { shortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";

export const runtime = "nodejs";
export function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  return shortsVaultHttp.getProject(route);
}
export function PUT(request: Request, route: { params: Promise<{ id: string }> }) {
  return shortsVaultHttp.replaceProject(request, route);
}
export function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  return shortsVaultHttp.deleteProject(request, route);
}
