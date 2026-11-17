import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowedEmails, authMode, authReady, callbackOrigin, isAllowedEmail, isPublicPath, loginPath, safeNextPath, trustedOrigins } from "@/lib/auth/config";

type OtpCall = { email: string; options: { emailRedirectTo: string; shouldCreateUser: boolean } };
const { user, calls } = vi.hoisted(() => ({
  user: { current: null as null | { email: string } },
  calls: { exchange: [] as string[], verify: [] as unknown[], otp: [] as OtpCall[], signOut: 0, fail: false },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: user.current } }) } }),
}));
// 라우트 시험용 대역: 실제 Supabase 대신 호출만 기록한다.
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: {
    exchangeCodeForSession: async (code: string) => { calls.exchange.push(code); return { error: calls.fail ? new Error("만료") : null }; },
    verifyOtp: async (args: unknown) => { calls.verify.push(args); return { error: calls.fail ? new Error("만료") : null }; },
    getUser: async () => ({ data: { user: user.current } }),
    signOut: async () => { calls.signOut++; return { error: null }; },
    signInWithOtp: async (args: OtpCall) => { calls.otp.push(args); return { error: null }; },
  } }),
}));

const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_SITE_URL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } user.current = null; Object.assign(calls, { exchange: [], verify: [], otp: [], signOut: 0, fail: false }); });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

function ready() {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "Owner@Example.com";
}
async function run(path: string) {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(path, "https://studio.test")));
}

describe("T-182 로그인 설정", () => {
  it("이 PC 실행은 기본으로 로그인을 쓰지 않고, 설정하거나 Vercel이면 켜진다", () => {
    expect(authMode({})).toBe("off");
    expect(authMode({ DREAM_AUTH_MODE: "supabase" })).toBe("supabase");
    expect(authMode({ VERCEL: "1" })).toBe("supabase");
    expect(authMode({ VERCEL: "1", DREAM_AUTH_MODE: "off" })).toBe("supabase");
  });
  it("허용 이메일은 대소문자·공백을 무시하고, 목록이 비면 준비 안 됨", () => {
    const env = { DREAM_ALLOWED_EMAILS: " A@x.com , b@y.com ", NEXT_PUBLIC_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
    expect([...allowedEmails(env)]).toEqual(["a@x.com", "b@y.com"]);
    expect(isAllowedEmail("a@X.com", env)).toBe(true);
    expect(isAllowedEmail("c@x.com", env)).toBe(false);
    expect(isAllowedEmail(null, env)).toBe(false);
    expect(authReady(env)).toBe(true);
    expect(authReady({ ...env, DREAM_ALLOWED_EMAILS: " " })).toBe(false);
    expect(authReady({ DREAM_ALLOWED_EMAILS: "a@x.com" })).toBe(false);
  });
  it("돌아갈 주소는 같은 사이트 경로만 허용한다", () => {
    expect(safeNextPath("/projects/1?x=1")).toBe("/projects/1?x=1");
    for (const bad of [null, "", "https://evil.test", "//evil.test", "/\\evil.test", "/login", "/auth/callback"]) expect(safeNextPath(bad)).toBe("/");
  });
  it("F182-1: 탭·줄바꿈·CR·NUL·DEL·역슬래시가 섞인 주소는 외부로 바뀌기 전에 거절한다", () => {
    const tricks = ["/\t/evil.test", "/\n/evil.test", "/\r/evil.test", "/\t\t/evil.test", "/\u0000/evil.test", "/\u007F/evil.test", "/a\\..\\..\\/evil.test"];
    for (const bad of tricks) expect(safeNextPath(bad), JSON.stringify(bad)).toBe("/");
    // 퍼센트로 감싼 값은 글자 그대로 경로에 남아 같은 사이트를 벗어나지 않는다.
    for (const value of ["/%2F%2Fevil.test", "/%09/evil.test", "/x/..//evil.test"]) expect(new URL(safeNextPath(value), "https://studio.test").origin, value).toBe("https://studio.test");
  });
  it("정상 내부 경로는 쿼리·조각까지 그대로 유지한다", () => {
    expect(safeNextPath("/projects/abc?tab=edit&x=%2F%2F#part")).toBe("/projects/abc?tab=edit&x=%2F%2F#part");
    expect(safeNextPath("/library")).toBe("/library");
    expect(safeNextPath("/login?next=/x")).toBe("/");
  });
  it("로그인 화면 주소는 안전한 next만 담는다", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath({ next: "/settings" })).toBe("/login?next=%2Fsettings");
    expect(loginPath({ next: "/\t/evil.test" })).toBe("/login?next=%2F");
    expect(loginPath({ error: "forbidden" })).toBe("/login?error=forbidden");
  });
  it("F182-2: 메일 링크 사이트 주소는 정해 둔 목록에서만 고르고 x-forwarded-host는 무시한다", () => {
    const req = (host: string, extra: Record<string, string> = {}) => new Request("http://localhost:3000/api/auth/login", { headers: { host, ...extra } });
    expect(callbackOrigin(req("127.0.0.1:43182"), {})).toBe("http://127.0.0.1:43182");
    expect(callbackOrigin(req("127.0.0.1:43182", { "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" }), {})).toBe("http://127.0.0.1:43182");
    expect(callbackOrigin(req("evil.test"), {})).toBeNull();
    const vercel = { VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "studio.vercel.app", VERCEL_URL: "studio-abc.vercel.app" };
    expect(trustedOrigins(vercel)).toEqual(["https://studio.vercel.app", "https://studio-abc.vercel.app"]);
    expect(callbackOrigin(req("studio-abc.vercel.app"), vercel)).toBe("https://studio-abc.vercel.app");
    expect(callbackOrigin(req("evil.test", { "x-forwarded-host": "evil.test" }), vercel)).toBe("https://studio.vercel.app");
    expect(callbackOrigin(req("127.0.0.1:3000"), vercel)).toBe("https://studio.vercel.app");
    expect(callbackOrigin(req("dream.example.kr"), { DREAM_SITE_URL: "https://dream.example.kr, not a url" })).toBe("https://dream.example.kr");
  });
  it("로그인 없이 열리는 곳은 로그인 화면·링크 확인·링크 요청뿐이다", () => {
    expect(["/login", "/auth/callback", "/api/auth/login"].every(isPublicPath)).toBe(true);
    expect(["/", "/api/jobs", "/api/auth/logout", "/settings", "/login2"].some(isPublicPath)).toBe(false);
  });
});

describe("T-182 접속 보호(proxy)", () => {
  it("로그인을 쓰지 않는 환경은 그대로 통과한다", async () => {
    const response = await run("/settings");
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("설정이 빠지면 화면·API 모두 503으로 막는다", async () => {
    process.env.VERCEL = "1";
    expect((await run("/")).status).toBe(503);
    const api = await run("/api/jobs");
    expect(api.status).toBe(503);
    expect((await api.json()).code).toBe("AUTH_UNAVAILABLE");
  });
  it("로그인 전 화면은 로그인으로 보내고 원래 주소를 기억한다", async () => {
    ready();
    const response = await run("/projects/abc?tab=edit");
    expect(response.status).toBe(307);
    const target = new URL(response.headers.get("location")!, "https://studio.test");
    expect(target.origin).toBe("https://studio.test");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/projects/abc?tab=edit");
  });
  it("로그인 전 API는 401과 한글 안내를 돌려준다", async () => {
    ready();
    const response = await run("/api/assets/123");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "로그인이 필요해요. 다시 로그인해 주세요.", code: "AUTH_REQUIRED" });
  });
  it("로그인 화면과 링크 요청은 로그인 없이 열린다", async () => {
    ready();
    for (const path of ["/login", "/auth/callback?code=x", "/api/auth/login"]) expect((await run(path)).headers.get("x-middleware-next")).toBe("1");
  });
  it("허용 목록 밖 계정은 화면은 로그인으로, API는 403으로 막는다", async () => {
    ready();
    user.current = { email: "someone@else.com" };
    const page = await run("/");
    const target = new URL(page.headers.get("location")!, "https://studio.test");
    expect(`${target.origin}${target.pathname}${target.search}`).toBe("https://studio.test/login?error=forbidden");
    const api = await run("/api/jobs");
    expect(api.status).toBe(403);
    expect((await api.json()).code).toBe("AUTH_FORBIDDEN");
  });
  it("허용된 계정은 통과한다(대소문자 무시)", async () => {
    ready();
    user.current = { email: "owner@example.com" };
    expect((await run("/api/jobs")).headers.get("x-middleware-next")).toBe("1");
    expect((await run("/settings")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("T-182 검수 수정: 로그인 링크 확인(callback)", () => {
  async function callback(query: string, headers: Record<string, string> = {}) {
    const { GET } = await import("@/app/auth/callback/route");
    return GET(new Request(`http://127.0.0.1:43182/auth/callback${query}`, { headers: { host: "127.0.0.1:43182", ...headers } }));
  }
  it("F182-1: 성공해도 제어문자 next는 사이트 첫 화면으로 보낸다", async () => {
    ready();
    user.current = { email: "owner@example.com" };
    for (const next of ["%2F%09%2Fevil.test", "%2F%0A%2Fevil.test", "%2F%0D%2Fevil.test", "%2F%5Cevil.test", "https%3A%2F%2Fevil.test"]) {
      const response = await callback(`?token_hash=t&type=magiclink&next=${next}`);
      expect(response.status).toBe(307);
      expect(response.headers.get("location"), next).toBe("/");
    }
  });
  it("정상 next는 같은 사이트 상대 경로로 돌아간다", async () => {
    ready();
    user.current = { email: "owner@example.com" };
    const response = await callback("?code=abc&next=%2Fprojects%2F1%3Ftab%3Dedit");
    expect(response.headers.get("location")).toBe("/projects/1?tab=edit");
    expect(calls.exchange).toEqual(["abc"]);
  });
  it("F182-2: x-forwarded-host가 있어도 외부 주소로 보내지 않는다(실패·성공 모두)", async () => {
    ready();
    const evil = { "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" };
    expect((await callback("", evil)).headers.get("location")).toBe("/login?error=link");
    user.current = { email: "owner@example.com" };
    expect((await callback("?code=ok&next=%2Fsettings", evil)).headers.get("location")).toBe("/settings");
  });
  it("만료 링크·알 수 없는 type·허용 밖 계정을 거절한다", async () => {
    ready();
    calls.fail = true;
    expect((await callback("?code=old")).headers.get("location")).toBe("/login?error=link");
    calls.fail = false;
    expect((await callback("?token_hash=t&type=weird")).headers.get("location")).toBe("/login?error=link");
    user.current = { email: "someone@else.com" };
    expect((await callback("?code=ok")).headers.get("location")).toBe("/login?error=forbidden");
    expect(calls.signOut).toBe(1);
  });
});

describe("T-182 검수 수정: 로그인 링크 요청", () => {
  async function login(body: string, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/auth/login/route");
    return POST(new Request("http://localhost:43182/api/auth/login", { method: "POST", body, headers: { host: "127.0.0.1:43182", "content-type": "application/json", ...headers } }));
  }
  it("O182-1: JSON null·배열·문자열은 500이 아니라 400", async () => {
    ready();
    for (const body of ["null", "[]", "\"x\"", "3", "{bad"]) {
      const response = await login(body);
      expect(response.status, body).toBe(400);
      expect((await response.json()).code).toBe("BAD_REQUEST");
    }
  });
  it("F182-2: 메일 링크는 x-forwarded-host가 아닌 접속 주소로 만든다", async () => {
    ready();
    const response = await login(JSON.stringify({ email: "owner@example.com", next: "/\t/evil.test" }), { "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" });
    expect(response.status).toBe(200);
    const link = new URL(calls.otp[0].options.emailRedirectTo);
    expect(link.origin).toBe("http://127.0.0.1:43182");
    expect(link.searchParams.get("next")).toBe("/");
    expect(calls.otp[0].options.shouldCreateUser).toBe(false);
  });
  it("목록에 없는 주소로 접속하면 메일을 보내지 않는다", async () => {
    ready();
    const response = await login(JSON.stringify({ email: "owner@example.com" }), { host: "evil.test" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("AUTH_ORIGIN_UNTRUSTED");
    expect(calls.otp).toHaveLength(0);
  });
  it("허용 밖 주소는 같은 안내만 주고 메일을 보내지 않는다", async () => {
    ready();
    const response = await login(JSON.stringify({ email: "stranger@example.com" }));
    expect(response.status).toBe(200);
    expect(calls.otp).toHaveLength(0);
  });
});

describe("T-182 빌드 검사: 화면 파일의 서비스 키", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "t182-")); mkdirSync(join(dir, ".next/static/chunks"), { recursive: true }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const jwt = (role: string) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role, ref: "test-project" })).toString("base64url"), "signature-part-xyz"].join(".");

  it("anon 키만 있으면 통과한다", async () => {
    const { clientSecretLeaks } = await import("../scripts/verify-build.mjs");
    writeFileSync(join(dir, ".next/static/chunks/a.js"), `const k="${jwt("anon")}";`);
    expect(clientSecretLeaks(dir, undefined)).toBe(1);
  });
  it("service_role JWT가 있으면 실패한다", async () => {
    const { clientSecretLeaks } = await import("../scripts/verify-build.mjs");
    writeFileSync(join(dir, ".next/static/chunks/a.js"), `const k="${jwt("service_role")}";`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => clientSecretLeaks(dir, undefined)).toThrow("서비스 키");
  });
  it("새 형식 비밀키도 환경변수 값이 그대로 보이면 실패한다", async () => {
    const { clientSecretLeaks } = await import("../scripts/verify-build.mjs");
    writeFileSync(join(dir, ".next/static/chunks/a.js"), `const k="sb_secret_abcdefghijklmnopqrstuvwxyz";`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => clientSecretLeaks(dir, "sb_secret_abcdefghijklmnopqrstuvwxyz")).toThrow("서비스 키");
  });
});
