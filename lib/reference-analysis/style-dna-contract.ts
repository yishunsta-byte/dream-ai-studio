import { z } from "zod";
import { studioAnalysisResultSchema } from "./studio-analysis-result-dto";
import type { ImageSemanticResult } from "./image-semantic-result";
import type { StyleDnaAnalysisReport, StyleDnaReportSections } from "./style-dna-report";
import { styleDnaEngineSelection, type StyleDnaEngineBasis } from "./style-dna-engine-credential-contract";

export const styleDnaPath = "/api/admin/style-dna";
// 시험 생성(실제 Gemini 호출) 모델. 이 목록만 시험 생성 입력·호출에 쓴다.
export const styleDnaImageModels = {
  "gemini-nano-banana-2.1": { size: "2K", label: "Nano Banana 2.1" },
  "gemini-3.1-flash-lite-image": { size: "1K", label: "Nano Banana 2 Lite" },
} as const;
// 프롬프트 문법만 맞추는 분석 대상(CMD-20261125-011). 이 이름으로 모델을 호출하거나 공급자·요금 경로를 만들지 않는다.
export const styleDnaPromptOnlyTargets = {
  "gpt-image-2.6": { label: "GPT Image 2.6", vendor: "OpenAI" },
  // FLUX 3은 공식 안내상 동영상 모델이라(help.bfl.ai what-is-flux-3) 주인님 결정(2026-11-25)으로 이미지 모델 FLUX.2를 넣는다.
  "flux-2": { label: "FLUX.2", vendor: "Black Forest Labs" },
  "mai-image-2.7": { label: "MAI-Image-2.7", vendor: "Microsoft" },
  "seedream-5.5": { label: "Seedream 5.5", vendor: "ByteDance" },
  "kling-image-4.0": { label: "Kling Image 4.0", vendor: "Kuaishou" },
} as const;
// 실제 생성 공급자로 만드는 시험 모델(P2-02). 프롬프트 전용 대상 목록(위)과 별개다.
// 서버에 생성기가 주입되고 소유자 키가 준비됐을 때만 목록 응답 settings.generationModels에 실려 고를 수 있다(운영 기본 앱은 없음).
export const styleDnaGeneratedModels = {
  "seedream-5.5": { label: "Seedream 5.5", vendor: "ByteDance", provider: "byteplus", providerLabel: "BytePlus ModelArk",
    modelId: "dola-seedream-5-5-261028", size: "1024x1024", aspectRatio: "1:1" },
  "flux-2-pro": { label: "FLUX.2 pro", vendor: "Black Forest Labs", provider: "bfl", providerLabel: "Black Forest Labs",
    modelId: "flux-2-pro", size: "1024x1024", aspectRatio: "1:1" },
} as const;
// 실제 사용량(공급자 usage 토큰)으로 값이 정해지는 생성 모델(P2-02 GPT Image, 주인님 결정 msg_eecb6bc80f10).
// 누르기 전 고정 금액이 없어 고정가 목록(styleDnaGeneratedModels)과 따로 둔다. 그래서 고정가만 아는 옛 화면은 이 줄을 버린다.
// 키(gpt-image-2.6)는 프롬프트 전용 대상(styleDnaPromptOnlyTargets)과 같지만, 생성 모델은 이 목록과 settings.generationModels에서만 고른다.
export const styleDnaUsageGeneratedModels = {
  "gpt-image-2.6": { label: "GPT Image 2.6", vendor: "OpenAI", provider: "openai", providerLabel: "OpenAI",
    modelId: "gpt-image-2.6-sunburst", size: "1024x1024", aspectRatio: "1:1" },
} as const;
export type StyleDnaTestModel = keyof typeof styleDnaImageModels;
export type StyleDnaGeneratedModel = keyof typeof styleDnaGeneratedModels;
export type StyleDnaUsageGeneratedModel = keyof typeof styleDnaUsageGeneratedModels;
export const styleDnaRequestModel = z.enum(["seedream-5.5", "flux-2-pro"]);
// 원장(dream_style_dna.requests.generation_model)에 묶는 모든 생성 모델. 고정가만 아는 화면 판독(styleDnaRequestModel)과 분리해
// 옛 화면은 gpt-image-2.6 영수증을 '모델 없음'으로 읽는다(형식이 바뀌지 않음).
export const styleDnaGenerationRequestModel = z.enum(["seedream-5.5", "flux-2-pro", "gpt-image-2.6"]);
export type StyleDnaGenerationRequestModel = z.infer<typeof styleDnaGenerationRequestModel>;
export type StyleDnaRequestModel = z.infer<typeof styleDnaRequestModel>;
/** 시험 결과에 남는 모델: Gemini 시험 모델 또는 생성 공급자 모델. */
export type StyleDnaResultModel = StyleDnaTestModel | StyleDnaGeneratedModel | StyleDnaUsageGeneratedModel;
export const styleDnaResultModelLabel = (model: string) =>
  (styleDnaImageModels as Record<string, { label: string }>)[model]?.label ?? (styleDnaGeneratedModels as Record<string, { label: string }>)[model]?.label
    ?? (styleDnaUsageGeneratedModels as Record<string, { label: string }>)[model]?.label ?? model;
export type StyleDnaPromptTarget = StyleDnaTestModel | keyof typeof styleDnaPromptOnlyTargets;
// 화면과 서버가 같이 쓰는 분석 프롬프트 대상 목록. testable은 시험 생성(Gemini)까지 되는지다.
export const styleDnaPromptTargets: readonly { id: StyleDnaPromptTarget; label: string; vendor: string; testable: boolean }[] = Object.freeze([
  ...Object.entries(styleDnaImageModels).map(([id, { label }]) => ({ id: id as StyleDnaTestModel, label, vendor: "Google", testable: true })),
  ...Object.entries(styleDnaPromptOnlyTargets).map(([id, { label, vendor }]) => ({ id: id as StyleDnaPromptTarget, label, vendor, testable: false })),
].map(item => Object.freeze(item)));
const text = (limit: number) => z.string().trim().max(limit).refine(value => !value.includes("\0"));
const target = z.enum(Object.keys(styleDnaImageModels) as [StyleDnaTestModel, ...StyleDnaTestModel[]]);
const promptTarget = z.enum(styleDnaPromptTargets.map(item => item.id) as [StyleDnaPromptTarget, ...StyleDnaPromptTarget[]]);
export const styleDnaRatio = z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
export const styleDnaId = z.uuidv7();
export const styleDnaRequestId = z.uuid();
const operation = z.strictObject({ requestId: styleDnaRequestId, authorized: z.literal(true), credentialVersion: z.int().min(1).max(2_147_483_647) });
export const styleDnaAnalyze = operation.extend({
  mode: z.enum(["replicate", "mutate"]), guidance: text(800).default(""), mutationLevel: z.int().min(0).max(100).default(30),
  includeImageTag: z.boolean().default(false), targetModel: promptTarget.default("gemini-nano-banana-2.1"),
  engine: styleDnaEngineSelection.optional(),
});
export const styleDnaAnalyzeSource = styleDnaAnalyze.extend({
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("record"), id: styleDnaId }),
    z.strictObject({ kind: z.literal("url"), url: text(4096).refine(Boolean) }),
  ]),
});
export const styleDnaRefine = operation.extend({
  revision: z.int().positive(), feedback: text(600).refine(Boolean), engine: styleDnaEngineSelection.optional(),
});
export const styleDnaTestPromptLimit = 2400;
export const styleDnaTest = operation.extend({
  revision: z.int().positive(), model: target, subject: text(500).default(""),
  attachImage: z.boolean().default(false), aspectRatio: styleDnaRatio.optional(),
  customPrompt: text(styleDnaTestPromptLimit).refine(Boolean).optional(),
});
export const styleDnaTestWithReference = styleDnaTest.extend({
  attachImage: z.literal(false).default(false),
  customReferenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
// 생성 공급자 시험(Seedream 5.5): 1024×1024 고정이라 화면비는 1:1만, 누르기 전에 본 예상 금액(정수 USD micros)을 함께 보낸다.
// credentialVersion은 그 공급자 키의 등록 버전이다(Gemini 버전 아님). 장당 상한은 두지 않는다(주인님 결정 2026-11-25).
export const styleDnaGeneratedTest = styleDnaTest.extend({
  model: z.literal("seedream-5.5"), aspectRatio: z.literal("1:1").optional(), expectedCostMicros: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export const styleDnaGeneratedTestWithReference = styleDnaGeneratedTest.extend({
  attachImage: z.literal(false).default(false), customReferenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type StyleDnaGeneratedTestOptions = z.infer<typeof styleDnaGeneratedTest>;
export const styleDnaFluxTest = styleDnaGeneratedTest.extend({ model: z.literal("flux-2-pro") });
export const styleDnaFluxTestWithReference = styleDnaGeneratedTestWithReference.extend({ model: z.literal("flux-2-pro") });
export type StyleDnaFluxTestOptions = z.infer<typeof styleDnaFluxTest>;
// GPT Image 2.6(usage 기반): 고정 금액이 없어 expectedCostMicros 대신 billing: "usage_based"를 받는다.
// 엄격 객체라 금액 칸을 함께 보내거나, 고정가 모델에 billing을 보내면 400 invalid_input이다(금액 재확인 409 단계 없음).
export const styleDnaGptImageTest = styleDnaTest.extend({
  model: z.literal("gpt-image-2.6"), aspectRatio: z.literal("1:1").optional(), billing: z.literal("usage_based"),
});
export const styleDnaGptImageTestWithReference = styleDnaGptImageTest.extend({
  attachImage: z.literal(false).default(false), customReferenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type StyleDnaGptImageTestOptions = z.infer<typeof styleDnaGptImageTest>;
export const styleDnaSpotLimit = 8;
export const styleDnaTrendLimit = 20;
export const styleDnaTrendPromptLimit = 2000;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const comparisonTest = z.strictObject({ testId: styleDnaId, originalSha256: sha256, resultSha256: sha256 });
const comparisonRequest = comparisonTest.extend({ requestId: styleDnaRequestId, spotVersion: z.int().min(0) });
const coordinate = z.number().min(0).max(100).transform(value => Math.round(value * 10) / 10);
const spot = z.strictObject({ x: coordinate, y: coordinate });
const frameSize = z.int().min(1).max(8192);
const frame = z.strictObject({ width: frameSize, height: frameSize });
const trendPrompt = z.string().trim().refine(value => value.isWellFormed() && !value.includes("\0"))
  .transform(value => [...value].slice(0, styleDnaTrendPromptLimit).join("") || undefined);
export const styleDnaCompare = z.discriminatedUnion("action", [
  comparisonRequest.extend({ action: z.literal("save-spots"), frame,
    spots: z.array(spot).max(styleDnaSpotLimit).refine(points => new Set(points.map(p => `${p.x}:${p.y}`)).size === points.length) }),
  comparisonRequest.extend({ action: z.literal("record-trend"), prompt: trendPrompt.optional() }),
]);

export type StyleDnaComparisonCommand = z.infer<typeof styleDnaCompare>;
export type StyleDnaComparisonFrame = z.infer<typeof frame>;
export type StyleDnaSpot = z.infer<typeof spot> & { diff: number | null };
type ComparisonTest = z.infer<typeof comparisonTest>;
export type StyleDnaComparisonTrend = ComparisonTest & { revision: number; spotVersion: number; at: string; avg: number; n: number;
  frame: StyleDnaComparisonFrame; spots: StyleDnaSpot[]; prompt?: string };
export type StyleDnaComparison = {
  source: "stored_webp_rgb_5x5";
  spotVersion: number;
  frame: StyleDnaComparisonFrame;
  baseline: ComparisonTest & { at: string };
  spots: StyleDnaSpot[];
  updatedAt: string;
  trends: StyleDnaComparisonTrend[];
  recordedTestIds: string[];
};

export type StyleDnaOptions = Omit<z.infer<typeof styleDnaAnalyze>, "requestId" | "authorized" | "credentialVersion" | "engine">;
export type StyleDnaTestOptions = z.infer<typeof styleDnaTest>;
export type StyleDnaMedia = {
  mime: "image/webp"; width: number; height: number; sha256: string;
  palette: { hex: string; share: number }[]; href: string;
};
export type StyleDnaRecordedEngine = StyleDnaEngineBasis | {
  provider: "gemini"; modelId: string; credentialVersion: number;
};
export type StyleDnaRevision = {
  revision: number; prompts: { ko?: string; en?: string }; feedback?: string; note?: string; createdAt: string;
  styleDna?: StyleDnaReportSections;
  engine?: StyleDnaRecordedEngine;
};
export type StyleDnaTestBasis = {
  promptMode: "revision" | "edited"; promptSha256: string;
  aspectRatio: z.infer<typeof styleDnaRatio>; credentialVersion: number;
  reference: { kind: "none" } | { kind: "original"; sha256: string } |
    { kind: "upload"; sha256: string; sourceSha256: string };
};
/** 예상 금액(정수 USD micros). 실제 청구와 별개다. */
export type StyleDnaGenerationEstimate = {
  priceTable: string; currency: "USD"; unit: "micros"; referenceCount: 0 | 1;
  outputMicros: number; referenceMicros: number; totalMicros: number;
};
/** 생성 공급자 결과의 출처. 공급자 주소·Base64·키는 없다. billing은 공급자 정산 전이라 언제나 미확정이다. */
type StyleDnaGenerationProviderName = (typeof styleDnaGeneratedModels)[StyleDnaGeneratedModel]["provider"];
export type StyleDnaGeneration = {
  provider: StyleDnaGenerationProviderName; modelId: string; size: string;
  png: { sha256: string; width: number; height: number; byteLength: number };
  usage: { generatedImages: number; outputTokens?: number };
  estimate: StyleDnaGenerationEstimate; billing: "unconfirmed";
};
/** 목록 응답 settings.generationModels 한 줄: 소유자 키가 준비된 생성 모델(키 원문 없음, 등록 버전과 참조 0/1장 견적만). */
export type StyleDnaGenerationModelSetting = {
  id: StyleDnaGeneratedModel; label: string; vendor: string; provider: StyleDnaGenerationProviderName; modelId: string; size: string; aspectRatio: "1:1";
  credentialVersion: number;
  estimate: { priceTable: string; currency: "USD"; unit: "micros"; withoutReference: number; withReference: number };
};
/** usage 기반 견적: 누르기 전 금액 칸이 없다. 금액은 생성 뒤 공급자 usage로만 계산한다. */
export type StyleDnaUsageEstimate = { kind: "usage_based"; priceTable: string; currency: "USD"; unit: "micros" };
/** 목록 응답의 usage 기반 모델 한 줄(GPT Image 2.6). 고정가 줄과 달리 estimate에 kind가 있고 금액 칸이 없다. */
export type StyleDnaUsageGenerationModelSetting = {
  id: StyleDnaUsageGeneratedModel; label: string; vendor: string; provider: "openai"; modelId: string; size: string; aspectRatio: "1:1";
  credentialVersion: number; estimate: StyleDnaUsageEstimate;
};
/** usage 기반 결과의 출처. usage 칸은 공급자 응답에서 검증한 0 이상 정수만 싣고, 없는 값은 칸을 뺀다(0으로 채우지 않음).
 *  inputTokens는 입력 텍스트 토큰, inputImageTokens는 입력 이미지 토큰, outputTokens는 출력(이미지) 토큰이다.
 *  actualCostMicros는 공식 단가로 모든 구성 토큰이 확인될 때만 싣는다. 과금 확정(billing)과는 별개라 billing은 계속 미확정이다. */
export type StyleDnaUsageGeneration = {
  provider: "openai"; modelId: string; size: string;
  png: { sha256: string; width: number; height: number; byteLength: number };
  usage: { generatedImages: number; inputTokens?: number; inputImageTokens?: number; outputTokens?: number };
  estimate: StyleDnaUsageEstimate & { referenceCount: 0 | 1 };
  actualCostMicros?: number;
  billing: "unconfirmed";
};
/** 생성 공급자 실패 코드(서버 기록 코드). 보내기 전 실패만 공급자 요청이 없다. */
export const styleDnaGenerationFailures = ["generation_not_sent", "generation_submission_unknown", "generation_result_lost",
  "content_rejected", "provider_busy", "provider_rejected", "invalid_model_response"] as const;
export type StyleDnaGenerationFailure = typeof styleDnaGenerationFailures[number];
export type StyleDnaTestResult = {
  id: string; revision: number; model: StyleDnaResultModel; original: StyleDnaMedia; image: StyleDnaMedia; createdAt: string;
  basis?: StyleDnaTestBasis;
  generation?: StyleDnaGeneration | StyleDnaUsageGeneration;
};
export type StyleDnaRecord = {
  id: string; title: string; revision: number; mode: StyleDnaOptions["mode"]; original: StyleDnaMedia;
  createdAt: string; updatedAt: string; options: StyleDnaOptions; result: z.infer<typeof studioAnalysisResultSchema>;
  semantic: ImageSemanticResult; revisions: StyleDnaRevision[]; tests: StyleDnaTestResult[];
  styleDna?: StyleDnaAnalysisReport;
  comparison?: StyleDnaComparison;
  engine?: StyleDnaRecordedEngine;
};
export type StyleDnaSummary = Pick<StyleDnaRecord, "id" | "title" | "revision" | "mode" | "original" | "createdAt" | "updatedAt">;
