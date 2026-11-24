import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_MESSAGES, adminLoginPath, authMode, authReady, isAdminPath, isAllowedEmail, isAnonymousPublicPath, isPublicPath, loginPath, supabasePublicConfig } from "@/lib/auth/config";
import { COVER_ALLOW, isCoverReadMethod, parseCoverPath } from "@/lib/public-showcase/cover-path";
import { parsePlaybackPath } from "@/lib/public-showcase/playback-path";

function deny(request: NextRequest, status: 401 | 403 | 503, code: string, message: string, carry?: NextResponse) {
  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (pathname.startsWith("/api/")) response = NextResponse.json({ error: message, code }, { status });
  else if (status === 503) response = new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  else {
    // proxy는 절대 주소만 받으므로 Next가 만든 요청 주소(nextUrl)에 경로만 바꿔 붙인다.
    // x-forwarded-host로 다른 사이트가 끼어들지 않는지는 실제 서버 시험으로 확인한다(T-182 검수 F182-2).
    const target = request.nextUrl.clone();
    // T-243: /admin 아래는 관리자 로그인 화면으로 보낸다(판정 기준은 같고 목적지만 다름).
    const admin = isAdminPath(pathname);
    const path = status === 401
      ? admin ? adminLoginPath({ next: `${pathname}${search}` }) : loginPath({ next: `${pathname}${search}` })
      : admin ? adminLoginPath({ error: "forbidden" }) : loginPath({ error: "forbidden" });
    const login = new URL(path, "http://same-site.invalid");
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
  // 공개 메인 "/"와 고정 이미지 6개: 로그인 설정·세션과 상관없이 바로 통과(세션 갱신·쿠키 쓰기 없음).
  // 다른 모든 경로는 아래 기존 순서(설정 확인 → 세션 갱신 → 공개 인증 경로 → 로그인·허용 확인)를 그대로 거친다.
  if (isAnonymousPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  if (request.headers.has("x-dream-playback-path") || request.nextUrl.pathname.toLowerCase().replace(/\/$/, "") === "/api/publication-playback") {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
  const playback = parsePlaybackPath(request.nextUrl.pathname);
  if (playback && request.url.includes("?")) {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
  if (request.nextUrl.search === "" && (playback || parseCoverPath(request.nextUrl.pathname))) {
    if (playback && isCoverReadMethod(request.method)) {
      const headers = new Headers(request.headers);
      headers.set("x-dream-playback-path", request.nextUrl.pathname);
      return NextResponse.next({ request: { headers } });
    }
    if (isCoverReadMethod(request.method)) return NextResponse.next();
    return new NextResponse(null, { status: 405, headers: { allow: COVER_ALLOW, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
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
