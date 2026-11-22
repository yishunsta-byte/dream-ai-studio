import "server-only";

import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import { mediaBinary, runMedia } from "../media/tools";
import type { AudioMeasurement } from "./admin-audio-details-contract";
import type { AudioPayload } from "./admin-audio-http";
import { adminAudioChunkBytes, audioFormatFromFilename, audioUploadMime, type AudioUploadFormat } from "./admin-audio-upload-contract";

export const inlineAudioProbeDeadlineMs = 23_000;

const inspected = z.object({ streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string().optional(),
  sample_rate: z.unknown().optional(), channels: z.unknown().optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).optional() })).max(16),
  format: z.object({ duration: z.coerce.number().positive(), format_name: z.string().optional() }) });

export class AudioUploadError extends Error {
  constructor(readonly code: "invalid_file" | "processing_stopped" | "provider_error" | "invalid_provider_file" |
    "timed_out" | "upload_unconfirmed" | "stale_credential" | "media_unavailable", readonly uncertain = false) { super(code); }
}

export type VerifiedAudio = { path: string; sizeBytes: number; mime: string; sha256: string; measurement: AudioMeasurement };
const probeUnavailable: AudioMeasurement = { source: "unavailable", reason: "probe_unavailable" };
const positiveInteger = z.int().positive();

export async function measureInlineAudio(audio: AudioPayload, signal: AbortSignal): Promise<AudioMeasurement> {
  const format = (Object.keys(audioUploadMime) as AudioUploadFormat[]).find(key => audioUploadMime[key] === audio.mime);
  if (!format) return probeUnavailable;
  try {
    return await withVerifiedAudio({ filename: `inline.${format}`, sizeBytes: audio.bytes.length, signal,
      read: async offset => audio.bytes.subarray(offset, offset + adminAudioChunkBytes) }, async verified => verified.measurement);
  } catch (error) {
    if (format !== "flac" && error instanceof AudioUploadError && error.code === "media_unavailable") return probeUnavailable;
    throw error;
  }
}

export async function withVerifiedAudio<T>(input: { filename: string; sizeBytes: number; signal: AbortSignal;
  read: (offset: number) => Promise<Buffer | undefined> }, action: (audio: VerifiedAudio) => Promise<T>) {
  const format = audioFormatFromFilename(input.filename);
  if (!format) throw new AudioUploadError("invalid_file");
  const root = await mkdtemp(join(tmpdir(), "dream-admin-audio-"));
  const path = join(root, `source.${format}`);
  try {
    const hash = createHash("sha256");
    const { signal, sizeBytes } = input;
    async function* chunks() {
      for (let offset = 0; offset < sizeBytes; offset += adminAudioChunkBytes) {
        signal.throwIfAborted();
        const value = await input.read(offset);
        if (!value || value.length !== Math.min(sizeBytes - offset, adminAudioChunkBytes)) throw new AudioUploadError("processing_stopped");
        hash.update(value);
        yield value;
      }
    }
    await writeFile(path, chunks(), { flag: "wx", mode: 0o600, signal });
    const type = await fileTypeFromFile(path).catch(() => undefined);
    if (type?.ext !== format && !(format === "m4a" && type?.ext === "mp4")) throw new AudioUploadError("invalid_file");
    let measurement: AudioMeasurement;
    try {
      const { stdout } = await runMedia(mediaBinary("ffprobe"), ["-v", "error", "-protocol_whitelist", "file",
        "-show_streams", "-show_format", "-of", "json", "-i", path], { timeout: 10_000, maxBuffer: 192 * 1024, windowsHide: true, signal });
      const { streams, format: info } = inspected.parse(JSON.parse(stdout));
      const audio = streams.find(stream => stream.codec_type === "audio");
      if (!streams.some(stream => stream.codec_type === "audio" && stream.codec_name && stream.codec_name !== "unknown") ||
          streams.some(stream => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1)) throw new Error("Unsupported streams");
      if (format === "flac" && (info.format_name !== "flac" || audio?.codec_name !== "flac")) throw new Error("Invalid FLAC stream");
      await runMedia(mediaBinary("ffmpeg"), ["-v", "error", "-nostdin", "-xerror", "-protocol_whitelist", "file", "-i", path,
        "-map", "0:a:0", "-t", "1", "-f", "null", "-"], { timeout: 12_000, maxBuffer: 48 * 1024, windowsHide: true, signal });
      measurement = { source: "server_probe", durationSeconds: info.duration,
        sampleRateHz: positiveInteger.safeParse(Number(audio?.sample_rate)).data ?? null,
        channels: positiveInteger.safeParse(audio?.channels).data ?? null };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) {
        throw new AudioUploadError("media_unavailable");
      }
      throw new AudioUploadError("invalid_file");
    }
    return await action({ path, sizeBytes, mime: audioUploadMime[format], sha256: hash.digest("base64"), measurement });
  } finally {
    await rm(path, { force: true });
    await rmdir(root);
  }
}
