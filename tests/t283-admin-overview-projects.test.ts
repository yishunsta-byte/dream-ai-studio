import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T283 관리자 개요의 내 프로젝트(읽기 전용). mock Auth·mock 읽기 시험이며 실제 Supabase·DB로 실행한 것이 아니다.
// 기대값 근거: Master msg_930b9900eeed — 기존 /cloud/manage의 자기 계정 목록 읽기 재사용, 결과 없음과 미연결/실패 분리,
// 관리자 인증·자기 범위 유지(타회원·서비스 역할 없음), 인증 판정이 읽기보다 먼저.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  list: vi.fn(),
  created: 0,
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/admin" }));
vi.mock("@/lib/auth/server", () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }) }));
vi.mock("@/lib/services/postgres/project-read-request", () => ({
  createProjectReadRequest: (overrides: { resolveAuth?: () => Promise<unknown> }) => {
    state.created++;
    return { list: async () => { await overrides.resolveAuth?.(); return state.list(); }, get: vi.fn() };
  },
}));

const A = "00000000-0000-4000-8000-000000000001";
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_PROJECT_READ_BACKEND"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } state.user = null; state.created = 0; vi.clearAllMocks(); });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
function admin(user: typeof state.user, backend?: "postgres") {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.com";
  process.env.VERCEL = "1";
  if (backend) process.env.DREAM_PROJECT_READ_BACKEND = backend;
  state.user = user;
}
const OWNER = { id: A, email: "owner@example.com" };
const ok = (body: unknown) => ({ status: 200, body, headers: { "cache-control": "no-store" } });
const unavailable = { status: 503, body: { error: "x", code: "PROJECT_READ_UNAVAILABLE" }, headers: { "cache-control": "no-store" } };
const row = (id: string, status: string, title: string) => ({ id, title, menuId: "shopping-shorts", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 15,
  updatedAt: "2026-11-19T01:00:00.000Z", status, nextStage: "plan", ownerId: "should-not-render", inputs: { secret: "INPUT-SECRET-283" } });
async function page() { const { default: AdminPage } = await import("@/app/admin/page"); return AdminPage(); }
async function settle(run: () => Promise<unknown>) { try { return { value: await run() }; } catch (error) { return { error: error as Error & { to?: string } }; } }
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("T283 관리자 인증이 프로젝트 읽기보다 먼저", () => {
  it("로그인 없음·허용 밖·설정 없음은 관리자 로그인으로 보내고 목록을 읽지 않는다", async () => {
    admin(null, "postgres");
    expect((await settle(page)).error?.to).toBe("/admin/login?next=%2Fadmin");
    admin({ id: A, email: "other@example.invalid" }, "postgres");
    expect((await settle(page)).error?.to).toBe("/admin/login?error=forbidden");
    process.env.DREAM_ALLOWED_EMAILS = "";
    expect((await settle(page)).error?.to).toBe("/admin/login?error=unavailable");
    expect(state.created).toBe(0);
    expect(state.list).not.toHaveBeenCalled();
  });
  it("이 PC 실행(로그인 꺼짐)은 안내만, 읽기 없음", async () => {
    process.env.DREAM_PROJECT_READ_BACKEND = "postgres";
    const markup = html(await page());
    expect(markup).toContain("관리자 로그인은 운영 사이트에서 써요");
    expect(markup).not.toContain("내 프로젝트");
    expect(state.created).toBe(0);
  });
  it("소스 순서: 페이지는 인증 판정 뒤 loadAdminProjects를 부르고, 읽기는 기존 readCloudProjects 하나뿐이다", () => {
    const pageSource = readFileSync("app/admin/page.tsx", "utf8");
    expect(pageSource.indexOf("await getRenderAuth()")).toBeLessThan(pageSource.indexOf("await loadAdminProjects()"));
    expect(pageSource.indexOf('auth.kind === "denied"')).toBeLessThan(pageSource.indexOf("await loadAdminProjects()"));
    const source = readFileSync("components/admin/admin-projects.tsx", "utf8");
    expect(source.match(/await readCloudProjects\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/service_role|SERVICE_ROLE|createProjectReadRequest|postgresProjectReads|readCloudProject\(|fetch\(|<form|<button/);
  });
});

describe("T283 허용 관리자 개요의 내 프로젝트 상태 4가지", () => {
  it("미연결: 프로젝트 읽기가 설정되지 않은 환경은 읽지 않고 미연결로만 알린다(0·실패로 보이지 않음)", async () => {
    admin(OWNER);
    const markup = html(await page());
    const t = text(markup);
    expect(t).toContain("프로젝트 목록 미연결");
    expect(t).toContain("클라우드 프로젝트 읽기가 연결되어 있지 않아요");
    expect(t).not.toMatch(/불러오지 못했어요|표시 목록|프로젝트가 없어요/);
    expect(markup).not.toContain('href="/admin">다시 불러오기');
    expect(state.created).toBe(0);
  });
  it("실패: 설정됐지만 읽기 503이면 실패 안내와 다시 불러오기(같은 주소 링크), 0건·조회 시각을 만들지 않는다", async () => {
    admin(OWNER, "postgres");
    state.list.mockResolvedValue(unavailable);
    const markup = html(await page());
    const t = text(markup);
    expect(t).toContain("프로젝트 목록을 불러오지 못했어요");
    expect(markup).toMatch(/<a [^>]*href="\/admin"[^>]*>다시 불러오기<\/a>/);
    expect(t).not.toMatch(/프로젝트 목록 미연결|표시 목록|조회 시각|프로젝트가 없어요/);
    expect(state.list).toHaveBeenCalledTimes(1);
  });
  it("결과 없음: 읽기 성공 0건은 0개·조회 시각·없음 안내(미연결·실패와 구분)", async () => {
    admin(OWNER, "postgres");
    state.list.mockResolvedValue(ok([]));
    const t = text(html(await page()));
    expect(t).toContain("표시 목록 0개");
    expect(t).toContain("조회 시각");
    expect(t).toContain("이번에 불러온 목록에 프로젝트가 없어요");
    expect(t).not.toMatch(/불러오지 못했어요|프로젝트 목록 미연결/);
  });
  it("목록: 자기 계정 프로젝트의 제목·상태·다음 단계·상세 이동 링크만, 원본 행·owner·입력값은 그리지 않는다", async () => {
    admin(OWNER, "postgres");
    state.list.mockResolvedValue(ok([
      row("00000000-0000-4000-8000-000000000021", "running", "합성 프로젝트 하나"),
      row("00000000-0000-4000-8000-000000000022", "approval", "합성 프로젝트 둘"),
    ]));
    const markup = html(await page());
    const t = text(markup);
    expect(t).toContain("표시 목록 2개");
    for (const id of ["21", "22"]) expect(markup).toContain(`href="/cloud/projects/00000000-0000-4000-8000-0000000000${id}"`);
    expect(t).toContain("합성 프로젝트 하나 상세 보기");
    expect(t).toContain("만드는 중");
    expect(t).toContain("승인 대기");
    expect(t).toContain("다음 단계 기획");
    expect(t).toContain("쇼핑숏츠 · 9:16 · 15초");
    expect(markup).toContain('href="/cloud/projects"');
    expect(markup).not.toMatch(/should-not-render|INPUT-SECRET-283|shopping-shorts|ownerId|삭제|전체 사용자|회원 수|정상 작동/);
    // 내 프로젝트 영역에는 조작 요소가 없다(계정 메뉴의 로그아웃 버튼은 기존 머리글 소속).
    const section = markup.slice(markup.indexOf('aria-labelledby="admin-projects"'), markup.indexOf('aria-labelledby="admin-menu"'));
    expect(section.length).toBeGreaterThan(100);
    expect(section).not.toMatch(/<form|<input|<button|<select|<textarea/);
    expect(state.list).toHaveBeenCalledTimes(1);
    // 기존 관리 메뉴·미연결 범위는 유지
    for (const href of ["/cloud/manage", "/account/password"]) expect(markup).toContain(`href="${href}"`);
    expect(t).toContain("회원 관리 미연결");
  });
});
