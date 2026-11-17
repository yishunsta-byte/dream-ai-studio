import { authMode, authReady, isAllowedEmail, readJsonObject, validEmail } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const bad = (error: string, code: string, status = 400) => Response.json({ error, code }, { status });
// 계정이 없는지, 비밀번호가 틀렸는지, 허용 밖인지 구분해 알려 주지 않는다.
const WRONG = "이메일 또는 비밀번호가 맞지 않아요.";

// 이메일·비밀번호 로그인(T-184). 성공하면 세션 쿠키가 응답에 붙는다.
export async function POST(request: Request) {
  if (authMode() === "off") return bad("이 환경은 로그인 없이 써요.", "AUTH_OFF", 404);
  if (!authReady()) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const body = await readJsonObject(request);
  if (!body) return bad("요청 형식이 올바르지 않아요.", "BAD_REQUEST");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!validEmail(email)) return bad("이메일 주소를 확인해 주세요.", "INVALID_EMAIL");
  if (!password || password.length > 72) return bad(WRONG, "INVALID_CREDENTIALS");
  if (!isAllowedEmail(email)) return bad(WRONG, "INVALID_CREDENTIALS");
  const supabase = await createSupabaseServer();
  if (!supabase) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429) return bad("잠시 뒤에 다시 시도해 주세요. 로그인 시도가 너무 많았어요.", "RATE_LIMITED", 429);
    if (error.code === "email_not_confirmed") return bad("메일 인증을 먼저 끝내 주세요. 가입할 때 받은 메일의 링크를 눌러 주세요.", "EMAIL_NOT_CONFIRMED", 403);
    return bad(WRONG, "INVALID_CREDENTIALS");
  }
  return Response.json({ ok: true });
}
