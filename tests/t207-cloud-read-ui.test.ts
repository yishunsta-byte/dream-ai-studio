/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-207 클라우드 읽기 전용 화면. adapter는 대역으로 두고 판정·표시값·legacy 미접근을 본다(실제 PG는 HTTP 검증기).
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  fail: false,
  getUser: vi.fn(),
  created: [] as { resolveAuth?: unknown }[],
  list: vi.fn(),
  get: vi.fn(),
  sqlite: vi.fn(),
  startup: vi.fn(),
  menus: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
  notFound: vi.fn(() => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: state.notFound }));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => {
    state.getUser();
    if (state.fail) throw new Error("network");
    return { data: { user: state.user }, error: null };
  } } }),
}));
vi.mock("@/lib/services/postgres/project-read-request", () => ({
  createProjectReadRequest: (overrides: { resolveAuth?: () => Promise<unknown> }) => {
    state.created.push(overrides);
    return {
      list: async () => { await overrides.resolveAuth?.(); return state.list(); },
      get: async (id: () => Promise<string>) => { await overrides.resolveAuth?.(); return state.get(await id()); },
    };
  },
}));
vi.mock("better-sqlite3", () => ({ default: vi.fn(function Database() { state.sqlite(); throw new Error("legacy SQLite must not open"); }) }));
vi.mock("@/lib/services/startup", () => ({ checkStartup: state.startup, checkStorageStartup: state.startup }));
vi.mock("@/lib/menus/server", () => ({ getMenuConfig: state.menus, getMenuConfigState: state.menus }));

const A = "00000000-0000-4000-8000-000000000001";
const PA = "00000000-0000-4000-8000-000000000010";
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
function signedIn() {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public";
  process.env.DREAM_ALLOWED_EMAILS = "a@example.invalid";
  process.env.VERCEL = "1";
  state.user = { id: A, email: "a@example.invalid" };
}
beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  state.user = null; state.fail = false; state.created.length = 0;
  vi.clearAllMocks();
});
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const ok = (body: unknown) => ({ status: 200, body, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string) => ({ status, body: { error: "x", code }, headers: { "cache-control": "no-store" } });
const row = { id: PA, title: "합성 프로젝트", menuId: "shopping-shorts", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 4, updatedAt: "2026-11-17T01:00:00.000Z", status: "queued", nextStage: "brief", states: [{ stage: "intake", status: "approved" }], ownerId: A };
const stages = ["intake", "brief", "plan", "produce", "edit", "review", "export"].map((stage, index) => ({ stage, status: index === 0 ? "approved" : index === 1 ? "todo" : "locked" }));
const detail = { project: { id: PA, ownerId: A, title: "합성 프로젝트", aspect: "9:16", lengthSec: 4, updatedAt: "2026-11-17T01:00:00.000Z", inputsJson: "{\"secret\":\"입력 원문\"}" }, snapshot: { menu: { label: "쇼핑숏츠" }, stages: [{ id: "intake", label: "등록" }, { id: "brief", label: "요구 확인" }] }, inputs: { secret: "입력 원문" }, states: stages };

async function listPage() { return (await import("@/app/(cloud)/cloud/projects/(list)/page")).default(); }
function trap() { const read = vi.fn(() => { throw new Error("must not read params"); }); return { read, params: { then: read } as unknown as Promise<{ id: string }> }; }
async function detailPage(params: Promise<{ id: string }>) { return (await import("@/app/(cloud)/cloud/projects/[id]/page")).default({ params }); }
async function settle(run: () => Promise<unknown>) { try { return { value: await run() }; } catch (error) { return { error: error as Error & { to?: string; notFound?: boolean } }; } }
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
function legacyUntouched() {
  expect(state.sqlite).not.toHaveBeenCalled();
  expect(state.startup).not.toHaveBeenCalled();
  expect(state.menus).not.toHaveBeenCalled();
}

describe("정적: (cloud) 화면은 legacy 서비스·저장소를 import하지 않는다", () => {
  const files = ["lib/cloud/project-read-page.ts", "components/cloud/project-list-readonly.tsx", "components/cloud/project-detail-readonly.tsx",
    "app/(cloud)/layout.tsx", "app/(cloud)/cloud/projects/(list)/page.tsx", "app/(cloud)/cloud/projects/(list)/loading.tsx",
    "app/(cloud)/cloud/projects/[id]/page.tsx", "app/(cloud)/cloud/projects/[id]/not-found.tsx"];
  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const target of imports) {
      expect(target, file).not.toMatch(/^@\/lib\/services\/(?!postgres\/project-read-request$)/);
      expect(target, file).not.toMatch(/menus\/server|startup|better-sqlite3|legacy-page-gate|legacy-gate|lib\/db\/connection|studio-layout/);
    }
  });
  it("단건 화면은 로딩 경계 밖(목록만 loading.tsx) — 404 상태가 스트리밍으로 200이 되지 않게", () => {
    expect(() => readFileSync("app/(cloud)/cloud/projects/loading.tsx")).toThrow();
    expect(() => readFileSync("app/(cloud)/cloud/projects/[id]/loading.tsx")).toThrow();
    expect(() => readFileSync("app/(cloud)/loading.tsx")).toThrow();
  });
  it("단계 이름이 고정 메뉴 설정과 같다", async () => {
    const { STAGE_LABELS } = await import("@/lib/cloud/project-read-page");
    const config = JSON.parse(readFileSync("docs/spec/menus.json", "utf8")) as { stages: { id: string; label: string }[] };
    expect(Object.entries(STAGE_LABELS)).toEqual(config.stages.map((stage) => [stage.id, stage.label]));
  });
});

describe("인증 거절: 로그인 화면으로, adapter·params 0", () => {
  it.each([
    ["no session", "/login?next=%2Fcloud%2Fprojects"],
    ["forbidden", "/login?error=forbidden"],
    ["provider error", "/login?error=unavailable"],
    ["missing config", "/login?error=unavailable"],
  ])("%s → %s (목록·단건)", async (scenario, to) => {
    signedIn();
    if (scenario === "no session") state.user = null;
    if (scenario === "forbidden") state.user = { id: A, email: "other@example.invalid" };
    if (scenario === "provider error") state.fail = true;
    if (scenario === "missing config") delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await settle(listPage)).error?.to).toBe(to);
    const { read, params } = trap();
    expect((await settle(() => detailPage(params))).error?.to).toBe(to);
    expect(read).not.toHaveBeenCalled();
    expect(state.created).toHaveLength(0);
    legacyUntouched();
  });
});

describe("이 PC(로그인 꺼짐): 안내만, adapter 0", () => {
  it("목록·단건", async () => {
    expect(html((await settle(listPage)).value)).toContain("이 PC에서는 기존 작업실을 써요");
    const { read, params } = trap();
    expect(html((await settle(() => detailPage(params))).value)).toContain("이 PC에서는 기존 작업실을 써요");
    expect(read).not.toHaveBeenCalled();
    expect(state.created).toHaveLength(0);
    expect(state.getUser).not.toHaveBeenCalled();
    legacyUntouched();
  });
});

describe("확인된 계정: adapter(요청마다 새로, resolveAuth=getRenderAuth)", () => {
  it("adapter에 getRenderAuth를 넘기고 화면 그리기마다 새로 만든다", async () => {
    signedIn(); state.list.mockResolvedValue(ok([]));
    await listPage(); await listPage();
    const { getRenderAuth } = await import("@/lib/auth/render");
    expect(state.created).toHaveLength(2);
    expect(state.created.every((overrides) => overrides.resolveAuth === getRenderAuth)).toBe(true);
    legacyUntouched();
  });
  it("빈 목록 안내", async () => {
    signedIn(); state.list.mockResolvedValue(ok([]));
    const markup = html(await listPage());
    expect(markup).toContain("아직 클라우드에 옮긴 프로젝트가 없어요");
    expect(markup).toContain("보기만");
  });
  it("목록: 표시값만, 상세 링크만(legacy 단계·만들기 링크 없음), owner·원본 미노출", async () => {
    signedIn(); state.list.mockResolvedValue(ok([row]));
    const { readCloudProjects } = await import("@/lib/cloud/project-read-page");
    const result = await readCloudProjects();
    expect(result.kind === "ok" && Object.keys(result.data[0]).sort()).toEqual(["aspect", "id", "lengthSec", "menuLabel", "nextStageLabel", "status", "title", "updatedAt"]);
    const markup = html(await listPage());
    expect(markup).toContain("합성 프로젝트");
    expect(markup).toContain("다음 단계: 요구 확인");
    expect(markup).toContain(`href="/cloud/projects/${PA}"`);
    expect(markup).not.toContain(A);
    expect([...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual([`/cloud/projects/${PA}`]);
  });
  it("단건: 인증 뒤 params, 개요·단계 상태, 입력 원문·owner 미노출, 단계 화면 링크 없음", async () => {
    signedIn(); state.get.mockResolvedValue(ok(detail));
    const markup = html(await detailPage(Promise.resolve({ id: PA })));
    expect(state.get).toHaveBeenCalledWith(PA);
    expect(markup).toContain("합성 프로젝트");
    expect(markup).toContain("요구 확인");
    expect(markup).toContain("승인됨");
    expect(markup).not.toContain("입력 원문");
    expect(markup).not.toContain(A);
    expect([...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(["/cloud/projects"]);
    legacyUntouched();
  });
  it.each([[400, "INVALID_INPUT"], [404, "NOT_FOUND"]])("단건 %i %s → notFound(같은 처리)", async (status, code) => {
    signedIn(); state.get.mockResolvedValue(fail(status, code));
    const result = await settle(() => detailPage(Promise.resolve({ id: "x" })));
    expect(result.error?.notFound).toBe(true);
  });
  it("503 PROJECT_READ_UNAVAILABLE → 공통 안내(내부 정보 없음)", async () => {
    signedIn(); state.list.mockResolvedValue(fail(503, "PROJECT_READ_UNAVAILABLE")); state.get.mockResolvedValue(fail(503, "PROJECT_READ_UNAVAILABLE"));
    for (const markup of [html(await listPage()), html(await detailPage(Promise.resolve({ id: PA })))]) {
      expect(markup).toContain("프로젝트를 불러오지 못했어요");
      expect(markup).not.toMatch(/postgres|DATABASE_URL|SQL|stack/i);
    }
  });
  it.each([["AUTH_REQUIRED", 401, "/login?next=%2Fcloud%2Fprojects"], ["AUTH_FORBIDDEN", 403, "/login?error=forbidden"], ["AUTH_UNAVAILABLE", 503, "/login?error=unavailable"]])("adapter가 %s를 돌려주면 로그인 이동", async (code, status, to) => {
    signedIn(); state.list.mockResolvedValue(fail(status, code));
    expect((await settle(listPage)).error?.to).toBe(to);
  });
});

describe("레이아웃", () => {
  it("계정·로그아웃만, 메뉴·시작 점검·SQLite 0", async () => {
    signedIn();
    const { default: CloudLayout } = await import("@/app/(cloud)/layout");
    const markup = html(await CloudLayout({ children: "내용" }));
    expect(markup).toContain("a@example.invalid");
    expect(markup).toContain("로그아웃");
    expect(markup).toContain("내용");
    legacyUntouched();
  });
});
