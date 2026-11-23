import { z } from "zod";
import { analysisCredentialPath } from "@/lib/reference-analysis/analysis-credential-contract";
import { shortsIdeasPath, shortsIdeasResult } from "@/lib/reference-analysis/shorts-ideas-contract";
import { shortsBgmPromptPath, shortsBgmPromptResult } from "@/lib/reference-analysis/shorts-bgm-prompt-contract";
import {
  shortsScenePromptPath, shortsScenePromptsBatchResult, shortsScenePromptsRangeResult,
} from "@/lib/reference-analysis/shorts-scene-prompt-contract";
import { shortsScriptPath, shortsScriptResult } from "@/lib/reference-analysis/shorts-script-contract";
import {
  shortsVaultPath, shortsVaultProjectDocument, shortsVaultPromptSearchPath, shortsVaultPromptSetDocument, shortsVaultSearchQueryLimit, type ShortsVaultProject, type ShortsVaultProjectDocument,
  type ShortsVaultProjectSummary, type ShortsVaultPromptSet, type ShortsVaultPromptSetDocument, type ShortsVaultPromptSetSummary,
} from "@/lib/reference-analysis/shorts-vault-contract";

// P1-08 원본 쇼츠 ③~⑥·보관함 화면이 부르는 서버 요청. 모든 요청은 같은 출처·쿠키, 캐시 없음, 넘겨주기 금지, 시간 상한을 둔다.
// 응답은 계약으로 다시 검사하고, 맞지 않으면 쓰지 않는다(invalid_response).
export type Reply<T> = { kind: "ok"; value: T } | { kind: "denied" } | { kind: "failed"; code: string; status: number };

const generationTimeout = 40_000;
const vaultTimeout = 12_000;

async function call<T>(path: string, method: string, body: unknown, parse: (json: unknown) => T | null, signal: AbortSignal, timeout: number): Promise<Reply<T>> {
  try {
    const response = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store", redirect: "error",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    if (response.status === 401 || response.status === 403) return { kind: "denied" };
    const json: unknown = response.status === 204 ? null : await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = json && typeof json === "object" && "code" in json && typeof json.code === "string" ? json.code : "unavailable";
      return { kind: "failed", code, status: response.status };
    }
    const value = json === undefined ? null : parse(json);
    return value === null ? { kind: "failed", code: "invalid_response", status: response.status } : { kind: "ok", value };
  } catch (error) {
    if (signal.aborted) return { kind: "failed", code: "cancelled", status: 0 };
    return { kind: "failed", code: error instanceof DOMException && error.name === "TimeoutError" ? "timed_out" : "network", status: 0 };
  }
}

const messages: Record<string, string> = {
  not_configured: "쇼츠 모델이 연결되지 않았어요. 설정에서 Gemini 키와 쇼츠 모델을 등록해 주세요.",
  stale: "Gemini 설정이 그사이 바뀌었어요. 다시 실행해 주세요.",
  ideas_in_progress: "이미 만들고 있는 요청이 있어요. 끝난 뒤 다시 시도해 주세요.",
  in_progress: "이미 만들고 있는 요청이 있어요. 끝난 뒤 다시 시도해 주세요.",
  script_in_progress: "이미 대본을 만들고 있어요. 끝난 뒤 다시 시도해 주세요.",
  scene_prompt_in_progress: "이미 장면 프롬프트를 만들고 있어요. 끝난 뒤 다시 시도해 주세요.",
  bgm_prompt_in_progress: "이미 BGM 프롬프트를 만들고 있어요. 끝난 뒤 다시 시도해 주세요.",
  timed_out: "응답이 늦어 멈췄어요. 잠시 뒤 다시 시도해 주세요.",
  storage_unavailable: "설정 저장소에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.",
  too_large: "보낼 내용이 너무 커요. 장면 수를 줄여 다시 시도해 주세요.",
  invalid_input: "보낼 내용이 형식에 맞지 않아요. 앞 단계를 다시 실행해 주세요.",
  invalid_model_response: "Gemini 응답이 형식에 맞지 않았어요. 다시 시도해 주세요.",
  invalid_response: "서버 응답이 형식에 맞지 않았어요. 다시 시도해 주세요.",
  provider_error: "Gemini가 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  // 502 model_error: Gemini 호출 자체가 실패(일시 장애·키 거절·권한·사용 한도). 응답 형식 오류(invalid_model_response)와 다르게 알린다.
  model_error: "Gemini가 요청을 처리하지 못했어요. 일시 장애이거나 키·권한·사용 한도 문제일 수 있어요. 잠시 뒤 다시 시도하고, 계속되면 Gemini 키와 쇼츠 모델을 확인해 주세요.",
  // Tester D5: 보관함은 키처럼 보이는 글(x-goog-api-key, AIza…, sk-… 등)이 든 문서를 400 secret_rejected로 거절한다. 다시 시도해도 같으니 고칠 곳을 알린다.
  secret_rejected: "API 키처럼 보이는 글이 들어 있어요. 주제·대본·프롬프트에서 키 모양 글을 지우거나 바꿔 주세요.",
  network: "서버에 연결할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.",
  cancelled: "취소했어요.",
};
export function replyMessage(reply: Exclude<Reply<unknown>, { kind: "ok" }>) {
  if (reply.kind === "denied") return "관리자 로그인이 필요해요. 다시 로그인해 주세요.";
  if (Object.hasOwn(messages, reply.code)) return messages[reply.code];
  if (reply.status === 504) return messages.timed_out;
  // 코드를 모르는 502는 형식 오류로 단정하지 않고 공급자 실패로 알린다.
  if (reply.status === 502) return messages.provider_error;
  return "지금은 요청을 처리할 수 없어요. 잠시 뒤 다시 시도해 주세요.";
}

const settings = z.object({
  groups: z.object({ reference: z.object({ version: z.number().int().min(0) }) }),
  programs: z.object({ shorts: z.object({ configured: z.boolean() }) }),
});
const safe = <T>(schema: z.ZodType<T>) => (json: unknown) => { const checked = schema.safeParse(json); return checked.success ? checked.data : null; };

/** 생성 요청마다 지금 저장된 Gemini 설정 버전을 새로 읽는다(설정이 바뀐 뒤의 409를 줄인다). 버전 0이면 저장된 키가 없다. */
async function withGemini<T>(signal: AbortSignal, send: (version: number) => Promise<Reply<T>>): Promise<Reply<T>> {
  const read = await call(analysisCredentialPath, "GET", undefined, safe(settings), signal, vaultTimeout);
  if (read.kind !== "ok") return read;
  const version = read.value.groups.reference.version;
  if (!version || !read.value.programs.shorts.configured) return { kind: "failed", code: "not_configured", status: 503 };
  return send(version);
}

export const requestIdeas = (body: Record<string, unknown>, signal: AbortSignal) => withGemini(signal, version =>
  call(shortsIdeasPath, "POST", { ...body, authorized: true, geminiCredentialVersion: version }, safe(shortsIdeasResult), signal, generationTimeout));
export const requestScript = (body: Record<string, unknown>, signal: AbortSignal) => withGemini(signal, version =>
  call(shortsScriptPath, "POST", { ...body, authorized: true, geminiCredentialVersion: version }, safe(shortsScriptResult), signal, generationTimeout));
export const requestScenePrompts = (body: Record<string, unknown>, signal: AbortSignal) => withGemini(signal, version =>
  call(shortsScenePromptPath, "POST", { ...body, authorized: true, geminiCredentialVersion: version }, safe(shortsScenePromptsBatchResult), signal, generationTimeout));
/** P1-08-SHORTS-SCENE-CHUNKS: 장면 구간(최대 9) 하나. 응답의 구간이 보낸 구간과 다르면 쓰지 않는다. */
export const requestScenePromptRange = (body: Record<string, unknown> & { range: { from: number; to: number } }, signal: AbortSignal) =>
  withGemini(signal, version => call(shortsScenePromptPath, "POST", { ...body, authorized: true, geminiCredentialVersion: version },
    json => { const value = safe(shortsScenePromptsRangeResult)(json);
      return value && value.generation.range.from === body.range.from && value.generation.range.to === body.range.to ? value : null; },
    signal, generationTimeout));
export const requestBgmPrompt = (body: Record<string, unknown>, signal: AbortSignal) => withGemini(signal, version =>
  call(shortsBgmPromptPath, "POST", { ...body, authorized: true, geminiCredentialVersion: version }, safe(shortsBgmPromptResult), signal, generationTimeout));

// 보관함. 문서는 받을 때도 엄격한 Vault 계약으로 검사한다.
const promptSummary = z.object({ id: z.string(), title: z.string(), ideaTitle: z.string(), keyword: z.string(),
  sceneCount: z.number(), hasBgm: z.boolean(), createdAt: z.string() });
const projectSummary = z.object({ id: z.string(), title: z.string(), keyword: z.string(), step: z.number(), revision: z.number(),
  createdAt: z.string(), updatedAt: z.string(), expiresAt: z.string() });
const pick = <T>(key: string, schema: z.ZodType<T>) => (json: unknown) => {
  const checked = z.object({ [key]: schema }).safeParse(json);
  return checked.success ? checked.data[key] as T : null;
};
const deleted = () => true;
const vault = `${shortsVaultPath}`;
const nonce = () => crypto.randomUUID();
export const newRequestId = nonce;

export const listProjects = (signal: AbortSignal) =>
  call<ShortsVaultProjectSummary[]>(`${vault}/projects`, "GET", undefined, pick("projects", z.array(projectSummary)), signal, vaultTimeout);
export const openProject = (id: string, signal: AbortSignal) =>
  call<ShortsVaultProject>(`${vault}/projects/${encodeURIComponent(id)}`, "GET", undefined,
    pick("project", projectSummary.extend({ document: shortsVaultProjectDocument })), signal, vaultTimeout);
export const createProject = (requestId: string, document: ShortsVaultProjectDocument, signal: AbortSignal) =>
  call<ShortsVaultProjectSummary>(`${vault}/projects`, "POST", { requestId, document }, pick("project", projectSummary), signal, vaultTimeout);
export const replaceProject = (id: string, expectedRevision: number, document: ShortsVaultProjectDocument, signal: AbortSignal) =>
  call<ShortsVaultProjectSummary>(`${vault}/projects/${encodeURIComponent(id)}`, "PUT", { expectedRevision, document },
    pick("project", projectSummary), signal, vaultTimeout);
export const deleteProject = (id: string, signal: AbortSignal) =>
  call(`${vault}/projects/${encodeURIComponent(id)}`, "DELETE", undefined, deleted, signal, vaultTimeout);

export const listPromptSets = (signal: AbortSignal) =>
  call<ShortsVaultPromptSetSummary[]>(`${vault}/prompts`, "GET", undefined, pick("promptSets", z.array(promptSummary)), signal, vaultTimeout);
/** P1-08-SHORTS-VAULT-CONTENT-SEARCH-UI: 보관함 안 내용 검색. 서버가 제목·소재·첫 훅·키워드·장면·Suno 프롬프트까지 찾아 목록과 같은 요약({promptSets})으로 돌려준다.
 * 검색어는 앞뒤 공백을 빼고 1~120자만 보낸다(빈 검색어는 보내지 않고 GET 목록을 쓴다). 검색어는 화면 메모리에만 두고 주소·저장소에 남기지 않는다. */
// 상한 120은 UTF-16 코드 단위가 아니라 유니코드 코드 포인트다(Backend 후보 6935160과 같음). 이모지 같은 보조 평면 문자를 반쪽으로 자르지 않는다.
const codePoints = (text: string, max: number) => Array.from(text).slice(0, max).join("");
export const vaultSearchQuery = (raw: string) => codePoints(raw.trim(), shortsVaultSearchQueryLimit).trim();
/** 검색 칸 입력 제한: 앞 공백은 두고 나머지를 120 코드 포인트까지(HTML maxLength는 UTF-16 단위라 쓰지 않는다). */
export function limitVaultSearchInput(value: string) {
  const lead = /^\s*/.exec(value)?.[0] ?? "";
  return lead + codePoints(value.slice(lead.length), shortsVaultSearchQueryLimit);
}
export const searchPromptSets = (query: string, signal: AbortSignal) =>
  call<ShortsVaultPromptSetSummary[]>(shortsVaultPromptSearchPath, "POST", { query: vaultSearchQuery(query) }, pick("promptSets", z.array(promptSummary)), signal, vaultTimeout);
export const openPromptSet = (id: string, signal: AbortSignal) =>
  call<ShortsVaultPromptSet>(`${vault}/prompts/${encodeURIComponent(id)}`, "GET", undefined,
    pick("promptSet", z.object({ id: z.string(), createdAt: z.string(), document: shortsVaultPromptSetDocument })), signal, vaultTimeout);
export const createPromptSet = (requestId: string, document: ShortsVaultPromptSetDocument, signal: AbortSignal) =>
  call<{ id: string }>(`${vault}/prompts`, "POST", { requestId, document }, pick("promptSet", z.object({ id: z.string() })), signal, vaultTimeout);
export const deletePromptSet = (id: string, signal: AbortSignal) =>
  call(`${vault}/prompts/${encodeURIComponent(id)}`, "DELETE", undefined, deleted, signal, vaultTimeout);

/** 보관함이 운영에 아직 없거나 쓸 수 없을 때(503): 단계 실행은 막지 않고 안내만 한다. */
export const vaultClosed = (reply: Reply<unknown>) => reply.kind === "failed" && reply.status === 503;

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
