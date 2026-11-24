import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordContext, passwordDonePath, passwordPagePath, safeNextPath } from "@/lib/auth/config";

// T-245 관리자 비밀번호 재설정 뒤 관리자 로그인으로 돌아오기. mock SDK 시험이며 실제 메일 발송·계정 변경은 없다.
// 기대값 근거: 정해 둔 이름(context="admin")만 받고, 돌아갈 주소는 서버·설정 코드가 고정 문자열로 만든다. 일반 흐름은 그대로.
const calls = vi.hoisted(() => ({ reset: [] as { email: string; options: { redirectTo: string } }[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }) }));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: {
    resetPasswordForEmail: async (email: string, options: { redirectTo: string }) => { calls.reset.push({ email, options }); return { error: null }; },
    getUser: async () => ({ data: { user: null }, error: null }),
  } }),
}));

const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_SITE_URL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } calls.reset = []; });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
function ready() {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.com";
}
async function reset(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/auth/reset/route");
  return POST(new Request("http://localhost:43182/api/auth/reset", { method: "POST", body: JSON.stringify(body), headers: { host: "127.0.0.1:43182", origin: "http://127.0.0.1:43182", "content-type": "application/json", ...headers } }));
}
const nextOf = (index: number) => new URL(calls.reset[index].options.redirectTo).searchParams.get("next");

describe("T-245 고정 이름과 고정 경로", () => {
  it("context는 정확히 \"admin\"만 받는다", () => {
    expect(passwordContext("admin")).toBe("admin");
    for (const value of [undefined, null, "", "Admin", "ADMIN", " admin", "admin ", "/admin", "https://evil.test/admin", "admin&next=//evil.test", ["admin"], { context: "admin" }, 1]) expect(passwordContext(value), JSON.stringify(value)).toBeNull();
  });
  it("비밀번호 화면·끝난 뒤 주소는 고정 문자열", () => {
    expect([passwordPagePath(null), passwordPagePath("admin")]).toEqual(["/account/password", "/account/password?context=admin"]);
    expect([passwordDonePath(null, "ended"), passwordDonePath(null, "partial")]).toEqual(["/login?notice=password", "/login?notice=password-partial"]);
    expect([passwordDonePath("admin", "ended"), passwordDonePath("admin", "partial")]).toEqual(["/admin/login?next=%2Fadmin&notice=password", "/admin/login?next=%2Fadmin&notice=password-partial"]);
    // 메일 링크의 next가 /auth/callback의 기존 같은 사이트 검사를 그대로 통과한다.
    expect(safeNextPath(passwordPagePath("admin"))).toBe("/account/password?context=admin");
  });
});

describe("T-245 비밀번호 찾기 요청(/api/auth/reset)", () => {
  it("관리자 요청만 메일 링크가 관리자 비밀번호 화면으로, 다른 값은 기존과 같은 /account/password", async () => {
    ready();
    expect((await reset({ email: "owner@example.com", context: "admin" })).status).toBe(200);
    expect(new URL(calls.reset[0].options.redirectTo).origin).toBe("http://127.0.0.1:43182");
    expect(new URL(calls.reset[0].options.redirectTo).pathname).toBe("/auth/callback");
    expect(nextOf(0)).toBe("/account/password?context=admin");
    const others: unknown[] = [undefined, "ADMIN", "https://evil.test/x", "/admin", ["admin"]];
    for (const context of others) await reset({ email: "owner@example.com", ...(context === undefined ? {} : { context }) });
    expect(calls.reset.slice(1).map((_, index) => nextOf(index + 1))).toEqual(Array(others.length).fill("/account/password"));
    // next·redirectTo를 본문으로 보내도 쓰지 않는다.
    await reset({ email: "owner@example.com", context: "admin", next: "//evil.test", redirectTo: "https://evil.test/cb" });
    const last = new URL(calls.reset.at(-1)!.options.redirectTo);
    expect(`${last.origin}${last.pathname}`).toBe("http://127.0.0.1:43182/auth/callback");
    expect(last.searchParams.get("next")).toBe("/account/password?context=admin");
  });
  it("허용 밖 주소는 관리자 요청이어도 같은 안내만(계정 존재 미노출), 다른 사이트 요청은 거절", async () => {
    ready();
    const plain = await (await reset({ email: "stranger@example.com" })).json();
    const admin = await (await reset({ email: "stranger@example.com", context: "admin" })).json();
    expect(admin).toEqual(plain);
    expect(calls.reset).toHaveLength(0);
    const cross = await reset({ email: "owner@example.com", context: "admin" }, { host: "evil.test", origin: "http://evil.test" });
    expect(cross.status).toBe(403);
    expect(calls.reset).toHaveLength(0);
  });
});

describe("T-245 화면 연결", () => {
  it("관리자 로그인은 비밀번호 찾기에 admin만 붙이고, 돌아온 안내 문구를 보인다", async () => {
    ready();
    expect(readFileSync("app/admin/login/page.tsx", "utf8")).toContain('loginOnly resetContext="admin" />');
    const { default: AdminLoginPage } = await import("@/app/admin/login/page");
    const done = renderToStaticMarkup(await AdminLoginPage({ searchParams: Promise.resolve({ next: "/admin", notice: "password" }) }));
    expect(done).toContain("비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.");
    const partial = renderToStaticMarkup(await AdminLoginPage({ searchParams: Promise.resolve({ notice: "password-partial" }) }));
    expect(partial).toContain("다른 기기의 로그인까지 끝났는지는 확인하지 못했으니");
    const unknown = renderToStaticMarkup(await AdminLoginPage({ searchParams: Promise.resolve({ notice: "<script>alert(1)</script>" }) }));
    expect(unknown).not.toContain("<script>alert(1)");
    expect(unknown).not.toContain("확인했어요");
  });
  it("로그인 폼: 재설정 본문은 일반이면 email만, 관리자면 email+context(정해 둔 값)", () => {
    const form = readFileSync("components/auth/login-form.tsx", "utf8");
    expect(form).toContain('resetContext ? { email, context: resetContext } : { email }');
    expect(form).toMatch(/resetContext\?: PasswordContext/);
  });
  it("새 비밀번호 화면: context는 passwordContext로만 정하고, 끝난 뒤 주소는 passwordDonePath로만(로그아웃 실패 재시도 흐름 유지)", async () => {
    const page = readFileSync("app/account/password/page.tsx", "utf8");
    expect(page).toContain("const context = passwordContext((await searchParams).context);");
    expect(page).toContain("<NewPasswordForm context={context} />");
    const form = readFileSync("components/auth/new-password-form.tsx", "utf8");
    expect(form).toContain('if (result.state === "ended") { announceSessionChange(); window.location.assign(passwordDonePath(context, "ended")); return; }');
    expect(form).toContain('if (result.state === "partial") { announceSessionChange(); window.location.assign(passwordDonePath(context, "partial")); return; }');
    expect(form).toContain("setLogoutFailure(result.message); setBusy(false);");
    expect(form).toContain('onClick={finishWithLogout}>로그아웃 다시 시도</Button>');
    expect(form).not.toMatch(/location\.assign\("\/login/);
    ready();
    const { default: PasswordPage } = await import("@/app/account/password/page");
    const admin = renderToStaticMarkup(await PasswordPage({ searchParams: Promise.resolve({ context: "admin" }) }));
    expect(admin).toContain("DREAM AI STUDIO · 관리자");
    const plain = renderToStaticMarkup(await PasswordPage({ searchParams: Promise.resolve({ context: "https://evil.test" }) }));
    expect(plain).not.toContain("관리자");
  });
});
