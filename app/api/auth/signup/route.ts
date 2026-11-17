import { authMode, authReady, callbackOrigin, isAllowedEmail, passwordProblem, readJsonObject, rejectCrossSite, validEmail } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const bad = (error: string, code: string, status = 400) => Response.json({ error, code }, { status });
// 이미 가입한 주소·허용 밖 주소도 같은 안내를 줘서 어떤 주소가 쓰이는지 드러내지 않는다.
const SENT = "가입 확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요. 이미 가입한 주소라면 로그인하거나 비밀번호 찾기를 써 주세요.";

// 회원가입(T-184). 메일 인증을 마쳐야 계정이 쓸 수 있게 되고, 앱 입장은 허용 이메일만 된다.
export async function POST(request: Request) {
  if (authMode() === "off") return bad("이 환경은 로그인 없이 써요.", "AUTH_OFF", 404);
  if (!authReady()) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const blocked = rejectCrossSite(request, { json: true });
  if (blocked) return blocked;
  const body = await readJsonObject(request);
  if (!body) return bad("요청 형식이 올바르지 않아요.", "BAD_REQUEST");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!validEmail(email)) return bad("이메일 주소를 확인해 주세요.", "INVALID_EMAIL");
  const problem = passwordProblem(body.password);
  if (problem) return bad(problem, "WEAK_PASSWORD");
  if (!isAllowedEmail(email)) return Response.json({ ok: true, message: SENT });
  const origin = callbackOrigin(request);
  if (!origin) return bad("이 주소에서는 가입 메일을 보낼 수 없어요. 사이트 주소 설정을 확인해 주세요.", "AUTH_ORIGIN_UNTRUSTED");
  const supabase = await createSupabaseServer();
  if (!supabase) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", "/");
  const { error } = await supabase.auth.signUp({ email, password: body.password as string, options: { emailRedirectTo: callback.toString() } });
  if (error) {
    if (error.status === 429) return bad("잠시 뒤에 다시 시도해 주세요. 메일을 너무 자주 요청했어요.", "RATE_LIMITED", 429);
    if (error.code === "weak_password") return bad("더 안전한 비밀번호를 써 주세요. 흔한 비밀번호는 쓸 수 없어요.", "WEAK_PASSWORD");
    if (error.code === "signup_disabled") return bad("지금은 가입을 받지 않아요.", "SIGNUP_DISABLED", 403);
    if (error.code === "user_already_exists") return Response.json({ ok: true, message: SENT });
    return bad("가입 메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.", "AUTH_SEND_FAILED", 502);
  }
  return Response.json({ ok: true, message: SENT });
}
