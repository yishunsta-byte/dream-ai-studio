import "server-only";

import { privateStorageTransportConfig, type PrivateStorageTransportOptions } from "../storage/supabase/config";
import { StorageReadError } from "../storage/supabase/errors";
import { isCoverGeneration, isCoverSlug } from "./cover-path";
import { isPlaybackExtension, playbackFormats } from "./playback-path";
import { PLAYBACK_CHUNK_BYTES, type PlaybackStore } from "./playback-source";
import { advertisedSize, boundBody } from "./publication-storage-body";

const bucket = "publication-media-private";
type Options = Omit<PrivateStorageTransportOptions, "bucket" | "privateBucket">;

export function createPublicationMediaRangeReader(options: Options): PlaybackStore["readRange"] {
  const config = privateStorageTransportConfig({ ...options, bucket, privateBucket: true });
  const transport = globalThis.fetch;
  const base = config.projectUrl + "/storage/v1";
  let active = 0;

  return async (row, start, end, callerSignal) => {
    const parts = row.objectKey.split("/");
    if (parts.length !== 3 || !isCoverSlug(parts[0]) || !isCoverGeneration(parts[1]) ||
        !/^[a-f0-9]{64}$/.test(row.sha) || !isPlaybackExtension(row.ext) ||
        row.mime !== playbackFormats[row.ext].mime || parts[2] !== row.sha + "." + row.ext ||
        !/^"[\x21\x23-\x7e]{1,128}"$/.test(row.version) ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(row.sizeBytes) ||
        start < 0 || end < start || end >= row.sizeBytes || end - start + 1 > PLAYBACK_CHUNK_BYTES ||
        end - start + 1 > config.maxBytes) throw new StorageReadError("STORAGE_INPUT");
    callerSignal.throwIfAborted();
    if (active >= config.maxConcurrent) throw new StorageReadError("STORAGE_UNAVAILABLE");
    const stop = new AbortController();
    const signal = AbortSignal.any([callerSignal, stop.signal, AbortSignal.timeout(config.timeoutMs)]);
    const headers = new Headers({ authorization: "Bearer " + config.credential.key,
      apikey: config.credential.key, "accept-encoding": "identity" });
    const init = { method: "GET", redirect: "error", cache: "no-store", headers, signal } as const;
    let response: Response | undefined;
    active++;
    try {
      response = await transport(base + "/bucket/" + bucket, init);
      if (response.status !== 200) throw new StorageReadError("STORAGE_PRIVATE");
      const metaLimit = 64 * 1024;
      const metadata = JSON.parse((await boundBody(response.body, metaLimit, advertisedSize(response, metaLimit), signal)).toString("utf8"));
      if (metadata?.id !== bucket || metadata.public !== false) throw new StorageReadError("STORAGE_PRIVATE");

      headers.set("range", `bytes=${start}-${end}`);
      headers.set("if-match", row.version);
      response = await transport(base + "/object/authenticated/" + bucket + "/" + row.objectKey, init);
      const length = end - start + 1;
      if (response.status !== 206 || response.headers.get("etag") !== row.version ||
          response.headers.get("content-range") !== `bytes ${start}-${end}/${row.sizeBytes}` ||
          advertisedSize(response, length) !== length) throw new StorageReadError("STORAGE_INTEGRITY");
      const bytes = await boundBody(response.body, length, length, signal);
      return new Response(new Uint8Array(bytes), { status: 206, headers: {
        etag: row.version, "content-length": String(length), "content-range": `bytes ${start}-${end}/${row.sizeBytes}`,
      } });
    } finally {
      stop.abort();
      await response?.body?.cancel().catch(() => undefined);
      active--;
    }
  };
}
