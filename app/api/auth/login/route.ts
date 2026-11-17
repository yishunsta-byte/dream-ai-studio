import { authMode, authReady, isAllowedEmail, requestOrigin, safeNextPath } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const SENT = "입력한 주소가 사용할 수 있는 계정이면 로그인 링크를 보냈어요. 메일함을 확인해 주세요.";

export async function POST(request: Request) {
  if (authMode() === "off") return Response.json({ error: "이 환경은 로그인 없이 써요.", code: "AUTH_OFF" }, { status: 404 });
  if (!authReady()) return Response.json({ error: "로그인 설정이 아직 끝나지 않았어요.", code: "AUTH_UNAVAILABLE" }, { status: 503 });
  let body: { email?: unknown; next?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "요청 형식이 올바르지 않아요.", code: "BAD_REQUEST" }, { status: 400 }); }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: "이메일 주소를 확인해 주세요.", code: "INVALID_EMAIL" }, { status: 400 });
  // 허용 목록 밖 주소에도 같은 답을 줘서, 어떤 주소가 쓰이는지 드러내지 않는다.
  if (!isAllowedEmail(email)) return Response.json({ ok: true, message: SENT });
  const supabase = await createSupabaseServer();
  if (!supabase) return Response.json({ error: "로그인 설정이 아직 끝나지 않았어요.", code: "AUTH_UNAVAILABLE" }, { status: 503 });
  const next = safeNextPath(typeof body.next === "string" ? body.next : null);
  const callback = new URL("/auth/callback", requestOrigin(request));
  callback.searchParams.set("next", next);
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callback.toString() } });
  if (error) {
    if (error.status === 429) return Response.json({ error: "잠시 뒤에 다시 보내 주세요. 메일을 너무 자주 요청했어요.", code: "RATE_LIMITED" }, { status: 429 });
    return Response.json({ error: "로그인 링크를 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.", code: "AUTH_SEND_FAILED" }, { status: 502 });
  }
  return Response.json({ ok: true, message: SENT });
}
