import { z } from "zod";
import { adminAudioModeSchema, adminAudioResponseSchema, audioKindSchema, speechReportSchema } from "./admin-audio-contract";
import { musicModelVersionSchema, musicReportSchema } from "./music-semantic-contract";

export const ADMIN_AUDIO_REPORT_VERSION_HEADER = "x-dream-audio-report-version";
export const ADMIN_AUDIO_REPORT_PROFILE_HEADER = "x-dream-audio-report-profile";
export const EXPANDED_AUDIO_REPORT_PROFILE = "expanded";
export const detailedAudioResponseLimit = 128 * 1024;
export const detailedAudioSegmentLimit = 80;

const text = (max: number) => z.string().min(1).max(max).refine(value => !!value.trim());
const note = text(480).nullable();
const label = text(160).nullable();
const seconds = z.number().nonnegative();

export const audioMeasurementSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("server_probe"), durationSeconds: z.number().positive(),
    sampleRateHz: z.int().positive().nullable(), channels: z.int().positive().nullable() }),
  z.strictObject({ source: z.literal("unavailable"), reason: z.literal("probe_unavailable") }),
]);
export type AudioMeasurement = z.infer<typeof audioMeasurementSchema>;

const segment = z.strictObject({ speaker: label, text: text(300), startSec: seconds.nullable(), endSec: seconds.nullable() });
export const detailedSpeechModelSchema = speechReportSchema.omit({ fullTranscription: true }).extend({
  speakers: z.array(z.strictObject({ name: text(100), role: label, manner: note, contribution: note })).min(1).max(16).nullable(),
  questions: z.array(z.strictObject({ text: text(300), speaker: label, context: note })).min(1).max(20).nullable(),
  delivery: z.strictObject({ tone: note, pace: note, pauses: note, fillers: note }).nullable(),
  acousticQuality: z.strictObject({ clarity: note, background: note, issues: note }).nullable(),
  segments: z.array(segment).min(1).max(detailedAudioSegmentLimit).nullable(),
});

const transcript = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("sampled"), reason: z.enum(["model_sample", "segment_limit"]),
    range: z.strictObject({ fromSec: seconds, throughSec: seconds }).nullable(), segments: z.array(segment).min(1).max(detailedAudioSegmentLimit) }),
  z.strictObject({ status: z.literal("unavailable"), reason: z.literal("no_reported_segments") }),
]);

export const detailedMusicModelSchema = musicReportSchema.extend({
  mood: label,
  rhythm: z.strictObject({ timeSignature: label, feel: note }).nullable(),
  harmony: z.strictObject({ key: label, scale: label, chordProgression: note }).nullable(),
  lyrics: z.strictObject({ status: z.enum(["heard", "instrumental", "undetermined"]), text: text(2600).nullable() })
    .refine(value => (value.status === "heard") === (value.text !== null)),
  stems: z.strictObject({ vocals: note, bass: note, drums: note, others: note }).nullable(),
  qualityEstimates: z.strictObject({ suspectedUpscale: z.boolean().nullable(), compression: note, editTraces: note, basis: text(480) }).nullable(),
});

// Invalid optional findings can be discarded while the original report is still validated strictly.
const optionalFinding = <T extends z.ZodType>(schema: T) => schema.nullable().optional().catch(undefined);
const findingText = (max: number) => text(max).refine(value => !value.includes("\0"));
const shortFinding = optionalFinding(findingText(480));
const speechFindings = z.strictObject({
  overallInsights: optionalFinding(findingText(800)),
  speakerTransitionTone: shortFinding,
});
const musicFindings = z.strictObject({
  style: optionalFinding(z.strictObject({
    vocalStyle: shortFinding, instrumentalTechniques: shortFinding, soundTexture: shortFinding, arrangementDetails: shortFinding,
  })),
  composition: optionalFinding(z.strictObject({
    notation: optionalFinding(z.strictObject({ format: z.enum(["chord_sheet", "abc", "text"]), text: findingText(2000) })),
    beatGrid: shortFinding,
  })),
  suspectedSource: optionalFinding(z.strictObject({ description: findingText(320), basis: findingText(480) })),
});
export const expandedSpeechModelSchema = detailedSpeechModelSchema.extend({ additionalFindings: optionalFinding(speechFindings) });
export const expandedMusicModelSchema = detailedMusicModelSchema.extend({ additionalFindings: optionalFinding(musicFindings) });
export const detailedSpeechReportSchema = expandedSpeechModelSchema.omit({ segments: true }).extend({ transcription: transcript });
const version = { schemaVersion: z.literal(2), requestedMode: adminAudioModeSchema };
const report = { ...version, status: z.enum(["ready", "partial"]), provider: z.literal("gemini"),
  evidence: z.literal("model_estimate"), unknownValueReason: z.literal("not_established_from_audio"), measurement: audioMeasurementSchema };
const v2Failure = z.enum(["undetermined", "not_configured", "provider_error", "invalid_response", "timed_out"]);
export const detailedAudioResponseSchema = z.union([
  z.strictObject({ ...report, kind: z.literal("speech"), report: detailedSpeechReportSchema }),
  z.strictObject({ ...report, kind: z.literal("music"), modelVersion: musicModelVersionSchema.optional(), report: expandedMusicModelSchema }),
  z.strictObject({ ...version, kind: audioKindSchema, status: z.literal("unavailable"), reason: v2Failure }),
]);
export type DetailedAudioResponse = z.infer<typeof detailedAudioResponseSchema>;
export type DetailedAudioFailure = z.infer<typeof v2Failure>;
export type AudioAnalysisResponse = z.infer<typeof adminAudioResponseSchema> | DetailedAudioResponse;

export function projectAudioReport(result: AudioAnalysisResponse, expanded: boolean): AudioAnalysisResponse {
  if (expanded || result.schemaVersion !== 2 || result.status === "unavailable" || !("additionalFindings" in result.report)) return result;
  if (result.kind === "music") {
    const report = { ...result.report };
    delete report.additionalFindings;
    return { ...result, report };
  }
  const report = { ...result.report };
  delete report.additionalFindings;
  return { ...result, report };
}
