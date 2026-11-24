import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { mixAudio } from "@/lib/audio/mix";
import { sha256File } from "@/lib/audio/pcm";
import { PREVIEW_SIZE } from "@/lib/edit/preview";
import { FPS, totalFrames, type Timeline } from "@/lib/edit/timeline";
import { FONT_MIME, fontStatuses } from "@/lib/fonts/registry";
import { mediaBinary, runMedia } from "@/lib/media/tools";
import { createPrivateObjectReader } from "@/lib/storage/supabase/reader";
import type { OwnedStorageAsset } from "@/lib/storage/supabase/object-key";
import type { VerifiedActor } from "@/lib/db/postgres/types";
import { startFileServer } from "./file-server";
import { useLocalPgWavRenderInput as withLocalPgWavRenderInput } from "./local-pg-wav-input";
import { renderProps } from "./props";
import { runRenderAttempt } from "./run";
import { checkBrowser, COMPOSITION_ID, compositionSourceSha256 } from "./tools";
import { verifyAudio, verifyRender } from "./verify";

type JobBasis = {
  projectId: string; timelineId: string; revision: number; timelineRevision: number;
  outputFrames: number; timelineSha256: string;
};
export type StillSelection = { sceneId: string; versionId: string; verificationId: string; frames: number; source: OwnedStorageAsset };

export class LocalRenderError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function renderTextVideo(input: {
  timeline: Timeline; workRoot: string; output: string; width: number; height: number; frames: number;
  images: { absolute: string; assetId: string; sizeBytes: number }[]; signal: AbortSignal;
}) {
  const { timeline, workRoot, output, width, height, frames, images, signal } = input;
  const appRoot = process.cwd();
  const browser = await checkBrowser({ fresh: true, root: appRoot });
  if (!browser.ok) throw new LocalRenderError("RENDER_BROWSER_UNAVAILABLE");

  const registry = fontStatuses(appRoot);
  const families = [...new Set(timeline.text.map(layer => layer.style.fontFamily))];
  const fonts = [];
  for (const [index, family] of families.entries()) {
    const font = registry.find(entry => entry.family === family && entry.installed);
    if (!font?.file || timeline.text.some(layer => layer.style.fontFamily === family && !font.weights.includes(layer.style.fontWeight)))
      throw new LocalRenderError("RENDER_FONT_MISSING");
    const extension = extname(font.file).toLowerCase();
    const absolute = join(workRoot, "font-" + index + extension);
    const bytes = await readFile(font.file, { signal });
    await writeFile(absolute, bytes, { flag: "wx", mode: 0o600, signal });
    fonts.push({ family, weightMin: Math.min(...font.weights), weightMax: Math.max(...font.weights),
      absolute, sizeBytes: bytes.length, mime: FONT_MIME[extension.slice(1)] });
  }

  const tempDir = join(workRoot, "os-tmp");
  await mkdir(tempDir);
  signal.throwIfAborted();
  const server = await startFileServer(images.map(image => ({ ...image, mime: "image/png" })), fonts);
  try {
    signal.throwIfAborted();
    const attempt = await runRenderAttempt({
      appRoot, bundleRoot: join(workRoot, "bundles"), workBundle: join(workRoot, "work-bundle"), tempDir,
      sourceSha256: compositionSourceSha256(appRoot), browserPath: browser.path, fileBase: server.base,
      output, compositionId: COMPOSITION_ID,
      props: renderProps({ timeline, output: { width, height }, durationInFrames: frames, videoFrames: totalFrames(timeline.video),
        media: images.map(({ assetId }) => ({ assetId, kind: "image" })), fonts }, { media: server.mediaUrl, font: server.fontUrl }),
      shouldCancel: () => signal.aborted ? (signal.reason?.name === "TimeoutError" ? "timeout" : "cancel") : null,
    });
    if (!attempt.ok) throw new LocalRenderError(attempt.code === "FONT_MISSING" ? "RENDER_FONT_MISSING" : attempt.code);
    signal.throwIfAborted();
  } finally {
    await server.close();
  }
}

export async function renderLocalPgStill(connection: { port: number; password: string }, actor: VerifiedActor,
  job: JobBasis, selections: readonly StillSelection[], signal: AbortSignal) {
  return withLocalPgWavRenderInput(connection, actor, { projectId: job.projectId, timelineId: job.timelineId, contentRevision: job.revision }, async input => {
    const { timeline, workRoot } = input;
    if (input.timelineSha256 !== job.timelineSha256 || input.timelineRevision !== job.timelineRevision || input.outputFrames !== job.outputFrames)
      throw new LocalRenderError("CURRENT_TIMELINE_CONFLICT");
    if (selections.length < 1 || selections.length > 2 || timeline.video.length !== selections.length)
      throw new LocalRenderError("RENDER_INPUT_UNSUPPORTED");

    const byScene = new Map(selections.map(selection => [selection.sceneId, selection]));
    const ordered = timeline.video.map(clip => {
      const selection = byScene.get(clip.sceneId);
      if (!selection || clip.assetId !== selection.source.id || clip.sceneVersionId !== selection.versionId ||
          clip.durationFrames !== selection.frames || clip.trimInFrames !== 0 || clip.trimOutFrames !== 0 ||
          clip.transition.type !== "cut" || clip.transition.durationFrames !== 0)
        throw new LocalRenderError("RENDER_INPUT_UNSUPPORTED");
      return selection;
    });

    const ffmpeg = mediaBinary("ffmpeg"), ffprobe = mediaBinary("ffprobe");
    const reader = createPrivateObjectReader({
      profile: "synthetic", projectUrl: process.env.DREAM_OWNED_CREATE_STORAGE_ORIGIN ?? "", projectRef: "abcdefghijklmnopqrst",
      bucket: "t367-private", privateBucket: true, credential: { mode: "service-role", key: "t368-synthetic-credential" },
      maxBytes: 1024 * 1024, timeoutMs: 6500, maxConcurrent: 1, workRoot, ffprobePath: resolve(ffprobe),
    });
    const { width, height } = PREVIEW_SIZE[timeline.aspect];
    const video = join(workRoot, "video.mp4"), output = join(workRoot, "output.mp4");
    const images = [];
    for (const [index, selection] of ordered.entries()) {
      const path = join(workRoot, `scene-${index}.png`);
      await reader.useVerifiedFile(actor, selection.source, async file => {
        const bytes = await readFile(file.path, { signal: file.signal });
        if (createHash("sha256").update(bytes).digest("hex") !== selection.source.sha256)
          throw new LocalRenderError("RENDER_SOURCE_UNAVAILABLE");
        await writeFile(path, bytes, { signal: file.signal, flag: "wx" });
      }, signal);
      images.push({ absolute: path, assetId: selection.source.id, sizeBytes: selection.source.sizeBytes });
    }
    if (timeline.text.length > 0) {
      await renderTextVideo({ timeline, workRoot, output: video, width, height, frames: input.outputFrames, images, signal });
    } else {
      const scale = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
      const inputs = images.flatMap(({ absolute }) => ["-loop", "1", "-framerate", String(FPS), "-i", absolute]);
      const segments = ordered.map(({ frames }, index) =>
        `[${index}:v]${scale},setsar=1,format=yuv420p,trim=end_frame=${frames},setpts=PTS-STARTPTS[scene${index}]`);
      const assembly = ordered.length === 1 ? ["-vf", scale] : [
        "-filter_complex_threads", "1", "-filter_complex",
        `${segments.join(";")};[scene0][scene1]concat=n=2:v=1:a=0,settb=1/${FPS},setpts=N[out]`,
        "-map", "[out]",
      ];
      await runMedia(ffmpeg, ["-v", "error", "-nostdin", ...inputs, ...assembly, "-frames:v", String(input.outputFrames),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-an", video], { windowsHide: true, signal });
    }
    const mix = await mixAudio({ audio: input.audio, audioJoins: input.audioJoins, outputFrames: input.outputFrames,
      sources: input.sources, workRoot, video: { path: video, ...await sha256File(video) }, outputPath: output }, { signal, tools: { ffmpeg, ffprobe } });
    if (mix.status === "no_audio") throw new LocalRenderError("RENDER_VERIFY_FAILED");
    const verified = await verifyRender(output, { width, height, fps: FPS, frames: input.outputFrames, audio: "aac" }, signal);
    const audio = await verifyAudio(output, video, input.outputFrames, mix, signal);
    if (verified.result !== "passed" || audio.items.some(item => !item.pass)) throw new LocalRenderError("RENDER_VERIFY_FAILED");
    if ((await stat(output)).size > 16 * 1024 * 1024) throw new LocalRenderError("RENDER_OUTPUT_TOO_LARGE");
    const bytes = await readFile(output, { signal });
    if (createHash("sha256").update(bytes).digest("hex") !== mix.output.sha256 || mix.output.sizeBytes !== bytes.length)
      throw new LocalRenderError("RENDER_VERIFY_FAILED");
    return { bytes, frames: input.outputFrames, verify: { ...verified, items: [...verified.items, ...audio.items], audio: audio.record },
      sources: mix.sources.map(source => ({ id: source.assetId, sha256: source.sha256 })) };
  });
}
