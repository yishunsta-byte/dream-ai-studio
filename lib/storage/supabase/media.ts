import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import { z } from "zod";
import { mediaSchema } from "@/lib/storage/uploads/schema";
import { StorageReadError } from "./errors";
import { storageFormats, type OwnedStorageAsset } from "./object-key";
const run = promisify(execFile);
// width/height are read only for observation; unknown() keeps the verification parse exactly as before.
const probe = z.object({ streams: z.array(z.object({ codec_type: z.string(), duration: z.string().optional(), width: z.unknown().optional(), height: z.unknown().optional() })),
  format: z.object({ duration: z.string().optional() }) });
type StorageMime = OwnedStorageAsset["mime"];
export type StorageMediaObservation = Readonly<{ format: Readonly<{ mime: StorageMime; kind: "image" | "video" }>; media: z.infer<typeof mediaSchema> }>;
type Inspected = { mime: StorageMime; kind: "image" | "video"; width: unknown; height: unknown; durationSeconds: number | null };

// One detection/decode pass shared by verification and observation. With `expected`, the detected type must equal it
// before any decode (the verification order); without it, any allowlisted type is accepted and reported as detected.
async function inspectStorageMedia(path: string, expected: Pick<OwnedStorageAsset, "mime" | "kind"> | null, ffprobePath: string, signal: AbortSignal, deadline: number): Promise<Inspected> {
  signal.throwIfAborted();
  const detected = await fileTypeFromFile(path, { signal });
  if (!detected || (expected ? detected.mime !== expected.mime : !Object.hasOwn(storageFormats, detected.mime))) throw new StorageReadError("STORAGE_TYPE");
  const mime = detected.mime as StorageMime, kind = expected ? expected.kind : storageFormats[mime].kind;
  if (kind === "image") {
    const image = sharp(path, { limitInputPixels: 40000000, failOn: "error" }).timeout({ seconds: Math.max(1, Math.min(30, Math.ceil((deadline - Date.now()) / 1000))) });
    const abort = () => image.destroy(); signal.addEventListener("abort", abort, { once: true });
    try { const metadata = await image.metadata(); signal.throwIfAborted();
      image.timeout({ seconds: Math.max(1, Math.min(30, Math.ceil((deadline - Date.now()) / 1000))) });
      await image.stats(); if (!metadata.width || !metadata.height) throw new Error();
      return { mime, kind, width: metadata.width, height: metadata.height, durationSeconds: null }; }
    catch { throw new StorageReadError("STORAGE_TYPE"); }
    finally { signal.removeEventListener("abort", abort); image.destroy(); }
  } else {
    try {
      const result = await run(ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", path],
        { signal, timeout: Math.max(1, Math.min(30000, deadline - Date.now())), maxBuffer: 1024 * 1024, windowsHide: true });
      const value = probe.parse(JSON.parse(result.stdout)); const video = value.streams.find(s => s.codec_type === "video");
      const duration = Number(value.format.duration ?? video?.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error();
      return { mime, kind, width: video.width, height: video.height, durationSeconds: duration };
    } catch { throw new StorageReadError("STORAGE_TYPE"); }
  }
}

// Same image/video allowlist, 40M-pixel image decode and positive video duration
// policy as local inspectMedia. Tools are explicitly injected, never env-read.
export async function verifyStorageMedia(path: string, asset: OwnedStorageAsset, ffprobePath: string, signal: AbortSignal, deadline: number) {
  await inspectStorageMedia(path, asset, ffprobePath, signal, deadline);
  signal.throwIfAborted();
}

// Internal verifier observation of a bounded local temp file: the actually detected allowlisted format and the
// mediaSchema width/height (images: decoded pixel size, durationMs null; videos: first video stream's coded size and
// the positive container/stream duration rounded to whole milliseconds, at least 1). Anything else is STORAGE_TYPE.
export async function observeStorageMedia(path: string, ffprobePath: string, signal: AbortSignal, deadline: number): Promise<StorageMediaObservation> {
  const found = await inspectStorageMedia(path, null, ffprobePath, signal, deadline);
  signal.throwIfAborted();
  const media = mediaSchema.safeParse({ width: found.width, height: found.height,
    durationMs: found.durationSeconds === null ? null : Math.max(1, Math.round(found.durationSeconds * 1000)) });
  if (!media.success || (found.kind === "image") !== (media.data.durationMs === null)) throw new StorageReadError("STORAGE_TYPE");
  return Object.freeze({ format: Object.freeze({ mime: found.mime, kind: found.kind }), media: Object.freeze(media.data) });
}
