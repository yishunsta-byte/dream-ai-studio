import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Client, QueryResult } from "pg";

// Called only after T358 has finished testing its own disposable loopback cluster.
const baselines = [
  ["EFFECTIVE-READ-PRIVILEGES", "match", 273],
  ["WRITE-AND-GRANT-PRIVILEGES", "match", 1],
  ["ROLE-BOUNDARIES", "match", 1],
  ["ROW-POLICIES", "match", 20],
  ["VIEW-DEFINITIONS", "match", 15],
  ["DEFAULT-PRIVILEGES", "no non-owner default grants", 1],
  ["INSTALL-PREREQUISITES", "match", 32],
  ["BASE-HISTORY", "match", 3],
  ["SCHEMA-INVENTORY", "match", 7],
] as const;

type Check = (typeof baselines)[number][0];
type ReportRow = { result: string };

async function runReport(client: Client, name: Check, asAnon: boolean): Promise<ReportRow[]> {
  const file = new URL(`../../docs/handoffs/T362-${name}.sql`, import.meta.url);
  const sql = await readFile(file, "utf8");
  if (asAnon) await client.query("SET ROLE anon");
  try {
    const response: unknown = await client.query(sql);
    assert(Array.isArray(response), name);
    const reports = (response as QueryResult<ReportRow>[]).filter(
      part => part.fields.some(field => field.name === "result"),
    );
    assert.equal(reports.length, 1, name);
    return reports[0].rows;
  } finally {
    await client.query("ROLLBACK; RESET ROLE");
  }
}

export async function verifyCatalogChecks(client: Client) {
  for (const [name, expected, count] of baselines) {
    const rows = await runReport(client, name, name !== "BASE-HISTORY");
    assert.equal(rows.length, count, name);
    assert(rows.every(row => row.result === expected), name);
  }
  await assert.rejects(runReport(client, "BASE-HISTORY", true), { code: "42501" });

  // The outer fixture destroys this database immediately after these checks.
  await client.query(`
    BEGIN;
    GRANT SELECT (owner_id), UPDATE (title) ON dream.projects TO PUBLIC;
    GRANT authenticated TO authenticator WITH SET FALSE;
    ALTER TABLE dream.jobs NO FORCE ROW LEVEL SECURITY;
    ALTER VIEW project_read.project_list SET (security_invoker=false);
    ALTER DEFAULT PRIVILEGES FOR ROLE t358_owner GRANT SELECT ON TABLES TO PUBLIC;
    ALTER FUNCTION auth.uid() VOLATILE;
    UPDATE dream_migrations.history SET checksum=repeat('0',64) WHERE ordinal=1;
    CREATE TABLE project_read.t362_unexpected(id integer);
    CREATE FUNCTION project_read.t362_unexpected() RETURNS integer LANGUAGE sql AS 'SELECT 0';
    COMMENT ON SCHEMA project_read IS NULL;
    COMMIT;
  `);
  for (const [name, expected, count] of [
    ["EFFECTIVE-READ-PRIVILEGES", "mismatch", 3],
    ["WRITE-AND-GRANT-PRIVILEGES", "mismatch", 3],
    ["ROLE-BOUNDARIES", "mismatch", 1],
    ["ROW-POLICIES", "mismatch", 1],
    ["VIEW-DEFINITIONS", "mismatch", 1],
    ["DEFAULT-PRIVILEGES", "review", 1],
    ["INSTALL-PREREQUISITES", "mismatch", 1],
    ["BASE-HISTORY", "checksum mismatch", 1],
    ["SCHEMA-INVENTORY", "unexpected", 2],
    ["SCHEMA-INVENTORY", "mismatch", 1],
  ] as const) {
    const rows = await runReport(client, name, name !== "BASE-HISTORY");
    assert.equal(rows.filter(row => row.result === expected).length, count, name);
  }
  await client.query("DROP VIEW project_read.project_detail");
  const inventory = await runReport(client, "SCHEMA-INVENTORY", true);
  assert.equal(inventory.filter(row => row.result === "missing").length, 1);
  console.log(`T362: ${baselines.length} catalog reports passed baseline and drift checks; missing view detected; journal access denied to anon`);
}
