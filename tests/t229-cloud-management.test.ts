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
  // 연결하지 않은 항목 셋은 "미연결"만(0·정상·실패 배지 없음), 처리기→저장소→백업 순서
  expect(markup.match(/>미연결</g)?.length).toBe(3);
  const t = text(markup);
  expect(t.indexOf("작업 처리기 미연결")).toBeLessThan(t.indexOf("파일 저장소 미연결"));
  expect(t.indexOf("파일 저장소 미연결")).toBeLessThan(t.indexOf("백업 미연결"));
  expect(t).not.toMatch(/전체 프로젝트|정상 작동|모두 정상|재시작|복원하기|결제|0B|0%|DATABASE|postgres|supabase\.co|DREAM_|[A-Z]:[\\/]|\/Users\//i);
  // 현재 위치 표시, 다시 불러오기 = 같은 주소의 일반 링크(새 문서 요청)
  expect(markup).toContain('aria-current="page"');
  expect(markup).toMatch(/<a [^>]*href="\/cloud\/manage"[^>]*>다시 불러오기<\/a>/);
}
const dist = (markup: string) => [...markup.matchAll(/<div><dt><span[^>]*>.*?<\/svg>([^<]+)<\/span><\/dt><dd[^>]*>(\d+)개<\/dd><\/div>/g)].map((match) => [match[1], Number(match[2])]);

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
  it("정상: 표시 건수=받은 목록 수, 5종 분포 합계=건수(dl), 성공 조회 시각(한국시간)과 기록 기준 안내", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T03:04:00.000Z"));
    try {
      cloud(); state.list.mockResolvedValue(ok(ROWS));
      const markup = html(await page()), t = text(markup);
      expect(state.list).toHaveBeenCalledTimes(1);
      common(markup);
      expect(t).toContain("표시 목록 4개");
      expect(t).toContain("이번에 불러온 프로젝트 목록 기준이에요.");
      expect(dist(markup)).toEqual([["확인 필요", 1], ["만드는 중", 1], ["승인 대기", 0], ["완료", 2], ["대기", 0]]);
      expect(dist(markup).reduce((sum, [, n]) => sum + (n as number), 0)).toBe(4);
      expect(t).toContain("기록된 프로젝트 상태 기준이며, 처리기의 현재 실행 여부를 뜻하지 않아요.");
      // 조회 시각 = 읽기 성공 시각(프로젝트 수정 시각 아님)
      expect(markup).toContain('dateTime="2026-11-18T03:04:00.000Z"');
      expect(t).toMatch(/목록 조회 시각 .*12:04.*\(한국시간\)/);
      expect(markup).not.toContain("2026-11-17T03:00:00.000Z");
      expect(markup).not.toContain(A);
      expect(markup).not.toContain("합성 11");
      expect(markup).toContain('href="/cloud/projects"');
      untouched();
    } finally { vi.useRealTimers(); }
  });
  it("비어 있음(성공): 0개+조회 시각, 지어낸 설명(옮김·PC 보관) 없이 '이번 목록에 없음'", async () => {
    cloud(); state.list.mockResolvedValue(ok([]));
    const markup = html(await page()), t = text(markup);
    common(markup);
    expect(t).toContain("표시 목록 0개");
    expect(t).toContain("목록 조회 시각");
    expect(t).toContain("이번에 불러온 목록에 프로젝트가 없어요.");
    expect(t).not.toMatch(/옮긴|내 PC 작업실에 있어요|삭제/);
    expect(dist(markup)).toEqual([]);
    untouched();
  });
  it("목록 읽기 실패(503): 0·분포·조회 시각 없이 실패 안내+다시 불러오기, 연결 범위는 그대로", async () => {
    cloud(); state.list.mockResolvedValue({ status: 503, body: { error: "x", code: "PROJECT_READ_UNAVAILABLE" }, headers: {} });
    const markup = html(await page()), t = text(markup);
    common(markup);
    expect(t).toContain("관리 정보를 불러오지 못했어요");
    expect(t).toContain("잠시 뒤 다시 불러와 주세요.");
    expect(t).not.toMatch(/\d+개|목록 조회 시각/);
    expect(markup).not.toContain("<time");
    untouched();
  });
  it("비정상 날짜가 와도 화면 전체가 실패하지 않는다(시각 표시는 조회 시각만)", async () => {
    cloud(); state.list.mockResolvedValue(ok([row("00000000-0000-4000-8000-000000000015", "queued", "not-a-date")]));
    const markup = html(await page());
    expect(text(markup)).toContain("표시 목록 1개");
    expect(markup).not.toContain("Invalid Date");
  });
});

describe("T-229 정적 경계", () => {
  const source = readFileSync("app/(cloud)/cloud/manage/page.tsx", "utf8");
  it("서버 화면: client·fetch·타이머·쓰기 없음, legacy 서비스 import 없음, 인증을 읽기보다 먼저", () => {
    expect(source).not.toMatch(/"use client"|fetch\(|setInterval|setTimeout|method:|router\.refresh|useEffect/);
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
