// T272 합성 프로젝트 미리보기 입력(시험 전용). 체험 화면의 합성 표본과 같은 값이다.
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import type { createPrivateReferencePreviewRecord } from "../../lib/reference-analysis/project-preview";
import { createReferenceAnalysisResult, type ReferenceFinding } from "../../lib/reference-analysis/result";

export type Analysis = Parameters<typeof createPrivateReferencePreviewRecord>[3];
export const owner = actorFromVerifiedUserId("20000000-0000-4000-8000-000000000272");
export const scope = { projectId: "synthetic-project", sourceId: "synthetic-source", sourceRevision: "synthetic-rev", analysisRevision: "synthetic-analysis" };
export const clock = { scope, nowMs: 1_100, maxAgeMs: 500 };
export const marker = "SYNTH-PRIVATE-272";
const time = (startMs: number, endMs = startMs) => ({ kind: "time", startMs, endMs } as const);
const observe = (id: string, location: ReferenceFinding["location"]): ReferenceFinding => ({ id, kind: "observation", location, text: marker });
const infer = (id: string, location: ReferenceFinding["location"], evidenceIds: string[]): ReferenceFinding =>
  ({ id, kind: "inference", location, evidenceIds, text: marker, alternatives: [marker] });

function inspection(media: Analysis["media"], findings: ReferenceFinding[]) {
  const ext = { music: "wav", video: "mp4", image: "png" }[media];
  return createReferenceAnalysisResult({
    status: "ready", source: { kind: "file", name: `${marker}.${ext}`, media, sizeBytes: 1, permission: "synthetic" },
  }, [{
    kind: "file_metadata", id: "file-metadata", location: { kind: "whole" }, observedBytes: 1, tool: marker,
    values: media === "image" ? { width: 12, height: 8 } : { durationMs: 500 },
    ...(media !== "image" ? { timeline: { containerDurationMs: 500, tracks: [{ kind: media === "music" ? "audio" : "video", startMs: 0, endMs: 500 }] } } : {}),
  }, ...findings], "completed");
}

// 체험 화면의 합성 표본(영상 500ms·컷 120→340ms, 음악 500ms, 이미지 12×8 중앙 영역)과 같은 값.
export const syntheticAnalyses = (): Record<"video" | "music" | "image", Analysis> => ({
  video: {
    media: "video",
    video: {
      status: "completed", settings: {
        method: "adjacent_rgb_mean_difference", threshold: 0.22, width: 64, height: 36,
        maxDurationMs: 20_000, maxSourcePixels: 1920 * 1080, maxFrames: 240, maxCuts: 24,
      },
      coverage: { trackStartMs: 0, trackEndMs: 500, firstFrameMs: 0, lastFrameMs: 340, framesRead: 3 },
      cuts: [{ kind: "inference", beforeMs: 120, afterMs: 340, difference: 0.68, frameId: "video-frame-3" }],
      frames: [0, 120, 340].map((timeMs, index) => ({ id: `video-frame-${index + 1}`, timeMs, format: "rgb24", width: 64, height: 36, pixels: Uint8Array.from([1, 2, 3]) })),
    },
    inspection: inspection("video", [
      observe("video-frame-1", time(0)), observe("video-frame-2", time(120)), observe("video-frame-3", time(340)),
      observe("video-difference-1", time(120, 340)), infer("video-cut-1", time(120, 340), ["video-difference-1", "video-frame-3"]),
    ]),
  },
  music: {
    media: "music",
    audio: {
      status: "completed", settings: {
        sampleRate: 8_000, windowMs: 50, quietBelow: 0.01, onsetPeakRatio: 0.35, onsetFloor: 0.02, minOnsets: 5,
        minBeatIntervalMs: 300, maxBeatIntervalMs: 1_000, maxDurationMs: 24_000, maxChannels: 8,
        rmsUnit: "normalized_full_scale", channelAggregation: "mean_square_across_channels",
      },
      coverage: { trackStartMs: 0, trackEndMs: 500, firstSampleMs: 0, endSampleMs: 500, samplesRead: 4_000, channels: 1 },
      windows: Array.from({ length: 10 }, (_, index) => ({ rms: index >= 2 && index < 8 ? 0.2 : 0, startMs: index * 50, endMs: (index + 1) * 50 })),
      segments: [], tempo: { status: "unverified", reason: "insufficient_onsets" },
    },
    inspection: inspection("music", [observe("audio-rms", time(0, 500))]),
  },
  image: (() => {
    const center = { kind: "region", x: 0.25, y: 0.2, width: 0.5, height: 0.55 } as const;
    const whole = { kind: "region", x: 0, y: 0, width: 1, height: 1 } as const;
    const wide = { alphaCoverage: 1, palette: [{ bucket: "#dbe4ee", visibleShare: 0.6 }, { bucket: "#a7e3d6", visibleShare: 0.4 }], luminanceShares: [0, 0, 0.1, 0.9] };
    const middle = { alphaCoverage: 1, palette: [{ bucket: "#a7e3d6", visibleShare: 1 }], luminanceShares: [0, 0, 0, 1] };
    return {
      media: "image",
      image: {
        status: "completed", display: { width: 12, height: 8 }, sample: { width: 12, height: 8, columns: 1, rows: 1 },
        luminanceEdges: [0, 0.25, 0.5, 0.75, 1], distribution: wide, regions: [{ location: center, distribution: middle }],
      },
      inspection: inspection("image", [observe("image-region-0", whole), observe("image-region-1", center)]),
    } as Analysis;
  })(),
});
