import { z } from "zod";
import { musicModelVersionSchema, musicReportSchema } from "./music-semantic-contract";

export const ADMIN_AUDIO_ANALYSIS_URI = "/api/admin/audio-analysis";
export const ADMIN_AUDIO_MODE_HEADER = "x-dream-audio-mode";

export const adminAudioModeSchema = z.enum(["auto", "speech", "music"]);
export type AdminAudioMode = z.infer<typeof adminAudioModeSchema>;
export const audioKindSchema = z.enum(["speech", "music", "undetermined"]);
export type AudioKind = z.infer<typeof audioKindSchema>;

const text = (max: number) => z.string().min(1).max(max).refine(value => !!value.trim());
export const speechReportSchema = z.strictObject({
  summary: text(2000).nullable(),
  topicsAndKeywords: z.array(z.strictObject({
    topic: text(160), keywords: z.array(text(80)).min(1).max(10).nullable(),
  })).min(1).max(16).nullable(),
  actionItems: z.array(z.strictObject({
    task: text(320), assignee: text(100).nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })).min(1).max(20).nullable(),
  fullTranscription: z.array(z.strictObject({
    speaker: text(100).nullable(),
    timestamp: z.string().regex(/^\d{2}:[0-5]\d(?::[0-5]\d)?$/).nullable(),
    text: text(600),
  })).min(1).max(80).nullable(),
});
export type SpeechReport = z.infer<typeof speechReportSchema>;

const version = { schemaVersion: z.literal(1), requestedMode: adminAudioModeSchema };
const available = { ...version, status: z.enum(["ready", "partial"]), provider: z.literal("gemini") };
export const adminAudioResponseSchema = z.union([
  z.strictObject({ ...available, kind: z.literal("music"), modelVersion: musicModelVersionSchema.optional(), report: musicReportSchema }),
  z.strictObject({ ...available, kind: z.literal("speech"), report: speechReportSchema }),
  z.strictObject({
    ...version, status: z.literal("unavailable"), kind: audioKindSchema,
    reason: z.enum(["undetermined", "not_configured", "provider_error", "invalid_response", "timed_out"]),
  }),
]);
export type AdminAudioResponse = z.infer<typeof adminAudioResponseSchema>;
