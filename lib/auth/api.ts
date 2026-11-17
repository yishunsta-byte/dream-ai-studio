import "server-only";
import { AUTH_MESSAGES } from "./config";
import { LEGACY_DATA_UNAVAILABLE, legacyDataAvailable } from "./legacy-gate";
import { resolveServerAuth, type ServerAuthResult } from "./resolve";

const MESSAGES = { AUTH_REQUIRED: AUTH_MESSAGES.required, AUTH_FORBIDDEN: AUTH_MESSAGES.forbidden, AUTH_UNAVAILABLE: AUTH_MESSAGES.unavailable } as const;
const NO_STORE = { "cache-control": "no-store" };

// 거절 결과를 API 응답으로 바꾼다: {error, code}, no-store, 리다이렉트 없음.
export function authDeniedResponse(result: Extract<ServerAuthResult, { kind: "denied" }>) {
  return Response.json({ error: MESSAGES[result.code], code: result.code }, { status: result.status, headers: NO_STORE });
}

// legacy-data(기본): 이 PC의 SQLite·파일을 쓰는 기존 업무 API. 인증을 통과해도 클라우드·postgres·알 수 없는 설정이면 503으로 닫는다.
// auth-only: 업무 데이터를 쓰지 않는 인증 전용 경로(로그아웃). 클라우드에서도 열린다.
export type ApiAuthScope = "legacy-data" | "auth-only";

// 기존 보호 API용 호환 함수(T-191·T-198): Response|null.
// 순서: 인증 판별 1회(401/403/503) → legacy 차단(503). 둘 다 params·본문·SQLite·파일을 건드리기 전에 끝난다.
// 새 Postgres 읽기 API는 이 함수를 부르지 않고 Backend request adapter만 쓴다(getUser 중복 금지).
export async function requireApiAuth(options: { scope?: ApiAuthScope } = {}): Promise<Response | null> {
  const result = await resolveServerAuth();
  if (result.kind === "denied") return authDeniedResponse(result);
  if ((options.scope ?? "legacy-data") === "legacy-data" && !legacyDataAvailable(process.env)) {
    return Response.json({ error: LEGACY_DATA_UNAVAILABLE.error, code: LEGACY_DATA_UNAVAILABLE.code }, { status: 503, headers: NO_STORE });
  }
  return null;
}
