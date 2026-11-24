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
    expect(pageSource.indexOf("await getRenderAuth()")).toBeLessThan(pageSource.indexOf("await loadAdminProjects(auth.userId)"));
    expect(pageSource.indexOf('auth.kind === "denied"')).toBeLessThan(pageSource.indexOf("await loadAdminProjects(auth.userId)"));
    const source = readFileSync("components/admin/admin-projects.tsx", "utf8");
    expect(source.match(/await readCloudProjects\(\{ adminUserId: userId \}\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/service_role|SERVICE_ROLE|createProjectReadRequest|postgresProjectReads|readCloudProject\(|fetch\(|<form|<button/);
  });
});

describe("T283 허용 관리자 개요의 내 프로젝트 상태 4가지", () => {
  it("미연결: 프로젝트 읽기가 설정되지 않은 환경은 읽지 않고 미연결로만 알린다(0·실패로 보이지 않음)", async () => {
    admin(OWNER);
    const markup = html(await page());
    const t = text(markup);
    expect(t).toContain("프로젝트 목록 미연결");
    expect(t).toContain("이 환경에서 내 프로젝트를 조회하려면 운영 담당자의 연결 확인이 필요해요.");
    // 명세: 카드 안에서 펼치는 네이티브 도움말, 조회 시각·건수·다시 불러오기는 없다
    expect(markup).toMatch(/<details[^>]*><summary>연결 상태 도움말<\/summary>/);
    expect(t).toContain("운영 담당자에게 ‘관리자 화면의 내 프로젝트 목록 연결을 확인해 주세요’라고 알려 주세요.");
    expect(t).not.toMatch(/불러오지 못했어요|조회 시각|내 프로젝트가 0개|내 프로젝트 \d+개|다시 불러오기/);
    expect(state.created).toBe(0);
  });
  it("실패: 설정됐지만 읽기 503이면 실패 안내와 다시 불러오기(같은 주소 링크), 0건·조회 시각을 만들지 않는다", async () => {
    admin(OWNER, "postgres");
    state.list.mockResolvedValue(unavailable);
    const markup = html(await page());
    const t = text(markup);
    expect(t).toContain("프로젝트 목록을 불러오지 못했어요");
    expect(t).toContain("잠시 뒤 다시 불러와 주세요.");
    // 명세: 다시 불러오기는 카드 안 한 곳, 불러온 뒤 '내 프로젝트' 영역으로 돌아온다
    expect(markup.match(/다시 불러오기<\/a>/g)).toHaveLength(1);
    // 검수 4d416a6: 매 렌더 다른 reload 값이 붙어 같은 주소의 '#' 이동이 아니라 실제 문서 요청이 된다.
    expect(markup).toMatch(/<a [^>]*href="\/admin\?reload=[a-z0-9]+#admin-project-list"[^>]*>다시 불러오기<\/a>/);
    expect(markup).toMatch(/<summary>연결 상태 도움말<\/summary>/);
    expect(t).toContain("다시 불러와도 같은 문구가 보이면 ‘내 프로젝트’, 오류 문구, 발생 시각을 운영 담당자에게 알려 주세요.");
    expect(t).not.toMatch(/프로젝트 목록 미연결|조회 시각|내 프로젝트가 0개|내 프로젝트 \d+개/);
    expect(state.list).toHaveBeenCalledTimes(1);
    const second = html(await page());
    const token = (source: string) => source.match(/href="\/admin\?reload=([a-z0-9]+)#admin-project-list"/)?.[1];
    expect(token(second)).toBeDefined();
    expect(token(second)).not.toBe(token(markup));
    expect(state.list).toHaveBeenCalledTimes(2);
  });
  it("결과 없음: 읽기 성공 0건은 0개·조회 시각·없음 안내(미연결·실패와 구분)", async () => {
    admin(OWNER, "postgres");
    state.list.mockResolvedValue(ok([]));
    const t = text(html(await page()));
    expect(t).toContain("내 프로젝트가 0개예요");
    expect(t).toContain("현재 로그인한 계정으로 조회한 결과예요.");
    expect(t).toMatch(/조회 시각 .+\(한국시간\)/);
    expect(t.match(/다시 불러오기/g)).toHaveLength(1);
    expect(t).not.toMatch(/불러오지 못했어요|프로젝트 목록 미연결|연결 상태 도움말/);
  });
  it("목록: 자기 계정 프로젝트의 제목·상태·다음 단계·상세 이동 링크만, 원본 행·owner·입력값은 그리지 않는다", async () => {
    admin(OWNER, "postgres");
    state.list.mockResolvedValue(ok([
      row("00000000-0000-4000-8000-000000000021", "running", "합성 프로젝트 하나"),
      row("00000000-0000-4000-8000-000000000022", "approval", "합성 프로젝트 둘"),
    ]));
    const markup = html(await page());
    const t = text(markup);
    expect(t).toContain("내 프로젝트 2개");
    expect(t).toMatch(/조회 시각 .+\(한국시간\)/);
    expect(t.match(/다시 불러오기/g)).toHaveLength(1);
    expect(t).not.toMatch(/연결 상태 도움말|불러오지 못했어요/);
    for (const id of ["21", "22"]) expect(markup).toContain(`href="/cloud/projects/00000000-0000-4000-8000-0000000000${id}#admin-project-heading"`);
    expect(t).toContain("합성 프로젝트 하나 상세 보기");
    expect(t).toContain("만드는 중");
    expect(t).toContain("승인 대기");
    expect(t).toContain("다음 단계 기획");
    expect(t).toContain("쇼핑숏츠 · 9:16 · 15초");
    expect(markup).toContain('href="/cloud/projects"');
    expect(markup).not.toMatch(/should-not-render|INPUT-SECRET-283|shopping-shorts|ownerId|삭제|전체 사용자|회원 수|정상 작동/);
    // Search and status filtering apply to the already owned rows.
    const start = markup.indexOf('aria-labelledby="admin-projects"');
    const section = markup.slice(start, markup.indexOf("</section>", start));
    expect(section.length).toBeGreaterThan(100);
    expect(section).toContain('type="search"');
    expect(section).toContain("<select");
    expect(section).not.toMatch(/<form|<button|<textarea/);
    expect(text(section)).toContain("내용 버전 확인 불가");
    expect(text(section)).toContain("출력 파일 확인 불가");
    expect(state.list).toHaveBeenCalledTimes(1);
    // 기존 관리 메뉴·미연결 범위는 유지
    for (const href of ["/cloud/manage", "/account/password"]) expect(markup).toContain(`href="${href}"`);
    expect(t).toContain("회원 관리 미연결");
  });
});
