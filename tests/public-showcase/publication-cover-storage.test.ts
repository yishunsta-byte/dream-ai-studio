import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_MAX_BYTES, serveCover, type CoverRow } from "../../lib/public-showcase/cover-source";
import { createPublicationCoverStorageReaders } from "../../lib/public-showcase/publication-cover-storage";
import type { createVerifiedPublicationRuntimeOptions } from "../../lib/public-showcase/publication-verified-adapters";
import { ACTOR_A, ACTOR_B, syntheticCover } from "../admin/publication-http-fixture";

vi.mock("server-only", () => ({}));

const bucket = "publication-covers-private";
const bucketPath = `/storage/v1/bucket/${bucket}`;
const objectPath = `/storage/v1/object/${bucket}/`;
const credential = "t334-synthetic-key-not-for-production";
const providerMessage = "t334-private-provider-response";
type Options = Parameters<typeof createPublicationCoverStorageReaders>[0];
type T332Readers = Pick<NonNullable<Parameters<typeof createVerifiedPublicationRuntimeOptions>[0]>, "readAdminCover" | "readPublicCover">;
let base: string;
let poster: Awaited<ReturnType<typeof syntheticCover>>;
let mode = "ok";
let key: string;
let bodyStarted: (() => void) | undefined;
let bodyClosed: (() => void) | undefined;
const requests: { path: string; method: string; authorized: boolean; identity: boolean }[] = [];
const server = createServer((req, res) => {
  requests.push({ path: req.url ?? "", method: req.method ?? "", authorized: req.headers.apikey === credential &&
    req.headers.authorization === `Bearer ${credential}`, identity: req.headers["accept-encoding"] === "identity" });
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.url === bucketPath) {
    if (mode === "missing-bucket") return json(404, { message: providerMessage });
    if (mode === "oversize-bucket") return json(200, { id: bucket, public: false, extra: "x".repeat(70_000) });
    return json(200, { id: mode === "wrong-bucket" ? "other" : bucket, name: bucket, public: mode === "public" });
  }
  if (!req.url?.startsWith(objectPath)) return json(404, { message: providerMessage });
  if (["404", "403", "500"].includes(mode)) return json(Number(mode), { message: providerMessage });
  if (mode === "redirect") {
    res.writeHead(302, { location: `${base}/redirect-target` });
    res.end();
    return;
  }
  if (mode === "header-limit" || mode === "encoding") {
    res.writeHead(200, { "content-length": poster.bytes.length + 1, "content-encoding": mode === "encoding" ? "gzip" : "identity" });
    res.end(Buffer.concat([poster.bytes, Buffer.of(0)]));
    return;
  }
  if (mode === "stall") {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.once("close", () => bodyClosed?.());
    res.write(poster.bytes.subarray(0, 1));
    bodyStarted?.();
    return;
  }
  const bytes = Buffer.from(poster.bytes);
  if (mode === "changed-bytes") bytes[bytes.length - 1] ^= 1;
  res.writeHead(200, { "content-type": "application/octet-stream", "transfer-encoding": "chunked" });
  res.write(bytes.subarray(0, 8));
  res.end(mode === "chunk-limit" ? Buffer.concat([bytes.subarray(8), Buffer.of(0)]) : bytes.subarray(8));
});

const config = (changes?: Partial<Options>): Options => ({ profile: "synthetic", projectUrl: base, projectRef: "abcdefghijklmnopqrst",
  credential: { mode: "service-role", key: credential }, adminActorId: ACTOR_A, maxBytes: COVER_MAX_BYTES, timeoutMs: 1500, maxConcurrent: 2, ...changes });
const input = (maxBytes = poster.bytes.length, signal = new AbortController().signal) => ({ maxBytes, signal });
const readers = (changes?: Partial<Options>): T332Readers => createPublicationCoverStorageReaders(config(changes));

beforeAll(async () => {
  poster = await syntheticCover();
  key = `neon-alley/1/${poster.sha}.webp`;
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback listener required");
  base = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { mode = "ok"; requests.length = 0; bodyStarted = undefined; bodyClosed = undefined; });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  expect(server.listening).toBe(false);
});

describe("T334 private publication cover Storage boundary", () => {
  it("streams the fixed private key with the SDK and snapshots the trusted credentials", async () => {
    const mutable = { ...config(), bucket: "caller-bucket", credential: { mode: "service-role" as const, key: credential } };
    const storage = createPublicationCoverStorageReaders(mutable);
    mutable.credential.key = "ignored-mutation-not-a-key";
    const blob = vi.spyOn(Response.prototype, "blob").mockImplementation(() => { throw new Error("Expected streaming"); });
    try {
      expect(Buffer.from(await storage.readPublicCover(key, input()))).toEqual(poster.bytes);
      expect(await storage.readAdminCover(ACTOR_A, key, input(COVER_MAX_BYTES))).toEqual(poster.bytes);
    } finally { blob.mockRestore(); }
    expect(requests.map(request => request.path)).toEqual([bucketPath, objectPath + key, bucketPath, objectPath + key]);
    expect(requests.every(request => request.method === "GET" && request.authorized && request.identity)).toBe(true);
  });

  it("accepts the longest slug and generation without changing the key", async () => {
    const maximal = `${"a".repeat(64)}/9223372036854775807/${poster.sha}.webp`;
    expect(await readers().readPublicCover(maximal, input())).toEqual(poster.bytes);
    expect(requests[1]?.path).toBe(objectPath + maximal);
  });

  it("rejects invalid explicit configuration and request targets before network access", async () => {
    for (const overrides of [{ projectUrl: base + "/anything" }, { projectUrl: "https://example.invalid" }, { adminActorId: "not-an-actor" },
      { maxBytes: COVER_MAX_BYTES + 1 }, { credential: { mode: "service-role" as const, key: "invalid" } }]) {
      expect(() => readers(overrides)).toThrow("STORAGE_CONFIG");
    }
    const storage = readers();
    const hash = poster.sha;
    for (const invalid of ["../" + key, "//" + key, "https://example.invalid/" + key, `neon-alley/01/${hash}.webp`,
      `neon-alley/9223372036854775808/${hash}.webp`, `private/1/${hash}.webp`, key + "\n", key + "?url=1", key.replace("/", "%2f"),
      key.replace("/", "\\"), key.replace(hash, hash.toUpperCase()), key.replace("webp", "jpg"), key.replace("/1", "\n/1")]) {
      await expect(storage.readPublicCover(invalid, input())).rejects.toThrow("STORAGE_INPUT");
    }
    await expect(storage.readAdminCover(ACTOR_B, key, input())).rejects.toThrow("STORAGE_OWNER");
    for (const limit of [0, -1, 1.5, NaN, COVER_MAX_BYTES + 1]) {
      await expect(storage.readPublicCover(key, input(limit))).rejects.toThrow("STORAGE_INPUT");
    }
    const cancelled = new AbortController();
    cancelled.abort(providerMessage);
    await expect(storage.readPublicCover(key, input(poster.bytes.length, cancelled.signal))).rejects.toThrow("STORAGE_ABORTED");
    expect(requests).toEqual([]);
  });

  it.each(["public", "wrong-bucket", "missing-bucket", "oversize-bucket"])("blocks object access for rejected bucket metadata (%s)", async value => {
    mode = value;
    await expect(readers().readAdminCover(ACTOR_A, key, input())).rejects.toHaveProperty("name", "StorageReadError");
    expect(requests.map(request => request.path)).toEqual([bucketPath]);
  });

  it("maps only missing objects to the administrator's null result and hides provider errors", async () => {
    const storage = readers();
    mode = "404";
    expect(await storage.readAdminCover(ACTOR_A, key, input())).toBeNull();
    await expect(storage.readPublicCover(key, input())).rejects.toMatchObject({ code: "STORAGE_NOT_FOUND", message: "STORAGE_NOT_FOUND" });
    for (const [state, code] of [["403", "STORAGE_AUTH"], ["500", "STORAGE_UNAVAILABLE"], ["redirect", "STORAGE_UNAVAILABLE"]]) {
      mode = state;
      const error: unknown = await storage.readAdminCover(ACTOR_A, key, input()).catch((reason: unknown) => reason);
      expect(error).toMatchObject({ code, message: code });
      expect(error).not.toHaveProperty("cause");
    }
    expect(requests.every(request => [bucketPath, objectPath + key].includes(request.path))).toBe(true);
  });

  it.each([["header-limit", "STORAGE_LIMIT"], ["chunk-limit", "STORAGE_LIMIT"], ["encoding", "STORAGE_INTEGRITY"]])(
    "bounds the object even when headers or chunks are unsafe (%s)", async (state, code) => {
      mode = state;
      const storage = readers({ maxBytes: poster.bytes.length });
      await expect(storage.readPublicCover(key, input(COVER_MAX_BYTES))).rejects.toMatchObject({ code, message: code });
      mode = "ok";
      await expect(storage.readPublicCover(key, input(poster.bytes.length - 1))).rejects.toThrow("STORAGE_LIMIT");
      await expect(storage.readPublicCover(key, input())).resolves.toEqual(poster.bytes);
    });

  it("cancels an in-flight stream, rejects overload, and releases the read slot", async () => {
    mode = "stall";
    const started = new Promise<void>(done => { bodyStarted = done; });
    const closed = new Promise<void>(done => { bodyClosed = done; });
    const controller = new AbortController();
    const storage = readers({ maxConcurrent: 1 });
    const read = storage.readPublicCover(key, input(poster.bytes.length, controller.signal));
    const aborted = expect(read).rejects.toThrow("STORAGE_ABORTED");
    await started;
    await expect(storage.readAdminCover(ACTOR_A, key, input())).rejects.toThrow("STORAGE_UNAVAILABLE");
    controller.abort(providerMessage);
    await Promise.all([aborted, closed]);
    mode = "ok";
    await expect(storage.readPublicCover(key, input())).resolves.toEqual(poster.bytes);
  });

  it("times out a stalled stream and closes the response", async () => {
    mode = "stall";
    const closed = new Promise<void>(done => { bodyClosed = done; });
    await expect(readers({ timeoutMs: 400 }).readPublicCover(key, input())).rejects.toThrow("STORAGE_TIMEOUT");
    await closed;
  });

  it("lets the existing cover response reject hash mismatch and final authority loss", async () => {
    const storage = readers();
    const row: CoverRow = { objectKey: key, mime: "image/webp", sizeBytes: poster.bytes.length, sha: poster.sha };
    const confirm = vi.fn(async () => true);
    const source = { mode: "active", store: { findCover: async () => row,
      readObject: (key: string, { signal }: Parameters<T332Readers["readPublicCover"]>[1]) => storage.readPublicCover(key, { maxBytes: row.sizeBytes, signal }),
      confirmCover: confirm } } as const;
    const request = () => new Request("https://test.invalid/media/public/neon-alley/1/cover.webp");
    mode = "changed-bytes";
    const corrupted = await serveCover(request(), source);
    expect(corrupted.status).toBe(503);
    expect(await corrupted.text()).not.toContain(key);
    expect(confirm).not.toHaveBeenCalled();
    mode = "ok";
    confirm.mockResolvedValueOnce(false);
    const denied = await serveCover(request(), source);
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe("");
    const response = await serveCover(request(), source);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(poster.bytes);
  });
});
