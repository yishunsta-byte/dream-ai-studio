import { createHash } from "node:crypto";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { mediaToolsFolder } from "../../lib/media/tools";
import * as snapshot from "../../lib/reference-analysis/registered-snapshot";
import { createIsolatedStudioAnalysis } from "../../lib/reference-analysis/studio-analysis-source";
import { privateObjectKey } from "../../lib/storage/supabase/object-key";

vi.mock("server-only", () => ({}));

const ownerA = "10000000-0000-4000-8000-000000000010";
const ownerB = "10000000-0000-4000-8000-000000000020";
const selectA = { projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012" };
const selectB = { projectId: "10000000-0000-4000-8000-000000000021", assetId: "10000000-0000-7000-8000-000000000022" };
const auth = (userId: string): ServerAuthResult => ({ kind: "verified", userId, email: "owner@example.invalid" });
const error = (reason = "source_unavailable") => ({ schemaVersion: 1, status: "unavailable", reason });
const credential = "synthetic-reader-credential";
const bucket = "unit-private";
let root: string;
let storage: Parameters<typeof createIsolatedStudioAnalysis>[0]["storage"];
let records: ReturnType<typeof registration>[];
let alpha: Buffer;
let beta: Buffer;
let mutateReader = false;
const calls: string[] = [];
const objects = new Map<string, Buffer>();

function registration(ownerId: string, selection: typeof selectA, bytes: Buffer) {
  const asset = { id: selection.assetId, ownerId, kind: "image", mime: "image/png",
    sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } as const;
  return {
    status: "authorized", ownerId, ...selection, linkActive: true, ownerEnabled: true, scopeEnabled: true,
    storeId: "fixture-store", restoreGeneration: "restore-1", linkGeneration: "0", scopePermissionGeneration: "1",
    ownerPermissionGeneration: "1", sourceGeneration: "source-1", storageGeneration: "2", verifiedStorageGeneration: "2",
    asset: { ...asset, objectKey: privateObjectKey(asset) },
  };
}

const server = createServer((request, response) => {
  calls.push(request.url ?? "");
  if (request.method !== "GET" || request.headers.authorization !== `Bearer ${credential}` || request.headers.apikey !== credential) {
    response.writeHead(403).end();
    return;
  }
  if (request.url === `/storage/v1/bucket/${bucket}`) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: bucket, name: bucket, public: false }));
    return;
  }
  const bytes = objects.get(request.url ?? "");
  if (!bytes) {
    response.writeHead(404).end();
    return;
  }
  const payload = Buffer.from(bytes);
  if (mutateReader) payload[payload.length - 1] ^= 1;
  response.writeHead(200, { "content-length": payload.length }).end(payload);
});

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.subarray(0, 7));
    controller.enqueue(bytes.subarray(7));
    controller.close();
  } });
}

function fixture(storageOverrides: Partial<typeof storage> = {}) {
  const resolveAuth = vi.fn<() => Promise<ServerAuthResult>>().mockResolvedValue(auth(ownerA));
  const readAuthority = vi.fn<Parameters<typeof createIsolatedStudioAnalysis>[0]["readAuthority"]>()
    .mockImplementation(async (actor, selection) => records.find(row => row.ownerId === actor.id &&
      row.projectId === selection.projectId && row.assetId === selection.assetId));
  const openBytes = vi.fn<Parameters<typeof createIsolatedStudioAnalysis>[0]["openBytes"]>()
    .mockImplementation(async (_actor, asset) => stream(objects.get(`/storage/v1/object/${bucket}/${asset.objectKey}`)!));
  const run = createIsolatedStudioAnalysis({ storage: { ...storage, ...storageOverrides }, resolveAuth, readAuthority, openBytes });
  return { run, resolveAuth, readAuthority, openBytes };
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "dream-t287-")));
  [alpha, beta] = await Promise.all(["#ff0000", "#0000ff"].map(background =>
    sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer()));
  records = [registration(ownerA, selectA, alpha), registration(ownerB, selectB, beta)];
  records.forEach((row, index) => objects.set(`/storage/v1/object/${bucket}/${row.asset.objectKey}`, index === 0 ? alpha : beta));
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback listener unavailable");
  storage = { profile: "synthetic", projectUrl: `http://127.0.0.1:${address.port}`, projectRef: "abcdefghijklmnopqrst",
    bucket, privateBucket: true, credential: { mode: "service-role", key: credential }, maxBytes: 1_048_576,
    timeoutMs: 5000, maxConcurrent: 2, workRoot: root,
    ffprobePath: join(mediaToolsFolder(), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") };
});

beforeEach(() => { calls.length = 0; mutateReader = false; });
afterEach(async () => { vi.restoreAllMocks(); expect(await readdir(root)).toEqual([]); });
afterAll(async () => {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
  if (root) {
    if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith("dream-t287-")) {
      throw new Error("Synthetic cleanup boundary rejected");
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("isolated Studio registration and verified private files", () => {
  it("runs real PNG analysis for both owners without exposing private scope or giving cross-owner access", async () => {
    const { run, resolveAuth, readAuthority, openBytes } = fixture();
    expect(await run(selectB)).toEqual(error());
    expect(calls).toEqual([]);
    const a = await run(selectA);
    resolveAuth.mockResolvedValue(auth(ownerB));
    expect(await run(selectA)).toEqual(error());
    const b = await run(selectB);
    for (const [result, colour] of [[a, "#e02020"], [b, "#2020e0"]] as const) {
      expect(result).toMatchObject({ status: "ready", media: "image", proposals: expect.arrayContaining([
        expect.objectContaining({ draft: expect.objectContaining({ kind: "creative_proposal", prompt: expect.stringContaining(colour) }) }),
      ]) });
      const json = JSON.stringify(result);
      for (const privateValue of [root, ownerA, ownerB, selectA.assetId, selectB.assetId, records[0].asset.sha256, credential]) {
        expect(json).not.toContain(privateValue);
      }
    }
    expect(calls).toHaveLength(4);
    expect(readAuthority).toHaveBeenCalledTimes(8);
    expect(openBytes).toHaveBeenCalledTimes(2);
  });

  it("denies local, unauthenticated, observation-only and incomplete authority before network", async () => {
    const { run, resolveAuth, readAuthority, openBytes } = fixture();
    resolveAuth.mockResolvedValueOnce({ kind: "local" }).mockResolvedValueOnce({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    expect(await run(selectA)).toEqual(error());
    expect(await run(selectA)).toEqual(error());
    expect(readAuthority).not.toHaveBeenCalled();
    const current = records[0];
    for (const proof of [
      { status: "observed", analysisAuthority: "unavailable" },
      { ...current, scopePermissionGeneration: undefined }, { ...current, ownerPermissionGeneration: "0" },
      { ...current, linkGeneration: "18446744073709551615" }, { ...current, linkActive: false },
      { ...current, scopeEnabled: false }, { ...current, ownerEnabled: false },
      { ...current, verifiedStorageGeneration: "1" }, { ...current, asset: records[1].asset },
      { ...current, projectId: selectB.projectId }, { ...current, ownerId: ownerB },
    ]) {
      readAuthority.mockResolvedValueOnce(proof);
      expect(await run(selectA)).toEqual(error());
    }
    expect(calls).toEqual([]);
    expect(openBytes).not.toHaveBeenCalled();
  });

  it("refuses a managed configuration before touching providers", () => {
    const { resolveAuth, readAuthority, openBytes } = fixture();
    const managed = { ...storage, profile: "managed", projectUrl: `https://${storage.projectRef}.supabase.co` };
    expect(() => createIsolatedStudioAnalysis({ storage: managed as typeof storage, resolveAuth, readAuthority, openBytes })).toThrow();
    expect(calls).toEqual([]);
  });

  it("rejects changed bytes at the private reader and at analysis staging without decoding", async () => {
    const decoder = vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot");
    const { run, openBytes } = fixture();
    mutateReader = true;
    expect(await run(selectA)).toEqual(error());
    expect(openBytes).not.toHaveBeenCalled();
    mutateReader = false;
    const altered = Buffer.from(alpha);
    altered[altered.length - 1] ^= 1;
    for (const bytes of [altered, alpha.subarray(0, -1), Buffer.concat([alpha, alpha])]) {
      openBytes.mockResolvedValueOnce(stream(bytes));
      expect(await run(selectA)).toEqual(error());
    }
    expect(decoder).not.toHaveBeenCalled();
  });

  it("rechecks authorization after staging and after decoding before returning anything", async () => {
    const decoder = vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot");
    const { run, readAuthority } = fixture();
    const current = records[0];
    readAuthority.mockResolvedValueOnce(current).mockResolvedValueOnce(undefined);
    expect(await run(selectA)).toEqual(error());
    expect(decoder).not.toHaveBeenCalled();

    for (const changed of [
      { ...current, linkGeneration: "2" }, { ...current, scopePermissionGeneration: "3" },
      { ...current, ownerPermissionGeneration: "3" }, { ...current, restoreGeneration: "restore-2" },
      { ...current, storageGeneration: "3", verifiedStorageGeneration: "3" },
    ]) {
      readAuthority.mockResolvedValueOnce(current).mockResolvedValueOnce(current).mockResolvedValueOnce(changed);
      expect(await run(selectA)).toEqual(error());
    }
    expect(decoder).toHaveBeenCalledTimes(5);
  });

  it("blocks an account change during staging before decoding private bytes", async () => {
    const decoder = vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot");
    const { run, resolveAuth, readAuthority, openBytes } = fixture();
    resolveAuth.mockResolvedValueOnce(auth(ownerA)).mockResolvedValueOnce(auth(ownerB));
    expect(await run(selectA)).toEqual(error());
    expect(openBytes).toHaveBeenCalledTimes(1);
    expect(readAuthority).toHaveBeenCalledTimes(1);
    expect(decoder).not.toHaveBeenCalled();
  });

  it("bounds a stalled authority lookup with the request deadline", async () => {
    const { resolveAuth, readAuthority, openBytes } = fixture();
    readAuthority.mockImplementationOnce(async (_actor, _selection, signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const run = createIsolatedStudioAnalysis({ storage: { ...storage, timeoutMs: 50 }, resolveAuth, readAuthority, openBytes });
    expect(await run(selectA)).toEqual(error("timed_out"));
    expect(calls).toEqual([]);
    expect(openBytes).not.toHaveBeenCalled();
  });

  it.each([
    [1, "timed_out"], [1, "cancelled"], [2, "timed_out"],
    [2, "cancelled"], [3, "timed_out"], [3, "cancelled"],
  ] as const)("releases a stalled authentication at step %i on %s", async (step, reason) => {
    const decoder = vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot");
    const { run, resolveAuth, readAuthority, openBytes } = fixture({
      maxConcurrent: 1, timeoutMs: reason === "timed_out" ? 900 : 5000,
    });
    const caller = new AbortController();
    const waiting = Promise.withResolvers<void>();
    const lateAuth = Promise.withResolvers<ServerAuthResult>();
    for (let done = 1; done < step; done++) resolveAuth.mockResolvedValueOnce(auth(ownerA));
    resolveAuth.mockImplementationOnce(() => { waiting.resolve(); return lateAuth.promise; });
    const pending = run(selectA, caller.signal);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const stalled = new Promise<string>(resolve => { watchdog = setTimeout(() => resolve("still waiting"), 1400); });
      expect(await Promise.race([waiting.promise, stalled])).toBeUndefined();
      expect(await readdir(root)).toHaveLength(step === 1 ? 0 : 1);
      const before = { auth: resolveAuth.mock.calls.length, reads: readAuthority.mock.calls.length,
        bytes: openBytes.mock.calls.length, decodes: decoder.mock.calls.length };
      if (reason === "cancelled") caller.abort();
      expect(await Promise.race([pending, stalled])).toEqual(error(reason));
      expect(await readdir(root)).toEqual([]);
      expect(resolveAuth).toHaveBeenCalledTimes(before.auth);
      expect(readAuthority).toHaveBeenCalledTimes(before.reads);
      expect(openBytes).toHaveBeenCalledTimes(before.bytes);
      expect(decoder).toHaveBeenCalledTimes(before.decodes);
      expect(await run(selectA)).toMatchObject({ status: "ready" });

      const after = { reads: readAuthority.mock.calls.length, bytes: openBytes.mock.calls.length, decodes: decoder.mock.calls.length };
      if (reason === "timed_out") lateAuth.resolve(auth(ownerA));
      else lateAuth.reject(new Error("private late authentication failure"));
      await setImmediate();
      expect(readAuthority).toHaveBeenCalledTimes(after.reads);
      expect(openBytes).toHaveBeenCalledTimes(after.bytes);
      expect(decoder).toHaveBeenCalledTimes(after.decodes);
    } finally {
      clearTimeout(watchdog);
      lateAuth.resolve(auth(ownerA));
      await pending;
    }
  });

  it("cancels a partial staging stream, removes the file and permits a retry", async () => {
    const { run, openBytes } = fixture();
    const controller = new AbortController();
    const opened = Promise.withResolvers<void>();
    const cancel = vi.fn();
    openBytes.mockResolvedValueOnce(new ReadableStream<Uint8Array>({
      pull(source) { source.enqueue(alpha.subarray(0, 7)); opened.resolve(); return new Promise<void>(() => {}); },
      cancel,
    }, { highWaterMark: 0 }));
    const pending = run(selectA, controller.signal);
    await opened.promise;
    controller.abort();
    expect(await pending).toEqual(error("cancelled"));
    expect(cancel).toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    expect(await run(selectA)).toMatchObject({ status: "ready" });
  });
});
