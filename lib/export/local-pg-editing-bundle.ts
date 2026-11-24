import "server-only";

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";
import { canonicalJson, editViewFromTimeline, FPS, timelineSrt, timelineVtt } from "@/lib/edit/timeline";
import { FONT_MIME, fontStatuses } from "@/lib/fonts/registry";
import { mediaBinary } from "@/lib/media/tools";
import { inspectPcmWav } from "@/lib/services/postgres/pcm-wav";
import { createPrivateObjectReader } from "@/lib/storage/supabase/reader";
import {
  bundleBasis, PgEditingBundleError, pgBundleSha256, readPgEditingSnapshot,
  type PgEditingBundleBasis, type PgEditingBundleConnection,
} from "./local-pg-editing-input";
import { manifestSchema, type BundleManifest } from "./schema";
import { fileDigest, verifyZip, writeZip, type BundleSource } from "./zip";

type Artifact = { filename: string; manifest: BundleManifest; timelineSha256: string; sha256: string; sizeBytes: number };
const entryNumber = (index: number) => String(index + 1).padStart(2, "0");

async function removeBundleWork(parent: string, workRoot: string) {
  const owned = await realpath(workRoot);
  if (dirname(owned) !== parent || !basename(owned).startsWith("dream-pg-editing-bundle-"))
    throw new Error("Invalid editing bundle temporary path");
  await rm(owned, { recursive: true, force: true, maxRetries: 4 });
}

export { PgEditingBundleError, type PgEditingBundleBasis, type PgEditingBundleConnection } from "./local-pg-editing-input";

/** Gives an internal caller a verified temporary archive after rechecking the approved basis. */
export async function useLocalPgEditingBundle<T>(
  connection: PgEditingBundleConnection, actor: VerifiedActor, request: PgEditingBundleBasis,
  consume: (artifact: Artifact) => Promise<T>, signal?: AbortSignal,
) {
  const basis = bundleBasis.safeParse(request);
  if (!isVerifiedActor(actor) || !basis.success || !Number.isSafeInteger(connection.port) ||
      connection.port < 1 || connection.port > 65535 || !connection.password)
    throw new PgEditingBundleError("EXPORT_INPUT_INVALID");
  signal?.throwIfAborted();
  const snapshot = await readPgEditingSnapshot(connection, actor, basis.data);
  const { metadata, wavBytes } = snapshot;
  const { project, plan, timeline, timelineJson, scenes, audio } = metadata;
  const parent = await realpath(tmpdir());
  const workRoot = await mkdtemp(join(parent, "dream-pg-editing-bundle-"));
  try {
    const sources: BundleSource[] = [];
    const files: BundleManifest["files"] = [];
    function add(path: string, mime: string, value: Buffer | string) {
      const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
      sources.push({ path, bytes });
      files.push({ path, mime, sizeBytes: bytes.length, sha256: pgBundleSha256(bytes) });
    }

    const reader = createPrivateObjectReader({
      profile: "synthetic", projectUrl: connection.storageOrigin, projectRef: "abcdefghijklmnopqrst",
      bucket: "t367-private", privateBucket: true, credential: { mode: "service-role", key: "t368-synthetic-credential" },
      maxBytes: 1024 * 1024, timeoutMs: 6500, maxConcurrent: 1, workRoot,
      ffprobePath: resolve(mediaBinary("ffprobe")),
    });
    const openPng = async (source: (typeof scenes)[number]["source"], fn: (path: string, signal: AbortSignal) => Promise<void>) => {
      try {
        await reader.useVerifiedFile(actor, source, file => fn(file.path, file.signal), signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof PgEditingBundleError) throw error;
        throw new PgEditingBundleError("EXPORT_ASSET_UNAVAILABLE");
      }
    };
    for (const [index, scene] of scenes.entries()) {
      const filename = join(workRoot, "scene-" + index + ".png");
      await openPng(scene.source, async (path, sourceSignal) => {
        const bytes = await readFile(path, { signal: sourceSignal });
        if (bytes.length !== scene.source.sizeBytes || pgBundleSha256(bytes) !== scene.source.sha256)
          throw new PgEditingBundleError("EXPORT_ASSET_CHANGED");
        await writeFile(filename, bytes, { flag: "wx", mode: 0o600, signal: sourceSignal });
      });
      const path = `scenes/${entryNumber(index)}_${scene.id}_v${scene.version}.png`;
      sources.push({ path, filename });
      files.push({ path, mime: "image/png", sha256: scene.source.sha256, sizeBytes: scene.source.sizeBytes,
        sceneId: scene.id, versionId: scene.versionId, width: scene.width, height: scene.height, rights: scene.currentRights });
    }

    add("README.txt", "text/plain", [
      "쇼핑 숏폼 재편집용 묶음입니다. 최종 MP4는 영상 만들기에서 별도로 받으세요.",
      "장면 원본과 글자의 위치·시간을 포함한 30fps 타임라인을 사용해 다시 편집할 수 있어요.",
      ...(audio.length > 0 ? ["WAV 원본과 타임라인의 소리 설정은 audio/와 edit/에서 확인하세요."] : []),
      "원본 출처와 권리 메모는 provenance/rights.md에서 확인하세요.",
    ].join("\n") + "\n");
    add("script/script.txt", "text/plain", plan.script);
    add("script/plan.md", "text/markdown", "# 승인 기획 v" + plan.version + "\n\n" + plan.script + "\n\n" + JSON.stringify(plan.steps, null, 2));
    const edit = editViewFromTimeline(timeline);
    add("edit/text_overlays.json", "application/json", JSON.stringify({
      revisionId: basis.data.timelineId, schema_version: 1, content_revision: basis.data.revision,
      created_at: metadata.timelineCreatedAt, ...edit,
    }, null, 2));
    add("edit/timeline.json", "application/json", timelineJson);
    const srt = timelineSrt(timeline.text);
    const vtt = timelineVtt(timeline.text);
    if (srt) add("subtitles/manual.srt", "application/x-subrip", srt);
    if (vtt) add("subtitles/timeline.vtt", "text/vtt", vtt);
    add("provenance/generations.json", "application/json", JSON.stringify(scenes.map(scene => ({
      sceneId: scene.id, versionId: scene.versionId, generationId: null, provider: null, model: null, params: null,
      costActualMicros: null, currency: null, isMock: false,
    })), null, 2));
    const savedRights = timeline.schemaVersion === 2 ? timeline.audioRights : [];
    const rights = [
      "# 출처·권리 기록", "\n프로젝트 사용권 입력: " + (metadata.usageRights ?? "기록 없음"), "\n## 장면 원본",
      ...scenes.map(scene => `- ${scene.name} (${scene.title}): 등록 당시 ${scene.registeredRights ?? "기록 없음"} · 현재 원본 ${scene.currentRights ?? "기록 없음"}`),
      "\n## 소리 원본",
      ...audio.map(item => {
        const row = savedRights.find(record => record.assetId === item.id);
        return `- ${item.title}: 자료 메모 ${item.rightsNote ?? "기록 없음"} · 출처 ${row?.sourceUrl ?? "기록 없음"} · 이용 계획 ${row?.planName ?? "기록 없음"} · 만든 날 ${row?.createdOn ?? "기록 없음"} · 메모 ${row?.licenseNote ?? "기록 없음"}`;
      }),
    ];
    add("provenance/rights.md", "text/markdown", rights.join("\n") + "\n");
    add("review/checklist.md", "text/markdown", "# 내용 버전 r" + basis.data.revision + " 검수\n\n" +
      metadata.reviews.map(item => `- [${item.status === "pass" ? "x" : " "}] ${item.label}${item.required ? " (필수)" : ""}${item.note ? " · " + item.note : ""}`).join("\n") + "\n");

    const registry = fontStatuses();
    const families = [...new Set(["Pretendard", ...timeline.text.map(layer => layer.style.fontFamily)])];
    for (const family of families) {
      const font = registry.find(entry => entry.family === family && entry.installed);
      if (!font?.file || !font.license) throw new PgEditingBundleError("EXPORT_FONT_UNAVAILABLE");
      const filename = basename(font.file);
      const folder = font.folder ? font.folder + "/" : "";
      add("fonts/" + folder + filename, FONT_MIME[extname(filename).slice(1).toLowerCase()],
        await readFile(font.file, { signal }));
      add("LICENSES/" + (font.folder || "Pretendard") + "-OFL.txt", "text/plain", await readFile(font.license, { signal }));
    }

    if (timeline.schemaVersion === 2 && audio.length > 0) {
      const listed = [];
      for (const [index, item] of audio.entries()) {
        const bytes = wavBytes.get(item.id);
        const wav = bytes && inspectPcmWav(bytes);
        const clips = timeline.audio.filter(clip => clip.assetId === item.id);
        if (!bytes || !wav || bytes.length !== item.sizeBytes || pgBundleSha256(bytes) !== item.sha256 ||
            Math.max(1, Math.round(wav.frames * 1000 / wav.sampleRate)) !== item.durationMs ||
            clips.some(clip => (clip.sourceInFrame + clip.durationFrames) * wav.sampleRate > wav.frames * FPS))
          throw new PgEditingBundleError("EXPORT_ASSET_CHANGED");
        const path = `audio/${entryNumber(index)}_${item.id}.wav`;
        const filename = join(workRoot, "audio-" + index + ".wav");
        await writeFile(filename, bytes, { flag: "wx", mode: 0o600, signal });
        const roles = [...new Set(clips.map(clip => clip.role))];
        sources.push({ path, filename });
        files.push({ path, mime: "audio/wav", sizeBytes: item.sizeBytes, sha256: item.sha256, durationMs: item.durationMs,
          rights: item.rightsNote, audio: { assetId: item.id, roles, isMock: false } });
        listed.push({ assetId: item.id, path, title: item.title, mime: "audio/wav", sizeBytes: item.sizeBytes,
          sha256: item.sha256, durationMs: item.durationMs, roles, clipIds: clips.map(clip => clip.id), clips,
          rights: savedRights.find(record => record.assetId === item.id) ?? null, rightsNote: item.rightsNote });
      }
      add("edit/audio_sources.json", "application/json", JSON.stringify({
        schemaVersion: 1, timelineRevisionId: basis.data.timelineId, timelineFile: "edit/timeline.json",
        fps: FPS, audioMixProfile: timeline.audioMixProfile, sources: listed, joins: timeline.audioJoins,
      }, null, 2));
    }
    wavBytes.clear();

    const manifest = manifestSchema.parse({
      manifestVersion: audio.length ? 2 : 1, project, menu: metadata.menu, templateVersion: metadata.templateVersion,
      contentRevision: basis.data.revision, planId: plan.id, exportedAt: new Date().toISOString(),
      kind: "editing-bundle", isMock: false, files,
      ...(timeline.schemaVersion === 2 && audio.length > 0 && {
        timeline: { revisionId: basis.data.timelineId, schemaVersion: 2, audioMixProfile: timeline.audioMixProfile },
      }),
    });
    const filename = join(workRoot, "editing.zip.part");
    await writeZip(filename, sources, manifest, signal);
    await verifyZip(filename, manifest, signal);
    const digest = await fileDigest(filename, signal);
    for (const scene of scenes) await openPng(scene.source, async () => {});
    const current = await readPgEditingSnapshot(connection, actor, basis.data);
    if (canonicalJson(current.metadata) !== canonicalJson(metadata))
      throw new PgEditingBundleError("EXPORT_SNAPSHOT_CHANGED");
    for (const source of audio) {
      const bytes = current.wavBytes.get(source.id);
      if (!bytes || bytes.length !== source.sizeBytes || pgBundleSha256(bytes) !== source.sha256)
        throw new PgEditingBundleError("EXPORT_ASSET_CHANGED");
    }
    signal?.throwIfAborted();
    return await consume({ filename, manifest, timelineSha256: metadata.timelineSha256, ...digest });
  } finally {
    await removeBundleWork(parent, workRoot);
  }
}
