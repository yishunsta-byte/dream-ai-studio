import "server-only";
import { mediaBinary, runMedia } from "../media/tools";
import { inspectLocalReferenceFile, type ReferenceFileOptions, type ReferenceMediaSnapshot } from "./local-file";
import type { ReferenceAnalysisResult, ReferenceFinding } from "./result";

const settings = Object.freeze({
  sampleRate: 8_000,
  windowMs: 50,
  quietBelow: 0.01,
  onsetPeakRatio: 0.35,
  onsetFloor: 0.02,
  minOnsets: 5,
  minBeatIntervalMs: 300,
  maxBeatIntervalMs: 1_000,
  maxDurationMs: 24_000,
  maxChannels: 8,
  rmsUnit: "normalized_full_scale",
  channelAggregation: "mean_square_across_channels",
});
const maxOutputBytes = 1024 * 1024;
const samplesPerMs = settings.sampleRate / 1_000;

type AudioWindow = { startMs: number; endMs: number; rms: number };
type AudioSegment = { startMs: number; endMs: number; level: "quiet" | "signal" };
type Tempo =
  | { status: "estimated"; bpm: number; onsetTimesMs: number[]; medianIntervalMs: number; maxDeviationMs: number; thresholdRms: number }
  | { status: "unverified"; reason: "quiet_signal" | "insufficient_onsets" | "outside_range" | "irregular_intervals" };
type AudioFeatures =
  | {
    status: "completed";
    settings: typeof settings;
    coverage: { trackStartMs: number; trackEndMs: number; firstSampleMs: number; endSampleMs: number; samplesRead: number; channels: number };
    windows: AudioWindow[];
    segments: AudioSegment[];
    tempo: Tempo;
  }
  | { status: "not_analyzed" | "track_unverified" | "sample_timing_unverified" | "analysis_limit" |
    "local_tool_unavailable" | "local_tool_failed" | "cancelled" | "timed_out" };

function observedSampleStart(stderr: string, samples: number, channels: number,
  track: NonNullable<ReferenceMediaSnapshot["track"]>, expectedPcmSamples?: number) {
  const lines = [...stderr.matchAll(
    /^\[Parsed_ashowinfo_\d+ @ [^\]\r\n]+\][ \t]+n:\s*(\d+)\s+pts:\s*(-?\d+)[^\r\n]*\bchannels:\s*(\d+)[^\r\n]*\brate:\s*(\d+)\s+nb_samples:\s*(\d+)/gm,
  )];
  if (!lines.length) return;
  const first = Number(lines[0][2]);
  let next = first;
  for (const [index, [, ordinal, pts, channelCount, rate, length]] of lines.entries()) {
    const count = Number(length);
    if (Number(ordinal) !== index || Number(channelCount) !== channels || Number(rate) !== settings.sampleRate ||
      !Number.isSafeInteger(next) || Number(pts) !== next || !Number.isSafeInteger(count) || count < 1) return;
    next += count;
  }
  if (next - first !== samples) return;
  if (expectedPcmSamples !== undefined) {
    // Resampling a whole PCM track can round a fractional output frame in either direction.
    if (first !== 0 || samples < Math.floor(expectedPcmSamples) || samples > Math.ceil(expectedPcmSamples)) return;
  } else if (first < track.startMs * samplesPerMs || next > track.endMs * samplesPerMs) return;
  return first;
}

function rmsWindows(pcm: Buffer, start: number, channels: number, trackEndMs: number): AudioWindow[] {
  const windows: AudioWindow[] = [];
  const samples = pcm.length / (2 * channels);
  const windowSamples = settings.windowMs * samplesPerMs;
  for (let offset = 0; offset < samples; offset += windowSamples) {
    const end = Math.min(samples, offset + windowSamples);
    let squares = 0;
    for (let index = offset * channels; index < end * channels; index++) squares += (pcm.readInt16LE(index * 2) / 32_768) ** 2;
    const startMs = Math.round((start + offset) / samplesPerMs);
    const endMs = Math.min(trackEndMs, Math.round((start + end) / samplesPerMs));
    if (endMs > startMs) windows.push({ startMs, endMs, rms: Number(Math.sqrt(squares / ((end - offset) * channels)).toFixed(6)) });
  }
  return windows;
}

function groupSegments(windows: readonly AudioWindow[]): AudioSegment[] {
  const segments: AudioSegment[] = [];
  for (const window of windows) {
    const level = window.rms < settings.quietBelow ? "quiet" : "signal";
    const last = segments.at(-1);
    if (last?.level === level) last.endMs = window.endMs;
    else segments.push({ startMs: window.startMs, endMs: window.endMs, level });
  }
  return segments;
}

function estimateTempo(windows: readonly AudioWindow[]): Tempo {
  const peak = Math.max(...windows.map(window => window.rms));
  if (peak < settings.onsetFloor) return { status: "unverified", reason: "quiet_signal" };
  const thresholdRms = Number(Math.max(settings.onsetFloor, peak * settings.onsetPeakRatio).toFixed(6));
  const onsetTimesMs = windows
    .filter((window, index) => window.rms >= thresholdRms && (index === 0 || windows[index - 1].rms < thresholdRms))
    .map(window => window.startMs);
  if (onsetTimesMs.length < settings.minOnsets) return { status: "unverified", reason: "insufficient_onsets" };
  const gaps = onsetTimesMs.slice(1).map((time, index) => time - onsetTimesMs[index]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianIntervalMs = (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
  if (medianIntervalMs < settings.minBeatIntervalMs || medianIntervalMs > settings.maxBeatIntervalMs) {
    return { status: "unverified", reason: "outside_range" };
  }
  const maxDeviationMs = Math.max(...gaps.map(gap => Math.abs(gap - medianIntervalMs)));
  if (maxDeviationMs > Math.max(settings.windowMs, medianIntervalMs * 0.1)) {
    return { status: "unverified", reason: "irregular_intervals" };
  }
  return { status: "estimated", bpm: Math.round(60_000 / medianIntervalMs), onsetTimesMs, medianIntervalMs, maxDeviationMs, thresholdRms };
}

async function readAudio(snapshot: ReferenceMediaSnapshot): Promise<AudioFeatures> {
  const { track, signal, channels } = snapshot;
  if (!track || channels === undefined || !Number.isSafeInteger(track.endMs * samplesPerMs)) return { status: "track_unverified" };
  const expectedPcmSamples = track.pcm ? track.pcm.frames * settings.sampleRate / track.pcm.sampleRate : undefined;
  const durationMs = expectedPcmSamples === undefined ? track.endMs - track.startMs : expectedPcmSamples / samplesPerMs;
  if (channels > settings.maxChannels || durationMs > settings.maxDurationMs ||
    Math.ceil(expectedPcmSamples ?? durationMs * samplesPerMs) * channels * 2 > maxOutputBytes) return { status: "analysis_limit" };
  signal.throwIfAborted();
  const filters = [
    `aformat=sample_fmts=s16:sample_rates=${settings.sampleRate}`,
    `asettb=expr=1/${settings.sampleRate}`,
    ...(track.pcm ? [] : [`atrim=start=${track.startMs / 1_000}:end=${track.endMs / 1_000}`]),
    "ashowinfo",
  ];
  const read = runMedia(mediaBinary("ffmpeg"), [
    "-hide_banner", "-nostdin", "-v", "info", "-xerror", "-protocol_whitelist", "file,pipe",
    "-threads", "1", "-filter_threads", "1", "-copyts", "-start_at_zero", "-i", snapshot.path,
    "-map", "0:" + track.streamIndex, "-vn", "-sn", "-dn", "-af", filters.join(","),
    "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
  ], { signal, encoding: "buffer", windowsHide: true, maxBuffer: maxOutputBytes });
  const closed = new Promise<void>(resolve => read.child.once("close", () => resolve()));
  let output: Awaited<typeof read>;
  try {
    output = await read;
  } catch (error) {
    const { code } = error as { code?: string };
    if (code === "ENOENT") return { status: "local_tool_unavailable" };
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { status: "analysis_limit" };
    return { status: "local_tool_failed" };
  } finally {
    await closed;
    signal.throwIfAborted();
  }

  const samplesRead = output.stdout.length / (2 * channels);
  if (!Number.isInteger(samplesRead) || samplesRead < samplesPerMs) return { status: "local_tool_failed" };
  if (samplesRead > settings.maxDurationMs * samplesPerMs) return { status: "analysis_limit" };
  const first = observedSampleStart(output.stderr.toString("utf8"), samplesRead, channels, track, expectedPcmSamples);
  if (first === undefined) return { status: "sample_timing_unverified" };
  const windows = rmsWindows(output.stdout, first, channels, track.endMs);
  return {
    status: "completed", settings, windows, segments: groupSegments(windows), tempo: estimateTempo(windows),
    coverage: {
      trackStartMs: track.startMs, trackEndMs: track.endMs, samplesRead, channels,
      firstSampleMs: Math.round(first / samplesPerMs), endSampleMs: Math.min(track.endMs, Math.round((first + samplesRead) / samplesPerMs)),
    },
  };
}

function featureFindings(audio: AudioFeatures): ReferenceFinding[] {
  if (audio.status !== "completed") return [];
  const location = { kind: "time", startMs: audio.coverage.firstSampleMs, endMs: audio.coverage.endSampleMs } as const;
  const observed: ReferenceFinding = {
    id: "audio-rms", kind: "observation", location, text: `Normalized full-scale RMS across ${audio.coverage.channels} channel(s) in ${audio.windows.length} PCM windows`,
  };
  if (audio.tempo.status !== "estimated") {
    return [observed, { id: "audio-tempo", kind: "unavailable", location, subject: "BPM", reason: "missing_evidence" }];
  }
  return [
    observed,
    { id: "audio-onsets", kind: "observation", location,
      text: `${audio.tempo.onsetTimesMs.length} energy rises with median interval ${audio.tempo.medianIntervalMs} ms` },
    { id: "audio-tempo", kind: "inference", location, evidenceIds: ["audio-onsets"], text: `Estimated ${audio.tempo.bpm} BPM` },
  ];
}

/** Analyze a confirmed, owner-bound snapshot. Raw PCM remains inside the unit. */
export async function analyzeLocalReferenceAudio(
  path: string, submission: unknown, options: ReferenceFileOptions,
): Promise<{ inspection: ReferenceAnalysisResult; audio: AudioFeatures }> {
  let audio: AudioFeatures = { status: "not_analyzed" };
  const inspection = await inspectLocalReferenceFile(path, submission, options, { music: async snapshot => {
    audio = await readAudio(snapshot);
    return featureFindings(audio);
  } });
  if (inspection.inspection !== "completed") {
    const { inspection: state } = inspection;
    audio = { status: state === "cancelled" || state === "timed_out" || state === "local_tool_unavailable" ||
      state === "local_tool_failed" ? state : "not_analyzed" };
  }
  return { inspection, audio };
}
