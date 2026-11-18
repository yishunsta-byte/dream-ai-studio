/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-200 legacy 화면(RSC) 입구 차단. 각 페이지가 로더보다 먼저 판별하는지, 부모 레이아웃에 기대지 않고 확인한다.
const state = vi.hoisted(() => {
  const loader = vi.fn();
  const wrap = (name: string, mod: Record<string, unknown>) => Object.fromEntries(Object.entries(mod).map(([key, value]) =>
    [key, typeof value === "function" && /^[a-z]/.test(key) && !key.endsWith("Schema")
      ? () => { loader(`${name}.${key}`); throw new Error(`legacy loader ran: ${name}.${key}`); }
      : value]));
  return {
    user: null as null | { id: string; email?: string },
    fail: false,
    getUser: vi.fn(),
    loader,
    wrap,
    sqlite: vi.fn(),
    startup: vi.fn(() => ({ canStart: true, checks: [] })),
    menus: vi.fn(() => ({ groups: [], menus: [{ id: "shopping-shorts", label: "쇼핑", group: "g", phase: 1, availability: "ready" }], workspaces: [{ id: "w", label: "w", description: "", notDoing: [] }] })),
    redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => {
    state.getUser();
    if (state.fail) throw new Error("network");
    return { data: { user: state.user }, error: null };
  } } }),
}));
vi.mock("better-sqlite3", () => ({ default: vi.fn(function Database() { state.sqlite(); throw new Error("legacy SQLite must not open"); }) }));
vi.mock("@/lib/services/startup", () => ({ checkStartup: state.startup, checkStorageStartup: state.startup }));
// T-241: 메뉴 설정 검증이 루트에서 StudioLayout으로 옮겨져 레이아웃은 getMenuConfigState를 쓴다(같은 menus 호출로 센다).
vi.mock("@/lib/menus/server", () => ({ getMenuConfig: state.menus, getMenuConfigState: () => ({ ok: true as const, config: state.menus() }) }));
for (const name of ["projects", "history", "jobs", "library", "planning", "production", "editing", "review", "exports", "renders", "backups"]) {
  vi.doMock(`@/lib/services/${name}`, async (importOriginal) => state.wrap(name, await importOriginal<Record<string, unknown>>()));
}
vi.mock("@/lib/menus/snapshot", async (importOriginal) => state.wrap("snapshot", await importOriginal<Record<string, unknown>>()));

const UID = "00000000-0000-4000-8000-000000000200";
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_PROJECT_READ_BACKEND"] as const;
const saved: Record<string, string | undefined> = {};
function signedIn() {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.invalid";
  state.user = { id: UID, email: "owner@example.invalid" };
}
beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  state.user = null; state.fail = false;
  vi.clearAllMocks();
});
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const pageModules = import.meta.glob<{ default: (props: unknown) => unknown }>("../app/**/page.tsx");
const pages = Object.entries(pageModules).filter(([path]) => path.startsWith("../app/(studio)/") || path.startsWith("../app/(workspace)/"));
function trap() {
  const read = vi.fn(() => { throw new Error("must not read params/searchParams"); });
  const value = { then: read } as unknown as Promise<Record<string, string>>;
  return { read, props: { params: value, searchParams: value } };
}
async function run(load: () => Promise<{ default: (props: unknown) => unknown }>, props: unknown) {
  try { return { value: await (await load()).default(props) }; } catch (error) { return { error: error as Error & { to?: string } }; }
}
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";

describe("화면 입구 목록", () => {
  it("studio·workspace의 모든 페이지가 입구 첫 줄에서 legacyPageGate를 부른다", () => {
    expect(pages.length).toBe(14);
    for (const [path] of pages) {
      const source = readFileSync(path.replace("../", ""), "utf8");
      const body = source.slice(source.indexOf("export default"));
      const first = body.slice(body.indexOf("{", body.indexOf(")")) + 1).trimStart();
      expect(first.startsWith("const blocked=await legacyPageGate();if(blocked)return blocked;"), path).toBe(true);
    }
  });
  it("레이아웃은 checkStartup·메뉴 읽기보다 먼저 가드한다", () => {
    const source = readFileSync("components/studio-layout.tsx", "utf8");
    const gate = source.indexOf("await legacyPageGate()");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(source.indexOf("getMenuConfigState()")); // T-241: 메뉴 검증도 가드 뒤
    expect(gate).toBeLessThan(source.indexOf("checkStartup()"));
  });
});

describe("클라우드·postgres·알 수 없는 설정: 페이지만 단독 실행해도 로더 0", () => {
  for (const [path, load] of pages) {
    it.each(["vercel", "postgres", "unknown"])(`${path}: %s`, async (setting) => {
      signedIn();
      if (setting === "vercel") process.env.VERCEL = "1";
      if (setting === "postgres") process.env.DREAM_PROJECT_READ_BACKEND = "postgres";
      if (setting === "unknown") process.env.DREAM_PROJECT_READ_BACKEND = "Sqlite";
      const { read, props } = trap();
      const result = await run(load, props);
      expect(result.error, path).toBeUndefined();
      const markup = html(result.value);
      expect(markup).toContain("클라우드 작업실을 준비하고 있어요");
      expect(markup).toContain("로그인은 정상적으로 됐어요");
      expect(markup).toContain("작업실 기능은 아직 클라우드로 옮기지 않았어요");
      expect(state.getUser).toHaveBeenCalledOnce();
      expect(read).not.toHaveBeenCalled();
      expect(state.loader).not.toHaveBeenCalled();
      expect(state.startup).not.toHaveBeenCalled();
      expect(state.menus).not.toHaveBeenCalled();
      expect(state.sqlite).not.toHaveBeenCalled();
      expect(state.redirect).not.toHaveBeenCalled();
    });
  }
});

describe("인증 거절: proxy와 같은 의미로 로그인 화면 이동, 그 전 부작용 0", () => {
  for (const [path, load] of pages) {
    it.each([
      ["no session", "/login?next=%2Fstudio"], // T-241: 작업실 입구 기본 next를 /studio로 명시(공개 메인 "/"로 돌아가지 않게)
      ["forbidden", "/login?error=forbidden"],
      ["provider error", "/login?error=unavailable"],
      ["missing config", "/login?error=unavailable"],
    ])(`${path}: %s → %s`, async (scenario, to) => {
      signedIn();
      process.env.VERCEL = "1";
      if (scenario === "no session") state.user = null;
      if (scenario === "forbidden") state.user = { id: UID, email: "other@example.invalid" };
      if (scenario === "provider error") state.fail = true;
      if (scenario === "missing config") delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const { read, props } = trap();
      const result = await run(load, props);
      expect(result.error?.to, path).toBe(to);
      expect(read).not.toHaveBeenCalled();
      expect(state.loader).not.toHaveBeenCalled();
      expect(state.startup).not.toHaveBeenCalled();
      expect(state.menus).not.toHaveBeenCalled();
      expect(state.sqlite).not.toHaveBeenCalled();
    });
  }
});

describe("레이아웃 단독", () => {
  it("클라우드면 준비 화면, 시작 점검·메뉴 읽기 0, 자식은 그리지 않음", async () => {
    signedIn(); process.env.VERCEL = "1";
    const { StudioLayout } = await import("@/components/studio-layout");
    const markup = html(await StudioLayout({ children: "작업 화면" }));
    expect(markup).toContain("클라우드 작업실을 준비하고 있어요");
    expect(markup).toContain("owner@example.invalid");
    expect(markup).not.toContain("작업 화면");
    expect(state.startup).not.toHaveBeenCalled();
    expect(state.menus).not.toHaveBeenCalled();
  });
  it("로그인 없는 postgres 설정(이 PC 로그인 꺼짐)은 계정 없이 준비 화면", async () => {
    process.env.DREAM_PROJECT_READ_BACKEND = "postgres";
    const { StudioLayout } = await import("@/components/studio-layout");
    const markup = html(await StudioLayout({ children: "작업 화면" }));
    expect(markup).toContain("클라우드 작업실을 준비하고 있어요");
    expect(markup).not.toContain("로그인은 정상적으로 됐어요");
    expect(state.getUser).not.toHaveBeenCalled();
  });
});

// 이 PC 기본(로그인 꺼짐, sqlite 기본): 가드가 통과시키고 예전처럼 각자 로더·이동으로 간다.
describe("대조군: 이 PC 기본 설정은 기존 입구 동작 유지", () => {
  const expected: Record<string, RegExp | string> = {
    "(studio)/studio/page.tsx": /projects\.listProjects/, // T-241: 작업실 홈 / → /studio 이동
    "(studio)/history/page.tsx": "params",
    "(studio)/jobs/page.tsx": /jobs\.listJobs/,
    "(studio)/library/page.tsx": /library\.readLibrary/,
    "(studio)/menus/[menuId]/new/page.tsx": "params",
    "(studio)/menus/[menuId]/page.tsx": "params",
    "(studio)/projects/[id]/[stage]/page.tsx": "params",
    "(studio)/projects/[id]/page.tsx": "params",
    "(studio)/projects/[id]/render/page.tsx": "params",
    "(studio)/projects/new/page.tsx": "redirect:/menus/shopping-shorts/new",
    "(studio)/queue/page.tsx": "redirect:/jobs",
    "(studio)/settings/page.tsx": "menus",
    "(studio)/setup/page.tsx": "startup",
    "(workspace)/workspaces/[id]/page.tsx": "params",
  };
  for (const [path, load] of pages) {
    it(path, async () => {
      const key = path.replace("../app/", "");
      const want = expected[key];
      expect(want, key).toBeDefined();
      const { read, props } = trap();
      const result = await run(load, props);
      expect(state.getUser).not.toHaveBeenCalled();
      expect(html(result.value)).not.toContain("클라우드 작업실을 준비하고 있어요");
      if (want instanceof RegExp) expect(state.loader.mock.calls.flat().join(" ")).toMatch(want);
      else if (want === "params") expect(read).toHaveBeenCalled();
      else if (want === "menus") expect(state.menus).toHaveBeenCalled();
      else if (want === "startup") expect(state.startup).toHaveBeenCalled();
      else expect(result.error?.to).toBe(want.replace("redirect:", ""));
    });
  }
  it("레이아웃도 예전처럼 메뉴·시작 점검을 거쳐 자식을 그린다", async () => {
    const { StudioLayout } = await import("@/components/studio-layout");
    await StudioLayout({ children: "작업 화면" });
    expect(state.menus).toHaveBeenCalled();
    expect(state.startup).toHaveBeenCalled();
  });
});
