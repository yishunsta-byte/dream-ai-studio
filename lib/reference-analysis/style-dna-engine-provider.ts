import "server-only";

import { z } from "zod";
import { readBounded } from "./read-bounded-body";
import type { GeminiSettings } from "./analysis-gemini-settings";
import type { StyleDnaEngine } from "./style-dna-engine-credential-contract";

export type ExternalStyleDnaSettings = GeminiSettings & { provider: StyleDnaEngine; isCurrent: () => Promise<boolean> };
export type StyleDnaEngineFailure = "stale_credential" | "storage_unavailable" | "model_error" | "timed_out" | "invalid_model_response";

const chatEnvelope = z.object({ choices: z.array(z.object({ finish_reason: z.literal("stop"),
  message: z.object({ content: z.string(), refusal: z.string().nullish() }),
})).length(1) });
const messagesEnvelope = z.object({ stop_reason: z.literal("end_turn"),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1).max(32) });

const openaiTarget = "https://api.openai.com/v1/chat/completions";
const anthropicTarget = "https://api.anthropic.com/v1/messages";
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

function responseText(provider: StyleDnaEngine, envelope: unknown) {
  if (provider === "openai") {
    const { message } = chatEnvelope.parse(envelope).choices[0];
    return message.refusal ? "" : message.content;
  }
  return messagesEnvelope.parse(envelope).content.filter(item => item.type === "text").map(item => item.text ?? "").join("");
}

export async function requestStyleDnaEngine({ settings, instruction, input, image, maxTokens, responseLimit, signal, send }: {
  settings: ExternalStyleDnaSettings;
  instruction: string;
  input: string;
  image?: Buffer;
  maxTokens: number;
  responseLimit: number;
  signal: AbortSignal;
  send: typeof fetch;
}): Promise<{ output: unknown } | { code: StyleDnaEngineFailure }> {
  const base64 = image?.toString("base64");
  const headers = { "content-type": "application/json" };
  const text = { type: "text", text: input };
  const chat = settings.provider === "openai";
  const command = chat ? {
    model: settings.model, store: false, max_completion_tokens: maxTokens, response_format: { type: "json_object" },
    messages: [{ role: /^gpt-4/i.test(settings.model) ? "system" : "developer", content: instruction },
      { role: "user", content: base64 ? [text, { type: "image_url", image_url: { url: `data:image/webp;base64,${base64}` } }] : input }],
  } : {
    model: settings.model, max_tokens: maxTokens, system: instruction,
    messages: [{ role: "user", content: base64 ? [text, { type: "image",
      source: { type: "base64", media_type: "image/webp", data: base64 } }] : input }],
  };
  const body = JSON.stringify(command);
  if (signal.aborted) return { code: "timed_out" };
  let current: boolean;
  try { current = await settings.isCurrent(); }
  catch { return { code: "storage_unavailable" }; }
  if (!current) return { code: "stale_credential" };
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await send(chat ? openaiTarget : anthropicTarget, { method: "POST", redirect: "error",
      credentials: "omit", cache: "no-store", signal,
      headers: chat ? { ...headers, authorization: `Bearer ${settings.key}` }
        : { ...headers, "x-api-key": settings.key, "anthropic-version": "2023-06-01" },
      body });
  } catch { return { code: signal.aborted ? "timed_out" : "model_error" }; }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    return { code: "model_error" };
  }
  try {
    const data = await readBounded(response.body, responseLimit, signal);
    if (!data) return { code: signal.aborted ? "timed_out" : "invalid_model_response" };
    const content = responseText(settings.provider, JSON.parse(fatalUtf8.decode(data))).trim();
    const json = content.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i)?.[1] ?? content;
    const output: unknown = JSON.parse(json, (_key, value: unknown) => {
      if (typeof value === "string" && (!value.isWellFormed() || value.includes("\0") || value.includes(settings.key))) {
        throw new Error("Invalid output field");
      }
      return value;
    });
    if (JSON.stringify(output).includes(settings.key)) return { code: "invalid_model_response" };
    signal.throwIfAborted();
    return { output };
  } catch { return { code: signal.aborted ? "timed_out" : "invalid_model_response" }; }
}
