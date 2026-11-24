import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import { mediaBinary, runMedia } from "../media/tools";
import { playbackFormats, type PlaybackExtension } from "./playback-path";

async function fastStart(path: string, size: number) {
  const file = await open(path, "r");
  const header = Buffer.alloc(16);
  try {
    let moov = false;
    for (let offset = 0; offset + 8 <= size;) {
      const { bytesRead } = await file.read(header, 0, Math.min(16, size - offset), offset);
      if (bytesRead < 8) return false;
      const short = header.readUInt32BE();
      if (short === 1 && bytesRead < 16) return false;
      const length = short === 1 ? Number(header.readBigUInt64BE(8)) : short || size - offset;
      if (!Number.isSafeInteger(length) || length < (short === 1 ? 16 : 8) || length > size - offset) return false;
      const type = header.toString("latin1", 4, 8);
      if (type === "moov") moov = true;
      if (type === "mdat") return moov;
      offset += length;
    }
    return false;
  } finally { await file.close(); }
}

/** Run on the render host when issuing publication evidence for a completed artifact. */
export async function inspectRenderedPublicationMedia(path: string, ext: PlaybackExtension) {
  const format = playbackFormats[ext];
  const max = (format.kind === "video" ? 500 : 50) * 1024 ** 2;
  const source = await stat(path);
  if (!source.isFile() || source.size < 1 || source.size > max) throw new Error("Invalid publication media size");
  const scratch = await mkdtemp(join(tmpdir(), "dream-render-proof-"));
  const copy = join(scratch, "output." + ext);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    // Probe and hash the same private copy even when the render path is replaced.
    await pipeline(createReadStream(path), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > max) return callback(new Error("Publication media exceeds limit"));
        hash.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(copy, { flags: "wx", mode: 0o600 }));
    const detected = await fileTypeFromFile(copy);
    if (!detected || !(detected.mime === format.mime || (ext === "m4a" && detected.mime === "audio/x-m4a"))) {
      throw new Error("Publication container mismatch");
    }
    const { stdout } = await runMedia(mediaBinary("ffprobe"), ["-v", "error", "-protocol_whitelist", "file,pipe",
      "-format_whitelist", "mov,matroska,webm,mp3", "-show_entries", "stream=codec_type,codec_name:stream_disposition=attached_pic:format=duration",
      "-of", "json", copy], { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string; disposition: { attached_pic: number } }[];
      format: { duration: string } };
    const video = result.streams.filter(s => s.codec_type === "video");
    const audio = result.streams.filter(s => s.codec_type === "audio");
    const duration = Number(result.format.duration);
    if (!Number.isFinite(duration) || duration <= 0 || video.length !== Number(format.kind === "video") ||
        audio.length > 1 || (format.kind === "audio" && !audio.length) || video.length + audio.length !== result.streams.length ||
        result.streams.some(s => s.disposition.attached_pic !== 0)) throw new Error("Invalid playback tracks");
    const videoCodec = video[0]?.codec_name ?? null;
    const audioCodec = audio[0]?.codec_name ?? null;
    const iso = ext === "mp4" || ext === "m4a";
    const fast = iso && await fastStart(copy, sizeBytes);
    if ((ext === "mp4" && !fast) || (ext === "mp4" && videoCodec !== "h264") ||
        (ext === "webm" && videoCodec !== "av1" && videoCodec !== "vp9") ||
        (audioCodec && audioCodec !== (ext === "webm" ? "opus" : ext === "mp3" ? "mp3" : "aac"))) {
      throw new Error("Unsupported playback codec or MP4 layout");
    }
    return { status: "verified" as const, ...format, ext, sha: hash.digest("hex"), sizeBytes, videoCodec, audioCodec, fastStart: fast };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
