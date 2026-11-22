import { z } from "zod";
import { styleDnaEngine } from "./style-dna-engine-credential-contract";

const imageSemanticProvider = z.enum(["gemini", ...styleDnaEngine.options]);
export type ImageSemanticProvider = z.infer<typeof imageSemanticProvider>;

export const imageSemanticCategories = ["people", "objects", "actions", "context", "composition", "lighting"] as const;
export type ImageSemanticCategory = typeof imageSemanticCategories[number];
const category = z.enum(imageSemanticCategories);
export const imageSemanticField = z.object({
  description: z.string().trim().min(1).max(480),
  basis: z.string().trim().min(1).max(240),
});
export const imageSemanticPrompt = z.string().trim().min(1).max(2400);
const finding = z.discriminatedUnion("certainty", [
  z.strictObject({ ...imageSemanticField.shape, category, certainty: z.literal("estimated") }),
  z.strictObject({ category, certainty: z.literal("unconfirmed") }),
]);
export const imageSemanticResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.enum(["ready", "partial"]),
    provider: imageSemanticProvider,
    findings: z.array(finding).length(imageSemanticCategories.length)
      .refine((fields) => new Set(fields.map(field => field.category)).size === fields.length),
    prompts: z.strictObject({ ko: imageSemanticPrompt.optional(), en: imageSemanticPrompt.optional() }),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["not_configured", "image_preparation_failed", "provider_error", "invalid_response", "timed_out"]),
  }),
]);
export type ImageSemanticFinding = z.infer<typeof finding>;
export type ImageSemanticResult = z.infer<typeof imageSemanticResultSchema>;
