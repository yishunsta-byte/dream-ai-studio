import { appConfig } from "@/lib/config/app";

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

// 공개 메인(T-241), 분석 결과와 그 화면에서 쓰는 고정 이미지·브랜드 심볼은 정확한 경로만 허용한다.
// 로그인 설정이 빠져 있거나 익명이어도 보여야 하므로 proxy가 인증 확인보다 먼저 통과시킨다(세션 갱신 없음).
export const PUBLIC_SHOWCASE_ASSETS: readonly string[] = Object.freeze(["neon-rooftop", "desert-motion", "wild-coast", "orchid", "celestial", "sunflower"].map((name) => `/showcase/t240/${name}.png`));
const ANONYMOUS_PUBLIC_PATHS = new Set(["/", "/analysis-results", appConfig.brandMark, ...PUBLIC_SHOWCASE_ASSETS]);
export function isAnonymousPublicPath(pathname: string) {
  return ANONYMOUS_PUBLIC_PATHS.has(pathname);
}

const PUBLIC_PATHS = new Set(["/login", "/admin/login", "/auth/callback", "/api/auth/login", "/api/auth/signup", "/api/auth/reset"]);
export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || ANONYMOUS_PUBLIC_PATHS.has(pathname);
}

// 관리자 진입(T-243). 새 권한이 아니다: 기존 Supabase 로그인 + 서버 getUser + 허용 이메일(DREAM_ALLOWED_EMAILS)만 그대로 쓴다.
// "/admin/login"만 공개(위 PUBLIC_PATHS, /login과 같은 설정 확인·세션 갱신)이고 "/admin"과 그 아래는 보호 경로다.
export const ADMIN_HOME = "/admin";
export const ADMIN_LOGIN = "/admin/login";
export function isAdminPath(pathname: string) {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}
// 관리자 로그인 뒤 돌아갈 곳: 같은 사이트의 /admin 아래만(로그인 화면 자신은 제외). 그 밖은 /admin.
export function adminNextPath(next: string | null | undefined) {
  const safe = safeNextPath(next);
  const pathname = new URL(safe, PROBE_ORIGIN).pathname;
  return isAdminPath(pathname) && pathname !== ADMIN_LOGIN && !pathname.startsWith(`${ADMIN_LOGIN}/`) ? safe : ADMIN_HOME;
}
export function adminLoginPath(params: { next?: string; error?: "forbidden" | "unavailable" } = {}) {
  const query = new URLSearchParams();
  if (params.next) query.set("next", adminNextPath(params.next));
  if (params.error) query.set("error", params.error);
  const text = query.toString();
  return text ? `${ADMIN_LOGIN}?${text}` : ADMIN_LOGIN;
}

export function logoutLoginPath(pathname: string, state: "ended" | "partial") {
  const destination = isAdminPath(pathname) ? ADMIN_LOGIN : "/login";
  return state === "partial" ? `${destination}?notice=logout-partial` : destination;
}

// 비밀번호 재설정의 돌아갈 곳(T-245). 요청·주소에서 받은 값은 정해 둔 이름("admin")일 때만 쓰고, 그 밖은 일반 흐름이다.
// 임의 URL·next·머리글을 돌아갈 곳으로 믿지 않는다. 경로는 모두 여기서 고정 문자열로 만든다.
export type PasswordContext = "admin";
export function passwordContext(value: unknown): PasswordContext | null {
  return value === "admin" ? "admin" : null;
}
export function passwordPagePath(context: PasswordContext | null) {
  return context === "admin" ? "/account/password?context=admin" : "/account/password";
}
export function passwordDonePath(context: PasswordContext | null, state: "ended" | "partial") {
  const notice = state === "ended" ? "password" : "password-partial";
  return context === "admin" ? `${ADMIN_LOGIN}?next=%2Fadmin&notice=${notice}` : `/login?notice=${notice}`;
}

// 비밀번호 규칙(T-184): 8~72자, 영문과 숫자를 함께. 72자는 Supabase(bcrypt) 한도.
export const PASSWORD_RULE = "8자 이상, 영문과 숫자를 함께 넣어 주세요.";
export function passwordProblem(password: unknown) {
  if (typeof password !== "string" || password.length < 8) return "비밀번호는 8자 이상이어야 해요.";
  if (password.length > 72) return "비밀번호는 72자까지 쓸 수 있어요.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "비밀번호에 영문과 숫자를 함께 넣어 주세요.";
  return null;
}

export function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// JSON 본문을 객체로만 받는다(null·배열·문자열은 거절).
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
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

// 상태를 바꾸는 인증 요청(로그인·가입·재설정·비밀번호 변경·로그아웃)은 이 사이트 화면에서 보낸 것만 받는다(T-186, F184-1).
// 다른 사이트의 폼(text/plain 등)이 세션을 만들거나 바꾸지 못하게, Supabase 호출·본문 읽기 전에 거절한다.
export function allowedRequestOrigins(request: Request, env: Env = process.env) {
  const origins = new Set(trustedOrigins(env));
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  if (!env.VERCEL && LOOPBACK_HOST.test(host)) origins.add(`http://${host}`);
  return origins;
}

export function rejectCrossSite(request: Request, { json }: { json: boolean }, env: Env = process.env): Response | null {
  const headers = { "cache-control": "no-store" };
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((fetchSite && fetchSite !== "same-origin") || !origin || !allowedRequestOrigins(request, env).has(origin)) {
    return Response.json({ error: "이 사이트 화면에서 보낸 요청만 받을 수 있어요. 화면을 새로 고친 뒤 다시 시도해 주세요.", code: "AUTH_ORIGIN_REJECTED" }, { status: 403, headers });
  }
  if (json) {
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return Response.json({ error: "요청 형식이 올바르지 않아요.", code: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415, headers });
  }
  return null;
}

export const AUTH_MESSAGES = {
  required: "로그인이 필요해요. 다시 로그인해 주세요.",
  forbidden: "이 계정은 사용할 수 없어요.",
  unavailable: "로그인 설정이 아직 끝나지 않았어요. 관리자에게 알려 주세요.",
} as const;
