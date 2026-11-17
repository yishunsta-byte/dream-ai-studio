import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_MESSAGES, authMode, authReady, isAllowedEmail, isPublicPath, loginPath, supabasePublicConfig } from "@/lib/auth/config";

function deny(request: NextRequest, status: 401 | 403 | 503, code: string, message: string, carry?: NextResponse) {
  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (pathname.startsWith("/api/")) response = NextResponse.json({ error: message, code }, { status });
  else if (status === 503) response = new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  else {
    // proxy는 절대 주소만 받으므로 Next가 만든 요청 주소(nextUrl)에 경로만 바꿔 붙인다.
    // x-forwarded-host로 다른 사이트가 끼어들지 않는지는 실제 서버 시험으로 확인한다(T-182 검수 F182-2).
    const target = request.nextUrl.clone();
    const login = new URL(status === 401 ? loginPath({ next: `${pathname}${search}` }) : loginPath({ error: "forbidden" }), "http://same-site.invalid");
    target.pathname = login.pathname;
    target.search = login.search;
    target.hash = "";
    response = NextResponse.redirect(target, 307);
  }
  carry?.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  if (authMode() === "off") return NextResponse.next();
  const config = supabasePublicConfig();
  if (!config || !authReady()) return deny(request, 503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // 세션을 새로 고친다. getUser는 Supabase 인증 서버에 토큰을 확인한다.
  const { data: { user } } = await supabase.auth.getUser();
  if (isPublicPath(request.nextUrl.pathname)) return response;
  if (!user) return deny(request, 401, "AUTH_REQUIRED", AUTH_MESSAGES.required, response);
  if (!isAllowedEmail(user.email)) return deny(request, 403, "AUTH_FORBIDDEN", AUTH_MESSAGES.forbidden, response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
