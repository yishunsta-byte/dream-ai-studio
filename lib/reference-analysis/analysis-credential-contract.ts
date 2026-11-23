import { z } from "zod";

export const analysisCredentialPath = "/api/admin/analysis-credentials";
export const geminiPrograms = ["image", "shorts", "music"] as const;
export type GeminiProgram = typeof geminiPrograms[number];
export type CredentialGroup = "reference" | "music";
export type CredentialModels = Partial<Record<GeminiProgram, string>>;

export const modelId = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export const credentialKey = z.string().trim().regex(/^[a-zA-Z0-9_-]{16,256}$/);
export const geminiCredentialKey = z.string().trim().min(16).max(256).regex(/^(?:AQ\.)?[a-zA-Z0-9_-]+$/);
const expectedVersion = z.number().int().min(0).max(2_147_483_646);
const referenceModels = z.strictObject({ image: modelId, shorts: modelId });
const musicModels = z.strictObject({ music: modelId });
export const credentialWrite = z.discriminatedUnion("group", [
  z.strictObject({ group: z.literal("reference"), expectedVersion, apiKey: geminiCredentialKey.optional(), models: referenceModels }),
  z.strictObject({ group: z.literal("music"), expectedVersion, apiKey: geminiCredentialKey.optional(), models: musicModels }),
]);
export type CredentialWrite = z.infer<typeof credentialWrite>;

export function credentialModels(group: CredentialGroup, value: unknown): CredentialModels {
  return (group === "reference" ? referenceModels : musicModels).parse(value);
}
export const credentialGroup = (program: GeminiProgram): CredentialGroup => program === "music" ? "music" : "reference";

const savedVersion = z.number().int().min(1).max(2_147_483_647);
export const credentialTestRequest = z.strictObject({
  program: z.enum(geminiPrograms), group: z.enum(["reference", "music"]), version: savedVersion,
}).refine(value => credentialGroup(value.program) === value.group, { path: ["group"] });

const probeCode = z.enum(["invalid_key", "model_not_found", "provider_error", "timed_out"]);
const testFields = { version: savedVersion, checkedAt: z.iso.datetime() };
export const credentialTestResult = z.discriminatedUnion("status", [
  z.strictObject({ ...testFields, status: z.literal("verified"), code: z.null() }),
  z.strictObject({ ...testFields, status: z.literal("failed"), code: probeCode }),
]);
export type CredentialTest = z.infer<typeof credentialTestResult>;
export const credentialTestMap = z.partialRecord(z.enum(geminiPrograms), credentialTestResult);
