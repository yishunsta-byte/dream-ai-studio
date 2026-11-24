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

// 오디오 422 조치: 측정 실패를 고정 종류로 나눈다. 도구가 없거나(ENOENT·EACCES) 시작하지 못한 경우(126·127, 공유 라이브러리
// 오류)는 파일 문제가 아니라 서버 도구 문제다. 기록에는 단계·종류·종료 코드·신호만 남기고 경로·오류 원문은 남기지 않는다.
export type ProbeStage = "probe" | "probe_output" | "streams" | "decode";
export type ProbeFailure = { stage: ProbeStage; kind: "tool_missing" | "tool_start" | "tool_stopped" | "invalid_output" | "unsupported_streams" | "media_error";
  exitCode: number | null; signal: string | null };
export function classifyProbeFailure(error: unknown, stage: ProbeStage): ProbeFailure {
  const detail = (error && typeof error === "object" ? error : {}) as { code?: unknown; signal?: unknown; killed?: unknown; stderr?: unknown };
  const exitCode = typeof detail.code === "number" ? detail.code : null;
  const signal = typeof detail.signal === "string" ? detail.signal : null;
  const stderr = typeof detail.stderr === "string" ? detail.stderr : "";
  const base = { stage, exitCode, signal };
  if (detail.code === "ENOENT" || detail.code === "EACCES") return { ...base, kind: "tool_missing" };
  if (exitCode === 126 || exitCode === 127 || /error while loading shared libraries|cannot open shared object file/i.test(stderr)) {
    return { ...base, kind: "tool_start" };
  }
  if (detail.killed === true || signal) return { ...base, kind: "tool_stopped" };
  if (stage === "probe_output") return { ...base, kind: "invalid_output" };
  if (stage === "streams") return { ...base, kind: "unsupported_streams" };
  return { ...base, kind: "media_error" };
}
const positiveInteger = z.int().positive();

// requireProbe: 측정을 건너뛰지 않는다(도구를 쓸 수 없으면 media_unavailable을 그대로 던진다). FLAC과 모호한 M4A(mp4 판별)가 쓴다.
export async function measureInlineAudio(audio: AudioPayload, signal: AbortSignal, requireProbe = false): Promise<AudioMeasurement> {
  const format = (Object.keys(audioUploadMime) as AudioUploadFormat[]).find(key => audioUploadMime[key] === audio.mime);
  if (!format) return probeUnavailable;
  try {
    return await withVerifiedAudio({ filename: `inline.${format}`, sizeBytes: audio.bytes.length, signal,
      read: async offset => audio.bytes.subarray(offset, offset + adminAudioChunkBytes) }, async verified => verified.measurement);
  } catch (error) {
    if (format !== "flac" && !requireProbe && error instanceof AudioUploadError && error.code === "media_unavailable") return probeUnavailable;
    throw error;
  }
}

// 측정 핵심: 오디오 스트림 필수, 표지가 아닌 영상 거절, accept(형식 이름, 첫 오디오 코덱) 통과, 첫 오디오 1초 디코딩.
// formatWhitelist가 있으면 ffprobe·ffmpeg가 그 해석기(demuxer)만 쓴다. 로컬 파일만 연다(protocol file).
async function inspectAudioFile(path: string, signal: AbortSignal, accept: (formatName: string | undefined, codec: string | undefined) => boolean,
  formatWhitelist?: string) {
  const restrict = formatWhitelist ? ["-format_whitelist", formatWhitelist] : [];
  let stage: ProbeStage = "probe";
  try {
    const { stdout } = await runMedia(mediaBinary("ffprobe"), ["-v", "error", "-protocol_whitelist", "file", ...restrict,
      "-show_streams", "-show_format", "-of", "json", "-i", path], { timeout: 10_000, maxBuffer: 192 * 1024, windowsHide: true, signal });
    stage = "probe_output";
    const { streams, format: info } = inspected.parse(JSON.parse(stdout));
    stage = "streams";
    const audio = streams.find(stream => stream.codec_type === "audio");
    if (!streams.some(stream => stream.codec_type === "audio" && stream.codec_name && stream.codec_name !== "unknown") ||
        streams.some(stream => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1)) throw new Error("Unsupported streams");
    if (!accept(info.format_name, audio?.codec_name)) throw new Error("Unsupported format");
    stage = "decode";
    await runMedia(mediaBinary("ffmpeg"), ["-v", "error", "-nostdin", "-xerror", "-protocol_whitelist", "file", ...restrict, "-i", path,
      "-map", "0:a:0", "-t", "1", "-f", "null", "-"], { timeout: 12_000, maxBuffer: 48 * 1024, windowsHide: true, signal });
    const measurement: AudioMeasurement = { source: "server_probe", durationSeconds: info.duration,
      sampleRateHz: positiveInteger.safeParse(Number(audio?.sample_rate)).data ?? null,
      channels: positiveInteger.safeParse(audio?.channels).data ?? null };
    return { measurement, formatName: info.format_name, codec: audio?.codec_name };
  } catch (error) {
    signal.throwIfAborted();
    const failure = classifyProbeFailure(error, stage);
    console.warn("admin_audio_probe_failed", failure);
    if (failure.kind === "tool_missing" || failure.kind === "tool_start") throw new AudioUploadError("media_unavailable");
    throw new AudioUploadError("invalid_file");
  }
}

// 오디오 호환: 원본 키트(v1.01)는 내용 검사 없이 Gemini에 맡겨, 이름과 내용이 다른 파일도 분석됐다.
// 여기서는 이름과 내용이 다르거나 file-type이 판별하지 못한 입력을, 허용 해석기만 쓰는 서버 측정(오디오 스트림·1초 디코딩)으로
// 실제 형식을 확인한 뒤 그 형식의 MIME으로만 보낸다(이름·브라우저 MIME은 쓰지 않는다). 바로 분석과 큰 파일 업로드가 같이 쓴다.
// AAC(ADTS)·Ogg는 원본처럼 Gemini가 처리하는 오디오라 확인 형식에 넣는다(선택 가능한 파일 이름 목록은 그대로).
export const confirmedAudioMime = { ...audioUploadMime, aac: "audio/aac", ogg: "audio/ogg" } as const;
export type ConfirmedAudioFormat = keyof typeof confirmedAudioMime;
export const identifiableDemuxers = "mp3,wav,mov,mp4,m4a,3gp,3g2,mj2,flac,aac,ogg";
// 이름과 달라도 서버 측정으로 확인해 볼 file-type 판별 값. 그 밖(이미지·문서·영상·webm 등)은 측정 없이 바로 막는다.
export const identifiableContent: ReadonlySet<string> = new Set(["mp3", "wav", "m4a", "mp4", "flac", "aac", "ogg", "oga", "opus"]);
export function identifiedAudioFormat(formatName: string | undefined, codec: string | undefined): ConfirmedAudioFormat | undefined {
  const names = (formatName ?? "").split(",");
  if (names.includes("mp3") && codec === "mp3") return "mp3";
  if (names.includes("wav") && codec?.startsWith("pcm_")) return "wav";
  if (names.includes("mp4") && (codec === "aac" || codec === "alac")) return "m4a";
  if (names.includes("flac") && codec === "flac") return "flac";
  if (names.includes("aac") && codec === "aac") return "aac";
  if (names.includes("ogg") && (codec === "vorbis" || codec === "opus" || codec === "flac")) return "ogg";
}
// 확인 기록: 값은 모두 위 고정 목록 안의 짧은 이름이다(목록 밖은 "other"). 파일명·본문·경로는 남기지 않는다.
const recordValue = (value: string | undefined) => value === undefined ? null : identifiableContent.has(value) ? value : "other";
export function audioInputResolved(detail: { expected: string; detected?: string; resolved: string }) {
  console.info("admin_audio_input_resolved", { expected: recordValue(detail.expected), detected: recordValue(detail.detected),
    resolved: recordValue(detail.resolved) });
}
async function confirmAudioFile(path: string, signal: AbortSignal) {
  const inspected = await inspectAudioFile(path, signal, (formatName, codec) => identifiedAudioFormat(formatName, codec) !== undefined,
    identifiableDemuxers);
  const format = identifiedAudioFormat(inspected.formatName, inspected.codec);
  if (!format) throw new AudioUploadError("invalid_file");
  return { format, measurement: inspected.measurement };
}
export async function identifyInlineAudio(bytes: Buffer, signal: AbortSignal): Promise<{ format: ConfirmedAudioFormat; measurement: AudioMeasurement }> {
  const root = await mkdtemp(join(tmpdir(), "dream-admin-audio-"));
  const path = join(root, "source.bin");
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600, signal });
    return await confirmAudioFile(path, signal);
  } finally {
    await rm(path, { force: true });
    await rmdir(root);
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
    let mime: string = audioUploadMime[format];
    let measurement: AudioMeasurement;
    if (type?.ext === format || (format === "m4a" && type?.ext === "mp4")) {
      ({ measurement } = await inspectAudioFile(path, signal, (formatName, codec) =>
        format !== "flac" || (formatName === "flac" && codec === "flac")));
    } else {
      // 큰 파일도 바로 분석과 같은 규칙: 알려진 비오디오는 바로 막고, 나머지는 서버 측정으로 확인한 형식으로만 보낸다.
      if (type && !identifiableContent.has(type.ext)) throw new AudioUploadError("invalid_file");
      const confirmed = await confirmAudioFile(path, signal);
      mime = confirmedAudioMime[confirmed.format];
      measurement = confirmed.measurement;
      audioInputResolved({ expected: format, detected: type?.ext, resolved: confirmed.format });
    }
    return await action({ path, sizeBytes, mime, sha256: hash.digest("base64"), measurement });
  } finally {
    await rm(path, { force: true });
    await rmdir(root);
  }
}
