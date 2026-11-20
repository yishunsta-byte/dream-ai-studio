import "server-only";

import { z } from "zod";
import { geminiPrograms, type CredentialModels } from "./analysis-credential-contract";

const modelMetadata = z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()) });
const upstreamError = z.object({ error: z.object({ details: z.array(z.object({ reason: z.string().optional() })).optional() }) });
const modelOrigin = "https://generativelanguage.googleapis.com";

async function providerJson(response: Response, signal: AbortSignal) {
  if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel();
    throw new Error("Invalid model metadata response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return JSON.parse(Buffer.concat(chunks, length).toString("utf8")) as unknown;
      length += value.length;
      if (length > 64 * 1024) throw new Error("Model metadata response too large");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

type Failure = { code: "invalid_key" | "model_not_found" | "provider_error" | "timed_out"; field?: string };

export async function validateGeminiCredential(apiKey: string, models: CredentialModels, send: typeof fetch = fetch): Promise<Failure | undefined> {
  const signal = AbortSignal.timeout(7_000);
  const results = await Promise.all(geminiPrograms.map(async (program): Promise<Failure | undefined> => {
    const model = models[program];
    if (!model) return;
    const url = `${modelOrigin}/v1beta/models/${encodeURIComponent(model)}`;
    const field = `models.${program}`;
    try {
      const response = await send(url, { method: "GET", redirect: "error", credentials: "omit",
        cache: "no-store", headers: { "x-goog-api-key": apiKey, accept: "application/json" }, signal });
      if (response.redirected || (response.url && response.url !== url)) {
        await response.body?.cancel();
        return { code: "provider_error" };
      }
      if (response.status === 400) {
        const error = upstreamError.safeParse(await providerJson(response, signal));
        if (error.data?.error.details?.some(item => item.reason === "API_KEY_INVALID")) return { code: "invalid_key", field: "apiKey" };
        return { code: "provider_error" };
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) return { code: "invalid_key", field: "apiKey" };
        if (response.status === 404) return { code: "model_not_found", field };
        return { code: "provider_error" };
      }
      const metadata = modelMetadata.parse(await providerJson(response, signal));
      if (metadata.name !== `models/${model}` || !metadata.supportedGenerationMethods.includes("generateContent")) {
        return { code: "model_not_found", field };
      }
    } catch {
      return { code: signal.aborted ? "timed_out" : "provider_error" };
    }
  }));
  return results.find(result => result?.code === "invalid_key") ?? results.find(Boolean);
}
