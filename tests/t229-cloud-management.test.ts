import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-229 클라우드 개인 관리(읽기 전용). 기대값은 제품 요구(T-229 배정, T-230 의미 요구)에서 나온다.
// - 인증 먼저, 그 뒤에만 owner 목록 읽기 1번. 로컬 저장소·SQLite·시작 점검·메뉴 파일은 열지 않는다.
// - 숫자는 이번에 실제로 받은 목록에서만 센다(합계 = 표시 건수). 전체 총수·처리기·DB 상태로 부풀리지 않는다.
// - Storage·처리기·백업은 "미연결·확인할 수 없음". 폼·버튼·쓰기·자동 새로고침 없음.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  fail: false,
  list: vi.fn(),
  created: 0,
  sqlite: vi.fn(),
  startup: vi.fn(),
  menus: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => {
    if (state.fail) throw new Error("network");
    return { data: { user: state.user }, error: null };
  } } }),
}));
vi.mock("@/lib/services/postgres/project-read-request", () => ({
  createProjectReadRequest: (overrides: { resolveAuth?: () => Promise<unknown> }) => {
    state.created++;
    return { list: async () => { await overrides.resolveAuth?.(); return state.list(); }, get: vi.fn() };
  },
}));
vi.mock("better-sqlite3", () => ({ default: vi.fn(function Database() { state.sqlite(); throw new Error("legacy SQLite must not open"); }) }));
vi.mock("@/lib/services/startup", () => ({ checkStartup: state.startup, checkStorageStartup: state.startup }));
vi.mock("@/lib/menus/server", () => ({ getMenuConfig: state.menus, getMenuConfigState: state.menus }));

const A = "00000000-0000-4000-8000-000000000001";
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
function cloud(user: typeof state.user = { id: A, email: "a@example.invalid" }) {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public";
  process.env.DREAM_ALLOWED_EMAILS = "a@example.invalid";
  process.env.VERCEL = "1";
  state.user = user;
}
beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  state.user = null; state.fail = false; state.created = 0;
  vi.clearAllMocks();
});
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const ok = (body: unknown) => ({ status: 200, body, headers: { "cache-control": "no-store" } });
const row = (id: string, status: string, updatedAt: string) => ({ id, title: `합성 ${id.slice(-2)}`, menuId: "shopping-shorts", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 4, updatedAt, status, nextStage: "brief", ownerId: A });
const ROWS = [
  row("00000000-0000-4000-8000-000000000011", "warning", "2026-11-17T01:00:00.000Z"),
  row("00000000-0000-4000-8000-000000000012", "running", "2026-11-17T03:00:00.000Z"),
  row("00000000-0000-4000-8000-000000000013", "done", "2026-11-16T01:00:00.000Z"),
  row("00000000-0000-4000-8000-000000000014", "done", "2026-11-15T01:00:00.000Z"),
];
async function page() { return (await import("@/app/(cloud)/cloud/manage/page")).default(); }
async function settle(run: () => Promise<unknown>) { try { return { value: await run() }; } catch (error) { return { error: error as Error & { to?: string } }; } }
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
function untouched() {
  expect(state.sqlite).not.toHaveBeenCalled();
  expect(state.startup).not.toHaveBeenCalled();
  expect(state.menus).not.toHaveBeenCalled();
}
function common(markup: string) {
  expect(markup.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(markup).not.toMatch(/<form|<input|<button|<textarea|<select/);
  // 연결하지 않은 항목은 셋 다 미연결로만
  expect(markup.match(/미연결 · 확인할 수 없음/g)?.length).toBe(3);
  for (const word of ["자료 파일 보관", "작업 처리기", "백업"]) expect(markup).toContain(word);
  // 과장·가짜 상태 금지
  expect(text(markup)).not.toMatch(/전체 프로젝트|정상 작동|모두 정상|재시작|복원하기|결제|DATABASE|postgres|supabase\.co|DREAM_|[A-Z]:\\|\/Users\//i);
  // 다시 불러오기는 이 주소로 가는 링크
  expect(markup).toContain('href="/cloud/manage"');
}

describe("T-229 인증 판정이 데이터 읽기보다 먼저", () => {
  it.each([
    ["401 로그인 없음", () => cloud(null), "/login?next=%2Fcloud%2Fmanage"],
    ["403 허용 밖 계정", () => cloud({ id: A, email: "other@example.invalid" }), "/login?error=forbidden"],
    ["503 인증 확인 불가", () => { cloud(); state.fail = true; }, "/login?error=unavailable"],
  ])("%s → 로그인 화면, 목록 읽기 0", async (_name, arrange, to) => {
    arrange();
    const result = await settle(page);
    expect(result.error?.to).toBe(to);
    expect(state.created).toBe(0);
    expect(state.list).not.toHaveBeenCalled();
    untouched();
  });
  it("이 PC(로그인 꺼짐) → 로컬 안내(h1 개인 관리), 목록 읽기 0", async () => {
    const markup = html(await page());
    expect(markup).toMatch(/<h1[^>]*>개인 관리<\/h1>/);
    expect(markup).toContain("이 PC에서는 기존 작업실을 써요");
    expect(state.created).toBe(0);
    untouched();
  });
});

describe("T-229 로그인 상태 화면", () => {
  it("정상: 표시 건수=받은 목록 수, 상태 5종 합계=표시 건수, 읽은 시각과 프로젝트 수정 시각을 따로, 기록 기준 안내", async () => {
    cloud(); state.list.mockResolvedValue(ok(ROWS));
    const markup = html(await page()), page_ = text(markup);
    expect(state.list).toHaveBeenCalledTimes(1);
    common(markup);
    expect(page_).toContain("표시 목록 4개");
    expect(page_).toContain("이번에 불러온 목록 기준");
    const counts = [...markup.matchAll(/<li><span[^>]*>.*?<\/svg>([^<]+)<\/span><span[^>]*>(\d+)개<\/span><\/li>/g)].map((match) => [match[1], Number(match[2])]);
    expect(counts).toEqual([["확인 필요", 1], ["만드는 중", 1], ["승인 대기", 0], ["대기", 0], ["완료", 2]]);
    expect(counts.reduce((sum, [, n]) => sum + (n as number), 0)).toBe(4);
    expect(page_).toContain("기록된 프로젝트 상태 기준이에요. 실제 처리기 연결이나 지금 실행 중인지는 확인하지 않아요.");
    expect(page_).toContain("목록을 불러온 시각");
    expect(markup).toContain('dateTime="2026-11-17T03:00:00.000Z"'); // 가장 최근 수정(받은 목록 중)
    expect(page_).toContain("프로젝트 마지막 수정(가장 최근)");
    // 개별 프로젝트 제목·owner·id는 이 화면에 나열하지 않는다(목록 화면으로 링크)
    expect(markup).not.toContain(A);
    expect(markup).not.toContain("합성 11");
    expect(markup).toContain('href="/cloud/projects"');
    untouched();
  });
  it("비어 있음: 0을 '정상'으로 꾸미지 않고 옮긴 프로젝트가 없다고 안내, 상태 표·읽은 시각 없음", async () => {
    cloud(); state.list.mockResolvedValue(ok([]));
    const markup = html(await page());
    common(markup);
    expect(text(markup)).toContain("아직 클라우드에 옮긴 프로젝트가 없어요");
    expect(markup).not.toContain("상태별 프로젝트 수");
    untouched();
  });
  it("목록 읽기 실패(503): 숫자 없이 실패 안내 + 다시 불러오기, 연결 준비 상태는 그대로", async () => {
    cloud(); state.list.mockResolvedValue({ status: 503, body: { error: "x", code: "PROJECT_READ_UNAVAILABLE" }, headers: {} });
    const markup = html(await page());
    common(markup);
    expect(text(markup)).toContain("프로젝트 상태를 불러오지 못했어요");
    expect(markup).not.toContain("표시 목록");
    expect(markup).not.toContain("목록을 불러온 시각");
    untouched();
  });
});

describe("T-229 정적 경계", () => {
  const source = readFileSync("app/(cloud)/cloud/manage/page.tsx", "utf8");
  it("서버 화면: client·fetch·타이머·쓰기 없음, legacy 서비스 import 없음, 인증을 읽기보다 먼저", () => {
    expect(source).not.toMatch(/"use client"|fetch\(|setInterval|setTimeout|method:|router\.refresh/);
    const imports = source.split(/\r?\n/).filter((line) => line.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/lib\/services\/(?!postgres)|lib\/db|lib\/storage|better-sqlite3|startup|menus\/server/);
    expect(source.indexOf("await getRenderAuth()")).toBeLessThan(source.indexOf("await readCloudProjects()"));
  });
  it("목록 화면에 개인 관리 링크, (cloud) 레이아웃의 세션 경계 안에 들어감", () => {
    expect(readFileSync("app/(cloud)/cloud/projects/(list)/page.tsx", "utf8")).toContain('<Link href="/cloud/manage">개인 관리 보기 →</Link>');
    const layout = readFileSync("app/(cloud)/layout.tsx", "utf8");
    expect(layout).toMatch(/<ProtectedContent>\{children\}<\/ProtectedContent>/);
  });
});
