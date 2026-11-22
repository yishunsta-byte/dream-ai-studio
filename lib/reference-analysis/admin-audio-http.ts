import "server-only";

import { fileTypeFromBuffer } from "file-type";
import { resolveServerAuth } from "../auth/resolve";
import { rejectForeignWrite } from "../public-showcase/admin-publication-http";
import type { AudioMeasurement } from "./admin-audio-details-contract";
import { AudioUploadError, inlineAudioProbeDeadlineMs, measureInlineAudio } from "./admin-audio-media";
import { audioFormatFromFilename, audioUploadMime } from "./admin-audio-upload-contract";
import { referenceFileName, referenceUploadByteLimit } from "./input";
import { MUSIC_EXTERNAL_CONSENT_HEADER } from "./music-semantic-contract";

export type AudioPayload = { bytes: Buffer; mime: string };
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
        if (format?.ext !== expected) return audioJson({ error: "invalid_file" }, 422);
        const audio = { bytes, mime: audioUploadMime[expected] };
        let measurement: AudioMeasurement | undefined;
        if (expected === "flac") {
          try {
            measurement = await measureInlineAudio(audio, AbortSignal.any([request.signal, AbortSignal.timeout(inlineAudioProbeDeadlineMs)]));
          } catch (error) {
            if (error instanceof AudioUploadError && error.code === "invalid_file") return audioJson({ error: "invalid_file" }, 422);
            return audioJson({ error: "media_unavailable" }, 503);
          }
        }
        return await run(audio, request.signal, measurement);
      } catch { return audioJson({ error: failure }, 422); }
      finally { busy = false; }
    });
  }
  return { withAdmin, post };
}
