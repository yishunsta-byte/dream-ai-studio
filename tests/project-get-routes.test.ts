import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list, POST } from "@/app/api/projects/route";
import { GET as detail } from "@/app/api/projects/[id]/route";

const state = vi.hoisted(() => ({
  create: vi.fn(), list: vi.fn(), get: vi.fn(), guard: vi.fn(), createProject: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/postgres/project-read-request", () => ({
  createProjectReadRequest: () => { state.create(); return { list: state.list, get: state.get }; },
}));
vi.mock("@/lib/auth/api", () => ({ requireApiAuth: state.guard }));
vi.mock("@/lib/services/projects", () => ({
  createProject: state.createProject,
  ProjectInputError: class extends Error { constructor(public errors: Record<string, string>) { super("input"); } },
}));
const headers = { "cache-control": "no-store" };
beforeEach(() => { vi.resetAllMocks(); state.guard.mockResolvedValue(null); });

describe("B4-G new cloud project GET routes", () => {
  it("list delegates to exactly one request adapter and preserves the DTO", async () => {
    const body = [{ id: "synthetic", title: "합성", lengthSec: 4, states: [], nextStage: "brief" }];
    state.list.mockResolvedValue({ status: 200, body, headers });
    const response = await list(new Request("http://127.0.0.1/api/projects"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(body);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.create).toHaveBeenCalledOnce(); expect(state.list).toHaveBeenCalledOnce();
    expect(state.guard).not.toHaveBeenCalled(); expect(state.createProject).not.toHaveBeenCalled();
  });
  it("detail supplies params as a lazy callback, never as an Auth owner", async () => {
    let adapterEntered = false;
    const readParams = vi.fn(async () => { expect(adapterEntered).toBe(true); return { id: "project-id" }; });
    state.get.mockImplementation(async (id: () => Promise<string>) => {
      adapterEntered = true; expect(await id()).toBe("project-id");
      return { status: 200, body: { project: { id: "project-id" }, snapshot: {}, inputs: {}, states: [] }, headers };
    });
    const params = { then: (resolve: (value: { id: string }) => void) => readParams().then(resolve) } as unknown as Promise<{ id: string }>;
    const response = await detail(new Request("http://127.0.0.1/api/projects/project-id"), { params });
    expect(response.status).toBe(200); expect(readParams).toHaveBeenCalledOnce();
    expect(state.create).toHaveBeenCalledOnce(); expect(state.guard).not.toHaveBeenCalled();
  });
  it.each([
    { status: 401, code: "AUTH_REQUIRED" }, { status: 403, code: "AUTH_FORBIDDEN" },
    { status: 503, code: "AUTH_UNAVAILABLE" }, { status: 404, code: "NOT_FOUND" },
    { status: 503, code: "PROJECT_READ_UNAVAILABLE" },
  ])("$code status/body/no-store survive serialization without reading params", async ({ status, code }) => {
    const body = { error: "안전한 안내", code };
    state.list.mockResolvedValue({ status, body, headers }); state.get.mockResolvedValue({ status, body, headers });
    const params = vi.fn(() => { throw new Error("must not read params"); });
    const context = { get params(): Promise<{ id: string }> { return params(); } };
    for (const response of [await list(new Request("http://127.0.0.1/api/projects")), await detail(new Request("http://127.0.0.1/api/projects/id"), context)]) {
      expect(response.status).toBe(status); expect(await response.json()).toEqual(body);
      expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("location")).toBeNull();
    }
    expect(params).not.toHaveBeenCalled(); expect(state.guard).not.toHaveBeenCalled();
  });
});

describe("B4-G existing POST contract remains separate", () => {
  const request = (body: string) => new Request("http://127.0.0.1/api/projects", { method: "POST", body, headers: { "content-type": "application/json" } });
  it("guard runs before body, and GET adapter is not invoked", async () => {
    state.guard.mockResolvedValue(Response.json({ error: "로그인", code: "AUTH_REQUIRED" }, { status: 401, headers }));
    const input = request("{broken"), json = vi.spyOn(input, "json");
    expect((await POST(input)).status).toBe(401); expect(json).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled(); expect(state.createProject).not.toHaveBeenCalled();
  });
  it("malformed and invalid form keep the existing errors._form 400 response", async () => {
    for (const body of ["{broken", "{}"]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ errors: { _form: expect.any(String) } });
    }
    expect(state.createProject).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
  });
  it("valid input keeps 201 id response and the existing sync service call", async () => {
    state.createProject.mockReturnValue("new-project-id");
    const response = await POST(request(JSON.stringify({ menuId: "shopping-shorts", inputs: { title: "synthetic" } })));
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ id: "new-project-id" });
    expect(state.createProject).toHaveBeenCalledExactlyOnceWith("shopping-shorts", { title: "synthetic" });
    expect(state.guard).toHaveBeenCalledOnce(); expect(state.create).not.toHaveBeenCalled();
  });
});
