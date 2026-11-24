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
export type StyleDnaTestModel = keyof typeof styleDnaImageModels;
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
const operation = z.strictObject({ requestId: z.uuid(), authorized: z.literal(true), credentialVersion: z.int().min(1).max(2_147_483_647) });
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
export const styleDnaSpotLimit = 8;
export const styleDnaTrendLimit = 20;
export const styleDnaTrendPromptLimit = 2000;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const comparisonTest = z.strictObject({ testId: styleDnaId, originalSha256: sha256, resultSha256: sha256 });
const comparisonRequest = comparisonTest.extend({ requestId: z.uuid(), spotVersion: z.int().min(0) });
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
export type StyleDnaTestResult = {
  id: string; revision: number; model: keyof typeof styleDnaImageModels; original: StyleDnaMedia; image: StyleDnaMedia; createdAt: string;
  basis?: StyleDnaTestBasis;
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
