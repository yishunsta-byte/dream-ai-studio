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

// 로그인 뒤 돌아갈 주소는 같은 사이트 안의 경로만 허용한다.
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login") || next.startsWith("/auth/")) return "/";
  return next;
}

// 브라우저가 실제로 접속한 주소. 라우트의 request.url은 localhost로 바뀔 수 있어서
// 쿠키가 맞지 않는 주소로 보내지 않도록 Host 머리글을 따른다(Vercel은 x-forwarded-*).
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

export const AUTH_MESSAGES = {
  required: "로그인이 필요해요. 다시 로그인해 주세요.",
  forbidden: "이 계정은 사용할 수 없어요.",
  unavailable: "로그인 설정이 아직 끝나지 않았어요. 관리자에게 알려 주세요.",
} as const;
