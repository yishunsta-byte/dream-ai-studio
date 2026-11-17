import "server-only";
import { AUTH_MESSAGES } from "./config";
import { resolveServerAuth, type ServerAuthResult } from "./resolve";

const MESSAGES = { AUTH_REQUIRED: AUTH_MESSAGES.required, AUTH_FORBIDDEN: AUTH_MESSAGES.forbidden, AUTH_UNAVAILABLE: AUTH_MESSAGES.unavailable } as const;

// 거절 결과를 API 응답으로 바꾼다: {error, code}, no-store, 리다이렉트 없음.
export function authDeniedResponse(result: Extract<ServerAuthResult, { kind: "denied" }>) {
  return Response.json({ error: MESSAGES[result.code], code: result.code }, { status: result.status, headers: { "cache-control": "no-store" } });
}

// 기존 보호 API용 호환 함수(T-191): 공통 판별 결과를 예전처럼 Response|null로 돌려준다.
// 모든 보호 라우트는 params·본문·데이터를 건드리기 전에 이것을 부른다. 새 읽기 API는 resolveServerAuth를 한 번 불러
// denied면 authDeniedResponse, verified면 userId를 actor에 넘긴다(같은 핸들러에서 두 번 부르지 않는다).
export async function requireApiAuth(): Promise<Response | null> {
  const result = await resolveServerAuth();
  return result.kind === "denied" ? authDeniedResponse(result) : null;
}
