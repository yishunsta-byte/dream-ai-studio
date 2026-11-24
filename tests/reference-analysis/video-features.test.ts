import { access, mkdtemp, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as tools from "../../lib/media/tools";
import { analyzeLocalReferenceVideo } from "../../lib/reference-analysis/video-features";

vi.mock("server-only", () => ({}));

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("managed local video REA cuts and representatives", () => {
  const names = ["static.mp4", "wide-pixels.mp4", "cut.mp4", "cover.png", "covered.mp4", "cover-only.mp4", "double.mp4", "delayed.mp4", "long.mp4", "dense.mp4"];
  let root: string;
  let ffmpeg: string;
  let ffprobe: string;
  beforeAll(async () => {
    const suffix = process.platform === "win32" ? ".exe" : "";
    ffmpeg = join(tools.mediaToolsFolder(), "ffmpeg" + suffix);
    ffprobe = join(tools.mediaToolsFolder(), "ffprobe" + suffix);
    await Promise.all([access(ffmpeg), access(ffprobe)]);
    vi.stubEnv("FFMPEG_PATH", ffmpeg);
    vi.stubEnv("FFPROBE_PATH", ffprobe);
    root = await mkdtemp(join(tmpdir(), "dream-rea-video-"));
    const make = (file: string, args: string[]) => tools.runMedia(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", ...args, join(root, file),
    ], { timeout: 15_000, windowsHide: true });
    await make("static.mp4", ["-f", "lavfi", "-i", "color=c=red:s=32x24:r=10:d=1", "-c:v", "mpeg4"]);
    await make("wide-pixels.mp4", ["-f", "lavfi", "-i", "color=c=red:s=32x32:r=10:d=1", "-vf", "setsar=2", "-c:v", "mpeg4"]);
    await make("cut.mp4", [
      "-f", "lavfi", "-i", "color=c=red:s=32x24:r=10:d=0.5",
      "-f", "lavfi", "-i", "color=c=blue:s=32x24:r=10:d=0.5",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4",
    ]);
    await sharp({ create: { width: 12, height: 8, channels: 3, background: "green" } }).png().toFile(join(root, "cover.png"));
    await make("covered.mp4", [
      "-i", join(root, "cut.mp4"), "-i", join(root, "cover.png"),
      "-map", "0:v:0", "-map", "1:v:0", "-c", "copy", "-disposition:v:1", "attached_pic",
    ]);
    await make("cover-only.mp4", [
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-i", join(root, "cover.png"),
      "-map", "0:a:0", "-map", "1:v:0", "-c:v", "copy", "-c:a", "aac", "-disposition:v:0", "attached_pic",
    ]);
    await make("double.mp4", ["-i", join(root, "cut.mp4"), "-map", "0:v:0", "-map", "0:v:0", "-c", "copy"]);
    await make("delayed.mp4", [
      "-itsoffset", "0.3", "-i", join(root, "cut.mp4"),
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
    ]);
    await make("long.mp4", ["-f", "lavfi", "-i", "color=c=red:s=32x24:r=1:d=21", "-c:v", "mpeg4"]);
    await make("dense.mp4", ["-f", "lavfi", "-i", "color=c=red:s=32x24:r=30:d=9", "-c:v", "mpeg4"]);
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!root) return;
    await Promise.all(names.map(name => rm(join(root, name), { force: true })));
    await rmdir(root);
  });

  async function analyze(name: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const path = join(root, name);
    return analyzeLocalReferenceVideo(path, {
      kind: "file", name, permission: "synthetic", sizeBytes: (await stat(path)).size,
    }, { managedRoot: root, ...options });
  }

  it("observes a representative frame and zero cut candidates on a constant-color clip", async () => {
    const result = await analyze("static.mp4");
    expect(result.video).toMatchObject({
      status: "completed", cuts: [],
      coverage: { trackStartMs: 0, trackEndMs: 1_000, firstFrameMs: 0, lastFrameMs: 900, framesRead: 10 },
    });
    if (result.video.status !== "completed") throw new Error("Missing video result");
    expect(result.video.frames).toHaveLength(1);
    expect(result.video.frames[0].pixels).toHaveLength(64 * 36 * 3);
    expect(result.inspection.findings.map(item => item.kind)).toEqual(["file_metadata", "observation"]);
  });

  it.each([
    ["static.mp4", "1:1", 32, 24, 48, 36],
    ["wide-pixels.mp4", "2:1", 32, 32, 64, 32],
  ] as const)("preserves the actual display area of %s", async (name, sar, width, height, activeWidth, activeHeight) => {
    const probe = await tools.runMedia(ffprobe, ["-v", "error", "-show_entries",
      "stream=sample_aspect_ratio,width,height", "-of", "json", join(root, name)], { timeout: 10_000 });
    expect(JSON.parse(probe.stdout).streams).toMatchObject([{ sample_aspect_ratio: sar, width, height }]);
    const result = await analyze(name);
    if (result.video.status !== "completed") throw new Error("Missing video result");
    const frame = result.video.frames[0];
    expect(frame).toMatchObject({ width: 64, height: 36, timeMs: 0 });
    expect(result.inspection.findings[0]).toMatchObject({ values: { width, height } });
    expect(result.video.coverage).toMatchObject({ firstFrameMs: 0, lastFrameMs: 900 });
    const redPixels = [];
    for (let index = 0; index < frame.width * frame.height; index++) {
      const offset = index * 3;
      if (frame.pixels[offset] > 150 && frame.pixels[offset + 1] < 80 && frame.pixels[offset + 2] < 80) {
        redPixels.push({ x: index % frame.width, y: Math.floor(index / frame.width) });
      }
    }
    expect(redPixels).toHaveLength(activeWidth * activeHeight);
    expect(new Set(redPixels.map(pixel => pixel.x)).size).toBe(activeWidth);
    expect(new Set(redPixels.map(pixel => pixel.y)).size).toBe(activeHeight);
  });

  it("reports an unsupported scale option without returning distorted frames", async () => {
    const actual = tools.runMedia;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (basename(args[0]) !== basename(ffmpeg)) return actual(...args);
      return actual(process.execPath, ["-e", "process.stderr.write('Error applying option reset_sar to scale: Option not found'); process.exit(1)"], args[2]);
    });
    try {
      const result = await analyze("wide-pixels.mp4");
      expect(result.video).toEqual({ status: "local_tool_unsupported" });
      expect(result.inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
    } finally { spy.mockRestore(); }
  });

  it.each(["cut.mp4", "covered.mp4"])("keeps the observed red and blue frames around a candidate in %s", async name => {
    const result = await analyze(name);
    if (result.video.status !== "completed") throw new Error("Missing video result");
    expect(result.video.cuts).toEqual([{
      kind: "inference", beforeMs: 400, afterMs: 500, difference: expect.any(Number), frameId: "video-frame-2",
    }]);
    expect(result.video.cuts[0].difference).toBeGreaterThan(result.video.settings.threshold);
    expect(result.video.frames.map(frame => frame.timeMs)).toEqual([0, 500]);
    const center = (18 * 64 + 32) * 3;
    expect(result.video.frames[0].pixels[center]).toBeGreaterThan(200);
    expect(result.video.frames[1].pixels[center + 2]).toBeGreaterThan(200);
    expect(result.inspection.findings).toContainEqual(expect.objectContaining({
      kind: "inference", evidenceIds: ["video-difference-1", "video-frame-2"],
    }));
    expect(JSON.stringify(result.inspection)).not.toMatch(/dream-rea-inspect|pixels/);
  });

  it("does not create evidence from a cover-only or ambiguous two-video input", async () => {
    expect(await analyze("cover-only.mp4")).toMatchObject({
      inspection: { inspection: "invalid_file", findings: [] }, video: { status: "not_analyzed" },
    });
    const ambiguous = await analyze("double.mp4");
    expect(ambiguous.video).toEqual({ status: "track_unverified" });
    expect(ambiguous.inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
  });

  it("keeps the actual playback offset instead of shifting the selected video to zero", async () => {
    const result = await analyze("delayed.mp4");
    expect(result.video).toMatchObject({
      status: "completed",
      coverage: { trackStartMs: 300, trackEndMs: 1_300, firstFrameMs: 300, lastFrameMs: 1_200, framesRead: 10 },
      cuts: [{ beforeMs: 700, afterMs: 800 }],
    });
  });

  it("does not treat unrelated decoder text as a frame timestamp", async () => {
    const actual = tools.runMedia;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (basename(args[0]) !== basename(ffmpeg)) return actual(...args);
      return actual(process.execPath, ["-e",
        "process.stderr.write('n: 0 pts: 0 pts_time:0\\n'); process.stdout.write(Buffer.alloc(6912))"], args[2]);
    });
    try {
      const result = await analyze("cut.mp4");
      expect(result.video).toEqual({ status: "frame_timing_unverified" });
      expect(result.inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
    } finally { spy.mockRestore(); }
  });

  it("stops above the duration and decoded-frame budgets without partial candidates", async () => {
    for (const name of ["long.mp4", "dense.mp4"]) {
      const result = await analyze(name);
      expect(result.video).toEqual({ status: "analysis_limit" });
      expect(result.inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
    }
  });

  it("leaves no temporary frame file and removes the probe snapshot after success", async () => {
    const actual = tools.runMedia;
    let snapshot: string | undefined;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (basename(args[0]) === basename(ffmpeg)) snapshot = args[1]?.[args[1].indexOf("-i") + 1];
      return actual(...args);
    });
    try {
      expect((await analyze("cut.mp4")).video.status).toBe("completed");
      expect(snapshot).toContain("dream-rea-inspect-");
      await expect(access(dirname(snapshot!))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await stat(join(root, "cut.mp4"))).size).toBeGreaterThan(0);
    } finally { spy.mockRestore(); }
  });

  it.each(["cancelled", "timed_out"] as const)("waits for decoder exit and clears the snapshot after %s", async status => {
    const actual = tools.runMedia;
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    let snapshot: string | undefined;
    let childClosed = false;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (basename(args[0]) !== basename(ffmpeg)) return actual(...args);
      snapshot = args[1]?.[args[1].indexOf("-i") + 1];
      const child = actual(process.execPath, ["-e", "setInterval(() => {}, 100)"], args[2]);
      child.child.once("close", () => { childClosed = true; });
      started.resolve();
      return child;
    });
    try {
      const pending = analyze("cut.mp4", { signal: controller.signal, timeoutMs: status === "timed_out" ? 800 : 5_000 });
      if (status === "cancelled") {
        await started.promise;
        controller.abort();
      }
      const result = await pending;
      expect(result.video).toEqual({ status });
      expect(result.inspection.findings).toMatchObject([{ kind: "unavailable", reason: status }]);
      expect(childClosed).toBe(true);
      await expect(access(dirname(snapshot!))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { spy.mockRestore(); }
  });
});
