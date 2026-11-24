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
import { protocolDigest } from "@/lib/storage/uploads/receipt";
import { reverifyCommand, type ReverifyDecision } from "@/lib/storage/uploads/reverify";
import type { UploadCommand, UploadModel } from "@/lib/storage/uploads/schema";
import { reserveUpload, transition } from "@/lib/storage/uploads/state";
import { prepareReverifyRead } from "@/lib/storage/supabase/reverify-read";
import { attemptReverify } from "@/lib/storage/supabase/reverify-attempt";
vi.mock("server-only", () => ({}));
const A = actorFromVerifiedUserId("00000000-0000-4000-8000-000000000001"), B = "00000000-0000-4000-8000-000000000002";
const key = "unit-only-service-credential", sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let root: string, base: string, png: Buffer, video: Buffer, payload: Buffer, mode: string, options: PrivateStorageOptions;
const requests: { method: string; authorized: boolean; url: string }[] = [];
let bodyStarted: (() => void) | undefined;
const server = createServer((req, res) => {
  requests.push({ method: req.method || "", authorized: req.headers.apikey === key && req.headers.authorization === `Bearer ${key}`, url: req.url || "" });
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
// Internal registered-object observation: same owner/key checks, private bucket, bounded streamed download and cleanup as
// verify; the result carries the measured bytes and the media actually decoded from them.
describe("registered-object observation over the same private-object download", () => {
  it("observes a registered PNG: measured bytes, detected format, mediaSchema size", async () => {
    const item = asset();
    expect(await createPrivateObjectReader(options).observeRegistered(A, item)).toEqual({
      bytes: { sizeBytes: png.length, sha256: item.sha256 }, format: { mime: "image/png", kind: "image" }, media: { width: 2, height: 2, durationMs: null } });
    expect(requests).toHaveLength(2);expect(requests.every(r => r.method === "GET" && r.authorized)).toBe(true);await clean();
  });
  it("observes a registered video with a positive millisecond duration", async () => {
    payload = video;const observed = await createPrivateObjectReader(options).observeRegistered(A, asset("video/mp4"));
    expect(observed.format).toEqual({ mime: "video/mp4", kind: "video" });
    expect(observed.media).toMatchObject({ width: 16, height: 16 });expect(observed.media?.durationMs).toBeGreaterThan(0);
    expect(observed.bytes).toEqual({ sizeBytes: video.length, sha256: sha(video) });await clean();
  });
  it("reports, rather than refuses, bytes that differ from the registered size/hash/type (verify still refuses them)", async () => {
    const registered = asset(), other = await sharp({ create: { width: 3, height: 5, channels: 3, background: "#654321" } }).jpeg().toBuffer();
    payload = other;
    expect(await createPrivateObjectReader(options).observeRegistered(A, registered)).toEqual({
      bytes: { sizeBytes: other.length, sha256: sha(other) }, format: { mime: "image/jpeg", kind: "image" }, media: { width: 3, height: 5, durationMs: null } });
    await expect(createPrivateObjectReader(options).verify(A, registered)).rejects.toHaveProperty("code");await clean();
    payload = Buffer.alloc(100, 65);
    expect(await createPrivateObjectReader(options).observeRegistered(A, registered)).toEqual({
      bytes: { sizeBytes: 100, sha256: sha(payload) }, format: null, media: null });await clean();
  });
  it.each(["../x", "%2e%2e/x", "https://example.invalid/x", "x?bucket=other", "incoming"])("refuses a non-canonical or temporary-upload key before network (%s)", async objectKey => {
    const value = asset();
    const key = objectKey === "incoming" ? `${A.id}/incoming/${value.id}/nonce` : objectKey;
    await expect(createPrivateObjectReader(options).observeRegistered(A, { ...value, objectKey: key })).rejects.toMatchObject({ code: "STORAGE_INPUT" });
    expect(requests).toEqual([]);await clean();
  });
  it.each(["owner", "id", "hash", "mime", "size", "kind", "unverified"])("refuses invalid ownership/metadata before network (%s)", async type => {
    const value: Record<string, unknown> = { ...asset() };let actor = A;
    if (type === "owner") value.ownerId = B;
    if (type === "id") value.id = v7();
    if (type === "hash") value.sha256 = "b".repeat(64);
    if (type === "mime") value.mime = null;
    if (type === "size") value.sizeBytes = options.maxBytes + 1;
    if (type === "kind") value.kind = "video";
    if (type === "unverified") actor = { id: A.id } as VerifiedActor;
    await expect(createPrivateObjectReader(options).observeRegistered(actor, value)).rejects.toHaveProperty("code");expect(requests).toEqual([]);await clean();
  });
  it("reports a cleanly ended shorter body as measured bytes (verify refuses it)", async () => {
    mode = "truncated";const item = asset(), short = png.subarray(0, png.length - 1);
    const observed = await createPrivateObjectReader(options).observeRegistered(A, item);
    expect(observed.bytes).toEqual({ sizeBytes: short.length, sha256: sha(short) });expect(observed.bytes.sha256).not.toBe(item.sha256);
    // The decoder still reads this 1-byte-short PNG (same decode policy as verify); the measured bytes expose the difference.
    expect({ format: observed.format, media: observed.media }).toEqual({ format: { mime: "image/png", kind: "image" }, media: { width: 2, height: 2, durationMs: null } });
    await expect(createPrivateObjectReader(options).verify(A, item)).rejects.toMatchObject({ code: "STORAGE_INTEGRITY" });await clean();
  });
  it.each(["404", "401", "403", "public", "bucket-huge", "redirect", "header-lie", "disconnect"])("fails closed and cleans owned resources (%s)", async failureMode => {
    mode = failureMode;
    try { await createPrivateObjectReader(options).observeRegistered(A, asset());throw new Error("Expected rejection"); }
    catch (error) { expect(error).toHaveProperty("code");expect(String(error)).not.toContain("private server secret");expect(String(error)).not.toContain(key); }
    expect(requests.length).toBeLessThanOrEqual(2);await clean();
  });
  it("keeps the configured maxBytes bound on the measured download", async () => {
    mode = "oversize";
    await expect(createPrivateObjectReader({ ...options, maxBytes: png.length + 2 }).observeRegistered(A, asset())).rejects.toMatchObject({ code: "STORAGE_LIMIT" });await clean();
  });
  it("keeps abort, timeout and the shared concurrency bound", async () => {
    const before = new AbortController();before.abort();
    await expect(createPrivateObjectReader(options).observeRegistered(A, asset(), before.signal)).rejects.toMatchObject({ code: "STORAGE_ABORTED" });expect(requests).toEqual([]);
    mode = "slow-body";const controller = new AbortController(), started = new Promise<void>(done => { bodyStarted = done; });
    const reader = createPrivateObjectReader({ ...options, maxConcurrent: 1 });
    const pending = reader.observeRegistered(A, asset(), controller.signal);void pending.catch(() => {});await started;
    await expect(reader.verify(A, asset())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    controller.abort();await expect(pending).rejects.toMatchObject({ code: "STORAGE_ABORTED" });await clean();
    mode = "headers-timeout";
    await expect(createPrivateObjectReader({ ...options, timeoutMs: 50 }).observeRegistered(A, asset())).rejects.toMatchObject({ code: "STORAGE_TIMEOUT" });await clean();
  });
});
// Reserved-upload original (0005 incoming key) observation: server-checked owner/object/intent key in the one configured
// private bucket, providerVersion null only, measured from one download bounded by min(reservation, config) maxBytes.
describe("reserved-upload original observation over the same private-object download", () => {
  const reservation = (owner = A.id, maxBytes = 1024 * 1024) => {
    const objectId = v7(), intentId = v7();
    return { ownerId: owner, objectId, intentId, maxBytes, source: { bucket: "unit-private", key: `${owner}/incoming/${objectId}/${intentId}`, providerVersion: null } };
  };
  it("observes the reserved original PNG at its exact incoming key", async () => {
    const value = reservation();
    expect(await createPrivateObjectReader(options).observeIncoming(A, value)).toEqual({ source: value.source,
      bytes: { sizeBytes: png.length, sha256: sha(png) }, format: { mime: "image/png", kind: "image" }, media: { width: 2, height: 2, durationMs: null } });
    expect(requests.map(r => [r.method, r.authorized, r.url])).toEqual([["GET", true, "/storage/v1/bucket/unit-private"],
      ["GET", true, `/storage/v1/object/unit-private/${value.source.key}`]]);await clean();
  });
  it("observes a reserved video and reports undecodable bytes as null format/media", async () => {
    payload = video;const observed = await createPrivateObjectReader(options).observeIncoming(A, reservation());
    expect(observed.format).toEqual({ mime: "video/mp4", kind: "video" });expect(observed.media).toMatchObject({ width: 16, height: 16 });
    expect(observed.bytes).toEqual({ sizeBytes: video.length, sha256: sha(video) });await clean();
    payload = Buffer.alloc(100, 65);
    expect(await createPrivateObjectReader(options).observeIncoming(A, reservation())).toMatchObject({ bytes: { sizeBytes: 100, sha256: sha(payload) }, format: null, media: null });
    await clean();
  });
  it.each([
    ["other owner", () => reservation(B), "STORAGE_OWNER"],
    ["owner/key mismatch", () => ({ ...reservation(), ownerId: B }), "STORAGE_OWNER"],
    ["other bucket", () => { const v = reservation();return { ...v, source: { ...v.source, bucket: "other-private" } }; }, "STORAGE_INPUT"],
    ["claimed provider version", () => { const v = reservation();return { ...v, source: { ...v.source, providerVersion: "v1" } }; }, "STORAGE_INPUT"],
    ["empty provider version", () => { const v = reservation();return { ...v, source: { ...v.source, providerVersion: "" } }; }, "STORAGE_INPUT"],
    ["missing provider version", () => { const v = reservation();return { ...v, source: { bucket: v.source.bucket, key: v.source.key } }; }, "STORAGE_INPUT"],
    ["other object id in key", () => { const v = reservation();return { ...v, source: { ...v.source, key: `${A.id}/incoming/${v7()}/${v.intentId}` } }; }, "STORAGE_INPUT"],
    ["registered-asset key", () => { const v = reservation(), item = asset();return { ...v, source: { ...v.source, key: item.objectKey } }; }, "STORAGE_INPUT"],
    ["uppercase key", () => { const v = reservation();return { ...v, source: { ...v.source, key: v.source.key.toUpperCase() } }; }, "STORAGE_INPUT"],
    ["trailing segment", () => { const v = reservation();return { ...v, source: { ...v.source, key: v.source.key + "/x" } }; }, "STORAGE_INPUT"],
    ["traversal", () => { const v = reservation();return { ...v, source: { ...v.source, key: `${A.id}/incoming/../assets/${v.objectId}` } }; }, "STORAGE_INPUT"],
    ["non-v7 ids", () => { const v = reservation(), objectId = "11111111-1111-4111-8111-111111111111";
      return { ...v, objectId, source: { ...v.source, key: `${A.id}/incoming/${objectId}/${v.intentId}` } }; }, "STORAGE_INPUT"],
    ["zero bound", () => ({ ...reservation(), maxBytes: 0 }), "STORAGE_INPUT"],
    ["fractional bound", () => ({ ...reservation(), maxBytes: 10.5 }), "STORAGE_INPUT"],
    ["extra field", () => ({ ...reservation(), sha256: "a".repeat(64) }), "STORAGE_INPUT"],
  ] as const)("refuses %s before network", async (_label, make, code) => {
    await expect(createPrivateObjectReader(options).observeIncoming(A, make())).rejects.toMatchObject({ code });expect(requests).toEqual([]);await clean();
  });
  it("refuses an unverified actor before network", async () => {
    await expect(createPrivateObjectReader(options).observeIncoming({ id: A.id } as VerifiedActor, reservation())).rejects.toMatchObject({ code: "STORAGE_OWNER" });
    expect(requests).toEqual([]);
  });
  it("bounds the download by the smaller of the reservation and configured maxBytes", async () => {
    await expect(createPrivateObjectReader(options).observeIncoming(A, reservation(A.id, png.length - 1))).rejects.toMatchObject({ code: "STORAGE_LIMIT" });await clean();
    mode = "oversize";
    await expect(createPrivateObjectReader({ ...options, maxBytes: png.length + 2 }).observeIncoming(A, reservation(A.id, 1024 * 1024))).rejects.toMatchObject({ code: "STORAGE_LIMIT" });await clean();
    mode = "ok";
    expect((await createPrivateObjectReader(options).observeIncoming(A, reservation(A.id, png.length))).bytes.sizeBytes).toBe(png.length);await clean();
  });
  it.each(["404", "401", "403", "public", "bucket-huge", "redirect", "header-lie", "disconnect"])("fails closed and cleans owned resources (%s)", async failureMode => {
    mode = failureMode;
    try { await createPrivateObjectReader(options).observeIncoming(A, reservation());throw new Error("Expected rejection"); }
    catch (error) { expect(error).toHaveProperty("code");expect(String(error)).not.toContain("private server secret");expect(String(error)).not.toContain(key); }
    expect(requests.length).toBeLessThanOrEqual(2);await clean();
  });
  it("keeps abort, timeout and the shared concurrency bound", async () => {
    const before = new AbortController();before.abort();
    await expect(createPrivateObjectReader(options).observeIncoming(A, reservation(), before.signal)).rejects.toMatchObject({ code: "STORAGE_ABORTED" });expect(requests).toEqual([]);
    mode = "slow-body";const controller = new AbortController(), started = new Promise<void>(done => { bodyStarted = done; });
    const reader = createPrivateObjectReader({ ...options, maxConcurrent: 1 });
    const pending = reader.observeIncoming(A, reservation(), controller.signal);void pending.catch(() => {});await started;
    await expect(reader.observeRegistered(A, asset())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    controller.abort();await expect(pending).rejects.toMatchObject({ code: "STORAGE_ABORTED" });await clean();
    mode = "headers-timeout";
    await expect(createPrivateObjectReader({ ...options, timeoutMs: 50 }).observeIncoming(A, reservation())).rejects.toMatchObject({ code: "STORAGE_TIMEOUT" });await clean();
  });
});
describe("registered-source observation and reverify read preparation over the same private-object download", () => {
  const pid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
  const W = pid(2), fpr = protocolDigest("operation", { input: "sample" }), first = pid(10), op = pid(11);
  const incomingSource = { bucket: "unit-incoming", key: `${A.id}/incoming/${pid(8)}/nonce`, providerVersion: null };
  const sourceOf = (item: OwnedStorageAsset) => ({ bucket: "unit-private", key: item.objectKey, providerVersion: null });
  // A standard synthetic upload model registered for real loopback bytes, with a claimed pending reverify (worker W, fence 1).
  function registeredModel(item: OwnedStorageAsset, patch: { bucket?: string; providerVersion?: string | null } = {}) {
    const identity = { ownerId: A.id, assetId: item.id, bucket: patch.bucket ?? "unit-private", sha256: item.sha256, sizeBytes: item.sizeBytes, mime: item.mime,
      kind: item.kind, key: item.objectKey, providerVersion: patch.providerVersion ?? null };
    const step = (s: UploadModel, c: UploadCommand, who: string, now: number) => transition(s, c, { principalId: who, now, expectedRevision: s.revision });
    let s = reserveUpload({ ownerId: A.id, objectId: pid(6), assetId: item.id, intentId: pid(8), intentExpiresAt: 100, issueEnvelopeUntil: 10, maxIssues: 2,
      verifiers: [W], collectors: [pid(3)], policyManagers: [pid(4)], policyEpoch: 1, policyDigest: "c".repeat(64), incoming: incomingSource },
      { principalId: A.id, now: 0, expectedRevision: 0 });
    s = step(s, { type: "complete", operationId: first, kind: "initial", authorizationUntil: 90, fingerprint: fpr }, A.id, 1);
    s = step(s, { type: "claim", operationId: first, fingerprint: fpr, expectedFence: 0, leaseUntil: 80 }, W, 1);
    s = step(s, { type: "reservePublication", operationId: first, fingerprint: fpr, expectedFence: 1, identity }, W, 1);
    s = step(s, { type: "finalize", operationId: first, fingerprint: fpr, expectedFence: 1, receiptId: pid(12), identity, source: incomingSource,
      media: { width: 2, height: 2, durationMs: null }, notAfter: 20, verifierVersion: "verifier-v1", toolVersion: "probe-v1",
      observation: { v: 1, kind: "initial", source: incomingSource, bytes: { sha256: item.sha256, sizeBytes: item.sizeBytes }, format: { mime: item.mime, kind: item.kind },
        media: { width: 2, height: 2, durationMs: null }, published: { sha256: item.sha256, sizeBytes: item.sizeBytes }, tools: { verifierVersion: "verifier-v1", toolVersion: "probe-v1" } } }, W, 1);
    s = step(s, { type: "complete", operationId: op, kind: "reverify", authorizationUntil: 200, fingerprint: fpr }, A.id, 2);
    return step(s, { type: "claim", operationId: op, fingerprint: fpr, expectedFence: 0, leaseUntil: 150 }, W, 2);
  }
  const decide = (s: UploadModel, read: unknown) => reverifyCommand(s, { operationId: op, fingerprint: fpr, expectedFence: 1, receiptId: pid(13), notAfter: 190,
    verifierVersion: "verifier-v1", toolVersion: "probe-v1", read }, { principalId: W, now: 3, expectedRevision: s.revision });

  it("returns the configured bucket and canonical key it read with the measurement of that one download", async () => {
    const item = asset();
    expect(await createPrivateObjectReader(options).observeRegisteredSource(A, { asset: item, source: sourceOf(item) })).toEqual({ source: sourceOf(item),
      bytes: { sizeBytes: png.length, sha256: item.sha256 }, format: { mime: "image/png", kind: "image" }, media: { width: 2, height: 2, durationMs: null } });
    expect(requests.map(r => [r.method, r.authorized, r.url])).toEqual([["GET", true, "/storage/v1/bucket/unit-private"],
      ["GET", true, `/storage/v1/object/unit-private/${item.objectKey}`]]);await clean();
  });
  it.each([
    ["other bucket", (item: OwnedStorageAsset) => ({ asset: item, source: { ...sourceOf(item), bucket: "other-private" } }), "STORAGE_INPUT"],
    ["other asset key", (item: OwnedStorageAsset) => ({ asset: item, source: { ...sourceOf(item), key: asset().objectKey } }), "STORAGE_INPUT"],
    ["incoming key", (item: OwnedStorageAsset) => ({ asset: item, source: { ...sourceOf(item), key: incomingSource.key } }), "STORAGE_INPUT"],
    ["claimed provider version", (item: OwnedStorageAsset) => ({ asset: item, source: { ...sourceOf(item), providerVersion: "v1" } }), "STORAGE_INPUT"],
    ["missing provider version", (item: OwnedStorageAsset) => ({ asset: item, source: { bucket: "unit-private", key: item.objectKey } }), "STORAGE_INPUT"],
    ["missing source", (item: OwnedStorageAsset) => ({ asset: item }), "STORAGE_INPUT"],
    ["extra field", (item: OwnedStorageAsset) => ({ asset: item, source: sourceOf(item), url: "x" }), "STORAGE_INPUT"],
    ["noncanonical asset key", (item: OwnedStorageAsset) => ({ asset: { ...item, objectKey: item.objectKey.toUpperCase() }, source: { ...sourceOf(item), key: item.objectKey.toUpperCase() } }), "STORAGE_INPUT"],
    ["other owner", (item: OwnedStorageAsset) => ({ asset: { ...item, ownerId: B }, source: sourceOf(item) }), "STORAGE_OWNER"],
    ["bare asset", (item: OwnedStorageAsset) => item, "STORAGE_INPUT"],
  ] as const)("refuses %s before network", async (_label, make, code) => {
    await expect(createPrivateObjectReader(options).observeRegisteredSource(A, make(asset()))).rejects.toMatchObject({ code });expect(requests).toEqual([]);await clean();
  });
  it("refuses an unverified actor before network", async () => {
    const item = asset();
    await expect(createPrivateObjectReader(options).observeRegisteredSource({ id: A.id } as VerifiedActor, { asset: item, source: sourceOf(item) })).rejects.toMatchObject({ code: "STORAGE_OWNER" });
    expect(requests).toEqual([]);
  });
  it("binds a real download to the existing finalize and the receipt names the registered source", async () => {
    const item = asset(), s = registeredModel(item), prepared = await prepareReverifyRead(createPrivateObjectReader(options), A, s, op);await clean();
    expect(prepared).toEqual({ read: { status: "observed", source: sourceOf(item), bytes: { sizeBytes: png.length, sha256: item.sha256 },
      format: { mime: "image/png", kind: "image" }, media: { width: 2, height: 2, durationMs: null } }, transientCode: null });
    const decision = decide(s, prepared.read);
    expect(decision.action).toBe("finalize");
    const issued = transition(s, (decision as Extract<ReverifyDecision, { action: "finalize" }>).command, { principalId: W, now: 3, expectedRevision: s.revision });
    expect(issued.currentReceiptId).toBe(pid(13));expect(issued.receipts.at(-1)?.body.source).toEqual(sourceOf(item));
  });
  it("binds a real changed download to the existing failure code", async () => {
    const item = asset(), s = registeredModel(item);mode = "mutated";
    const prepared = await prepareReverifyRead(createPrivateObjectReader(options), A, s, op);await clean();
    expect(prepared.read).toMatchObject({ status: "observed", bytes: { sizeBytes: png.length } });
    expect(decide(s, prepared.read)).toMatchObject({ action: "rejectVerification", command: { failureCode: "HASH_MISMATCH", observation: { source: sourceOf(item) } } });
  });
  it.each([["404", "STORAGE_NOT_FOUND"], ["header-lie", "STORAGE_TIMEOUT"], ["disconnect", null]] as const)(
    "retries storage %s without a receipt or a permanent failure", async (failureMode, code) => {
      const s = registeredModel(asset());mode = failureMode;
      const prepared = await prepareReverifyRead(createPrivateObjectReader(options), A, s, op);await clean();
      expect(prepared.read).toEqual({ status: "unavailable" });
      if (code) expect(prepared.transientCode).toBe(code);else expect(["STORAGE_UNAVAILABLE", "STORAGE_INTEGRITY"]).toContain(prepared.transientCode);
      expect(decide(s, prepared.read)).toEqual({ action: "none", reason: "TRANSIENT_READ" });
    });
  it.each([["401", "STORAGE_AUTH"], ["403", "STORAGE_AUTH"], ["public", "STORAGE_PRIVATE"]] as const)("does not retry %s", async (failureMode, code) => {
    const s = registeredModel(asset());mode = failureMode;
    await expect(prepareReverifyRead(createPrivateObjectReader(options), A, s, op)).rejects.toMatchObject({ code });await clean();
  });
  it("refuses an unprovable version, another bucket or another owner before any request", async () => {
    for (const [model, actor] of [[registeredModel(asset(), { providerVersion: "v1" }), A], [registeredModel(asset(), { bucket: "unit-final" }), A],
      [registeredModel(asset()), actorFromVerifiedUserId(B)]] as const)
      await expect(prepareReverifyRead(createPrivateObjectReader(options), actor, model, op)).rejects.toMatchObject({ code: expect.stringMatching(/^STORAGE_(INPUT|OWNER)$/) });
    expect(requests).toEqual([]);await clean();
  });
  it("keeps caller abort as an error, not a retry", async () => {
    const before = new AbortController();before.abort();
    await expect(prepareReverifyRead(createPrivateObjectReader(options), A, registeredModel(asset()), op, before.signal)).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    expect(requests).toEqual([]);
  });
  it("runs one worker attempt over a real download: command, retry, exhaustion, no retry for auth, and IO-free expiry", async () => {
    const item = asset(), s = registeredModel(item);
    const run = (retry: { attempt: number; maxAttempts: number; retryUntil: number }, now = 3) => attemptReverify({ reader: createPrivateObjectReader(options), actor: A,
      load: async () => s, now: () => now, request: { principalId: W, operationId: op, fingerprint: fpr, expectedFence: 1, receiptId: pid(13), notAfter: 190,
        verifierVersion: "verifier-v1", toolVersion: "probe-v1", retry } });
    expect(await run({ attempt: 1, maxAttempts: 2, retryUntil: 100 })).toMatchObject({ outcome: "command", decision: { action: "finalize", command: { source: sourceOf(item) } } });
    await clean();mode = "404";
    expect(await run({ attempt: 1, maxAttempts: 2, retryUntil: 100 })).toEqual({ outcome: "retry", transientCode: "STORAGE_NOT_FOUND", nextAttempt: 2, retryUntil: 100 });await clean();
    expect(await run({ attempt: 2, maxAttempts: 2, retryUntil: 100 })).toEqual({ outcome: "exhausted", transientCode: "STORAGE_NOT_FOUND" });await clean();
    mode = "401";
    await expect(run({ attempt: 1, maxAttempts: 2, retryUntil: 100 })).rejects.toMatchObject({ code: "STORAGE_AUTH" });await clean();
    mode = "ok";requests.length = 0;
    await expect(run({ attempt: 1, maxAttempts: 2, retryUntil: 100 }, 150)).rejects.toMatchObject({ code: "EXPIRED" });
    expect(requests).toEqual([]);await clean();
  });
});
