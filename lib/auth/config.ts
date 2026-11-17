// 로그인 설정 판단. proxy와 서버 코드가 함께 쓰므로 Node 전용 모듈을 가져오지 않는다.
type Env = Record<string, string | undefined>;

export type AuthMode = "off" | "supabase";

// 이 PC 전용 실행(127.0.0.1)은 기본으로 로그인을 쓰지 않는다.
// Vercel에서는 설정을 빠뜨려도 열린 채로 올라가지 않게 항상 로그인 모드로 본다.
export function authMode(env: Env = process.env): AuthMode {
  if (env.DREAM_AUTH_MODE === "supabase" || env.VERCEL) return "supabase";
  return "off";
}

export function supabasePublicConfig(env: Env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function allowedEmails(env: Env = process.env) {
  return new Set((env.DREAM_ALLOWED_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export function isAllowedEmail(email: string | null | undefined, env: Env = process.env) {
  return !!email && allowedEmails(env).has(email.trim().toLowerCase());
}

// 로그인 설정이 빠져 있으면 모든 요청을 막는다(열어 두지 않음).
export function authReady(env: Env = process.env) {
  return !!supabasePublicConfig(env) && allowedEmails(env).size > 0;
}

export function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname === "/auth/callback" || pathname === "/api/auth/login";
}

// 제어문자(U+0000~U+001F, U+007F)와 역슬래시. URL 해석이 탭·줄바꿈을 지우고 역슬래시를 /로 바꾸면서
// "/<탭>/evil.test"가 "//evil.test"(외부 주소)로 바뀌는 것을 막는다(T-182 검수 F182-1).
function hasUnsafePathChar(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}
const PROBE_ORIGIN = "http://same-site.invalid";

// 로그인 뒤 돌아갈 주소는 같은 사이트 안의 경로만 허용한다.
// 위험한 글자를 먼저 거절하고, URL로 해석한 뒤에도 같은 사이트인지 다시 확인한다.
export function safeNextPath(next: string | null | undefined) {
  if (!next || next.length > 2048 || !next.startsWith("/") || hasUnsafePathChar(next)) return "/";
  let parsed: URL;
  try { parsed = new URL(next, PROBE_ORIGIN); } catch { return "/"; }
  if (parsed.origin !== PROBE_ORIGIN || parsed.pathname.startsWith("//")) return "/";
  if (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/") || parsed.pathname.startsWith("/auth/")) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// 로그인 화면 주소. 서버 코드가 만든 값만 넣는다.
export function loginPath(params: { next?: string; error?: "link" | "forbidden" | "unavailable" } = {}) {
  const query = new URLSearchParams();
  if (params.next) query.set("next", safeNextPath(params.next));
  if (params.error) query.set("error", params.error);
  const text = query.toString();
  return text ? `/login?${text}` : "/login";
}

// 같은 사이트 안에서만 이동하는 응답. Location을 상대 경로로 두면 브라우저가 자기가 접속한 주소를
// 기준으로 이동하므로 Host·x-forwarded-host 머리글을 믿지 않아도 된다(F182-2).
export function sameSiteRedirect(path: string) {
  const location = path === "/login" || path.startsWith("/login?") ? path : safeNextPath(path);
  if (hasUnsafePathChar(location) || location.startsWith("//")) throw new Error("같은 사이트 경로가 아니에요.");
  return new Response(null, { status: 307, headers: { location, "cache-control": "no-store" } });
}

// 로그인 메일 링크에 넣을 사이트 주소. 요청 머리글만으로 주소를 만들지 않고(F182-2),
// 미리 정한 목록과 맞을 때만 쓴다. 목록: DREAM_SITE_URL(쉼표로 여러 개) +
// Vercel이 넣어 주는 VERCEL_PROJECT_PRODUCTION_URL·VERCEL_URL.
// 이 PC 실행(Vercel 아님)에서는 127.0.0.1·localhost 접속도 허용한다.
export function trustedOrigins(env: Env = process.env) {
  const list = (env.DREAM_SITE_URL ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  for (const host of [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL]) if (host?.trim()) list.push(`https://${host.trim()}`);
  const origins: string[] = [];
  for (const item of list) {
    try { const url = new URL(item); if (url.protocol === "https:" || url.protocol === "http:") origins.push(url.origin); } catch { /* 잘못된 값은 건너뛴다 */ }
  }
  return [...new Set(origins)];
}

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

export function callbackOrigin(request: Request, env: Env = process.env) {
  const trusted = trustedOrigins(env);
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  for (const origin of trusted) if (new URL(origin).host === host) return origin;
  if (!env.VERCEL && LOOPBACK_HOST.test(host)) return `http://${host}`;
  return trusted[0] ?? null;
}

export const AUTH_MESSAGES = {
  required: "로그인이 필요해요. 다시 로그인해 주세요.",
  forbidden: "이 계정은 사용할 수 없어요.",
  unavailable: "로그인 설정이 아직 끝나지 않았어요. 관리자에게 알려 주세요.",
} as const;
