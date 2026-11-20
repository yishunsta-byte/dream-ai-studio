/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireApiAuth } from "@/lib/auth/api";
import { isPublicPath } from "@/lib/auth/config";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  error: null as null | { name: string; status?: number },
  fail: false,
  missingClient: false,
  getUser: vi.fn(),
  create: vi.fn(),
  updateUser: vi.fn(async () => ({ error: null })),
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  listJobs: vi.fn(() => ({ jobs: [], workerOnline: true })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => {
    state.create();
    return state.missingClient ? null : { auth: { updateUser: state.updateUser,
      signInWithPassword: state.signInWithPassword, signUp: state.signUp,
      resetPasswordForEmail: state.resetPasswordForEmail, getUser: async () => {
      state.getUser();
      if (state.fail) throw new Error("private provider/network detail");
      return { data: { user: state.user }, error: state.error };
    } } };
  },
}));
vi.mock("@/lib/services/startup", () => ({ checkStartup: () => ({ canStart: true }) }));
vi.mock("@/lib/services/jobs", () => ({
  listJobs: state.listJobs,
  enqueueGeneration: vi.fn(),
  updateJob: vi.fn(),
}));
const envKeys = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
let saved: (string | undefined)[];
beforeEach(() => {
  saved = envKeys.map(key => process.env[key]);
  envKeys.forEach(key => delete process.env[key]);
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.invalid";
  Object.assign(state, { user: null, error: null, fail: false, missingClient: false });
  vi.clearAllMocks();
});
afterEach(() => envKeys.forEach((key, index) => {
  if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
}));

describe("independent API authentication guard", () => {
  it("local off bypasses Auth without creating a cookie client", async () => {
    delete process.env.DREAM_AUTH_MODE;
    expect(await requireApiAuth()).toBeNull();
    expect(state.create).not.toHaveBeenCalled();
  });
  it("Vercel cannot bypass with explicit off and missing settings", async () => {
    process.env.VERCEL = "1";
    process.env.DREAM_AUTH_MODE = "off";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await requireApiAuth();
    expect(response?.status).toBe(503);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("verified allowed account may enter the service", async () => {
    state.user = { id: "00000000-0000-4000-8000-000000000191", email: "OWNER@example.invalid" };
    expect(await requireApiAuth()).toBeNull();
    expect(state.getUser).toHaveBeenCalledOnce();
  });
  it("a returned user with an Auth error is rejected", async () => {
    state.user = { id: "00000000-0000-4000-8000-000000000191", email: "owner@example.invalid" };
    state.error = { name: "AuthApiError", status: 401 };
    expect((await requireApiAuth())?.status).toBe(401);
  });
  it("expired/missing session returns 401, not a redirect", async () => {
    state.error = { name: "AuthSessionMissingError", status: 400 };
    const response = await requireApiAuth();
    expect(response?.status).toBe(401);
    expect(response?.headers.get("location")).toBeNull();
    expect(await response?.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("email-less account is forbidden", async () => {
    state.user = { id: "00000000-0000-4000-8000-000000000191" };
    expect((await requireApiAuth())?.status).toBe(403);
  });
  it.each([
    { name: "AuthRetryableFetchError" },
    { name: "AuthApiError", status: 503 },
  ])("provider outage fails closed: $name", async error => {
    state.error = error;
    const response = await requireApiAuth();
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });
  it("missing cookie client fails closed", async () => {
    state.missingClient = true;
    expect((await requireApiAuth())?.status).toBe(503);
  });
  it("allowed account reaches the existing route service and DTO", async () => {
    state.user = { id: "00000000-0000-4000-8000-000000000191", email: "owner@example.invalid" };
    const { GET } = await import("@/app/api/jobs/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [], workerOnline: true });
    expect(state.getUser).toHaveBeenCalledOnce();
    expect(state.listJobs).toHaveBeenCalledOnce();
  });
  it("local off route keeps working without creating Auth client", async () => {
    delete process.env.DREAM_AUTH_MODE;
    const { GET } = await import("@/app/api/jobs/route");
    expect((await GET()).status).toBe(200);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.listJobs).toHaveBeenCalledOnce();
  });
});

const routeModules = import.meta.glob<Record<string, unknown>>("../app/api/**/route.ts");
// Explicit inventory: a new route must receive a reviewed contract instead of silently
// inheriting a public exemption or disappearing from the authentication tests.
const publicAuthRoutes = ["auth/login", "auth/signup", "auth/reset"];
const selfAuthenticatedRoutes = ["auth/password"];
const referenceRoutes = ["admin/reference-analysis", "admin/reference-publications", "admin/music-semantic", "admin/shorts-analysis"];
const guardedRoutes = [
  "admin/publications", "admin/render-queue", ...referenceRoutes,
  "assets/[id]", "assets/link", "assets/upload", "auth/logout", "auth/session",
  "backups/configuration", "backups", "characters", "exports/[id]", "jobs",
  "library/archive", "projects/[id]/finishing", "projects/[id]/production",
  "projects/[id]/renders", "projects/[id]/timeline", "projects/[id]/workflow",
  "projects", "projects/[id]", "renders/[id]/cancel", "renders/[id]/file", "restore/finish", "restore/inspect",
];
const modulePath = (route: string) => `../app/api/${route}/route.ts`;
const protectedRoutes = Object.entries(routeModules).filter(([path]) =>
  !publicAuthRoutes.concat(selfAuthenticatedRoutes).map(modulePath).includes(path));
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

describe("direct route calls without proxy", () => {
  it("requires every route to have an explicit, non-overlapping authentication contract", () => {
    const inventory = [...publicAuthRoutes, ...selfAuthenticatedRoutes, ...guardedRoutes].map(modulePath);
    expect(new Set(inventory).size).toBe(inventory.length);
    expect(Object.keys(routeModules).sort()).toEqual(inventory.sort());
    expect(protectedRoutes.map(([path]) => path).sort()).toEqual(guardedRoutes.map(modulePath).sort());
    for (const route of publicAuthRoutes) expect(isPublicPath(`/api/${route}`)).toBe(true);
    for (const route of [...selfAuthenticatedRoutes, ...guardedRoutes]) expect(isPublicPath(`/api/${route}`)).toBe(false);
  });
  for (const [path, load] of protectedRoutes) {
    it.each([
      { scenario: "no session", status: 401, code: "AUTH_REQUIRED" },
      { scenario: "forbidden account", status: 403, code: "AUTH_FORBIDDEN" },
      { scenario: "provider throws", status: 503, code: "AUTH_UNAVAILABLE" },
      { scenario: "missing config", status: 503, code: "AUTH_UNAVAILABLE" },
    ])(`${path}: $scenario blocks before request body or params`, async ({ scenario, status, code }) => {
      if (scenario === "forbidden account") state.user = { id: "00000000-0000-4000-8000-000000000191", email: "other@example.invalid" };
      if (scenario === "provider throws") state.fail = true;
      if (scenario === "missing config") delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const loadedRoute = await load();
      const handlers = methods.filter(method => typeof loadedRoute[method] === "function");
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const request = new Request("https://example.invalid/api/direct", { method: method === "GET" || method === "HEAD" ? method : "POST" });
        const readBody = vi.spyOn(request, "json").mockRejectedValue(new Error("must not parse body"));
        const readStream = vi.spyOn(request, "body", "get").mockImplementation(() => { throw new Error("must not read the body stream"); });
        const readParams = vi.fn(() => { throw new Error("must not read params"); });
        const params = { then: readParams } as unknown as Promise<{ id: string }>;
        const response = await (loadedRoute[method] as Handler)(request, { params });
        expect(response.status, method).toBe(status);
        const referenceRoute = referenceRoutes.some(route => modulePath(route) === path);
        expect(await response.json(), method).toMatchObject(referenceRoute ? { error: code } : { code });
        expect(response.headers.get("cache-control"), method).toBe("no-store");
        expect(response.headers.get("location"), method).toBeNull();
        expect(readBody, method).not.toHaveBeenCalled();
        expect(readStream, method).not.toHaveBeenCalled();
        expect(readParams, method).not.toHaveBeenCalled();
        expect(state.listJobs, method).not.toHaveBeenCalled();
      }
    });
  }
});

describe("public authentication routes called without proxy or session", () => {
  it.each(publicAuthRoutes)("%s remains reachable without an existing login", async route => {
    const loadedRoute = await routeModules[modulePath(route)]();
    const request = new Request(`http://127.0.0.1/api/${route}`, {
      method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1", origin: "http://127.0.0.1" },
      body: JSON.stringify({ email: "owner@example.invalid", password: "SyntheticPassword123!" }),
    });
    const response = await (loadedRoute.POST as Handler)(request, { params: Promise.resolve({ id: "unused" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(state.getUser).not.toHaveBeenCalled();
    const provider = route === "auth/login" ? state.signInWithPassword : route === "auth/signup" ? state.signUp : state.resetPasswordForEmail;
    expect(provider).toHaveBeenCalledOnce();
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

describe("password change independently authenticates its session", () => {
  async function changePassword(body: string) {
    const { POST } = await import("@/app/api/auth/password/route");
    return POST(new Request("http://127.0.0.1/api/auth/password", {
      method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1", origin: "http://127.0.0.1" }, body,
    }));
  }
  const validBody = JSON.stringify({ password: "SyntheticPassword123!" });

  it.each([
    { scenario: "missing session", user: null, status: 401, code: "AUTH_REQUIRED" },
    { scenario: "expired session", user: null, status: 401, code: "AUTH_REQUIRED", error: { name: "AuthSessionMissingError", status: 400 } },
    { scenario: "forbidden account", user: { id: "00000000-0000-4000-8000-000000000191", email: "other@example.invalid" }, status: 403, code: "AUTH_FORBIDDEN" },
    { scenario: "email-less account", user: { id: "00000000-0000-4000-8000-000000000191" }, status: 403, code: "AUTH_FORBIDDEN" },
  ])("$scenario cannot update a password", async ({ user, status, code, ...rest }) => {
    state.user = user;
    state.error = ("error" in rest ? rest.error : null) ?? null;
    const response = await changePassword(validBody);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(state.getUser).toHaveBeenCalledOnce();
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    { body: "{", code: "BAD_REQUEST" },
    { body: "[]", code: "BAD_REQUEST" },
    { body: JSON.stringify({ password: "weak" }), code: "WEAK_PASSWORD" },
    { body: "{}", code: "WEAK_PASSWORD" },
  ])("invalid input returns 400 before attempting Auth: $code", async ({ body, code }) => {
    const response = await changePassword(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("missing Auth client returns 503 without updating", async () => {
    state.missingClient = true;
    const response = await changePassword(validBody);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("only a verified allowed account reaches updateUser", async () => {
    state.user = { id: "00000000-0000-4000-8000-000000000191", email: "OWNER@example.invalid" };
    const response = await changePassword(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.getUser).toHaveBeenCalledOnce();
    expect(state.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "SyntheticPassword123!" });
    expect(state.listJobs).not.toHaveBeenCalled();
  });
});

// T297: 관리자 게시 API는 허용 계정만, 쓰기는 이 사이트 화면에서 보낸 JSON만 받는다. 운영 기본값은 저장소 미연결.
describe("admin publications route (T297) same-origin and unlinked default", () => {
  const allowed = { id: "00000000-0000-4000-8000-000000000297", email: "owner@example.invalid" };
  const send = async (headers: Record<string, string>) => {
    const { POST } = await import("@/app/api/admin/publications/route");
    const request = new Request("http://127.0.0.1:3000/api/admin/publications", { method: "POST", body: "{}", headers: { host: "127.0.0.1:3000", ...headers } });
    const readBody = vi.spyOn(request, "json");
    const response = await POST(request);
    return { response, readBody, bodyUsed: request.bodyUsed };
  };
  it("allowed account from another site or without Origin is rejected before the body", async () => {
    state.user = allowed;
    for (const headers of [{ origin: "https://evil.example", "content-type": "application/json" }, { "content-type": "application/json" }] as Record<string, string>[]) {
      const { response, readBody, bodyUsed } = await send(headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "AUTH_ORIGIN_REJECTED" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(readBody).not.toHaveBeenCalled();
      expect(bodyUsed).toBe(false);
    }
    expect(state.getUser).toHaveBeenCalledTimes(2);
  });
  it("same-site JSON write without a production store is 503 unlinked and never reads the body", async () => {
    state.user = allowed;
    const { response, bodyUsed } = await send({ origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PUBLICATION_UNLINKED" });
    expect(bodyUsed).toBe(false);
  });
  it("allowed GET returns the closed queue with no-store", async () => {
    state.user = allowed;
    const { GET } = await import("@/app/api/admin/publications/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ kind: "closed" });
    expect(state.getUser).toHaveBeenCalledOnce();
  });
});
