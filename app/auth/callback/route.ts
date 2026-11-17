import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAllowedEmail, requestOrigin, safeNextPath } from "@/lib/auth/config";
import { createSupabaseServer } from "@/lib/auth/server";

// 메일의 로그인 링크가 돌아오는 곳. 코드(또는 토큰)를 세션으로 바꾼 뒤 원래 화면으로 보낸다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const next = safeNextPath(url.searchParams.get("next"));
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
  const supabase = await createSupabaseServer();
  if (!supabase) return fail("unavailable");
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : null;
  if (!result || result.error) return fail("link");
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAllowedEmail(user?.email)) { await supabase.auth.signOut(); return fail("forbidden"); }
  return NextResponse.redirect(new URL(next, origin));
}
