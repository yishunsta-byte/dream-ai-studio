import "server-only";
import { isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { FPS, MAX_FRAMES, secondsToFrames } from "../edit/timeline";
import type { analyzeLocalReferenceAudio } from "./audio-features";
import type { analyzeLocalReferenceImage } from "./image-features";
import { isTimeWithinTrack, referenceAnalysisResultSchema, referenceObservedTrack, type ReferenceAnalysisResult, type ReferenceFinding } from "./result";
import type { analyzeLocalReferenceVideo } from "./video-features";

type LocalAnalysis =
  | ({ media: "video" } & Awaited<ReturnType<typeof analyzeLocalReferenceVideo>>)
  | ({ media: "music" } & Awaited<ReturnType<typeof analyzeLocalReferenceAudio>>)
  | ({ media: "image" } & Awaited<ReturnType<typeof analyzeLocalReferenceImage>>);

type Scope = Readonly<{ projectId: string; sourceId: string; sourceRevision: string; analysisRevision: string }>;
type Time = Extract<ReferenceFinding["location"], { kind: "time" }>;
type Region = Extract<ReferenceFinding["location"], { kind: "region" }>;
type Distribution = Extract<Awaited<ReturnType<typeof analyzeLocalReferenceImage>>["image"], { status: "completed" }>["distribution"];
type Observation =
  | { kind: "observation"; findingId: string; measure: "decoded_frame"; location: Time }
  | { kind: "observation"; findingId: string; measure: "adjacent_rgb_mean_difference"; location: Time; score: number }
  | { kind: "observation"; findingId: string; measure: "normalized_full_scale_rms"; location: Time; channels: number; peakRms: number }
  | { kind: "observation"; findingId: string; measure: "energy_onsets"; location: Time; timesMs: number[]; medianIntervalMs: number }
  | { kind: "observation"; findingId: string; measure: "region_color_luminance"; location: Region;
      alphaCoverage: number; palette: Distribution["palette"]; luminanceShares: number[]; luminanceEdges: number[] };
type Inference =
  | { kind: "inference"; findingId: string; measure: "candidate_cut"; location: Time; evidenceIds: string[] }
  | { kind: "inference"; findingId: string; measure: "estimated_bpm"; location: Time; bpm: number; evidenceIds: string[] };
type CreativeDraft =
  | { kind: "creative_proposal"; target: "cut"; prompt: string;
      editGridApproximation?: { fps: typeof FPS; frame: number }; transition?: { type: "cut"; durationFrames: 0 } }
  | { kind: "creative_proposal"; target: "image"; prompt: string }
  | { kind: "creative_proposal"; target: "music"; role: "music"; prompt: string };
type Candidate = {
  selectionId: string; observations: Observation[]; inference?: Inference; draft: CreativeDraft;
} & (
  | { media: "video"; sourceSeek: { kind: "observed_pts"; ptsMs: number; findingId: string } }
  | { media: "music" | "image"; sourceSeek?: never }
);

const recordBrand: unique symbol = Symbol("reference-preview-record");
type PrivatePreviewRecord = Readonly<{ [recordBrand]: true }>;
const records = new WeakMap<PrivatePreviewRecord, {
  ownerId: string; scope: Scope; analyzedAtMs: number; candidates: Candidate[];
}>();

const fraction = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const timestamp = (value: number) => Number.isSafeInteger(value) && value >= 0;
const time = (startMs: number, endMs = startMs): Time => ({ kind: "time", startMs, endMs });

function sameLocation(first: ReferenceFinding["location"], second: Time | Region) {
  if (first.kind === "time" && second.kind === "time") {
    return first.startMs === second.startMs && first.endMs === second.endMs;
  }
  return first.kind === "region" && second.kind === "region" && first.x === second.x && first.y === second.y &&
    first.width === second.width && first.height === second.height;
}

function matched(result: ReferenceAnalysisResult) {
  const findings = new Map(result.findings.map(item => [item.id, item]));
  const track = referenceObservedTrack(result);
  const verified = (range: Time) => timestamp(range.startMs) && timestamp(range.endMs) &&
    range.endMs >= range.startMs && isTimeWithinTrack(range, track);
  return {
    track, verified,
    observation(id: string, location: Time | Region) {
      const item = findings.get(id);
      return item?.kind === "observation" && sameLocation(item.location, location);
    },
    inference(id: string, location: Time, evidenceIds: readonly string[]) {
      const item = findings.get(id);
      return item?.kind === "inference" && verified(location) && sameLocation(item.location, location) &&
        item.evidenceIds.length === evidenceIds.length && evidenceIds.every(key => item.evidenceIds.includes(key));
    },
  };
}

type FrameObservation = Extract<Observation, { measure: "decoded_frame" }>;

function videoPreviewTiming(observation: FrameObservation) {
  const ptsMs = observation.location.startMs;
  const frame = secondsToFrames(ptsMs / 1_000);
  return {
    sourceSeek: { kind: "observed_pts", ptsMs, findingId: observation.findingId } as const,
    // The rounded editor frame is independent of the source track's playable points.
    editGridApproximation: frame <= MAX_FRAMES ? { fps: FPS, frame } as const : undefined,
  };
}

function videoCandidates(video: Extract<LocalAnalysis, { media: "video" }>["video"], evidence: ReturnType<typeof matched>): Candidate[] {
  if (video.status !== "completed" || video.coverage.trackStartMs !== evidence.track?.startMs ||
    video.coverage.trackEndMs !== evidence.track?.endMs || !fraction(video.settings.threshold)) return [];
  const measured = (ms: number) => ms >= video.coverage.firstFrameMs && ms <= video.coverage.lastFrameMs &&
    evidence.verified(time(ms));
  const frames = new Map<string, FrameObservation>();
  const candidates: Candidate[] = [];
  for (const [index, frame] of video.frames.entries()) {
    const findingId = `video-frame-${index + 1}`;
    const location = time(frame.timeMs);
    if (frame.id !== findingId || !measured(frame.timeMs) || !evidence.observation(findingId, location)) continue;
    const observation = { kind: "observation", findingId, measure: "decoded_frame", location } as const;
    const { sourceSeek, editGridApproximation } = videoPreviewTiming(observation);
    frames.set(findingId, observation);
    candidates.push({
      selectionId: findingId, media: "video", sourceSeek, observations: [observation],
      draft: { kind: "creative_proposal", target: "cut",
        ...(editGridApproximation ? { editGridApproximation } : {}),
        prompt: "이 관찰 시점을 참고해 사용자 소재의 핵심 장면을 보여 주는 쇼트를 구성하세요." },
    });
  }
  for (const [index, cut] of video.cuts.entries()) {
    const frame = frames.get(cut.frameId);
    const findingId = `video-cut-${index + 1}`;
    const differenceId = `video-difference-${index + 1}`;
    const location = time(cut.beforeMs, cut.afterMs);
    if (!frame || frame.location.startMs !== cut.afterMs || cut.beforeMs >= cut.afterMs || !measured(cut.beforeMs) ||
      !fraction(cut.difference) || cut.difference < video.settings.threshold ||
      !evidence.observation(differenceId, location) || !evidence.inference(findingId, location, [differenceId, frame.findingId])) continue;
    const { sourceSeek, editGridApproximation } = videoPreviewTiming(frame);
    candidates.push({
      selectionId: findingId, media: "video", sourceSeek,
      observations: [{ kind: "observation", findingId: differenceId, measure: "adjacent_rgb_mean_difference",
        location, score: cut.difference }, frame],
      inference: { kind: "inference", findingId, measure: "candidate_cut", location, evidenceIds: [differenceId, frame.findingId] },
      draft: { kind: "creative_proposal", target: "cut", transition: { type: "cut", durationFrames: 0 },
        ...(editGridApproximation ? { editGridApproximation } : {}),
        prompt: "사용자 소재에서 화면 변화가 큰 지점을 골라 앞뒤 쇼트를 바로 연결하세요." },
    });
  }
  return candidates;
}

function musicCandidates(audio: Extract<LocalAnalysis, { media: "music" }>["audio"], evidence: ReturnType<typeof matched>): Candidate[] {
  if (audio.status !== "completed" || audio.coverage.trackStartMs !== evidence.track?.startMs ||
    audio.coverage.trackEndMs !== evidence.track?.endMs) return [];
  const location = time(audio.coverage.firstSampleMs, audio.coverage.endSampleMs);
  const { channels } = audio.coverage;
  if (!evidence.verified(location) || location.startMs >= location.endMs || !evidence.observation("audio-rms", location) ||
    !Number.isInteger(channels) || channels < 1 || channels > 8 || !audio.windows.length ||
    audio.windows.some((window, index) => !fraction(window.rms) || !timestamp(window.endMs) ||
      window.startMs !== (audio.windows[index - 1]?.endMs ?? location.startMs) || window.startMs >= window.endMs ||
      window.endMs > location.endMs) || audio.windows.at(-1)?.endMs !== location.endMs) return [];
  const peakRms = audio.windows.reduce((peak, window) => Math.max(peak, window.rms), 0);
  const loudness = { kind: "observation", findingId: "audio-rms", measure: "normalized_full_scale_rms",
    location, channels, peakRms } as const;
  const candidates: Candidate[] = [{
    selectionId: "audio-rms", media: "music", observations: [loudness],
    draft: { kind: "creative_proposal", target: "music", role: "music",
      prompt: peakRms < audio.settings.quietBelow ? "사용자 장면에 어울리는 잔잔한 배경 음악을 구상하세요." :
        "사용자 장면의 강조 지점에 맞춰 배경 음악의 셈여림을 구성하세요." },
  }];
  const { tempo } = audio;
  if (tempo.status !== "estimated" || !Number.isInteger(tempo.bpm) || tempo.bpm < 60 || tempo.bpm > 200 ||
    !Number.isFinite(tempo.medianIntervalMs) || tempo.medianIntervalMs < 300 || tempo.medianIntervalMs > 1_000 ||
    Math.round(60_000 / tempo.medianIntervalMs) !== tempo.bpm || tempo.onsetTimesMs.length < 5 ||
    tempo.onsetTimesMs.some((ms, index) => !timestamp(ms) || ms < location.startMs || ms >= location.endMs ||
      (index > 0 && ms <= tempo.onsetTimesMs[index - 1])) ||
    !evidence.observation("audio-onsets", location) || !evidence.inference("audio-tempo", location, ["audio-onsets"])) return candidates;
  candidates.push({
    selectionId: "audio-tempo", media: "music", observations: [{
      kind: "observation", findingId: "audio-onsets", measure: "energy_onsets", location,
      timesMs: [...tempo.onsetTimesMs], medianIntervalMs: tempo.medianIntervalMs,
    }],
    inference: { kind: "inference", findingId: "audio-tempo", measure: "estimated_bpm", location,
      bpm: tempo.bpm, evidenceIds: ["audio-onsets"] },
    draft: { kind: "creative_proposal", target: "music", role: "music",
      prompt: `추정 템포인 약 ${tempo.bpm} BPM을 출발점으로 사용자 장면에 맞는 배경 음악을 구상하세요.` },
  });
  return candidates;
}

function imageCandidates(image: Extract<LocalAnalysis, { media: "image" }>["image"], evidence: ReturnType<typeof matched>): Candidate[] {
  if (image.status !== "completed") return [];
  const whole: Region = { kind: "region", x: 0, y: 0, width: 1, height: 1 };
  return [{ location: whole, distribution: image.distribution }, ...image.regions].flatMap(({ location, distribution }, index) => {
    const findingId = `image-region-${index}`;
    const { x, y, width, height } = location;
    const { alphaCoverage, luminanceShares } = distribution;
    const palette = distribution.palette.map(({ bucket, visibleShare }) => ({ bucket, visibleShare }));
    if (!evidence.observation(findingId, location) || ![x, y, width, height, alphaCoverage].every(fraction) ||
      width <= 0 || height <= 0 || x + width > 1 || y + height > 1 || alphaCoverage <= 0 ||
      !luminanceShares || luminanceShares.length !== 4 || !luminanceShares.every(fraction) ||
      !palette.length || palette.length > 3 ||
      palette.some(color => !/^#[0-9a-f]{6}$/.test(color.bucket) || !fraction(color.visibleShare))) return [];
    const luminanceBand = ["어두운", "중간보다 낮은", "중간보다 높은", "밝은"][luminanceShares.indexOf(Math.max(...luminanceShares))];
    const percent = (value: number) => Math.round(value * 100);
    return [{
      selectionId: findingId, media: "image",
      observations: [{ kind: "observation", findingId, measure: "region_color_luminance",
        location: { kind: "region", x, y, width, height }, alphaCoverage, palette,
        luminanceShares: [...luminanceShares], luminanceEdges: [0, 0.25, 0.5, 0.75, 1] }],
      draft: { kind: "creative_proposal", target: "image",
        prompt: `사용자 소재에 ${luminanceBand} 명도를 중심으로 한 구도를 적용하세요. 화면의 왼쪽 ${percent(x)}%, 위쪽 ${percent(y)}% 지점부터 너비 ${percent(width)}%, 높이 ${percent(height)}% 영역에 ${palette.map(color => color.bucket).join(", ")} 계열의 색을 배치하세요.` },
    }];
  });
}

/** Builds creative drafts from decoder output already held by the caller. */
export function proposalsForLocalReference(analysis: LocalAnalysis): Candidate[] {
  const parsed = referenceAnalysisResultSchema.safeParse(analysis.inspection);
  let candidates: Candidate[] = [];
  if (parsed.success && parsed.data.inspection === "completed" && parsed.data.input.status === "ready" &&
    parsed.data.input.source.kind === "file" && parsed.data.input.source.media === analysis.media &&
    parsed.data.findings.some(item => item.kind === "file_metadata" && item.observedBytes !== undefined)) {
    const evidence = matched(parsed.data);
    switch (analysis.media) {
      case "video": candidates = videoCandidates(analysis.video, evidence); break;
      case "music": candidates = musicCandidates(analysis.audio, evidence); break;
      case "image": candidates = imageCandidates(analysis.image, evidence); break;
    }
  }
  return candidates;
}

/** Mint only from an analyzer output and project/source scope already authorized by the server. */
export function createPrivateReferencePreviewRecord(
  actor: VerifiedActor, scope: Scope, analyzedAtMs: number, analysis: LocalAnalysis,
): PrivatePreviewRecord {
  if (!isVerifiedActor(actor)) throw new Error("REFERENCE_OWNER_REQUIRED");
  if (!timestamp(analyzedAtMs) || !scope.projectId || !scope.sourceId || !scope.sourceRevision || !scope.analysisRevision) {
    throw new Error("REFERENCE_PREVIEW_CONTEXT_REQUIRED");
  }
  const candidates = proposalsForLocalReference(analysis);
  const record = Object.freeze({ [recordBrand]: true as const });
  records.set(record, { ownerId: actor.id, scope: { ...scope }, analyzedAtMs, candidates });
  return record;
}

type Preview =
  | { schemaVersion: 1; status: "ready"; mode: "preview_only"; proposals: Candidate[] }
  | { schemaVersion: 1; status: "owner_required" | "stale" | "selection_unavailable" };

/** Current context and freshness policy are trusted server inputs. Only selected safe evidence is returned. */
export function previewReferenceProject(
  record: PrivatePreviewRecord, actor: VerifiedActor,
  current: { scope: Scope; nowMs: number; maxAgeMs: number },
  selectedIds: readonly string[],
): Preview {
  const entry = records.get(record);
  if (!entry || !isVerifiedActor(actor) || actor.id !== entry.ownerId || current.scope.projectId !== entry.scope.projectId) {
    return { schemaVersion: 1, status: "owner_required" };
  }
  if (current.scope.sourceId !== entry.scope.sourceId || current.scope.sourceRevision !== entry.scope.sourceRevision || current.scope.analysisRevision !== entry.scope.analysisRevision ||
    !timestamp(current.nowMs) || !timestamp(current.maxAgeMs) || current.nowMs < entry.analyzedAtMs ||
    current.nowMs - entry.analyzedAtMs > current.maxAgeMs) return { schemaVersion: 1, status: "stale" };

  if (!selectedIds.length || selectedIds.length > entry.candidates.length || new Set(selectedIds).size !== selectedIds.length) {
    return { schemaVersion: 1, status: "selection_unavailable" };
  }
  const byId = new Map(entry.candidates.map(item => [item.selectionId, item]));
  const proposals: Candidate[] = [];
  for (const id of selectedIds) {
    const candidate = byId.get(id);
    if (!candidate) return { schemaVersion: 1, status: "selection_unavailable" };
    proposals.push(candidate);
  }
  return { schemaVersion: 1, status: "ready", mode: "preview_only", proposals: structuredClone(proposals) };
}
