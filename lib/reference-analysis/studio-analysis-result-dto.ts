import { z } from "zod";

// Shared by the HTTP response boundary and the browser. Keep runtime imports browser-safe.
// 타입 import도 서버 계약(studio-analysis-contract)을 따라가지 않는다. 아래 결과 형식은 서버 분석 결과
// 형식을 브라우저 안전하게 옮겨 적은 것이고, 서로 같다는 사실은
// tests/reference-analysis/studio-analysis-result-dto-parity.test.ts가 양방향 타입 검사로 지킨다.
type Time = { kind: "time"; startMs: number; endMs: number };
type Region = { kind: "region"; x: number; y: number; width: number; height: number };
type Observation =
  | { kind: "observation"; findingId: string; measure: "decoded_frame"; location: Time }
  | { kind: "observation"; findingId: string; measure: "adjacent_rgb_mean_difference"; location: Time; score: number }
  | { kind: "observation"; findingId: string; measure: "normalized_full_scale_rms"; location: Time; channels: number; peakRms: number }
  | { kind: "observation"; findingId: string; measure: "energy_onsets"; location: Time; timesMs: number[]; medianIntervalMs: number }
  | { kind: "observation"; findingId: string; measure: "region_color_luminance"; location: Region;
      alphaCoverage: number; palette: { bucket: string; visibleShare: number }[]; luminanceShares: number[]; luminanceEdges: number[] };
type Inference =
  | { kind: "inference"; findingId: string; measure: "candidate_cut"; location: Time; evidenceIds: string[] }
  | { kind: "inference"; findingId: string; measure: "estimated_bpm"; location: Time; bpm: number; evidenceIds: string[] };
type CreativeDraft =
  | { kind: "creative_proposal"; target: "cut"; prompt: string;
      editGridApproximation?: { fps: 30; frame: number }; transition?: { type: "cut"; durationFrames: 0 } }
  | { kind: "creative_proposal"; target: "image"; prompt: string }
  | { kind: "creative_proposal"; target: "music"; role: "music"; prompt: string };
type Proposal = { selectionId: string; observations: Observation[]; inference?: Inference; draft: CreativeDraft } & (
  | { media: "video"; sourceSeek: { kind: "observed_pts"; ptsMs: number; findingId: string } }
  | { media: "music" | "image"; sourceSeek?: never }
);
/** 화면과 HTTP 경계가 함께 쓰는 분석 결과 형식. 스키마 출력은 이 형식을 만족한다(아래 satisfies). */
export type StudioAnalysisResult =
  | { schemaVersion: 1; status: "ready"; media: Proposal["media"]; proposals: Proposal[] }
  | { schemaVersion: 1; status: "unavailable"; reason: "invalid_selection" | "source_unavailable" |
      "analysis_unavailable" | "cancelled" | "timed_out" };

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const timestamp = z.number().int().nonnegative();
const fraction = z.number().min(0).max(1);
const time = z.strictObject({ kind: z.literal("time"), startMs: timestamp, endMs: timestamp })
  .refine(({ startMs, endMs }) => startMs <= endMs);
const region = z.strictObject({ kind: z.literal("region"), x: fraction, y: fraction, width: fraction.gt(0), height: fraction.gt(0) })
  .refine(({ x, y, width, height }) => x + width <= 1 && y + height <= 1);
const observed = { kind: z.literal("observation"), findingId: identifier };
const measuredTime = { ...observed, location: time };
const videoObservation = z.discriminatedUnion("measure", [
  z.strictObject({ ...measuredTime, measure: z.literal("decoded_frame") }),
  z.strictObject({ ...measuredTime, measure: z.literal("adjacent_rgb_mean_difference"), score: fraction }),
]);
const musicObservation = z.discriminatedUnion("measure", [
  z.strictObject({ ...measuredTime, measure: z.literal("normalized_full_scale_rms"), channels: z.number().int().positive(), peakRms: fraction }),
  z.strictObject({ ...measuredTime, measure: z.literal("energy_onsets"), timesMs: z.array(timestamp).min(5), medianIntervalMs: z.number().min(300).max(1000) }),
]);
const imageObservation = z.strictObject({
  ...observed, measure: z.literal("region_color_luminance"), location: region, alphaCoverage: fraction.gt(0),
  palette: z.array(z.strictObject({ bucket: z.string().regex(/^#[0-9a-f]{6}$/), visibleShare: fraction })).min(1).max(3),
  luminanceShares: z.array(fraction).length(4), luminanceEdges: z.array(fraction).length(5),
});
const inferred = { kind: z.literal("inference"), findingId: identifier, location: time, evidenceIds: z.array(identifier).min(1) };
const creative = { kind: z.literal("creative_proposal"), prompt: z.string().min(1).max(16_000) };
const videoProposal = z.strictObject({
  media: z.literal("video"), selectionId: identifier, observations: z.array(videoObservation).min(1),
  inference: z.strictObject({ ...inferred, measure: z.literal("candidate_cut") }).optional(),
  sourceSeek: z.strictObject({ kind: z.literal("observed_pts"), ptsMs: timestamp, findingId: identifier }),
  draft: z.strictObject({
    ...creative, target: z.literal("cut"), editGridApproximation: z.strictObject({ fps: z.literal(30), frame: timestamp }).optional(),
    transition: z.strictObject({ type: z.literal("cut"), durationFrames: z.literal(0) }).optional(),
  }),
}).refine(({ observations, sourceSeek }) => observations.some(({ measure, findingId, location }) =>
  measure === "decoded_frame" && findingId === sourceSeek.findingId && location.startMs === sourceSeek.ptsMs && location.endMs === sourceSeek.ptsMs));
const musicProposal = z.strictObject({
  media: z.literal("music"), selectionId: identifier, observations: z.array(musicObservation).min(1),
  inference: z.strictObject({ ...inferred, measure: z.literal("estimated_bpm"), bpm: z.number().int().min(60).max(200) }).optional(),
  draft: z.strictObject({ ...creative, target: z.literal("music"), role: z.literal("music") }),
});
const imageProposal = z.strictObject({
  media: z.literal("image"), selectionId: identifier, observations: z.array(imageObservation).min(1),
  draft: z.strictObject({ ...creative, target: z.literal("image") }),
});
export const studioAnalysisResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal("unavailable"),
    reason: z.enum(["invalid_selection", "source_unavailable", "analysis_unavailable", "cancelled", "timed_out"]),
  }),
  z.strictObject({
    schemaVersion: z.literal(1), status: z.literal("ready"), media: z.enum(["video", "image", "music"]),
    proposals: z.array(z.discriminatedUnion("media", [videoProposal, imageProposal, musicProposal])).min(1),
  }).refine(({ media, proposals }) => {
    const selections = new Set(proposals.map(({ selectionId }) => selectionId));
    return selections.size === proposals.length && proposals.every((proposal) => {
      if (proposal.media !== media) return false;
      const observations = new Set(proposal.observations.map(({ findingId }) => findingId));
      if (observations.size !== proposal.observations.length) return false;
      if (proposal.media === "image" || !proposal.inference) return true;
      const { findingId, evidenceIds } = proposal.inference;
      return !observations.has(findingId) && new Set(evidenceIds).size === evidenceIds.length &&
        evidenceIds.every((id) => observations.has(id));
    });
  }),
]) satisfies z.ZodType<StudioAnalysisResult>;
