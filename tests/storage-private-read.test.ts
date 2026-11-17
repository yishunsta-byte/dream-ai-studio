import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId, type VerifiedActor } from "@/lib/db/postgres/types";
import { privateStorageConfig, type PrivateStorageOptions } from "@/lib/storage/supabase/config";
import { privateObjectKey, type OwnedStorageAsset } from "@/lib/storage/supabase/object-key";
import { createPrivateObjectReader } from "@/lib/storage/supabase/reader";
import { postgresAssetAvailability } from "@/lib/services/postgres/asset-availability";
vi.mock("server-only", () => ({}));
const A = actorFromVerifiedUserId("00000000-0000-4000-8000-000000000001"), B = "00000000-0000-4000-8000-000000000002";
const key = "unit-only-service-credential", sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let root: string, base: string, png: Buffer, video: Buffer, payload: Buffer, mode: string, options: PrivateStorageOptions;
const requests: { method: string; authorized: boolean }[] = [];
let bodyStarted: (() => void) | undefined;
const server = createServer((req, res) => {
  requests.push({ method: req.method || "", authorized: req.headers.apikey === key && req.headers.authorization === `Bearer ${key}` });
  const late = (fn: () => void) => { const timer = setTimeout(fn, 1000); res.once("close", () => clearTimeout(timer)); };
  const json = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" });res.end(JSON.stringify(value)); };
  if (mode === "headers-timeout") { late(() => json(200, {}));return; }
  if (req.url === "/storage/v1/bucket/unit-private") {
    if (mode === "bucket-huge") { json(200, { id: "unit-private", public: false, extra: "x".repeat(70000) });return; }
    json(200, { id: "unit-private", name: "unit-private", public: mode === "public" });return;
  }
  if (!req.url?.startsWith("/storage/v1/object/unit-private/")) { json(404, {});return; }
  if (mode === "404" || mode === "401" || mode === "403") { json(Number(mode), { message: "private server secret must never escape" });return; }
  if (mode === "redirect") { res.writeHead(302, { location: `${base}/credential-leak` });res.end();return; }
  if (mode === "header-lie") { res.writeHead(200, { "content-length": payload.length + 1 });res.end(payload);return; }
  if (mode === "slow-body") { res.writeHead(200, { "content-type": "image/png" });res.write(payload.subarray(0, 1));bodyStarted?.();late(() => res.end(payload.subarray(1)));return; }
  if (mode === "truncated") { res.writeHead(200, { "transfer-encoding": "chunked" });res.end(payload.subarray(0, payload.length - 1));return; }
  if (mode === "oversize") { res.writeHead(200, { "transfer-encoding": "chunked" });res.write(payload);res.end(Buffer.from("extra"));return; }
  if (mode === "mutated") { const changed = Buffer.from(payload);changed[changed.length - 1] ^= 1;res.writeHead(200);res.end(changed);return; }
  if (mode === "disconnect") { res.writeHead(200, { "content-length": payload.length });res.write(payload.subarray(0, 1));res.destroy();return; }
  if (mode === "large") {
    res.writeHead(200, { "transfer-encoding": "chunked" });res.write(payload);const chunk = Buffer.alloc(65536);let left = 128;
    const pump = () => { while (left > 0) { left--;if (!res.write(chunk)) { res.once("drain", pump);return; } }res.end(); };pump();return;
  }
  res.writeHead(200, { "content-type": "application/octet-stream", "transfer-encoding": "chunked" });res.write(payload.subarray(0, 10));res.end(payload.subarray(10));
});
const asset = (mime: OwnedStorageAsset["mime"] = "image/png", bytes: Buffer = payload): OwnedStorageAsset => {
  const value = { ownerId: A.id, id: v7(), sha256: sha(bytes), mime, kind: mime.startsWith("image/") ? "image" as const : "video" as const, sizeBytes: bytes.length };
  return { ...value, objectKey: privateObjectKey(value) };
};
beforeAll(async () => {
  const parent = await realpath(resolve("tmp"));root = await mkdtemp(join(parent, "b14-private-"));
  png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
  await promisify(execFile)(resolve(".tools/ffmpeg/ffmpeg.exe"), ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=16x16:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(root, "synthetic.mp4")], { windowsHide: true, timeout: 10000 });
  video = await readFile(join(root, "synthetic.mp4"));
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));const address = server.address();if (!address || typeof address === "string") throw new Error("Loopback listener required");base = `http://127.0.0.1:${address.port}`;
  options = { profile: "synthetic", projectUrl: base, projectRef: "abcdefghijklmnopqrst", bucket: "unit-private", privateBucket: true, credential: { mode: "service-role", key },
    maxBytes: 2 * 1024 * 1024, timeoutMs: 1500, maxConcurrent: 2, workRoot: root, ffprobePath: resolve(".tools/ffmpeg/ffprobe.exe") };
});
beforeEach(() => { mode = "ok";payload = png;requests.length = 0;bodyStarted = undefined; });
afterAll(async () => {
  server.closeAllConnections();await new Promise<void>(done => server.close(() => done()));
  const actual = await realpath(root);if (dirname(actual) !== await realpath(resolve("tmp"))) throw new Error("Owned cleanup boundary failed");await rm(actual, { recursive: true });
});
const clean = async () => expect((await readdir(root)).filter(n => n.startsWith("dream-verify-"))).toEqual([]);

describe("B14 real SDK / HTTP / streamed private-object verification", () => {
  it("streams actual PNG bytes through installed SDK without Blob buffering", async () => {
    const spy = vi.spyOn(Response.prototype, "blob").mockImplementation(() => { throw new Error("Blob buffering forbidden"); });
    try { const item = asset();expect(await createPrivateObjectReader(options).verify(A, item)).toEqual({ kind: "image", mime: "image/png", sha256: item.sha256, sizeBytes: png.length }); }
    finally { spy.mockRestore(); }
    expect(requests).toHaveLength(2);expect(requests.every(r => r.method === "GET" && r.authorized)).toBe(true);await clean();
  });
  it("verifies actual video MIME and playback metadata with explicit ffprobe", async () => {
    payload = video;expect(await createPrivateObjectReader(options).verify(A, asset("video/mp4"))).toMatchObject({ kind: "video", mime: "video/mp4" });await clean();
  });
  it.each(["../x", "%2e%2e/x", "%252e%252e/x", "https://example.invalid/x", "/absolute", "x\\y", "x//y", "x?bucket=other"])("rejects noncanonical key before network (%s)", async objectKey => {
    await expect(createPrivateObjectReader(options).verify(A, { ...asset(), objectKey })).rejects.toMatchObject({ code: "STORAGE_INPUT" });expect(requests).toEqual([]);await clean();
  });
  it.each(["owner", "id", "hash", "mime", "size", "kind", "bucket-field", "unverified"])("rejects invalid ownership/metadata before network (%s)", async type => {
    const value: Record<string, unknown> = { ...asset() };let actor = A;
    if (type === "owner") value.ownerId = B;
    if (type === "id") value.id = v7();
    if (type === "hash") value.sha256 = "b".repeat(64);
    if (type === "mime") value.mime = null;
    if (type === "size") value.sizeBytes = options.maxBytes + 1;
    if (type === "kind") value.kind = "video";
    if (type === "bucket-field") value.bucket = "other";
    if (type === "unverified") actor = { id: A.id } as VerifiedActor;
    await expect(createPrivateObjectReader(options).verify(actor, value)).rejects.toHaveProperty("code");expect(requests).toEqual([]);await clean();
  });
  it.each(["404", "401", "403", "public", "bucket-huge", "redirect", "header-lie", "truncated", "oversize", "mutated", "disconnect"])("fails closed and cleans owned resources (%s)", async failureMode => {
    mode = failureMode;
    try { await createPrivateObjectReader(options).verify(A, asset());throw new Error("Expected rejection"); }
    catch (error) { expect(error).toHaveProperty("code");expect(String(error)).not.toContain("private server secret");expect(String(error)).not.toContain(key); }
    expect(requests.length).toBeLessThanOrEqual(2);await clean();
  });
  it("ignores claimed HTTP MIME and detects actual bytes/type plus image corruption", async () => {
    for (const [bytes, mime] of [[Buffer.alloc(100, 65), "image/png"], [png, "image/jpeg"], [png.subarray(0, 24), "image/png"]] as const) {
      payload = bytes;await expect(createPrivateObjectReader(options).verify(A, asset(mime))).rejects.toMatchObject({ code: "STORAGE_TYPE" });await clean();
    }
  });
  it("refuses an image beyond the existing 40M-pixel limit", async () => {
    payload = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "black" } }).png().toBuffer();
    await expect(createPrivateObjectReader({ ...options, timeoutMs: 5000 }).verify(A, asset())).rejects.toMatchObject({ code: "STORAGE_TYPE" });await clean();
  });
  it("bounds stalled headers with the operation timeout", async () => {
    mode = "headers-timeout";await expect(createPrivateObjectReader({ ...options, timeoutMs: 50 }).verify(A, asset())).rejects.toMatchObject({ code: "STORAGE_TIMEOUT" });await clean();
  });
  it("streams a multi-megabyte object without calling the SDK Blob path", async () => {
    mode = "large";const item = { ...asset(), sizeBytes: png.length + 128 * 65536 };const hash = createHash("sha256").update(png);
    for (let i = 0; i < 128; i++) hash.update(Buffer.alloc(65536));item.sha256 = hash.digest("hex");item.objectKey = privateObjectKey(item);
    const spy = vi.spyOn(Response.prototype, "blob").mockImplementation(() => { throw new Error("Blob buffering forbidden"); });
    try { expect(await createPrivateObjectReader({ ...options, maxBytes: 16 * 1024 * 1024, timeoutMs: 5000 }).verify(A, item)).toMatchObject({ sizeBytes: item.sizeBytes, sha256: item.sha256 }); }
    finally { spy.mockRestore(); }await clean();
  });
  it("isolates concurrent reads when one caller cancels", async () => {
    mode = "slow-body";let starts = 0;const both = new Promise<void>(done => { bodyStarted = () => { if (++starts === 2) done(); }; });
    const controller = new AbortController(), reader = createPrivateObjectReader({ ...options, timeoutMs: 3000 });
    const canceled = reader.verify(A, asset(), controller.signal), kept = reader.verify(A, asset());void canceled.catch(() => {});void kept.catch(() => {});
    await both;controller.abort();await expect(canceled).rejects.toMatchObject({ code: "STORAGE_ABORTED" });expect(await kept).toMatchObject({ mime: "image/png" });await clean();
  });
  it("handles pre-abort without network and mid-stream abort with cleanup", async () => {
    const before = new AbortController();before.abort();await expect(createPrivateObjectReader(options).verify(A, asset(), before.signal)).rejects.toMatchObject({ code: "STORAGE_ABORTED" });expect(requests).toEqual([]);
    mode = "slow-body";const controller = new AbortController(), started = new Promise<void>(done => { bodyStarted = done; });
    const pending = createPrivateObjectReader(options).verify(A, asset(), controller.signal);void pending.catch(() => {});await started;controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "STORAGE_ABORTED" });await clean();
  });
  it("snapshots asset/config input while a download is in flight", async () => {
    mode = "slow-body";const value = { ...asset() }, original = value.sha256, mutable = { ...options, credential: { ...options.credential } };
    const started = new Promise<void>(done => { bodyStarted = done; });const pending = createPrivateObjectReader(mutable).verify(A, value);void pending.catch(() => {});await started;
    value.ownerId = B;value.objectKey = "bad";value.sha256 = "b".repeat(64);mutable.credential.key = "changed-credential";
    expect(await pending).toMatchObject({ sha256: original });expect(requests.every(r => r.authorized)).toBe(true);await clean();
  });
  it("availability distinguishes absent/corrupt objects from authentication failure", async () => {
    const check = postgresAssetAvailability(createPrivateObjectReader(options));
    const before = requests.length;expect(await check({ ...asset(), ownerId: B }, A)).toBe(false);expect(await check({ ...asset(), mime: null }, A)).toBe(false);expect(requests).toHaveLength(before);
    expect(await check(asset(), A)).toBe(true);mode = "404";expect(await check(asset(), A)).toBe(false);mode = "mutated";expect(await check(asset(), A)).toBe(false);
    mode = "401";await expect(check(asset(), A)).rejects.toMatchObject({ code: "STORAGE_AUTH" });await clean();
  });
  it("bounds active operations without an unbounded waiting queue", async () => {
    mode = "slow-body";const controller = new AbortController(), reader = createPrivateObjectReader({ ...options, maxConcurrent: 1 });
    const started = new Promise<void>(done => { bodyStarted = done; });const pending = reader.verify(A, asset(), controller.signal);void pending.catch(() => {});await started;
    const before = requests.length;await expect(reader.verify(A, asset())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });expect(requests).toHaveLength(before);
    controller.abort();await expect(pending).rejects.toMatchObject({ code: "STORAGE_ABORTED" });mode = "ok";expect(await reader.verify(A, asset())).toMatchObject({ kind: "image" });await clean();
  });
  it.each(["profile", "bucket", "endpoint", "private", "credential", "workRoot"])("rejects invalid explicit server config (%s)", type => {
    const change = type === "profile" ? { profile: "implicit" } : type === "bucket" ? { bucket: "../other" } : type === "endpoint" ? { projectUrl: base + "/?token=x" } : type === "private" ? { privateBucket: false } : type === "credential" ? { credential: { mode: "service-role", key: "bad\r\nheader" } } : { workRoot: "relative" };
    expect(() => privateStorageConfig({ ...options, ...change } as PrivateStorageOptions)).toThrow("STORAGE_CONFIG");expect(requests).toEqual([]);
  });
  it("takes one primitive config snapshot before validation and connection", async () => {
    let reads = 0;const source = { ...options, get projectUrl() { reads++;return reads === 1 ? base : "https://changed.invalid"; } };
    expect(await createPrivateObjectReader(source).verify(A, asset())).toMatchObject({ kind: "image" });expect(reads).toBe(1);await clean();
  });
  it("sanitizes throwing metadata getters and rejects non-signal input before network", async () => {
    const value = { ...asset(), get objectKey(): string { throw new Error(key); } };
    await expect(createPrivateObjectReader(options).verify(A, value)).rejects.toMatchObject({ code: "STORAGE_INPUT", message: "STORAGE_INPUT" });
    await expect(createPrivateObjectReader(options).verify(A, asset(), {} as AbortSignal)).rejects.toMatchObject({ code: "STORAGE_INPUT" });expect(requests).toEqual([]);await clean();
  });
});
