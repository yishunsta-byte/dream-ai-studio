/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireApiAuth } from "@/lib/auth/api";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  error: null as null | { name: string; status?: number },
  fail: false,
  missingClient: false,
  getUser: vi.fn(),
  create: vi.fn(),
  listJobs: vi.fn(() => ({ jobs: [], workerOnline: true })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => {
    state.create();
    return state.missingClient ? null : { auth: { getUser: async () => {
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
    state.user = { id: "synthetic", email: "OWNER@example.invalid" };
    expect(await requireApiAuth()).toBeNull();
    expect(state.getUser).toHaveBeenCalledOnce();
  });
  it("a returned user with an Auth error is rejected", async () => {
    state.user = { id: "synthetic", email: "owner@example.invalid" };
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
    state.user = { id: "synthetic" };
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
    state.user = { id: "synthetic", email: "owner@example.invalid" };
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
const protectedRoutes = Object.entries(routeModules).filter(([path]) => !path.endsWith("/auth/login/route.ts"));
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

describe("direct route calls without proxy", () => {
  it("enumerates all 20 protected route files", () => expect(protectedRoutes).toHaveLength(20));
  for (const [path, load] of protectedRoutes) {
    it.each([
      { scenario: "no session", status: 401, code: "AUTH_REQUIRED" },
      { scenario: "forbidden account", status: 403, code: "AUTH_FORBIDDEN" },
      { scenario: "provider throws", status: 503, code: "AUTH_UNAVAILABLE" },
      { scenario: "missing config", status: 503, code: "AUTH_UNAVAILABLE" },
    ])(`${path}: $scenario blocks before request body or params`, async ({ scenario, status, code }) => {
      if (scenario === "forbidden account") state.user = { id: "synthetic", email: "other@example.invalid" };
      if (scenario === "provider throws") state.fail = true;
      if (scenario === "missing config") delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const loadedRoute = await load();
      const handlers = methods.filter(method => typeof loadedRoute[method] === "function");
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const request = new Request("https://example.invalid/api/direct", { method: method === "GET" || method === "HEAD" ? method : "POST" });
        const readBody = vi.spyOn(request, "json").mockRejectedValue(new Error("must not parse body"));
        const readParams = vi.fn(() => { throw new Error("must not read params"); });
        const params = { then: readParams } as unknown as Promise<{ id: string }>;
        const response = await (loadedRoute[method] as Handler)(request, { params });
        expect(response.status, method).toBe(status);
        expect(await response.json(), method).toMatchObject({ code });
        expect(response.headers.get("cache-control"), method).toBe("no-store");
        expect(response.headers.get("location"), method).toBeNull();
        expect(readBody, method).not.toHaveBeenCalled();
        expect(readParams, method).not.toHaveBeenCalled();
        expect(state.listJobs, method).not.toHaveBeenCalled();
      }
    });
  }
});
