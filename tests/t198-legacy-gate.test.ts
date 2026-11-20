/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-198 미전환 legacy API 차단. 인증 1회 → legacy 차단, 그 전에는 본문·params·SQLite·파일 미접근.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  sqliteOpened: vi.fn(),
  startup: vi.fn(() => ({ canStart: true, checks: [] })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: {
    getUser: async () => { state.getUser(); return { data: { user: state.user }, error: null }; },
    signOut: state.signOut,
  } }),
}));
// SQLite를 여는 순간 기록한다(차단돼야 하는 경우 0이어야 함).
vi.mock("better-sqlite3", () => ({ default: vi.fn(function Database() { state.sqliteOpened(); throw new Error("legacy SQLite must not open"); }) }));
// 시작 점검은 이 PC 폴더에 시험 파일을 쓴다. 차단돼야 하는 경우 0이어야 함.
vi.mock("@/lib/services/startup", () => ({ checkStartup: state.startup, checkStorageStartup: state.startup }));

const UID = "00000000-0000-4000-8000-000000000198";
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_PROJECT_READ_BACKEND", "DATABASE_URL", "DREAM_SITE_URL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.invalid";
  state.user = { id: UID, email: "owner@example.invalid" };
  vi.clearAllMocks();
});
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

describe("legacyDataAvailable(순수 규칙)", () => {
  it("이 PC 기본·sqlite만 열고, Vercel·postgres·알 수 없는 값은 닫는다", async () => {
    const { legacyDataAvailable } = await import("@/lib/auth/legacy-gate");
    expect(legacyDataAvailable({})).toBe(true);
    expect(legacyDataAvailable({ DREAM_PROJECT_READ_BACKEND: "sqlite" })).toBe(true);
    for (const env of [{ VERCEL: "1" }, { VERCEL: "1", DREAM_PROJECT_READ_BACKEND: "sqlite" }, { DREAM_PROJECT_READ_BACKEND: "postgres" }, { DREAM_PROJECT_READ_BACKEND: "SQLite" }, { DREAM_PROJECT_READ_BACKEND: "" }, { DREAM_PROJECT_READ_BACKEND: "mysql" }]) {
      expect(legacyDataAvailable(env), JSON.stringify(env)).toBe(false);
    }
  });
  it("Backend 선택 규칙과 경계가 같다(sqlite 허용 조건)", () => {
    const backend = readFileSync("lib/services/postgres/project-read-backend.ts", "utf8");
    expect(backend).toMatch(/selected === undefined \|\| selected === "sqlite"/);
    expect(backend).toMatch(/if \(env\.VERCEL\) throw/);
  });
});

describe("requireApiAuth scope", () => {
  async function guard(scope?: "legacy-data" | "auth-only") { return (await import("@/lib/auth/api")).requireApiAuth(scope ? { scope } : undefined); }
  it("인증 거절이 먼저: Vercel이어도 로그인 없으면 401(legacy 코드 아님)", async () => {
    process.env.VERCEL = "1"; state.user = null;
    const response = await guard();
    expect(response?.status).toBe(401);
    expect((await response!.json()).code).toBe("AUTH_REQUIRED");
  });
  it("허용 계정 + Vercel → legacy-data 503 LEGACY_DATA_UNAVAILABLE(no-store·리다이렉트 없음), getUser 1회", async () => {
    process.env.VERCEL = "1";
    const response = await guard();
    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("location")).toBeNull();
    expect(Object.keys(await response!.json()).sort()).toEqual(["code", "error"]);
    expect(state.getUser).toHaveBeenCalledOnce();
  });
  it("postgres·알 수 없는 설정도 legacy-data는 503", async () => {
    for (const value of ["postgres", "unknown"]) {
      process.env.DREAM_PROJECT_READ_BACKEND = value;
      expect((await guard())?.status, value).toBe(503);
    }
  });
  it("auth-only는 클라우드에서도 열린다", async () => {
    process.env.VERCEL = "1";
    expect(await guard("auth-only")).toBeNull();
  });
  it("이 PC(로그인 꺼짐, 기본 sqlite)는 예전처럼 통과", async () => {
    delete process.env.DREAM_AUTH_MODE;
    expect(await guard()).toBeNull();
    expect(state.getUser).not.toHaveBeenCalled();
  });
});

const routeModules = import.meta.glob<Record<string, unknown>>("../app/api/**/route.ts");
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
// 인증 전용(업무 데이터 미사용) 또는 자체 인증·공개 인증 경로. 나머지는 모두 legacy-data여야 한다.
const authRoutes = ["auth/login", "auth/signup", "auth/reset", "auth/password", "auth/logout", "auth/session"].map((r) => `../app/api/${r}/route.ts`);
// 클라우드 전용 메서드는 legacy 차단을 부르지 않는다(getUser 중복 금지). 정확한 경로·메서드만 적고, 같은 파일의 다른 메서드는 legacy다.
// - Backend의 새 Postgres 조회 GET(B4-G)
// - T297 관리자 게시 GET·POST, T296 참고 분석 POST: 직접 권한·no-store·POST 동일 출처·미연결 실패는 tests/api-auth.test.ts가 검증
const CLOUD_ONLY: Record<string, string[]> = {
  "../app/api/admin/music-semantic/route.ts": ["GET", "POST"],
  "../app/api/admin/reference-analysis/route.ts": ["GET", "POST"],
  "../app/api/admin/shorts-analysis/route.ts": ["GET", "POST"],
  "../app/api/admin/render-queue/route.ts": ["GET"],
  "../app/api/projects/route.ts": ["GET"], "../app/api/projects/[id]/route.ts": ["GET"],
  "../app/api/admin/publications/route.ts": ["GET", "POST"],
};
const legacyMethods = (path: string, loaded: Record<string, unknown>) => methods.filter((m) => typeof loaded[m] === "function" && !(CLOUD_ONLY[path] ?? []).includes(m));
const legacyRoutes = Object.entries(routeModules).filter(([path]) => !authRoutes.includes(path));

function trapRequest(method: string) {
  const request = new Request("https://studio.vercel.app/api/direct", { method: method === "GET" || method === "HEAD" ? method : "POST", headers: { origin: "https://studio.vercel.app", host: "studio.vercel.app" } });
  const reads = ["json", "text", "formData", "arrayBuffer", "blob"].map((name) => vi.spyOn(request, name as "json").mockRejectedValue(new Error(`must not read body (${name})`)));
  const readParams = vi.fn(() => { throw new Error("must not read params"); });
  return { request, reads, params: { then: readParams } as unknown as Promise<{ id: string }>, readParams };
}

describe("기존 업무 API 전체: 클라우드에서 인증 뒤 503, 본문·params·SQLite·파일 미접근", () => {
  it("클라우드 전용 예외는 실제 있는 경로·메서드만 정확히 적는다", async () => {
    for (const [path, listed] of Object.entries(CLOUD_ONLY)) {
      const load = routeModules[path];
      expect(load, path).toBeTypeOf("function");
      const loaded = await load();
      for (const method of listed) expect(typeof loaded[method], `${path} ${method}`).toBe("function");
    }
  });
  it("업무 라우트 목록이 비어 있지 않고, 새 조회 GET만 있는 파일이 아니면 모두 기본 legacy 가드를 쓴다", async () => {
    expect(legacyRoutes.length).toBeGreaterThanOrEqual(19);
    for (const [path, load] of legacyRoutes) {
      if (legacyMethods(path, await load()).length === 0) continue;
      const source = readFileSync(path.replace("../", ""), "utf8");
      expect(source, path).toMatch(/requireApiAuth\(\)/);
      expect(source, path).not.toMatch(/scope: "auth-only"/);
    }
  });
  for (const [path, load] of legacyRoutes) {
    it.each(["vercel", "postgres", "unknown"])(`${path}: %s`, async (setting) => {
      if (setting === "vercel") process.env.VERCEL = "1";
      if (setting === "postgres") process.env.DREAM_PROJECT_READ_BACKEND = "postgres";
      if (setting === "unknown") process.env.DREAM_PROJECT_READ_BACKEND = "sqlite3";
      const loaded = await load();
      const handlers = legacyMethods(path, loaded);
      if (handlers.length === 0) return;
      for (const method of handlers) {
        state.getUser.mockClear();
        const { request, reads, params, readParams } = trapRequest(method);
        const response = await (loaded[method] as Handler)(request, { params });
        expect(response.status, method).toBe(503);
        expect((await response.json()).code, method).toBe("LEGACY_DATA_UNAVAILABLE");
        expect(response.headers.get("cache-control"), method).toBe("no-store");
        expect(state.getUser, method).toHaveBeenCalledOnce();
        for (const read of reads) expect(read, method).not.toHaveBeenCalled();
        expect(readParams, method).not.toHaveBeenCalled();
      }
      expect(state.sqliteOpened).not.toHaveBeenCalled();
      expect(state.startup).not.toHaveBeenCalled();
    });
  }
});

describe("대조군: 로그아웃(auth-only)은 클라우드에서도 동작, T-186 의미 유지", () => {
  async function logout(headers: Record<string, string>) {
    const { POST } = await import("@/app/api/auth/logout/route");
    return POST(new Request("https://studio.vercel.app/api/auth/logout", { method: "POST", headers: { host: "studio.vercel.app", ...headers } }));
  }
  beforeEach(() => { process.env.VERCEL = "1"; process.env.DREAM_SITE_URL = "https://studio.vercel.app"; });
  it("같은 출처면 200, signOut 1번, getUser 1번", async () => {
    const response = await logout({ origin: "https://studio.vercel.app" });
    expect(response.status).toBe(200);
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(state.getUser).toHaveBeenCalledOnce();
  });
  it("외부 출처는 403(Origin 검사 유지), signOut 없음", async () => {
    const response = await logout({ origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("로그인 없으면 401", async () => {
    state.user = null;
    expect((await logout({ origin: "https://studio.vercel.app" })).status).toBe(401);
  });
  it("Supabase 오류는 숨기지 않고 502 PARTIAL", async () => {
    state.signOut.mockResolvedValueOnce({ error: { status: 500 } as never }).mockResolvedValueOnce({ error: null });
    const response = await logout({ origin: "https://studio.vercel.app" });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("LOGOUT_PARTIAL");
  });
});

describe("대조군: 이 PC 기본 설정은 legacy 업무가 그대로 서비스까지 간다", () => {
  it("jobs GET은 인증 뒤 차단되지 않고 시작 점검(서비스)까지 진행", async () => {
    const { GET } = await import("@/app/api/jobs/route");
    await GET().catch(() => undefined);
    expect(state.startup).toHaveBeenCalled();
  });
});
