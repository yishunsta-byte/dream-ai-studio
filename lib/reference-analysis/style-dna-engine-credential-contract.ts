import { z } from "zod";
import { credentialKey, modelId } from "./analysis-credential-contract";

export const styleDnaEngineCredentialPath = "/api/admin/style-dna/engine-credentials";
export const styleDnaEngine = z.enum(["openai", "anthropic"]);
export type StyleDnaEngine = z.infer<typeof styleDnaEngine>;

export function isStyleDnaEngineModel(provider: StyleDnaEngine, model: string) {
  return (provider === "openai" ? /^(?:gpt-[a-z0-9]|o[1-9][0-9]*(?:-|$))/i : /^claude-[a-z0-9]/i).test(model);
}

const engineSelection = z.strictObject({ provider: styleDnaEngine, modelId });
export const styleDnaEngineSelection = engineSelection.refine(input => isStyleDnaEngineModel(input.provider, input.modelId), { path: ["modelId"] });
export type StyleDnaEngineSelection = z.infer<typeof styleDnaEngineSelection>;
export type StyleDnaEngineBasis = StyleDnaEngineSelection & { credentialVersion: number };

export const styleDnaEngineCredentialWrite = engineSelection.extend({
  expectedVersion: z.int().min(0).max(2_147_483_646),
  apiKey: credentialKey.optional(),
}).refine(input => isStyleDnaEngineModel(input.provider, input.modelId), { path: ["modelId"] })
  .refine(input => input.expectedVersion !== 0 || input.apiKey !== undefined, { path: ["apiKey"] });

export type StyleDnaEngineCredentialWrite = z.infer<typeof styleDnaEngineCredentialWrite>;
export type StyleDnaEngineCredentialMetadata =
  | { configured: true; modelId: string; version: number; updatedAt: string }
  | { configured: false; modelId: null; version: 0; updatedAt: null };
