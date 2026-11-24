import { describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { createIsolatedStudioMaterialsGet } from "../../lib/reference-analysis/studio-protected-materials-get";

vi.mock("server-only", () => ({}));

const origin = "http://127.0.0.1:40000";
const endpoint = origin + "/fixture/materials";
const owner = "10000000-0000-4000-8000-000000000011";
const other = "10000000-0000-4000-8000-000000000012";
const row = {
  ownerId: owner, projectId: "10000000-0000-4000-8000-000000000013", assetId: "10000000-0000-7000-8000-000000000014",
  label: "등록 이미지", registration: "current", analysisAllowed: true, revision: "a".repeat(64),
};
const session = (userId = owner): ServerAuthResult => ({ kind: "verified", userId, email: "fixture@example.invalid" });

async function check(response: Response, status: number, body?: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  if (body !== undefined) expect(await response.json()).toEqual(body);
}

describe("isolated registered materials HTTP contract", () => {
  it("applies Auth and fails closed without a store", async () => {
    const resolveAuth = vi.fn<() => Promise<ServerAuthResult>>();
    const unlinked = createIsolatedStudioMaterialsGet({ resolveAuth });
    resolveAuth.mockResolvedValueOnce(session());
    await check(await unlinked(new Request(endpoint)), 503, { code: "STUDIO_MATERIALS_UNAVAILABLE" });
    const readMaterialSnapshots = vi.fn();
    const get = createIsolatedStudioMaterialsGet({ resolveAuth, readMaterialSnapshots });
    resolveAuth.mockResolvedValueOnce({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    await check(await get(new Request(endpoint)), 401);
    resolveAuth.mockResolvedValueOnce({ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" });
    await check(await get(new Request(endpoint)), 403);
    resolveAuth.mockResolvedValueOnce({ kind: "local" });
    await check(await get(new Request(endpoint)), 401);
    resolveAuth.mockRejectedValueOnce(new Error("internal fixture value"));
    await check(await get(new Request(endpoint)), 503, { code: "STUDIO_MATERIALS_UNAVAILABLE" });
    expect(readMaterialSnapshots).not.toHaveBeenCalled();
  });

  it("projects only stable owned rows and omits a replaced revision", async () => {
    const replaced = { ...row, assetId: "10000000-0000-7000-8000-000000000015" };
    const foreign = { ...row, ownerId: other, label: "private owner marker" };
    const readMaterialSnapshots = vi.fn()
      .mockResolvedValueOnce([row, replaced, foreign])
      .mockResolvedValueOnce([foreign, { ...replaced, revision: "b".repeat(64) }, row]);
    const get = createIsolatedStudioMaterialsGet({ resolveAuth: async () => session(), readMaterialSnapshots });
    await check(await get(new Request(endpoint)), 200, { materials: [{ projectId: row.projectId, assetId: row.assetId, label: row.label }] });
    expect(readMaterialSnapshots).toHaveBeenCalledTimes(2);
    for (const [actor, signal] of readMaterialSnapshots.mock.calls) {
      expect(actor.id).toBe(owner);
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("drops a request when the verified account changes between the two reads", async () => {
    const readMaterialSnapshots = vi.fn().mockResolvedValue([row]);
    const resolveAuth = vi.fn<() => Promise<ServerAuthResult>>().mockResolvedValueOnce(session()).mockResolvedValueOnce(session(other));
    await check(await createIsolatedStudioMaterialsGet({ resolveAuth, readMaterialSnapshots })(new Request(endpoint)), 401);
    expect(readMaterialSnapshots).toHaveBeenCalledTimes(1);
  });

  it("serves no rows for non-loopback, cross-site, non-GET, prefetch and RSC requests", async () => {
    const resolveAuth = vi.fn();
    const readMaterialSnapshots = vi.fn();
    const get = createIsolatedStudioMaterialsGet({ resolveAuth, readMaterialSnapshots });
    await check(await get(new Request("https://external.invalid/fixture/materials")), 503);
    await check(await get(new Request(endpoint, { headers: { origin: "http://other.invalid" } })), 403);
    await check(await get(new Request(endpoint, { headers: { "sec-fetch-site": "same-site" } })), 403);
    const method = await get(new Request(endpoint, { method: "POST" }));
    await check(method, 405);
    expect(method.headers.get("allow")).toBe("GET");
    for (const [name, value] of [["RSC", "1"], ["Next-Router-Prefetch", "1"], ["Next-Router-Segment-Prefetch", "/_tree"],
      ["Purpose", "prefetch"], ["Sec-Purpose", "prefetch;prerender"]]) {
      const reply = await get(new Request(endpoint, { headers: { [name]: value } }));
      await check(reply, 204);
      expect(await reply.text()).toBe("");
    }
    expect(resolveAuth).not.toHaveBeenCalled();
    expect(readMaterialSnapshots).not.toHaveBeenCalled();
  });

  it("discards in-flight reads on cancellation and denies malformed or duplicate rows", async () => {
    const started = Promise.withResolvers<void>();
    const remote = Promise.withResolvers<unknown>();
    const readMaterialSnapshots = vi.fn().mockImplementationOnce(() => {
      started.resolve();
      return remote.promise;
    }).mockResolvedValueOnce([row, row]).mockResolvedValueOnce([{ ...row, revision: "unexpected" }]);
    const get = createIsolatedStudioMaterialsGet({ resolveAuth: async () => session(), readMaterialSnapshots });
    const abort = new AbortController();
    const response = get(new Request(endpoint, { signal: abort.signal }));
    await started.promise;
    abort.abort();
    await check(await response, 503);
    remote.resolve([row]);
    expect(readMaterialSnapshots).toHaveBeenCalledTimes(1);
    await check(await get(new Request(endpoint)), 503);
    await check(await get(new Request(endpoint)), 503);
  });
});
