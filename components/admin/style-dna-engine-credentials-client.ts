import { z } from "zod";
import { credentialKey, modelId } from "@/lib/reference-analysis/analysis-credential-contract";
import {
  isStyleDnaEngineModel, styleDnaEngine, styleDnaEngineCredentialPath,
  type StyleDnaEngine, type StyleDnaEngineCredentialWrite,
} from "@/lib/reference-analysis/style-dna-engine-credential-contract";

const stored = z.strictObject({
  configured: z.literal(true), modelId, version: z.int().min(1).max(2_147_483_647), updatedAt: z.iso.datetime({ offset: true }),
});
const empty = z.strictObject({ configured: z.literal(false), modelId: z.null(), version: z.literal(0), updatedAt: z.null() });
const setting = z.discriminatedUnion("configured", [stored, empty]);
const forEngine = (provider: StyleDnaEngine) => setting.refine(item => !item.configured || isStyleDnaEngineModel(provider, item.modelId));
const settings = z.strictObject({ providers: z.strictObject({ openai: forEngine("openai"), anthropic: forEngine("anthropic") }) });
const saved = z.strictObject({ provider: styleDnaEngine, setting: stored });

type RequestIssue = "login" | "forbidden" | "storage" | "stale" | "invalid" | "failed" |
  "invalid_key" | "model_not_found" | "quota_exceeded" | "timed_out";
export type StyleDnaEngineSetting = z.infer<typeof setting>;
export type StyleDnaEngineSettings = z.infer<typeof settings>["providers"];
type Outcome<T> = { kind: "ok"; value: T } | { kind: RequestIssue };

export const acceptsEngineKey = (value: string) => credentialKey.safeParse(value).success;
export const acceptsEngineModel = (provider: StyleDnaEngine, value: string) =>
  modelId.safeParse(value).success && isStyleDnaEngineModel(provider, value);

async function read<T>(schema: z.ZodType<T>, init: RequestInit): Promise<Outcome<T>> {
  try {
    const response = await fetch(styleDnaEngineCredentialPath, { ...init, credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) return { kind: "login" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 503) {
      const issue = z.object({ code: z.literal("storage_unavailable") }).safeParse(await response.json().catch(() => undefined));
      return { kind: issue.success ? "storage" : "failed" };
    }
    if (response.status === 409) return { kind: "stale" };
    if (response.status === 422) {
      const issue = z.object({ code: z.enum(["invalid_key", "model_not_found"]) })
        .safeParse(await response.json().catch(() => undefined));
      if (issue.success) return { kind: issue.data.code };
    }
    if (response.status === 429) return { kind: "quota_exceeded" };
    if (response.status === 504) return { kind: "timed_out" };
    if (response.status === 400 || response.status === 413) return { kind: "invalid" };
    if (!response.ok) return { kind: "failed" };
    const result = schema.safeParse(await response.json());
    return result.success ? { kind: "ok", value: result.data } : { kind: "failed" };
  } catch { return { kind: "failed" }; }
}

export function readStyleDnaEngineSettings(signal: AbortSignal) {
  return read(settings, { method: "GET", signal });
}

export function saveStyleDnaEngineSetting(input: StyleDnaEngineCredentialWrite, signal: AbortSignal) {
  return read(saved.refine(reply => reply.provider === input.provider && reply.setting.modelId === input.modelId &&
    reply.setting.version === input.expectedVersion + 1), {
    method: "PUT", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}
