import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import { z } from "zod";
import { StorageReadError } from "./errors";
import type { OwnedStorageAsset } from "./object-key";
const run = promisify(execFile);
const probe = z.object({ streams: z.array(z.object({ codec_type: z.string(), duration: z.string().optional() })), format: z.object({ duration: z.string().optional() }) });
// Same image/video allowlist, 40M-pixel image decode and positive video duration
// policy as local inspectMedia. Tools are explicitly injected, never env-read.
export async function verifyStorageMedia(path: string, asset: OwnedStorageAsset, ffprobePath: string, signal: AbortSignal, deadline: number) {
  signal.throwIfAborted();
  const detected = await fileTypeFromFile(path, { signal });
  if (!detected || detected.mime !== asset.mime) throw new StorageReadError("STORAGE_TYPE");
  if (asset.kind === "image") {
    const image = sharp(path, { limitInputPixels: 40000000, failOn: "error" }).timeout({ seconds: Math.max(1, Math.min(30, Math.ceil((deadline - Date.now()) / 1000))) });
    const abort = () => image.destroy(); signal.addEventListener("abort", abort, { once: true });
    try { const metadata = await image.metadata(); signal.throwIfAborted();
      image.timeout({ seconds: Math.max(1, Math.min(30, Math.ceil((deadline - Date.now()) / 1000))) });
      await image.stats(); if (!metadata.width || !metadata.height) throw new Error(); }
    catch { throw new StorageReadError("STORAGE_TYPE"); }
    finally { signal.removeEventListener("abort", abort); image.destroy(); }
  } else {
    try {
      const result = await run(ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", path],
        { signal, timeout: Math.max(1, Math.min(30000, deadline - Date.now())), maxBuffer: 1024 * 1024, windowsHide: true });
      const value = probe.parse(JSON.parse(result.stdout)); const video = value.streams.find(s => s.codec_type === "video");
      const duration = Number(value.format.duration ?? video?.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error();
    } catch { throw new StorageReadError("STORAGE_TYPE"); }
  }
  signal.throwIfAborted();
}
