import { shortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";

export const runtime = "nodejs";
export function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  return shortsVaultHttp.getPromptSet(route);
}
export function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  return shortsVaultHttp.deletePromptSet(request, route);
}
