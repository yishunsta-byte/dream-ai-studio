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
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: state.notFound, usePathname: () => "/cloud/projects" }));
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
    "app/(cloud)/layout.tsx", "app/(cloud)/cloud/projects/(list)/page.tsx",
    "app/(cloud)/cloud/projects/[id]/page.tsx", "app/(cloud)/cloud/projects/[id]/not-found.tsx", "app/(cloud)/cloud/projects/new/page.tsx"];
  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    for (const target of imports) {
      expect(target, file).not.toMatch(/^@\/lib\/services\/(?!postgres\/project-read-request$)/);
      expect(target, file).not.toMatch(/menus\/server|startup|better-sqlite3|legacy-page-gate|legacy-gate|lib\/db\/connection|studio-layout/);
    }
  });
  it("(cloud) 어디에도 로딩 경계·Suspense가 없다 — 인증 거절 307·없는 프로젝트 404가 스트리밍 200으로 바뀌지 않게(T-210)", () => {
    const all = Object.keys(import.meta.glob("../app/**/*.{ts,tsx}")).filter((path) => path.startsWith("../app/(cloud)/"));
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.filter((path) => /\/loading\.tsx$/.test(path))).toEqual([]);
    expect(Object.keys(import.meta.glob("../app/loading.tsx"))).toEqual([]);
    for (const file of [...files, ...all.map((path) => path.replace("../", ""))]) expect(readFileSync(file, "utf8"), file).not.toMatch(/Suspense|loading\.tsx/);
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
    const h1 = (markup: string) => [...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((match) => match[1]);
    const list = html((await settle(listPage)).value);
    expect(list).toContain("이 PC에서는 기존 작업실을 써요");
    const { read, params } = trap();
    const detail = html((await settle(() => detailPage(params))).value);
    expect(detail).toContain("이 PC에서는 기존 작업실을 써요");
    // T-217: 로컬 안내도 페이지 제목(h1) 정확히 하나, 기존 작업실 링크 하나만
    expect(h1(list)).toEqual(["내 프로젝트"]);
    expect(h1(detail)).toEqual(["프로젝트 보기"]);
    for (const markup of [list, detail]) expect([...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(["/studio"]); // T-241: 작업실 주소 /studio
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
  it("목록: 표시값만, 상세 링크 + 만들기 준비 안내 링크만(legacy 단계·실제 만들기 링크 없음), owner·원본 미노출", async () => {
    signedIn(); state.list.mockResolvedValue(ok([row]));
    const { readCloudProjects } = await import("@/lib/cloud/project-read-page");
    const result = await readCloudProjects();
    expect(result.kind === "ok" && Object.keys(result.data[0]).sort()).toEqual(["aspect", "id", "lengthSec", "menuLabel", "nextStageLabel", "status", "title", "updatedAt"]);
    const markup = html(await listPage());
    expect(markup).toContain("합성 프로젝트");
    expect(markup).toContain("다음 단계: 요구 확인");
    expect(markup).toContain(`href="/cloud/projects/${PA}"`);
    expect(markup).not.toContain(A);
    // T-219: 만들기 화면 링크는 없고, 준비 안내로 가는 이차 링크 하나만 더해졌다.
    expect([...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(["/cloud/projects/new", `/cloud/projects/${PA}`, "/cloud/manage"]);
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
  it("모든 상태의 페이지 제목(h1)은 정확히 하나(T-214): 목록 정상·빈·불러오기 오류, 단건 정상·불러오기 오류", async () => {
    const h1 = (markup: string) => [...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((match) => match[1]);
    signedIn(); state.list.mockResolvedValue(ok([row]));
    expect(h1(html(await listPage()))).toEqual(["내 프로젝트"]);
    signedIn(); state.list.mockResolvedValue(ok([]));
    expect(h1(html(await listPage()))).toEqual(["내 프로젝트"]);
    signedIn(); state.list.mockResolvedValue(fail(503, "PROJECT_READ_UNAVAILABLE"));
    const listError = html(await listPage());
    expect(h1(listError)).toEqual(["내 프로젝트"]);
    expect(listError).not.toContain("아직 클라우드에 옮긴 프로젝트가 없어요");
    expect(listError).toContain("프로젝트를 불러오지 못했어요");
    signedIn(); state.get.mockResolvedValue(ok(detail));
    expect(h1(html(await detailPage(Promise.resolve({ id: PA }))))).toEqual([detail.project.title]);
    signedIn(); state.get.mockResolvedValue(fail(503, "PROJECT_READ_UNAVAILABLE"));
    const detailError = html(await detailPage(Promise.resolve({ id: PA })));
    expect(h1(detailError)).toEqual(["프로젝트 보기"]);
    expect([...detailError.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(["/cloud/projects", "/cloud/projects"]);
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

describe("새 프로젝트 준비 안내 /cloud/projects/new(T-219): 만들기 미개통, 인증 판정만", () => {
  async function pendingPage() { return (await import("@/app/(cloud)/cloud/projects/new/page")).default(); }
  describe("비공개 PNG 생성 폼의 로컬 PG17 활성 조건", () => {
    beforeEach(() => {
      signedIn();
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("DREAM_PRIVATE_UPLOAD_BACKEND", "owned-pg17");
      vi.stubEnv("DREAM_PROJECT_CREATE_BACKEND", "owned-pg17");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("승인된 사용자는 로컬 PNG 폼으로 연결된다", async () => {
      const { PrivatePngProjectPage } = await import("@/components/cloud/private-png-project-page");
      expect((await pendingPage()).type).toBe(PrivatePngProjectPage);
    });

    it.each([
      ["NODE_ENV", "production"],
      ["VERCEL", "1"],
      ["NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co"],
      ["DREAM_PRIVATE_UPLOAD_BACKEND", undefined],
      ["DREAM_PROJECT_CREATE_BACKEND", undefined],
    ] as const)("%s=%s이면 준비 안내만 표시한다", async (key, value) => {
      vi.stubEnv(key, value);
      const markup = html(await pendingPage());
      expect(markup).toContain("아직 클라우드에서는 새 프로젝트를 만들 수 없어요");
      expect(markup).not.toContain("<form");
      legacyUntouched();
    });

    it("로컬 PG17 조건이 맞아도 세션이 없으면 로그인으로 이동한다", async () => {
      state.user = null;
      expect((await settle(pendingPage)).error?.to).toBe("/login?next=%2Fcloud%2Fprojects%2Fnew");
      legacyUntouched();
    });
  });
  it.each([
    ["no session", "/login?next=%2Fcloud%2Fprojects%2Fnew"],
    ["forbidden", "/login?error=forbidden"],
    ["provider error", "/login?error=unavailable"],
    ["missing config", "/login?error=unavailable"],
  ])("%s → %s, adapter·legacy 0", async (scenario, to) => {
    signedIn();
    if (scenario === "no session") state.user = null;
    if (scenario === "forbidden") state.user = { id: A, email: "other@example.invalid" };
    if (scenario === "provider error") state.fail = true;
    if (scenario === "missing config") delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await settle(pendingPage)).error?.to).toBe(to);
    expect(state.created).toHaveLength(0);
    legacyUntouched();
  });
  it("이 PC(로그인 꺼짐): 로컬 안내와 h1 '새 프로젝트', getUser·adapter 0", async () => {
    const markup = html(await pendingPage());
    expect(markup).toContain("이 PC에서는 기존 작업실을 써요");
    expect([...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((match) => match[1])).toEqual(["새 프로젝트"]);
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.created).toHaveLength(0);
    legacyUntouched();
  });
  it("로그인: h1 하나, 준비 중·자료 필요·기존 프로젝트 조회 안내, 목록 복귀 링크만. 폼·버튼·입력·제출 없음, adapter 0", async () => {
    signedIn();
    const markup = html(await pendingPage());
    expect([...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((match) => match[1])).toEqual(["새 프로젝트"]);
    expect(markup).toContain("아직 클라우드에서는 새 프로젝트를 만들 수 없어요");
    expect(markup).toContain("자료를 올릴 수 있게 되면");
    expect(markup).toContain("이미 옮긴 프로젝트는");
    expect([...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(["/cloud/projects", "/cloud/projects"]);
    expect(markup).not.toMatch(/<form|<button|<input|<select|<textarea|method="post"/i);
    // 기술 상세(DB·Storage·API·opt-in)는 제품 문구에 쓰지 않는다
    expect(markup).not.toMatch(/postgres|storage|database|DB|API|opt-in|DREAM_|assetAvailable/i);
    expect(state.created).toHaveLength(0);
    expect(state.list).not.toHaveBeenCalled();
    legacyUntouched();
  });
  it("정적: 서버 저장 요청·클라이언트 코드·read adapter를 쓰지 않는다", () => {
    const source = readFileSync("app/(cloud)/cloud/projects/new/page.tsx", "utf8");
    expect(source).not.toMatch(/"use client"|fetch\(|method:|project-read-request|lib\/services|lib\/db|postgres/i);
    expect(source).toMatch(/getRenderAuth\(\)/);
  });
});
