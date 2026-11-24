import { access, mkdtemp, rm, rmdir, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import { inspectLocalReferenceFile } from "../../lib/reference-analysis/local-file";
import { referenceFileByteLimit } from "../../lib/reference-analysis/input";
import { createPrivateReferenceResult, projectReferenceOwnerScreen, projectReferenceShareSummary } from "../../lib/reference-analysis/projection";
import { createReferenceAnalysisResult, referenceAnalysisResultSchema } from "../../lib/reference-analysis/result";
import * as tools from "../../lib/media/tools";
import { mediaToolsFolder, runMedia } from "../../lib/media/tools";

vi.mock("server-only", () => ({}));

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("existing local media tools on owned synthetic references", () => {
  let root: string;
  const files = [
    "clip.mp4", "music.wav", "still.png", "invalid.png", "oversize.mp4", "mixed.mp4", "cover-only.mp4", "mixed-cover.mp4",
  ];
  const actor = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000003");
  let ffprobe: string;
  beforeAll(async () => {
    const extension = process.platform === "win32" ? ".exe" : "";
    const ffmpeg = join(mediaToolsFolder(), "ffmpeg" + extension);
    ffprobe = join(mediaToolsFolder(), "ffprobe" + extension);
    await Promise.all([access(ffmpeg), access(ffprobe)]);
    vi.stubEnv("FFPROBE_PATH", ffprobe);
    root = await mkdtemp(join(tmpdir(), "dream-rea-"));
    const makeMedia = (input: string, output: string, options: string[]) => runMedia(
      ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", input, ...options, join(root, output)],
      { timeout: 15_000, windowsHide: true },
    );
    await makeMedia("color=c=blue:s=32x24:r=10:d=0.5", "clip.mp4", ["-c:v", "mpeg4", "-pix_fmt", "yuv420p"]);
    await makeMedia("sine=frequency=440:sample_rate=8000:duration=0.5", "music.wav", ["-c:a", "pcm_s16le"]);
    await runMedia(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-f", "lavfi", "-i", "color=c=blue:s=32x24:r=10:d=0.5",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=1.5",
      "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-c:a", "aac", join(root, "mixed.mp4"),
    ], { timeout: 15_000, windowsHide: true });
    await sharp({ create: { width: 12, height: 8, channels: 3, background: "#2559b5" } }).png().toFile(join(root, "still.png"));
    const attachCover = (name: string, maps: string[], videoIndex: number) => runMedia(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-i", join(root, "mixed.mp4"), "-i", join(root, "still.png"),
      ...maps, "-map", "1:v:0", "-c", "copy", "-disposition:v:" + videoIndex, "attached_pic", join(root, name),
    ], { timeout: 15_000, windowsHide: true });
    await attachCover("cover-only.mp4", ["-map", "0:a:0"], 0);
    await attachCover("mixed-cover.mp4", ["-map", "0:v:0", "-map", "0:a:0"], 1);
    await writeFile(join(root, "invalid.png"), "synthetic invalid PNG");
    await writeFile(join(root, "oversize.mp4"), "");
    await truncate(join(root, "oversize.mp4"), referenceFileByteLimit + 1);
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!root) return;
    await Promise.all(files.map(name => rm(join(root, name), { force: true })));
    await rmdir(root);
  });

  async function inspect(name: string, presentedName = name) {
    const path = join(root, name);
    return inspectLocalReferenceFile(path, {
      kind: "file", name: presentedName, permission: "synthetic", sizeBytes: (await stat(path)).size,
    }, { managedRoot: root });
  }

  it.each([
    ["clip.mp4", "video", "file-type+ffprobe", { mime: "video/mp4", width: 32, height: 24, durationMs: 500 }],
    ["music.wav", "music", "file-type+ffprobe", { mime: "audio/wav", width: null, height: null, durationMs: 500 }],
    ["still.png", "image", "file-type+sharp", { mime: "image/png", width: 12, height: 8, durationMs: null }],
  ])("records actual file facts separately for %s", async (name, media, tool, values) => {
    const result = await inspect(name);
    expect(result.input).toMatchObject({ status: "ready", source: { kind: "file", name, media, permission: "synthetic" } });
    expect(result.inspection).toBe("completed");
    expect(result.findings).toMatchObject([{ id: "file-metadata", kind: "file_metadata", location: { kind: "whole" },
      tool, values, observedBytes: (await stat(join(root, name))).size }]);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(referenceAnalysisResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  }, 35_000);

  it("regresses the observed 500ms video plus 1500ms audio/container MP4", async () => {
    const actual = await runMedia(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,duration:format=duration",
      "-of", "json", join(root, "mixed.mp4")], { timeout: 10_000, windowsHide: true });
    expect(JSON.parse(actual.stdout)).toMatchObject({
      streams: [{ codec_type: "video", duration: "0.500000" }, { codec_type: "audio", duration: "1.500000" }],
      format: { duration: "1.500000" },
    });
    const result = await inspect("mixed.mp4");
    expect(result.inspection).toBe("completed");
    expect(result.findings[0]).toMatchObject({
      timeline: { containerDurationMs: 1_500, tracks: [
        { kind: "video", startMs: 0, endMs: 500 }, { kind: "audio", startMs: 0, endMs: 1_500 },
      ] },
      values: { durationMs: 1_500 },
    });
    const finding = { id: "cut", kind: "observation", text: "synthetic frame",
      location: { kind: "time", startMs: 490, endMs: 500 } } as const;
    expect(createReferenceAnalysisResult(result.input, [...result.findings, finding], "completed")).toBeDefined();
    expect(() => createReferenceAnalysisResult(result.input, [
      ...result.findings, { ...finding, location: { kind: "time", startMs: 900, endMs: 1_000 } },
    ], "completed")).toThrow();
  });

  async function streamDispositions(name: string) {
    const { stdout } = await runMedia(ffprobe, [
      "-v", "error", "-show_entries",
      "stream=codec_type,width,height,duration:stream_disposition=attached_pic:format=duration",
      "-of", "json", join(root, name),
    ], { timeout: 10_000, windowsHide: true });
    return JSON.parse(stdout) as { streams: unknown[]; format: { duration: string } };
  }

  it("rejects audio plus an attached cover as a video, with no owner or shared seek point", async () => {
    expect(await streamDispositions("cover-only.mp4")).toMatchObject({
      format: { duration: "1.500000" },
      streams: [
        { codec_type: "audio", duration: "1.500000" },
        { codec_type: "video", width: 12, height: 8, disposition: { attached_pic: 1 } },
      ],
    });
    const result = await inspect("cover-only.mp4");
    expect(result).toMatchObject({ inspection: "invalid_file", input: { status: "invalid", reason: "invalid_file" }, findings: [] });
    expect(() => createReferenceAnalysisResult(result.input, [{
      id: "cover", kind: "observation", location: { kind: "time", startMs: 900, endMs: 1_000 }, text: "cover",
    }], "invalid_file")).toThrow();
    const owned = createPrivateReferenceResult(actor, result);
    expect(projectReferenceOwnerScreen(owned, actor).findings).toEqual([]);
    expect(() => projectReferenceShareSummary(owned, actor, ["cover"])).toThrow("REFERENCE_SHARE_SELECTION_REQUIRED");
  });

  it("keeps the actual video window and dimensions with an attached cover", async () => {
    expect(await streamDispositions("mixed-cover.mp4")).toMatchObject({
      format: { duration: "1.500000" },
      streams: [
        { codec_type: "video", width: 32, height: 24, duration: "0.500000", disposition: { attached_pic: 0 } },
        { codec_type: "audio", duration: "1.500000" },
        { codec_type: "video", width: 12, height: 8, disposition: { attached_pic: 1 } },
      ],
    });
    const result = await inspect("mixed-cover.mp4");
    expect(result.inspection).toBe("completed");
    expect(result.findings[0]).toMatchObject({
      values: { width: 32, height: 24 },
      timeline: { containerDurationMs: 1_500, tracks: [
        { kind: "video", startMs: 0, endMs: 500 }, { kind: "audio", startMs: 0, endMs: 1_500 },
      ] },
    });
    const interval = { kind: "time", startMs: 490, endMs: 500 } as const;
    const observation = { id: "frame", kind: "observation", location: interval, text: "synthetic frame" } as const;
    const withFinding = createReferenceAnalysisResult(result.input, [...result.findings, observation], "completed");
    const owned = createPrivateReferenceResult(actor, withFinding);
    expect(projectReferenceOwnerScreen(owned, actor).findings[1]).toMatchObject({ seekable: true, location: interval });
    expect(projectReferenceShareSummary(owned, actor, ["frame"]).findings).toEqual([{ kind: "observation", location: interval }]);
    expect(() => createReferenceAnalysisResult(result.input, [
      ...result.findings, { ...observation, location: { kind: "time", startMs: 900, endMs: 1_000 } },
    ], "completed")).toThrow();
  });

  it.each([undefined, { attached_pic: "0" }, { attached_pic: 2 }])(
    "fails a video probe with an unverified disposition %j", async disposition => {
      const actual = tools.runMedia;
      const fakeOutput = JSON.stringify({
        streams: [{ codec_type: "video", width: 32, height: 24, start_time: "0.000000", duration: "0.500000", disposition }],
        format: { start_time: "0.000000", duration: "0.500000" },
      });
      const probe = vi.spyOn(tools, "runMedia").mockImplementationOnce((_binary, _args, options) =>
        actual(process.execPath, ["-e", "process.stdout.write(process.argv[1])", fakeOutput], options));
      try {
        expect(await inspect("clip.mp4")).toMatchObject({
          inspection: "local_tool_failed", findings: [{ kind: "unavailable", reason: "local_tool_failed" }],
        });
      } finally { probe.mockRestore(); }
    },
  );

  it("keeps corrupt content, an actual type mismatch and an unavailable tool distinct", async () => {
    expect(await inspect("invalid.png")).toMatchObject({ input: { status: "invalid", reason: "invalid_file" }, findings: [] });
    expect(await inspect("still.png", "renamed.mp4")).toMatchObject({
      input: { status: "invalid", reason: "file_type_mismatch" }, findings: [],
    });
    const configured = process.env.FFPROBE_PATH;
    vi.stubEnv("FFPROBE_PATH", join(root, "missing-ffprobe"));
    try {
      expect(await inspect("clip.mp4")).toMatchObject({
        input: { status: "ready" },
        inspection: "local_tool_unavailable",
        findings: [{ kind: "unavailable", subject: "file_metadata", reason: "local_tool_unavailable" }],
      });
    } finally { vi.stubEnv("FFPROBE_PATH", configured); }
  });

  it("bounds actual managed bytes and rejects an out-of-root path", async () => {
    const submission = { kind: "file", name: "oversize.mp4", permission: "synthetic", sizeBytes: 32 };
    expect(await inspectLocalReferenceFile(join(root, "oversize.mp4"), submission, { managedRoot: root })).toMatchObject({
      input: { status: "invalid", reason: "file_too_large" },
    });
    expect(await inspectLocalReferenceFile(join(root, "oversize.mp4"), submission, { managedRoot: join(root, "other") })).toMatchObject({
      input: { status: "invalid", reason: "invalid_file" },
    });
  });

  it.each(["cancelled", "timed_out", "local_tool_failed"] as const)("separates %s and waits until the child closes", async status => {
    const actual = tools.runMedia;
    const started = Promise.withResolvers<void>();
    let closed = false;
    const probe = vi.spyOn(tools, "runMedia").mockImplementationOnce((_binary, _args, options) => {
      const child = actual(process.execPath, ["-e", status === "local_tool_failed" ? "process.exit(2)" : "setInterval(() => {}, 100)"], options);
      child.child.once("close", () => { closed = true; });
      started.resolve();
      return child;
    });
    const abort = new AbortController();
    const path = join(root, "clip.mp4");
    try {
      const ongoing = inspectLocalReferenceFile(path, {
        kind: "file", name: "clip.mp4", permission: "synthetic", sizeBytes: (await stat(path)).size,
      }, { managedRoot: root, signal: abort.signal, timeoutMs: status === "timed_out" ? 500 : 5_000 });
      if (status === "cancelled") {
        await started.promise;
        abort.abort();
      }
      const result = await ongoing;
      expect(result.inspection).toBe(status);
      expect(result.findings[0]).toMatchObject({ kind: "unavailable", reason: status });
      expect(closed).toBe(true);
    } finally { probe.mockRestore(); }
  });
});
