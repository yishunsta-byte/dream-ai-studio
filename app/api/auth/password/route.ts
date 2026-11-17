import { isAllowedEmail, passwordProblem, readJsonObject, rejectCrossSite } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const bad = (error: string, code: string, status = 400) => Response.json({ error, code }, { status });

// 로그인한 사람(비밀번호 찾기 링크로 들어온 경우 포함)의 비밀번호를 바꾼다(T-184).
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request, { json: true });
  if (blocked) return blocked;
  const body = await readJsonObject(request);
  if (!body) return bad("요청 형식이 올바르지 않아요.", "BAD_REQUEST");
  const problem = passwordProblem(body.password);
  if (problem) return bad(problem, "WEAK_PASSWORD");
  const supabase = await createSupabaseServer();
  if (!supabase) return bad("로그인 설정이 아직 끝나지 않았어요.", "AUTH_UNAVAILABLE", 503);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return bad("로그인이 필요해요. 비밀번호 찾기 메일의 링크를 다시 눌러 주세요.", "AUTH_REQUIRED", 401);
  if (!isAllowedEmail(user.email)) return bad("이 계정은 사용할 수 없어요.", "AUTH_FORBIDDEN", 403);
  const { error } = await supabase.auth.updateUser({ password: body.password as string });
  if (error) {
    if (error.code === "same_password") return bad("지금 비밀번호와 다른 비밀번호를 써 주세요.", "SAME_PASSWORD");
    if (error.code === "weak_password") return bad("더 안전한 비밀번호를 써 주세요. 흔한 비밀번호는 쓸 수 없어요.", "WEAK_PASSWORD");
    if (error.code === "reauthentication_needed") return bad("보안을 위해 비밀번호 찾기 메일로 다시 들어와 주세요.", "REAUTH_NEEDED", 401);
    return bad("비밀번호를 바꾸지 못했어요. 잠시 뒤에 다시 시도해 주세요.", "AUTH_UPDATE_FAILED", 502);
  }
  return Response.json({ ok: true });
}
