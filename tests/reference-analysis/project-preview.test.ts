import { mkdtemp, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId, type VerifiedActor } from "../../lib/db/postgres/types";
import { clipSchema } from "../../lib/edit/timeline";
import { analyzeLocalReferenceImage } from "../../lib/reference-analysis/image-features";
import { createPrivateReferencePreviewRecord, previewReferenceProject } from "../../lib/reference-analysis/project-preview";
import { createReferenceAnalysisResult, type ReferenceFinding } from "../../lib/reference-analysis/result";

vi.mock("server-only", () => ({}));

const owner = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000001");
const other = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000002");
const scope = { projectId: "private-project", sourceId: "private-source", sourceRevision: "private-source-rev", analysisRevision: "private-analysis-rev" };
const clock = { scope, nowMs: 10_100, maxAgeMs: 500 };
const privateText = "https://private.invalid/original C:/private/sample.raw private-original-text";
const completion = 10_000;
type Analysis = Parameters<typeof createPrivateReferencePreviewRecord>[3];
const time = (startMs: number, endMs = startMs) => ({ kind: "time", startMs, endMs } as const);
const region = { kind: "region", x: 0.5, y: 0, width: 0.5, height: 0.5 } as const;
const whole = { kind: "region", x: 0, y: 0, width: 1, height: 1 } as const;
const observe = (id: string, location: ReferenceFinding["location"]): ReferenceFinding =>
  ({ id, kind: "observation", location, text: privateText });
const infer = (id: string, location: ReferenceFinding["location"], evidenceIds: string[]): ReferenceFinding =>
  ({ id, kind: "inference", location, evidenceIds, text: privateText, alternatives: [privateText] });

function result(media: Analysis["media"], findings: ReferenceFinding[], track = true) {
  const durationMs = media === "music" ? 4_000 : 2_000;
  const ext = { music: "m4a", video: "mp4", image: "png" }[media];
  return createReferenceAnalysisResult({
    status: "ready", source: { kind: "file", name: "secret-filename." + ext, media, sizeBytes: 1, permission: "synthetic" },
  }, [{
    kind: "file_metadata", id: "file-metadata", location: { kind: "whole" }, observedBytes: 1,
    tool: privateText, values: media === "image" ? { width: 4, height: 4 } : { durationMs },
    ...(track && media !== "image" ? { timeline: { containerDurationMs: durationMs,
      tracks: [{ kind: media === "music" ? "audio" : "video", startMs: 0, endMs: durationMs }] } } : {}),
  }, ...findings], "completed");
}

function video(track = true): Extract<Analysis, { media: "video" }> {
  const cuts = [{ kind: "inference", beforeMs: 500, afterMs: 625, difference: 0.72, frameId: "video-frame-2" }] as const;
  return {
    media: "video",
    video: {
      status: "completed", settings: {
        method: "adjacent_rgb_mean_difference", threshold: 0.22, width: 64, height: 36,
        maxDurationMs: 20_000, maxSourcePixels: 1920 * 1080, maxFrames: 240, maxCuts: 24,
      },
      coverage: { trackStartMs: 0, trackEndMs: 2_000, firstFrameMs: 0, lastFrameMs: 1_900, framesRead: 20 },
      cuts: [...cuts], frames: [0, 625].map((timeMs, index) => ({
        id: "video-frame-" + (index + 1), timeMs, format: "rgb24", width: 64, height: 36,
        pixels: Uint8Array.from([213, 29, 47]),
      })),
    },
    inspection: result("video", [
      observe("video-frame-1", time(0)), observe("video-frame-2", time(625)),
      observe("video-difference-1", time(500, 625)),
      infer("video-cut-1", time(500, 625), ["video-difference-1", "video-frame-2"]),
    ], track),
  };
}

function audio(estimated = true): Extract<Analysis, { media: "music" }> {
  const location = time(0, 4_000);
  return {
    media: "music",
    audio: {
      status: "completed", settings: {
        sampleRate: 8_000, windowMs: 50, quietBelow: 0.01, onsetPeakRatio: 0.35, onsetFloor: 0.02, minOnsets: 5,
        minBeatIntervalMs: 300, maxBeatIntervalMs: 1_000, maxDurationMs: 24_000, maxChannels: 8,
        rmsUnit: "normalized_full_scale", channelAggregation: "mean_square_across_channels",
      },
      coverage: { trackStartMs: 0, trackEndMs: 4_000, firstSampleMs: 0, endSampleMs: 4_000, samplesRead: 32_000, channels: 2 },
      windows: Array.from({ length: 80 }, (_, index) => ({
        rms: index % 10 === 0 ? 0.35355 : 0, startMs: index * 50, endMs: (index + 1) * 50,
      })),
      segments: [],
      tempo: estimated ? {
        status: "estimated", bpm: 120, medianIntervalMs: 500, maxDeviationMs: 0, thresholdRms: 0.123743,
        onsetTimesMs: [0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500],
      } : { status: "unverified", reason: "irregular_intervals" },
    },
    inspection: result("music", [observe("audio-rms", location), ...(estimated ? [
      observe("audio-onsets", location), infer("audio-tempo", location, ["audio-onsets"]),
    ] : [])]),
  };
}

function image(): Extract<Analysis, { media: "image" }> {
  const distribution = { alphaCoverage: 0.5, palette: [{ bucket: "#e02020", visibleShare: 1 }], luminanceShares: [1, 0, 0, 0] };
  return {
    media: "image",
    image: {
      status: "completed", display: { width: 4, height: 4 }, sample: { width: 4, height: 4, columns: 2, rows: 2 },
      luminanceEdges: [0, 0.25, 0.5, 0.75, 1], distribution, regions: [
        { location: region, distribution },
        { location: { ...region, y: 0.5 }, distribution: { alphaCoverage: 0, palette: [], luminanceShares: null } },
      ],
    },
    inspection: result("image", [observe("image-region-0", whole), observe("image-region-1", region),
      observe("image-region-2", { ...region, y: 0.5 })]),
  };
}

const preview = (analysis: Analysis, selectedIds: string[]) =>
  previewReferenceProject(createPrivateReferencePreviewRecord(owner, scope, completion, analysis), owner, clock, selectedIds);

describe("owner-only reference project preview", () => {
  it("separates cut inference from observed reference time and timeline-compatible suggestions", () => {
    const output = preview(video(), ["video-cut-1", "video-frame-1"]);
    expect(output).toMatchObject({ schemaVersion: 1, status: "ready", mode: "preview_only", proposals: [{
      selectionId: "video-cut-1", sourceSeek: { kind: "observed_pts", ptsMs: 625, findingId: "video-frame-2" }, observations: [
        { kind: "observation", measure: "adjacent_rgb_mean_difference", location: time(500, 625), score: 0.72 },
        { kind: "observation", measure: "decoded_frame", location: time(625), findingId: "video-frame-2" },
      ],
      inference: { kind: "inference", measure: "candidate_cut", evidenceIds: ["video-difference-1", "video-frame-2"] },
      draft: { kind: "creative_proposal", target: "cut", editGridApproximation: { fps: 30, frame: 19 },
        transition: { type: "cut", durationFrames: 0 } },
    }, { selectionId: "video-frame-1", sourceSeek: { kind: "observed_pts", ptsMs: 0, findingId: "video-frame-1" }, draft: { editGridApproximation: { frame: 0 } } }] });
    expect(JSON.stringify(output)).not.toMatch(/pixels|213|startFrame|assetId|referenceFrame/);
    if (output.status !== "ready" || output.proposals[0].draft.target !== "cut") throw new Error("Missing cut proposal");
    expect(clipSchema.safeParse({
      id: owner.id, sceneId: other.id, sceneVersionId: null, assetId: null,
      durationFrames: 1, trimInFrames: 0, trimOutFrames: 0, transition: output.proposals[0].draft.transition,
    }).success).toBe(true);
  });

  it("seeks a delayed observed PTS and excludes the track end and unobserved positions", () => {
    const analysis = video();
    if (analysis.video.status !== "completed") throw new Error("Missing fixture");
    const metadata = analysis.inspection.findings[0];
    if (metadata.kind !== "file_metadata" || !metadata.timeline) throw new Error("Missing fixture track");
    metadata.timeline.tracks[0].startMs = 9;
    analysis.video.coverage.trackStartMs = 9;
    analysis.video.coverage.firstFrameMs = 9;
    analysis.video.frames[0].timeMs = 9;
    analysis.inspection.findings[1] = observe("video-frame-1", time(9));
    expect(preview(analysis, ["video-frame-1"])).toMatchObject({ status: "ready", proposals: [{
      sourceSeek: { kind: "observed_pts", ptsMs: 9, findingId: "video-frame-1" },
      draft: { editGridApproximation: { fps: 30, frame: 0 } },
    }] });

    analysis.video.frames[0].timeMs = 10;
    expect(preview(analysis, ["video-frame-1"]).status).toBe("selection_unavailable");
    analysis.video.frames[0].timeMs = 2_000;
    analysis.video.coverage.lastFrameMs = 2_000;
    analysis.inspection.findings[1] = observe("video-frame-1", time(2_000));
    expect(preview(analysis, ["video-frame-1"]).status).toBe("selection_unavailable");
  });

  it("distinguishes measured loudness and onset timing from estimated BPM", () => {
    expect(preview(audio(), ["audio-rms", "audio-tempo"])).toMatchObject({ status: "ready", proposals: [
      { observations: [{ measure: "normalized_full_scale_rms", channels: 2, peakRms: 0.35355 }], draft: { role: "music" } },
      { observations: [{ measure: "energy_onsets", medianIntervalMs: 500, location: time(0, 4_000) }],
        inference: { measure: "estimated_bpm", bpm: 120, evidenceIds: ["audio-onsets"] },
        draft: { kind: "creative_proposal", target: "music", prompt: expect.stringContaining("120 BPM") } },
    ] });
    expect(preview(audio(false), ["audio-tempo"]).status).toBe("selection_unavailable");
    expect(preview(audio(false), ["audio-rms"]).status).toBe("ready");
  });

  it("carries validated image colors, luminance, and normalized display regions without copying source content", () => {
    const output = preview(image(), ["image-region-1"]);
    expect(output).toMatchObject({ status: "ready", proposals: [{
      observations: [{ kind: "observation", measure: "region_color_luminance", location: region, alphaCoverage: 0.5,
        luminanceShares: [1, 0, 0, 0], palette: [{ bucket: "#e02020", visibleShare: 1 }] }],
      draft: { kind: "creative_proposal", target: "image", prompt: expect.stringContaining("#e02020") },
    }] });
    for (const value of [output, preview(audio(), ["audio-tempo"]), preview(video(), ["video-cut-1"])]) {
      expect(JSON.stringify(value)).not.toMatch(/private|secret-filename|sourceUrl|ownerId|data:image|observedBytes|png|mp4|m4a/);
    }
    expect(preview(image(), ["image-region-2"]).status).toBe("selection_unavailable");
  });

  it("rejects missing track, mismatched evidence, cancelled and failed inputs, and invalid selections", () => {
    expect(preview(video(false), ["video-cut-1"]).status).toBe("selection_unavailable");
    const mismatch = video();
    mismatch.inspection.findings[4] = infer("video-cut-1", time(500, 625), ["video-difference-1", "video-frame-1"]);
    expect(preview(mismatch, ["video-cut-1"]).status).toBe("selection_unavailable");
    const invalidRegion = image();
    if (invalidRegion.image.status !== "completed") throw new Error("Expected fixture");
    invalidRegion.image.regions[0].location = { ...region, width: 0.7 };
    expect(preview(invalidRegion, ["image-region-1"]).status).toBe("selection_unavailable");
    const input = video().inspection.input;
    for (const reason of ["cancelled", "timed_out", "local_tool_failed"] as const) {
      const stopped = createReferenceAnalysisResult(input, [{
        id: "local-inspection", kind: "unavailable", location: { kind: "whole" }, subject: "file_metadata", reason,
      }], reason);
      expect(preview({ ...video(), inspection: stopped }, ["video-cut-1"]).status).toBe("selection_unavailable");
    }
    expect(preview({ ...video(), video: { status: "frame_timing_unverified" } }, ["video-cut-1"]).status).toBe("selection_unavailable");
    for (const ids of [[], ["video-cut-1", "video-cut-1"], ["video-cut-1", privateText]]) {
      expect(preview(video(), ids)).toEqual({ schemaVersion: 1, status: "selection_unavailable" });
    }
  });

  it("binds records to a verified owner, project, source, current revision, and freshness window", () => {
    const token = createPrivateReferencePreviewRecord(owner, scope, completion, video());
    const ids = ["video-cut-1"];
    const forgedActor = { id: owner.id } as VerifiedActor;
    expect(() => createPrivateReferencePreviewRecord(forgedActor, scope, completion, video())).toThrow("REFERENCE_OWNER_REQUIRED");
    for (const [record, actor, context] of [
      [token, other, clock], [token, forgedActor, clock], [{ ...token }, owner, clock],
      [token, owner, { ...clock, scope: { ...scope, projectId: "different-project" } }],
    ] as const) expect(previewReferenceProject(record, actor, context, ids).status).toBe("owner_required");
    for (const current of [
      { ...clock, scope: { ...scope, sourceId: "different-source" } },
      { ...clock, scope: { ...scope, sourceRevision: "changed" } },
      { ...clock, scope: { ...scope, analysisRevision: "superseded" } },
      { ...clock, nowMs: 10_501 }, { ...clock, nowMs: 9_999 }, { ...clock, maxAgeMs: Number.NaN },
    ]) expect(previewReferenceProject(token, owner, current, ids).status).toBe("stale");
    expect(previewReferenceProject(token, owner, { ...clock, nowMs: 10_500 }, ids).status).toBe("ready");
  });

  it("isolates the private evidence snapshot from caller and response mutations", () => {
    const analysis = image();
    const token = createPrivateReferencePreviewRecord(owner, scope, completion, analysis);
    if (analysis.image.status !== "completed") throw new Error("Expected fixture");
    analysis.image.regions[0].location = { ...region, x: 0 };
    analysis.image.distribution.palette[0].bucket = "#000000";
    const run = () => previewReferenceProject(token, owner, clock, ["image-region-1"]);
    const returned = run();
    expect(returned.status).toBe("ready");
    if (returned.status !== "ready") throw new Error("Missing proposal");
    returned.proposals[0].observations.length = 0;
    expect(run()).toMatchObject({ proposals: [{ observations: [{ location: region, palette: [{ bucket: "#e02020" }] }] }] });
  });

  it.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("previews an actual measured local synthetic image", async () => {
    const { default: sharp } = await import("sharp");
    const root = await mkdtemp(join(tmpdir(), "dream-rea-preview-"));
    const path = join(root, "sample.png");
    try {
      await sharp({ create: { width: 12, height: 8, channels: 3, background: "#ff0000" } }).png().toFile(path);
      const analysis = await analyzeLocalReferenceImage(path,
        { kind: "file", name: "sample.png", sizeBytes: (await stat(path)).size, permission: "synthetic" }, { managedRoot: root });
      expect(preview({ media: "image", ...analysis }, ["image-region-1"])).toMatchObject({
        status: "ready", proposals: [{ observations: [{
          location: { kind: "region", x: 0, y: 0, width: 0.25, height: 0.25 }, palette: [{ bucket: "#e02020", visibleShare: 1 }],
        }] }],
      });
    } finally {
      await rm(path, { force: true });
      await rmdir(root);
    }
  });

  it.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("previews observed cuts and tempo from actual synthetic media", async () => {
    const tools = await import("../../lib/media/tools");
    const { analyzeLocalReferenceVideo } = await import("../../lib/reference-analysis/video-features");
    const { analyzeLocalReferenceAudio } = await import("../../lib/reference-analysis/audio-features");
    const suffix = process.platform === "win32" ? ".exe" : "";
    const ffmpeg = join(tools.mediaToolsFolder(), "ffmpeg" + suffix);
    const root = await mkdtemp(join(tmpdir(), "dream-rea-preview-av-"));
    const videoPath = join(root, "cut.mp4");
    const highRatePath = join(root, "high-rate.mp4");
    const audioPath = join(root, "tempo.m4a");
    vi.stubEnv("FFMPEG_PATH", ffmpeg);
    vi.stubEnv("FFPROBE_PATH", join(tools.mediaToolsFolder(), "ffprobe" + suffix));
    const generate = (args: string[]) => tools.runMedia(ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], { timeout: 15_000, windowsHide: true });
    try {
      await generate([
        "-f", "lavfi", "-i", "color=red:s=32x24:r=30:d=1", "-f", "lavfi", "-i", "color=cyan:s=32x24:r=30:d=1",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4", videoPath,
      ]);
      await generate([
        "-f", "lavfi", "-i", "color=red:s=32x24:r=120:d=1",
        "-vf", "drawbox=color=cyan:t=fill:enable='eq(n,119)'", "-c:v", "mpeg4", highRatePath,
      ]);
      await generate([
        "-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,0.5),0.08),0.7*sin(2*PI*440*t),0)':s=8000",
        "-t", "4", "-c:a", "aac", audioPath,
      ]);
      const options = { managedRoot: root };
      const motion = await analyzeLocalReferenceVideo(videoPath,
        { kind: "file", name: "cut.mp4", sizeBytes: (await stat(videoPath)).size, permission: "synthetic" }, options);
      const highRate = await analyzeLocalReferenceVideo(highRatePath,
        { kind: "file", name: "high-rate.mp4", sizeBytes: (await stat(highRatePath)).size, permission: "synthetic" }, options);
      expect(highRate.video).toMatchObject({
        status: "completed", coverage: { trackStartMs: 0, trackEndMs: 1_000, lastFrameMs: 992, framesRead: 120 },
      });
      const boundary = preview({ media: "video", ...highRate }, ["video-cut-1", "video-frame-2"]);
      expect(boundary).toMatchObject({ status: "ready", proposals: [{
        inference: { location: time(983, 992) }, sourceSeek: { kind: "observed_pts", ptsMs: 992, findingId: "video-frame-2" },
        draft: { editGridApproximation: { fps: 30, frame: 30 }, transition: { type: "cut", durationFrames: 0 } },
      }, {
        sourceSeek: { kind: "observed_pts", ptsMs: 992, findingId: "video-frame-2" },
        draft: { editGridApproximation: { fps: 30, frame: 30 } },
      }] });
      const music = await analyzeLocalReferenceAudio(audioPath,
        { kind: "file", name: "tempo.m4a", sizeBytes: (await stat(audioPath)).size, permission: "synthetic" }, options);
      expect(preview({ media: "video", ...motion }, ["video-cut-1"])).toMatchObject({
        status: "ready", proposals: [{
          inference: { location: time(967, 1_000) }, sourceSeek: { kind: "observed_pts", ptsMs: 1_000 },
          draft: { editGridApproximation: { fps: 30, frame: 30 }, transition: { type: "cut", durationFrames: 0 } },
        }],
      });
      expect(preview({ media: "music", ...music }, ["audio-rms", "audio-tempo"])).toMatchObject({
        status: "ready", proposals: [
          { observations: [{ measure: "normalized_full_scale_rms", peakRms: expect.any(Number) }] },
          { inference: { measure: "estimated_bpm", bpm: 120 } },
        ],
      });
    } finally {
      vi.unstubAllEnvs();
      await Promise.all([videoPath, highRatePath, audioPath].map(path => rm(path, { force: true })));
      await rmdir(root);
    }
  });});
