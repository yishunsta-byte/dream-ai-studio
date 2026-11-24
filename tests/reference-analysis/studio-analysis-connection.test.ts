import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import CloudReferenceAnalysisPage from "../../app/(cloud)/cloud/reference-analysis/page";
import { POST } from "../../app/api/studio/reference-analysis/route";
import { getRenderAuth } from "../../lib/auth/render";
import { resolveServerAuth } from "../../lib/auth/resolve";
import { isVerifiedActor, type VerifiedActor } from "../../lib/db/postgres/types";
import { createStudioAnalysisConnection, studioAnalysisConnection } from "../../lib/reference-analysis/studio-analysis-connection";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";
import { loadStudioRegisteredAnalysisPage } from "../../lib/reference-analysis/studio-registered-analysis-page";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/auth/render", () => ({ getRenderAuth: vi.fn() }));
vi.mock("../../lib/auth/resolve", () => ({ resolveServerAuth: vi.fn() }));

type Selection = { projectId: string; assetId: string };
const auth = (userId: string) => ({ kind: "verified", userId, email: "owner@example.invalid" } as const);
const ownerA = "10000000-0000-4000-8000-000000000010";
const ownerB = "20000000-0000-4000-8000-000000000010";
const chosenA = { projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012" };
const chosenB = { projectId: "20000000-0000-4000-8000-000000000011", assetId: "20000000-0000-7000-8000-000000000012" };
const origin = "http://127.0.0.1:39301";
const failure = (reason: string) => ({ schemaVersion: 1, status: "unavailable", reason });

function request(selection = chosenA) {
  return new Request(`${origin}/api/studio/reference-analysis`, {
    method: "POST", headers: { origin, host: new URL(origin).host, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(selection),
  });
}

async function fixture(folder: string) {
  const root = await realpath(folder);
  async function register(ownerId: string, selection: Selection, label: string, name: string, color: string) {
    const path = join(root, name);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer();
    await writeFile(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { ownerId, selection, label, active: true, scopeGeneration: "1", path, name, bytes: bytes.length, sha256 };
  }
  const a = await register(ownerA, chosenA, "A의 합성 자료", "fixture-private-a.png", "#ff0000");
  const b = await register(ownerB, chosenB, "B의 합성 자료", "fixture-private-b.png", "#0000ff");
  function current(actor: VerifiedActor) {
    expect(isVerifiedActor(actor)).toBe(true);
    return [a, b].filter((entry) => entry.active && entry.ownerId === actor.id);
  }
  const listAnalyzableMaterials = vi.fn(async (actor: VerifiedActor) => current(actor).map((entry) => ({
    ownerId: entry.ownerId, ...entry.selection, label: entry.label, registration: "current", analysisAllowed: true, path: entry.path,
  })));
  const resolveRegisteredSource = vi.fn(async (actor: VerifiedActor, selection: Selection, signal: AbortSignal) => {
    signal.throwIfAborted();
    const entry = current(actor).find(({ selection: active }) => active.projectId === selection.projectId && active.assetId === selection.assetId);
    if (!entry) return;
    return { status: "authorized", ownerId: entry.ownerId, ...entry.selection, path: entry.path, managedRoot: root, name: entry.name,
      mime: "image/png", sizeBytes: entry.bytes, sha256: entry.sha256, storeId: "fixture-store", restoreGeneration: "restore-1",
      linkGeneration: "link-1", sourceGeneration: "source-1", ownerPermissionGeneration: "1", scopePermissionGeneration: entry.scopeGeneration };
  });
  const connection = createStudioAnalysisConnection({ listAnalyzableMaterials, resolveRegisteredSource });
  return {
    a, b, listAnalyzableMaterials, resolveRegisteredSource,
    page: (owner: string) => loadStudioRegisteredAnalysisPage({ connection: connection?.page, resolveAuth: async () => auth(owner) }),
    post: (owner: string, chosen: Selection) => createStudioAnalysisPost({ ...connection?.post, resolveAuth: async () => auth(owner) })(request(chosen)),
  };
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("Studio shared registered analysis connection", () => {
  it("keeps both product entry points closed until an explicit complete authority is wired", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    expect(studioAnalysisConnection).toBeUndefined();
    vi.mocked(getRenderAuth).mockResolvedValueOnce(auth(ownerA));
    vi.mocked(resolveServerAuth).mockResolvedValueOnce(auth(ownerA));
    const page = renderToStaticMarkup(await CloudReferenceAnalysisPage());
    expect(page).toContain("등록 자료 분석 공급자가 아직 연결되지 않았어요");
    expect(page).toMatch(/<button[^>]+disabled=""[^>]*>분석 실행/);
    const post = await POST(request());
    expect(post.status).toBe(503);
    expect(post.headers.get("cache-control")).toBe("no-store");
    expect(await post.json()).toEqual(failure("analysis_unavailable"));
  });

  it("does not allow either entry point to use a partial configuration", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const listAnalyzableMaterials = vi.fn(async () => []);
    const resolveRegisteredSource = vi.fn(async () => undefined);
    const analyzeRegisteredSource = vi.fn(async () => ({ schemaVersion: 1, status: "unavailable", reason: "source_unavailable" }) as const);
    const resolveAuth = async () => auth(ownerA);
    for (const authority of [{ listAnalyzableMaterials }, { resolveRegisteredSource }, { analyzeRegisteredSource },
      { listAnalyzableMaterials, analyzeRegisteredSource, resolveRegisteredSource }]) {
      const connection = createStudioAnalysisConnection(authority);
      expect(connection).toBeUndefined();
      expect(await loadStudioRegisteredAnalysisPage({ connection: connection?.page, resolveAuth })).toEqual({ kind: "disconnected" });
      expect((await createStudioAnalysisPost({ ...connection?.post, resolveAuth })(request())).status).toBe(503);
    }
    expect(listAnalyzableMaterials).not.toHaveBeenCalled();
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
    expect(analyzeRegisteredSource).not.toHaveBeenCalled();
  });

  it("passes a verified actor and only the selection to a single operation without exposing a path resolver", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const listAnalyzableMaterials = vi.fn(async () => [{ ownerId: ownerA, ...chosenA, label: "A 자료", registration: "current", analysisAllowed: true }]);
    const analyzeRegisteredSource = vi.fn(async () => ({ schemaVersion: 1, status: "unavailable", reason: "source_unavailable" }) as const);
    const connection = createStudioAnalysisConnection({ listAnalyzableMaterials, analyzeRegisteredSource });
    const resolveAuth = async () => auth(ownerA);
    expect(connection?.post).not.toHaveProperty("resolveRegisteredSource");
    expect(await loadStudioRegisteredAnalysisPage({ connection: connection?.page, resolveAuth })).toEqual({
      kind: "connected", materials: [{ ...chosenA, label: "A 자료" }],
    });
    const result = await createStudioAnalysisPost({ ...connection?.post, resolveAuth })(request(chosenA));
    expect(await result.json()).toEqual(failure("source_unavailable"));
    expect(analyzeRegisteredSource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: ownerA }), chosenA, expect.any(AbortSignal));
  });

  it("uses the same authority for A/B lists and T284 source checks and rejects cross-owner analysis", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const folder = await mkdtemp(join(tmpdir(), "dream-t301-"));
    try {
      const local = await fixture(folder);
      for (const [owner, entry, palette] of [[ownerA, local.a, "#e02020"], [ownerB, local.b, "#2020e0"], [ownerA, local.a, "#e02020"]] as const) {
        expect(await local.page(owner)).toEqual({ kind: "connected", materials: [{ ...entry.selection, label: entry.label }] });
        expect(local.listAnalyzableMaterials).toHaveBeenLastCalledWith(expect.objectContaining({ id: owner }));
        const response = await local.post(owner, entry.selection);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const output = await response.json();
        expect(output).toMatchObject({ status: "ready", media: "image" });
        expect(JSON.stringify(output)).toContain(palette);
        expect(JSON.stringify(output)).not.toContain(entry.path);
        for (const [actor, selected, signal] of local.resolveRegisteredSource.mock.calls.slice(-2)) {
          expect(actor.id).toBe(owner);
          expect(selected).toEqual(entry.selection);
          expect(signal.aborted).toBe(false);
        }
      }
      expect(local.resolveRegisteredSource).toHaveBeenCalledTimes(6);
      expect(await (await local.post(ownerA, chosenB)).json()).toEqual(failure("source_unavailable"));
      expect(await (await local.post(ownerB, chosenA)).json()).toEqual(failure("source_unavailable"));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("rejects an old selection after revocation or reassignment and discards a changed generation during analysis", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const folder = await mkdtemp(join(tmpdir(), "dream-t301-"));
    try {
      const local = await fixture(folder);
      expect(await local.page(ownerA)).toMatchObject({ materials: [{ ...chosenA, label: local.a.label }] });
      local.a.active = false;
      expect(await (await local.post(ownerA, chosenA)).json()).toEqual(failure("source_unavailable"));
      expect(await local.page(ownerA)).toEqual({ kind: "connected", materials: [] });

      local.a.active = true;
      local.a.ownerId = ownerB;
      expect(await (await local.post(ownerA, chosenA)).json()).toEqual(failure("source_unavailable"));
      expect(await local.page(ownerA)).toEqual({ kind: "connected", materials: [] });
      expect(await local.page(ownerB)).toEqual({ kind: "connected", materials: [
        { ...chosenA, label: local.a.label }, { ...chosenB, label: local.b.label },
      ] });

      const resolve = local.resolveRegisteredSource.getMockImplementation()!;
      local.resolveRegisteredSource.mockImplementationOnce(async (...args) => {
        const source = await resolve(...args);
        local.b.scopeGeneration = "2";
        return source;
      });
      const before = local.resolveRegisteredSource.mock.calls.length;
      expect(await (await local.post(ownerB, chosenB)).json()).toEqual(failure("source_unavailable"));
      expect(local.resolveRegisteredSource.mock.calls.length - before).toBe(2);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
