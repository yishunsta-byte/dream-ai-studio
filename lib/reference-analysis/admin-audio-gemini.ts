import "server-only";

import { z } from "zod";
import { type AudioPayload, readBounded } from "./admin-audio-http";
import type { GeminiSettings } from "./analysis-gemini-settings";
import { musicModelVersionSchema } from "./music-semantic-contract";

// 기본 보고서·음악 의미 분석 모델 대기. 원본처럼 긴 녹음도 기다리되 함수 한도 300초 안에 둔다.
export const audioProviderDeadlineMs = 120_000;
export type AdminAudioSource = AudioPayload | { fileUri: string; mime: string };

const providerEnvelope = z.object({
  modelVersion: z.unknown().optional(),
  candidates: z.array(z.object({
    finishReason: z.literal("STOP"),
    content: z.object({ parts: z.array(z.object({ text: z.string(), thought: z.boolean().optional() })).min(1) }),
  })).length(1),
});
type AudioProviderFailure = "provider_error" | "invalid_response" | "timed_out";

export async function requestAudioReport<Schema extends z.ZodType>(
  { key, model }: GeminiSettings, audio: AdminAudioSource, schema: Schema,
  instruction: string, maxOutputTokens: number, signal: AbortSignal, send: typeof fetch, responseLimit = 64 * 1024,
): Promise<{ data: z.output<Schema>; modelVersion?: string } | { reason: AudioProviderFailure }> {
  let raw: Buffer | undefined;
  try {
    signal.throwIfAborted();
    const reply = await send(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }, "bytes" in audio
          ? { inlineData: { mimeType: audio.mime, data: audio.bytes.toString("base64") } }
          : { fileData: { mimeType: audio.mime, fileUri: audio.fileUri } }] }],
        generationConfig: { candidateCount: 1, maxOutputTokens, responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema) },
      }),
    });
    if (!reply.ok) { void reply.body?.cancel().catch(() => undefined); return { reason: "provider_error" }; }
    raw = await readBounded(reply.body, responseLimit, signal);
  } catch { return { reason: signal.aborted ? "timed_out" : "provider_error" }; }
  if (!raw) return { reason: "invalid_response" };
  try {
    const parsed = providerEnvelope.parse(JSON.parse(raw.toString("utf8")));
    const data = schema.parse(JSON.parse(parsed.candidates[0].content.parts.filter(part => !part.thought).map(part => part.text).join("")));
    const version = musicModelVersionSchema.safeParse(parsed.modelVersion);
    return { data, ...(version.success && !version.data.includes(key) && { modelVersion: version.data }) };
  } catch { return { reason: signal.aborted ? "timed_out" : "invalid_response" }; }
}
