import "server-only";
import { addAbortListener } from "node:events";
import { isDeepStrictEqual } from "node:util";
import type { CoverAddress } from "./cover-path";
import { coverStatus, type CoverSource } from "./cover-source";
import { parsePlaybackPath, playbackFormats, isPlaybackExtension } from "./playback-path";

export type PlaybackRow = Readonly<{ objectKey: string; sha: string; ext: string; mime: string; sizeBytes: number; version: string }>;
export type PlaybackStore = Readonly<{
  findMedia(address: CoverAddress, signal: AbortSignal): Promise<PlaybackRow | null>;
  readRange(row: PlaybackRow, start: number, end: number, signal: AbortSignal): Promise<Response>;
}>;

export const PLAYBACK_CHUNK_BYTES = 256 * 1024;

function byteRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  // Magnitudes larger than the bounded media size can be clamped without losing precision.
  const first = Number(match[1]);
  const last = Number(match[2]);
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  return start <= end ? { start, end } : null;
}

async function bounded<T>(signal: AbortSignal, read: () => Promise<T>) {
  signal.throwIfAborted();
  const abort = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => abort.reject(new Error("playback interrupted")));
  try {
    const result = await Promise.race([read(), abort.promise]);
    signal.throwIfAborted();
    return result;
  } finally { listener[Symbol.dispose](); }
}

export async function readVerifiedPlaybackChunk(store: Pick<PlaybackStore, "readRange">, row: PlaybackRow, start: number, end: number, signal: AbortSignal) {
  const response = await store.readRange(row, start, end, signal);
  const reader = response.body?.getReader();
  const length = end - start + 1;
  try {
    const h = response.headers;
    if (!reader || response.status !== 206 || h.get("etag") !== row.version ||
        h.get("content-range") !== `bytes ${start}-${end}/${row.sizeBytes}` || h.get("content-length") !== String(length) ||
        (h.has("content-encoding") && h.get("content-encoding") !== "identity")) throw new Error("invalid storage range");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await bounded(signal, () => reader.read());
      if (done) break;
      if (offset + value.byteLength > length) throw new Error("oversized chunk");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== length) throw new Error("short chunk");
    return bytes;
  } finally {
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function servePlayback(request: Request, provider: CoverSource | (() => Promise<CoverSource>), deadlineMs = 5000) {
  const { method } = request;
  const url = new URL(request.url);
  const address = parsePlaybackPath(url.pathname);
  if (!address || request.url.includes("?")) return coverStatus(404, method);
  if (method !== "GET" && method !== "HEAD") return coverStatus(405, method);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([request.signal, lifetime.signal]);
  const deadline = () => AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
  const first = deadline();
  try {
    const source = typeof provider === "function" ? await bounded(first, provider) : provider;
    if (source.mode !== "active") return coverStatus(404, method);
    const store = source.store?.media;
    if (!store) return coverStatus(503, method);
    const row = await bounded(first, () => store.findMedia(address, first));
    if (!row) return coverStatus(404, method);
    if (!isPlaybackExtension(row.ext) || playbackFormats[row.ext].mime !== row.mime ||
        !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1 ||
        row.sizeBytes > (playbackFormats[row.ext].kind === "video" ? 500 : 50) * 1024 ** 2 ||
        !/^[a-f0-9]{64}$/.test(row.sha) || row.objectKey !== `${address.slug}/${address.generation}/${row.sha}.${row.ext}` ||
        typeof row.version !== "string" || !/^"[\x21\x23-\x7e]{1,128}"$/.test(row.version)) return coverStatus(503, method);
    if (row.ext !== address.ext) return coverStatus(404, method);

    const range = method === "HEAD" || request.headers.has("if-range") ? null : request.headers.get("range");
    const plan = range === null ? { start: 0, end: row.sizeBytes - 1 } : byteRange(range, row.sizeBytes);
    const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin", "accept-ranges": "bytes" });
    if (!plan) {
      headers.set("content-range", `bytes */${row.sizeBytes}`);
      headers.set("content-type", "text/plain; charset=utf-8");
      return new Response("Range Not Satisfiable", { status: 416, headers });
    }
    headers.set("content-type", row.mime);
    headers.set("content-length", String(plan.end - plan.start + 1));
    if (range !== null) headers.set("content-range", `bytes ${plan.start}-${plan.end}/${row.sizeBytes}`);
    if (method === "HEAD") return new Response(null, { headers });

    let next = plan.start;
    const chunk = async (signal: AbortSignal) => {
      const end = Math.min(next + PLAYBACK_CHUNK_BYTES - 1, plan.end);
      const bytes = await readVerifiedPlaybackChunk(store, row, next, end, signal);
      const current = await store.findMedia(address, signal);
      if (!isDeepStrictEqual(current, row)) return null;
      next = end + 1;
      return bytes;
    };
    const initial = await bounded(first, () => chunk(first));
    if (!initial) return coverStatus(404, method);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(initial);
        if (next > plan.end) controller.close();
      },
      async pull(controller) {
        try {
          const timeout = deadline();
          const bytes = await bounded(timeout, () => chunk(timeout));
          if (!bytes) throw new Error("inactive publication");
          controller.enqueue(bytes);
          if (next > plan.end) controller.close();
        } catch {
          lifetime.abort();
          controller.error(new Error("playback interrupted"));
        }
      },
      cancel() { lifetime.abort(); },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: range === null ? 200 : 206, headers });
  } catch {
    lifetime.abort();
    return coverStatus(503, method);
  }
}
