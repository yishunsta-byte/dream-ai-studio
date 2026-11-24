import "server-only";
import { isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { referenceFileFormat } from "./input";
import { isTimeWithinTrack, referenceAnalysisResultSchema, referenceObservedTrack, type ReferenceAnalysisResult, type ReferenceFinding } from "./result";

type PrivateReferenceResult = Readonly<{ ownerId: string; result: ReferenceAnalysisResult }>;

/** Keep this record in the server-owned, owner-scoped boundary only. */
export function createPrivateReferenceResult(actor: VerifiedActor, result: unknown): PrivateReferenceResult {
  if (!isVerifiedActor(actor)) throw new Error("REFERENCE_OWNER_REQUIRED");
  return Object.freeze({ ownerId: actor.id, result: referenceAnalysisResultSchema.parse(result) });
}

function ownedResult(record: PrivateReferenceResult, actor: VerifiedActor) {
  if (!isVerifiedActor(actor) || record.ownerId !== actor.id) throw new Error("REFERENCE_OWNER_REQUIRED");
  return referenceAnalysisResultSchema.parse(record.result);
}

function safeFileMetadata(result: ReferenceAnalysisResult, item: ReferenceFinding) {
  if (item.kind !== "file_metadata" || result.input.status !== "ready" || result.input.source.kind !== "file") return {};
  const { source } = result.input;
  const { mime, width, height, durationMs } = item.values;
  const positiveInt = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  return {
    ...(typeof mime === "string" && referenceFileFormat(source.name)?.mimes.some(candidate => candidate === mime) ? { mime } : {}),
    ...(positiveInt(width) && positiveInt(height) && source.media !== "music" ? { width, height } : {}),
    ...(positiveInt(durationMs) && source.media !== "image" ? { durationMs } : {}),
    ...(item.observedBytes !== undefined ? { sizeBytes: item.observedBytes } : {}),
  };
}

/** Free-form finding strings are owner-only text. The UI must render them as text. */
export function projectReferenceOwnerScreen(record: PrivateReferenceResult, actor: VerifiedActor) {
  const result = ownedResult(record, actor);
  const track = referenceObservedTrack(result);
  const input = result.input.status !== "ready"
    ? result.input.status === "invalid" ? { status: "invalid", reason: result.input.reason } as const
      : { status: "replacement_required", reason: result.input.reason, alternatives: result.input.alternatives } as const
    : {
      status: "ready", kind: result.input.source.kind,
      media: result.input.source.kind === "file" ? result.input.source.media : result.input.source.mediaHint,
    } as const;
  return {
    schemaVersion: result.schemaVersion, input,
    ...(result.inspection ? { inspection: result.inspection } : {}),
    findings: result.findings.map(item => {
      const common = { id: item.id, kind: item.kind, location: item.location, seekable: isTimeWithinTrack(item.location, track) };
      switch (item.kind) {
        case "observation": return { ...common, text: item.text };
        case "creator_disclosure": return { ...common, quote: item.quote };
        case "inference": return { ...common, text: item.text, evidenceIds: item.evidenceIds, alternatives: item.alternatives };
        case "unavailable": return { ...common, subject: item.subject, reason: item.reason };
        case "file_metadata": return { ...common, values: safeFileMetadata(result, item), ...(item.timeline ? { timeline: item.timeline } : {}) };
      }
    }),
  };
}

/** Share only the structural fields of explicitly selected findings. */
export function projectReferenceShareSummary(
  record: PrivateReferenceResult, actor: VerifiedActor, selectedIds: readonly string[],
) {
  const result = ownedResult(record, actor);
  const track = referenceObservedTrack(result);
  const selected = new Set(selectedIds);
  const findings = result.findings.filter(item => selected.has(item.id));
  if (!selected.size || findings.length !== selected.size || result.input.status !== "ready") {
    throw new Error("REFERENCE_SHARE_SELECTION_REQUIRED");
  }
  return {
    schemaVersion: result.schemaVersion,
    ...(result.input.source.kind === "file" ? { media: result.input.source.media } : {}),
    findings: findings.map(item => ({
      kind: item.kind,
      ...(item.location.kind === "region" || isTimeWithinTrack(item.location, track) ? { location: item.location } : {}),
      ...(item.kind === "file_metadata" ? {
        values: safeFileMetadata(result, item), ...(item.timeline ? { timeline: item.timeline } : {}),
      } : {}),
      ...(item.kind === "unavailable" ? { reason: item.reason } : {}),
    })),
  };
}
