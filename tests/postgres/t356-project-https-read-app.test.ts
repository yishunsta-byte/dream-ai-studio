import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list, POST } from "../../app/api/projects/route";
import { GET as detail } from "../../app/api/projects/[id]/route";
import { readCloudProject, readCloudProjects } from "../../lib/cloud/project-read-page";

const state = vi.hoisted(() => ({
  old: vi.fn(), oldList: vi.fn(), oldDetail: vi.fn(), https: vi.fn(), httpsList: vi.fn(), httpsDetail: vi.fn(),
  auth: vi.fn(), guard: vi.fn(), create: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/postgres/project-read-request", () => ({ createProjectReadRequest: state.old }));
vi.mock("@/lib/services/project-https-read-assembly", () => ({ createCookieProjectHttpsReadRequest: state.https }));
vi.mock("@/lib/auth/render", () => ({ getRenderAuth: state.auth }));
vi.mock("@/lib/auth/api", () => ({ requireApiAuth: state.guard }));
vi.mock("@/lib/services/projects", () => ({ createProject: state.create, ProjectInputError: Error }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(to); } }));

const ref = "abcdefghijklmnopqrst";
const origin = `https://${ref}.supabase.co`;
const publicKey = "sb_publishable_synthetic_test_client_key";
const profile = "project_read";
const noStore = { "cache-control": "no-store" };
const ok = { status: 200, body: [], headers: noStore };
const id = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_PROJECT_READ_BACKEND", "supabase-https");
  vi.stubEnv("DREAM_PROJECT_HTTPS_REF", ref);
  vi.stubEnv("DREAM_PROJECT_HTTPS_PROFILE", profile);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", publicKey);
  vi.stubEnv("DREAM_AUTH_MODE", "supabase");
  state.https.mockReturnValue({ list: state.httpsList, get: state.httpsDetail });
  state.old.mockReturnValue({ list: state.oldList, get: state.oldDetail });
  state.httpsList.mockResolvedValue(ok);
  state.httpsDetail.mockResolvedValue({ status: 404, body: { code: "NOT_FOUND" }, headers: noStore });
  state.oldList.mockResolvedValue(ok);
  state.oldDetail.mockResolvedValue(ok);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("T356 application read entry points", () => {
  it.each([undefined, "sqlite", "postgres", "incorrect"] as const)("leaves backend %s on the existing route", async selected => {
    vi.stubEnv("DREAM_PROJECT_READ_BACKEND", selected);
    expect((await list(new Request("http://test.invalid/api/projects"))).status).toBe(200);
    expect(state.old).toHaveBeenCalledWith();
    expect(state.https).not.toHaveBeenCalled();
  });

  it("uses route mode and forwards the actual Request signal to both GET paths", async () => {
    const request = new Request("http://test.invalid/api/projects");
    expect((await list(request)).status).toBe(200);
    state.httpsDetail.mockImplementationOnce(async (readId: () => Promise<string>) => {
      expect(await readId()).toBe(id);
      return { status: 404, body: { code: "NOT_FOUND" }, headers: noStore };
    });
    const result = await detail(request, { params: Promise.resolve({ id }) });
    expect(result.status).toBe(404);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(state.old).not.toHaveBeenCalled();
    expect(state.https).toHaveBeenCalledTimes(2);
    for (const [options] of state.https.mock.calls) expect(options).toMatchObject({
      project: { ref, origin, publicKey, profile }, cookieMode: "route", signal: request.signal,
    });
  });

  it.each([
    ["DREAM_PROJECT_HTTPS_REF", undefined],
    ["DREAM_PROJECT_HTTPS_PROFILE", undefined],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://foreign.invalid"],
    ["DREAM_PROJECT_HTTPS_PROFILE", "malicious/profile"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined],
  ] as const)("fails closed on invalid opt-in configuration %s", async (key, value) => {
    vi.stubEnv(key, value);
    const request = new Request("http://test.invalid/api/projects");
    const params = { then: vi.fn() };
    for (const result of [await list(request), await detail(request, { params: params as unknown as Promise<{ id: string }> })]) {
      expect(result.status).toBe(503);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toMatchObject({ code: "PROJECT_READ_UNAVAILABLE" });
    }
    expect(await readCloudProjects()).toEqual({ kind: "unavailable" });
    expect(params.then).not.toHaveBeenCalled();
    expect(state.old).not.toHaveBeenCalled();
    expect(state.https).not.toHaveBeenCalled();
  });

  it("uses render mode for opted-in cloud reads and preserves authentication redirects", async () => {
    expect(await readCloudProjects()).toEqual({ kind: "ok", data: [] });
    expect(await readCloudProject(async () => id)).toEqual({ kind: "notFound" });
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.https).toHaveBeenCalledWith(expect.objectContaining({ cookieMode: "render", signal: undefined }));
    state.httpsList.mockResolvedValueOnce({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
    await expect(readCloudProjects()).rejects.toThrow("/login?next=%2Fcloud%2Fprojects");
    state.httpsList.mockResolvedValueOnce({ status: 403, body: { code: "AUTH_FORBIDDEN" }, headers: noStore });
    await expect(readCloudProjects()).rejects.toThrow("/login?error=forbidden");
  });

  it("keeps the existing cloud Auth check ahead of backend construction", async () => {
    vi.stubEnv("DREAM_PROJECT_READ_BACKEND", "postgres");
    state.auth.mockResolvedValue({ kind: "local" });
    expect(await readCloudProjects()).toEqual({ kind: "local" });
    expect(state.old).not.toHaveBeenCalled();
    state.auth.mockResolvedValue({ kind: "verified", userId: id, email: "x@example.invalid" });
    expect(await readCloudProjects()).toEqual({ kind: "ok", data: [] });
    expect(state.old).toHaveBeenCalledWith({ resolveAuth: state.auth });
    expect(state.https).not.toHaveBeenCalled();
  });

  it("leaves POST on its existing authorization and creation path under opt-in", async () => {
    state.guard.mockResolvedValue(null);
    state.create.mockReturnValue(id);
    const request = new Request("http://test.invalid/api/projects", { method: "POST",
      body: JSON.stringify({ menuId: "fixture", inputs: {} }) });
    const result = await POST(request);
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ id });
    expect(state.guard).toHaveBeenCalledOnce();
    expect(state.create).toHaveBeenCalledWith("fixture", {});
    expect(state.old).not.toHaveBeenCalled();
    expect(state.https).not.toHaveBeenCalled();
  });
});
