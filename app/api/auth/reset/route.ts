import { authMode, authReady, callbackOrigin, isAllowedEmail, readJsonObject, validEmail } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const bad = (error: string, code: string, status = 400) => Response.json({ error, code }, { status });
const SENT = "가입한 주소라면 비밀번호를 새로 정하는 메일을 보냈어요. 메일함을 확인해 주세요.";

// 비밀번호 찾기(T-184). 메일 링크 → /auth/callback → /account/password에서 새 비밀번호를 정한다.
export async function POST(request: Request) {
  if (authMode() === "off") return bad("이 환경은 로그인 없이 써요.", "AUTH_OFF", 404);
  if (!authReady()) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const body = await readJsonObject(request);
  if (!body) return bad("요청 형식이 올바르지 않아요.", "BAD_REQUEST");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!validEmail(email)) return bad("이메일 주소를 확인해 주세요.", "INVALID_EMAIL");
  if (!isAllowedEmail(email)) return Response.json({ ok: true, message: SENT });
  const origin = callbackOrigin(request);
  if (!origin) return bad("이 주소에서는 메일을 보낼 수 없어요. 사이트 주소 설정을 확인해 주세요.", "AUTH_ORIGIN_UNTRUSTED");
  const supabase = await createSupabaseServer();
  if (!supabase) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", "/account/password");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() });
  if (error) {
    if (error.status === 429) return bad("잠시 뒤에 다시 시도해 주세요. 메일을 너무 자주 요청했어요.", "RATE_LIMITED", 429);
    return bad("메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.", "AUTH_SEND_FAILED", 502);
  }
  return Response.json({ ok: true, message: SENT });
}
