import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createPostgresPool } from "./connection";
import { PostgresMigrationError } from "./migration-manifest";
import { loadPostgresMigrationsV2, postgresMigrationManifestsV2, requirePostgresSchemaVersionV2, type PostgresSchemaVersionV2 } from "./migration-manifest-v2";
import { inspectPostgresMigrationStateV2 } from "./migration-state-v2";
import { inspectMigrationTarget, isSessionMigrationProfile, type MigrationTarget } from "./migration-target";
import { migrationLock } from "./migration-runner";

export type PostgresMigrationOutcomeV2 = "not-applied" | "committed" | "unknown";
export class PostgresMigrationFailureV2 extends PostgresMigrationError {
  constructor(readonly outcome: PostgresMigrationOutcomeV2) { super("MIGRATION_FAILED"); }
}
// Approval binding is a fingerprint, not proof of human authorization. It binds
// the reviewed target hash, explicit schema version/mode and ordered fixed manifest.
export function postgresMigrationApprovalHashV2(version: unknown, targetHash: string, mode: "apply" | "dry-run"): string {
  const selected = requirePostgresSchemaVersionV2(version);
  if (typeof targetHash !== "string" || !/^[a-f0-9]{64}$/.test(targetHash) || (mode !== "apply" && mode !== "dry-run")) throw new PostgresMigrationError("MIGRATION_TARGET");
  return createHash("sha256").update(JSON.stringify({ runnerVersion: 2, schemaVersion: selected, targetHash, mode,
    manifest: postgresMigrationManifestsV2[selected].map(({ id, checksum }) => ({ id, checksum })) })).digest("hex");
}
export type PostgresMigrationOptionsV2 = Readonly<{
  version: PostgresSchemaVersionV2; mode: "dry-run" | "apply"; target: MigrationTarget;
  expectedTargetHash: string; expectedApprovalHash: string; ca?: string; sourceRoot?: URL;
}>;
const targetKeys = ["connectionString", "profile", "projectRef", "sessionHost", "sessionPort", "sessionDatabase", "sessionUsername", "sessionRole"];
function dataObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new PostgresMigrationError("MIGRATION_TARGET");
  const snapshot: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !keys.includes(key) || !("value" in property)) throw new PostgresMigrationError("MIGRATION_TARGET");
    snapshot[key] = property.value;
  }
  return snapshot;
}
const journalSql = "CREATE SCHEMA dream_migrations; REVOKE ALL ON SCHEMA dream_migrations FROM PUBLIC; CREATE TABLE dream_migrations.history(ordinal integer PRIMARY KEY CHECK(ordinal>0),id text NOT NULL UNIQUE,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()); REVOKE ALL ON TABLE dream_migrations.history FROM PUBLIC";
export { journalSql as postgresMigrationJournalSqlV2 };

export async function runPostgresMigrationsV2(input: PostgresMigrationOptionsV2) {
  // Snapshot before the first await. No caller pool, factory, client or hooks.
  const options = dataObject(input, ["version", "mode", "target", "expectedTargetHash", "expectedApprovalHash", "ca", "sourceRoot"]);
  const version = requirePostgresSchemaVersionV2(options.version);
  const primitiveTarget = dataObject(options.target, targetKeys);
  if (Object.values(primitiveTarget).some(value => value !== undefined && typeof value !== "string")) throw new PostgresMigrationError("MIGRATION_TARGET");
  const approvedTarget = Object.freeze(primitiveTarget) as MigrationTarget;
  const mode = options.mode, expectedTargetHash = options.expectedTargetHash, expectedApprovalHash = options.expectedApprovalHash;
  if (mode !== "dry-run" && mode !== "apply") throw new PostgresMigrationError("MIGRATION_TARGET");
  if (options.ca !== undefined && typeof options.ca !== "string") throw new PostgresMigrationError("MIGRATION_TARGET");
  const ca = options.ca as string | undefined;
  let sourceRoot: URL | undefined;
  if (options.sourceRoot !== undefined) {
    if (!(options.sourceRoot instanceof URL)) throw new PostgresMigrationError("MIGRATION_SOURCE");
    sourceRoot = new URL(options.sourceRoot.href);
  }
  const target = inspectMigrationTarget(approvedTarget);
  const approvalHash = postgresMigrationApprovalHashV2(version, target.targetHash, mode);
  if (expectedTargetHash !== target.targetHash || expectedApprovalHash !== approvalHash ||
    (isSessionMigrationProfile(approvedTarget.profile) && !ca?.trim())) throw new PostgresMigrationError("MIGRATION_TARGET");
  const source = await loadPostgresMigrationsV2(version, sourceRoot);
  const manifest = Object.freeze(source.map(({ id, checksum }) => Object.freeze({ id, checksum })));

  let pool: Pool;
  try { pool = createPostgresPool({ connectionString: approvedTarget.connectionString, max: 1, ...(ca ? { ca } : {}),
    ...(approvedTarget.profile === "synthetic" ? { localTestWithoutTls: true } : {}) }); }
  catch { throw new PostgresMigrationError("MIGRATION_TARGET"); }
  let client: PoolClient | undefined, begun = false, committing = false, destroy = false, poisoned = false;
  let outcome: PostgresMigrationOutcomeV2 = "not-applied", failure: PostgresMigrationError | undefined;
  let output: Readonly<{ targetHash: string; approvalHash: string; schemaVersion: PostgresSchemaVersionV2;
    fromVersion: number | null; mode: "dry-run" | "apply"; applied: number; pending: number; manifest: typeof manifest }> | undefined;
  const broken = () => { poisoned = true; destroy = true; };
  try {
    client = await pool.connect(); client.on("error", broken);
    // An uncertain BEGIN may leave a transaction; destroy on error even before DDL.
    begun = true;
    await client.query(mode === "apply" ? "BEGIN ISOLATION LEVEL READ COMMITTED" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=pg_catalog");
    if (mode === "apply") await client.query("SELECT pg_advisory_xact_lock($1,$2)", [...migrationLock]);
    const inspect = (selected: PostgresSchemaVersionV2) => inspectPostgresMigrationStateV2(client!, {
      version: selected, targetVersion: version, database: target.database, username: target.username, port: target.port,
    });
    // No pre-lock apply plan is used. READ COMMITTED sees a prior winner's commit.
    const before = await inspect(version);
    let applied = 0;
    if (mode === "apply" && before.pending) {
      if (before.state === "fresh") await client.query(journalSql);
      const start = before.version ?? 0;
      for (const [i, entry] of source.entries()) {
        if (i < start) continue;
        await client.query(entry.sql);
        await client.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES($1,$2,$3)", [i + 1, entry.id, entry.checksum]);
        applied++;
        if (version === 4 && i === 2) {
          const prefix = await inspect(3);
          if (prefix.state !== "complete" || prefix.version !== 3 || prefix.pending !== 0) throw new PostgresMigrationError("MIGRATION_STATE");
        }
      }
      const after = await inspect(version);
      if (after.state !== "complete" || after.version !== version || after.pending !== 0) throw new PostgresMigrationError("MIGRATION_STATE");
    }
    if (poisoned) throw new PostgresMigrationFailureV2("unknown");
    committing = true; outcome = "unknown";
    const committed = await client.query("COMMIT");
    if (committed.command !== "COMMIT" || poisoned) throw new PostgresMigrationFailureV2("unknown");
    begun = false; committing = false; outcome = "committed";
    output = Object.freeze({ targetHash: target.targetHash, approvalHash, schemaVersion: version, fromVersion: before.version,
      mode, applied, pending: mode === "apply" ? 0 : before.pending, manifest });
  } catch (error) {
    destroy = true;
    if (committing) {
      // COMMIT may have reached the server. Never retry, compensate or assert rollback.
      outcome = "unknown"; failure = new PostgresMigrationFailureV2(outcome);
    } else {
      if (client && begun) {
        try {
          const rollback = await client.query("ROLLBACK");
          if (rollback.command !== "ROLLBACK") outcome = "unknown";
          else begun = false;
        }
        catch { outcome = "unknown"; }
      }
      failure = outcome === "unknown" ? new PostgresMigrationFailureV2(outcome)
        : error instanceof PostgresMigrationError ? error : new PostgresMigrationFailureV2("not-applied");
    }
  } finally {
    if (client) {
      try { client.release(destroy || poisoned); }
      catch {
        failure = new PostgresMigrationFailureV2(outcome);
        try { await client.end(); } catch { /* cleanup remains failed */ }
      }
    }
    try { await pool.end(); }
    catch {
      // Cleanup failed: report failure even after confirmed COMMIT, preserving the
      // known outcome. Best-effort close of this exclusively owned client follows.
      failure = new PostgresMigrationFailureV2(outcome);
      if (client) { try { await client.end(); } catch { /* no cleanup-success claim */ } }
    }
    client?.removeListener("error", broken);
  }
  if (failure) throw failure;
  if (!output) throw new PostgresMigrationFailureV2(outcome);
  return output;
}
