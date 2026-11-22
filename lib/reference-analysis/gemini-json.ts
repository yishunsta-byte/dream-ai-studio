import "server-only";

import { z } from "zod";
import { readBounded } from "./read-bounded-body";
import type { GeminiSettings } from "./analysis-gemini-settings";

const providerEnvelope = z.object({ candidates: z.array(z.object({
  finishReason: z.literal("STOP"),
  content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }),
})).length(1) });

export type GeminiJsonResult<Output> = { generated: Output } |
  { code: "timed_out" | "model_error" | "invalid_model_response" };

type GeminiJsonOptions<Schema extends z.ZodType> = {
  settings: GeminiSettings;
  instruction: string;
  input: unknown;
  schema: Schema;
  responseJsonSchema?: Readonly<Record<string, unknown>>;
  maxOutputTokens: number;
  responseByteLimit: number;
  signal: AbortSignal;
  send: typeof fetch;
};

export async function requestGeminiJson<Schema extends z.ZodType>({
  settings, instruction, input, schema, responseJsonSchema, maxOutputTokens, responseByteLimit, signal, send,
}: GeminiJsonOptions<Schema>): Promise<GeminiJsonResult<z.output<Schema>>> {
  let raw: Buffer | undefined;
  try {
    signal.throwIfAborted();
    const response = await send(`https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent`, {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
      headers: { "content-type": "application/json", "x-goog-api-key": settings.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: {
          candidateCount: 1, maxOutputTokens, responseMimeType: "application/json", responseJsonSchema: responseJsonSchema ?? z.toJSONSchema(schema),
        },
      }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return { code: signal.aborted ? "timed_out" : "model_error" };
    }
    raw = await readBounded(response.body, responseByteLimit, signal);
  } catch { return { code: signal.aborted ? "timed_out" : "model_error" }; }

  if (!raw) return { code: "invalid_model_response" };
  try {
    const { candidates } = providerEnvelope.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    const output = candidates[0].content.parts.filter(part => !part.thought).map(part => part.text ?? "").join("");
    const generated = schema.parse(JSON.parse(output));
    return JSON.stringify(generated).includes(settings.key) ? { code: "invalid_model_response" } : { generated };
  } catch { return { code: "invalid_model_response" }; }
}
