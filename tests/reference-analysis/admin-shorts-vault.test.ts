import { describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import {
  shortsVaultProjectBodyLimit, shortsVaultPromptSearchPath, shortsVaultPromptSetBodyLimit, shortsVaultSearchBodyLimit,
} from "@/lib/reference-analysis/shorts-vault-contract";
import { createShortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";
import type { ShortsVaultStore } from "@/lib/reference-analysis/shorts-vault-store";
import { projectDocument, promptSetDocument } from "./admin-shorts-vault-fixture";

vi.mock("server-only", () => ({}));

// P1-08-SHORTS-VAULT HTTP 경계(합성 인증·가짜 저장소). 실제 SQL·RLS는 tests/postgres/admin-shorts-vault.pg17.test.ts.
const site = "https://studio.example.invalid";
const owner = "20000000-0000-4000-8000-00000000000a";
const id = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";

function fixture(auth: ServerAuthResult = { kind: "verified", userId: owner, email: "a@example.invalid" }, linked = true) {
  const store = {
    listPromptSets: vi.fn(async () => []), getPromptSet: vi.fn(async () => null),
    searchPromptSets: vi.fn(async (): Promise<unknown[]> => []),
    createPromptSet: vi.fn(async () => ({ status: 201, body: { promptSet: { id } } })), deletePromptSet: vi.fn(async () => true),
    listProjects: vi.fn(async () => []), getProject: vi.fn(async () => null),
    createProject: vi.fn(async () => ({ status: 201, body: { project: { id } } })),
    replaceProject: vi.fn(async () => ({ status: 200, body: { project: { id } } })), deleteProject: vi.fn(async () => false),
  };
  const authenticate = vi.fn(async () => auth);
  const http = createShortsVaultHttp({ env: { DREAM_SITE_URL: site }, authenticate,
    store: () => (linked ? store as unknown as ShortsVaultStore : null) });
  return { http, store, authenticate };
}
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`${site}/api/admin/shorts-vault/x`, {
  method, headers: { origin: site, host: "studio.example.invalid", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
const route = (value = id) => ({ params: Promise.resolve({ id: value }) });

describe("administrator Shorts vault HTTP", () => {
  it("checks the administrator before reading the body or the route id", async () => {
    for (const auth of [{ kind: "denied", status: 401, code: "AUTH_REQUIRED" }, { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" },
      { kind: "local" }] as ServerAuthResult[]) {
      const { http, store } = fixture(auth);
      const request = req("PUT", { expectedRevision: 1, document: projectDocument() });
      const readBody = vi.spyOn(request, "text");
      const readParams = vi.fn(() => { throw new Error("must not read params"); });
      const params = { then: readParams } as unknown as Promise<{ id: string }>;
      const reply = await http.replaceProject(request, { params });
      expect([401, 403]).toContain(reply.status);
      expect(readBody).not.toHaveBeenCalled();
      expect(readParams).not.toHaveBeenCalled();
      expect(Object.values(store).every(fn => fn.mock.calls.length === 0)).toBe(true);
    }
  });

  it("answers 503 without a configured store and never caches", async () => {
    const { http } = fixture(undefined, false);
    const reply = await http.listProjects();
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ code: "storage_unavailable" });
    expect(reply.headers.get("cache-control")).toBe("private, no-store");
  });

  it("hides storage failures behind 503", async () => {
    const { http, store } = fixture();
    store.listPromptSets.mockRejectedValueOnce(new Error("connection details must stay private"));
    const reply = await http.listPromptSets();
    expect(reply.status).toBe(503);
    expect(await reply.text()).not.toContain("private");
  });

  it("accepts valid prompt sets and projects and passes them unchanged", async () => {
    const { http, store } = fixture();
    expect((await http.createPromptSet(req("POST", { requestId, document: promptSetDocument() }))).status).toBe(201);
    expect(store.createPromptSet).toHaveBeenCalledWith(owner, requestId, promptSetDocument());
    expect((await http.createProject(req("POST", { requestId, document: projectDocument() }))).status).toBe(201);
    expect(store.createProject).toHaveBeenCalledWith(owner, requestId, projectDocument());
    expect((await http.replaceProject(req("PUT", { expectedRevision: 3, document: projectDocument(2) }), route(id.toUpperCase()))).status).toBe(200);
    expect(store.replaceProject).toHaveBeenCalledWith(owner, id, 3, projectDocument(2));
  });

  it("refuses foreign origins on every write", async () => {
    const { http, store } = fixture();
    const foreign = { origin: "https://foreign.invalid" };
    expect((await http.createPromptSet(req("POST", { requestId, document: promptSetDocument() }, foreign))).status).toBe(403);
    expect((await http.createProject(req("POST", { requestId, document: projectDocument() }, foreign))).status).toBe(403);
    expect((await http.replaceProject(req("PUT", { expectedRevision: 1, document: projectDocument() }, foreign), route())).status).toBe(403);
    expect((await http.deletePromptSet(req("DELETE", undefined, foreign), route())).status).toBe(403);
    expect((await http.deleteProject(req("DELETE", undefined, foreign), route())).status).toBe(403);
    expect(store.createPromptSet).not.toHaveBeenCalled();
    expect(store.deletePromptSet).not.toHaveBeenCalled();
    expect(store.deleteProject).not.toHaveBeenCalled();
  });

  it("does not store comments, metric snapshots, extra keys or secrets", async () => {
    const { http, store } = fixture();
    const doc = projectDocument();
    for (const document of [
      { ...doc, comments: ["타인이 쓴 댓글 원문"] },
      { ...doc, metrics: { views: 1000, likes: 10 } },
      { ...doc, videos: [{ id: "A1b2C3d4E5F", views: 1000 }] },
      { ...doc, context: { ...doc.context, commentSamples: ["댓글"] } },
      { ...doc, videoIds: ["A1b2C3d4E5F", "A1b2C3d4E5F"] },
      { ...doc, videoIds: ["A1b2C3d4E5F", "B1b2C3d4E5F", "C1b2C3d4E5F", "D1b2C3d4E5F"] },
      { ...doc, step: 7 },
    ]) {
      const reply = await http.createProject(req("POST", { requestId, document }));
      expect(reply.status).toBe(400);
      expect(await reply.json()).toEqual({ code: "invalid_input" });
    }
    for (const secret of ["AIza" + "a".repeat(35), "sk-ant-" + "b".repeat(30), "-----BEGIN PRIVATE KEY-----"]) {
      const reply = await http.createProject(req("POST", { requestId, document: { ...doc, direction: `메모 ${secret}` } }));
      expect(reply.status).toBe(400);
      expect(await reply.json()).toEqual({ code: "secret_rejected" });
      const set = await http.createPromptSet(req("POST", { requestId, document: { ...promptSetDocument(), hook: secret.slice(0, 200) } }));
      expect(set.status).toBe(400);
    }
    for (const body of [{ document: doc }, { requestId: "not-a-uuid", document: doc }, { requestId, document: doc, owner }]) {
      expect((await http.createProject(req("POST", body))).status).toBe(400);
    }
    expect((await http.replaceProject(req("PUT", { expectedRevision: 0, document: doc }), route())).status).toBe(400);
    expect((await http.createProject(req("POST", "{\"requestId\":"))).status).toBe(400);
    expect(store.createProject).not.toHaveBeenCalled();
    expect(store.replaceProject).not.toHaveBeenCalled();
  });

  it("enforces 256 KiB for prompt sets and 512 KiB for projects", async () => {
    const { http, store } = fixture();
    const setJson = JSON.stringify({ requestId, document: promptSetDocument() });
    const projectJson = JSON.stringify({ requestId, document: projectDocument() });
    const pad = (json: string, limit: number) => json + " ".repeat(limit - Buffer.byteLength(json));
    expect((await http.createPromptSet(req("POST", pad(setJson, shortsVaultPromptSetBodyLimit)))).status).toBe(201);
    expect((await http.createPromptSet(req("POST", pad(setJson, shortsVaultPromptSetBodyLimit) + " "))).status).toBe(413);
    expect((await http.createProject(req("POST", pad(projectJson, shortsVaultProjectBodyLimit)))).status).toBe(201);
    expect((await http.createProject(req("POST", pad(projectJson, shortsVaultProjectBodyLimit) + " "))).status).toBe(413);
    expect(store.createPromptSet).toHaveBeenCalledTimes(1);
    expect(store.createProject).toHaveBeenCalledTimes(1);
  });

  it("treats malformed ids as missing and deletes with 204", async () => {
    const { http, store } = fixture();
    for (const bad of ["1", "../x", `${id}0`]) {
      expect((await http.getProject(route(bad))).status).toBe(404);
      expect((await http.getPromptSet(route(bad))).status).toBe(404);
    }
    expect(store.getProject).not.toHaveBeenCalled();
    const removed = await http.deletePromptSet(req("DELETE"), route());
    expect(removed.status).toBe(204);
    expect(removed.headers.get("cache-control")).toBe("private, no-store");
    expect((await http.deleteProject(req("DELETE"), route())).status).toBe(404);
  });
});

// P1-08-SHORTS-VAULT-CONTENT-SEARCH-API: POST /api/admin/shorts-vault/prompts/search 경계(합성 인증·가짜 저장소). 실제 SQL은 PG17 시험.
describe("administrator Shorts vault content search HTTP", () => {
  const search = (body: unknown, headers: Record<string, string> = {}) => req("POST", body, headers);

  it("checks the administrator before reading the body and never touches the store", async () => {
    for (const auth of [{ kind: "denied", status: 401, code: "AUTH_REQUIRED" }, { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" },
      { kind: "local" }] as ServerAuthResult[]) {
      const { http, store } = fixture(auth);
      const request = search({ query: "캠핑" });
      const readBody = vi.spyOn(request, "text");
      const reply = await http.searchPromptSets(request);
      expect([401, 403]).toContain(reply.status);
      expect(readBody).not.toHaveBeenCalled();
      expect(store.searchPromptSets).not.toHaveBeenCalled();
    }
  });

  it("passes the trimmed query to the owner's store and returns the list envelope without caching", async () => {
    const { http, store } = fixture();
    const summary = { id, title: "캠핑 요리", ideaTitle: "소재", keyword: "캠핑", sceneCount: 3, hasBgm: true, createdAt: "2026-11-22T00:00:00.000Z" };
    store.searchPromptSets.mockResolvedValueOnce([summary]);
    const reply = await http.searchPromptSets(search({ query: "  Dolly 줌 \n" }));
    expect(reply.status).toBe(200);
    expect(reply.headers.get("cache-control")).toBe("private, no-store");
    expect(await reply.json()).toEqual({ promptSets: [summary] });
    expect(store.searchPromptSets).toHaveBeenCalledWith(owner, "Dolly 줌");
    for (const query of ["가".repeat(120), "😀".repeat(120), "%", "_", "\\", "100%_off", "'; DROP TABLE x; --"]) {
      expect((await http.searchPromptSets(search({ query }))).status, query).toBe(200);
      expect(store.searchPromptSets).toHaveBeenLastCalledWith(owner, query);
    }
  });

  it("refuses foreign origins, malformed or unbounded queries and extra keys before the store", async () => {
    const { http, store } = fixture();
    expect((await http.searchPromptSets(search({ query: "캠핑" }, { origin: "https://foreign.invalid" }))).status).toBe(403);
    for (const body of [{}, { query: "" }, { query: "   \t\n" }, { query: "가".repeat(121) }, { query: "😀".repeat(121) },
      { query: 7 }, { query: null }, { query: ["캠핑"] }, { query: "캠핑", owner }, { query: "캠핑", limit: 500 }, { query: "a\u0000b" },
      [], "캠핑", "{\"query\":"]) {
      const reply = await http.searchPromptSets(search(body));
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(await reply.json()).toEqual({ code: "invalid_input" });
    }
    const json = JSON.stringify({ query: "캠핑" });
    const pad = (limit: number) => json + " ".repeat(limit - Buffer.byteLength(json));
    expect((await http.searchPromptSets(search(pad(shortsVaultSearchBodyLimit)))).status).toBe(200);
    expect((await http.searchPromptSets(search(pad(shortsVaultSearchBodyLimit) + " "))).status).toBe(413);
    expect(store.searchPromptSets).toHaveBeenCalledTimes(1);
  });

  it("hides storage failures behind 503 and does not log the query", async () => {
    const { http, store } = fixture();
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(name => vi.spyOn(console, name).mockImplementation(() => undefined));
    try {
      store.searchPromptSets.mockRejectedValueOnce(new Error("canceling statement due to statement timeout 비밀검색어"));
      const reply = await http.searchPromptSets(search({ query: "비밀검색어" }));
      expect(reply.status).toBe(503);
      expect(await reply.text()).toBe(JSON.stringify({ code: "storage_unavailable" }));
      expect(logs.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally { for (const spy of logs) spy.mockRestore(); }
    const unlinked = fixture(undefined, false);
    expect((await unlinked.http.searchPromptSets(search({ query: "캠핑" }))).status).toBe(503);
  });

  it("exposes only POST on the search route and keeps the existing prompt routes unchanged", async () => {
    const searchRoute = await import("@/app/api/admin/shorts-vault/prompts/search/route");
    expect(Object.keys(searchRoute).filter(key => /^[A-Z]+$/.test(key)).sort()).toEqual(["POST"]);
    expect(searchRoute.runtime).toBe("nodejs");
    const prompts = await import("@/app/api/admin/shorts-vault/prompts/route");
    expect(Object.keys(prompts).filter(key => /^[A-Z]+$/.test(key)).sort()).toEqual(["GET", "POST"]);
    const one = await import("@/app/api/admin/shorts-vault/prompts/[id]/route");
    expect(Object.keys(one).filter(key => /^[A-Z]+$/.test(key)).sort()).toEqual(["DELETE", "GET"]);
    expect(shortsVaultPromptSearchPath).toBe("/api/admin/shorts-vault/prompts/search");
  });
});
