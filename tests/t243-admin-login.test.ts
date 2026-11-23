import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_HOME, ADMIN_LOGIN, adminLoginPath, adminNextPath, isAdminPath, isAnonymousPublicPath, isPublicPath, logoutLoginPath } from "@/lib/auth/config";

// T-243 관리자 로그인·관리 허브. mock Auth 시험이며 실제 Supabase 계정으로 실행한 것이 아니다.
// 기대값 근거: 새 권한·계정 없이 기존 로그인 + 서버 getUser + 허용 이메일만 쓴다. /admin/login만 공개, /admin 아래는 보호.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  getUser: 0,
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/admin" }));
const client = { auth: { getUser: async () => { state.getUser++; return { data: { user: state.user }, error: null }; } } };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => client }));
vi.mock("@/lib/auth/server", () => ({ createSupabaseServer: async () => client }));

const A = "00000000-0000-4000-8000-000000000001";
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } state.user = null; state.getUser = 0; vi.clearAllMocks(); });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
function ready(user: typeof state.user = null) {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.com";
  process.env.VERCEL = "1";
  state.user = user;
}
async function run(path: string) {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(path, "https://studio.test")));
}
const passed = (response: Response) => response.headers.get("x-middleware-next") === "1";
const target = (response: Response) => { const url = new URL(response.headers.get("location")!, "https://studio.test"); return `${url.pathname}${url.search}`; };
const OWNER = { id: A, email: "owner@example.com" };
const OTHER = { id: A, email: "other@example.invalid" };

describe("T-243 경로 판정", () => {
  it("/admin/login만 공개(설정 확인·세션 갱신은 받음), /admin과 그 아래는 보호", () => {
    expect(isPublicPath(ADMIN_LOGIN)).toBe(true);
    expect(isAnonymousPublicPath(ADMIN_LOGIN)).toBe(false);
    for (const path of ["/admin", "/admin/", "/admin/x", "/admin/login/x", "/admin/LOGIN", "/adminx", "/admin/login/"]) expect(isPublicPath(path), path).toBe(false);
    expect([isAdminPath("/admin"), isAdminPath("/admin/x"), isAdminPath("/adminx"), isAdminPath("/administrator")]).toEqual([true, true, false, false]);
  });

  it("로그인 뒤 돌아갈 곳은 같은 사이트 /admin 아래만, 나머지는 /admin", () => {
    expect(adminNextPath("/admin/x?tab=1")).toBe("/admin/x?tab=1");
    expect(adminNextPath("/admin#admin-style-dna")).toBe("/admin#admin-style-dna");
    expect(adminNextPath("/admin#admin-api-integrations")).toBe("/admin#admin-api-integrations");
    for (const bad of [undefined, "", "//evil.test", "https://evil.test/admin", "/\t/evil.test", "/\\evil.test", "/studio", "/adminx", "/admin/login", "/admin/login?next=/admin", "/login"]) expect(adminNextPath(bad), String(bad)).toBe(ADMIN_HOME);
    expect(adminLoginPath({ next: "//evil.test" })).toBe("/admin/login?next=%2Fadmin");
    expect(adminLoginPath({ error: "forbidden" })).toBe("/admin/login?error=forbidden");
  });

  it.each([
    ["/admin", "/admin/login"],
    ["/admin/shorts-analysis", "/admin/login"],
    ["/studio", "/login"],
    ["/adminx", "/login"],
  ])("%s에서 로그아웃하면 해당 로그인 화면으로 돌아간다", (path, login) => {
    expect(logoutLoginPath(path, "ended")).toBe(login);
    expect(logoutLoginPath(path, "partial")).toBe(`${login}?notice=logout-partial`);
  });
});

describe("T-243 proxy", () => {
  it("로그인 설정이 빠지면 /admin/login·/admin 모두 503(열어 두지 않음)", async () => {
    process.env.VERCEL = "1";
    for (const path of [ADMIN_LOGIN, ADMIN_HOME, "/admin/x"]) {
      const response = await run(path);
      expect(response.status, path).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("로그인 전: /admin/login은 세션 갱신 뒤 통과, /admin 아래는 관리자 로그인으로(next 유지), 다른 경로는 기존 그대로", async () => {
    ready();
    expect(passed(await run(ADMIN_LOGIN))).toBe(true);
    expect(state.getUser).toBe(1);
    const admin = await run("/admin");
    expect(admin.status).toBe(307);
    expect(target(admin)).toBe("/admin/login?next=%2Fadmin");
    expect(admin.headers.get("cache-control")).toBe("no-store");
    expect(target(await run("/admin/x?tab=1"))).toBe("/admin/login?next=%2Fadmin%2Fx%3Ftab%3D1");
    expect(target(await run("/studio"))).toBe("/login?next=%2Fstudio");
    expect(target(await run("/adminx"))).toBe("/login?next=%2Fadminx");
    expect((await run("/api/projects")).status).toBe(401);
  });

  it("허용 밖 계정은 /admin이 관리자 로그인 forbidden으로, 허용 계정은 통과", async () => {
    ready(OTHER);
    expect(target(await run("/admin"))).toBe("/admin/login?error=forbidden");
    expect(target(await run("/studio"))).toBe("/login?error=forbidden");
    ready(OWNER);
    expect(passed(await run("/admin"))).toBe(true);
  });
});

describe("T-243 관리 허브 /admin(서버에서 다시 판정)", () => {
  async function page() {
    const { default: AdminPage } = await import("@/app/admin/page");
    return AdminPage();
  }
  it("로그인 없음 401·허용 밖 403·설정 없음 503은 그리기 전에 관리자 로그인으로 보낸다", async () => {
    ready();
    await expect(page()).rejects.toMatchObject({ to: "/admin/login?next=%2Fadmin" });
    ready(OTHER);
    await expect(page()).rejects.toMatchObject({ to: "/admin/login?error=forbidden" });
    process.env.DREAM_ALLOWED_EMAILS = "";
    await expect(page()).rejects.toMatchObject({ to: "/admin/login?error=unavailable" });
  });

  it("허용 계정만 허브를 본다: 자기 범위 링크와 미연결 표시뿐, 가짜 통계·다른 회원·파괴 버튼 없음", async () => {
    ready(OWNER);
    const node = await page();
    const markup = isValidElement(node) ? renderToStaticMarkup(node) : "";
    expect(markup).toContain("관리 화면");
    expect(markup).toContain("owner@example.com");
    for (const href of ["/cloud/manage", "/cloud/projects", "/account/password"]) expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain("미연결");
    expect(markup).not.toMatch(/<form|삭제|정상 작동|전체 사용자|회원 수/);
  });

  it("이 PC 실행(로그인 꺼짐)은 관리자 인증으로 올리지 않고 안내만 보인다", async () => {
    const markup = renderToStaticMarkup((await page()) as React.ReactElement);
    expect(markup).toContain("관리자 로그인은 운영 사이트에서 써요");
    expect(markup).not.toMatch(/관리 메뉴|로그인 계정|<form/);
    expect(state.getUser).toBe(0);
  });
});

describe("T-243 관리자 로그인 화면", () => {
  async function loginPage(params: Record<string, string> = {}) {
    const { default: AdminLoginPage } = await import("@/app/admin/login/page");
    return renderToStaticMarkup(await AdminLoginPage({ searchParams: Promise.resolve(params) }));
  }
  it("로그인 전용 폼(회원가입 탭 없음)과 계정 존재를 드러내지 않는 오류 문구", async () => {
    ready();
    const markup = await loginPage({ error: "forbidden" });
    expect(markup).toContain("<h1");
    expect(markup).toContain("관리자 로그인");
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain("회원가입");
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain("이 계정으로는 관리 화면을 열 수 없어요");
    expect(await loginPage({ error: "anything" })).toContain("로그인 설정이 아직 끝나지 않았어요");
  });
  it("이 PC 실행은 폼 없이 설정 안내만", async () => {
    const markup = await loginPage();
    expect(markup).toContain("관리자 로그인은 운영 사이트에서 써요");
    expect(markup).not.toContain('type="password"');
  });
  it("관리자 로그인은 다른 기기의 로그아웃이 확인되지 않았음을 알린다", async () => {
    ready();
    expect(await loginPage({ notice: "logout-partial" })).toContain("다른 기기의 로그인까지 끝났는지는 확인하지 못했어요.");
  });
  it("두 화면 모두 검색 노출 금지, 로그인 뒤 목적지는 adminNextPath로만 정한다", () => {
    for (const path of ["app/admin/page.tsx", "app/admin/login/page.tsx"]) expect(readFileSync(path, "utf8"), path).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(readFileSync("app/admin/login/page.tsx", "utf8")).toContain("<LoginForm next={adminNextPath(params.next)}");
  });
});

describe("T-244 로그인 폼 누르는 영역 44px(관리자·일반 공용)", () => {
  it("비밀번호 찾기(.linkButton)·보기(.reveal)·탭·글자 버튼은 모두 --touch-min(44px) 이상", () => {
    const css = readFileSync("components/auth/login.module.css", "utf8");
    expect(readFileSync("app/globals.css", "utf8") + readFileSync("docs/design/tokens.css", "utf8")).toMatch(/--touch-min:\s*44px/);
    for (const name of ["reveal", "linkButton", "textButton", "tab"]) {
      const rules = [...css.matchAll(new RegExp(`(?:^|\\n)\\.${name} \\{([^}]*)\\}`, "g"))].map((match) => match[1]).join(";");
      expect(rules, name).toMatch(/min-height:var\(--touch-min\)/);
      expect(rules, name).not.toMatch(/min-height:(?:3\d|[12]?\d)px/);
    }
  });
});

describe("T-243 공용 로그인 폼·공개 메인 진입", () => {
  it("일반 로그인 화면은 기존처럼 로그인·회원가입 탭을 그대로 보인다", async () => {
    const { LoginForm } = await import("@/components/auth/login-form");
    const markup = renderToStaticMarkup(createElement(LoginForm, { next: "/studio" }));
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain("회원가입");
  });
  it("공개 메인 상단의 로그인은 관리자 화면으로, 하단의 크리에이터 로그인은 작업실로 연결한다", async () => {
    const { NeonShowcase } = await import("@/components/public-showcase/neon-showcase");
    const { SAMPLE_WORKS } = await import("@/lib/public-showcase/works");
    const markup = renderToStaticMarkup(createElement(NeonShowcase, { works: SAMPLE_WORKS, loginHref: "/login?next=%2Fstudio" }));
    const header = markup.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
    const footer = markup.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
    expect(header).toMatch(/href="\/admin\/login"[^>]*>관리자 로그인</);
    expect(header).not.toContain('href="/login?next=%2Fstudio"');
    expect(footer).toContain('href="/login?next=%2Fstudio"');
    expect(readFileSync("components/public-showcase/neon-showcase.module.css", "utf8")).toMatch(/\.link \{[^}]*min-height: 44px/);
  });
});
