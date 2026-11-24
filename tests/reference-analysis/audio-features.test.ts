import { access, mkdtemp, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as tools from "../../lib/media/tools";
import { analyzeLocalReferenceAudio } from "../../lib/reference-analysis/audio-features";

vi.mock("server-only", () => ({}));

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("managed local audio REA windows and tempo", () => {
  let root: string;
  let ffmpeg: string;
  const names = ["quiet.m4a", "regular.m4a", "irregular.m4a", "unaligned.wav", "long.m4a", "double.m4a", "opposite.m4a", "in-phase.m4a", "stereo-quiet.m4a", "surround-long.m4a"];
  beforeAll(async () => {
    const suffix = process.platform === "win32" ? ".exe" : "";
    ffmpeg = join(tools.mediaToolsFolder(), "ffmpeg" + suffix);
    const ffprobe = join(tools.mediaToolsFolder(), "ffprobe" + suffix);
    await Promise.all([access(ffmpeg), access(ffprobe)]);
    vi.stubEnv("FFMPEG_PATH", ffmpeg);
    vi.stubEnv("FFPROBE_PATH", ffprobe);
    root = await mkdtemp(join(tmpdir(), "dream-rea-audio-"));
    const generate = (name: string, input: string, duration: number, codec = "aac") => tools.runMedia(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", input,
      "-t", String(duration), "-c:a", codec, join(root, name),
    ], { timeout: 15_000, windowsHide: true });
    await generate("quiet.m4a", "anullsrc=r=8000:cl=mono", 3);
    await generate("regular.m4a", "aevalsrc='if(lt(mod(t,0.5),0.08),0.7*sin(2*PI*440*t),0)':s=8000", 4);
    const pulses = [0.2, 0.55, 1.3, 1.65, 2.55, 3.1].map(time => `between(t,${time},${time + 0.08})`).join("+");
    await generate("irregular.m4a", `aevalsrc='(${pulses})*0.7*sin(2*PI*440*t)':s=8000`, 4);
    await generate("unaligned.wav", "anullsrc=r=8000:cl=mono", 1, "pcm_s16le");
    const tone = "0.5*sin(2*PI*440*t)";
    await generate("opposite.m4a", `aevalsrc='${tone}|-${tone}':s=8000:c=stereo`, 2, "alac");
    await generate("in-phase.m4a", `aevalsrc='${tone}|${tone}':s=8000:c=stereo`, 2, "alac");
    await generate("stereo-quiet.m4a", "anullsrc=r=8000:cl=stereo", 2, "alac");
    await generate("surround-long.m4a", "anullsrc=r=8000:cl=5.1", 12, "alac");
    await generate("long.m4a", "anullsrc=r=8000:cl=mono", 25);
    await tools.runMedia(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-i", join(root, "regular.m4a"),
      "-map", "0:a:0", "-map", "0:a:0", "-c", "copy", join(root, "double.m4a"),
    ], { timeout: 15_000, windowsHide: true });
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!root) return;
    await Promise.all(names.map(name => rm(join(root, name), { force: true })));
    await rmdir(root);
  });

  async function analyze(name: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const path = join(root, name);
    return analyzeLocalReferenceAudio(path, {
      kind: "file", name, sizeBytes: (await stat(path)).size, permission: "synthetic",
    }, { managedRoot: root, ...options });
  }

  it("observes silent PCM without manufacturing a tempo", async () => {
    const result = await analyze("quiet.m4a");
    expect(result.audio).toMatchObject({
      status: "completed", coverage: { trackStartMs: 0, trackEndMs: 3_000, firstSampleMs: 0, endSampleMs: 3_000, samplesRead: 24_000 },
      segments: [{ startMs: 0, endMs: 3_000, level: "quiet" }],
      tempo: { status: "unverified", reason: "quiet_signal" },
    });
    expect(result.inspection.findings.map(item => item.kind)).toEqual(["file_metadata", "observation", "unavailable"]);
  });

  it.each(["opposite.m4a", "in-phase.m4a"])("measures stereo energy in %s", async name => {
    const { audio, inspection } = await analyze(name);
    expect(audio).toMatchObject({
      status: "completed", coverage: { channels: 2, samplesRead: 16_000 },
      settings: { rmsUnit: "normalized_full_scale", channelAggregation: "mean_square_across_channels" },
      segments: [{ startMs: 0, endMs: 2_000, level: "signal" }],
      tempo: { status: "unverified", reason: "insufficient_onsets" },
    });
    if (audio.status !== "completed") throw new Error("Missing PCM observation");
    expect(audio.windows).toHaveLength(40);
    for (const window of audio.windows) expect(window.rms).toBeCloseTo(0.353553, 5);
    expect(inspection.findings).toContainEqual(expect.objectContaining({
      id: "audio-rms", text: "Normalized full-scale RMS across 2 channel(s) in 40 PCM windows",
    }));
  });

  it("preserves genuine stereo silence", async () => {
    const { audio } = await analyze("stereo-quiet.m4a");
    expect(audio).toMatchObject({
      status: "completed", coverage: { channels: 2, samplesRead: 16_000 },
      segments: [{ startMs: 0, endMs: 2_000, level: "quiet" }],
      tempo: { status: "unverified", reason: "quiet_signal" },
    });
    if (audio.status !== "completed") throw new Error("Missing PCM observation");
    expect(audio.windows.every(window => window.rms === 0)).toBe(true);
  });

  it("estimates 120 BPM with contiguous PCM and separately recorded onset evidence", async () => {
    const result = await analyze("regular.m4a");
    expect(result.audio).toMatchObject({
      status: "completed", coverage: { trackStartMs: 0, trackEndMs: 4_000, firstSampleMs: 0, endSampleMs: 4_000, samplesRead: 32_000 },
      tempo: { status: "estimated", bpm: 120, medianIntervalMs: 500, onsetTimesMs: [0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500] },
    });
    expect(result.inspection.findings).toContainEqual(expect.objectContaining({
      kind: "inference", evidenceIds: ["audio-onsets"], text: "Estimated 120 BPM",
    }));
    expect(JSON.stringify(result)).not.toMatch(/dream-rea-inspect|"pcm":/);
  });

  it("keeps measured irregular segments while withholding a BPM estimate", async () => {
    const result = await analyze("irregular.m4a");
    expect(result.audio).toMatchObject({
      status: "completed", tempo: { status: "unverified", reason: "irregular_intervals" },
    });
    expect(result.inspection.findings).toContainEqual(expect.objectContaining({
      kind: "unavailable", subject: "BPM", reason: "missing_evidence",
    }));
  });

  it("does not manufacture a track origin and rejects over-budget media", async () => {
    expect((await analyze("unaligned.wav")).audio).toEqual({ status: "track_unverified" });
    expect((await analyze("double.m4a")).audio).toEqual({ status: "track_unverified" });
    expect((await analyze("surround-long.m4a")).audio).toEqual({ status: "analysis_limit" });
    const long = await analyze("long.m4a");
    expect(long.audio).toEqual({ status: "analysis_limit" });
    expect(long.inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
  });

  it("does not publish noncontiguous PCM timing", async () => {
    const actual = tools.runMedia;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (basename(args[0]) !== basename(ffmpeg)) return actual(...args);
      const lines = [
        "[Parsed_ashowinfo_3 @ 000] n:0 pts:0 pts_time:0 channels:1 rate:8000 nb_samples:400",
        "[Parsed_ashowinfo_3 @ 000] n:1 pts:801 pts_time:0.100125 channels:1 rate:8000 nb_samples:400",
      ];
      return actual(process.execPath, ["-e", "process.stderr.write(process.argv[1]); process.stdout.write(Buffer.alloc(1600))", lines.join("\n")], args[2]);
    });
    try {
      const result = await analyze("regular.m4a");
      expect(result.audio).toEqual({ status: "sample_timing_unverified" });
      expect(result.inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
    } finally { spy.mockRestore(); }
  });

  it.each(["cancelled", "timed_out"] as const)("waits for decoder close and removes the snapshot after %s", async status => {
    const actual = tools.runMedia;
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    let snapshot: string | undefined;
    let closed = false;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (basename(args[0]) !== basename(ffmpeg)) return actual(...args);
      snapshot = args[1]?.[args[1].indexOf("-i") + 1];
      const child = actual(process.execPath, ["-e", "setInterval(() => {}, 100)"], args[2]);
      child.child.once("close", () => { closed = true; });
      started.resolve();
      return child;
    });
    try {
      const pending = analyze("regular.m4a", { signal: controller.signal, timeoutMs: status === "timed_out" ? 800 : 5_000 });
      if (status === "cancelled") {
        await started.promise;
        controller.abort();
      }
      const result = await pending;
      expect(result.audio).toEqual({ status });
      expect(result.inspection.findings).toMatchObject([{ kind: "unavailable", reason: status }]);
      expect(closed).toBe(true);
      await expect(access(dirname(snapshot!))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { spy.mockRestore(); }
  });
});
