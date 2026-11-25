import { z } from "zod";

export const MUSIC_SEMANTIC_URI = "/api/admin/music-semantic";
export const MUSIC_EXTERNAL_CONSENT_HEADER = "x-dream-music-external-consent";
export const MUSIC_MODEL_VERSION_HEADER = "x-dream-music-model-version";
export const musicModelVersionSchema = z.string().max(120).regex(/^(?:models\/)?[a-z0-9][a-z0-9._-]*$/i);

// Older clients validate the exact report shape. Include metadata only when they opt in.
export function projectMusicModelVersion<T extends object>(result: T, include: boolean): T {
  if (include || !("modelVersion" in result)) return result;
  const projected = { ...result };
  Reflect.deleteProperty(projected, "modelVersion");
  return projected;
}

const text = (max: number) => z.string().min(1).max(max).refine(value => !!value.trim());
export const musicReportSchema = z.strictObject({
  genre: text(160).nullable(),
  instruments: z.array(text(80)).min(1).max(12).nullable(),
  tempoBpm: z.number().int().min(20).max(300).nullable(),
  structure: z.array(z.strictObject({ label: text(100), description: text(360) })).min(1).max(12).nullable(),
  sunoPrompt: text(1200).nullable(),
});
export type MusicSemanticReport = z.infer<typeof musicReportSchema>;

export const musicSemanticAvailabilitySchema = z.strictObject({
  semantic: z.strictObject({ music: z.enum(["configured", "not_configured"]) }),
});

export const musicSemanticResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.enum(["ready", "partial"]), provider: z.literal("gemini"), modelVersion: musicModelVersionSchema.optional(), report: musicReportSchema }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["not_configured", "provider_error", "invalid_response", "timed_out"]),
  }),
]);
export type MusicSemanticResult = z.infer<typeof musicSemanticResultSchema>;
