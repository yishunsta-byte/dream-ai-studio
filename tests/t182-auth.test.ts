import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowedEmails, authMode, authReady, isAllowedEmail, isPublicPath, requestOrigin, safeNextPath } from "@/lib/auth/config";

const user = { current: null as null | { email: string } };
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: user.current } }) } }),
}));

const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } user.current = null; });
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
  it("돌아올 주소는 브라우저가 접속한 주소를 따른다(localhost로 바뀌지 않음)", () => {
    expect(requestOrigin(new Request("http://localhost:43182/x", { headers: { host: "127.0.0.1:43182" } }))).toBe("http://127.0.0.1:43182");
    expect(requestOrigin(new Request("http://localhost:3000/x", { headers: { host: "internal", "x-forwarded-host": "studio.vercel.app", "x-forwarded-proto": "https" } }))).toBe("https://studio.vercel.app");
    expect(requestOrigin(new Request("http://127.0.0.1:43182/x"))).toBe("http://127.0.0.1:43182");
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
    const target = new URL(response.headers.get("location")!);
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
    expect(new URL(page.headers.get("location")!).searchParams.get("error")).toBe("forbidden");
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
