import "server-only";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import type { GeminiSettings } from "./analysis-gemini-settings";
import { readBounded } from "./read-bounded-body";
import { geminiStyleDnaImageAnalyzer, imageAnalysisInstructions, parseImageAnalysisOutput, styleDnaAnalysisResponseJson } from "./image-semantic-gemini";
import { imageSemanticPrompt } from "./image-semantic-result";
import { referenceUploadByteLimit } from "./input";
import { analyzeLocalMediaUpload, analyzeLocalMediaUrl } from "./local-media-url";
import { MediaUrlError } from "./media-url-error";
import { requestGeminiJson } from "./gemini-json";
import { studioAnalysisResultSchema } from "./studio-analysis-result-dto";
import { styleDnaImageModels, type StyleDnaMedia, type StyleDnaOptions, type StyleDnaRevision, type StyleDnaTestOptions } from "./style-dna-contract";
import { parseStyleDnaSections, styleDnaSectionsJson, type StyleDnaAnalysisReport, type StyleDnaReportSections } from "./style-dna-report";
import { requestStyleDnaEngine, type ExternalStyleDnaSettings, type StyleDnaEngineFailure } from "./style-dna-engine-provider";

export type StyleDnaSource = { kind: "url"; url: string } | { kind: "file"; name: string; bytes: Buffer };
export type MeasuredStyleDnaImage = { bytes: Buffer } & Omit<StyleDnaMedia, "href">;
export type StyleDnaAnalysisSettings = GeminiSettings | ExternalStyleDnaSettings;
const imageLimits = { limitInputPixels: 12_000_000, failOn: "warning" } as const;
const maxGeneratedBytes = 8 * 1024 * 1024;
// 최초 분석 전체 기한. 원본 v1.01은 분석 호출을 따로 끊지 않고 함수 300초 안에서 기다린다(저장·응답 여유 20초).
const analysisTimeoutMs = 280_000;
const formats = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const attachedImageTag = "[첨부 이미지]";
export class StyleDnaProviderError extends Error {
  constructor(readonly code: StyleDnaEngineFailure | "subject_required") { super(code); }
}

export async function measureStyleDnaImage(input: Buffer, expectedType?: string, maxSide = 2400): Promise<MeasuredStyleDnaImage> {
  const pipeline = sharp(input, imageLimits).timeout({ seconds: 7 });
  const metadata = await pipeline.metadata();
  const mime = formats[metadata.format as keyof typeof formats];
  if (!mime || (expectedType && mime !== expectedType) || (metadata.pages ?? 1) !== 1) throw new Error("Invalid image bytes");
  // A stable normalized image is used for both the private preview and comparison measurements.
  const { data: bytes, info } = await pipeline.autoOrient().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
  if (!bytes.length || bytes.length > maxGeneratedBytes) throw new Error("Image size limit");
  const sample = await sharp(bytes, imageLimits).timeout({ seconds: 7 }).resize(96, 96, { fit: "inside" }).toColourspace("srgb")
    .ensureAlpha().raw().toBuffer();
  const tally = new Map<string, number>();
  let total = 0;
  for (let offset = 0; offset < sample.length; offset += 4) {
    const alpha = sample[offset + 3];
    if (alpha === 0) continue;
    const hex = "#" + Array.from(sample.subarray(offset, offset + 3), value =>
      Math.min(255, Math.floor(value / 32) * 32 + 16).toString(16).padStart(2, "0")).join("");
    tally.set(hex, (tally.get(hex) ?? 0) + alpha);
    total += alpha;
  }
  const palette = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([hex, count]) => ({ hex, share: count / total }));
  return { bytes, width: info.width, height: info.height, mime: "image/webp", sha256: createHash("sha256").update(bytes).digest("hex"), palette };
}

export function styleDnaTestPrompt(input: Pick<StyleDnaTestOptions, "subject" | "customPrompt">,
  prior: StyleDnaRevision, hasReference: boolean) {
  const raw = input.customPrompt ?? prior.prompts.en ?? prior.prompts.ko;
  if (!raw) return;
  const placeholder = /\[(?:INSERT SUBJECT HERE|주제 입력|피사체 입력|피사체를 입력하세요)\]/gi;
  const subject = input.customPrompt === undefined ? input.subject : "";
  const filled = subject ? raw.replace(placeholder, () => subject) : raw;
  if (filled.match(placeholder)) return;
  const text = filled.replace(/\[(?:첨부 이미지|ATTACHED IMAGE)\]/gi, hasReference ? "the attached style reference" : "the described style");
  return [text, subject && `Subject: ${subject}`, hasReference && "Use the attached image as a style reference for a new image."]
    .filter(Boolean).join("\n");
}

function syntaxInstructions(options: StyleDnaOptions) {
  const model = options.targetModel === "gemini-3.1-flash-lite-image"
    ? "짧고 직접적인 한 문단에 피사체, 구도, 조명과 스타일의 우선순위를 분명히 하세요."
    : "한 문단에서 구도, 재질, 세부 조명과 시각적 요소의 관계를 구체적으로 묘사하세요.";
  return [
    `${options.targetModel}용 자연어 프롬프트입니다. ${model} 다른 플랫폼 명령행 옵션을 붙이지 마세요.`,
    options.includeImageTag ? `두 언어 프롬프트에 ${attachedImageTag}를 넣어 참고 이미지의 스타일과 구도를 나타내세요.`
      : "첨부 이미지 태그 없이 독립적으로 사용할 프롬프트를 작성하세요.",
  ].join("\n");
}

function analysisInstructions(options: StyleDnaOptions) {
  const mutation = options.mutationLevel <= 30 ? "질감 등 작은 요소만 절제해 바꾸세요."
    : options.mutationLevel <= 70 ? "구도를 유지하면서 재질·조명·스타일을 적극적으로 바꾸세요."
      : "핵심 배치만 남기고 스타일을 크게 재해석하세요.";
  return [
    options.mode === "replicate" ? "복제 모드입니다. 관찰된 구도, 조명, 질감과 분위기를 유지하는 재창작용 프롬프트를 작성하세요."
      : `변형 모드입니다. 변형 강도 ${options.mutationLevel}/100입니다. ${mutation}`,
    syntaxInstructions(options),
    "styleDna에 양언어 제목과, 시각적 단서가 충분한 카메라·조명 항목을 description과 basis로 작성하세요. 확인할 수 없는 항목은 생략하세요.",
    "camera.lens와 camera.focusDistance는 촬영 메타데이터가 아니라 이미지의 시각 단서로 하는 보수적 추정입니다. 카메라 사양을 추측하지 말라는 지시는 장비 모델이나 EXIF 값 같은 실측 사양에 적용되고, 이 두 칸은 아래 기준으로 작성하세요.",
    "lens는 렌즈 화각과 35mm 환산 초점거리입니다. 원근 왜곡, 배경 압축, 화각 넓이를 보고 '광각(약 24~35mm 상당)'처럼 범위나 정성 표현으로 쓰고, basis에 판단한 시각 단서를 적으세요.",
    "focusDistance는 렌즈 초점거리(mm)가 아니라 카메라에서 초점이 맞은 피사체까지의 거리입니다. 피사체 크기, 초점면 위치, 배경 흐림을 보고 '근거리(약 1m 이내)', '중거리(약 2~5m)', '원거리'처럼 범위나 정성 표현으로 쓰고, basis에 판단한 시각 단서를 적으세요.",
    "두 칸 모두 단일 수치를 실측값처럼 쓰지 말고 '약', '상당', '추정' 같은 표현이나 범위를 쓰세요. 메타데이터를 근거로 들지 말고, 시각 단서가 없으면 해당 칸을 생략하세요.",
    "원근·화각·심도 단서가 부족한 경우, 그림·일러스트·3D 렌더·합성 이미지처럼 실제 렌즈를 알 수 없는 경우, 장면과 동떨어진 값만 떠오르는 경우에는 두 칸을 쓰지 말고 생략해 미확인으로 남기세요.",
    "blueprint는 구조, style은 시각적 특징입니다. 각각 label, description, basis를 가진 평문 목록으로 작성하세요. tips와 keywords도 평문만 사용하세요.",
    "dna의 항목별 점수와 matchRate는 시각 특징과 프롬프트 재현성에 대한 0~100 모델 추정입니다. 근거가 부족한 값은 생략하세요.",
  ].join("\n");
}

const refinedPrompts = z.strictObject({ ko: imageSemanticPrompt, en: imageSemanticPrompt, note: z.string().trim().min(1).max(300) });
const refined = refinedPrompts.extend({ styleDna: z.unknown().optional() });
const refinedPromptJson = z.toJSONSchema(refinedPrompts);
const refinedJson = { ...refinedPromptJson, properties: { ...refinedPromptJson.properties, styleDna: styleDnaSectionsJson } };
const imageResponse = z.object({ candidates: z.array(z.object({ finishReason: z.literal("STOP"),
  content: z.object({ parts: z.array(z.object({ thought: z.boolean().optional(), inlineData: z.object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().min(4),
  }).optional() })).max(24) }),
})).length(1) });

export function createStyleDnaProvider(send: typeof fetch = fetch) {
  return {
    async analyze(source: StyleDnaSource, options: StyleDnaOptions, settings: StyleDnaAnalysisSettings) {
      let original: MeasuredStyleDnaImage | undefined;
      let styleDna: StyleDnaAnalysisReport | undefined;
      let engineFailure: StyleDnaEngineFailure | undefined;
      let oversized = false;
      const instruction = analysisInstructions(options);
      const input = JSON.stringify({ guidance: options.guidance });
      const useSource: Parameters<typeof analyzeLocalMediaUpload>[3] = async (path, signal) => {
        if ((await stat(path)).size > referenceUploadByteLimit) {
          oversized = true;
          return { status: "unavailable", reason: "image_preparation_failed" };
        }
        const bytes = await readFile(path, { signal });
        original = await measureStyleDnaImage(bytes, undefined, 1600);
        let analyzed;
        if ("provider" in settings) {
          if (original.bytes.byteLength > referenceUploadByteLimit) return { status: "unavailable", reason: "image_preparation_failed" };
          const result = await requestStyleDnaEngine({ settings, input, image: original.bytes, maxTokens: 8192, responseLimit: 128 * 1024,
            signal: AbortSignal.any([signal, AbortSignal.timeout(28_000)]), send,
            instruction: [imageAnalysisInstructions, instruction, "아래 형식의 JSON 객체만 반환하세요.", JSON.stringify(styleDnaAnalysisResponseJson)].join("\n") });
          if ("code" in result) {
            engineFailure = result.code;
            return { status: "unavailable", reason: "provider_error" };
          }
          analyzed = parseImageAnalysisOutput(result.output, settings.provider, true);
          if (analyzed.semantic.status === "unavailable") engineFailure = "invalid_model_response";
        } else {
          // Use captured bytes so Sharp does not retain the temporary file on Windows.
          analyzed = await geminiStyleDnaImageAnalyzer(settings, send, `${instruction}\n${input}`)(bytes, signal);
        }
        styleDna = analyzed.styleDna;
        return analyzed.semantic;
      };
      const observation = source.kind === "url" ? await analyzeLocalMediaUrl(source.url, undefined, undefined, "image", useSource, analysisTimeoutMs)
        : await analyzeLocalMediaUpload(new Request("https://style-dna.invalid", {
          method: "POST", body: new Uint8Array(source.bytes),
        }), source.name, "image", useSource, analysisTimeoutMs);
      if (oversized) throw new MediaUrlError("too_large", "이미지 용량을 확인해 주세요.", 413);
      if (engineFailure) throw new StyleDnaProviderError(engineFailure);
      const { semantic, schemaVersion, status, media, proposals } = observation;
      if (!original || !semantic || semantic.status === "unavailable") {
        throw new StyleDnaProviderError(semantic?.status === "unavailable" && semantic.reason === "timed_out" ? "timed_out" : "model_error");
      }
      return { original, semantic, result: studioAnalysisResultSchema.parse({ schemaVersion, status, media, proposals }), styleDna };
    },
    async refine(options: StyleDnaOptions, prior: StyleDnaRevision, feedback: string, settings: StyleDnaAnalysisSettings, current?: StyleDnaReportSections) {
      const instruction = ["기존 한·영 이미지 프롬프트를 피드백에 맞게 보정하세요. ko, en과 변경 요약 note를 반환하세요.",
        "청사진이나 스타일 목록에 근거 있는 변경이 있을 때만 styleDna의 blueprint 또는 style에 전체 수정 목록을 작성하세요.",
        "각 목록은 label, description, basis가 있는 평문 항목으로 구성하고 기존 화면 근거를 보존하세요. 근거가 부족하면 해당 목록을 생략하세요.",
        syntaxInstructions(options)].join("\n");
      const input = { prompts: prior.prompts, feedback, ...(current && { styleDna: current }) };
      const signal = AbortSignal.timeout(28_000);
      if ("provider" in settings) {
        const result = await requestStyleDnaEngine({ settings, input: JSON.stringify(input), maxTokens: 6144, responseLimit: 96 * 1024,
          instruction: [instruction, "아래 형식의 JSON 객체만 반환하세요.", JSON.stringify(refinedJson)].join("\n"), signal, send });
        if ("code" in result) throw new StyleDnaProviderError(result.code);
        const parsed = refined.safeParse(result.output);
        if (!parsed.success) throw new StyleDnaProviderError("invalid_model_response");
        return { ...parsed.data, styleDna: parseStyleDnaSections(parsed.data.styleDna) };
      }
      const result = await requestGeminiJson({ settings, schema: refined, responseJsonSchema: refinedJson,
        maxOutputTokens: 6144, responseByteLimit: 96 * 1024, instruction, input, signal, send });
      if ("code" in result) throw new StyleDnaProviderError(result.code);
      return { ...result.generated, styleDna: parseStyleDnaSections(result.generated.styleDna) };
    },
    async test(input: Pick<StyleDnaTestOptions, "model" | "aspectRatio">, prompt: string, reference: Buffer | undefined, settings: GeminiSettings) {
      const signal = AbortSignal.timeout(38_000);
      const response = await send(`https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
        headers: { "content-type": "application/json", "x-goog-api-key": settings.key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, ...(reference ?
          [{ inlineData: { mimeType: "image/webp", data: reference.toString("base64") } }] : [])] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { imageSize: styleDnaImageModels[input.model].size,
          ...(input.aspectRatio && { aspectRatio: input.aspectRatio }) } } }),
      }).catch(() => { throw new StyleDnaProviderError(signal.aborted ? "timed_out" : "model_error"); });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new StyleDnaProviderError("model_error");
      }
      const data = await readBounded(response.body, 12 * 1024 * 1024, signal).catch(() => undefined);
      if (!data) throw new StyleDnaProviderError(signal.aborted ? "timed_out" : "invalid_model_response");
      try {
        const result = imageResponse.parse(JSON.parse(data.toString("utf8")));
        const images = result.candidates[0].content.parts.flatMap(part => !part.thought && part.inlineData ? [part.inlineData] : []);
        if (images.length !== 1) throw new Error("Expected one image");
        const bytes = Buffer.from(images[0].data, "base64");
        if (bytes.length > maxGeneratedBytes || bytes.toString("base64") !== images[0].data) throw new Error("Invalid image encoding");
        return await measureStyleDnaImage(bytes, images[0].mimeType);
      } catch { throw new StyleDnaProviderError("invalid_model_response"); }
    },
  };
}

export type StyleDnaProvider = ReturnType<typeof createStyleDnaProvider>;
