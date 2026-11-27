import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { readBounded } from "./read-bounded-body";
import { measureStyleDnaImage, type MeasuredStyleDnaImage } from "./style-dna-provider";
import { styleDnaGeneratedModels, type StyleDnaGenerationEstimate, type StyleDnaGenerationFailure } from "./style-dna-contract";

// Seedream 5.5 시험 이미지 서버 어댑터(합성 공급자로만 검증, 실제 호출·키 등록은 후속).
// 근거: BytePlus ModelArk Image generation API(2026-11-24 갱신본, 2026-11-25 열람)와 모델 가격표.
// - POST https://ark.ap-southeast.bytepluses.com/api/v3/images/generations, Authorization: Bearer
// - size는 "<width>x<height>"(총 921,600~4,624,220 픽셀), output_format png(5.5 기본), response_format b64_json
// - 참조는 data:image/<소문자 형식>;base64,… (5.5는 최대 10장, 여기서는 0 또는 1장)
// - 5.5는 sequential_image_generation을 설정할 수 없어 보내지 않는다. watermark 기본 true라 비교용으로 false를 명시한다.
// - 요청 ID(멱등) 헤더는 문서에 없다. 그래서 응답을 잃으면 공급자에서 생성·과금됐는지 알 수 없다.
// 이름·모델 ID·크기는 화면과 같이 쓰는 계약(styleDnaGeneratedModels)에서 가져온다.
export const seedreamTestModel = "seedream-5.5";
export const seedreamModelId = styleDnaGeneratedModels[seedreamTestModel].modelId;
export const seedreamEndpoint = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
export const seedreamOutput = { width: 1024, height: 1024, size: styleDnaGeneratedModels[seedreamTestModel].size, format: "png" } as const;
// 가격표 행(dola-seedream-5-5-261028): 참조 $0.008/장, 출력 921,600 ≤ P ≤ 2,601,123.84 $0.020, 그 초과 ~4,624,220.16 $0.035.
// 장당 상한은 두지 않는다(주인님 결정 2026-11-25). 예상가이며 실제 청구와 별개다.
export const seedreamPriceTable = "byteplus-modelark-2026-11-25";
const referenceMicros = 8_000;
const outputTiers = [{ maxPixels: 2_601_123.84, micros: 20_000 }, { maxPixels: 4_624_220.16, micros: 35_000 }] as const;
const minPixels = 921_600;
const deadlineMs = 38_000;
const maxPngBytes = 6 * 1024 * 1024;
const maxBase64Chars = 4 * Math.ceil(maxPngBytes / 3);
const maxResponseBytes = maxBase64Chars + 64 * 1024;
const maxReferenceBytes = 30 * 1024 * 1024;
const maxErrorBytes = 4096;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type SeedreamEstimate = StyleDnaGenerationEstimate;

export function seedreamEstimate(referenceCount: 0 | 1, output: { width: number; height: number } = seedreamOutput): SeedreamEstimate {
  const pixels = output.width * output.height;
  const tier = outputTiers.find(item => pixels <= item.maxPixels);
  if (pixels < minPixels || !tier) throw new Error("Unsupported Seedream output size");
  const reference = referenceCount * referenceMicros;
  return { priceTable: seedreamPriceTable, currency: "USD", unit: "micros", referenceCount,
    outputMicros: tier.micros, referenceMicros: reference, totalMicros: tier.micros + reference };
}

// 제출 상태: not_sent(보내기 전 실패, 공급자 요청 없음), unknown(보냈을 수 있으나 응답 없음), submitted(공급자가 받음).
export type SeedreamSubmission = "not_sent" | "unknown" | "submitted";
export type SeedreamFailure = StyleDnaGenerationFailure;
export const seedreamFailureStatus: Record<SeedreamFailure, number> = {
  generation_not_sent: 503, generation_submission_unknown: 504, generation_result_lost: 504,
  content_rejected: 422, provider_busy: 429, provider_rejected: 502, invalid_model_response: 502,
};
export class SeedreamGenerationError extends Error {
  constructor(readonly code: SeedreamFailure, readonly submission: SeedreamSubmission, readonly providerStatus?: number) { super(code); }
}

export type SeedreamPng = { sha256: string; width: number; height: number; byteLength: number };
export type SeedreamGenerated = { png: SeedreamPng; image: MeasuredStyleDnaImage; usage: { generatedImages: number; outputTokens?: number } };
export type SeedreamRequest = { apiKey: string; prompt: string; reference?: Buffer };

// 운영 기본값은 style-dna-generation-runtime.ts(생성 키 저장소 지연 연결), 시험은 같은 모양을 주입한다.
export type SeedreamCredential = { apiKey: string; version: number };
export type SeedreamCredentials = {
  // 목록용: 키를 복호화하지 않고 등록 버전만 읽는다(없으면 open으로 대신한다).
  metadata?(owner: string): Promise<{ version: number } | undefined>;
  open(owner: string): Promise<SeedreamCredential | undefined>;
  whileCurrent<T>(owner: string, version: number, run: () => Promise<T>): Promise<T | undefined>;
};
export type SeedreamAdapter = ReturnType<typeof createSeedreamAdapter>;
export type SeedreamGenerator = { credentials: SeedreamCredentials; adapter: SeedreamAdapter };

const success = z.object({
  model: z.literal(seedreamModelId),
  created: z.int().nonnegative(),
  data: z.array(z.object({
    b64_json: z.string().min(1).max(maxBase64Chars),
    size: z.literal(seedreamOutput.size),
    output_format: z.literal(seedreamOutput.format).optional(),
    url: z.undefined().optional(),
    error: z.undefined().optional(),
  })).length(1),
  usage: z.object({ generated_images: z.literal(1), output_tokens: z.int().nonnegative().optional() }),
  error: z.undefined().optional(),
});
const providerError = z.object({ error: z.object({ code: z.string().max(200) }) });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// PNG 구조를 직접 확인한다: 서명, 첫 청크 IHDR, 모든 CRC, 애니메이션(acTL) 없음, IEND 뒤 남는 바이트 없음.
function checkPngStructure(png: Buffer) {
  if (png.length < 57 || !png.subarray(0, 8).equals(pngSignature)) return false;
  let offset = 8, first = true;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > png.length) return false;
    const type = png.toString("latin1", offset + 4, offset + 8);
    if (crc32(png.subarray(offset + 4, offset + 8 + length)) !== png.readUInt32BE(offset + 8 + length)) return false;
    if (first && (type !== "IHDR" || length !== 13)) return false;
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return false;
    first = false;
    offset = end;
    if (type === "IEND") return offset === png.length;
  }
  return false;
}

async function decodePng(b64: string): Promise<{ png: SeedreamPng; bytes: Buffer }> {
  if (b64.length % 4 !== 0 || !canonicalBase64.test(b64)) throw new Error("Invalid base64");
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length || bytes.length > maxPngBytes || bytes.toString("base64") !== b64) throw new Error("Invalid base64");
  if (!checkPngStructure(bytes)) throw new Error("Invalid PNG");
  const options = { limitInputPixels: seedreamOutput.width * seedreamOutput.height, failOn: "warning" } as const;
  const metadata = await sharp(bytes, options).timeout({ seconds: 7 }).metadata();
  if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1 ||
    metadata.width !== seedreamOutput.width || metadata.height !== seedreamOutput.height) throw new Error("Unexpected PNG");
  // 메타데이터만 믿지 않고 전체 픽셀을 디코드한다.
  const { info } = await sharp(bytes, options).timeout({ seconds: 7 }).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== seedreamOutput.width || info.height !== seedreamOutput.height) throw new Error("Unexpected PNG");
  return { bytes, png: { sha256: createHash("sha256").update(bytes).digest("hex"), width: info.width, height: info.height, byteLength: bytes.length } };
}

async function rejection(response: Response, signal: AbortSignal): Promise<SeedreamGenerationError> {
  const status = response.status;
  const raw = await readBounded(response.body, maxErrorBytes, signal).catch(() => undefined);
  let code = "";
  try { code = raw ? providerError.parse(JSON.parse(raw.toString("utf8"))).error.code : ""; } catch { /* 본문 없는 오류도 같은 분류 */ }
  if (status === 400 && /SensitiveContentDetected/.test(code)) return new SeedreamGenerationError("content_rejected", "submitted", status);
  if (status === 429) return new SeedreamGenerationError("provider_busy", "submitted", status);
  return new SeedreamGenerationError("provider_rejected", "submitted", status);
}

export function createSeedreamAdapter(send: typeof fetch, options: { deadlineMs?: number } = {}) {
  return {
    estimate: seedreamEstimate,
    async generate(input: SeedreamRequest, outer?: AbortSignal): Promise<SeedreamGenerated> {
      // 여기까지의 실패는 요청을 보내기 전이다.
      if (!input.apiKey || /[\s\0]/.test(input.apiKey) || !input.prompt.trim() ||
        (input.reference && (!input.reference.length || input.reference.length > maxReferenceBytes)) || outer?.aborted) {
        throw new SeedreamGenerationError("generation_not_sent", "not_sent");
      }
      let body: string;
      try {
        body = JSON.stringify({
          model: seedreamModelId, prompt: input.prompt, size: seedreamOutput.size, output_format: seedreamOutput.format,
          response_format: "b64_json", background: "opaque", watermark: false, stream: false,
          ...(input.reference && { image: `data:image/webp;base64,${input.reference.toString("base64")}` }),
        });
      } catch { throw new SeedreamGenerationError("generation_not_sent", "not_sent"); }
      const timer = AbortSignal.timeout(options.deadlineMs ?? deadlineMs);
      const signal = outer ? AbortSignal.any([outer, timer]) : timer;
      let response: Response;
      try {
        response = await send(seedreamEndpoint, {
          method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` }, body,
        });
      } catch {
        // 연결 오류와 시간 초과는 요청이 공급자에 닿았는지 알 수 없다. 자동으로 다시 보내지 않는다.
        throw new SeedreamGenerationError("generation_submission_unknown", "unknown");
      }
      if (!response.ok) throw await rejection(response, signal);
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d{1,10}$/.test(declared) || Number(declared) > maxResponseBytes)) {
        void response.body?.cancel().catch(() => undefined);
        throw new SeedreamGenerationError("invalid_model_response", "submitted", response.status);
      }
      let raw: Buffer | undefined;
      try { raw = await readBounded(response.body, maxResponseBytes, signal); }
      catch { throw new SeedreamGenerationError("generation_result_lost", "submitted", response.status); }
      if (!raw) throw new SeedreamGenerationError("invalid_model_response", "submitted", response.status);
      try {
        const parsed = success.parse(JSON.parse(raw.toString("utf8")));
        const { bytes, png } = await decodePng(parsed.data[0].b64_json);
        const image = await measureStyleDnaImage(bytes, "image/png");
        return { png, image, usage: { generatedImages: parsed.usage.generated_images,
          ...(parsed.usage.output_tokens !== undefined && { outputTokens: parsed.usage.output_tokens }) } };
      } catch { throw new SeedreamGenerationError("invalid_model_response", "submitted", response.status); }
    },
  };
}
