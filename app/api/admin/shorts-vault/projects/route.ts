import { shortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";

export const runtime = "nodejs";
export function GET() {
  return shortsVaultHttp.listProjects();
}
export function POST(request: Request) {
  return shortsVaultHttp.createProject(request);
}
