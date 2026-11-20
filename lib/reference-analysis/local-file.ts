import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream, type BigIntStats } from "node:fs";
import { lstat, mkdtemp, open, readFile, realpath, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import { mediaBinary, runMedia } from "../media/tools";
import { classifyReferenceInput, referenceFileByteLimit, referenceFileFormat, type ReferenceFileSource } from "./input";
import { readCanonicalPcmWav, type RegisteredPcmWav } from "./registered-pcm-wav";
import { createReferenceAnalysisResult, type ReferenceFinding, type ReferenceInspection } from "./result";

export const registeredReferenceSnapshotSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceGeneration: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

type RegisteredSnapshot = z.infer<typeof registeredReferenceSnapshotSchema>;

export type ReferenceFileOptions = {
  /** A server-owned directory selected after the caller checks source ownership. */
  managedRoot: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Trusted registration metadata, supplied by the registered-source adapter. */
  registration?: RegisteredSnapshot;
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

function assertRegisteredFile(actual: BigIntStats, expected: BigIntStats) {
  if (!actual.isFile() || actual.nlink !== 1n || actual.dev !== expected.dev || actual.ino !== expected.ino ||
    actual.size !== expected.size || actual.mtimeNs !== expected.mtimeNs || actual.ctimeNs !== expected.ctimeNs) {
    throw new InspectionError("invalid_file");
  }
}

async function checkRegisteredPath(path: string, identity: BigIntStats) {
  const [canonical, stat] = await Promise.all([realpath(path), lstat(path, { bigint: true })]);
  if (relative(path, canonical) !== "") throw new InspectionError("invalid_file");
  assertRegisteredFile(stat, identity);
}

async function snapshot(
  sourcePath: string, destination: string, expectedBytes: number, signal: AbortSignal,
  registered?: { identity: BigIntStats; sha256: string },
) {
  signal.throwIfAborted();
  const file = await open(sourcePath, "r");
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile()) throw new InspectionError("invalid_file");
    if (info.size > BigInt(referenceFileByteLimit)) throw new InspectionError("file_too_large");
    if (info.size !== BigInt(expectedBytes)) throw new InspectionError("invalid_file");
    if (registered) assertRegisteredFile(info, registered.identity);

    const hash = registered ? createHash("sha256") : undefined;
    let bytes = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        bytes += chunk.length;
        if (bytes > referenceFileByteLimit) return next(new InspectionError("file_too_large"));
        if (bytes > expectedBytes) return next(new InspectionError("invalid_file"));
        hash?.update(chunk);
        next(null, chunk);
      },
    });
    await pipeline(file.createReadStream({ autoClose: false }), bounded, createWriteStream(destination, { flags: "wx" }), { signal });
    if (bytes !== expectedBytes) throw new InspectionError("invalid_file");
    signal.throwIfAborted();
    if (registered) {
      assertRegisteredFile(await file.stat({ bigint: true }), registered.identity);
      if (hash?.digest("hex") !== registered.sha256) throw new InspectionError("invalid_file");
    }
    return bytes;
  } finally {
    await file.close();
  }
}

const probeTiming = { start_time: z.string().optional(), duration: z.string().optional() };
const probeOutput = z.object({
  streams: z.array(z.object({
    codec_type: z.string(), width: z.number().optional(), height: z.number().optional(),
    index: z.number().int().nonnegative().optional(), channels: z.number().int().positive().optional(), disposition: z.unknown().optional(), ...probeTiming,
    codec_name: z.string().optional(), sample_rate: z.string().optional(), time_base: z.string().optional(), duration_ts: z.number().optional(),
  })),
  format: z.object({ ...probeTiming, format_name: z.string().optional() }),
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

async function probeRegisteredPcm(path: string, size: number, probe: z.infer<typeof probeOutput>, signal: AbortSignal) {
  const [stream] = probe.streams;
  if (probe.format.format_name !== "wav" || probe.format.start_time !== undefined ||
      probe.streams.length !== 1 || stream.codec_type !== "audio" || stream.codec_name !== "pcm_s16le" ||
      stream.index !== 0 || stream.start_time !== undefined) return;
  const pcm = await readCanonicalPcmWav(path, size, signal);
  if (!pcm || stream.channels !== pcm.channels || stream.sample_rate !== String(pcm.sampleRate) ||
      stream.time_base !== `1/${pcm.sampleRate}` || stream.duration_ts !== pcm.frames) return;
  const duration = pcm.frames / pcm.sampleRate;
  // ffprobe formats durations to microseconds. Compare its independent fields to the exact frame count.
  const matchesDuration = (value: string | undefined) => Math.abs(seconds(value) - duration) <= 0.000000501;
  if (!matchesDuration(stream.duration) || !matchesDuration(probe.format.duration)) return;
  return pcm;
}

async function probeMedia(path: string, source: ReferenceFileSource, signal: AbortSignal, deadline: number, registered: boolean) {
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
      // A native file-backed decoder may retain a handle after stats on Windows.
      // The owned snapshot has already been checked against the file byte limit.
      const imageBytes = await readFile(path, { signal });
      const image = sharp(imageBytes, { limitInputPixels: 40_000_000, failOn: "error" })
        .timeout({ seconds: Math.max(1, Math.ceil((deadline - performance.now()) / 1_000)) });
      const metadata = await image.metadata();
      signal.throwIfAborted();
      await image.stats();
      signal.throwIfAborted();
      if (!metadata.width || !metadata.height) throw new InspectionError("invalid_file");
      return { tool: "file-type+sharp", imageBytes, values: { mime: detected.mime, width: metadata.width, height: metadata.height, durationMs: null } };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && /timed?\s*out|timeout/i.test(error.message)) throw new DOMException("Inspection timed out", "TimeoutError");
      throw new InspectionError("invalid_file");
    }
  }

  const mayUsePcmTiming = registered && source.media === "music" && detected.mime === "audio/wav";
  const streamFields = "stream=index,codec_type,width,height,channels,start_time,duration";
  const entries = mayUsePcmTiming
    ? streamFields + ",codec_name,sample_rate,time_base,duration_ts:stream_disposition=attached_pic:format=start_time,duration,format_name"
    : streamFields + ":stream_disposition=attached_pic:format=start_time,duration";
  const processRun = runMedia(mediaBinary("ffprobe"), [
    "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
    entries,
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
  const pcm = mayUsePcmTiming && timeline.tracks.length === 0
    ? await probeRegisteredPcm(path, source.sizeBytes, parsed.data, signal) : undefined;
  const durationMs = pcm ? Math.round(pcm.frames * 1000 / pcm.sampleRate)
    : timeline.containerDurationMs ?? positiveDurationMs(stream?.duration);
  if (durationMs === null || durationMs < 1) throw new InspectionError("invalid_file");
  if (pcm) {
    timeline.containerDurationMs = durationMs;
    timeline.tracks.push({ kind: "audio", startMs: 0, endMs: durationMs });
  }
  return {
    tool: "file-type+ffprobe", timeline,
    values: { mime: detected.mime, width: stream?.width ?? null, height: stream?.height ?? null, durationMs },
    streamIndex: stream?.index, channels: stream?.channels, pcm,
  };
}

export type ReferenceMediaSnapshot = {
  path: string;
  signal: AbortSignal;
  deadline: number;
  imageBytes?: Buffer;
  track: Readonly<{ startMs: number; endMs: number; streamIndex: number; pcm?: RegisteredPcmWav }> | undefined;
  channels: number | undefined;
  width: number | null;
  height: number | null;
};
type ReferenceAnalyzers = Partial<Record<ReferenceFileSource["media"], (
  snapshot: ReferenceMediaSnapshot,
) => Promise<readonly ReferenceFinding[]>>>;

/** The path and managed root are trusted server-side inputs, never request strings. */
export async function inspectLocalReferenceFile(
  path: string, submission: unknown, options: ReferenceFileOptions,
  analyzers?: ReferenceAnalyzers,
) {
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

  const registration = options.registration === undefined ? undefined : registeredReferenceSnapshotSchema.safeParse(options.registration);
  if (registration && !registration.success) return invalid("invalid_file");
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
    const identity = await lstat(file, { bigint: true });
    if (!identity.isFile()) return invalid("invalid_file");
    if (registration && (identity.ino === 0n || identity.nlink !== 1n ||
      relative(join(root, relative(options.managedRoot, path)), file) !== "")) return invalid("invalid_file");
    signal.throwIfAborted();

    const temporaryRoot = await realpath(tmpdir());
    if (!localPath(temporaryRoot)) return unavailable("inspection_failed");
    const directory = await mkdtemp(join(temporaryRoot, "dream-rea-inspect-"));
    const copy = join(directory, "sample" + extname(source.name).toLowerCase());
    let evidence;
    let observedBytes: number;
    let findings: readonly ReferenceFinding[] = [];
    try {
      observedBytes = await snapshot(file, copy, source.sizeBytes, signal,
        registration ? { identity, sha256: registration.data.sha256 } : undefined);
      if (registration) await checkRegisteredPath(file, identity);
      evidence = await probeMedia(copy, source, signal, deadline, registration !== undefined);
      const analyze = analyzers?.[source.media];
      if (analyze) {
        const window = evidence.timeline?.tracks.find(track => track.kind === (source.media === "music" ? "audio" : "video"));
        const streamIndex = evidence.streamIndex;
        findings = await analyze({
          path: copy, signal, deadline, imageBytes: evidence.imageBytes, channels: evidence.channels,
          track: window && streamIndex !== undefined
            ? { startMs: window.startMs, endMs: window.endMs, streamIndex, pcm: evidence.pcm } : undefined,
          width: evidence.values.width, height: evidence.values.height,
        });
      }
      if (registration) await checkRegisteredPath(file, identity);
    } finally {
      try {
        await rm(copy, { force: true });
        await rmdir(directory);
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) return unavailable("inspection_failed");
    signal.throwIfAborted();
    const { tool, values, timeline } = evidence;
    return createReferenceAnalysisResult(decision, [{
      id: "file-metadata", kind: "file_metadata", location: { kind: "whole" }, observedBytes, tool, values,
      ...(timeline ? { timeline } : {}),
    }, ...findings], "completed");
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
