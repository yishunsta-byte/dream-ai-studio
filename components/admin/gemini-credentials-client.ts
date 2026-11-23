import { z } from "zod";
import {
  analysisCredentialPath, credentialTestResult, geminiCredentialKey, geminiPrograms, modelId,
  type CredentialGroup as ContractGroup, type GeminiProgram,
} from "@/lib/reference-analysis/analysis-credential-contract";

// 관리자 Gemini 키·모델 등록의 화면 쪽 통신. 경로·키·모델 ID·시험 결과 형식은 서버 계약 파일(f764500)을 그대로 쓴다.
// 키 원문은 저장 요청 본문에만 실리고 응답·화면 상태에는 남지 않는다. 서버는 Gemini로 키·모델을 확인한 뒤에만 저장한다.
export const CREDENTIALS_URI = analysisCredentialPath;

export const credentialGroups = {
  reference: ["image", "shorts"],
  music: ["music"],
} as const satisfies Record<ContractGroup, readonly GeminiProgram[]>;
export type CredentialGroup = ContractGroup;
export type CredentialProgram = GeminiProgram;
export const isModelId = (value: string) => modelId.safeParse(value).success;
// 키 값은 형식만 보고 바로 요청 본문으로만 쓴다.
export const isKeyFormat = (value: string) => geminiCredentialKey.safeParse(value).success;

const iso = z.iso.datetime({ offset: true });
const program = z.object({ configured: z.boolean(), source: z.enum(["stored", "environment", "none"]), modelId: z.string().max(128).nullable(),
  lastTest: credentialTestResult.nullable().optional() });
const group = z.object({ version: z.number().int().nonnegative(), updatedAt: iso.nullable() });
const settings = z.object({
  storage: z.enum(["ready", "unavailable"]),
  groups: z.object({ reference: group, music: group }),
  programs: z.object({ image: program, shorts: program, music: program }),
});
const fieldName = z.enum(["apiKey", "models.image", "models.music", "models.shorts"]);
// 화면에 없는 칸(expectedVersion 등)을 가리키는 오류는 칸 오류가 아니라 일반 실패로 본다.
const errorBody = z.object({ code: z.string().max(80), field: z.string().max(80).optional() });

export type CredentialSettings = z.infer<typeof settings>;
export type CredentialTest = z.infer<typeof credentialTestResult>;
export type CredentialTestCode = NonNullable<CredentialTest["code"]>;
export type CredentialField = z.infer<typeof fieldName>;
export type CredentialOutcome =
  | { kind: "ok"; value: CredentialSettings }
  | { kind: "login" } | { kind: "forbidden" } | { kind: "stale" } | { kind: "storage" } | { kind: "provider" }
  | { kind: "timeout" } | { kind: "failed" }
  | { kind: "field"; field: CredentialField; code: "invalid_input" | "invalid_key" | "model_not_found" };

type Failure = Exclude<CredentialOutcome, { kind: "ok" }>;
async function request<T>(uri: string, init: RequestInit, schema: z.ZodType<T>): Promise<{ kind: "ok"; value: T } | Failure> {
  try {
    const response = await fetch(uri, { ...init, credentials: "same-origin", cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = schema.safeParse(body);
      return parsed.success ? { kind: "ok", value: parsed.data } : { kind: "failed" };
    }
    const error = errorBody.safeParse(body);
    const code = error.success ? error.data.code : "";
    const named = fieldName.safeParse(error.success ? error.data.field : undefined);
    const field = named.success ? named.data : undefined;
    if (response.status === 401) return { kind: "login" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "stale" };
    if ((response.status === 400 || response.status === 422) && field &&
      (code === "invalid_input" || code === "invalid_key" || code === "model_not_found")) return { kind: "field", field, code };
    if (response.status === 503 && code === "storage_unavailable") return { kind: "storage" };
    if (response.status === 503 && code === "provider_error") return { kind: "provider" };
    if (response.status === 504) return { kind: "timeout" };
    return { kind: "failed" };
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return { kind: "failed" };
  }
}

const call = (init: RequestInit): Promise<CredentialOutcome> => request(CREDENTIALS_URI, init, settings);

export function readCredentialSettings(signal: AbortSignal) {
  return call({ method: "GET", signal });
}

export type CredentialSave = { group: CredentialGroup; expectedVersion: number; apiKey?: string; models: Partial<Record<CredentialProgram, string>> };
export function saveCredentialSettings(input: CredentialSave, signal: AbortSignal) {
  const { apiKey, ...rest } = input;
  return call({ method: "PUT", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(apiKey ? { ...rest, apiKey } : rest) });
}

export const TEST_URI = `${CREDENTIALS_URI}/test`;
// 시험 응답은 {program, ...시험 결과}. 결과 부분은 계약의 엄격한 형식으로 검사한다.
const testReply = z.looseObject({ program: z.enum(geminiPrograms) }).transform((value, context) => {
  const { program, ...rest } = value;
  const result = credentialTestResult.safeParse(rest);
  if (!result.success) { context.addIssue({ code: "custom", message: "test result" }); return z.NEVER; }
  return { program, ...result.data };
});
export type CredentialTestOutcome = { kind: "ok"; value: z.infer<typeof testReply> } | Failure;
// 저장된 설정으로 한 분석기의 연결을 시험한다. 시험한 버전이 지금 버전과 다르면 서버가 409를 준다.
export function testCredential(input: { program: CredentialProgram; group: CredentialGroup; version: number }, signal: AbortSignal): Promise<CredentialTestOutcome> {
  return request(TEST_URI, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, testReply);
}
