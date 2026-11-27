import { z } from "zod";
import {
  acceptsStyleDnaGenerationKey, styleDnaGenerationCredentialPath, styleDnaGenerationKeyCharacters, styleDnaGenerationKeyLimits, styleDnaGenerationProvider,
  type StyleDnaGenerationCredentialWrite,
} from "@/lib/reference-analysis/style-dna-generation-credential-contract";

// 이미지 생성 공급자 키 등록(P2-02-STYLE-DNA-SEEDREAM-CREDENTIAL-UI, Master msg_6d8d71f46ed0 계약).
//   GET  /api/admin/style-dna/generation-credentials → { providers: { byteplus: { configured, version, updatedAt } } }
//   PUT  { provider: "byteplus", expectedVersion, apiKey } → { provider, setting: { configured: true, version, updatedAt } }
// 분석 엔진 키(/api/admin/style-dna/engine-credentials)와 다른 경로·다른 버전이다. 경로·공급자·키 검사는 서버와 같은 계약 파일에서 가져온다.
// 응답에 키 원문·앞뒤 글자·길이 같은 칸이 하나라도 더 있으면 strict 스키마가 거절한다(화면에 남기지 않음).
// FLUX.2 pro(BFL) 준비(P2-02-STYLE-DNA-FLUX2-CREDENTIAL-PREFLIGHT): 화면은 서버 계약보다 먼저 bfl 칸을 "있으면 받는" 선택 항목으로 읽는다.
// 서버가 bfl을 아직 내지 않으면 BytePlus 카드만, 내기 시작하면 BFL 카드도 그린다(어느 순서로 배포돼도 기존 카드가 깨지지 않음).
// GPT Image 2.6(P2-02-STYLE-DNA-GPT-IMAGE-UI F3, 서버 4ba5eecc): openai 생성 키도 같은 방식의 선택 항목이다. 분석 엔진 openai 키와 다른 표·다른 버전이다.
export { styleDnaGenerationCredentialPath, styleDnaGenerationKeyCharacters, styleDnaGenerationKeyLimits };
export const styleDnaGenerationProviders = styleDnaGenerationProvider.options;
export const styleDnaGenerationCardProviders = ["byteplus", "bfl", "openai"] as const;
export type StyleDnaGenerationProvider = typeof styleDnaGenerationCardProviders[number];

const stored = z.strictObject({
  configured: z.literal(true), version: z.int().min(1).max(2_147_483_647), updatedAt: z.iso.datetime({ offset: true }),
});
const empty = z.strictObject({ configured: z.literal(false), version: z.literal(0), updatedAt: z.null() });
const setting = z.discriminatedUnion("configured", [stored, empty]);
const settings = z.strictObject({ providers: z.strictObject({ byteplus: setting, bfl: setting.optional(), openai: setting.optional() }) });
const saved = z.strictObject({ provider: z.enum(styleDnaGenerationCardProviders), setting: stored });

export type StyleDnaGenerationSetting = z.infer<typeof setting>;
export type StyleDnaGenerationSettings = z.infer<typeof settings>["providers"];
export type GenerationSettingWrite = Omit<StyleDnaGenerationCredentialWrite, "provider"> & { provider: StyleDnaGenerationProvider };
export type { StyleDnaGenerationCredentialWrite };
type RequestIssue = "login" | "forbidden" | "storage" | "stale" | "invalid" | "failed" | "invalid_key" | "quota_exceeded" | "timed_out";
type Outcome<T> = { kind: "ok"; value: T } | { kind: RequestIssue };

// 서버 PUT과 같은 판정(다듬거나 자르지 않고 입력 그대로 검사한다).
export const acceptsGenerationKey = acceptsStyleDnaGenerationKey;

async function read<T>(schema: z.ZodType<T>, init: RequestInit): Promise<Outcome<T>> {
  try {
    const response = await fetch(styleDnaGenerationCredentialPath, { ...init, credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) return { kind: "login" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 503) {
      const issue = z.object({ code: z.literal("storage_unavailable") }).safeParse(await response.json().catch(() => undefined));
      return { kind: issue.success ? "storage" : "failed" };
    }
    if (response.status === 409) return { kind: "stale" };
    if (response.status === 422) {
      const issue = z.object({ code: z.literal("invalid_key") }).safeParse(await response.json().catch(() => undefined));
      return { kind: issue.success ? "invalid_key" : "failed" };
    }
    if (response.status === 429) return { kind: "quota_exceeded" };
    if (response.status === 504) return { kind: "timed_out" };
    if (response.status === 400 || response.status === 413) return { kind: "invalid" };
    if (!response.ok) return { kind: "failed" };
    const result = schema.safeParse(await response.json());
    return result.success ? { kind: "ok", value: result.data } : { kind: "failed" };
  } catch { return { kind: "failed" }; }
}

export function readStyleDnaGenerationSettings(signal: AbortSignal) {
  return read(settings, { method: "GET", signal });
}

// 생성 공급자는 모델이 코드 계약에 고정이라 바꿀 것은 키뿐이다. 그래서 PUT에는 늘 새 키가 들어간다.
export function saveStyleDnaGenerationSetting(input: GenerationSettingWrite, signal: AbortSignal) {
  return read(saved.refine(reply => reply.provider === input.provider && reply.setting.version === input.expectedVersion + 1), {
    method: "PUT", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: input.provider, expectedVersion: input.expectedVersion, apiKey: input.apiKey }),
  });
}
