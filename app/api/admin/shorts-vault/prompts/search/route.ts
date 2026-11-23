import { shortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";

// P1-08-SHORTS-VAULT-CONTENT-SEARCH-API: 프롬프트 세트 내용 검색. 목록(GET)·저장(POST)·삭제는 기존 경로 그대로다.
export const runtime = "nodejs";
export function POST(request: Request) {
  return shortsVaultHttp.searchPromptSets(request);
}
