import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { mkdtemp, open, realpath, rm, statfs } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { privateStorageConfig, type PrivateStorageOptions } from "./config";
import { ownedStorageAsset, type OwnedStorageAsset } from "./object-key";
import { StorageReadError } from "./errors";
import { verifyStorageMedia } from "./media";

async function smallBody(response: Response, limit = 65536) {
  if (!response.body) throw new StorageReadError("STORAGE_UNAVAILABLE");
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > limit) throw new StorageReadError("STORAGE_LIMIT"); chunks.push(value); }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const httpFailure = (status: number) => new StorageReadError(status === 404 ? "STORAGE_NOT_FOUND" : status === 401 || status === 403 ? "STORAGE_AUTH" : "STORAGE_UNAVAILABLE");
async function cleanupWork(root: string, work: string, handedOff: boolean) {
  let actual: string;
  try { actual = await realpath(work); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new StorageReadError("STORAGE_TEMP");
  }
  if ((handedOff && actual !== work) || dirname(actual) !== root || !basename(actual).startsWith("dream-verify-")) throw new StorageReadError("STORAGE_TEMP");
  await rm(actual, { recursive: true, force: false, ...(handedOff ? { maxRetries: 3, retryDelay: 30 } : {}) })
    .catch(() => { throw new StorageReadError("STORAGE_TEMP"); });
}
export type VerifiedStorageObject = Readonly<Pick<OwnedStorageAsset, "sizeBytes" | "sha256" | "mime" | "kind">>;
type Actor = Parameters<typeof ownedStorageAsset>[0];
export type PrivateObjectReader = Readonly<{ verify: (actor: Actor, asset: unknown, signal?: AbortSignal) => Promise<VerifiedStorageObject> }>;

export type VerifiedStorageFile = Readonly<{ path: string; metadata: VerifiedStorageObject; signal: AbortSignal }>;
type FileConsumer = (file: VerifiedStorageFile) => void | Promise<void>;
export type PrivateObjectReaderWithFile = PrivateObjectReader & Readonly<{
  /** Server-only read of the verified copy. Honor the signal and release any open file resources before returning. */
  useVerifiedFile: (actor: Actor, asset: unknown, consume: FileConsumer, signal?: AbortSignal) => Promise<VerifiedStorageObject>;
}>;

async function consumeVerifiedCopy(path: string, metadata: VerifiedStorageObject, signal: AbortSignal, check: () => void, consume: FileConsumer) {
  check();
  let open = true;
  const lease = Object.freeze(Object.defineProperty({ metadata, signal }, "path", {
    get() {
      if (!open) throw new StorageReadError("STORAGE_UNAVAILABLE");
      check();
      return path;
    },
  })) as VerifiedStorageFile;
  const cancelled = Promise.withResolvers<void>();
  const listener = addAbortListener(signal, () => cancelled.resolve());
  try {
    await Promise.race([cancelled.promise, Promise.resolve().then(() => { check(); return consume(lease); })]);
    check();
  } catch {
    check();
    // Callback errors may contain a private path or provider credentials.
    throw new StorageReadError("STORAGE_UNAVAILABLE");
  } finally {
    open = false;
    listener[Symbol.dispose]();
  }
}

export function createPrivateObjectReader(options: PrivateStorageOptions): PrivateObjectReaderWithFile {
  const config = privateStorageConfig(options), fetchObject = globalThis.fetch;
  let active = 0;
  async function readAndVerify(actor: Actor, input: unknown, signal?: AbortSignal, consume?: FileConsumer) {
      const asset = ownedStorageAsset(actor, input, config.maxBytes); // Before network/SDK/temp work.
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new StorageReadError("STORAGE_INPUT");
      if (signal?.aborted) throw new StorageReadError("STORAGE_ABORTED");
      if (active >= config.maxConcurrent) throw new StorageReadError("STORAGE_UNAVAILABLE");
      active++;
      const controller = new AbortController(), deadline = Date.now() + config.timeoutMs;
      let timedOut = false, work: string | undefined, root: string | undefined;
      let handedOff = false;
      let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
      const check = () => { if (controller.signal.aborted) throw new StorageReadError(timedOut ? "STORAGE_TIMEOUT" : "STORAGE_ABORTED"); };
      try {
        check(); root = await realpath(config.workRoot);
        if (consume && root.split(/[\\/]/).some(part => part.toLowerCase() === "public")) throw new StorageReadError("STORAGE_TEMP");
        const space = await statfs(root);
        if (space.bavail * space.bsize < asset.sizeBytes + 1024 * 1024) throw new StorageReadError("STORAGE_TEMP");
        check(); work = await mkdtemp(join(root, "dream-verify-"));
        const bucketUrl = `${config.projectUrl}/storage/v1/bucket/${config.bucket}`;
        const objectUrl = `${config.projectUrl}/storage/v1/object/${config.bucket}/${asset.objectKey}`;
        let requestFailure: StorageReadError | undefined;
        // Per-call SDK and signal. Only two exact GET targets are permitted;
        // redirects and unbounded SDK JSON/error responses cannot leak credentials.
        const boundedFetch: typeof fetch = async (url, init) => {
          try {
          const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
          if (![bucketUrl, objectUrl].includes(target) || init?.method !== "GET") throw new StorageReadError("STORAGE_INPUT");
          check(); const headers = new Headers(init.headers); headers.set("accept-encoding", "identity");
          const response = await fetchObject(target, { ...init, headers, signal: controller.signal, redirect: "error", cache: "no-store" });
          if (response.status !== 200) { await response.body?.cancel().catch(() => {}); throw httpFailure(response.status); }
          if (target === bucketUrl) return new Response(await smallBody(response), { headers: { "content-type": "application/json" } });
          const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
          if ((length !== null && (!/^\d+$/.test(length) || Number(length) !== asset.sizeBytes || Number(length) > config.maxBytes)) || (encoding && encoding !== "identity")) {
            await response.body?.cancel().catch(() => {}); throw new StorageReadError("STORAGE_INTEGRITY");
          }
          return response;
          } catch (error) { if (error instanceof StorageReadError) requestFailure = error; throw error; }
        };
        const sdk = createClient(config.projectUrl, config.credential.key, { accessToken: async () => config.credential.key,
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch }, storage: { useNewHostname: false } });
        const bucket = await sdk.storage.getBucket(config.bucket); check();
        if (requestFailure) throw requestFailure;
        if (bucket.error) throw new StorageReadError("STORAGE_UNAVAILABLE");
        if (bucket.data?.id !== config.bucket || bucket.data.public !== false) throw new StorageReadError("STORAGE_PRIVATE");
        const download = await sdk.storage.from(config.bucket).download(asset.objectKey, {}, { signal: controller.signal, cache: "no-store" }).asStream(); check();
        if (requestFailure) throw requestFailure;
        if (download.error || !download.data) throw new StorageReadError("STORAGE_UNAVAILABLE");
        stream = (download.data as ReadableStream<Uint8Array>).getReader();
        const path = join(work, "object"); file = await open(path, "wx", 0o600);
        const hash = createHash("sha256"); let count = 0;
        while (true) {
          check(); const { value, done } = await stream.read(); if (done) break;
          if (!(value instanceof Uint8Array)) throw new StorageReadError("STORAGE_INTEGRITY");
          count += value.byteLength;
          if (count > config.maxBytes || count > asset.sizeBytes) throw new StorageReadError("STORAGE_LIMIT");
          hash.update(value); await file.writeFile(value);
        }
        await file.close(); file = undefined; check();
        if (count !== asset.sizeBytes || hash.digest("hex") !== asset.sha256) throw new StorageReadError("STORAGE_INTEGRITY");
        await verifyStorageMedia(path, asset, config.ffprobePath, controller.signal, deadline); check();
        const metadata = Object.freeze({ sizeBytes: count, sha256: asset.sha256, mime: asset.mime, kind: asset.kind });
        if (consume) {
          handedOff = true;
          const checkHandoff = () => {
            if (!controller.signal.aborted && Date.now() >= deadline) {
              timedOut = true;
              controller.abort();
            }
            check();
          };
          await consumeVerifiedCopy(path, metadata, controller.signal, checkHandoff, consume);
        }
        return metadata;
      } catch (error) {
        if (controller.signal.aborted) throw new StorageReadError(timedOut ? "STORAGE_TIMEOUT" : "STORAGE_ABORTED");
        if (error instanceof StorageReadError) throw error;
        throw new StorageReadError("STORAGE_UNAVAILABLE");
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort();
        try {
          await stream?.cancel().catch(() => {}); stream?.releaseLock(); await file?.close().catch(() => {});
          // The sole recursive cleanup target is this call's generated directory.
          if (work && root) await cleanupWork(root, work, handedOff);
        } finally { active--; }
      }
  }

  return Object.freeze<PrivateObjectReaderWithFile>({
    verify: (actor, input, signal) => readAndVerify(actor, input, signal),
    async useVerifiedFile(actor, input, consume, signal) {
      if (typeof consume !== "function") throw new StorageReadError("STORAGE_INPUT");
      return readAndVerify(actor, input, signal, consume);
    },
  });
}
