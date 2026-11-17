import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectMigrationTarget, type MigrationTarget } from "../../lib/db/postgres/migration-target";
import { PostgresMigrationError } from "../../lib/db/postgres/migration-manifest";
import { runPostgresMigrations } from "../../lib/db/postgres/migration-runner";
import { postgresProvisionTemplate } from "../../lib/db/postgres/provision-template";

export async function runMigrationCli(args: readonly string[], env: Readonly<Record<string, string | undefined>>, output: (text: string) => void): Promise<number> {
  try {
    if (args.length !== 1 || !["fingerprint", "dry-run", "apply", "provision-template"].includes(args[0])) throw new PostgresMigrationError("MIGRATION_TARGET");
    if (args[0] === "provision-template") { output(postgresProvisionTemplate()); return 0; }
    const target: MigrationTarget = { connectionString: env.DREAM_PG_MIGRATION_URL ?? "", profile: env.DREAM_PG_MIGRATION_PROFILE as MigrationTarget["profile"], projectRef: env.DREAM_PG_MIGRATION_PROJECT_REF };
    const { targetHash } = inspectMigrationTarget(target);
    if (args[0] === "fingerprint") { output(JSON.stringify({ targetHash })); return 0; }
    if (env.DREAM_PG_MIGRATION_TARGET_HASH !== targetHash) throw new PostgresMigrationError("MIGRATION_TARGET");
    output(JSON.stringify(await runPostgresMigrations({ target, expectedTargetHash: targetHash, mode: args[0] as "dry-run" | "apply", ...(env.DREAM_PG_MIGRATION_CA ? { ca: env.DREAM_PG_MIGRATION_CA } : {}) })));
    return 0;
  } catch (error) {
    output(JSON.stringify({ error: error instanceof PostgresMigrationError ? error.code : "MIGRATION_FAILED" }));
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMigrationCli(process.argv.slice(2), process.env, line => process.stdout.write(`${line}\n`));
}
