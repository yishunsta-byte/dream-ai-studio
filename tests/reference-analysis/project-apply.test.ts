import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBackupManifest, verifyBackupArchive } from "../../lib/backup/archive";
import { openDatabase, type DatabaseHandle } from "../../lib/db/connection";
import { migrateDatabase } from "../../lib/db/migrate";
import { actorFromVerifiedUserId, type VerifiedActor } from "../../lib/db/postgres/types";
import { referenceProjectApplyService } from "../../lib/reference-analysis/project-apply";
import { createPrivateReferencePreviewRecord } from "../../lib/reference-analysis/project-preview";
import { createReferenceAnalysisResult, type ReferenceFinding } from "../../lib/reference-analysis/result";
import { timelineService } from "../../lib/services/timeline";
import { S4_ZIP, s4Ids } from "../fixtures/backups/s4-build";
import { snapshotDb } from "../fixtures/backups/s4-compare";

vi.mock("server-only", () => ({}));

const ids = s4Ids();
const owner = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000010");
const other = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000020");
const scope = { projectId: ids.main, sourceId: "source-private-id", sourceRevision: "private-source-rev", analysisRevision: "private-analysis-rev" };
const privateText = "https://private.invalid/original C:/private/source.mp4";
const analyzedAt = 10_000;
const seen = (id: string, startMs: number, endMs = startMs): ReferenceFinding =>
  ({ id, kind: "observation", location: { kind: "time", startMs, endMs }, text: privateText });

function videoPreview() {
  const inspection = createReferenceAnalysisResult({
    status: "ready", source: { kind: "file", name: "private-original.mp4", sizeBytes: 1, permission: "synthetic", media: "video" },
  }, [{
    id: "file-metadata", kind: "file_metadata", tool: privateText, observedBytes: 1, location: { kind: "whole" },
    values: { durationMs: 1_000 }, timeline: { containerDurationMs: 1_000, tracks: [{ kind: "video", startMs: 0, endMs: 1_000 }] },
  }, seen("video-frame-1", 0), seen("video-frame-2", 992), seen("video-difference-1", 983, 992), {
    id: "video-cut-1", kind: "inference", text: privateText, evidenceIds: ["video-difference-1", "video-frame-2"],
    location: { kind: "time", startMs: 983, endMs: 992 },
  }], "completed");
  return createPrivateReferencePreviewRecord(owner, scope, analyzedAt, {
    media: "video", inspection,
    video: {
      status: "completed", settings: {
        method: "adjacent_rgb_mean_difference", threshold: 0.22, width: 64, height: 36,
        maxDurationMs: 20_000, maxSourcePixels: 1920 * 1080, maxFrames: 240, maxCuts: 24,
      },
      coverage: { trackStartMs: 0, trackEndMs: 1_000, firstFrameMs: 0, lastFrameMs: 992, framesRead: 120 },
      cuts: [{ kind: "inference", beforeMs: 983, afterMs: 992, difference: 0.5, frameId: "video-frame-2" }],
      frames: [0, 992].map((timeMs, index) => ({
        id: "video-frame-" + (index + 1), timeMs, format: "rgb24", width: 64, height: 36, pixels: Uint8Array.of(1, 2, 3),
      })),
    },
  });
}

function imagePreview() {
  const location = { kind: "region", x: 0, y: 0, width: 1, height: 1 } as const;
  const inspection = createReferenceAnalysisResult({
    status: "ready", source: { kind: "file", name: "private-original.png", sizeBytes: 1, permission: "synthetic", media: "image" },
  }, [{
    id: "file-metadata", kind: "file_metadata", tool: privateText, observedBytes: 1, location: { kind: "whole" }, values: { width: 1, height: 1 },
  }, { id: "image-region-0", kind: "observation", location, text: privateText }], "completed");
  return createPrivateReferencePreviewRecord(owner, scope, analyzedAt, {
    media: "image", inspection, image: {
      status: "completed", display: { width: 1, height: 1 }, sample: { width: 1, height: 1, rows: 1, columns: 1 },
      luminanceEdges: [0, 0.25, 0.5, 0.75, 1], distribution: {
        alphaCoverage: 1, palette: [{ bucket: "#e02020", visibleShare: 1 }], luminanceShares: [1, 0, 0, 0],
      }, regions: [],
    },
  });
}

describe("explicit REA project apply on an isolated synthetic timeline", () => {
  let root: string;
  let path: string;
  let handle: DatabaseHandle;
  let nowMs: number;
  let active: typeof scope | null;
  const handles: DatabaseHandle[] = [];
  const maxAgeMs = 500;
  const readScope = (_db: DatabaseHandle, actor: VerifiedActor, projectId: string, sourceId: string) =>
    actor.id === owner.id && projectId === scope.projectId && sourceId === scope.sourceId ? active : null;
  const service = (on = handle) => referenceProjectApplyService(on, { resolveOwnedScope: readScope, nowMs: () => nowMs, maxAgeMs });

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "dream-rea-apply-")));
    const extracted = join(root, "fixture");
    path = join(extracted, "data", "app.db");
    await verifyBackupArchive(S4_ZIP, await readBackupManifest(S4_ZIP), extracted);
    handle = openDatabase(path, { fileMustExist: true });
    handles.push(handle);
    migrateDatabase(handle.sqlite);
    active = { ...scope };
    nowMs = analyzedAt + 100;
  });

  afterEach(() => {
    for (const db of handles.splice(0)) db.close();
    if (!root || dirname(realpathSync(root)) !== realpathSync(tmpdir())) throw new Error("Temporary boundary rejected");
    rmSync(root, { recursive: true, force: true });
  });

  function request() {
    const state = timelineService(handle).get(ids.main);
    if (!state.current) throw new Error("Missing synthetic timeline");
    return { projectId: ids.main, sourceId: scope.sourceId, selectionId: "video-cut-1",
      expectedRevision: state.project.contentRevision, expectedTimelineId: state.current.id, moveSceneId: ids.s1, afterSceneId: ids.s2 };
  }

  it("writes exactly one existing timeline revision after deliberate confirmation", () => {
    const apply = service();
    const input = request();
    const timeline = timelineService(handle);
    const previous = timeline.get(ids.main);
    const storageBefore = snapshotDb(handle.sqlite);
    const offer = apply.prepare(owner, videoPreview(), input);
    expect(offer).toMatchObject({ status: "ready", change: {
      kind: "move_existing_scene_after", fromPosition: 1, toPosition: 2, transition: { type: "cut", durationFrames: 0 },
      fixedTimingTracks: { text: 3, audio: 0 },
    } });
    if (offer.status !== "ready") throw new Error("Missing confirmation");
    expect(snapshotDb(handle.sqlite)).toEqual(storageBefore);
    expect(apply.apply(owner, offer.confirmation, false)).toEqual({ status: "confirmation_required" });
    expect(apply.apply(owner, { ...offer.confirmation }, true)).toEqual({ status: "confirmation_required" });
    expect(apply.apply(other, offer.confirmation, true)).toEqual({ status: "owner_required" });
    expect(snapshotDb(handle.sqlite)).toEqual(storageBefore);

    // Both confirmation and displayed change are bound to the original checked request.
    input.moveSceneId = ids.s3;
    const saved = apply.apply(owner, offer.confirmation, true);
    expect(saved).toMatchObject({ status: "applied", revision: previous.project.contentRevision + 1, timelineRevision: 2 });
    const current = timeline.get(ids.main);
    expect(current.history).toHaveLength(2);
    expect(current.timeline).toEqual({ ...previous.timeline, video: [
      previous.timeline!.video[1], previous.timeline!.video[0], previous.timeline!.video[2],
    ] });
    expect(handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(previous.current!.id)).toEqual(previous.row);
    expect(handle.sqlite.prepare("SELECT status FROM stage_states WHERE project_id=? AND stage='review'").get(ids.main))
      .toEqual({ status: "locked" });
    for (const output of [offer.change, saved, current.row!.timeline_json]) {
      expect(JSON.stringify(output)).not.toMatch(/private|sourceSeek|ptsMs|editGridApproximation|pixels|prompt|observations|992/);
    }

    expect(apply.apply(owner, offer.confirmation, true)).toEqual({ status: "conflict" });
    expect(apply.prepare(owner, videoPreview(), request())).toEqual({ status: "no_change" });
    expect(timeline.get(ids.main).history).toHaveLength(2);
  });

  it("rechecks ownership, active source and analysis revisions, and age at confirmation", () => {
    const apply = service();
    const input = request();
    const preview = videoPreview();
    const offer = apply.prepare(owner, preview, input);
    if (offer.status !== "ready") throw new Error("Missing confirmation");
    const before = snapshotDb(handle.sqlite);
    expect(apply.prepare(other, preview, input)).toEqual({ status: "owner_required" });
    expect(apply.prepare({ id: owner.id } as VerifiedActor, preview, input)).toEqual({ status: "owner_required" });
    expect(apply.prepare(owner, preview, { ...input, projectId: ids.archived })).toEqual({ status: "owner_required" });
    active = null;
    expect(apply.apply(owner, offer.confirmation, true)).toEqual({ status: "owner_required" });
    for (const changed of [{ sourceRevision: "new-source" }, { analysisRevision: "new-analysis" }]) {
      active = { ...scope, ...changed };
      expect(apply.apply(owner, offer.confirmation, true)).toEqual({ status: "stale" });
    }
    active = { ...scope };
    nowMs = analyzedAt + maxAgeMs + 1;
    expect(apply.apply(owner, offer.confirmation, true)).toEqual({ status: "stale" });
    expect(snapshotDb(handle.sqlite)).toEqual(before);
  });

  it("rejects unverified edits, unsupported image proposals, and invalid targets without writing", () => {
    const apply = service();
    const input = request();
    const preview = videoPreview();
    const before = snapshotDb(handle.sqlite);
    expect(apply.prepare(owner, preview, { ...input, selectedPts: 992 })).toEqual({ status: "invalid_request" });
    expect(apply.prepare(owner, preview, { ...input, selectionId: "video-frame-1" })).toEqual({ status: "unsupported_proposal" });
    expect(apply.prepare(owner, imagePreview(), { ...input, selectionId: "image-region-0" })).toEqual({ status: "unsupported_proposal" });
    expect(apply.prepare(owner, preview, { ...input, selectionId: "video-cut-2" })).toEqual({ status: "selection_unavailable" });
    expect(apply.prepare(owner, preview, { ...input, expectedRevision: input.expectedRevision - 1 })).toEqual({ status: "conflict" });
    expect(apply.prepare(owner, preview, { ...input, expectedTimelineId: ids.archived })).toEqual({ status: "conflict" });
    for (const afterSceneId of [ids.s1, ids.s3, ids.s4]) {
      expect(apply.prepare(owner, preview, { ...input, afterSceneId })).toEqual({ status: "target_unavailable" });
    }
    expect(snapshotDb(handle.sqlite)).toEqual(before);
  });

  it("returns a retryable status before writing and applies the same confirmation after the lock clears", () => {
    const competingHandle = openDatabase(path, { fileMustExist: true, timeout: 20 });
    handles.push(competingHandle);
    const apply = service(competingHandle);
    const offer = apply.prepare(owner, videoPreview(), request());
    if (offer.status !== "ready") throw new Error("Missing confirmation");
    const before = snapshotDb(handle.sqlite);
    handle.sqlite.transaction(() => {
      expect(apply.apply(owner, offer.confirmation, true)).toEqual({ status: "busy", retryable: true });
      expect(competingHandle.sqlite.inTransaction).toBe(false);
      expect(snapshotDb(competingHandle.sqlite)).toEqual(before);
    }).immediate();
    expect(snapshotDb(handle.sqlite)).toEqual(before);
    expect(apply.apply(owner, offer.confirmation, true)).toMatchObject({ status: "applied", timelineRevision: 2 });
    expect(timelineService(handle).get(ids.main).history).toHaveLength(2);
  });

  it("returns conflict if another confirmation commits after lock contention", () => {
    const competingHandle = openDatabase(path, { fileMustExist: true, timeout: 20 });
    handles.push(competingHandle);
    const first = service();
    const second = service(competingHandle);
    const input = request();
    const preview = videoPreview();
    const a = first.prepare(owner, preview, input);
    const b = second.prepare(owner, preview, input);
    if (a.status !== "ready" || b.status !== "ready") throw new Error("Missing confirmations");
    const before = snapshotDb(handle.sqlite);
    handle.sqlite.transaction(() => {
      expect(second.apply(owner, b.confirmation, true)).toEqual({ status: "busy", retryable: true });
      expect(snapshotDb(competingHandle.sqlite)).toEqual(before);
    }).immediate();
    expect(first.apply(owner, a.confirmation, true).status).toBe("applied");
    expect(second.apply(owner, b.confirmation, true)).toEqual({ status: "conflict" });
    expect(timelineService(competingHandle).get(ids.main).history).toHaveLength(2);
  });

  it("propagates a SQLite commit lock error after entering the write transaction", () => {
    // In rollback-journal mode a reader can hold a shared lock through the writer's COMMIT.
    expect(handle.sqlite.pragma("journal_mode = DELETE", { simple: true })).toBe("delete");
    handle.sqlite.pragma("busy_timeout = 20");
    const reader = openDatabase(path, { fileMustExist: true }, { wal: false });
    handles.push(reader);
    const resolveOwnedScope = vi.fn(readScope);
    const apply = referenceProjectApplyService(handle, { resolveOwnedScope, nowMs: () => nowMs, maxAgeMs });
    const offer = apply.prepare(owner, videoPreview(), request());
    if (offer.status !== "ready") throw new Error("Missing confirmation");
    resolveOwnedScope.mockClear();
    const lastWrite = vi.fn(() => null);
    handle.sqlite.function("rea_apply_last_write", lastWrite);
    handle.sqlite.exec(`CREATE TEMP TRIGGER observe_rea_apply_activity AFTER INSERT ON activity_log
      WHEN NEW.action = 'timeline.save' BEGIN SELECT rea_apply_last_write(); END`);
    const before = snapshotDb(handle.sqlite);
    reader.sqlite.transaction(() => {
      expect(snapshotDb(reader.sqlite)).toEqual(before);
      expect(() => apply.apply(owner, offer.confirmation, true))
        .toThrow(expect.objectContaining({ code: "SQLITE_BUSY" }));
      expect(resolveOwnedScope).toHaveBeenCalledTimes(1);
      expect(lastWrite).toHaveBeenCalledTimes(1);
      expect(handle.sqlite.inTransaction).toBe(false);
      expect(snapshotDb(reader.sqlite)).toEqual(before);
    }).deferred();
    expect(snapshotDb(handle.sqlite)).toEqual(before);
  });

  it("rolls back the write when the timeline pointer update fails and permits a safe retry", () => {
    const apply = service();
    const offer = apply.prepare(owner, videoPreview(), request());
    if (offer.status !== "ready") throw new Error("Missing confirmation");
    const before = snapshotDb(handle.sqlite);
    handle.sqlite.exec(`CREATE TEMP TRIGGER fail_rea_apply BEFORE UPDATE OF current_timeline_rev_id ON projects
      BEGIN SELECT RAISE(ABORT, 'synthetic pointer failure'); END`);
    expect(() => apply.apply(owner, offer.confirmation, true)).toThrow("synthetic pointer failure");
    handle.sqlite.exec("DROP TRIGGER fail_rea_apply");
    expect(snapshotDb(handle.sqlite)).toEqual(before);
    expect(apply.apply(owner, offer.confirmation, true).status).toBe("applied");
    expect(timelineService(handle).get(ids.main).history).toHaveLength(2);
  });
});
