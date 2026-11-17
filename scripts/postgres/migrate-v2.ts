import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresMigrationError } from "../../lib/db/postgres/migration-manifest";
import { loadPostgresMigrationsV2, postgresMigrationManifestsV2, type PostgresSchemaVersionV2 } from "../../lib/db/postgres/migration-manifest-v2";
import { inspectMigrationTarget, type MigrationTarget } from "../../lib/db/postgres/migration-target";
import { postgresMigrationApprovalHashV2, PostgresMigrationFailureV2, runPostgresMigrationsV2 } from "../../lib/db/postgres/migration-runner-v2";

export function parseVersionedMigrationCliArgs(input: readonly string[]) {
  if (!Array.isArray(input) || input.some(value => typeof value !== "string")) throw new PostgresMigrationError("MIGRATION_TARGET");
  const args = [...input], command = args[0];
  if (args[1] !== "--schema" || !["fingerprint", "dry-run", "apply"].includes(command)) throw new PostgresMigrationError("MIGRATION_TARGET");
  if ((command === "fingerprint" && (args.length !== 5 || args[3] !== "--mode" || !["dry-run", "apply"].includes(args[4]))) ||
    (command !== "fingerprint" && args.length !== 3)) throw new PostgresMigrationError("MIGRATION_TARGET");
  if (args[2] !== "3" && args[2] !== "4") throw new PostgresMigrationError("MIGRATION_SOURCE");
  return Object.freeze({ command: command as "fingerprint" | "dry-run" | "apply", version: Number(args[2]) as PostgresSchemaVersionV2,
    mode: (command === "fingerprint" ? args[4] : command) as "dry-run" | "apply" });
}
const envKeys = ["DREAM_PG_MIGRATION_URL", "DREAM_PG_MIGRATION_PROFILE", "DREAM_PG_MIGRATION_PROJECT_REF", "DREAM_PG_MIGRATION_SESSION_HOST",
  "DREAM_PG_MIGRATION_SESSION_PORT", "DREAM_PG_MIGRATION_SESSION_DATABASE", "DREAM_PG_MIGRATION_SESSION_USERNAME", "DREAM_PG_MIGRATION_SESSION_ROLE",
  "DREAM_PG_MIGRATION_CA", "DREAM_PG_MIGRATION_TARGET_HASH", "DREAM_PG_MIGRATION_APPROVAL_HASH"] as const;
const errorCodes = ["MIGRATION_SOURCE", "MIGRATION_TARGET", "MIGRATION_PRIVILEGE", "MIGRATION_STATE", "MIGRATION_HISTORY", "MIGRATION_FAILED"];
const outcomes = ["not-applied", "unknown", "committed"];
function snapshotEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    const property = Object.getOwnPropertyDescriptor(env, key);
    if (property && (!("value" in property) || (property.value !== undefined && typeof property.value !== "string"))) throw new PostgresMigrationError("MIGRATION_TARGET");
    snapshot[key] = property?.value;
  }
  return Object.freeze(snapshot);
}
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export async function runVersionedMigrationCli(args: readonly string[], env: Readonly<Record<string, string | undefined>>, output: (line: string) => void): Promise<number> {
  let record: unknown, exitCode = 0, runnerInvoked = false;
  try {
    // Resolve syntax and copy all explicit values before the first await. No
    // DATABASE_URL, PG*, .env loading or caller-supplied secret CLI options.
    const plan = parseVersionedMigrationCliArgs(args), values = snapshotEnvironment(env);
    const target: MigrationTarget = Object.freeze({ connectionString: values.DREAM_PG_MIGRATION_URL ?? "", profile: values.DREAM_PG_MIGRATION_PROFILE as MigrationTarget["profile"],
      projectRef: values.DREAM_PG_MIGRATION_PROJECT_REF, sessionHost: values.DREAM_PG_MIGRATION_SESSION_HOST,
      sessionPort: values.DREAM_PG_MIGRATION_SESSION_PORT, sessionDatabase: values.DREAM_PG_MIGRATION_SESSION_DATABASE,
      sessionUsername: values.DREAM_PG_MIGRATION_SESSION_USERNAME, sessionRole: values.DREAM_PG_MIGRATION_SESSION_ROLE });
    const { targetHash } = inspectMigrationTarget(target);
    const manifest = postgresMigrationManifestsV2[plan.version].map(({ id, checksum }) => ({ id, checksum }));
    if (plan.command === "fingerprint") {
      // Filesystem verification only: no pool/runner/network and no automatic
      // promotion of these informational hashes to execution approval variables.
      await loadPostgresMigrationsV2(plan.version);
      record = { command: plan.command, runnerVersion: 2, schemaVersion: plan.version, mode: plan.mode, targetHash,
        approvalHash: postgresMigrationApprovalHashV2(plan.version, targetHash, plan.mode), manifest };
    } else {
      const expectedTargetHash = values.DREAM_PG_MIGRATION_TARGET_HASH, expectedApprovalHash = values.DREAM_PG_MIGRATION_APPROVAL_HASH;
      if (!digest(expectedTargetHash) || !digest(expectedApprovalHash)) throw new PostgresMigrationError("MIGRATION_TARGET");
      runnerInvoked = true;
      const result = await runPostgresMigrationsV2({ version: plan.version, mode: plan.mode, target, expectedTargetHash, expectedApprovalHash,
        ...(values.DREAM_PG_MIGRATION_CA !== undefined ? { ca: values.DREAM_PG_MIGRATION_CA } : {}) });
      // Closed projection prevents future runner fields/cause/driver data from
      // accidentally becoming CLI output. Unexpected results have unknown outcome.
      if (result.targetHash !== targetHash || result.approvalHash !== expectedApprovalHash || !digest(result.targetHash) || !digest(result.approvalHash) ||
        result.schemaVersion !== plan.version || result.mode !== plan.mode || ![null, 3, 4].includes(result.fromVersion) ||
        ![0, 1, 3, 4].includes(result.applied) || ![0, 1, 3, 4].includes(result.pending) || !Array.isArray(result.manifest) ||
        result.manifest.length !== manifest.length || result.manifest.some((entry, index) => entry.id !== manifest[index].id || entry.checksum !== manifest[index].checksum)) throw new PostgresMigrationFailureV2("unknown");
      record = { command: plan.command, targetHash: result.targetHash, approvalHash: result.approvalHash, schemaVersion: result.schemaVersion,
        fromVersion: result.fromVersion, mode: result.mode, applied: result.applied, pending: result.pending, manifest };
    }
  } catch (error) {
    exitCode = 1;
    const code = error instanceof PostgresMigrationError && errorCodes.includes(error.code) ? error.code : "MIGRATION_FAILED";
    const outcome = error instanceof PostgresMigrationFailureV2 && outcomes.includes(error.outcome) ? error.outcome : runnerInvoked ? "unknown" : "not-applied";
    record = { error: code, ...(code === "MIGRATION_FAILED" ? { outcome } : {}) };
  }
  // Exactly one redacted record is attempted; a broken writer is not retried and
  // cannot trigger a second operation or disclose the rejected raw exception.
  try { output(JSON.stringify(record)); } catch { return 1; }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stdoutFailed = false;
  process.stdout.on("error", () => { stdoutFailed = true; process.exitCode = 1; });
  const exitCode = await runVersionedMigrationCli(process.argv.slice(2), process.env, line => { process.stdout.write(`${line}\n`); });
  process.exitCode = stdoutFailed ? 1 : exitCode;
}
