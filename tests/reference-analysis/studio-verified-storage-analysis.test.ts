import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, type FileHandle } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import * as media from "../../lib/media/tools";
import { privateObjectKey } from "../../lib/storage/supabase/object-key";
import * as snapshots from "../../lib/reference-analysis/registered-snapshot";
import { createIsolatedVerifiedStorageAnalysis } from "../../lib/reference-analysis/studio-verified-storage-analysis";

vi.mock("server-only", () => ({}));

const ownerA = "10000000-0000-4000-8000-0000000000a1";
const ownerB = "10000000-0000-4000-8000-0000000000b1";
const selectA = { projectId: "10000000-0000-4000-8000-0000000000a2", assetId: "10000000-0000-7000-8000-0000000000a3" };
const selectB = { projectId: "10000000-0000-4000-8000-0000000000b2", assetId: "10000000-0000-7000-8000-0000000000b3" };
const selectVideo = { ...selectA, assetId: "10000000-0000-7000-8000-0000000000a4" };
const auth = (userId: string): ServerAuthResult => ({ kind: "verified", userId, email: "owner@example.invalid" });
const failure = (reason = "source_unavailable") => ({ schemaVersion: 1, status: "unavailable", reason });
const credential = "synthetic-studio-storage-key";
const bucket = "unit-private";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Options = Parameters<typeof createIsolatedVerifiedStorageAnalysis>[0];
let root: string;
let workRoot: string;
let storage: Options["storage"];
let alpha: Buffer;
let samples: ReturnType<typeof record>[];
let fault: "none" | "mutated" | "public" = "none";
const requests: string[] = [];
const objectBytes = new Map<string, Buffer>();

function record(ownerId: string, selection: typeof selectA, data: Buffer, video = false) {
  const identity = { ownerId, id: selection.assetId, sha256: digest(data), sizeBytes: data.length };
  const media = video ? { kind: "video", mime: "video/mp4" } as const : { kind: "image", mime: "image/png" } as const;
  const asset = { ...identity, ...media, objectKey: privateObjectKey({ ...identity, ...media }) };
  objectBytes.set(`/storage/v1/object/${bucket}/${asset.objectKey}`, data);
  return { status: "authorized", ownerId, ...selection, linkActive: true, ownerEnabled: true, scopeEnabled: true,
    storeId: "private-fixture", restoreGeneration: "restore-1", linkGeneration: "0", ownerPermissionGeneration: "1",
    scopePermissionGeneration: "1", sourceGeneration: "source-1", storageGeneration: "2", verifiedStorageGeneration: "2", asset };
}

const server = createServer((request, response) => {
  requests.push(request.url ?? "");
  if (request.method !== "GET" || request.headers.authorization !== `Bearer ${credential}` || request.headers.apikey !== credential) {
    response.writeHead(403).end(); return;
  }
  if (request.url === `/storage/v1/bucket/${bucket}`) {
    response.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ id: bucket, name: bucket, public: fault === "public" }));
    return;
  }
  const original = objectBytes.get(request.url ?? "");
  if (!original) { response.writeHead(404).end(); return; }
  const bytes = Buffer.from(original);
  if (fault === "mutated") bytes[bytes.length - 1] ^= 1;
  response.writeHead(200, { "content-length": bytes.length }).end(bytes);
});

function fixture(overrides: Partial<Options["storage"]> = {}) {
  const resolveAuth = vi.fn<Options["resolveAuth"]>().mockResolvedValue(auth(ownerA));
  const readAuthority = vi.fn<Options["readAuthority"]>().mockImplementation(async (actor, selected) =>
    samples.find(sample => actor.id === sample.ownerId && selected.projectId === sample.projectId && selected.assetId === sample.assetId));
  const analyze = createIsolatedVerifiedStorageAnalysis({ storage: { ...storage, ...overrides }, resolveAuth, readAuthority });
  return { analyze, resolveAuth, readAuthority };
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "dream-t302-")));
  workRoot = join(root, "download");
  await mkdir(workRoot);
  alpha = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ed1818" } }).png().toBuffer();
  const beta = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#1616ed" } }).png().toBuffer();
  samples = [record(ownerA, selectA, alpha), record(ownerB, selectB, beta)];
  const suffix = process.platform === "win32" ? ".exe" : "";
  const ffprobePath = join(media.mediaToolsFolder(), "ffprobe" + suffix);
  if (process.env.DREAM_REA_NATIVE_TEST === "1") {
    const path = join(root, "sample.mp4");
    await media.runMedia(join(media.mediaToolsFolder(), "ffmpeg" + suffix), ["-v", "error", "-f", "lavfi", "-i",
      "color=c=red:s=32x24:r=10:d=1", "-c:v", "mpeg4", path], { timeout: 10_000, windowsHide: true });
    samples.push(record(ownerA, selectVideo, await readFile(path), true));
  }
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback required");
  storage = { profile: "synthetic", projectUrl: `http://127.0.0.1:${address.port}`, projectRef: "abcdefghijklmnopqrst", bucket,
    privateBucket: true, credential: { mode: "service-role", key: credential }, maxBytes: 1024 * 1024,
    timeoutMs: 5000, maxConcurrent: 2, workRoot, ffprobePath };
});

beforeEach(() => { requests.length = 0; fault = "none"; });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); expect(await readdir(workRoot)).toEqual([]); });
afterAll(async () => {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise<void>(ok => server.close(() => ok()));
  }
  if (root) {
    if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith("dream-t302-")) throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

describe("Studio registered analysis from the single verified download", () => {
  it("serves each owner once, with a sanitized result and no cross-owner download", async () => {
    const { analyze, readAuthority, resolveAuth } = fixture();
    expect(await analyze(selectB)).toEqual(failure());
    expect(requests).toEqual([]);
    const a = await analyze(selectA);
    resolveAuth.mockResolvedValue(auth(ownerB));
    expect(await analyze(selectA)).toEqual(failure());
    const b = await analyze(selectB);
    for (const [result, colour] of [[a, "#e02020"], [b, "#2020e0"]] as const) {
      expect(result).toMatchObject({ status: "ready", media: "image", proposals: expect.arrayContaining([expect.objectContaining({
        draft: expect.objectContaining({ kind: "creative_proposal", prompt: expect.stringContaining(colour) }),
      })]) });
      expect(JSON.stringify(result)).not.toMatch(/dream-verify-|private-fixture|owner@example|storageGeneration|source-1|objectKey/);
    }
    expect(requests.filter(url => url.startsWith(`/storage/v1/object/${bucket}/`))).toEqual(samples.slice(0, 2).map(sample =>
      `/storage/v1/object/${bucket}/${sample.asset.objectKey}`));
    expect(readAuthority).toHaveBeenCalledTimes(10);
  });

  it("closes unverified authority, local auth, private bucket failure and wrong bytes before decoding", async () => {
    const { analyze, readAuthority, resolveAuth } = fixture();
    const decode = vi.spyOn(snapshots, "analyzeRegisteredReferenceSnapshot");
    expect(await analyze({ ...selectA, path: "private" })).toEqual(failure("invalid_selection"));
    resolveAuth.mockResolvedValueOnce({ kind: "local" });
    expect(await analyze(selectA)).toEqual(failure());
    for (const proof of [null, { status: "observed" }, { ...samples[0], scopePermissionGeneration: undefined },
      { ...samples[0], verifiedStorageGeneration: "1" }, { ...samples[0], ownerEnabled: false }]) {
      readAuthority.mockResolvedValueOnce(proof);
      expect(await analyze(selectA)).toEqual(failure());
    }
    expect(requests).toEqual([]);
    for (const mode of ["mutated", "public"] as const) {
      fault = mode;
      expect(await analyze(selectA)).toEqual(failure());
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it("disables a managed profile before resolving users or contacting storage", async () => {
    const { readAuthority, resolveAuth } = fixture();
    const managed = { ...storage, profile: "managed" as const, projectUrl: `https://${storage.projectRef}.supabase.co` };
    const analyze = createIsolatedVerifiedStorageAnalysis({ storage: managed as unknown as Options["storage"], resolveAuth, readAuthority });
    expect(await analyze(selectA)).toEqual(failure());
    expect(resolveAuth).not.toHaveBeenCalled();
    expect(readAuthority).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("rejects authority changes after download and rechecks remaining rights after reader cleanup", async () => {
    const { analyze, readAuthority, resolveAuth } = fixture();
    const decode = vi.spyOn(snapshots, "analyzeRegisteredReferenceSnapshot");
    const original = samples[0];
    readAuthority.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, linkGeneration: "2" });
    expect(await analyze(selectA)).toEqual(failure());
    expect(decode).not.toHaveBeenCalled();

    for (const changed of [null, { ...original, ownerPermissionGeneration: "2" },
      { ...original, sourceGeneration: "source-2", storageGeneration: "3", verifiedStorageGeneration: "3" }]) {
      readAuthority.mockResolvedValueOnce(original).mockResolvedValueOnce(original).mockResolvedValueOnce(original)
        .mockImplementationOnce(async () => { expect(await readdir(workRoot)).toEqual([]); return changed; });
      expect(await analyze(selectA)).toEqual(failure());
    }
    resolveAuth.mockResolvedValueOnce(auth(ownerA)).mockResolvedValueOnce(auth(ownerA)).mockResolvedValueOnce(auth(ownerA))
      .mockResolvedValueOnce(auth(ownerB));
    expect(await analyze(selectA)).toEqual(failure());
    expect(decode).toHaveBeenCalledTimes(4);
    expect(requests.filter(url => url.startsWith(`/storage/v1/object/${bucket}/`))).toHaveLength(5);
  });

  it.each(["cancelled", "timed_out"] as const)("discards a result when final authority stalls on %s", async reason => {
    const { analyze, readAuthority } = fixture({ maxConcurrent: 1, timeoutMs: reason === "timed_out" ? 800 : 5000 });
    const started = Promise.withResolvers<void>();
    const late = Promise.withResolvers<unknown>();
    let reached = false;
    for (let phase = 0; phase < 3; phase++) readAuthority.mockResolvedValueOnce(samples[0]);
    readAuthority.mockImplementationOnce(() => { reached = true; started.resolve(); return late.promise; });
    const controller = new AbortController();
    const pending = analyze(selectA, controller.signal);
    try {
      expect(await Promise.race([started.promise, pending])).toBeUndefined();
      expect(await readdir(workRoot)).toEqual([]);
      if (reason === "cancelled") controller.abort();
      expect(await pending).toEqual(failure(reason));
      expect(await analyze(selectA)).toMatchObject({ status: "ready" });
    } finally { if (reached) late.reject(new Error("late authority failure")); }
  });

  it("rejects malformed runtime and pre-aborted signals without using the only slot", async () => {
    const { analyze, resolveAuth, readAuthority } = fixture({ maxConcurrent: 1 });
    for (const value of [{}, { aborted: true }, null, "invalid", Object.create(AbortSignal.prototype)]) {
      await expect(analyze(selectA, value as AbortSignal)).resolves.toEqual(failure());
    }
    await expect(analyze(selectA, AbortSignal.abort())).resolves.toEqual(failure("cancelled"));
    expect(resolveAuth).not.toHaveBeenCalled();
    expect(readAuthority).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(await analyze(selectA, new AbortController().signal)).toMatchObject({ status: "ready" });
  });

  it("contains timeout and signal composition setup failures without losing capacity", async () => {
    const { analyze, resolveAuth, readAuthority } = fixture({ maxConcurrent: 1 });
    const signal = new AbortController().signal;
    vi.spyOn(AbortSignal, "timeout").mockImplementationOnce(() => { throw new Error("private timeout setup"); });
    await expect(analyze(selectA, signal)).resolves.toEqual(failure());
    vi.spyOn(AbortSignal, "any").mockImplementationOnce(() => { throw new Error("private signal setup"); });
    await expect(analyze(selectA, signal)).resolves.toEqual(failure());
    expect(resolveAuth).not.toHaveBeenCalled();
    expect(readAuthority).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(await analyze(selectA, signal)).toMatchObject({ status: "ready" });
  });

  it.skipIf(process.platform !== "win32")("removes the original path while a shared Windows read handle is still open", async () => {
    const { analyze, readAuthority } = fixture();
    let handle: FileHandle | undefined;
    let path: string | undefined;
    readAuthority.mockResolvedValueOnce(samples[0]).mockImplementationOnce(async () => {
      const [dir] = await readdir(workRoot);
      path = join(workRoot, dir, "object");
      handle = await open(path, "r");
      return samples[0];
    });
    try {
      expect(await analyze(selectA)).toMatchObject({ status: "ready" });
      expect(await readdir(workRoot)).toEqual([]);
      await expect(access(path!)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await handle!.readFile()).toEqual(alpha);
    } finally { await handle?.close(); }
  });

  it.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("closes the native decoder and deletes its copy after cancellation", async () => {
    const { analyze } = fixture();
    const controller = new AbortController();
    const exited = Promise.withResolvers<void>();
    const run = media.runMedia;
    let decoderPath: string | undefined;
    vi.spyOn(media, "runMedia").mockImplementation((...args) => {
      const operation = run(...args);
      const path = args[1]?.at(-1);
      if (path?.includes("dream-rea-inspect-") && !decoderPath) {
        decoderPath = path;
        operation.child.once("spawn", () => controller.abort());
        operation.child.once("close", () => exited.resolve());
      }
      return operation;
    });
    expect(await analyze(selectVideo, controller.signal)).toEqual(failure("cancelled"));
    expect(decoderPath).toBeDefined();
    await exited.promise;
    await vi.waitFor(() => expect(access(dirname(decoderPath!))).rejects.toMatchObject({ code: "ENOENT" }));
    expect(requests).toHaveLength(2);
    expect(await analyze(selectVideo)).toMatchObject({ status: "ready", media: "video" });
    expect(requests).toHaveLength(4);
  });
});
