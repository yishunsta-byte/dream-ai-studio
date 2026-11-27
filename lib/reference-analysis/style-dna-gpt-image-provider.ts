import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { readBounded } from "./read-bounded-body";
import { styleDnaUsageGeneratedModels, type StyleDnaUsageEstimate, type StyleDnaUsageGeneration } from "./style-dna-contract";
import { FluxGenerationError } from "./style-dna-flux-provider";
import { measureStyleDnaImage, type MeasuredStyleDnaImage } from "./style-dna-provider";
import type { SeedreamCredentials } from "./style-dna-seedream-provider";

// GPT Image 2.6 sunburst 시험 이미지 서버 어댑터(P2-02, 합성 공급자로만 검증, 실제 OpenAI 호출 0).
// 근거(2026-11-27 열람):
// - 모델 developers.openai.com/api/docs/models/gpt-image-2.6-sunburst: 모델 ID gpt-image-2.6-sunburst,
//   v1/images/generations·v1/images/edits 지원(Responses·Batch 미지원).
// - API developers.openai.com/api/reference/resources/images/methods/generate · …/edit:
//   GPT 이미지 모델은 언제나 base64(data[].b64_json)로 돌려주고 url은 쓰지 않는다(response_format 미지원).
//   size 1024x1024, n 기본 1, output_format 기본 png. edit은 JSON 본문 images[{ image_url }](base64 data URL 가능, 최대 16장).
//   usage { input_tokens, input_tokens_details { text_tokens, image_tokens }, output_tokens, output_tokens_details?, total_tokens }.
// - 가격 developers.openai.com/api/docs/pricing(표준, 1M 토큰당 USD): 텍스트 입력 5.00, 이미지 입력 8.00, 이미지 출력 30.00.
//   텍스트 출력 단가는 없다("-"). 캐시 단가는 Responses 경로 주석이라 직접 Images API 계산에 쓰지 않는다.
//   1M 토큰당 USD는 토큰당 micros와 같은 수라(5.00 USD/1M = 5 micros/토큰) 정수 곱으로 정확히 계산된다.
// 요청 ID(멱등) 머리글은 문서에 없다. 그래서 보낸 뒤 응답을 잃으면 생성·과금 여부를 알 수 없어 예약을 막아 둔다(FLUX와 같은 방식).
export const gptImageTestModel = "gpt-image-2.6";
export const gptImageModelId = styleDnaUsageGeneratedModels[gptImageTestModel].modelId;
export const gptImageGenerationEndpoint = "https://api.openai.com/v1/images/generations";
export const gptImageEditEndpoint = "https://api.openai.com/v1/images/edits";
export const gptImageOutput = { width: 1024, height: 1024, size: styleDnaUsageGeneratedModels[gptImageTestModel].size, format: "png" } as const;
export const gptImagePriceTable = "openai-gpt-image-2.6-sunburst-2026-11-27";
// 토큰당 micros(표준 단가). 캐시 단가·텍스트 출력 단가는 계산에 쓰지 않는다.
export const gptImageRates = { textInput: 5, imageInput: 8, imageOutput: 30 } as const;
const deadlineMs = 45_000; // 경로 maxDuration 55초 안
const maxPngBytes = 16 * 1024 * 1024;
const maxBase64Chars = 4 * Math.ceil(maxPngBytes / 3);
const maxResponseBytes = maxBase64Chars + 64 * 1024;
const maxReferenceDataUrl = 20_971_520; // edit images[].image_url maxLength
const maxErrorBytes = 4096;
const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const gptImageEstimate = (): StyleDnaUsageEstimate =>
  ({ kind: "usage_based", priceTable: gptImagePriceTable, currency: "USD", unit: "micros" });

/** GPT Image 실패. keepPending이면 보낸 뒤 결과를 확정하지 못한 경우라 같은 기록의 예약을 막아 둔다. */
export class GptImageGenerationError extends FluxGenerationError {}

const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
// 응답 본문의 다른 위쪽 칸(created, background, quality 등)은 판단에 쓰지 않는다. 결과 판단에 쓰는 칸만 엄격히 본다.
const success = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1).max(maxBase64Chars), url: z.undefined().optional() })).length(1),
  size: z.literal(gptImageOutput.size).optional(),
  output_format: z.literal(gptImageOutput.format).optional(),
  usage: z.unknown().optional(),
});
const usageShape = z.object({
  input_tokens: count,
  input_tokens_details: z.object({ text_tokens: count, image_tokens: count }),
  output_tokens: count,
  output_tokens_details: z.object({ image_tokens: count.optional(), text_tokens: count.optional() }).optional(),
  total_tokens: count,
});
const providerError = z.object({ error: z.object({ code: z.string().max(200).nullable().optional(), type: z.string().max(200).nullable().optional() }) });

type GptImageUsage = Pick<StyleDnaUsageGeneration, "usage" | "actualCostMicros">;
/** 공급자 usage → 결과 usage·실제 금액. 칸 이름은 공식 API 참조 그대로다.
 *  - 토큰 칸은 모두 0 이상 정수이고 합이 맞을 때만 싣는다(text+image=input, input+output=total). 어긋나면 토큰 칸도 싣지 않는다.
 *  - 금액은 위가 성립하고, 출력 상세가 있으면 두 칸이 모두 있으며 텍스트 출력이 0이고 이미지 출력이 output_tokens와 같을 때만 계산한다
 *    (텍스트 출력 단가가 없으므로). 출력 상세가 없으면 output_tokens 전부를 이미지 출력으로 계산한다
 *    (공식 안내서의 예: 출력 823토큰 → $0.02469 = 823×30 micros).
 *  - usage가 없거나 모양이 다르면 generatedImages만 남기고 금액은 뺀다(추측하지 않는다). */
export function gptImageUsage(raw: unknown): GptImageUsage {
  const parsed = usageShape.safeParse(raw);
  if (!parsed.success) return { usage: { generatedImages: 1 } };
  const { input_tokens, input_tokens_details: input, output_tokens, output_tokens_details: output, total_tokens } = parsed.data;
  const sums = input.text_tokens + input.image_tokens === input_tokens && input_tokens + output_tokens === total_tokens;
  if (!sums) return { usage: { generatedImages: 1 } };
  const usage = { generatedImages: 1, inputTokens: input.text_tokens, inputImageTokens: input.image_tokens, outputTokens: output_tokens };
  // 출력 상세가 오면 두 칸이 모두 있어야 한다({}·한 칸만은 확인 불충분 → 금액 없음).
  const imageOnlyOutput = output === undefined
    || (output.text_tokens === 0 && output.image_tokens === output_tokens);
  if (!imageOnlyOutput) return { usage };
  const cost = input.text_tokens * gptImageRates.textInput + input.image_tokens * gptImageRates.imageInput + output_tokens * gptImageRates.imageOutput;
  return Number.isSafeInteger(cost) ? { usage, actualCostMicros: cost } : { usage };
}

async function decodePng(b64: string) {
  if (b64.length % 4 !== 0 || !canonicalBase64.test(b64)) throw new Error("Invalid base64");
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length || bytes.length > maxPngBytes || bytes.toString("base64") !== b64) throw new Error("Invalid base64");
  const options = { limitInputPixels: gptImageOutput.width * gptImageOutput.height, failOn: "warning" } as const;
  const metadata = await sharp(bytes, options).timeout({ seconds: 7 }).metadata();
  if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1 || metadata.width !== gptImageOutput.width || metadata.height !== gptImageOutput.height) {
    throw new Error("Unexpected PNG");
  }
  const { info } = await sharp(bytes, options).timeout({ seconds: 7 }).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== gptImageOutput.width || info.height !== gptImageOutput.height) throw new Error("Unexpected PNG");
  return { bytes, png: { sha256: createHash("sha256").update(bytes).digest("hex"), width: info.width, height: info.height, byteLength: bytes.length } };
}

async function rejection(response: Response, signal: AbortSignal) {
  const raw = await readBounded(response.body, maxErrorBytes, signal).catch(() => undefined);
  let code = "";
  try { const parsed = raw ? providerError.parse(JSON.parse(raw.toString("utf8"))).error : undefined; code = `${parsed?.code ?? ""} ${parsed?.type ?? ""}`; }
  catch { /* 본문 없는 오류도 상태 코드로 분류 */ }
  if (response.status === 400 && /moderation_blocked|content_policy_violation|safety/i.test(code)) return new GptImageGenerationError("content_rejected", false);
  if (response.status === 429) return new GptImageGenerationError("provider_busy", false);
  // 5xx·408은 공급자가 이미 처리(생성·과금)했는지 알 수 없다. 예약을 막아 두고 다시 보내지 않는다.
  if (response.status >= 500 || response.status === 408) return new GptImageGenerationError("generation_submission_unknown", true);
  return new GptImageGenerationError("provider_rejected", false);
}

export type GptImageGenerated = GptImageUsage & { png: StyleDnaUsageGeneration["png"]; image: MeasuredStyleDnaImage };

export function createGptImageAdapter(send: typeof fetch, options: { deadlineMs?: number } = {}) {
  return {
    async generate({ apiKey, prompt, reference, outerSignal }: {
      apiKey: string; prompt: string; reference?: Buffer; outerSignal?: AbortSignal;
    }): Promise<GptImageGenerated> {
      // 여기까지의 실패는 요청을 보내기 전이다.
      if (outerSignal?.aborted || !/^[\x21-\x7e]{1,1024}$/.test(apiKey) || !prompt.trim() || prompt.length > 32_000
        || (reference && !reference.length)) {
        throw new GptImageGenerationError("generation_not_sent", false);
      }
      const dataUrl = reference && `data:image/webp;base64,${reference.toString("base64")}`;
      if (dataUrl && dataUrl.length > maxReferenceDataUrl) throw new GptImageGenerationError("generation_not_sent", false);
      const body = JSON.stringify({ model: gptImageModelId, prompt, size: gptImageOutput.size, n: 1, output_format: gptImageOutput.format,
        ...(dataUrl && { images: [{ image_url: dataUrl }] }) });
      const timer = AbortSignal.timeout(Math.min(deadlineMs, Math.max(1, options.deadlineMs ?? deadlineMs)));
      const signal = outerSignal ? AbortSignal.any([outerSignal, timer]) : timer;
      let response: Response;
      try {
        response = await send(dataUrl ? gptImageEditEndpoint : gptImageGenerationEndpoint, {
          method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
          headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${apiKey}` }, body,
        });
      } catch {
        // 연결 오류·시간 초과는 요청이 공급자에 닿았는지 알 수 없다. 자동으로 다시 보내지 않고 예약을 막아 둔다.
        throw new GptImageGenerationError("generation_submission_unknown", true);
      }
      if (!response.ok) throw await rejection(response, signal);
      const declared = response.headers.get("content-length");
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if ((declared !== null && (!/^\d{1,10}$/.test(declared) || Number(declared) > maxResponseBytes)) || type !== "application/json") {
        void response.body?.cancel().catch(() => undefined);
        throw new GptImageGenerationError("invalid_model_response", true);
      }
      let raw: Buffer | undefined;
      try { raw = await readBounded(response.body, maxResponseBytes, signal); }
      catch { throw new GptImageGenerationError("generation_result_lost", true); }
      if (!raw?.length) throw new GptImageGenerationError("invalid_model_response", true);
      try {
        const parsed = success.parse(JSON.parse(raw.toString("utf8")));
        const { bytes, png } = await decodePng(parsed.data[0].b64_json);
        const image = await measureStyleDnaImage(bytes, "image/png");
        return { png, image, ...gptImageUsage(parsed.usage) };
      } catch { throw new GptImageGenerationError("invalid_model_response", true); }
    },
  };
}

export type GptImageGenerator = { credentials: SeedreamCredentials; adapter: ReturnType<typeof createGptImageAdapter> };
