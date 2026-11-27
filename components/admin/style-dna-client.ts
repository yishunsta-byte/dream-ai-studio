"use client";

import { z } from "zod";
import {
  styleDnaGeneratedModels, styleDnaGenerationFailures, styleDnaGenerationRequestModel, styleDnaImageModels, styleDnaPath, styleDnaUsageGeneratedModels,
  type StyleDnaComparison, type StyleDnaComparisonFrame, type StyleDnaGenerationRequestModel, type StyleDnaUsageEstimate, type StyleDnaUsageGeneration,
  type StyleDnaUsageGenerationModelSetting,
  type StyleDnaGeneratedModel, type StyleDnaGeneration, type StyleDnaGenerationEstimate, type StyleDnaGenerationFailure, type StyleDnaGenerationModelSetting,
  type StyleDnaOptions, type StyleDnaRecord, type StyleDnaRecordedEngine, type StyleDnaResultModel, type StyleDnaSummary, type StyleDnaTestModel, type StyleDnaTestResult,
} from "@/lib/reference-analysis/style-dna-contract";
import { acceptsEngineModel, readStyleDnaEngineSettings, type StyleDnaEngineSettings } from "./style-dna-engine-credentials-client";
import {
  type StyleDnaEngine, type StyleDnaEngineSelection,
} from "@/lib/reference-analysis/style-dna-engine-credential-contract";

// P1-06 Style DNA 작업실(Backend ab798b1 계약: /api/admin/style-dna 목록·분석, /{id} 기록, /{id}/refine, /{id}/test-image, /{id}/media/{media}).
// 모든 쓰기는 requestId·authorized·credentialVersion을 함께 보내고, 같은 requestId·같은 내용이면 서버가 새 호출 없이 저장된 결과를 돌려준다.
// 202(진행 중)는 같은 requestId·같은 본문으로 잠시 뒤 다시 물어보고, 연결이 끊긴 요청도 같은 본문으로만 다시 확인한다(새 생성 아님).
export type StyleDnaSettings = { storage: "ready"; credentialVersion: number; analysisModel: string | null;
  testModels: { id: StyleDnaTestModel; size: string; label: string }[];
  /** 배정 2(Backend 작성 중 계약): 분석 프롬프트 대상, 분석 엔진 등록 상태, 엔진 키 저장소 상태. 없으면 예전 서버. */
  promptTargets?: unknown; analysisEngines?: unknown; engineStorage?: unknown;
  /** P2-02: 키가 준비된 생성 공급자 모델(서버에 생성기가 주입된 경우만). 없으면 Gemini 시험 모델만. */
  generationModels?: unknown };
/** 금액(정수 USD micros): 가격 상한은 두지 않고, 비음수 안전 정수만 받는다(분수·음수·문자·안전 범위 밖은 거절). */
const micros = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
/** 시험 생성 모델로 고를 수 있는 생성 공급자 모델. 계약에 있는 모델만, 모양·등록 버전·견적이 맞는 줄만 받는다(어긋나면 그 줄을 버린다). */
/** 시험 생성으로 고를 수 있는 생성 모델 한 줄: 고정가(누르기 전 금액) 또는 usage 기반(GPT Image 2.6, 금액은 생성 뒤 사용량으로). */
export type GenerationChoice = StyleDnaGenerationModelSetting | StyleDnaUsageGenerationModelSetting;
export const usageBased = (choice: GenerationChoice | null | undefined): choice is StyleDnaUsageGenerationModelSetting =>
  !!choice && "kind" in choice.estimate && choice.estimate.kind === "usage_based";
const onlyKeys = (row: Record<string, unknown>, keys: readonly string[]) => Object.keys(row).every(key => keys.includes(key));
/** usage 기반 견적(P2-02 GPT Image, 서버 4ba5eecc): 금액 칸 없이 kind·가격표·통화·단위만. 다른 칸이 있으면 받지 않는다. */
function readUsageEstimate(value: unknown, extra: readonly string[] = []): (StyleDnaUsageEstimate & Record<string, unknown>) | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!row || row.kind !== "usage_based" || typeof row.priceTable !== "string" || row.currency !== "USD" || row.unit !== "micros"
    || !onlyKeys(row, ["kind", "priceTable", "currency", "unit", ...extra])) return null;
  return row as StyleDnaUsageEstimate & Record<string, unknown>;
}
export function styleDnaGenerationChoices(settings: Pick<StyleDnaSettings, "generationModels"> | null | undefined): GenerationChoice[] {
  const raw = settings?.generationModels;
  if (!Array.isArray(raw) || raw.length > 10) return [];
  const seen = new Set<string>();
  return raw.flatMap((item): GenerationChoice[] => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = row.id as StyleDnaGeneratedModel;
    const version = row.credentialVersion;
    const versionOk = Number.isInteger(version) && (version as number) >= 1 && (version as number) <= 2_147_483_647;
    // usage 기반(GPT Image 2.6): 계약 고정 값과 같고 견적이 금액 없는 usage 모양일 때만
    if (typeof row.id === "string" && Object.hasOwn(styleDnaUsageGeneratedModels, row.id)) {
      const usageId = row.id as keyof typeof styleDnaUsageGeneratedModels;
      const model = styleDnaUsageGeneratedModels[usageId];
      const estimate = readUsageEstimate(row.estimate);
      if (seen.has(usageId) || row.provider !== model.provider || row.modelId !== model.modelId || row.size !== model.size || row.aspectRatio !== model.aspectRatio
        || !versionOk || !estimate) return [];
      seen.add(usageId);
      return [{ id: usageId, label: model.label, vendor: model.vendor, provider: model.provider, modelId: model.modelId, size: model.size,
        aspectRatio: model.aspectRatio, credentialVersion: version as number,
        estimate: { kind: "usage_based" as const, priceTable: estimate.priceTable, currency: "USD" as const, unit: "micros" as const } }];
    }
    const known = typeof row.id === "string" && Object.hasOwn(styleDnaGeneratedModels, row.id) ? styleDnaGeneratedModels[id] : null;
    const estimate = row.estimate && typeof row.estimate === "object" ? row.estimate as Record<string, unknown> : null;
    if (!known || seen.has(id) || row.provider !== known.provider || row.modelId !== known.modelId || row.size !== known.size || row.aspectRatio !== known.aspectRatio
      || !versionOk || !estimate || "kind" in estimate || typeof estimate.priceTable !== "string" || estimate.currency !== "USD" || estimate.unit !== "micros"
      || !micros(estimate.withoutReference) || !micros(estimate.withReference)) return [];
    seen.add(id);
    return [{ id, label: known.label, vendor: known.vendor, provider: known.provider, modelId: known.modelId, size: known.size, aspectRatio: known.aspectRatio,
      credentialVersion: version as number, estimate: { priceTable: estimate.priceTable as string, currency: "USD" as const, unit: "micros" as const,
        withoutReference: estimate.withoutReference as number, withReference: estimate.withReference as number } }];
  });
}
/** 예상 금액 표기(정수 USD micros -> $0.020). */
export const usdText = (value: number) => "$" + (value / 1_000_000).toFixed(3);
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const pixels = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 16384;
/** 서버 견적 모양 확인(409 estimate_changed·결과 generation.estimate). */
export function readGenerationEstimate(value: unknown): StyleDnaGenerationEstimate | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!row || typeof row.priceTable !== "string" || row.currency !== "USD" || row.unit !== "micros" || (row.referenceCount !== 0 && row.referenceCount !== 1)
    || !micros(row.outputMicros) || !micros(row.referenceMicros) || !micros(row.totalMicros)
    || !Number.isSafeInteger(row.outputMicros + row.referenceMicros) || row.outputMicros + row.referenceMicros !== row.totalMicros
    || (row.referenceCount === 0 && row.referenceMicros !== 0)) return null;
  return { priceTable: row.priceTable, currency: "USD", unit: "micros", referenceCount: row.referenceCount,
    outputMicros: row.outputMicros as number, referenceMicros: row.referenceMicros as number, totalMicros: row.totalMicros as number };
}
/** 시험 결과의 생성 출처. 모양이 어긋나면 null(화면은 출처를 '읽지 못함'으로 둔다). 공급자 주소·Base64는 받지 않는다. */
export function readGeneration(value: unknown, model?: string): StyleDnaGeneration | StyleDnaUsageGeneration | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (row && "kind" in ((row.estimate ?? {}) as object)) return readUsageGeneration(row, model);
  const source = Object.entries(styleDnaGeneratedModels).find(([id, known]) =>
    (model === undefined || model === id) && known.provider === row?.provider && known.modelId === row?.modelId)?.[1];
  const png = row?.png && typeof row.png === "object" ? row.png as Record<string, unknown> : null;
  const usage = row?.usage && typeof row.usage === "object" ? row.usage as Record<string, unknown> : null;
  const estimate = readGenerationEstimate(row?.estimate);
  if (!row || !source || typeof row.size !== "string" || row.billing !== "unconfirmed"
    || !png || !sha(png.sha256) || !pixels(png.width) || !pixels(png.height) || !Number.isInteger(png.byteLength)
    || !usage || !Number.isInteger(usage.generatedImages) || (usage.outputTokens !== undefined && !Number.isInteger(usage.outputTokens)) || !estimate) return null;
  return { provider: source.provider, modelId: source.modelId, size: row.size, billing: "unconfirmed", estimate,
    png: { sha256: png.sha256 as string, width: png.width as number, height: png.height as number, byteLength: png.byteLength as number },
    usage: { generatedImages: usage.generatedImages as number, ...(usage.outputTokens !== undefined && { outputTokens: usage.outputTokens as number }) } };
}
/** usage 기반 출처(GPT Image 2.6): 계약 모델과 같고, usage는 알려진 칸(0 이상 정수)만, 실제 금액은 있으면 정수 micros. 모르는 칸이 있으면 받지 않는다. */
function readUsageGeneration(row: Record<string, unknown>, model?: string): StyleDnaUsageGeneration | null {
  const source = Object.entries(styleDnaUsageGeneratedModels).find(([id, known]) =>
    (model === undefined || model === id) && known.provider === row.provider && known.modelId === row.modelId)?.[1];
  const png = row.png && typeof row.png === "object" ? row.png as Record<string, unknown> : null;
  const usage = row.usage && typeof row.usage === "object" ? row.usage as Record<string, unknown> : null;
  const estimate = readUsageEstimate(row.estimate, ["referenceCount"]);
  const count = (value: unknown) => value === undefined || micros(value);
  if (!source || typeof row.size !== "string" || row.billing !== "unconfirmed"
    || !onlyKeys(row, ["provider", "modelId", "size", "png", "usage", "estimate", "actualCostMicros", "billing"])
    || !png || !sha(png.sha256) || !pixels(png.width) || !pixels(png.height) || !Number.isInteger(png.byteLength)
    || !usage || !onlyKeys(usage, ["generatedImages", "inputTokens", "inputImageTokens", "outputTokens"]) || !micros(usage.generatedImages)
    || !count(usage.inputTokens) || !count(usage.inputImageTokens) || !count(usage.outputTokens)
    || !estimate || (estimate.referenceCount !== 0 && estimate.referenceCount !== 1)
    || (row.actualCostMicros !== undefined && !micros(row.actualCostMicros))) return null;
  const pick = (key: "inputTokens" | "inputImageTokens" | "outputTokens") => usage[key] !== undefined ? { [key]: usage[key] as number } : {};
  return { provider: "openai", modelId: source.modelId, size: row.size, billing: "unconfirmed",
    png: { sha256: png.sha256 as string, width: png.width as number, height: png.height as number, byteLength: png.byteLength as number },
    usage: { generatedImages: usage.generatedImages as number, ...pick("inputTokens"), ...pick("inputImageTokens"), ...pick("outputTokens") },
    estimate: { kind: "usage_based", priceTable: estimate.priceTable, currency: "USD", unit: "micros", referenceCount: estimate.referenceCount as 0 | 1 },
    ...(row.actualCostMicros !== undefined && { actualCostMicros: row.actualCostMicros as number }) };
}
/** 금액 표기 한 줄. usage 기반은 실제 금액이 있으면 '실제 사용량 기준', 없으면 '계산 중'. */
export function generationCostText(generation: StyleDnaGeneration | StyleDnaUsageGeneration) {
  if ("kind" in generation.estimate) {
    return "actualCostMicros" in generation && generation.actualCostMicros !== undefined
      ? `실제 사용량 기준 ${usdText(generation.actualCostMicros)}` : "실제 사용량으로 계산 중(금액 미확인)";
  }
  return `예상 ${usdText(generation.estimate.totalMicros)}`;
}
/** 생성 모델 표기: 프롬프트 전용 대상 'GPT Image 2.6'과 구분해 생성 모델은 sunburst까지 적는다. */
export const generationModelLabel = (id: string, label: string) => id === "gpt-image-2.6" ? `${label} · sunburst` : label;
const providerName: Record<StyleDnaGeneration["provider"] | "openai", string> = { byteplus: "BytePlus", bfl: "Black Forest Labs", openai: "OpenAI" };
/** 결과 출처 한 줄: 공급자·모델 ID·크기·예상 금액·과금 미확정. 생성 출처가 없는 Gemini 결과는 Gemini 시험 모델로 적는다. */
export function generationText(test: Pick<StyleDnaTestResult, "model"> & { generation?: unknown }) {
  const generation = readGeneration(test.generation, test.model);
  if (generation) {
    const reference = generation.estimate.referenceCount ? "참조 1장 포함" : "참조 없음";
    return `AI 생성 출처 ${providerName[generation.provider]} · ${generation.modelId} · ${generation.size.replace("x", "×")}`
      + ` · ${generationCostText(generation)}(${reference}) · 실제 청구 미확정`;
  }
  if (Object.hasOwn(styleDnaGeneratedModels, test.model) || Object.hasOwn(styleDnaUsageGeneratedModels, test.model)) return "AI 생성 출처 기록을 읽지 못했어요(실제 청구 미확정).";
  return `AI 생성 출처 Google Gemini · ${styleDnaImageModels[test.model as StyleDnaTestModel]?.label ?? test.model}`;
}
export type StyleDnaTargetChoice = { id: string; label: string; testable: boolean };
/** 대상 모델 고르는 칸 목록. 서버 settings.promptTargets[{id,label,vendor,testable}]이 올바르면 그 순서 그대로 쓰고,
 *  없거나 하나라도 어긋나면(빈 목록·모양·중복 id·시험 가능 표시 없음) 예전 서버와 같은 시험 생성 모델 목록을 쓴다. */
export function styleDnaTargetChoices(settings: Pick<StyleDnaSettings, "promptTargets" | "testModels"> | null | undefined): StyleDnaTargetChoice[] {
  const fallback = (settings?.testModels ?? Object.entries(styleDnaImageModels).map(([id, info]) => ({ id, label: info.label })))
    .map(item => ({ id: item.id as string, label: item.label, testable: true }));
  const raw = settings?.promptTargets;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return fallback;
  const items = raw.map(item => item && typeof item === "object" ? item as Record<string, unknown> : {});
  const valid = items.every(item => typeof item.id === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(item.id)
    && typeof item.label === "string" && item.label.trim().length > 0 && item.label.length <= 60 && typeof item.testable === "boolean");
  if (!valid || new Set(items.map(item => item.id)).size !== items.length) return fallback;
  return items.map(item => ({ id: item.id as string, label: (item.label as string).trim(), testable: item.testable as boolean }));
}
/** OpenAI·Anthropic 분석 엔진 등록 상태(키 원문 없음). 화면은 등록 여부·모델·버전만 쓴다. */
export type EngineState = Record<StyleDnaEngine, { configured: boolean; modelId: string | null; version: number }>;
/** 목록 응답에서 읽은 엔진 상태.
 *  - "legacy": 칸이 없는 예전 서버 → 화면이 따로 등록 정보를 조회한다.
 *  - storage "ready": engines에 두 엔진 상태. "unavailable"(저장소를 읽지 못함)·모양이 어긋남: engines null = '확인 실패'(키 미등록이라고 하지 않음).
 *  - storage "not_configured": 서버에 엔진 키 저장소가 준비되지 않음 → 고를 수 없음. */
export type ListEngineState = "legacy" | { storage: "ready"; engines: EngineState } | { storage: "unavailable"; engines: null } | { storage: "not_configured"; engines: null };
export function styleDnaListEngines(settings: Pick<StyleDnaSettings, "analysisEngines" | "engineStorage"> | null | undefined): ListEngineState {
  if (!settings || (settings.analysisEngines === undefined && settings.engineStorage === undefined)) return "legacy";
  const storage = settings.engineStorage;
  if (storage === "not_configured") return { storage, engines: null };
  if (storage !== "ready" || !Array.isArray(settings.analysisEngines)) return { storage: "unavailable", engines: null };
  const rows = settings.analysisEngines.map(item => item && typeof item === "object" ? item as Record<string, unknown> : {});
  const read = (provider: StyleDnaEngine) => {
    const found = rows.filter(row => row.provider === provider);
    if (found.length !== 1) return null;
    const { configured, modelId, version } = found[0];
    if (configured === true && typeof modelId === "string" && acceptsEngineModel(provider, modelId)
      && Number.isInteger(version) && (version as number) >= 1 && (version as number) <= 2_147_483_647) return { configured, modelId, version: version as number };
    if (configured === false && modelId === null && version === 0) return { configured, modelId, version };
    return null;
  };
  const openai = read("openai"), anthropic = read("anthropic");
  return openai && anthropic ? { storage: "ready", engines: { openai, anthropic } } : { storage: "unavailable", engines: null };
}
export type LibraryOutcome = { kind: "ok"; items: StyleDnaSummary[]; settings: StyleDnaSettings } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unavailable" } | { kind: "failed" };
export type StyleDnaCode = "invalid_input" | "too_large" | "not_found" | "stale_credential" | "stale_revision" | "request_conflict" | "limit_reached"
  | "not_configured" | "storage_unavailable" | "model_error" | "timed_out" | "subject_required" | "in_progress"
  | "invalid_reference" | "reference_mismatch" | "unsupported_format"
  | "stale_spot_version" | "comparison_media_mismatch" | "comparison_unmeasured" | "failed"
  | "estimate_changed" | "result_unconfirmed" | "generation_in_progress" | StyleDnaGenerationFailure;
/** estimate: 409 estimate_changed일 때 서버가 돌려준 새 견적(모양이 맞을 때만). */
export type OpOutcome<T> = { kind: "ok"; value: T } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "error"; code: StyleDnaCode; status: number; estimate?: StyleDnaGenerationEstimate; requestId?: string; model?: StyleDnaGenerationRequestModel }
  | { kind: "lost" };

const known = new Set<StyleDnaCode>(["invalid_input", "too_large", "not_found", "stale_credential", "stale_revision", "request_conflict", "limit_reached",
  "not_configured", "storage_unavailable", "model_error", "timed_out", "subject_required", "in_progress",
  "invalid_reference", "reference_mismatch", "unsupported_format", "stale_spot_version", "comparison_media_mismatch", "comparison_unmeasured",
  "estimate_changed", "result_unconfirmed", "generation_in_progress", ...styleDnaGenerationFailures]);
async function json(response: Response): Promise<unknown> { return response.json().catch(() => null); }
const codeOf = (body: unknown): StyleDnaCode => {
  const code = typeof body === "object" && body && "code" in body ? String(body.code) : "";
  return known.has(code as StyleDnaCode) ? code as StyleDnaCode : "failed";
};
const isRecord = (value: unknown): value is StyleDnaRecord => !!value && typeof value === "object" && "id" in value && "revisions" in value
  && Array.isArray((value as StyleDnaRecord).revisions) && Array.isArray((value as StyleDnaRecord).tests) && "original" in value;
const isTest = (value: unknown): value is StyleDnaTestResult => !!value && typeof value === "object" && "id" in value && "image" in value && "original" in value;
/** 보호 미디어 주소가 이 기록의 그 미디어인지(서버 imageDto: /api/admin/style-dna/{기록}/media/{original|시험 ID}).
 *  같은 출처 경로만 받고 뒤에는 쿼리만 허용한다(절대 주소·다른 기록·다른 미디어·경로 덧붙임·# 거절). */
const mediaOf = (media: unknown, recordId: string, name: string) => {
  const href = media && typeof media === "object" ? (media as { href?: unknown }).href : undefined;
  const base = `${styleDnaPath}/${recordId}/media/${name}`;
  return typeof href === "string" && href.startsWith(base) && /^(?:\?[^#\s\\]*)?$/.test(href.slice(base.length));
};
const testIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** 시험 생성 성공 응답: 고른 버전이고, 결과 ID가 문자열이며, 원본은 이 기록의 original, 결과 이미지는 이 기록의 그 시험 ID 경로여야 한다. */
export const isBoundTest = (value: unknown, recordId: string, revision: number): value is StyleDnaTestResult =>
  isTest(value) && value.revision === revision && typeof value.id === "string" && testIdPattern.test(value.id) && value.id !== "original"
  && typeof recordId === "string" && testIdPattern.test(recordId) && mediaOf(value.original, recordId, "original") && mediaOf(value.image, recordId, value.id);

export const newRequestId = () => crypto.randomUUID();

// 분석·보정 엔진(서버 f2d7e63): Gemini(기본, engine 생략) 또는 등록한 OpenAI·Anthropic. 시험 이미지 생성은 언제나 Gemini.
export type EngineChoice = "gemini" | StyleDnaEngine;
export type EngineCredentials = StyleDnaEngineSettings;
export const engineLabel = (provider: EngineChoice) => ({ gemini: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic Claude" })[provider];
/** 등록된 OpenAI·Anthropic 설정(키 원문 없음). 읽지 못하면 null → 화면은 Gemini만 고를 수 있다. */
export async function readEngineCredentials(signal?: AbortSignal): Promise<EngineCredentials | null> {
  // 등록 카드(12d463d)와 같은 엄격한 읽기: 형식·모델 규칙이 맞을 때만 쓰고 실패·끊김은 null(화면은 Gemini만).
  const outcome = await readStyleDnaEngineSettings(signal ?? new AbortController().signal);
  return outcome.kind === "ok" ? outcome.value.providers : null;
}
/** 기록·리비전에 남은 실제 실행 엔진. 엔진 칸이 없는 이전 기록은 Gemini 경로(모델·버전 기록 없음). */
export const engineBasisText = (basis: StyleDnaRecordedEngine | undefined, provider?: EngineChoice) => basis
  ? `${engineLabel(basis.provider)} · ${basis.modelId} · 등록 버전 ${basis.credentialVersion}`
  : `${engineLabel(provider ?? "gemini")} · 모델 기록 없음(이전 방식)`;
export const recordPath = (id: string) => `${styleDnaPath}/${encodeURIComponent(id)}`;

export async function readStyleDnaLibrary(signal?: AbortSignal): Promise<LibraryOutcome> {
  const response = await fetch(styleDnaPath, { cache: "no-store", credentials: "same-origin", signal });
  if (response.status === 401) return { kind: "login" };
  if (response.status === 403) return { kind: "forbidden" };
  if (response.status === 503) return { kind: "unavailable" };
  const body = await json(response) as { items?: unknown; settings?: StyleDnaSettings } | null;
  if (!response.ok || !Array.isArray(body?.items) || !body?.settings || typeof body.settings.credentialVersion !== "number") return { kind: "failed" };
  return { kind: "ok", items: body.items as StyleDnaSummary[], settings: body.settings };
}

export async function readStyleDnaRecord(id: string, signal?: AbortSignal): Promise<OpOutcome<StyleDnaRecord>> {
  const response = await fetch(recordPath(id), { cache: "no-store", credentials: "same-origin", signal });
  if (response.status === 401) return { kind: "login" };
  if (response.status === 403) return { kind: "forbidden" };
  const body = await json(response) as { record?: unknown } | null;
  if (response.ok) return isRecord(body?.record) && body.record.id === id ? { kind: "ok", value: body.record } : { kind: "error", code: "failed", status: 200 };
  return { kind: "error", code: codeOf(body), status: response.status };
}

/** 서버 원장에 묶인 원 요청 모델(seedream-5.5·flux-2-pro·gpt-image-2.6). 근거 없는 구형 행·다른 범위 조회에는 값이 없다(null). */
const requestModelOf = (body: unknown): StyleDnaGenerationRequestModel | null =>
  styleDnaGenerationRequestModel.safeParse((body as { model?: unknown } | null)?.model).data ?? null;
/** model_unverified 이유: missing = 원장 모델이 없음(구형 행), mismatch = 로컬에 묶은 모델·원장 모델·결과 모델 중 어긋남. */
export type GenerationModelIssue = "missing" | "mismatch";
type GenerationStatus = { kind: "idle" | "unavailable" | "login" | "forbidden" | "missing" }
  | { kind: "model_unverified"; reason: GenerationModelIssue }
  | { kind: "pending"; requestId: string; model: StyleDnaGenerationRequestModel | null }
  | { kind: "settled"; test: StyleDnaTestResult; model: StyleDnaGenerationRequestModel }
  | { kind: "settled_error"; code: StyleDnaCode; model: StyleDnaGenerationRequestModel }
  | { kind: "deleted"; model: StyleDnaGenerationRequestModel };
const generationRequestId = z.uuid();

/** 생성 상태 조회(GET, 생성 POST 없음). requestId 없으면 이 기록의 보류 요청 발견, 있으면 그 UUID만 확인한다.
 *  확정은 같은 UUID·settled:true이고 원장 모델이 있으며 로컬에 묶은 모델(있으면)·결과 모델과 모두 같을 때만 한다. */
export async function readStyleDnaGeneration(id: string, requestId?: string, signal?: AbortSignal,
  expectedModel: StyleDnaGenerationRequestModel | null = null): Promise<GenerationStatus> {
  const path = `${recordPath(id)}/test-image${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ""}`;
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", signal }).catch(() => null);
  if (!response) return { kind: "unavailable" };
  if (response.status === 401) return { kind: "login" };
  if (response.status === 403) return { kind: "forbidden" };
  const body = await json(response) as { pending?: unknown; requestId?: unknown; settled?: unknown; test?: unknown } | null;
  const code = codeOf(body);
  const model = requestModelOf(body);
  if (response.status === 200 && !requestId && body?.pending === false) return { kind: "idle" };
  if (response.status === 202 && code === "in_progress" && body?.settled === undefined) {
    const found = generationRequestId.safeParse(body?.requestId);
    if (found.success && (!requestId || requestId === found.data)) return { kind: "pending", requestId: found.data, model };
  }
  if (requestId && body?.requestId === requestId && body.settled === true) {
    if (!model) return { kind: "model_unverified", reason: "missing" };
    if (expectedModel !== null && expectedModel !== model) return { kind: "model_unverified", reason: "mismatch" };
    // 같은 UUID에 묶인 확정 삭제: 원 기록이 지워졌다(일반 404와 구별).
    if (response.status === 404 && code === "not_found") return { kind: "deleted", model };
    if (response.status >= 400) return { kind: "settled_error", code, model };
    if (response.status === 200 && isTest(body.test) && typeof body.test.model === "string" && Number.isSafeInteger(body.test.revision) && body.test.revision > 0
      && readGeneration(body.test.generation, body.test.model) && isBoundTest(body.test, id, body.test.revision)) {
      if (body.test.model !== model) return { kind: "model_unverified", reason: "mismatch" };
      return { kind: "settled", test: body.test, model };
    }
  }
  if (response.status === 404 && code === "not_found" && body?.settled === undefined) return { kind: "missing" };
  return { kind: "unavailable" };
}

export type AnalyzeSource = { kind: "file"; file: File } | { kind: "url"; url: string } | { kind: "record"; id: string };
/** credentialVersion은 고른 엔진의 등록 버전. engine은 OpenAI·Anthropic일 때만 싣는다(Gemini는 생략 = 이전 계약 그대로). */
export type Operation = { requestId: string; credentialVersion: number; engine?: StyleDnaEngineSelection };
/** 보낼 분석 본문. 파일은 FormData(file·options 두 칸), 주소·보관 기록 재분석은 JSON. 같은 요청을 다시 확인할 때도 이 값을 그대로 쓴다. */
export function analyzeRequest(source: AnalyzeSource, options: StyleDnaOptions, op: Operation): { body: BodyInit; json: boolean; size: number } {
  const base = { requestId: op.requestId, authorized: true as const, credentialVersion: op.credentialVersion, ...options, ...(op.engine && { engine: op.engine }) };
  if (source.kind === "file") {
    const form = new FormData();
    form.set("file", source.file, source.file.name);
    form.set("options", JSON.stringify(base));
    return { body: form, json: false, size: source.file.size };
  }
  const text = JSON.stringify({ ...base, source: source.kind === "url" ? { kind: "url", url: source.url.trim() } : { kind: "record", id: source.id } });
  return { body: text, json: true, size: new TextEncoder().encode(text).length };
}
export const refineRequest = (input: { revision: number; feedback: string }, op: Operation) =>
  JSON.stringify({ requestId: op.requestId, authorized: true, credentialVersion: op.credentialVersion, revision: input.revision, feedback: input.feedback.trim(),
    ...(op.engine && { engine: op.engine }) });
/** customPrompt가 있으면 서버는 피사체를 쓰지 않는다(직접 편집한 프롬프트 그대로, 피사체 자리가 남으면 subject_required). */
/** 생성 공급자 모델이면 expectedCostMicros(누르기 전에 보여 준 금액)를 함께 보낸다. credentialVersion은 그 공급자 키의 등록 버전이다. */
/** usage 기반 모델(GPT Image 2.6)은 금액 대신 billing: "usage_based"를 보낸다(둘을 함께 보내면 서버가 400). */
export type TestInput = { revision: number; model: StyleDnaResultModel; subject: string; attachImage: boolean; aspectRatio?: string; customPrompt?: string;
  expectedCostMicros?: number; billing?: "usage_based" };
const testFields = (input: TestInput, op: Operation) => ({ requestId: op.requestId, authorized: true, credentialVersion: op.credentialVersion,
  revision: input.revision, model: input.model, subject: input.customPrompt === undefined ? input.subject.trim() : "", attachImage: input.attachImage,
  ...(input.aspectRatio && { aspectRatio: input.aspectRatio }), ...(input.customPrompt !== undefined && { customPrompt: input.customPrompt.trim() }),
  ...(input.expectedCostMicros !== undefined && { expectedCostMicros: input.expectedCostMicros }), ...(input.billing && { billing: input.billing }) });
export const testRequest = (input: TestInput, op: Operation) => JSON.stringify(testFields(input, op));
/** 참조 이미지를 바꾼 시험(서버 styleDnaTestWithReference): multipart customReference + options(원본 첨부 끔, 파일 sha256). */
export function testUploadRequest(input: TestInput, op: Operation, file: File, sha256: string): { body: FormData; json: false } {
  const form = new FormData();
  form.set("customReference", file, file.name);
  form.set("options", JSON.stringify({ ...testFields({ ...input, attachImage: false }, op), customReferenceSha256: sha256 }));
  return { body: form, json: false };
}
/** 참조 이미지 파일의 sha256(서버가 같은 값인지 확인한다). */
export async function fileSha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** 참조 이미지로 받는 형식·크기(서버 referenceFileFormat·referenceUploadByteLimit과 같음). */
export const referenceImage = { accept: ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp", limit: 4 * 1024 * 1024,
  ok: (file: File) => /\.(?:png|jpe?g|webp)$/i.test(file.name) && file.size > 0 && file.size <= 4 * 1024 * 1024 };
/** 기본 시험 프롬프트(서버 styleDnaTestPrompt와 같은 피사체 대입): 직접 편집 칸의 시작값. */
export const fillSubject = (prompt: string, subject: string) => subject.trim()
  ? prompt.replace(/\[(?:INSERT SUBJECT HERE|주제 입력|피사체 입력|피사체를 입력하세요)\]/gi, () => subject.trim()) : prompt;

const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});
/** 쓰기 한 건. 202면 같은 본문을 polls번까지 다시 보낸다(서버가 같은 요청으로 알아보고 새 호출을 하지 않는다). 연결이 끊기면 lost.
 *  생성 공급자 시험은 polls 0으로 불러 자동 재전송 없이 '결과 다시 확인'(같은 본문, 사용자가 누를 때만)으로 넘긴다. */
async function send<T>(path: string, request: { body: BodyInit; json: boolean }, pick: (body: unknown) => T | null,
  options: { signal?: AbortSignal; polls?: number; wait?: number } = {}): Promise<OpOutcome<T>> {
  const { signal, polls = 20, wait = 1500 } = options;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(path, { method: "POST", credentials: "same-origin", signal, body: request.body,
        ...(request.json && { headers: { "content-type": "application/json" } }) });
    } catch (error) {
      if (signal?.aborted) throw error;
      return { kind: "lost" };
    }
    if (response.status === 401) return { kind: "login" };
    if (response.status === 403) return { kind: "forbidden" };
    const body = await json(response);
    if (response.status === 202 && attempt < polls) { await pause(wait, signal); continue; }
    if (response.status === 201 || response.status === 200) {
      const value = pick(body);
      return value ? { kind: "ok", value } : { kind: "error", code: "failed", status: response.status };
    }
    const code = response.status === 202 ? "in_progress" : codeOf(body);
    // 503 result_unconfirmed: 공급자가 처리했을 수 있지만 서버가 결과 기록을 확인하지 못했다(영수증은 처리 중으로 남음).
    // 다른 오류처럼 그대로 돌려주고, 화면이 같은 요청 번호·본문의 '결과 다시 확인'만 남긴다(자동 재전송 없음).
    // 게이트웨이 시간 초과는 서버가 결과를 저장하기 전일 수도 뒤일 수도 있다(같은 요청으로만 다시 확인).
    if (response.status === 504 && code === "failed") return { kind: "lost" };
    const estimate = code === "estimate_changed" ? readGenerationEstimate((body as { estimate?: unknown } | null)?.estimate) : null;
    // 409 다른 보류 요청, 또는 504 접수 미확인·결과 유실(FLUX·GPT Image: 서버가 같은 요청 번호로 예약을 유지하고 그 번호를 돌려준다)
    const held = response.status === 504 && (code === "generation_submission_unknown" || code === "generation_result_lost");
    const collision = (response.status === 409 && code === "generation_in_progress") || held
      ? generationRequestId.safeParse((body as { requestId?: unknown } | null)?.requestId) : undefined;
    // 원 요청 모델(202 재시도·409 다른 보류 요청·504 예약 유지): 서버 원장 값만 싣는다(없으면 생략).
    const model = response.status === 202 || collision?.success ? requestModelOf(body) : null;
    return { kind: "error", code, status: response.status, ...(estimate && { estimate }),
      ...(collision?.success && { requestId: collision.data }), ...(model && { model }) };
  }
}
const pickRecord = (body: unknown) => (body as { record?: unknown } | null)?.record;
export const analyzeStyleDna = (request: ReturnType<typeof analyzeRequest>, options?: { signal?: AbortSignal; polls?: number; wait?: number }) =>
  send(styleDnaPath, request, body => { const record = pickRecord(body); return isRecord(record) ? record : null; }, options);
export const refineStyleDna = (id: string, body: string, expectRevision: number, options?: { signal?: AbortSignal; polls?: number; wait?: number }) =>
  send(`${recordPath(id)}/refine`, { body, json: true }, value => {
    const record = pickRecord(value);
    return isRecord(record) && record.id === id && record.revisions.some(item => item.revision === expectRevision) ? record : null;
  }, options);
export const testStyleDna = (id: string, body: string | { body: FormData; json: false }, revision: number, options?: { signal?: AbortSignal; polls?: number; wait?: number }) =>
  send(`${recordPath(id)}/test-image`, typeof body === "string" ? { body, json: true } : body, value => {
    const test = (value as { test?: unknown } | null)?.test;
    return isBoundTest(test, id, revision) ? test : null;
  }, options);

/** 비교 기록(서버 e440d72·3fae275 PATCH /{id}): 점검 지점 저장(서버가 저장된 원본·결과에서 5×5 색 차이를 잰다)과 추세 기록(공급자 호출 없음).
 *  지점 버전이 다르면 409 stale_spot_version, 지점 없이 추세는 422 comparison_unmeasured, 같은 시험 추세는 서버가 한 번만 남긴다. */
export type CompareTarget = { testId: string; originalSha256: string; resultSha256: string; spotVersion: number };
export type CompareCommand = ({ action: "save-spots"; frame: StyleDnaComparisonFrame; spots: { x: number; y: number }[] } | { action: "record-trend"; prompt?: string }) & CompareTarget;
/** 보관함 삭제(Backend 0727932): 같은 출처·본문 없음. 204 = 성공(본문 없음, 파싱 안 함), 없음·다른 계정·다시 삭제 = 같은 404 not_found,
 * UUID 아님 400, 저장소 미연결 503. 연결이 끊기면 지워졌는지 알 수 없어 lost(목록을 다시 읽어 확인). */
export async function deleteStyleDna(id: string, signal?: AbortSignal): Promise<OpOutcome<null>> {
  let response: Response;
  try {
    response = await fetch(recordPath(id), { method: "DELETE", cache: "no-store", credentials: "same-origin", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "lost" };
  }
  if (response.status === 204) return { kind: "ok", value: null };
  if (response.status === 401) return { kind: "login" };
  if (response.status === 403) return { kind: "forbidden" };
  return { kind: "error", code: response.status === 503 ? "storage_unavailable" : codeOf(await json(response)), status: response.status };
}

export async function compareStyleDna(id: string, command: CompareCommand, signal?: AbortSignal): Promise<OpOutcome<StyleDnaComparison>> {
  let response: Response;
  try {
    response = await fetch(recordPath(id), { method: "PATCH", credentials: "same-origin", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify(command.action === "record-trend"
        ? { action: command.action, testId: command.testId, originalSha256: command.originalSha256, resultSha256: command.resultSha256, spotVersion: command.spotVersion,
          requestId: newRequestId(), ...(command.prompt?.trim() && { prompt: command.prompt.trim() }) }
        : { ...command, requestId: newRequestId() }) });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "lost" };
  }
  if (response.status === 401) return { kind: "login" };
  if (response.status === 403) return { kind: "forbidden" };
  const body = await json(response) as { comparison?: StyleDnaComparison } | null;
  if (response.ok) return body?.comparison && Array.isArray(body.comparison.spots) && Array.isArray(body.comparison.trends)
    ? { kind: "ok", value: body.comparison } : { kind: "error", code: "failed", status: response.status };
  return { kind: "error", code: codeOf(body), status: response.status };
}

/** 원본·결과의 서버 실측 5색으로 낸 색 근접도(0~100). 원본 색마다 결과에서 가장 가까운 색까지의 RGB 거리를 비중으로 가중 평균한다. */
export function paletteProximity(original: { hex: string; share: number }[], result: { hex: string; share: number }[]) {
  const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  const valid = (list: { hex: string; share: number }[]) => list.filter(item => /^#[0-9a-f]{6}$/i.test(item.hex) && item.share > 0);
  const from = valid(original), to = valid(result);
  if (!from.length || !to.length) return null;
  const total = from.reduce((sum, item) => sum + item.share, 0);
  const distance = from.reduce((sum, item) => {
    const [r, g, b] = rgb(item.hex);
    const nearest = Math.min(...to.map(other => { const [x, y, z] = rgb(other.hex); return Math.hypot(r - x, g - y, b - z); }));
    return sum + item.share * nearest;
  }, 0) / total;
  return Math.max(0, Math.round(100 - distance / Math.hypot(255, 255, 255) * 100));
}
/** 프롬프트에 피사체 자리표시가 있는지(서버 시험 생성과 같은 규칙: 있으면 피사체를 넣어야 해요). */
export const needsSubject = (prompt?: string) => !!prompt && /\[(?:INSERT SUBJECT HERE|주제 입력|피사체 입력|피사체를 입력하세요)\]/i.test(prompt);
