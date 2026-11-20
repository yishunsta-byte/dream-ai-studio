import "server-only";
import { mediaBinary, runMedia } from "../media/tools";
import { inspectLocalReferenceFile, type ReferenceFileOptions, type ReferenceMediaSnapshot } from "./local-file";
import type { ReferenceAnalysisResult, ReferenceFinding } from "./result";

const settings = Object.freeze({
  method: "adjacent_rgb_mean_difference" as const,
  threshold: 0.22,
  width: 64,
  height: 36,
  maxDurationMs: 20_000,
  maxSourcePixels: 1920 * 1080,
  maxFrames: 240,
  maxCuts: 24,
});
const frameBytes = settings.width * settings.height * 3;

type RepresentativeFrame = {
  id: string;
  timeMs: number;
  format: "rgb24";
  width: number;
  height: number;
  /** A bounded server-only derivative. Do not serialize it into public REA DTOs. */
  pixels: Uint8Array;
};
type CutCandidate = { kind: "inference"; beforeMs: number; afterMs: number; difference: number; frameId: string };
type VideoFeatures =
  | {
    status: "completed";
    settings: typeof settings;
    coverage: { trackStartMs: number; trackEndMs: number; firstFrameMs: number; lastFrameMs: number; framesRead: number };
    cuts: CutCandidate[];
    frames: RepresentativeFrame[];
  }
  | { status: "not_analyzed" | "track_unverified" | "frame_timing_unverified" | "analysis_limit" |
      "local_tool_unavailable" | "local_tool_unsupported" | "local_tool_failed" | "cancelled" | "timed_out" };

function difference(before: Buffer, after: Buffer) {
  let sum = 0;
  for (let index = 0; index < frameBytes; index++) sum += Math.abs(before[index] - after[index]);
  return sum / (frameBytes * 255);
}

function observedTimes(stderr: string, count: number, track: NonNullable<ReferenceMediaSnapshot["track"]>) {
  const times = [...stderr.matchAll(/^\[Parsed_showinfo_\d+ @ [^\]\r\n]+\][ \t]+n:\s*(\d+)\s+pts:\s*\S+\s+pts_time:\s*(\S+)/gm)];
  if (times.length !== count) return;
  const ms = times.map(match => Math.round(Number(match[2]) * 1_000));
  if (times.some((match, index) => Number(match[1]) !== index || !Number.isSafeInteger(ms[index]) ||
    ms[index] < track.startMs || ms[index] >= track.endMs || (index > 0 && ms[index] <= ms[index - 1]))) return;
  return ms;
}

async function readVideo(snapshot: ReferenceMediaSnapshot): Promise<VideoFeatures> {
  const { track, signal, width, height } = snapshot;
  if (!track || width === null || height === null || !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) || width <= 0 || height <= 0) return { status: "track_unverified" };
  if (track.endMs - track.startMs > settings.maxDurationMs || width * height > settings.maxSourcePixels) {
    return { status: "analysis_limit" };
  }
  signal.throwIfAborted();
  const scale = `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease:reset_sar=1:flags=area`;
  const pad = `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2`;
  const read = runMedia(mediaBinary("ffmpeg"), [
    "-hide_banner", "-nostdin", "-v", "info", "-xerror", "-protocol_whitelist", "file,pipe",
    "-threads", "1", "-filter_threads", "1", "-copyts", "-start_at_zero", "-i", snapshot.path,
    "-map", "0:" + track.streamIndex, "-an", "-sn", "-dn",
    "-vf", `${scale},${pad},format=rgb24,showinfo`,
    "-frames:v", String(settings.maxFrames + 1), "-fps_mode", "passthrough",
    "-c:v", "rawvideo", "-threads:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], { signal, encoding: "buffer", windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const closed = new Promise<void>(resolve => read.child.once("close", () => resolve()));
  let output: Awaited<typeof read>;
  try {
    output = await read;
  } catch (error) {
    const { code, stderr } = error as { code?: string; stderr?: Buffer | string };
    if (code === "ENOENT") return { status: "local_tool_unavailable" };
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { status: "analysis_limit" };
    const diagnostic = stderr?.toString("utf8") ?? "";
    if (/reset_sar/i.test(diagnostic) && /option not found|(?:unknown|unrecognized) option|option .* not found/i.test(diagnostic)) {
      return { status: "local_tool_unsupported" };
    }
    return { status: "local_tool_failed" };
  } finally {
    await closed;
    signal.throwIfAborted();
  }

  const count = output.stdout.length / frameBytes;
  if (!Number.isInteger(count) || count < 1) return { status: "local_tool_failed" };
  if (count > settings.maxFrames) return { status: "analysis_limit" };
  const times = observedTimes(output.stderr.toString("utf8"), count, track);
  if (!times) return { status: "frame_timing_unverified" };

  const cuts: CutCandidate[] = [];
  const frames: RepresentativeFrame[] = [];
  const pixelsAt = (index: number) => output.stdout.subarray(index * frameBytes, (index + 1) * frameBytes);
  const keepFrame = (index: number) => {
    const id = "video-frame-" + (frames.length + 1);
    frames.push({
      id, timeMs: times[index], format: "rgb24", width: settings.width, height: settings.height,
      pixels: Uint8Array.from(pixelsAt(index)),
    });
    return id;
  };
  keepFrame(0);
  for (let index = 1; index < count; index++) {
    const distance = difference(pixelsAt(index - 1), pixelsAt(index));
    if (distance < settings.threshold) continue;
    if (cuts.length === settings.maxCuts) return { status: "analysis_limit" };
    cuts.push({
      kind: "inference", beforeMs: times[index - 1], afterMs: times[index],
      difference: Number(distance.toFixed(6)), frameId: keepFrame(index),
    });
  }
  return {
    status: "completed", settings, cuts, frames,
    coverage: { trackStartMs: track.startMs, trackEndMs: track.endMs, firstFrameMs: times[0], lastFrameMs: times[count - 1], framesRead: count },
  };
}

function featureFindings(video: VideoFeatures): ReferenceFinding[] {
  if (video.status !== "completed") return [];
  const frames = video.frames.map(({ id, timeMs, width, height }): ReferenceFinding => ({
    id, kind: "observation", location: { kind: "time", startMs: timeMs, endMs: timeMs },
    text: `Decoded representative frame (${width} × ${height})`,
  }));
  const cuts = video.cuts.flatMap(({ beforeMs, afterMs, difference, frameId }, index): ReferenceFinding[] => {
    const evidenceId = "video-difference-" + (index + 1);
    const location = { kind: "time", startMs: beforeMs, endMs: afterMs } as const;
    return [
      { id: evidenceId, kind: "observation", location, text: `Adjacent decoded frame RGB mean difference: ${difference}` },
      { id: "video-cut-" + (index + 1), kind: "inference", location, evidenceIds: [evidenceId, frameId], text: "Candidate cut from adjacent frame difference" },
    ];
  });
  return [...frames, ...cuts];
}

/** One local operation, with the same capability-bound snapshot used for both probe and decode. */
export async function analyzeLocalReferenceVideo(
  path: string, submission: unknown, options: ReferenceFileOptions,
): Promise<{ inspection: ReferenceAnalysisResult; video: VideoFeatures }> {
  let video: VideoFeatures = { status: "not_analyzed" };
  const inspection = await inspectLocalReferenceFile(path, submission, options, { video: async snapshot => {
    video = await readVideo(snapshot);
    return featureFindings(video);
  } });
  if (inspection.inspection !== "completed") {
    const { inspection: state } = inspection;
    video = { status: state === "cancelled" || state === "timed_out" || state === "local_tool_unavailable" ||
      state === "local_tool_failed" ? state : "not_analyzed" };
  }
  return { inspection, video };
}
