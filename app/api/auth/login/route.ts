import { authMode, authReady, callbackOrigin, isAllowedEmail, safeNextPath } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const SENT = "입력한 주소가 사용할 수 있는 계정이면 로그인 링크를 보냈어요. 메일함을 확인해 주세요.";
const bad = (error: string, code: string, status = 400) => Response.json({ error, code }, { status });

export async function POST(request: Request) {
  if (authMode() === "off") return bad("이 환경은 로그인 없이 써요.", "AUTH_OFF", 404);
  if (!authReady()) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return bad("요청 형식이 올바르지 않아요.", "BAD_REQUEST"); }
  // null·배열·문자열 같은 값은 객체가 아니므로 400으로 돌려준다(T-182 검수 O182-1).
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("요청 형식이 올바르지 않아요.", "BAD_REQUEST");
  const fields = body as { email?: unknown; next?: unknown };
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return bad("이메일 주소를 확인해 주세요.", "INVALID_EMAIL");
  // 허용 목록 밖 주소에도 같은 답을 줘서, 어떤 주소가 쓰이는지 드러내지 않는다.
  if (!isAllowedEmail(email)) return Response.json({ ok: true, message: SENT });
  // 메일 링크의 사이트 주소는 미리 정한 목록에서만 고른다(Host·x-forwarded-host로 만들지 않음).
  const origin = callbackOrigin(request);
  if (!origin) return bad("이 주소에서는 로그인 링크를 보낼 수 없어요. 사이트 주소 설정을 확인해 주세요.", "AUTH_ORIGIN_UNTRUSTED");
  const supabase = await createSupabaseServer();
  if (!supabase) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", safeNextPath(typeof fields.next === "string" ? fields.next : null));
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callback.toString() } });
  if (error) {
    if (error.status === 429) return bad("잠시 뒤에 다시 보내 주세요. 메일을 너무 자주 요청했어요.", "RATE_LIMITED", 429);
    return bad("로그인 링크를 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.", "AUTH_SEND_FAILED", 502);
  }
  return Response.json({ ok: true, message: SENT });
}
