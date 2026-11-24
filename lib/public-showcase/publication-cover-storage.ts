import "server-only";

import { createClient } from "@supabase/supabase-js";
import { actorFromVerifiedUserId } from "../db/postgres/types";
import { privateStorageTransportConfig, type PrivateStorageTransportOptions } from "../storage/supabase/config";
import { StorageReadError } from "../storage/supabase/errors";
import { advertisedSize, boundBody } from "./publication-storage-body";
import { isCoverGeneration, isCoverSlug } from "./cover-path";
import { COVER_MAX_BYTES, type CoverStore } from "./cover-source";

const bucket = "publication-covers-private";
const BUCKET_METADATA_LIMIT = 64 * 1024;
type Options = Omit<PrivateStorageTransportOptions, "bucket" | "privateBucket"> & Readonly<{ adminActorId: string }>;
type ReadOptions = Parameters<CoverStore["readObject"]>[1];

function validKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 154 || /[^a-z0-9./-]/.test(key)) return false;
  const parts = key.split("/");
  return parts.length === 3 && isCoverSlug(parts[0]) && isCoverGeneration(parts[1]) && /^[a-f0-9]{64}\.webp$/.test(parts[2]);
}

/** Server-only byte readers for the T332 adapter, after its database authority checks. */
export function createPublicationCoverStorageReaders(options: Options) {
  let config: PrivateStorageTransportOptions;
  let adminActorId: string;
  try {
    config = privateStorageTransportConfig({ ...options, bucket, privateBucket: true });
    if (config.maxBytes > COVER_MAX_BYTES) throw new StorageReadError("STORAGE_CONFIG");
    adminActorId = actorFromVerifiedUserId(options.adminActorId).id;
  } catch { throw new StorageReadError("STORAGE_CONFIG"); }

  const fetchObject = globalThis.fetch;
  let active = 0;
  const read: CoverStore["readObject"] = async (key: string, readOptions: ReadOptions) => {
    const { maxBytes, signal: callerSignal } = readOptions ?? {};
    if (!validKey(key) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
        maxBytes > COVER_MAX_BYTES || !(callerSignal instanceof AbortSignal)) throw new StorageReadError("STORAGE_INPUT");
    if (callerSignal.aborted) throw new StorageReadError("STORAGE_ABORTED");
    if (active >= config.maxConcurrent) throw new StorageReadError("STORAGE_UNAVAILABLE");

    const limit = Math.min(config.maxBytes, maxBytes);
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const cleanup = new AbortController();
    const signal = AbortSignal.any([callerSignal, deadline, cleanup.signal]);
    const bucketUrl = `${config.projectUrl}/storage/v1/bucket/${bucket}`;
    const objectUrl = `${config.projectUrl}/storage/v1/object/${bucket}/${key}`;
    let failure: StorageReadError | undefined;
    let objectLength: number | null = null;
    const boundedFetch: typeof fetch = async (input, init) => {
      let response: Response | undefined;
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if ((url !== bucketUrl && url !== objectUrl) || init?.method !== "GET") throw new StorageReadError("STORAGE_INPUT");
        signal.throwIfAborted();
        const headers = new Headers(init.headers);
        headers.set("accept-encoding", "identity");
        response = await fetchObject(url, { ...init, headers, signal, redirect: "error", cache: "no-store" });
        if (response.status !== 200) {
          const status = response.status;
          if (status === 404 && url === objectUrl) throw new StorageReadError("STORAGE_NOT_FOUND");
          if (status === 401 || status === 403) throw new StorageReadError("STORAGE_AUTH");
          throw new StorageReadError("STORAGE_UNAVAILABLE");
        }
        if (url === bucketUrl) {
          const length = advertisedSize(response, BUCKET_METADATA_LIMIT);
          return new Response(await boundBody(response.body, BUCKET_METADATA_LIMIT, length, signal), { headers: { "content-type": "application/json" } });
        }
        objectLength = advertisedSize(response, limit);
        return response;
      } catch (error) {
        await response?.body?.cancel().catch(() => undefined);
        if (error instanceof StorageReadError) failure = error;
        throw new StorageReadError("STORAGE_UNAVAILABLE");
      }
    };

    active++;
    try {
      const sdk = createClient(config.projectUrl, config.credential.key, { accessToken: async () => config.credential.key,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch }, storage: { useNewHostname: false } });
      const metadata = await sdk.storage.getBucket(bucket);
      if (failure) throw failure;
      if (metadata.error) throw new StorageReadError("STORAGE_UNAVAILABLE");
      if (metadata.data?.id !== bucket || metadata.data.public !== false) throw new StorageReadError("STORAGE_PRIVATE");
      const download = await sdk.storage.from(bucket).download(key, {}, { signal, cache: "no-store" }).asStream();
      if (failure) throw failure;
      if (download.error || !download.data) throw new StorageReadError("STORAGE_UNAVAILABLE");
      return await boundBody(download.data as ReadableStream<Uint8Array>, limit, objectLength, signal);
    } catch (error) {
      if (callerSignal.aborted) throw new StorageReadError("STORAGE_ABORTED");
      if (deadline.aborted) throw new StorageReadError("STORAGE_TIMEOUT");
      if (error instanceof StorageReadError) throw error;
      throw new StorageReadError("STORAGE_UNAVAILABLE");
    } finally {
      cleanup.abort();
      active--;
    }
  };

  return Object.freeze({
    async readAdminCover(ownerId: string, key: string, readOptions: ReadOptions) {
      if (ownerId !== adminActorId) throw new StorageReadError("STORAGE_OWNER");
      try { return await read(key, readOptions); }
      catch (error) {
        if (error instanceof StorageReadError && error.code === "STORAGE_NOT_FOUND") return null;
        throw error;
      }
    },
    readPublicCover: read,
  });
}
