import { shortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";

export const runtime = "nodejs";
export function GET() {
  return shortsVaultHttp.listPromptSets();
}
export function POST(request: Request) {
  return shortsVaultHttp.createPromptSet(request);
}
