import "server-only";

import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import sharp from "sharp";
import { z } from "zod";
import { readBounded } from "./read-bounded-body";
import { styleDnaGeneratedModels, type StyleDnaGenerationEstimate, type StyleDnaGenerationFailure } from "./style-dna-contract";
import { measureStyleDnaImage } from "./style-dna-provider";
import type { SeedreamCredentials } from "./style-dna-seedream-provider";

export const fluxTestModel = "flux-2-pro";
export const fluxEndpoint = "https://api.bfl.ai/v1/flux-2-pro";
export const fluxOutput = { width: 1024, height: 1024, size: styleDnaGeneratedModels[fluxTestModel].size } as const;
const priceTable = "bfl-flux2-pro-2026-11-26";
const megapixel = 1024 ** 2;
const maxImageBytes = 16 * 1024 ** 2;
const maxJsonBytes = 64 * 1024;
const resultLifetimeMs = 10 * 60_000;
const statuses = z.enum(["Pending", "Reasoning", "Generating", "Ready", "Task not found", "Request Moderated",
  "Content Moderated", "No Card Generated", "Error", "Failed"]);
const taskId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const accepted = z.object({ id: taskId, polling_url: z.string() });
const task = z.object({ id: taskId, status: statuses, result: z.unknown().optional() });
const sample = z.object({ sample: z.string() });

type Dimensions = { width: number; height: number };
function roundedMegapixels({ width, height }: Dimensions) {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(pixels)) {
    throw new Error("Invalid FLUX.2 image dimensions");
  }
  return Math.min(4, Math.ceil(pixels / megapixel));
}

export function fluxEstimate(reference?: Dimensions, output: Dimensions = fluxOutput): StyleDnaGenerationEstimate {
  const outputMicros = 30_000 + 15_000 * (roundedMegapixels(output) - 1);
  const referenceMicros = reference ? 15_000 * roundedMegapixels(reference) : 0;
  return { priceTable, currency: "USD", unit: "micros", referenceCount: reference ? 1 : 0, outputMicros, referenceMicros,
    totalMicros: outputMicros + referenceMicros };
}

export async function fluxReferenceDimensions(reference: Buffer): Promise<Dimensions> {
  const { width, height, format } = await sharp(reference, { limitInputPixels: 16 * megapixel }).metadata();
  if (!width || !height || format !== "webp") throw new Error("Invalid normalized reference");
  return { width, height };
}

export class FluxGenerationError extends Error {
  constructor(readonly code: StyleDnaGenerationFailure, readonly keepPending: boolean) { super(code); }
}

function httpsUrl(raw: string): URL {
  if (raw.length > 4096 || /[\\\s]/.test(raw)) throw new Error("Invalid provider address");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw new Error("Invalid provider address");
  return url;
}

function pollUrl(raw: string, id: string) {
  const url = httpsUrl(raw);
  if (!/^api(?:\.(?:eu|us)[0-9]{0,3})?\.bfl\.ai$/.test(url.hostname) ||
    url.pathname !== "/v1/get_result" || !/^\?id=[a-zA-Z0-9_-]+$/.test(url.search) || url.searchParams.get("id") !== id) {
    throw new Error("Invalid polling address");
  }
  return url;
}

function resultUrl(raw: string, now: number) {
  const url = httpsUrl(raw);
  if (!/^delivery\.[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.bfl\.ai$/.test(url.hostname) || url.pathname === "/" || !url.search) {
    throw new Error("Invalid delivery address");
  }
  // Some signatures carry an explicit Unix expiry. Other signatures are checked by the delivery server.
  const expiry = url.searchParams.get("Expires");
  if (expiry !== null && (!/^\d{1,12}$/.test(expiry) || Number(expiry) * 1000 <= now)) {
    throw new FluxGenerationError("generation_result_lost", true);
  }
  return url;
}

async function boundedResponse(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get("content-length")) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Oversized provider response");
  }
  const bytes = await readBounded(response.body, limit, signal);
  if (!bytes?.length) throw new Error("Invalid provider response size");
  return bytes;
}

async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    void response.body?.cancel().catch(() => {});
    throw new Error("Invalid provider response type");
  }
  return JSON.parse((await boundedResponse(response, maxJsonBytes, signal)).toString("utf8"));
}

export function createFluxAdapter(send: typeof fetch, options: { deadlineMs?: number; pollDelayMs?: number; now?: () => number } = {}) {
  const deadlineMs = Math.min(40_000, Math.max(1, options.deadlineMs ?? 40_000));
  const pollDelayMs = Math.max(1, options.pollDelayMs ?? 500);
  const now = options.now ?? Date.now;
  return { async generate({ apiKey, prompt, reference, outerSignal }: {
    apiKey: string; prompt: string; reference?: Buffer; outerSignal?: AbortSignal;
  }) {
    if (outerSignal?.aborted || !/^[\x21-\x7e]{1,1024}$/.test(apiKey) || (reference && reference.length > maxImageBytes)) {
      throw new FluxGenerationError("generation_not_sent", false);
    }
    const timeout = AbortSignal.timeout(deadlineMs);
    const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
    const fetchOptions = { signal, cache: "no-store", credentials: "omit", redirect: "error" } as const;
    let received = false;
    const submittedAt = now();
    try {
      const response = await send(fluxEndpoint, { ...fetchOptions, method: "POST", headers: {
        "x-key": apiKey, "content-type": "application/json", accept: "application/json",
      }, body: JSON.stringify({ prompt, width: fluxOutput.width, height: fluxOutput.height, output_format: "png",
        ...(reference && { input_image: reference.toString("base64") }) }) });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 429) throw new FluxGenerationError("provider_busy", false);
        if ([400, 401, 402, 403, 422].includes(response.status)) throw new FluxGenerationError("provider_rejected", false);
        throw new FluxGenerationError("generation_submission_unknown", true);
      }

      received = true;
      const submission = accepted.parse(await json(response, signal));
      const poll = pollUrl(submission.polling_url, submission.id);
      let download: URL | undefined;
      // The integration guide authenticates polls. Send the key only after validating the API host, path and task ID.
      for (let checks = 0; checks < 80; checks++) {
        signal.throwIfAborted();
        const response = await send(poll.href, { ...fetchOptions, headers: { accept: "application/json", "x-key": apiKey } }).catch(() => undefined);
        if (response && !response.ok) {
          void response.body?.cancel().catch(() => {});
          if (response.status !== 404 && response.status !== 429 && response.status < 500) throw new FluxGenerationError("generation_result_lost", true);
        } else if (response) {
          const status = task.parse(await json(response, signal));
          if (status.id !== submission.id) throw new FluxGenerationError("invalid_model_response", true);
          if (status.status === "Ready") {
            download = resultUrl(sample.parse(status.result).sample, now());
            break;
          }
          if (status.status === "Request Moderated" || status.status === "Content Moderated") {
            throw new FluxGenerationError("content_rejected", false);
          }
          if (status.status === "Error" || status.status === "Failed" || status.status === "No Card Generated") {
            throw new FluxGenerationError("provider_rejected", false);
          }
        }
        await wait(pollDelayMs, undefined, { signal });
      }
      if (!download || now() >= submittedAt + resultLifetimeMs) throw new FluxGenerationError("generation_result_lost", true);
      signal.throwIfAborted();
      const file = await send(download.href, { ...fetchOptions, headers: { accept: "image/png" } });
      if (file.status === 401 || file.status === 403 || file.status === 404 || file.status === 410) {
        void file.body?.cancel().catch(() => {});
        throw new FluxGenerationError("generation_result_lost", true);
      }
      const contentType = file.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!file.ok || (contentType !== "image/png" && contentType !== "application/octet-stream")) {
        void file.body?.cancel().catch(() => {});
        throw new FluxGenerationError("invalid_model_response", true);
      }
      const bytes = await boundedResponse(file, maxImageBytes, signal);
      const { width, height, pages, format } = await sharp(bytes, { limitInputPixels: megapixel }).metadata();
      if (format !== "png" || width !== fluxOutput.width || height !== fluxOutput.height || (pages ?? 1) !== 1) {
        throw new FluxGenerationError("invalid_model_response", true);
      }
      const image = await measureStyleDnaImage(bytes, "image/png", fluxOutput.width);
      signal.throwIfAborted();
      return { image, png: { sha256: createHash("sha256").update(bytes).digest("hex"), width, height, byteLength: bytes.length },
        usage: { generatedImages: 1 } };
    } catch (error) {
      if (error instanceof FluxGenerationError) throw error;
      throw new FluxGenerationError(received
        ? signal.aborted ? "generation_result_lost" : "invalid_model_response"
        : "generation_submission_unknown", true);
    }
  } };
}

export type FluxGenerator = { credentials: SeedreamCredentials; adapter: ReturnType<typeof createFluxAdapter> };
