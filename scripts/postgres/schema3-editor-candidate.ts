import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPostgresMigrationsV2 } from "../../lib/db/postgres/migration-manifest-v2";
import { migrationLock, restrictedRoleGraphViolationsSql } from "../../lib/db/postgres/migration-runner";
import { postgresMigrationJournalSqlV2 } from "../../lib/db/postgres/migration-runner-v2";
import { postgresCatalogQueriesV2, postgresSchema3Pg17Catalog } from "../../lib/db/postgres/migration-state-v2";

type Target = Readonly<{
  projectRef: string;
  database: string;
  databaseOid: number;
  owner: string;
  port: number;
  serverVersion: number;
  ending: "rollback" | "commit";
}>;
const ident = /^[a-zA-Z_][a-zA-Z_0-9]{0,62}$/;
const roles = "'dream_api','dream_worker','dream_api_login','dream_worker_login'";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function quoted(value: string, tag: string) {
  const delimiter = `$${tag}$`;
  if (value.includes(delimiter)) throw new Error("SQL delimiter conflicts with a fixed source");
  return `${delimiter}${value}${delimiter}`;
}

export async function schema3EditorCandidate(input: Target) {
  const target = { ...input };
  if (!/^[a-z0-9]{20}$/.test(target.projectRef) || !ident.test(target.database) || !ident.test(target.owner) ||
      ["dream_api", "dream_worker", "dream_api_login", "dream_worker_login"].includes(target.owner) ||
      !Number.isInteger(target.databaseOid) || target.databaseOid < 1 || target.databaseOid > 4_294_967_295 ||
      !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 ||
      !Number.isInteger(target.serverVersion) || target.serverVersion < 170000 || target.serverVersion >= 180000 ||
      (target.ending !== "rollback" && target.ending !== "commit")) throw new Error("Invalid SQL Editor target");

  const source = await loadPostgresMigrationsV2(3);
  const history = source.map(({ id, checksum }, index) => `(${index + 1}, '${id}', '${checksum}')`).join(",\n      ");
  const apply = source.map(({ id, checksum, sql }, index) => `  body := ${quoted(sql, `migration_${index + 1}`)};
  IF encode(sha256(convert_to(body, 'UTF8')), 'hex') <> '${digest(sql)}' THEN
    RAISE EXCEPTION 'schema 3 body checksum mismatch: ${id}';
  END IF;
  EXECUTE body;
  INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES (${index + 1}, '${id}', '${checksum}');`).join("\n");
  const catalog = Object.entries(postgresCatalogQueriesV2).map(([key, query]) => {
    const expected = quoted(JSON.stringify(postgresSchema3Pg17Catalog[key]), `expected_${key}`);
    return `  IF EXISTS (
    WITH actual AS (SELECT to_jsonb(r) AS row FROM (${query}) r),
         expected AS (SELECT value AS row FROM jsonb_array_elements(${expected}::jsonb))
    (SELECT row FROM actual EXCEPT ALL SELECT row FROM expected)
    UNION ALL
    (SELECT row FROM expected EXCEPT ALL SELECT row FROM actual)
  ) THEN RAISE EXCEPTION 'schema 3 catalog mismatch: ${key}'; END IF;`;
  }).join("\n");

  return `-- Offline schema 3 candidate for Supabase project ${target.projectRef}.
-- Confirm the selected dashboard project independently. SQL sees only the DB identity below.
-- ${target.ending === "rollback" ? "ROLLBACK rehearsal; run on an owned trial database." : "COMMIT candidate; requires separate approval and review of this exact file."}
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(${migrationLock.join(", ")});

DO $schema3_candidate$
DECLARE body text;
BEGIN
  IF current_database() <> '${target.database}' OR session_user <> '${target.owner}' OR current_user <> '${target.owner}' OR
     inet_server_port() IS DISTINCT FROM ${target.port} OR current_setting('server_version_num')::int <> ${target.serverVersion} OR
     (SELECT oid FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM ${target.databaseOid}::oid OR
     current_setting('server_encoding') <> 'UTF8' OR pg_is_in_recovery() THEN
    RAISE EXCEPTION 'schema 3 target mismatch';
  END IF;
  IF NOT has_database_privilege(current_database(), 'CREATE') OR NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = session_user AND (rolsuper OR rolcreaterole)
  ) OR NOT EXISTS (
    SELECT FROM pg_attribute a WHERE a.attrelid = to_regclass('auth.users') AND a.attname = 'id' AND NOT a.attisdropped
      AND a.atttypid = 'uuid'::regtype AND a.attnotnull AND EXISTS (
        SELECT FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisunique AND i.indisvalid
          AND i.indpred IS NULL AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum
      ) AND has_schema_privilege('auth','USAGE') AND has_table_privilege('auth.users','REFERENCES')
  ) THEN RAISE EXCEPTION 'schema 3 owner or Auth prerequisite mismatch'; END IF;
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('dream','dream_migrations','project_read','project_read_private')) OR
     EXISTS (SELECT FROM pg_roles WHERE rolname IN (${roles})) THEN
    RAISE EXCEPTION 'schema 3 requires a fresh database state';
  END IF;

  EXECUTE ${quoted(postgresMigrationJournalSqlV2, "journal")};
${apply}

${catalog}
  IF EXISTS (
    WITH expected(ordinal,id,checksum) AS (VALUES ${history}),
         actual AS (SELECT ordinal,id,checksum FROM dream_migrations.history)
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
  ) THEN RAISE EXCEPTION 'schema 3 history mismatch'; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN (${roles})) <> 2 OR EXISTS (
    SELECT FROM pg_roles WHERE rolname IN (${roles}) AND
      (rolsuper OR rolbypassrls OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolcanlogin)
  ) OR EXISTS (${restrictedRoleGraphViolationsSql}) THEN
    RAISE EXCEPTION 'schema 3 roles or memberships mismatch';
  END IF;
END
$schema3_candidate$;

SELECT 3 AS schema_version, 3 AS verified_history_rows, '${target.ending}' AS requested_ending;
${target.ending.toUpperCase()};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [ending, projectRef, database, databaseOid, owner, port, serverVersion, output] = args;
  if (args.length !== 8 || (ending !== "rollback" && ending !== "commit") || !output) {
    throw new Error("Usage: schema3-editor-candidate.ts <rollback|commit> <project-ref> <database> <database-oid> <owner> <port> <server-version-num> <output.sql>");
  }
  const sql = await schema3EditorCandidate({ projectRef, database, databaseOid: Number(databaseOid), owner, port: Number(port), serverVersion: Number(serverVersion), ending });
  await writeFile(output, sql, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${digest(sql)}\n`);
}
