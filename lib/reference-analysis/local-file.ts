import "server-only";
import { createWriteStream } from "node:fs";
import { lstat, mkdtemp, open, realpath, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import { mediaBinary, runMedia } from "../media/tools";
import { classifyReferenceInput, referenceFileByteLimit, referenceFileFormat, type ReferenceFileSource } from "./input";
import { createReferenceAnalysisResult, type ReferenceInspection } from "./result";

type Options = {
  /** A server-owned directory selected after the caller checks source ownership. */
  managedRoot: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type FailureCode = Exclude<ReferenceInspection, "completed" | "cancelled" | "timed_out"> | "file_type_mismatch" | "file_too_large";
class InspectionError extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

const localPath = (path: string) => isAbsolute(path) && !/^[\\/]{2}/.test(path);
function withinRoot(root: string, path: string) {
  const rest = relative(root, path);
  return !!rest && !isAbsolute(rest) && rest !== ".." && !rest.startsWith(".." + sep);
}

async function snapshot(sourcePath: string, destination: string, expectedBytes: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = await open(sourcePath, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new InspectionError("invalid_file");
    if (info.size > referenceFileByteLimit) throw new InspectionError("file_too_large");
    if (info.size !== expectedBytes) throw new InspectionError("invalid_file");

    let bytes = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        bytes += chunk.length;
        if (bytes > referenceFileByteLimit) return next(new InspectionError("file_too_large"));
        if (bytes > expectedBytes) return next(new InspectionError("invalid_file"));
        next(null, chunk);
      },
    });
    await pipeline(file.createReadStream({ autoClose: false }), bounded, createWriteStream(destination, { flags: "wx" }), { signal });
    if (bytes !== expectedBytes) throw new InspectionError("invalid_file");
    return bytes;
  } finally {
    await file.close();
  }
}

const probeTiming = { start_time: z.string().optional(), duration: z.string().optional() };
const probeOutput = z.object({
  streams: z.array(z.object({
    codec_type: z.string(), width: z.number().optional(), height: z.number().optional(),
    disposition: z.unknown().optional(), ...probeTiming,
  })),
  format: z.object(probeTiming),
});

function seconds(value: string | undefined) {
  return value && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

function positiveDurationMs(value: string | undefined) {
  const ms = Math.round(seconds(value) * 1_000);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

type ProbeStream = z.infer<typeof probeOutput>["streams"][number];
const videoDisposition = z.object({ attached_pic: z.union([z.literal(0), z.literal(1)]) });

function trackWindow(stream: ProbeStream | undefined, kind: "video" | "audio", origin: number, containerDurationMs: number | null) {
  const start = seconds(stream?.start_time);
  const length = seconds(stream?.duration);
  const startMs = Math.round((start - origin) * 1_000);
  const endMs = Math.round((start + length - origin) * 1_000);
  // Unknown origin, multiple relevant streams and contradictory bounds stay
  // descriptive. The container duration never acts as the track's duration.
  return start >= origin && Number.isSafeInteger(startMs) && Number.isSafeInteger(endMs) &&
    endMs > startMs && (containerDurationMs === null || endMs <= containerDurationMs)
    ? { kind, startMs, endMs } : null;
}

function playbackTimeline(data: z.infer<typeof probeOutput>, kind: "video" | "audio") {
  const video: ProbeStream[] = [];
  let videoCountKnown = true;
  for (const stream of data.streams) {
    if (stream.codec_type !== "video") continue;
    const disposition = videoDisposition.safeParse(stream.disposition);
    if (!disposition.success) videoCountKnown = false;
    else if (disposition.data.attached_pic === 0) video.push(stream);
  }
  // Unclassified video streams could be playable. Do not certify a motion
  // track or dimensional/time metadata using a potentially incomplete count.
  if (!videoCountKnown && kind === "video") throw new InspectionError("local_tool_failed");
  const audio = data.streams.filter(item => item.codec_type === "audio");
  const matching = kind === "video" ? video : audio;
  if (!matching.length) throw new InspectionError("invalid_file");
  const containerDurationMs = positiveDurationMs(data.format.duration);
  const origin = seconds(data.format.start_time);
  const tracks = [
    trackWindow(videoCountKnown && video.length === 1 ? video[0] : undefined, "video", origin, containerDurationMs),
    trackWindow(audio.length === 1 ? audio[0] : undefined, "audio", origin, containerDurationMs),
  ].filter(track => track !== null);
  return { stream: matching.length === 1 ? matching[0] : undefined, timeline: { containerDurationMs, tracks } };
}

async function probeMedia(path: string, source: ReferenceFileSource, signal: AbortSignal, deadline: number) {
  signal.throwIfAborted();
  let detected;
  try {
    detected = await fileTypeFromFile(path, { signal });
  } catch (error) {
    if ((error as { name?: string }).name === "EndOfStreamError") throw new InspectionError("invalid_file");
    throw error;
  }
  signal.throwIfAborted();
  if (!detected) throw new InspectionError("invalid_file");
  if (!referenceFileFormat(source.name)?.mimes.some(mime => mime === detected.mime)) {
    throw new InspectionError("file_type_mismatch");
  }

  if (source.media === "image") {
    let sharp;
    try { ({ default: sharp } = await import("sharp")); }
    catch { throw new InspectionError("local_tool_unavailable"); }
    try {
      const image = sharp(path, { limitInputPixels: 40_000_000, failOn: "error" })
        .timeout({ seconds: Math.max(1, Math.ceil((deadline - performance.now()) / 1_000)) });
      const metadata = await image.metadata();
      signal.throwIfAborted();
      await image.stats();
      signal.throwIfAborted();
      if (!metadata.width || !metadata.height) throw new InspectionError("invalid_file");
      return { tool: "file-type+sharp", values: { mime: detected.mime, width: metadata.width, height: metadata.height, durationMs: null } };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && /timed?\s*out|timeout/i.test(error.message)) throw new DOMException("Inspection timed out", "TimeoutError");
      throw new InspectionError("invalid_file");
    }
  }

  const processRun = runMedia(mediaBinary("ffprobe"), [
    "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
    "stream=codec_type,width,height,start_time,duration:stream_disposition=attached_pic:format=start_time,duration",
    "-of", "json", path,
  ], { signal, maxBuffer: 1024 * 1024, windowsHide: true });
  const closed = new Promise<void>(resolve => processRun.child.once("close", () => resolve()));
  let output: Awaited<typeof processRun>;
  try {
    output = await processRun;
  } catch (error) {
    const { code, stderr } = error as { code?: string; stderr?: string };
    if (code === "ENOENT") throw new InspectionError("local_tool_unavailable");
    if (typeof stderr === "string" && /invalid data found when processing input|moov atom not found|error reading header/i.test(stderr)) {
      throw new InspectionError("invalid_file");
    }
    throw new InspectionError("local_tool_failed");
  } finally {
    // execFile can reject on abort before the process closes its handles.
    await closed;
  }
  signal.throwIfAborted();
  let parsed: ReturnType<typeof probeOutput.safeParse>;
  try { parsed = probeOutput.safeParse(JSON.parse(output.stdout)); }
  catch { throw new InspectionError("local_tool_failed"); }
  if (!parsed.success) throw new InspectionError("local_tool_failed");

  const { stream, timeline } = playbackTimeline(parsed.data, source.media === "music" ? "audio" : "video");
  const durationMs = timeline.containerDurationMs ?? positiveDurationMs(stream?.duration);
  if (durationMs === null) throw new InspectionError("invalid_file");
  return {
    tool: "file-type+ffprobe", timeline,
    values: { mime: detected.mime, width: stream?.width ?? null, height: stream?.height ?? null, durationMs },
  };
}

/** The path and managed root are trusted server-side inputs, never request strings. */
export async function inspectLocalReferenceFile(path: string, submission: unknown, options: Options) {
  const decision = classifyReferenceInput(submission);
  if (decision.status !== "ready") return createReferenceAnalysisResult(decision);
  const { source } = decision;
  const invalid = (reason: "invalid_file" | "file_type_mismatch" | "file_too_large") =>
    createReferenceAnalysisResult({ status: "invalid", reason }, [], "invalid_file");
  const unavailable = (reason: "local_tool_unavailable" | "local_tool_failed" | "inspection_failed" | "cancelled" | "timed_out") =>
    createReferenceAnalysisResult(decision, [{
      id: "local-inspection", kind: "unavailable", location: { kind: "whole" }, subject: "file_metadata", reason,
    }], reason);
  if (source.kind !== "file" || !localPath(path) || !localPath(options.managedRoot) || !withinRoot(options.managedRoot, path)) {
    return invalid("invalid_file");
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return unavailable("inspection_failed");
  const deadline = performance.now() + timeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let cleanupFailed = false;
  try {
    signal.throwIfAborted();
    const [root, file] = await Promise.all([realpath(options.managedRoot), realpath(path)]);
    if (!localPath(root) || !localPath(file) || !withinRoot(root, file)) return invalid("invalid_file");
    if (!(await lstat(file)).isFile()) return invalid("invalid_file");
    signal.throwIfAborted();

    const temporaryRoot = await realpath(tmpdir());
    if (!localPath(temporaryRoot)) return unavailable("inspection_failed");
    const directory = await mkdtemp(join(temporaryRoot, "dream-rea-inspect-"));
    const copy = join(directory, "sample" + extname(source.name).toLowerCase());
    let evidence;
    let observedBytes: number;
    try {
      observedBytes = await snapshot(file, copy, source.sizeBytes, signal);
      evidence = await probeMedia(copy, source, signal, deadline);
    } finally {
      try {
        await rm(copy, { force: true });
        await rmdir(directory);
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) return unavailable("inspection_failed");
    signal.throwIfAborted();
    return createReferenceAnalysisResult(decision, [{
      id: "file-metadata", kind: "file_metadata", location: { kind: "whole" }, observedBytes, ...evidence,
    }], "completed");
  } catch (error) {
    if (cleanupFailed) return unavailable("inspection_failed");
    if (signal.aborted) return unavailable(timeout.aborted && signal.reason === timeout.reason ? "timed_out" : "cancelled");
    if (error instanceof DOMException && error.name === "TimeoutError") return unavailable("timed_out");
    if (!(error instanceof InspectionError)) {
      return (error as { code?: string }).code === "ENOENT" ? invalid("invalid_file") : unavailable("inspection_failed");
    }
    if (error.code === "invalid_file" || error.code === "file_type_mismatch" || error.code === "file_too_large") return invalid(error.code);
    return unavailable(error.code);
  }
}
