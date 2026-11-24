import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as tools from "../../lib/media/tools";
import { analyzeLocalReferenceAudio } from "../../lib/reference-analysis/audio-features";
import { analyzeRegisteredReferenceSnapshot } from "../../lib/reference-analysis/registered-snapshot";
import { inspectPcmWav } from "../../lib/services/postgres/pcm-wav";

vi.mock("server-only", () => ({}));

const samples = [
  { name: "registered-mono.wav", channels: 1, rate: 8000, frames: 1000, levels: [8192, 0, -4096] },
  { name: "registered-stereo.wav", channels: 2, rate: 48000, frames: 6000, levels: [8192, 8192, 8192] },
  { name: "registered-fractional.wav", channels: 1, rate: 44100, frames: 5534, levels: [8192, 8192, 8192] },
] as const;
type Sample = (typeof samples)[number];
const invalidWavs = ["registered-truncated.wav", "registered-unaligned.wav", "registered-byte-rate.wav"] as const;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function makePcm({ channels, rate, frames, levels }: Sample) {
  const width = channels * 2;
  const bytes = Buffer.alloc(44 + frames * width);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * width, 28);
  bytes.writeUInt16LE(width, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * width, 40);
  for (let frame = 0; frame < frames; frame++) {
    const offset = 44 + frame * width;
    const window = Math.min(2, Math.floor(frame / (rate / 20)));
    bytes.writeInt16LE(levels[window], offset);
    if (channels === 2) bytes.writeInt16LE(-levels[window], offset + 2);
  }
  return bytes;
}

type Probe = {
  streams: { index: number; codec_name: string; codec_type: string; channels: number; sample_rate: string;
    start_time?: string; duration_ts: number; time_base: string; duration: string }[];
  format: { format_name: string; start_time?: string; duration: string };
};

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("registered PCM WAV file-relative timing", () => {
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
    root = await realpath(await mkdtemp(join(tmpdir(), "dream-rea-registered-pcm-")));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!root) return;
    const names = [...samples.map(({ name }) => name), ...invalidWavs, "registered-wrong-hash.wav",
      "registered-extra-chunk.wav", "registered-mismatch.wav", "registered-legacy.mp3"];
    await Promise.all(names.map(name => rm(join(root, name), { force: true })));
    await rmdir(root);
  });

  it.each(samples)("proves unmodified native timing and exact PCM frames for $name", async sample => {
    const bytes = makePcm(sample);
    const path = join(root, sample.name);
    await writeFile(path, bytes, { flag: "wx" });
    const frames = sample.frames;
    const duration = (frames / sample.rate).toFixed(6);
    const durationMs = Math.round(frames * 1000 / sample.rate);
    expect(inspectPcmWav(bytes)).toEqual({ frames, channels: sample.channels, sampleRate: sample.rate });
    const proof = { sha256: digest(bytes), sourceGeneration: "fixture-pcm-generation-1" };
    const submission = { kind: "file", name: sample.name, sizeBytes: bytes.length, permission: "synthetic", mime: "audio/wav" };
    const natural = await analyzeLocalReferenceAudio(path, submission, { managedRoot: root });
    expect(natural.inspection.inspection).toBe("completed");
    expect(natural.audio).toEqual({ status: "track_unverified" });

    const probe = JSON.parse((await tools.runMedia(ffprobe, [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", path,
    ], { timeout: 5000, windowsHide: true })).stdout) as Probe;
    expect(probe.streams).toHaveLength(1);
    expect(probe.streams[0]).toMatchObject({ index: 0, codec_type: "audio", codec_name: "pcm_s16le", channels: sample.channels,
      sample_rate: String(sample.rate), time_base: "1/" + sample.rate, duration_ts: frames, duration });
    expect(probe.format).toMatchObject({ format_name: "wav", duration });
    expect(probe.streams[0].start_time).toBeUndefined();
    expect(probe.format.start_time).toBeUndefined();

    const decoded = await tools.runMedia(ffmpeg, [
      "-v", "error", "-nostdin", "-xerror", "-protocol_whitelist", "file,pipe", "-i", path,
      "-map", "0:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
    ], { timeout: 5000, windowsHide: true, encoding: "buffer" });
    expect(decoded.stdout.equals(bytes.subarray(44))).toBe(true);

    const actual = tools.runMedia;
    const managedCopies = new Set<string>();
    const observe = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (args[0] === ffprobe && args[1]?.at(-1)) managedCopies.add(args[1].at(-1)!);
      return actual(...args);
    });
    try {
      const bound = await analyzeRegisteredReferenceSnapshot(path, submission, proof, { managedRoot: root });
      expect(bound).toMatchObject({ status: "bound", proof: { snapshotSha256: proof.sha256, sourceGeneration: proof.sourceGeneration } });
      if (bound.status !== "bound" || bound.analysis.media !== "music") throw new Error("No music analysis");
      const audio = bound.analysis.audio;
      expect(audio.status).toBe("completed");
      if (audio.status !== "completed") throw new Error("No verified samples");
      expect(audio.coverage).toEqual({ trackStartMs: 0, firstSampleMs: 0, trackEndMs: durationMs, endSampleMs: durationMs,
        samplesRead: Math.ceil(frames * 8000 / sample.rate), channels: sample.channels });
      expect(audio.windows.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0, 50], [50, 100], [100, durationMs]]);
      for (const [index, { rms }] of audio.windows.entries()) expect(rms).toBeCloseTo(Math.abs(sample.levels[index]) / 32768, 4);
      expect(managedCopies.size).toBe(1);
      for (const copy of managedCopies) await expect(access(copy)).rejects.toMatchObject({ code: "ENOENT" });
      expect(digest(await readFile(path))).toBe(proof.sha256);
    } finally { observe.mockRestore(); }
  });

  it("rejects malformed registration and detects a mismatched copy before ffprobe", async () => {
    const sample = samples[1];
    const original = makePcm(sample);
    const truncated = Buffer.from(original.subarray(0, -2));
    truncated.writeUInt32LE(truncated.length - 8, 4);
    const misaligned = Buffer.from(original);
    misaligned.writeUInt32LE(misaligned.length - 45, 40);
    const mismatchedRate = Buffer.from(original);
    mismatchedRate.writeUInt32LE(sample.rate * 2, 28);
    for (const [index, bytes] of [truncated, misaligned, mismatchedRate].entries()) {
      expect(inspectPcmWav(bytes)).toBeNull();
      const name = invalidWavs[index];
      const path = join(root, name);
      await writeFile(path, bytes, { flag: "wx" });
      const result = await analyzeRegisteredReferenceSnapshot(path, { kind: "file", name, sizeBytes: bytes.length,
        permission: "synthetic", mime: "audio/wav" }, { sha256: digest(bytes), sourceGeneration: "fixture-malformed" },
      { managedRoot: root });
      expect(result).toEqual({ status: "unavailable", reason: "unverified_analysis" });
    }

    const name = "registered-wrong-hash.wav";
    const path = join(root, name);
    await writeFile(path, original, { flag: "wx" });
    const wrongDigest = { sha256: "a".repeat(64), sourceGeneration: "fixture-incorrect-hash" };
    const spy = vi.spyOn(tools, "runMedia");
    try {
      const value = await analyzeLocalReferenceAudio(path, { kind: "file", name,
        sizeBytes: original.length, permission: "synthetic", mime: "audio/wav" },
      { managedRoot: root, registration: wrongDigest });
      expect(value.inspection.inspection).toBe("invalid_file");
      expect(value.audio.status).toBe("not_analyzed");
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("rejects zero-based timing for a registered WAV with extra chunks", async () => {
    const original = makePcm(samples[0]);
    const extra = Buffer.from([0x4a, 0x55, 0x4e, 0x4b, 4, 0, 0, 0, 0, 0, 0, 0]);
    const extended = Buffer.concat([original.subarray(0, 36), extra, original.subarray(36)]);
    extended.writeUInt32LE(extended.length - 8, 4);
    expect(extended.toString("ascii", 36, 40)).toBe("JUNK");
    expect(inspectPcmWav(extended)).toEqual(inspectPcmWav(original));
    const name = "registered-extra-chunk.wav";
    const path = join(root, name);
    await writeFile(path, extended, { flag: "wx" });
    const result = await analyzeLocalReferenceAudio(path, { kind: "file", name, sizeBytes: extended.length,
      permission: "synthetic", mime: "audio/wav" },
    { managedRoot: root, registration: { sha256: digest(extended), sourceGeneration: "fixture-extra-chunk" } });
    expect(result.inspection.inspection).toBe("completed");
    expect(result.audio).toEqual({ status: "track_unverified" });
  });

  it("does not substitute timing when the verified bytes conflict with probe frames or timestamps", async () => {
    const bytes = makePcm(samples[0]);
    const name = "registered-mismatch.wav";
    const path = join(root, name);
    await writeFile(path, bytes, { flag: "wx" });
    const submission = { kind: "file", name, sizeBytes: bytes.length, permission: "synthetic", mime: "audio/wav" };
    const options = { managedRoot: root, registration: { sha256: digest(bytes), sourceGeneration: "fixture-probe-conflict" } };
    const actual = tools.runMedia;
    for (const change of [
      (probe: Probe) => { probe.streams[0].duration_ts++; },
      (probe: Probe) => { probe.streams[0].sample_rate = "16000"; },
      (probe: Probe) => { probe.streams[0].start_time = "0.001000"; },
    ]) {
      const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
        const run = actual(...args);
        if (args[0] !== ffprobe) return run;
        return Object.assign(run.then(output => {
          const result = JSON.parse(output.stdout.toString()) as Probe;
          change(result);
          return { ...output, stdout: JSON.stringify(result) };
        }), { child: run.child });
      });
      try {
        const result = await analyzeLocalReferenceAudio(path, submission, options);
        expect(result.audio).toEqual({ status: "track_unverified" });
        expect(spy.mock.calls.every(([binary]) => binary === ffprobe)).toBe(true);
      } finally { spy.mockRestore(); }
    }
  });

  it("keeps the existing registered MP3 timing path", async () => {
    const name = "registered-legacy.mp3";
    const path = join(root, name);
    await tools.runMedia(ffmpeg, ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=400:sample_rate=44100",
      "-t", "2", "-c:a", "libmp3lame", path], { timeout: 5000, windowsHide: true });
    const bytes = await readFile(path);
    const spy = vi.spyOn(tools, "runMedia");
    try {
      const result = await analyzeRegisteredReferenceSnapshot(path, { kind: "file", name, sizeBytes: bytes.length,
        permission: "synthetic", mime: "audio/mpeg" }, { sha256: digest(bytes), sourceGeneration: "fixture-mp3" }, { managedRoot: root });
      expect(result).toMatchObject({ status: "bound", analysis: { media: "music", audio: { status: "completed" } } });
      expect(spy.mock.calls.find(([binary]) => binary === ffprobe)?.[1]?.join(" ")).not.toContain("duration_ts");
    } finally { spy.mockRestore(); }
  });
});
