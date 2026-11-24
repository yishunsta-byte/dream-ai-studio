import { openDatabase, type DatabaseHandle } from "../../lib/db/connection";
import { actorFromVerifiedUserId, type VerifiedActor } from "../../lib/db/postgres/types";
import { syntheticReferenceApplyStore } from "../../lib/reference-analysis/synthetic-apply-store";

export const owner = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000040");
export const other = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000041");

export function installSyntheticApplyTables(handle: DatabaseHandle) {
  handle.sqlite.exec(`
    CREATE TABLE rea_synthetic_apply (
      id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('pending','consuming','completed','cancelled','expired','stale','conflict')),
      state_json TEXT CHECK (json_valid(state_json) OR state_json IS NULL),
      plan_json TEXT CHECK (json_valid(plan_json) OR plan_json IS NULL)
    );
    CREATE TABLE rea_synthetic_authority (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL CHECK (json_valid(payload)));
  `);
}

export function storeFor(handle: DatabaseHandle, nowMs: () => number) {
  return syntheticReferenceApplyStore(handle, {
    nowMs, receiptRetentionMs: 150,
    resolveAuthority(db: DatabaseHandle, actor: VerifiedActor, scope) {
      if (db !== handle || !db.sqlite.inTransaction) throw new Error("Synthetic authority read outside the transaction");
      if (actor.id !== owner.id) return null;
      const row = db.sqlite.prepare<[], { payload: string }>("SELECT payload FROM rea_synthetic_authority WHERE id = 1").get();
      if (!row) return null;
      const authority = JSON.parse(row.payload);
      if (authority.execution) {
        const project = db.sqlite.prepare<[string], { timelineId: string; contentRevision: number }>(
          "SELECT current_timeline_rev_id AS timelineId, content_revision AS contentRevision FROM projects WHERE id = ? AND archived_at IS NULL",
        ).get(scope.projectId);
        authority.execution.timeline = project;
      }
      return authority;
    },
  });
}

export function runSyntheticApplyWorker(path: string, action: string, confirmationId: string, startedAtMs: number, completedAtMs: number) {
  const handle = openDatabase(path, { fileMustExist: true });
  try {
    let now = startedAtMs;
    const store = storeFor(handle, () => now);
    if (action === "apply") {
      handle.sqlite.function("advance_synthetic_clock", () => { now = completedAtMs; return null; });
      handle.sqlite.exec(`CREATE TEMP TRIGGER advance_rea_clock AFTER INSERT ON activity_log
        WHEN NEW.action = 'timeline.save' BEGIN SELECT advance_synthetic_clock(); END`);
      const result = store.apply(owner, confirmationId, true);
      if (result.status !== "applied") throw new Error("Synthetic worker failed to apply");
      return;
    }
    if (action !== "read") throw new Error("Unknown synthetic action");
    process.stdout.write(JSON.stringify(store.readReceipt(owner, confirmationId)));
  } finally { handle.close(); }
}
