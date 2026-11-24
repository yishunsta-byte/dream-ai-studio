import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBackupManifest, verifyBackupArchive } from "../../lib/backup/archive";
import { openDatabase, type DatabaseHandle } from "../../lib/db/connection";
import { migrateDatabase } from "../../lib/db/migrate";
import * as tools from "../../lib/media/tools";
import { timelineService } from "../../lib/services/timeline";
import { S4_ZIP, s4Ids } from "../fixtures/backups/s4-build";
import { snapshotDb } from "../fixtures/backups/s4-compare";
import { other, owner } from "./atomic-apply-fixture";
import { installIsolatedReferenceFixture, isolatedApplyStore, prepareIsolatedCut, referencePurpose } from "./isolated-rea-fixture";

vi.mock("server-only", () => ({}));

const ids = s4Ids();
const assetId = "10000000-0000-4000-8000-000000000060";
const request = { projectId: ids.main, assetId, selectionId: "video-cut-1", moveSceneId: ids.s1, afterSceneId: ids.s2 };
const unavailable = { status: "unavailable" };
const start = 100;

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("registered media to applied receipt in isolated SQLite", () => {
  let root: string;
  let managedRoot: string;
  let path: string;
  let databasePath: string;
  let handle: DatabaseHandle;
  let original: Buffer;
  let now: number;
  const handles: DatabaseHandle[] = [];

  function open(file = databasePath) {
    const db = openDatabase(file, { fileMustExist: true });
    handles.push(db);
    return db;
  }
  const prepare = (actor = owner, input = request) => prepareIsolatedCut(handle, managedRoot, actor, () => now, input);
  const store = (db = handle) => isolatedApplyStore(db, managedRoot, () => now);
  const current = () => timelineService(handle).get(ids.main);
  const analysisRows = () => handle.sqlite.prepare("SELECT count(*) AS n FROM rea_e2e_analysis").get();
  const confirmationRows = () => handle.sqlite.prepare("SELECT count(*) AS n FROM rea_synthetic_apply").get();
  const savedActions = () => handle.sqlite.prepare("SELECT count(*) AS n FROM activity_log WHERE action = 'timeline.save'").get();

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "dream-rea-e2e-")));
    const extracted = join(root, "fixture");
    await verifyBackupArchive(S4_ZIP, await readBackupManifest(S4_ZIP), extracted);
    databasePath = join(extracted, "data", "app.db");
    handle = open();
    migrateDatabase(handle.sqlite);
    managedRoot = join(root, "synthetic-media");
    mkdirSync(managedRoot);
    path = join(managedRoot, "registered-source.mp4");
    const suffix = process.platform === "win32" ? ".exe" : "";
    const ffmpeg = join(tools.mediaToolsFolder(), "ffmpeg" + suffix);
    vi.stubEnv("FFMPEG_PATH", ffmpeg);
    vi.stubEnv("FFPROBE_PATH", join(tools.mediaToolsFolder(), "ffprobe" + suffix));
    await tools.runMedia(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-f", "lavfi", "-i", "color=red:s=32x24:r=30:d=1", "-f", "lavfi", "-i", "color=cyan:s=32x24:r=30:d=1",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4", path,
    ], { timeout: 15_000, windowsHide: true });
    original = readFileSync(path);
    installIsolatedReferenceFixture(handle, managedRoot, ids.main, assetId);
    now = start;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const db of handles.splice(0)) db.close();
    const actual = realpathSync(root);
    if (dirname(actual) !== realpathSync(tmpdir()) || !basename(actual).startsWith("dream-rea-e2e-")) {
      throw new Error("Synthetic cleanup boundary rejected");
    }
    rmSync(actual, { recursive: true, force: true });
  });

  function worker(action: "apply" | "receipt", id: string, when: number) {
    const script = `import {runIsolatedReferenceWorker} from "./tests/reference-analysis/isolated-rea-fixture.ts";
      runIsolatedReferenceWorker(process.argv[1], process.argv[2], process.argv[3], process.argv[4], Number(process.argv[5]));`;
    return execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module",
      "-e", script, databasePath, managedRoot, action, id, String(when)], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  }

  it("applies a real observed cut once across processes and recovers the receipt after the response is lost", async () => {
    const initial = current();
    const offer = await prepare();
    expect(offer).toMatchObject({ status: "prepared", preview: { status: "ready", proposals: [{
      sourceSeek: { kind: "observed_pts", ptsMs: 1_000 },
      observations: [{ kind: "observation", measure: "adjacent_rgb_mean_difference", score: expect.any(Number) },
        { kind: "observation", measure: "decoded_frame" }],
      inference: { kind: "inference", measure: "candidate_cut", location: { startMs: 967, endMs: 1_000 } },
      draft: { kind: "creative_proposal", editGridApproximation: { fps: 30, frame: 30 },
        transition: { type: "cut", durationFrames: 0 } },
    }] } });
    expect(JSON.stringify(offer)).not.toMatch(/sha256|registered-source|pixels|filePath|server-source|restoreGeneration/);
    if (offer.status !== "prepared") throw new Error("Missing synthetic confirmation");
    expect(current().history).toEqual(initial.history);
    expect(analysisRows()).toEqual({ n: 1 });
    const storedAnalysis = handle.sqlite.prepare<[], { analysis_json: string }>("SELECT analysis_json FROM rea_e2e_analysis").get();
    expect(JSON.parse(storedAnalysis!.analysis_json)).toMatchObject({
      snapshotSha256: createHash("sha256").update(original).digest("hex"),
    });
    expect(confirmationRows()).toEqual({ n: 1 });
    const beforeConfirmation = snapshotDb(handle.sqlite);
    expect(store().apply(owner, offer.confirmationId, false)).toEqual(unavailable);
    expect(store().readReceipt(owner, offer.confirmationId)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(beforeConfirmation);
    handles.pop()!.close();

    expect(worker("apply", offer.confirmationId, 120)).toBe("");
    const received = JSON.parse(worker("receipt", offer.confirmationId, 235));
    handle = open();
    const updated = current();
    expect(updated.timeline!.video.map(clip => clip.sceneId)).toEqual([ids.s2, ids.s1, ids.s3]);
    expect(updated.timeline!.text).toEqual(initial.timeline!.text);
    expect(updated.timeline!.audio).toEqual(initial.timeline!.audio);
    expect(received).toEqual({ status: "receipt", receipt: {
      outcome: "applied", timelineId: updated.current!.id, timelineRevision: 2,
      contentRevision: initial.project.contentRevision + 1, completedAtMs: 120,
    } });
    expect(JSON.stringify(received)).not.toMatch(/sha256|registered-source|pixels|filePath|restoreGeneration|analysisId/);
    expect(updated.history).toHaveLength(2);
    expect(savedActions()).toEqual({ n: 1 });
    const afterSave = snapshotDb(handle.sqlite);
    now = 235;
    expect(store().apply(owner, offer.confirmationId, true)).toEqual(received);
    expect(store().readReceipt(other, offer.confirmationId)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(afterSave);
    handle.sqlite.prepare("UPDATE rea_e2e_grant SET active = 0, permission_generation = 'grant-revoked'").run();
    expect(store().readReceipt(owner, offer.confirmationId)).toEqual(unavailable);
    handle.sqlite.prepare("UPDATE rea_e2e_grant SET active = 1, permission_generation = 'grant-reapproved'").run();
    const afterRegrant = snapshotDb(handle.sqlite);
    expect(store().readReceipt(owner, offer.confirmationId)).toEqual(unavailable);
    expect(store().apply(owner, offer.confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(afterRegrant);
    expect(readFileSync(path)).toEqual(original);
  }, 20_000);

  it("rejects other owners and a revoked or renewed project link", async () => {
    const initial = snapshotDb(handle.sqlite);
    const spy = vi.spyOn(tools, "runMedia");
    try {
      expect(await prepare(other)).toEqual(unavailable);
      expect(await prepare(owner, { ...request, projectId: ids.archived })).toEqual(unavailable);
      expect(spy).not.toHaveBeenCalled();
      expect(snapshotDb(handle.sqlite)).toEqual(initial);
    } finally { spy.mockRestore(); }

    const offer = await prepare();
    if (offer.status !== "prepared") throw new Error("Missing synthetic confirmation");
    const beforeAttempt = snapshotDb(handle.sqlite);
    expect(store().apply(other, offer.confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(beforeAttempt);
    handle.sqlite.prepare("DELETE FROM project_assets WHERE project_id = ? AND asset_id = ? AND purpose = ?")
      .run(ids.main, assetId, referencePurpose);
    const revoked = snapshotDb(handle.sqlite);
    expect(store().apply(owner, offer.confirmationId, true)).toEqual(unavailable);
    expect(await prepare()).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(revoked);
    handle.sqlite.prepare("INSERT INTO project_assets(project_id,asset_id,purpose) VALUES (?,?,?)").run(ids.main, assetId, referencePurpose);
    handle.sqlite.prepare("UPDATE rea_e2e_grant SET link_generation = 'link-renewed'").run();
    const renewed = snapshotDb(handle.sqlite);
    expect(store().apply(owner, offer.confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(renewed);
    expect(savedActions()).toEqual({ n: 0 });
  });

  it("leaves the database unchanged when same-size bytes differ before analysis or after confirmation preparation", async () => {
    const changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    writeFileSync(path, changed);
    const initial = snapshotDb(handle.sqlite);
    expect(await prepare()).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(initial);
    expect(analysisRows()).toEqual({ n: 0 });
    writeFileSync(path, original);
    const offer = await prepare();
    if (offer.status !== "prepared") throw new Error("Missing synthetic confirmation");
    writeFileSync(path, changed);
    const before = snapshotDb(handle.sqlite);
    expect(store().apply(owner, offer.confirmationId, true)).toEqual(unavailable);
    expect(store().readReceipt(owner, offer.confirmationId)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(before);
    expect(savedActions()).toEqual({ n: 0 });
  });

  it("rechecks the authority that was read before analysis and refuses late publication after revocation", async () => {
    const native = tools.runMedia;
    let changed = false;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (args[0] === process.env.FFPROBE_PATH && !changed) {
        changed = true;
        handle.sqlite.prepare("UPDATE rea_e2e_grant SET active = 0, permission_generation = 'grant-revoked'").run();
      }
      return native(...args);
    });
    try {
      expect(await prepare()).toEqual(unavailable);
      expect(changed).toBe(true);
      expect(analysisRows()).toEqual({ n: 0 });
      expect(confirmationRows()).toEqual({ n: 0 });
      expect(savedActions()).toEqual({ n: 0 });
    } finally { spy.mockRestore(); }
  });

  it("refuses the old pending confirmation and receipt in a copied SQLite file with a new restore generation", async () => {
    const completed = await prepare();
    if (completed.status !== "prepared") throw new Error("Missing synthetic confirmation");
    expect(store().apply(owner, completed.confirmationId, true)).toEqual({ status: "applied" });
    const pending = await prepare(owner, { ...request, moveSceneId: ids.s2, afterSceneId: ids.s1 });
    if (pending.status !== "prepared") throw new Error("Missing pending confirmation");

    const copy = join(root, "restore-copy.db");
    await handle.sqlite.backup(copy);
    const restored = open(copy);
    restored.sqlite.prepare("UPDATE rea_e2e_workspace SET restore_generation = 'restore-2' WHERE id = 1").run();
    const before = snapshotDb(restored.sqlite);
    expect(store(restored).readReceipt(owner, completed.confirmationId)).toEqual(unavailable);
    expect(store(restored).apply(owner, pending.confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(restored.sqlite)).toEqual(before);
    expect(store().readReceipt(owner, completed.confirmationId)).toMatchObject({ status: "receipt" });
    expect(savedActions()).toEqual({ n: 1 });
  });

  it("never prepares a confirmation for a frame-only observation or a fabricated cut selection", async () => {
    const initial = snapshotDb(handle.sqlite);
    for (const selectionId of ["video-frame-1", "video-cut-99"]) {
      expect(await prepare(owner, { ...request, selectionId })).toEqual(unavailable);
    }
    expect(snapshotDb(handle.sqlite)).toEqual(initial);
  });

  it("preserves the previous analysis and confirmation after invalid targets, unexpected errors and write failures", async () => {
    const earlier = await prepare();
    if (earlier.status !== "prepared") throw new Error("Missing earlier confirmation");
    const before = snapshotDb(handle.sqlite);
    const active = () => handle.sqlite.prepare("SELECT * FROM rea_e2e_analysis WHERE asset_id = ?").get(assetId);
    const earlierAnalysis = active();
    for (const afterSceneId of [ids.s4, ids.s3]) {
      expect(await prepare(owner, { ...request, afterSceneId })).toEqual(unavailable);
      expect(snapshotDb(handle.sqlite)).toEqual(before);
    }

    const fault = new Error("synthetic preparation clock failure");
    const clock = () => {
      if (handle.sqlite.inTransaction) {
        expect(active()).not.toEqual(earlierAnalysis);
        throw fault;
      }
      return now;
    };
    await expect(prepareIsolatedCut(handle, managedRoot, owner, clock, request)).rejects.toBe(fault);
    expect(snapshotDb(handle.sqlite)).toEqual(before);

    const reached = vi.fn(() => null);
    handle.sqlite.function("rea_failed_confirmation_write", reached);
    handle.sqlite.exec(`CREATE TEMP TRIGGER fail_new_rea_confirmation BEFORE INSERT ON rea_synthetic_apply
      BEGIN SELECT rea_failed_confirmation_write(); SELECT RAISE(ABORT, 'synthetic confirmation insert failure'); END`);
    try {
      await expect(prepare()).rejects.toThrow("synthetic confirmation insert failure");
      expect(reached).toHaveBeenCalledOnce();
    } finally { handle.sqlite.exec("DROP TRIGGER fail_new_rea_confirmation"); }
    expect(snapshotDb(handle.sqlite)).toEqual(before);

    expect(store().apply(owner, earlier.confirmationId, true)).toEqual({ status: "applied" });
    expect(savedActions()).toEqual({ n: 1 });
  });

  it("replaces the active analysis only with a successfully prepared confirmation", async () => {
    const first = await prepare();
    if (first.status !== "prepared") throw new Error("Missing first confirmation");
    const stored = () => handle.sqlite.prepare("SELECT * FROM rea_e2e_analysis WHERE asset_id = ?").get(assetId);
    const earlier = stored();
    const second = await prepare();
    if (second.status !== "prepared") throw new Error("Missing second confirmation");
    expect(second.confirmationId).not.toBe(first.confirmationId);
    expect(stored()).not.toEqual(earlier);
    expect(analysisRows()).toEqual({ n: 1 });
    expect(confirmationRows()).toEqual({ n: 2 });
    expect(store().apply(owner, first.confirmationId, true)).toEqual({ status: "stale" });
    expect(store().apply(owner, second.confirmationId, true)).toEqual({ status: "applied" });
    expect(savedActions()).toEqual({ n: 1 });
  });

  it("rolls back analysis replacement if a second connection changes the timeline during preparation", async () => {
    const earlier = await prepare();
    if (earlier.status !== "prepared") throw new Error("Missing earlier confirmation");
    const competitor = open();
    const service = timelineService(competitor);
    const state = service.get(ids.main);
    if (!state.timeline || !state.current) throw new Error("Missing competing timeline");

    const native = tools.runMedia;
    let afterCompetingSave: ReturnType<typeof snapshotDb> | undefined;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (args[0] === process.env.FFPROBE_PATH && !afterCompetingSave) {
        const video = [...state.timeline!.video].reverse();
        expect(service.save(ids.main, state.project.contentRevision, state.current!.id, { ...state.timeline!, video }).created)
          .toBe(true);
        afterCompetingSave = snapshotDb(competitor.sqlite);
      }
      return native(...args);
    });
    try {
      expect(await prepare()).toEqual(unavailable);
      expect(afterCompetingSave).toBeDefined();
      expect(snapshotDb(handle.sqlite)).toEqual(afterCompetingSave);
    } finally { spy.mockRestore(); }

    expect(store().apply(owner, earlier.confirmationId, true)).toEqual({ status: "conflict" });
    expect(store().readReceipt(owner, earlier.confirmationId)).toEqual(unavailable);
    expect(savedActions()).toEqual({ n: 1 });
  });});
