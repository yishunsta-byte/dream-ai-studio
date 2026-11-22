import "server-only";

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { readBounded } from "./admin-audio-http";
import { AudioUploadError, type VerifiedAudio } from "./admin-audio-media";

const origin = "https://generativelanguage.googleapis.com";
const providerFileName = z.string().regex(/^files\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
const providerFile = z.object({
  name: providerFileName, uri: z.string(), mimeType: z.string(), sizeBytes: z.string().regex(/^\d{1,12}$/),
  sha256Hash: z.string().optional(), state: z.enum(["PROCESSING", "ACTIVE", "FAILED"]),
});

function safeSession(raw: string | null) {
  if (!raw || raw.length > 8192) return null;
  try {
    const url = new URL(raw);
    return url.origin === origin && url.pathname === "/upload/v1beta/files" && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

function sameMime(expected: string, actual: string) {
  return actual === expected || (expected === "audio/wav" && actual === "audio/x-wav") ||
    (expected === "audio/mp4" && actual === "audio/x-m4a");
}

export function createAdminAudioUploadProvider(send: typeof fetch = fetch) {
  const json = async (response: Response, signal: AbortSignal) => {
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new AudioUploadError("provider_error");
    }
    const body = await readBounded(response.body, 64 * 1024, signal);
    if (!body?.length) throw new AudioUploadError("invalid_provider_file");
    try { return JSON.parse(body.toString("utf8")) as unknown; }
    catch { throw new AudioUploadError("invalid_provider_file"); }
  };

  return {
    async upload(key: string, audio: VerifiedAudio, signal: AbortSignal,
      beforeSend: () => Promise<void>, record: (name: string) => Promise<void>) {
      await beforeSend();
      const start = await send(`${origin}/upload/v1beta/files`, { method: "POST", signal, redirect: "error", credentials: "omit", cache: "no-store",
        headers: { "x-goog-api-key": key, "content-type": "application/json", "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(audio.sizeBytes),
          "X-Goog-Upload-Header-Content-Type": audio.mime },
        body: JSON.stringify({ file: { displayName: "Dream Screen audio analysis" } }) });
      const session = start.ok ? safeSession(start.headers.get("x-goog-upload-url")) : null;
      void start.body?.cancel().catch(() => undefined);
      if (!session) throw new AudioUploadError("provider_error");
      await beforeSend();

      const stream = createReadStream(audio.path, { signal });
      const closed = finished(stream, { cleanup: true }).catch(() => undefined);
      let name: string;
      try {
        const request: RequestInit & { duplex: "half" } = { method: "POST", signal, redirect: "error", credentials: "omit", cache: "no-store",
          headers: { "content-length": String(audio.sizeBytes), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
          body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, duplex: "half" };
        const response = await send(session, request);
        const result = z.object({ file: z.object({ name: providerFileName }) }).parse(await json(response, signal));
        name = result.file.name;
        await record(name);
      } catch { throw new AudioUploadError("upload_unconfirmed", true); }
      finally { stream.destroy(); await closed; }

      const uri = `${origin}/v1beta/${name}`;
      const preparation = AbortSignal.any([signal, AbortSignal.timeout(50_000)]);
      try {
        for (;;) {
          preparation.throwIfAborted();
          await beforeSend();
          const metadata = await send(uri, { signal: preparation, redirect: "error", credentials: "omit", cache: "no-store", headers: { "x-goog-api-key": key } });
          const parsed = providerFile.safeParse(await json(metadata, preparation));
          if (!parsed.success) throw new AudioUploadError("invalid_provider_file");
          const file = parsed.data;
          if (file.name !== name || file.uri !== uri || !sameMime(audio.mime, file.mimeType) || Number(file.sizeBytes) !== audio.sizeBytes ||
              (file.sha256Hash && file.sha256Hash !== audio.sha256)) throw new AudioUploadError("invalid_provider_file");
          if (file.state === "ACTIVE") return { fileUri: uri, mime: audio.mime };
          if (file.state === "FAILED") throw new AudioUploadError("provider_error");
          await delay(2500, undefined, { signal: preparation });
        }
      } catch (error) {
        if (preparation.aborted) throw new AudioUploadError("timed_out");
        throw error;
      }
    },
    async cleanup(key: string, name: string) {
      if (!providerFileName.safeParse(name).success) return false;
      try {
        const response = await send(`${origin}/v1beta/${name}`, { method: "DELETE", signal: AbortSignal.timeout(8000),
          redirect: "error", credentials: "omit", cache: "no-store", headers: { "x-goog-api-key": key } });
        void response.body?.cancel().catch(() => undefined);
        return response.ok || response.status === 404;
      } catch { return false; }
    },
  };
}
