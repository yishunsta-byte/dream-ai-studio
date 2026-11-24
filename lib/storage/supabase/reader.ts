import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdtemp, open, realpath, rm, statfs } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { privateStorageConfig, type PrivateStorageOptions } from "./config";
import { ownedIncomingSource, ownedStorageAsset, type OwnedIncomingSource, type OwnedStorageAsset } from "./object-key";
import { StorageReadError } from "./errors";
import { observeStorageMedia, verifyStorageMedia, type StorageMediaObservation } from "./media";

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
async function cleanupWork(root: string, work: string) {
  let actual: string;
  try { actual = await realpath(work); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new StorageReadError("STORAGE_TEMP");
  }
  if (dirname(actual) !== root || !basename(actual).startsWith("dream-verify-")) throw new StorageReadError("STORAGE_TEMP");
  await rm(actual, { recursive: true, force: false }).catch(() => { throw new StorageReadError("STORAGE_TEMP"); });
}
export type VerifiedStorageObject = Readonly<Pick<OwnedStorageAsset, "sizeBytes" | "sha256" | "mime" | "kind">>;
export type PrivateObjectReader = Readonly<{ verify: (actor: Parameters<typeof ownedStorageAsset>[0], asset: unknown, signal?: AbortSignal) => Promise<VerifiedStorageObject> }>;
// Internal registered-object observation (reverify preparation): what one download of the owner-checked canonical key
// actually held. bytes are measured from that download, never copied from the registered row; format/media are null when
// the bytes are not an allowlisted, decodable image/video. A size/hash/type mismatch is reported, not refused, so a later
// reverify can record it; the download itself stays bounded by the configured maxBytes, timeout, abort and cleanup.
export type RegisteredStorageObservation = Readonly<{ bytes: Readonly<{ sizeBytes: number; sha256: string }>;
  format: StorageMediaObservation["format"] | null; media: StorageMediaObservation["media"] | null }>;
export type RegisteredObjectObserver = Readonly<{ observeRegistered: (actor: Parameters<typeof ownedStorageAsset>[0], asset: unknown, signal?: AbortSignal) => Promise<RegisteredStorageObservation> }>;
// Internal reserved-upload original observation: the 0005 incoming key of a server-checked owner/object/intent in the one
// configured private bucket (providerVersion null only), measured from one download bounded by min(reservation, config) maxBytes.
export type IncomingStorageObservation = Readonly<{ source: OwnedIncomingSource["source"] } & RegisteredStorageObservation>;
// Registered-object observation bound to the source actually read: the caller states the registered source it expects;
// before any request it must be this reader's configured bucket, the owner-checked canonical key, and no provider version
// (this reader proves none). The returned source is that same bucket/key, so source and measurement share one download.
export type RegisteredSourceObservation = Readonly<{ source: Readonly<{ bucket: string; key: string; providerVersion: null }> } & RegisteredStorageObservation>;
export type RegisteredSourceObserver = Readonly<{ observeRegisteredSource: (actor: Parameters<typeof ownedStorageAsset>[0], input: unknown, signal?: AbortSignal) => Promise<RegisteredSourceObservation> }>;
const registeredSourceInput = z.strictObject({ asset: z.unknown(),
  source: z.strictObject({ bucket: z.string().max(63), key: z.string().max(256), providerVersion: z.null() }) });
function registeredSource(actor: Parameters<typeof ownedStorageAsset>[0], input: unknown, bucket: string, maxBytes: number) {
  try {
    const parsed = registeredSourceInput.safeParse(input); if (!parsed.success) throw new StorageReadError("STORAGE_INPUT");
    const asset = ownedStorageAsset(actor, parsed.data.asset, maxBytes);
    if (parsed.data.source.bucket !== bucket || parsed.data.source.key !== asset.objectKey) throw new StorageReadError("STORAGE_INPUT");
    return { asset, source: Object.freeze({ bucket, key: asset.objectKey, providerVersion: null }) };
  } catch (error) { if (error instanceof StorageReadError) throw error; throw new StorageReadError("STORAGE_INPUT"); }
}
export type IncomingObjectObserver = Readonly<{ observeIncoming: (actor: Parameters<typeof ownedStorageAsset>[0], reservation: unknown, signal?: AbortSignal) => Promise<IncomingStorageObservation> }>;

export function createPrivateObjectReader(options: PrivateStorageOptions): PrivateObjectReader & RegisteredObjectObserver & IncomingObjectObserver & RegisteredSourceObserver {
  const config = privateStorageConfig(options), fetchObject = globalThis.fetch;
  let active = 0;
  // One bounded download path. observe=false is the unchanged verify contract; observe=true only relaxes the
  // registered size/hash/type equality into measured values (still owner/key-checked and maxBytes-bounded).
  // mode "incoming" observes a reserved-upload original instead of a registered asset, with the reservation's smaller bound.
  async function read(actor: Parameters<typeof ownedStorageAsset>[0], input: unknown, signal: AbortSignal | undefined, observe: boolean,
    mode: "asset" | "incoming" | "registered-source" = "asset"): Promise<VerifiedStorageObject | RegisteredStorageObservation | IncomingStorageObservation> {
      // Before network/SDK/temp work.
      const incoming = mode === "incoming" ? ownedIncomingSource(actor, input, config.bucket, config.maxBytes) : undefined;
      const bound = mode === "registered-source" ? registeredSource(actor, input, config.bucket, config.maxBytes) : undefined;
      const asset = incoming ? undefined : bound ? bound.asset : ownedStorageAsset(actor, input, config.maxBytes);
      const source = incoming ? incoming.source : bound?.source;
      const objectKey = incoming ? incoming.objectKey : asset!.objectKey, limit = incoming ? incoming.maxBytes : config.maxBytes;
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new StorageReadError("STORAGE_INPUT");
      if (signal?.aborted) throw new StorageReadError("STORAGE_ABORTED");
      if (active >= config.maxConcurrent) throw new StorageReadError("STORAGE_UNAVAILABLE");
      active++;
      const controller = new AbortController(), deadline = Date.now() + config.timeoutMs;
      let timedOut = false, work: string | undefined, root: string | undefined, declared: number | null = null;
      let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
      const check = () => { if (controller.signal.aborted) throw new StorageReadError(timedOut ? "STORAGE_TIMEOUT" : "STORAGE_ABORTED"); };
      try {
        check(); root = await realpath(config.workRoot); const space = await statfs(root);
        if (space.bavail * space.bsize < (observe ? limit : asset!.sizeBytes) + 1024 * 1024) throw new StorageReadError("STORAGE_TEMP");
        check(); work = await mkdtemp(join(root, "dream-verify-"));
        const bucketUrl = `${config.projectUrl}/storage/v1/bucket/${config.bucket}`;
        const objectUrl = `${config.projectUrl}/storage/v1/object/${config.bucket}/${objectKey}`;
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
          if ((length !== null && (!/^\d+$/.test(length) || (!observe && Number(length) !== asset!.sizeBytes) || Number(length) > (observe ? limit : config.maxBytes))) || (encoding && encoding !== "identity")) {
            await response.body?.cancel().catch(() => {}); throw new StorageReadError("STORAGE_INTEGRITY");
          }
          declared = length === null ? null : Number(length);
          return response;
          } catch (error) { if (error instanceof StorageReadError) requestFailure = error; throw error; }
        };
        const sdk = createClient(config.projectUrl, config.credential.key, { accessToken: async () => config.credential.key,
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch }, storage: { useNewHostname: false } });
        const bucket = await sdk.storage.getBucket(config.bucket); check();
        if (requestFailure) throw requestFailure;
        if (bucket.error) throw new StorageReadError("STORAGE_UNAVAILABLE");
        if (bucket.data?.id !== config.bucket || bucket.data.public !== false) throw new StorageReadError("STORAGE_PRIVATE");
        const download = await sdk.storage.from(config.bucket).download(objectKey, {}, { signal: controller.signal, cache: "no-store" }).asStream(); check();
        if (requestFailure) throw requestFailure;
        if (download.error || !download.data) throw new StorageReadError("STORAGE_UNAVAILABLE");
        stream = (download.data as ReadableStream<Uint8Array>).getReader();
        const path = join(work, "object"); file = await open(path, "wx", 0o600);
        const hash = createHash("sha256"); let count = 0;
        while (true) {
          check(); const { value, done } = await stream.read(); if (done) break;
          if (!(value instanceof Uint8Array)) throw new StorageReadError("STORAGE_INTEGRITY");
          count += value.byteLength;
          if (count > (observe ? limit : config.maxBytes) || (!observe && count > asset!.sizeBytes) || (observe && declared !== null && count > declared)) throw new StorageReadError("STORAGE_LIMIT");
          hash.update(value); await file.writeFile(value);
        }
        await file.close(); file = undefined; check();
        if (observe) {
          if (declared !== null && count !== declared) throw new StorageReadError("STORAGE_INTEGRITY");
          const bytes = Object.freeze({ sizeBytes: count, sha256: hash.digest("hex") });
          let seen: StorageMediaObservation | null = null;
          try { seen = await observeStorageMedia(path, config.ffprobePath, controller.signal, deadline); }
          catch (error) { check(); if (!(error instanceof StorageReadError && error.code === "STORAGE_TYPE")) throw error; }
          check();
          return Object.freeze({ ...(source ? { source } : {}), bytes, format: seen?.format ?? null, media: seen?.media ?? null });
        }
        const expected = asset as OwnedStorageAsset; // verify always has the owner-checked registered asset.
        if (count !== expected.sizeBytes || hash.digest("hex") !== expected.sha256) throw new StorageReadError("STORAGE_INTEGRITY");
        await verifyStorageMedia(path, expected, config.ffprobePath, controller.signal, deadline); check();
        return Object.freeze({ sizeBytes: count, sha256: expected.sha256, mime: expected.mime, kind: expected.kind });
      } catch (error) {
        if (controller.signal.aborted) throw new StorageReadError(timedOut ? "STORAGE_TIMEOUT" : "STORAGE_ABORTED");
        if (error instanceof StorageReadError) throw error;
        throw new StorageReadError("STORAGE_UNAVAILABLE");
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort();
        try {
          await stream?.cancel().catch(() => {}); stream?.releaseLock(); await file?.close().catch(() => {});
          // The sole recursive cleanup target is this call's generated directory.
          if (work && root) await cleanupWork(root, work);
        } finally { active--; }
      }
  }
  return Object.freeze({
    verify: (actor, input, signal) => read(actor, input, signal, false) as Promise<VerifiedStorageObject>,
    observeRegistered: (actor, input, signal) => read(actor, input, signal, true) as Promise<RegisteredStorageObservation>,
    observeIncoming: (actor, input, signal) => read(actor, input, signal, true, "incoming") as Promise<IncomingStorageObservation>,
    observeRegisteredSource: (actor, input, signal) => read(actor, input, signal, true, "registered-source") as Promise<RegisteredSourceObservation>,
  });
}
