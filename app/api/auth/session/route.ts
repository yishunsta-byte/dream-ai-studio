import { authDeniedResponse } from "@/lib/auth/api";
import { rejectCrossSite } from "@/lib/auth/config";
import { resolveServerAuth } from "@/lib/auth/resolve";

const NO_STORE = { "cache-control": "no-store" };

// 탭 사이 계정 표시 확인(T-213, F209-1). 화면이 보여 주는 계정이 지금 이 브라우저 로그인과 같은지만 답한다.
// - 인증 전용(auth-only): 업무 데이터·SQLite·Postgres를 쓰지 않는다. getUser는 resolver 1회(+proxy 1회).
// - 이메일·사용자 id·토큰을 돌려주지 않는다. 화면에 이미 있는 계정을 보내면 same/changed만 돌려준다.
// - 거절은 기존 resolver 그대로 401/403/503 no-store. 본문은 인증·같은 사이트 확인 뒤에만 읽는다.
export async function POST(request: Request) {
  const result = await resolveServerAuth();
  if (result.kind === "denied") return authDeniedResponse(result);
  const blocked = rejectCrossSite(request, { json: true });
  if (blocked) return blocked;
  if (result.kind === "local") return Response.json({ state: "local" }, { headers: NO_STORE });
  const body = await request.json().catch(() => null) as { account?: unknown } | null;
  const account = typeof body?.account === "string" ? body.account.trim().toLowerCase() : "";
  if (!account || account.length > 320) return Response.json({ error: "요청 형식이 올바르지 않아요.", code: "INVALID_INPUT" }, { status: 400, headers: NO_STORE });
  return Response.json({ state: account === result.email.trim().toLowerCase() ? "same" : "changed" }, { headers: NO_STORE });
}
