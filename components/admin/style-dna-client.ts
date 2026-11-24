"use client";

import {
  styleDnaPath, type StyleDnaComparison, type StyleDnaComparisonFrame, type StyleDnaOptions, type StyleDnaRecord, type StyleDnaRecordedEngine, type StyleDnaSummary, type StyleDnaTestResult,
} from "@/lib/reference-analysis/style-dna-contract";
import { readStyleDnaEngineSettings, type StyleDnaEngineSettings } from "./style-dna-engine-credentials-client";
import {
  type StyleDnaEngine, type StyleDnaEngineSelection,
} from "@/lib/reference-analysis/style-dna-engine-credential-contract";

// P1-06 Style DNA 작업실(Backend ab798b1 계약: /api/admin/style-dna 목록·분석, /{id} 기록, /{id}/refine, /{id}/test-image, /{id}/media/{media}).
// 모든 쓰기는 requestId·authorized·credentialVersion을 함께 보내고, 같은 requestId·같은 내용이면 서버가 새 호출 없이 저장된 결과를 돌려준다.
// 202(진행 중)는 같은 requestId·같은 본문으로 잠시 뒤 다시 물어보고, 연결이 끊긴 요청도 같은 본문으로만 다시 확인한다(새 생성 아님).
export type StyleDnaSettings = { storage: "ready"; credentialVersion: number; analysisModel: string | null;
  testModels: { id: StyleDnaTestResult["model"]; size: string; label: string }[] };
export type LibraryOutcome = { kind: "ok"; items: StyleDnaSummary[]; settings: StyleDnaSettings } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unavailable" } | { kind: "failed" };
export type StyleDnaCode = "invalid_input" | "too_large" | "not_found" | "stale_credential" | "stale_revision" | "request_conflict" | "limit_reached"
  | "not_configured" | "storage_unavailable" | "model_error" | "timed_out" | "subject_required" | "in_progress"
  | "invalid_reference" | "reference_mismatch" | "unsupported_format"
  | "stale_spot_version" | "comparison_media_mismatch" | "comparison_unmeasured" | "failed";
export type OpOutcome<T> = { kind: "ok"; value: T } | { kind: "login" } | { kind: "forbidden" } | { kind: "error"; code: StyleDnaCode; status: number }
  | { kind: "lost" };

const known = new Set<StyleDnaCode>(["invalid_input", "too_large", "not_found", "stale_credential", "stale_revision", "request_conflict", "limit_reached",
  "not_configured", "storage_unavailable", "model_error", "timed_out", "subject_required", "in_progress",
  "invalid_reference", "reference_mismatch", "unsupported_format", "stale_spot_version", "comparison_media_mismatch", "comparison_unmeasured"]);
async function json(response: Response): Promise<unknown> { return response.json().catch(() => null); }
const codeOf = (body: unknown): StyleDnaCode => {
  const code = typeof body === "object" && body && "code" in body ? String(body.code) : "";
  return known.has(code as StyleDnaCode) ? code as StyleDnaCode : "failed";
};
const isRecord = (value: unknown): value is StyleDnaRecord => !!value && typeof value === "object" && "id" in value && "revisions" in value
  && Array.isArray((value as StyleDnaRecord).revisions) && Array.isArray((value as StyleDnaRecord).tests) && "original" in value;
const isTest = (value: unknown): value is StyleDnaTestResult => !!value && typeof value === "object" && "id" in value && "image" in value && "original" in value;

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
export type TestInput = { revision: number; model: StyleDnaTestResult["model"]; subject: string; attachImage: boolean; aspectRatio?: string; customPrompt?: string };
const testFields = (input: TestInput, op: Operation) => ({ requestId: op.requestId, authorized: true, credentialVersion: op.credentialVersion,
  revision: input.revision, model: input.model, subject: input.customPrompt === undefined ? input.subject.trim() : "", attachImage: input.attachImage,
  ...(input.aspectRatio && { aspectRatio: input.aspectRatio }), ...(input.customPrompt !== undefined && { customPrompt: input.customPrompt.trim() }) });
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
/** 쓰기 한 건. 202면 같은 본문을 polls번까지 다시 보낸다(서버가 같은 요청으로 알아보고 새 호출을 하지 않는다). 연결이 끊기면 lost. */
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
    // A gateway timeout may occur before or after the server saves the result.
    if (response.status === 504 && code === "failed") return { kind: "lost" };
    return { kind: "error", code, status: response.status };
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
    return isTest(test) && test.revision === revision ? test : null;
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
