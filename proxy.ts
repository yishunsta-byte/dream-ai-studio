import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_MESSAGES, authMode, authReady, isAllowedEmail, isPublicPath, supabasePublicConfig } from "@/lib/auth/config";

function deny(request: NextRequest, status: 401 | 403 | 503, code: string, message: string, carry?: NextResponse) {
  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (pathname.startsWith("/api/")) response = NextResponse.json({ error: message, code }, { status });
  else if (status === 503) response = new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  else {
    const target = new URL("/login", request.url);
    if (status === 401) target.searchParams.set("next", `${pathname}${search}`);
    else target.searchParams.set("error", "forbidden");
    response = NextResponse.redirect(target);
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
