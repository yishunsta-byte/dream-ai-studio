import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBackupManifest, verifyBackupArchive } from "../../lib/backup/archive";
import { referenceApplyPermissionGeneration } from "../../lib/reference-analysis/apply-lifecycle";
import { openDatabase, type DatabaseHandle } from "../../lib/db/connection";
import { migrateDatabase } from "../../lib/db/migrate";
import { timelineService } from "../../lib/services/timeline";
import { S4_ZIP, s4Ids } from "../fixtures/backups/s4-build";
import { snapshotDb } from "../fixtures/backups/s4-compare";
import { installSyntheticApplyTables, other, owner, storeFor } from "./atomic-apply-fixture";

vi.mock("server-only", () => ({}));

const ids = s4Ids();
const scope = { storeId: "synthetic-store", restoreGeneration: "restore-2", ownerId: owner.id, projectId: ids.main, assetId: ids.r1 };
const receiptGenerations = { linkGeneration: "link-1", scopePermissionGeneration: "grant-1", ownerPermissionGeneration: "owner-grant-1" };
const source = { linkGeneration: receiptGenerations.linkGeneration,
  permissionGeneration: referenceApplyPermissionGeneration(receiptGenerations), sourceRevision: "source-1" };
const snapshotSha256 = createHash("sha256").update("synthetic snapshot").digest("hex");
const analysis = { analysisId: "analysis-a", analysisRevision: "analysis-rev-a", snapshotSha256 };
const plan = { selectionId: "video-cut-1", moveSceneId: ids.s1, afterSceneId: ids.s2 };
const confirmationId = "synthetic-confirmation-a";
const unavailable = { status: "unavailable" };
const authority = {
  kind: "verified", scope, receiptAccess: "granted", receiptGenerations,
  execution: {
    kind: "verified", ...source, registeredSha256: snapshotSha256,
    analysis: { status: "active", ...source, ...analysis, completedAtMs: 70, validUntilMs: 190 },
  },
};

describe("atomic REA confirmation and receipt in a synthetic SQLite fixture", () => {
  let root: string;
  let databasePath: string;
  let handle: DatabaseHandle;
  let now: number;
  const handles: DatabaseHandle[] = [];
  const open = (timeout = 100) => {
    const db = openDatabase(databasePath, { fileMustExist: true, timeout });
    handles.push(db);
    return db;
  };
  const store = (db = handle) => storeFor(db, () => now);
  const setAuthority = (value: unknown) => handle.sqlite.prepare(
    "INSERT INTO rea_synthetic_authority(id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
  ).run(JSON.stringify(value));
  const row = (id = confirmationId) => handle.sqlite.prepare(
    "SELECT status, state_json, plan_json FROM rea_synthetic_apply WHERE id = ?",
  ).get(id);
  const current = () => timelineService(handle).get(ids.main);
  const pending = (key = confirmationId) => {
    const timeline = current();
    return {
      schemaVersion: 1, confirmationId: key, scope, status: "pending", issuedAtMs: 100, executionExpiresAtMs: 180,
      basis: { ...source, ...analysis, timelineId: timeline.current!.id, contentRevision: timeline.project.contentRevision },
    };
  };

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "dream-rea-atomic-")));
    const extracted = join(root, "fixture");
    await verifyBackupArchive(S4_ZIP, await readBackupManifest(S4_ZIP), extracted);
    databasePath = join(extracted, "data", "app.db");
    handle = open();
    migrateDatabase(handle.sqlite);
    installSyntheticApplyTables(handle);
    setAuthority(authority);
    now = 150;
  });
  afterEach(() => {
    for (const db of handles.splice(0)) db.close();
    const actual = realpathSync(root);
    if (dirname(actual) !== realpathSync(tmpdir())) throw new Error("Synthetic test boundary rejected");
    rmSync(actual, { recursive: true, force: true });
  });

  function worker(action: "apply" | "read", time: number, completionTime = time) {
    const script = `import {runSyntheticApplyWorker} from "./tests/reference-analysis/atomic-apply-fixture.ts";
      runSyntheticApplyWorker(process.argv[1], process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5]));`;
    return execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module",
      "-e", script, databasePath, action, confirmationId, String(time), String(completionTime)], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  }

  it("persists a bound plan and recovers a committed receipt from a fresh process after a lost response", () => {
    const before = current();
    const adapter = store();
    const input = pending();
    const mapping = { ...plan };
    expect(adapter.prepare(owner, input, mapping)).toEqual({ status: "prepared", confirmationId });
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    expect(adapter.apply(owner, confirmationId, false)).toEqual(unavailable);
    expect(adapter.apply(other, confirmationId, true)).toEqual(unavailable);
    expect(current().history).toHaveLength(1);
    mapping.moveSceneId = ids.s3;
    expect(adapter.prepare(owner, input, mapping)).toEqual(unavailable);
    handles.pop()!.close();

    // The first process commits and exits with no response, then a different process reads the receipt.
    expect(worker("apply", 150, 320)).toBe("");
    const result = JSON.parse(worker("read", 320));
    handle = open();
    const after = current();
    expect(after.timeline!.video.map(clip => clip.sceneId)).toEqual([ids.s2, ids.s1, ids.s3]);
    expect(after.timeline!.audio).toEqual(before.timeline!.audio);
    expect(after.timeline!.text).toEqual(before.timeline!.text);
    expect(after.history).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/Generation/);
    expect(result).toEqual({ status: "receipt", receipt: {
      outcome: "applied", timelineId: after.current!.id, timelineRevision: 2,
      contentRevision: before.project.contentRevision + 1, completedAtMs: 320,
    } });
    expect(row()).toMatchObject({ status: "completed", plan_json: null });
    expect(JSON.stringify(row())).not.toMatch(/snapshotSha256|selectionId|analysisId|moveSceneId|storagePath|https:/);
    now = 469;
    expect(store().apply(owner, confirmationId, true)).toEqual(result);
    now = 470;
    expect(store().readReceipt(owner, confirmationId)).toEqual(unavailable);
    expect(current().history).toHaveLength(2);
  }, 20_000);

  it("consumes once across two connections and terminates a different confirmation against the old CAS", () => {
    const first = store();
    const second = store(open());
    const competingId = "synthetic-competing";
    expect(first.prepare(owner, pending(), plan).status).toBe("prepared");
    expect(second.prepare(owner, pending(competingId), plan).status).toBe("prepared");
    expect(first.apply(owner, confirmationId, true)).toEqual({ status: "applied" });
    expect(second.apply(owner, confirmationId, true)).toMatchObject({ status: "receipt", receipt: { outcome: "applied" } });
    expect(second.apply(owner, competingId, true)).toEqual({ status: "conflict" });
    expect(row(competingId)).toEqual({ status: "conflict", state_json: null, plan_json: null });
    expect(current().history).toHaveLength(2);
    expect(handle.sqlite.prepare("SELECT count(*) AS n FROM activity_log WHERE action = 'timeline.save'").get()).toEqual({ n: 1 });
  });

  it("rolls back consumed confirmation, timeline, workflow and log when receipt finalization fails", () => {
    const adapter = store();
    expect(adapter.prepare(owner, pending(), plan).status).toBe("prepared");
    const before = snapshotDb(handle.sqlite);
    const reached = vi.fn(() => null);
    handle.sqlite.function("rea_receipt_reached", reached);
    handle.sqlite.exec(`CREATE TEMP TRIGGER fail_rea_receipt BEFORE UPDATE ON rea_synthetic_apply
      WHEN NEW.status = 'completed' BEGIN
        SELECT rea_receipt_reached();
        SELECT RAISE(ABORT, 'synthetic receipt failure');
      END`);
    expect(() => adapter.apply(owner, confirmationId, true)).toThrow("synthetic receipt failure");
    expect(reached).toHaveBeenCalledOnce();
    handle.sqlite.exec("DROP TRIGGER fail_rea_receipt");
    expect(snapshotDb(handle.sqlite)).toEqual(before);
    expect(row()).toMatchObject({ status: "pending" });
    expect(adapter.apply(owner, confirmationId, true)).toEqual({ status: "applied" });
    expect(current().history).toHaveLength(2);
  });

  it("rolls back the entire write on a bad completion clock or retention overflow", () => {
    expect(store().prepare(owner, pending(), plan).status).toBe("prepared");
    const before = snapshotDb(handle.sqlite);
    const reached = vi.fn(() => null);
    handle.sqlite.function("rea_last_timeline_write", reached);
    handle.sqlite.exec(`CREATE TEMP TRIGGER observe_rea_timeline AFTER INSERT ON activity_log
      WHEN NEW.action = 'timeline.save' BEGIN SELECT rea_last_timeline_write(); END`);
    for (const completion of [149, Number.NaN, Number.POSITIVE_INFINITY, 320.5, Number.MAX_SAFE_INTEGER]) {
      reached.mockClear();
      const clock = vi.fn().mockReturnValueOnce(150).mockReturnValueOnce(completion);
      expect(() => storeFor(handle, clock).apply(owner, confirmationId, true))
        .toThrow("REA_RECEIPT_COMPLETION_TIME_INVALID");
      expect(clock).toHaveBeenCalledTimes(2);
      expect(reached).toHaveBeenCalledOnce();
      expect(snapshotDb(handle.sqlite)).toEqual(before);
    }
    const failedClock = vi.fn().mockReturnValueOnce(150).mockImplementationOnce(() => { throw new Error("clock unavailable"); });
    expect(() => storeFor(handle, failedClock).apply(owner, confirmationId, true)).toThrow("clock unavailable");
    expect(snapshotDb(handle.sqlite)).toEqual(before);
    expect(store().apply(owner, confirmationId, true)).toEqual({ status: "applied" });
  });

  it("keeps the pending confirmation during a native writer lock timeout", () => {
    const adapter = store(open(20));
    expect(adapter.prepare(owner, pending(), plan).status).toBe("prepared");
    const before = snapshotDb(handle.sqlite);
    handle.sqlite.transaction(() => {
      expect(adapter.apply(owner, confirmationId, true)).toEqual({ status: "busy", retryable: true });
      expect(snapshotDb(handle.sqlite)).toEqual(before);
    }).immediate();
    expect(adapter.apply(owner, confirmationId, true)).toEqual({ status: "applied" });
    expect(current().history).toHaveLength(2);
  });

  it("keeps cancellation, lost authority and old restore generations outside execution", () => {
    const adapter = store();
    const cancelledId = "synthetic-cancelled";
    expect(adapter.prepare(owner, pending(cancelledId), plan).status).toBe("prepared");
    expect(adapter.prepare(owner, pending(), plan).status).toBe("prepared");
    expect(adapter.cancel(other, cancelledId)).toEqual(unavailable);
    expect(adapter.cancel(owner, cancelledId)).toEqual({ status: "cancelled" });
    expect(adapter.apply(owner, cancelledId, true)).toEqual(unavailable);
    expect(adapter.prepare(owner, pending(cancelledId), plan)).toEqual(unavailable);
    for (const changed of [
      { ...authority, execution: null, receiptAccess: "denied" },
      { ...authority, scope: { ...scope, restoreGeneration: "restored-new" } },
      { ...authority, execution: { ...authority.execution, permissionGeneration: "revoked-generation" } },
    ]) {
      setAuthority(changed);
      expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
      expect(current().history).toHaveLength(1);
    }
    expect(adapter.apply(owner, "unknown-id", true)).toEqual(unavailable);
  });

  it("records no_change without a timeline write and enforces current receipt access and retention", () => {
    const adapter = store();
    expect(adapter.prepare(owner, pending(), { ...plan, moveSceneId: ids.s2, afterSceneId: ids.s1 }).status).toBe("prepared");
    const before = current();
    const clock = vi.fn().mockReturnValueOnce(150).mockReturnValueOnce(160);
    expect(storeFor(handle, clock).apply(owner, confirmationId, true)).toEqual({ status: "no_change" });
    expect(clock).toHaveBeenCalledTimes(2);
    now = 160;
    expect(current().history).toEqual(before.history);
    expect(handle.sqlite.prepare("SELECT count(*) AS n FROM activity_log WHERE action = 'timeline.save'").get()).toEqual({ n: 0 });
    expect(adapter.apply(owner, confirmationId, true)).toMatchObject({ status: "receipt", receipt: { outcome: "no_change", timelineId: before.current!.id, completedAtMs: 160 } });
    expect(adapter.cancel(owner, confirmationId)).toEqual(unavailable);
    setAuthority({ ...authority, execution: null, receiptAccess: "denied" });
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    setAuthority({ ...authority, scope: { ...scope, restoreGeneration: "restored-new" } });
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    setAuthority({ ...authority, execution: null });
    now = 309;
    expect(adapter.readReceipt(owner, confirmationId)).toMatchObject({ status: "receipt" });
    now = 310;
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    expect(current().history).toEqual(before.history);
  });

  it("rejects copied pending and receipt rows after the fixture adopts a new restore generation", async () => {
    const adapter = store();
    const savedId = "synthetic-completed-before-copy";
    expect(adapter.prepare(owner, pending(), plan).status).toBe("prepared");
    expect(adapter.prepare(owner, pending(savedId), { ...plan, moveSceneId: ids.s2, afterSceneId: ids.s1 }).status).toBe("prepared");
    expect(adapter.apply(owner, savedId, true)).toEqual({ status: "no_change" });

    const copy = join(root, "restore-fixture.db");
    await handle.sqlite.backup(copy);
    const restored = openDatabase(copy, { fileMustExist: true });
    handles.push(restored);
    restored.sqlite.prepare("UPDATE rea_synthetic_authority SET payload = ? WHERE id = 1")
      .run(JSON.stringify({ ...authority, scope: { ...scope, restoreGeneration: "restore-3" } }));
    const before = snapshotDb(restored.sqlite);
    expect(store(restored).apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(store(restored).readReceipt(owner, savedId)).toEqual(unavailable);
    expect(snapshotDb(restored.sqlite)).toEqual(before);
    expect(current().history).toHaveLength(1);
  });

  it("rejects receipts after revoke and regrant, and leaves legacy rows closed", () => {
    const adapter = store();
    expect(adapter.prepare(owner, pending(), plan).status).toBe("prepared");
    setAuthority({ ...authority, receiptGenerations: undefined });
    const blocked = snapshotDb(handle.sqlite);
    expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(blocked);
    setAuthority({ ...authority, receiptGenerations: { ...receiptGenerations, ownerPermissionGeneration: "tampered" } });
    expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(row()).toMatchObject({ status: "pending" });

    setAuthority(authority);
    expect(adapter.apply(owner, confirmationId, true)).toEqual({ status: "applied" });
    setAuthority({ ...authority, execution: null, receiptAccess: "denied" });
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    setAuthority({ ...authority, receiptGenerations: { ...receiptGenerations, ownerPermissionGeneration: "owner-grant-2" } });
    const regranted = snapshotDb(handle.sqlite);
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(regranted);

    setAuthority(authority);
    const stored = handle.sqlite.prepare("SELECT state_json FROM rea_synthetic_apply WHERE id = ?")
      .pluck().get(confirmationId);
    const completed = JSON.parse(String(stored));
    expect(completed).toMatchObject({ schemaVersion: 2, receiptGenerations });
    const legacy = { ...completed, schemaVersion: 1, receiptGenerations: undefined };
    handle.sqlite.prepare("UPDATE rea_synthetic_apply SET state_json = ? WHERE id = ?").run(JSON.stringify(legacy), confirmationId);
    const beforeLegacy = snapshotDb(handle.sqlite);
    expect(adapter.readReceipt(owner, confirmationId)).toEqual(unavailable);
    expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(beforeLegacy);
    expect(current().history).toHaveLength(2);
  });

  it.each(["expired", "stale", "conflict"] as const)("proves the pending authority before retiring as %s", (status) => {
    const adapter = store();
    const input = pending();
    expect(adapter.prepare(owner, input, plan).status).toBe("prepared");
    if (status === "expired") now = input.executionExpiresAtMs;
    const execution = {
      ...authority.execution,
      analysis: { ...authority.execution.analysis, analysisId: status === "stale" ? "new-analysis" : analysis.analysisId },
    };
    if (status === "conflict") {
      handle.sqlite.prepare("UPDATE projects SET content_revision = content_revision + 1 WHERE id = ?").run(scope.projectId);
    }
    const valid = { ...authority, execution };
    const oldPermission = "legacy-grant";
    const updateBasis = handle.sqlite.prepare("UPDATE rea_synthetic_apply SET state_json = ? WHERE id = ?");
    for (const denied of [
      { ...valid, receiptGenerations: undefined },
      { ...valid, receiptGenerations: { ...receiptGenerations, ownerPermissionGeneration: "other-owner-grant" } },
    ]) {
      setAuthority(denied);
      const before = snapshotDb(handle.sqlite);
      expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
      expect(adapter.cancel(owner, confirmationId)).toEqual(unavailable);
      expect(snapshotDb(handle.sqlite)).toEqual(before);
    }

    updateBasis.run(JSON.stringify({ ...input, basis: { ...input.basis, permissionGeneration: oldPermission } }), confirmationId);
    setAuthority({ ...valid, execution: {
      ...execution, permissionGeneration: oldPermission, analysis: { ...execution.analysis, permissionGeneration: oldPermission },
    } });
    const legacy = snapshotDb(handle.sqlite);
    expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(adapter.cancel(owner, confirmationId)).toEqual(unavailable);
    expect(snapshotDb(handle.sqlite)).toEqual(legacy);

    updateBasis.run(JSON.stringify(input), confirmationId);
    setAuthority(valid);
    expect(adapter.apply(owner, confirmationId, true)).toEqual({ status });
    expect(row()).toEqual({ status, state_json: null, plan_json: null });
    expect(current().history).toHaveLength(1);
  });

  it("terminalizes authorized expiry and refuses unknown persisted consumption", () => {
    const adapter = store();
    expect(adapter.prepare(owner, pending(), plan).status).toBe("prepared");
    const uncertainId = "synthetic-unconfirmed";
    expect(adapter.prepare(owner, pending(uncertainId), plan).status).toBe("prepared");
    handle.sqlite.prepare("UPDATE rea_synthetic_apply SET status = 'consuming' WHERE id = ?").run(uncertainId);
    expect(adapter.apply(owner, uncertainId, true)).toEqual(unavailable);
    now = 180;
    expect(adapter.apply(owner, confirmationId, true)).toEqual({ status: "expired" });
    expect(row()).toEqual({ status: "expired", state_json: null, plan_json: null });
    now = 150;
    expect(adapter.apply(owner, confirmationId, true)).toEqual(unavailable);
    expect(current().history).toHaveLength(1);
  });
});
