import { requireApiAuth } from "@/lib/auth/api";
import { authMode, rejectCrossSite } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

// 로그아웃(T-186, F184-2). Supabase가 실패를 알리면 성공으로 숨기지 않는다.
// 서버 쪽 로그아웃이 실패하면 이 브라우저의 로그인만이라도 지우고(scope local), 끝나지 않았다는 사실을 그대로 돌려준다.
export async function POST(request: Request) {
  const denied = await requireApiAuth({ scope: "auth-only" }); if (denied) return denied;
  const blocked = rejectCrossSite(request, { json: false });
  if (blocked) return blocked;
  const supabase = await createSupabaseServer();
  if (!supabase) return authMode() === "off" ? reply({ ok: true }) : reply({ error: "로그인 설정이 아직 끝나지 않았어요.", code: "AUTH_UNAVAILABLE" }, 503);
  try {
    const { error } = await supabase.auth.signOut();
    if (!error) return reply({ ok: true });
  } catch { /* 아래에서 이 브라우저 로그인만 지운다 */ }
  // scope local은 서버 요청 전에 이 브라우저 세션을 먼저 지운다(@supabase/auth-js _signOut).
  // 돌려받는 error는 서버 쪽 토큰 폐기 실패라서, 예외 없이 끝났으면 이 브라우저 로그인은 지워진 것이다.
  let localCleared: boolean;
  try { await supabase.auth.signOut({ scope: "local" }); localCleared = true; } catch { localCleared = false; }
  return reply({
    error: localCleared
      ? "이 브라우저의 로그인은 지웠지만, 다른 기기의 로그인까지 끝났는지는 확인하지 못했어요. 잠시 뒤 다시 로그아웃해 주세요."
      : "로그아웃하지 못했어요. 잠시 뒤에 다시 시도해 주세요.",
    code: localCleared ? "LOGOUT_PARTIAL" : "LOGOUT_FAILED",
    localCleared,
  }, 502);
}
