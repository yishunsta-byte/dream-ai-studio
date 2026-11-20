import { z } from "zod";
import { referenceFileByteLimit, referenceInputDecisionSchema, type ReferenceInputDecision } from "./input";

const locator = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("whole") }),
  z.strictObject({ kind: z.literal("time"), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() })
    .refine(range => range.startMs <= range.endMs, "Timecode is reversed"),
  z.strictObject({
    kind: z.literal("region"),
    x: z.number().min(0).lte(1), y: z.number().min(0).lte(1),
    width: z.number().gt(0).lte(1), height: z.number().gt(0).lte(1),
  }).refine(region => region.x + region.width <= 1 && region.y + region.height <= 1, "Region extends beyond image"),
  z.strictObject({ kind: z.literal("text"), start: z.number().int().nonnegative(), end: z.number().int().positive() })
    .refine(range => range.start < range.end, "Text range must be nonempty"),
]);

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const note = z.string().max(16_000).refine(value => value.trim().length > 0);
const common = { id, location: locator };
const metadataValue = z.union([z.string().max(4_096), z.number(), z.boolean(), z.null()]);
const trackWindow = z.strictObject({
  kind: z.enum(["video", "audio"]),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).refine(track => track.endMs > track.startMs, "Track window must have positive length");
const timeline = z.strictObject({
  containerDurationMs: z.number().int().positive().nullable(),
  tracks: z.array(trackWindow).max(2),
}).refine(({ tracks, containerDurationMs }) => new Set(tracks.map(track => track.kind)).size === tracks.length &&
  (containerDurationMs === null || tracks.every(track => track.endMs <= containerDurationMs)),
  "Track windows must be unique and within the container");
type TrackWindow = z.infer<typeof trackWindow>;
const finding = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("observation"), text: note }),
  z.strictObject({ ...common, kind: z.literal("creator_disclosure"), quote: note }),
  z.strictObject({
    ...common, kind: z.literal("file_metadata"), tool: note,
    values: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), metadataValue),
    timeline: timeline.optional(),
    observedBytes: z.number().int().positive().max(referenceFileByteLimit).optional(),
  }),
  z.strictObject({
    ...common, kind: z.literal("inference"), text: note, evidenceIds: z.array(id).min(1).max(40),
    alternatives: z.array(note).max(10).optional(),
  }),
  z.strictObject({
    ...common, kind: z.literal("unavailable"), subject: note, reason: z.enum([
      "missing_evidence", "not_analyzed", "local_tool_unavailable", "local_tool_failed", "inspection_failed", "cancelled", "timed_out",
    ]),
  }),
]);

const supportingKinds = new Set(["observation", "creator_disclosure", "file_metadata"]);
const terminalReasons = ["local_tool_unavailable", "local_tool_failed", "inspection_failed", "cancelled", "timed_out"] as const;
const terminal = z.enum(terminalReasons);
const inspection = z.enum(["completed", "invalid_file", ...terminalReasons]);
export type ReferenceInspection = z.infer<typeof inspection>;

export function isTimeWithinTrack(location: z.infer<typeof locator>, track: TrackWindow | null | undefined) {
  return location.kind === "time" && !!track && location.startMs >= track.startMs &&
    location.startMs < track.endMs && location.endMs <= track.endMs;
}

export const referenceAnalysisResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  input: referenceInputDecisionSchema,
  findings: z.array(finding).max(500),
  inspection: inspection.optional(),
}).superRefine((result, context) => {
  if (result.input.status !== "ready") {
    if (result.findings.length) context.addIssue({ code: "custom", path: ["findings"], message: "Unresolved input has no findings" });
    if (result.inspection && (result.input.status !== "invalid" || result.inspection !== "invalid_file" ||
      !["invalid_file", "file_type_mismatch", "file_too_large"].includes(result.input.reason))) {
      context.addIssue({ code: "custom", path: ["inspection"], message: "Unresolved input cannot report a probe outcome" });
    }
    return;
  }

  const { source } = result.input;
  const [onlyFinding] = result.findings;
  if (result.inspection) {
    const completed = result.inspection === "completed" && result.findings.some(item => item.kind === "file_metadata");
    const stopped = terminal.safeParse(result.inspection).success && result.findings.length === 1 &&
      onlyFinding?.kind === "unavailable" && onlyFinding.reason === result.inspection &&
      onlyFinding.subject === "file_metadata" && onlyFinding.location.kind === "whole";
    if (source.kind !== "file" || (!completed && !stopped)) {
      context.addIssue({ code: "custom", path: ["inspection"], message: "Probe outcome must match file evidence" });
    }
  }
  const timing = result.findings.flatMap(item => item.kind === "file_metadata" && item.timeline ? [item.timeline] : []);
  const observedSizes = result.findings.filter(item => item.kind === "file_metadata" && item.observedBytes !== undefined);
  if (timing.length > 1 || observedSizes.length > 1) {
    context.addIssue({ code: "custom", path: ["findings"], message: "Local inspection has one timeline and byte count" });
  }
  const trackKind = source.kind === "file" && source.media !== "image" ? source.media === "music" ? "audio" : "video" : undefined;
  const observedTrack = timing[0]?.tracks.find(track => track.kind === trackKind);
  const durations = new Set<number>();
  if (source.kind === "file" && source.media !== "image") {
    for (const item of result.findings) {
      if (item.kind !== "file_metadata" || item.values.durationMs == null) continue;
      const duration = item.values.durationMs;
      if (typeof duration === "number" && Number.isSafeInteger(duration) && duration > 0) {
        durations.add(duration);
      } else {
        context.addIssue({ code: "custom", path: ["findings"], message: "Invalid observed duration" });
      }
    }
  }
  if (durations.size > 1) context.addIssue({ code: "custom", path: ["findings"], message: "Conflicting observed durations" });
  const duration = durations.values().next().value;
  const byId = new Map(result.findings.map(item => [item.id, item]));
  if (byId.size !== result.findings.length) {
    context.addIssue({ code: "custom", path: ["findings"], message: "Finding IDs must be unique" });
  }

  result.findings.forEach((item, index) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: ["findings", index, path], message });
    const { location } = item;
    const sourceLocation = source.kind === "body" ? "text" : source.media === "image" ? "region" : "time";
    if (location.kind !== sourceLocation && (location.kind !== "whole" || item.kind === "observation")) {
      issue("location", "Location does not match the source medium");
    }
    if (source.kind === "body" && location.kind === "text" && location.end > source.text.length) {
      issue("location", "Text range extends beyond the supplied body");
    }
    if (location.kind === "time" && observedTrack && !isTimeWithinTrack(location, observedTrack)) {
      issue("location", "Timecode is outside the observed track window");
    } else if (location.kind === "time" && !observedTrack && duration !== undefined &&
      (location.startMs >= duration || location.endMs > duration)) {
      issue("location", "Timecode is outside the observed duration");
    }
    if (item.kind === "file_metadata" &&
      (source.kind !== "file" || location.kind !== "whole" || !Object.keys(item.values).length)) {
      issue("values", "File metadata requires a file, a whole-source locator, and at least one value");
    }
    if (item.kind === "file_metadata" && item.timeline !== undefined &&
      (result.inspection !== "completed" || source.kind !== "file" || source.media === "image")) {
      issue("timeline", "Observed timeline must match the completed media inspection");
    }
    if (item.kind === "file_metadata" && item.observedBytes !== undefined &&
      (result.inspection !== "completed" || source.kind !== "file" || item.observedBytes !== source.sizeBytes)) {
      issue("observedBytes", "Observed bytes must match the completed file inspection");
    }
    if (item.kind === "unavailable" && terminal.safeParse(item.reason).success && item.reason !== result.inspection) {
      issue("reason", "An execution failure requires its matching inspection outcome");
    }
    // An attributed disclosure preserves the pasted source and exact quote,
    // while source attribution remains the submitter's declaration.
    if (item.kind === "creator_disclosure" &&
      (source.kind !== "body" || source.attribution !== "creator_public" || location.kind !== "text" ||
        source.text.slice(location.start, location.end) !== item.quote)) {
      issue("quote", "Creator disclosure must be an exact quote from the attributed body range");
    }
    if (item.kind === "inference" && item.evidenceIds.some(key => {
      const evidence = byId.get(key);
      return !evidence || !supportingKinds.has(evidence.kind);
    })) {
      issue("evidenceIds", "Inference references must identify direct source findings");
    }
  });
});

export type ReferenceAnalysisResult = z.infer<typeof referenceAnalysisResultSchema>;
export type ReferenceFinding = z.infer<typeof finding>;

export function referenceObservedTrack(result: ReferenceAnalysisResult) {
  if (result.input.status !== "ready" || result.input.source.kind !== "file" || result.input.source.media === "image") return;
  const kind = result.input.source.media === "music" ? "audio" : "video";
  for (const item of result.findings) {
    if (item.kind === "file_metadata" && item.timeline) return item.timeline.tracks.find(track => track.kind === kind);
  }
}

/** Builds the versioned, serializable contract and validates source provenance. */
export function createReferenceAnalysisResult(
  input: ReferenceInputDecision, findings: readonly ReferenceFinding[] = [], inspection?: ReferenceInspection,
): ReferenceAnalysisResult {
  return referenceAnalysisResultSchema.parse({ schemaVersion: 1, input, findings, ...(inspection ? { inspection } : {}) });
}
