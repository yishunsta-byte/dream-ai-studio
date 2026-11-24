import "server-only";

import { fileTypeFromBuffer } from "file-type";
import { resolveServerAuth } from "../auth/resolve";
import { rejectForeignWrite } from "../public-showcase/admin-publication-http";
import type { AudioMeasurement } from "./admin-audio-details-contract";
import { AudioUploadError, identifyInlineAudio, inlineAudioProbeDeadlineMs, measureInlineAudio } from "./admin-audio-media";
import { audioFormatFromFilename, audioUploadMime } from "./admin-audio-upload-contract";
import { referenceFileName, referenceUploadByteLimit } from "./input";
import { MUSIC_EXTERNAL_CONSENT_HEADER } from "./music-semantic-contract";

export type AudioPayload = { bytes: Buffer; mime: string };

// 오디오 422 2차: 검사 도구 전 단계의 거절은 이유를 남기지 않아 운영에서 원인을 가릴 수 없었다.
// 단계·기대 형식·판별 형식·오류 종류를 아래 고정 목록 값으로만 남긴다(목록 밖은 "other"). 파일명·본문·경로·원문은 남기지 않는다.
const recordedFormats = new Set(["mp3", "wav", "m4a", "mp4", "flac", "aac", "opus", "ogg", "oga", "webm", "mkv", "mov", "avi", "amr", "aiff"]);
const recordedErrors = new Set(["Error", "TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError", "ZodError", "AudioUploadError"]);
const fixedValue = (value: unknown, allowed: Set<string>) => value === undefined || value === null ? null
  : typeof value === "string" && allowed.has(value) ? value : "other";
export function audioInputRejected(stage: "file_type" | "probe" | "identify" | "analysis",
  detail: { expected?: string; detected?: string; error?: unknown }) {
  const name = detail.error instanceof AudioUploadError ? "AudioUploadError" : detail.error instanceof Error ? detail.error.name : detail.error;
  console.warn("admin_audio_input_rejected", { stage, expected: fixedValue(detail.expected, recordedFormats),
    detected: fixedValue(detail.detected, recordedFormats), error: fixedValue(name, recordedErrors) });
}
// file-type은 일반 MP4 표시(isom 등)의 M4A를 "mp4"로 판별한다. 측정 단계(withVerifiedAudio)와 같은 기준으로 받는다.
export const audioContentMatches = (expected: string, detected: string | undefined) =>
  detected === expected || (expected === "m4a" && detected === "mp4");
// 이름과 달라도 서버 측정으로 확인해 볼 내용 판별 값(지원 4형식). 그 밖의 판별 값(이미지·문서·영상·aac·ogg 등)은 바로 막는다.
const identifiableContent = new Set(["mp3", "wav", "m4a", "mp4", "flac"]);
export function audioInputResolved(detail: { expected: string; detected?: string; resolved: string }) {
  console.info("admin_audio_input_resolved", { expected: fixedValue(detail.expected, recordedFormats),
    detected: fixedValue(detail.detected, recordedFormats), resolved: fixedValue(detail.resolved, recordedFormats) });
}
type AudioRun = (audio: AudioPayload, signal: AbortSignal, measurement?: AudioMeasurement) => Promise<Response>;

export const audioJson = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

export async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { complete = true; return Buffer.concat(chunks, size); }
      size += value.byteLength;
      if (size > limit) return undefined;
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

export type AdminAudioAccessOptions = {
  authenticate?: typeof resolveServerAuth;
  env?: Readonly<Record<string, string | undefined>>;
};

export function createAdminAudioAccess({ authenticate = resolveServerAuth, env = process.env }: AdminAudioAccessOptions) {
  let busy = false;
  async function withAdmin(handle: (owner: string) => Promise<Response>) {
    try {
      const auth = await authenticate();
      if (auth.kind === "local") return audioJson({ error: "AUTH_REQUIRED" }, 401);
      if (auth.kind === "denied") return audioJson({ error: auth.code }, auth.status);
      return await handle(auth.userId);
    } catch { return audioJson({ error: "unavailable" }, 503); }
  }
  async function post(request: Request, prepare: (owner: string) => Promise<AudioRun | Response>, failure: string) {
    return withAdmin(async owner => {
      const blocked = rejectForeignWrite(request, env, ["application/octet-stream"]);
      if (blocked) return blocked;
      if (request.headers.get(MUSIC_EXTERNAL_CONSENT_HEADER) !== "true") return audioJson({ error: "consent_required" }, 400);
      const run = await prepare(owner);
      if (run instanceof Response) return run;
      let name: string;
      try { name = decodeURIComponent(request.headers.get("x-dream-filename") ?? ""); }
      catch { return audioJson({ error: "invalid_file" }, 400); }
      const expected = audioFormatFromFilename(name);
      if (!expected || !referenceFileName.safeParse(name).success) return audioJson({ error: "invalid_file" }, 400);
      const declared = request.headers.get("content-length");
      if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > referenceUploadByteLimit)) {
        return audioJson({ error: "too_large" }, 413);
      }
      if (busy) return audioJson({ error: "analysis_busy" }, 429);
      busy = true;
      try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
        const bytes = await readBounded(request.body, referenceUploadByteLimit, signal);
        if (!bytes) return audioJson({ error: "too_large" }, 413);
        const format = await fileTypeFromBuffer(bytes).catch(() => undefined);
        let audio = { bytes, mime: audioUploadMime[expected] };
        let measurement: AudioMeasurement | undefined;
        if (!audioContentMatches(expected, format?.ext)) {
          if (format && !identifiableContent.has(format.ext)) {
            audioInputRejected("file_type", { expected, detected: format.ext });
            return audioJson({ error: "invalid_file" }, 422);
          }
          try {
            const identified = await identifyInlineAudio(bytes, AbortSignal.any([request.signal, AbortSignal.timeout(inlineAudioProbeDeadlineMs)]));
            audio = { bytes, mime: audioUploadMime[identified.format] };
            measurement = identified.measurement;
            audioInputResolved({ expected, detected: format?.ext, resolved: identified.format });
          } catch (error) {
            if (error instanceof AudioUploadError && error.code === "invalid_file") {
              audioInputRejected("identify", { expected, detected: format?.ext });
              return audioJson({ error: "invalid_file" }, 422);
            }
            return audioJson({ error: "media_unavailable" }, 503);
          }
        }
        // FLAC과 모호한 M4A(일반 MP4 표시라 mp4로 판별)는 보고서 버전과 관계없이 오디오 전용 스트림·디코딩을 확인한 뒤에만 보낸다.
        // 측정 도구를 쓸 수 없으면 보내지 않고 503으로 멈춘다.
        else if (expected === "flac" || (expected === "m4a" && format?.ext === "mp4")) {
          try {
            measurement = await measureInlineAudio(audio, AbortSignal.any([request.signal, AbortSignal.timeout(inlineAudioProbeDeadlineMs)]), true);
          } catch (error) {
            if (error instanceof AudioUploadError && error.code === "invalid_file") {
              audioInputRejected("probe", { expected, detected: format?.ext });
              return audioJson({ error: "invalid_file" }, 422);
            }
            return audioJson({ error: "media_unavailable" }, 503);
          }
        }
        return await run(audio, request.signal, measurement);
      } catch (error) {
        audioInputRejected("analysis", { expected, error });
        return audioJson({ error: failure }, 422);
      }
      finally { busy = false; }
    });
  }
  return { withAdmin, post };
}
