import "server-only";
import { authMode, authReady, isAllowedEmail } from "./config";
import { createSupabaseServer } from "./server";

// 서버 인증 공통 판별(T-191, B4-PROJECT-READ-CONTRACT 2장).
// Backend actor는 이 결과의 verified.userId만 쓴다. 이메일→UUID 매핑, 요청 owner_id·헤더·쿠키 원문은 믿지 않는다.
export type ServerAuthDeniedCode = "AUTH_REQUIRED" | "AUTH_FORBIDDEN" | "AUTH_UNAVAILABLE";
export type ServerAuthResult =
  | { kind: "local" }
  | { kind: "verified"; userId: string; email: string }
  | { kind: "denied"; status: 401 | 403 | 503; code: ServerAuthDeniedCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = (status: 401 | 403 | 503, code: ServerAuthDeniedCode): ServerAuthResult => ({ kind: "denied", status, code });

// 순서: 로그인 꺼짐 → 설정 → Supabase 연결·getUser 1회 → 오류/사용자 없음 → 허용 이메일 → UUID 형식.
// 결과를 모듈 전역에 저장하지 않는다(요청마다 새로 판별). 화면 그리기 안 공유는 render.ts의 React cache만 쓴다.
export async function resolveServerAuth(): Promise<ServerAuthResult> {
  if (authMode() === "off") return { kind: "local" };
  if (!authReady()) return denied(503, "AUTH_UNAVAILABLE");
  try {
    const supabase = await createSupabaseServer();
    if (!supabase) return denied(503, "AUTH_UNAVAILABLE");
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user ?? null;
    if (error) {
      // 인증 서버 장애는 503, 그 밖의 오류(만료·위조 등)는 401. user가 같이 와도 믿지 않는다.
      const unavailable = (error.status !== undefined && error.status >= 500) || error.name === "AuthRetryableFetchError";
      return unavailable ? denied(503, "AUTH_UNAVAILABLE") : denied(401, "AUTH_REQUIRED");
    }
    if (!user) return denied(401, "AUTH_REQUIRED");
    if (typeof user.email !== "string" || !isAllowedEmail(user.email)) return denied(403, "AUTH_FORBIDDEN");
    // 허용된 사람인데 id가 UUID가 아니면 인증 응답 계약이 깨진 것이라 닫는다.
    if (typeof user.id !== "string" || !UUID.test(user.id)) return denied(503, "AUTH_UNAVAILABLE");
    return { kind: "verified", userId: user.id.toLowerCase(), email: user.email };
  } catch {
    return denied(503, "AUTH_UNAVAILABLE");
  }
}
