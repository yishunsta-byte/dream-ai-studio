import type { EmailOtpType } from "@supabase/supabase-js";
import { isAllowedEmail, loginPath, safeNextPath, sameSiteRedirect } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

const OTP_TYPES = new Set<EmailOtpType>(["magiclink", "email", "signup", "invite", "recovery", "email_change"]);

// 메일의 로그인 링크가 돌아오는 곳. 코드(또는 토큰)를 세션으로 바꾼 뒤 원래 화면으로 보낸다.
// 이동은 모두 같은 사이트 상대 경로로만 한다(Host 머리글을 믿지 않음).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const supabase = await createSupabaseServer();
  if (!supabase) return sameSiteRedirect(loginPath({ error: "unavailable" }));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") as EmailOtpType | null;
  const type = rawType && OTP_TYPES.has(rawType) ? rawType : null;
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : null;
  if (!result || result.error) return sameSiteRedirect(loginPath({ error: "link" }));
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAllowedEmail(user?.email)) { await supabase.auth.signOut(); return sameSiteRedirect(loginPath({ error: "forbidden" })); }
  return sameSiteRedirect(next);
}
