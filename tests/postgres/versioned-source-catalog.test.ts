import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { runPostgresMigrations } from "@/lib/db/postgres/migration-runner";
import { inspectMigrationTarget } from "@/lib/db/postgres/migration-target";
import { loadPostgresMigrations, postgresMigrationManifest } from "@/lib/db/postgres/migration-manifest";
import { loadPostgresMigrationsV2, postgresMigrationManifestsV2 } from "@/lib/db/postgres/migration-manifest-v2";
import { inspectPostgresMigrationStateV2, postgresCatalogDescriptorsV2, postgresCatalogQueriesV2 } from "@/lib/db/postgres/migration-state-v2";
vi.mock("server-only", () => ({}));
const root = new URL("../../lib/db/postgres/", import.meta.url);
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");

describe("B22 fixed opt-in source contracts", () => {
  it("keeps v1 at three and loads only explicitly selected3/4", async () => {
    expect(postgresMigrationManifest).toHaveLength(3);
    expect(await loadPostgresMigrations()).toHaveLength(3);
    expect(await loadPostgresMigrationsV2(3)).toHaveLength(3);
    const four = await loadPostgresMigrationsV2(4); expect(four).toHaveLength(4);
    expect(four.slice(0, 3).map(({ id, checksum }) => ({ id, checksum }))).toEqual(postgresMigrationManifest.map(({ id, checksum }) => ({ id, checksum })));
    expect(four[3].sql).toContain("failure closure must identify same-owner object initial operation");
    expect(Object.isFrozen(postgresMigrationManifestsV2[4])).toBe(true);
    expect(Object.isFrozen(four[3])).toBe(true);
  });
  it.each([undefined, null, 0, 1, 2, 5, "3", "4", "latest", NaN, {}, []])("rejects unsupported version %s before any query", async version => {
    const client = { query: vi.fn() };
    await expect(loadPostgresMigrationsV2(version)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    await expect(inspectPostgresMigrationStateV2(client as unknown as PoolClient, { version, database: "unused", username: "unused", port: 1 })).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(client.query).not.toHaveBeenCalled();
  });
  it("local fixed SQL4 is exact accepted LF bytes, with no v1 import change", async () => {
    const published = (await readFile(new URL("0004_storage_verification.sql", root), "utf8")).replaceAll("\r\n", "\n");
    const accepted = (await readFile(new URL("drafts/0004_storage_verification.sql", root), "utf8")).replaceAll("\r\n", "\n");
    expect(published).toBe(accepted); expect(sha(published)).toBe("61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c");
    for (const path of ["migration-manifest.ts", "migration-runner.ts", "provision-template.ts"]) expect(await readFile(new URL(path, root), "utf8")).not.toContain("-v2");
  });
  it.each([{ database: "" }, { username: "" }, { port: 0 }, { port: 65536 }, { port: 1.5 }])("rejects malformed expected identity without queries: %s", async change => {
    const client = { query: vi.fn() };
    await expect(inspectPostgresMigrationStateV2(client as unknown as PoolClient, { version: 4, database: "unit", username: "unit", port: 5432, ...change })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(client.query).not.toHaveBeenCalled();
  });
  it("only CRLF normalizes; comments/BOM/SQL drift reject before execution", async () => {
    const directory = join(process.cwd(), "tmp", `b22-source-${randomUUID()}`); await mkdir(directory, { recursive: true });
    for (const entry of postgresMigrationManifestsV2[4]) await writeFile(join(directory, entry.file), (await readFile(new URL(entry.file, root), "utf8")).replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"));
    const url = pathToFileURL(`${directory}/`); expect(await loadPostgresMigrationsV2(4, url)).toHaveLength(4);
    const file = join(directory, "0004_storage_verification.sql"), original = await readFile(file, "utf8");
    for (const mutation of [`-- extra comment\r\n${original}`, `\uFEFF${original}`, original.replace("initial operation", "other operation")]) {
      await writeFile(file, mutation); await expect(loadPostgresMigrationsV2(4, url)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    }
  });
  it("fixed descriptors expose explicit immutable version sets and definitions", () => {
    expect(postgresCatalogDescriptorsV2[3].relations).toHaveLength(19);
    expect(postgresCatalogDescriptorsV2[4].relations).toHaveLength(31);
    expect(postgresCatalogDescriptorsV2[3].policies).toHaveLength(36);
    expect(postgresCatalogDescriptorsV2[4].policies).toHaveLength(43);
    expect(postgresCatalogDescriptorsV2[4].functions).toHaveLength(9);
    expect(Object.isFrozen(postgresCatalogDescriptorsV2[4].columns[0])).toBe(true);
    expect(postgresCatalogDescriptorsV2[4].constraints.some(row => String(row.definition).includes("FOREIGN KEY (owner_id, object_id)"))).toBe(true);
    for (const query of Object.values(postgresCatalogQueriesV2)) expect(query.trim()).toMatch(/^SELECT\b/);
  });
});

describe.skipIf(process.env.DREAM_PG_B22_SCHEMA_TEST !== "1")("B22 owned actual PG source/catalog matrix", () => {
  let pool: Pool, uri: string;
  let options: { version: number; database: string; username: string; port: number };
  beforeAll(async () => {
    uri = process.env.DREAM_PG_TEST_ADMIN_URL ?? ""; const u = new URL(uri);
    if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || !u.port || u.username !== "dream_test_admin" || !/^\/dream_test_[a-z0-9_]+$/.test(u.pathname) || u.search || u.hash) throw Error("Explicit owned synthetic target required");
    options = { version: 3, database: u.pathname.slice(1), username: u.username, port: Number(u.port) };
    pool = new Pool({ connectionString: uri, max: 2 });
    expect((await pool.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('auth') AS auth")).rows[0]).toEqual({ dream: null, auth: null });
    await pool.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  });
  afterAll(async () => { await pool?.end(); });
  async function transaction(run: (c: PoolClient) => Promise<void>, readonly = false) {
    const c = await pool.connect();
    try { await c.query(readonly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"); await c.query("SET LOCAL search_path=pg_catalog"); await run(c); }
    finally { await c.query("ROLLBACK"); c.release(); }
  }
  async function drift(sql: string, code = "MIGRATION_STATE", version = 4) {
    await transaction(async c => { await c.query(sql); await expect(inspectPostgresMigrationStateV2(c, { ...options, version })).rejects.toMatchObject({ code }); });
  }
  it("fresh3/fresh4 plans read only and never initialize roles/history", async () => {
    await transaction(async c => {
      expect(await inspectPostgresMigrationStateV2(c, options)).toEqual({ state: "fresh", version: null, pending: 3 });
      expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toEqual({ state: "fresh", version: null, pending: 4 });
      expect((await c.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('dream_migrations') AS history")).rows[0]).toEqual({ dream: null, history: null });
    }, true);
  });
  it("fresh reserved role or historyless/partial namespace is unknown, not adoptable", async () => {
    await drift("CREATE ROLE dream_api NOLOGIN", "MIGRATION_STATE", 3);
    await drift("CREATE SCHEMA dream", "MIGRATION_STATE", 3);
    await drift("CREATE SCHEMA dream_migrations", "MIGRATION_HISTORY", 3);
  });
  it("Auth prerequisite rejects missing table and non-UUID id", async () => {
    await drift("DROP TABLE auth.users", "MIGRATION_STATE", 3);
    await drift("DROP TABLE auth.users; CREATE TABLE auth.users(id text PRIMARY KEY)", "MIGRATION_STATE", 3);
  });
  it("complete3 has exact fixed descriptor; target4 plans one without applying it", async () => {
    const target = { connectionString: uri, profile: "synthetic" as const };
    expect(await runPostgresMigrations({ target, expectedTargetHash: inspectMigrationTarget(target).targetHash, mode: "apply" })).toMatchObject({ applied: 3 });
    await transaction(async c => {
      expect(await inspectPostgresMigrationStateV2(c, options)).toEqual({ state: "complete", version: 3, pending: 0 });
      expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toEqual({ state: "complete", version: 3, pending: 1 });
    }, true);
  });
  it("SQL4 applied without its history row rejects rather than backfills", async () => {
    const four = await loadPostgresMigrationsV2(4); await drift(four[3].sql);
  });
  it("known SQL4 history alone cannot authorize a missing SQL4 catalog", async () => {
    await transaction(async c => {
      const entry = postgresMigrationManifestsV2[4][3];
      await c.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES(4,$1,$2)", [entry.id, entry.checksum]);
      await expect(inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).rejects.toMatchObject({ code: "MIGRATION_STATE" });
    });
  });
  it.each([
    ["DELETE FROM dream_migrations.history WHERE ordinal=3", "MIGRATION_HISTORY"],
    ["UPDATE dream_migrations.history SET checksum=repeat('0',64) WHERE ordinal=1", "MIGRATION_HISTORY"],
    ["UPDATE dream_migrations.history SET id='unknown' WHERE ordinal=2", "MIGRATION_HISTORY"],
    ["UPDATE dream_migrations.history SET ordinal=5 WHERE ordinal=3", "MIGRATION_HISTORY"],
    ["ALTER TABLE dream.assets ADD COLUMN extra text", "MIGRATION_STATE"],
    ["ALTER TABLE dream.assets ALTER COLUMN title DROP NOT NULL", "MIGRATION_STATE"],
    ["ALTER TABLE dream.assets ALTER COLUMN title TYPE varchar(100)", "MIGRATION_STATE"],
    ["ALTER TABLE dream.assets ALTER COLUMN title SET DEFAULT 'changed'", "MIGRATION_STATE"],
    ["ALTER TABLE dream.assets DROP CONSTRAINT assets_owner_id_fkey", "MIGRATION_STATE"],
    ["ALTER POLICY owner_access ON dream.assets USING(true)", "MIGRATION_STATE"],
    ["ALTER TABLE dream.assets NO FORCE ROW LEVEL SECURITY", "MIGRATION_STATE"],
    ["GRANT TRUNCATE ON dream.assets TO dream_api", "MIGRATION_STATE"],
    ["GRANT SELECT(title) ON dream.assets TO PUBLIC", "MIGRATION_STATE"],
    ["ALTER TABLE dream.assets DISABLE TRIGGER guard_row", "MIGRATION_STATE"],
    ["GRANT CREATE ON SCHEMA dream TO PUBLIC", "MIGRATION_STATE"],
    ["ALTER DOMAIN dream.safe_uint DROP CONSTRAINT safe_uint_check", "MIGRATION_STATE"],
    ["CREATE TABLE dream.extra(id int)", "MIGRATION_STATE"],
    ["CREATE INDEX unexpected ON dream.assets(title)", "MIGRATION_STATE"],
  ])("complete3 rejects exact contract drift: %s", async (sql, code) => { await drift(sql, code, 3); });
  it("complete4 exact source/state is accepted only by opt-in inspection, v1 still rejects", async () => {
    const source = await loadPostgresMigrationsV2(4), c = await pool.connect();
    try {
      await c.query("BEGIN"); await c.query(source[3].sql);
      await c.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES(4,$1,$2)", [source[3].id, source[3].checksum]); await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    await transaction(async c => {
      expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toEqual({ state: "complete", version: 4, pending: 0 });
      await expect(inspectPostgresMigrationStateV2(c, options)).rejects.toMatchObject({ code: "MIGRATION_STATE" });
    }, true);
    const target = { connectionString: uri, profile: "synthetic" as const };
    await expect(runPostgresMigrations({ target, expectedTargetHash: inspectMigrationTarget(target).targetHash, mode: "dry-run" })).rejects.toMatchObject({ code: "MIGRATION_HISTORY" });
  });
  it.each([
    "DELETE FROM dream_migrations.history WHERE ordinal=4",
    "ALTER TABLE dream.storage_verification_receipts DROP CONSTRAINT storage_verification_receipts_owner_id_object_id_identity__fkey",
    "ALTER TABLE dream.storage_objects DROP CONSTRAINT storage_objects_bucket_object_key_key",
    "ALTER TABLE dream.storage_objects DROP CONSTRAINT storage_objects_check",
    "ALTER TABLE dream.storage_objects DISABLE ROW LEVEL SECURITY",
    "ALTER POLICY storage_owner_read ON dream.storage_objects TO PUBLIC",
    "GRANT UPDATE ON dream.storage_objects TO dream_api",
    "GRANT SELECT ON dream.storage_outbox TO dream_worker",
    "GRANT EXECUTE ON FUNCTION dream.storage_raw_hash(text,text) TO PUBLIC",
    "ALTER FUNCTION dream.storage_guard() SECURITY DEFINER",
    "ALTER FUNCTION dream.storage_guard() SET search_path=public",
    "CREATE OR REPLACE FUNCTION dream.storage_raw_hash(domain_name text,raw_value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS 'SELECT raw_value'",
    "DROP TRIGGER storage_consistency ON dream.storage_objects; CREATE CONSTRAINT TRIGGER storage_consistency AFTER INSERT OR UPDATE ON dream.storage_objects DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION dream.storage_consistency_guard()",
    "DROP TRIGGER storage_guard ON dream.storage_objects; CREATE TRIGGER storage_guard BEFORE INSERT OR UPDATE OR DELETE ON dream.storage_objects FOR EACH ROW EXECUTE FUNCTION dream.storage_consistency_guard()",
    "ALTER TABLE dream_migrations.history OWNER TO dream_worker",
    "ALTER TABLE dream.storage_objects OWNER TO dream_worker",
    "ALTER ROLE dream_worker LOGIN",
    "GRANT dream_worker TO dream_api",
  ])("complete4 rejects exact contract drift: %s", async sql => { await drift(sql); });
  it("unknown extra history rejects without interpreting a prefix", async () => {
    await drift("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES(5,'unknown',repeat('0',64))", "MIGRATION_HISTORY");
  });
  it("helper argument-default drift rejects even with identical source body and identity signature", async () => {
    const source = (await loadPostgresMigrationsV2(4))[3].sql;
    const body = source.match(/CREATE FUNCTION dream\.storage_uuid7[\s\S]*?AS \$\$([\s\S]*?)\$\$/)![1];
    await drift(`CREATE OR REPLACE FUNCTION dream.storage_uuid7(v uuid DEFAULT null) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $b22$${body}$b22$`);
  });
  it("untrusted history view rejects from metadata before its rows are read", async () => {
    await transaction(async c => {
      await c.query("DROP TABLE dream_migrations.history; CREATE VIEW dream_migrations.history AS SELECT 1 AS ordinal,'forged'::text AS id,repeat('0',64) AS checksum");
      const statements: string[] = [];
      const reader = { query: async (sql: string) => { statements.push(sql); return c.query(sql); } } as unknown as PoolClient;
      await expect(inspectPostgresMigrationStateV2(reader, { ...options, version: 4 })).rejects.toMatchObject({ code: "MIGRATION_STATE" });
      expect(statements.some(sql => sql.startsWith("SELECT ordinal,id,checksum FROM"))).toBe(false);
    });
  });
  it("independent fresh4 test setup from four verified sources has the same fixed catalog", async () => {
    const sources = await loadPostgresMigrationsV2(4);
    // Entire reset/setup is inside a rollback-only transaction on this owned
    // cluster. This fixture is not an exported migration apply implementation.
    await transaction(async c => {
      await c.query("DROP SCHEMA dream CASCADE; DROP SCHEMA dream_migrations CASCADE; DROP ROLE dream_api; DROP ROLE dream_worker");
      expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toEqual({ state: "fresh", version: null, pending: 4 });
      await c.query("CREATE SCHEMA dream_migrations; REVOKE ALL ON SCHEMA dream_migrations FROM PUBLIC; CREATE TABLE dream_migrations.history(ordinal integer PRIMARY KEY CHECK(ordinal>0),id text NOT NULL UNIQUE,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()); REVOKE ALL ON TABLE dream_migrations.history FROM PUBLIC");
      for (const [i, entry] of sources.entries()) {
        await c.query(entry.sql); await c.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES($1,$2,$3)", [i + 1, entry.id, entry.checksum]);
      }
      expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toEqual({ state: "complete", version: 4, pending: 0 });
    });
    await transaction(async c => { expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toMatchObject({ state: "complete", version: 4, pending: 0 }); }, true);
  });
  it("approved optional login graph remains valid; unsafe or partial graph rejects", async () => {
    const pair = "CREATE ROLE dream_api_login LOGIN NOINHERIT; CREATE ROLE dream_worker_login LOGIN NOINHERIT; GRANT dream_api TO dream_api_login WITH ADMIN FALSE,INHERIT FALSE,SET TRUE; GRANT dream_worker TO dream_worker_login WITH ADMIN FALSE,INHERIT FALSE,SET TRUE";
    await transaction(async c => { await c.query(pair); expect(await inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).toMatchObject({ state: "complete", pending: 0 }); });
    await drift("CREATE ROLE dream_api_login LOGIN NOINHERIT");
    await drift(`${pair}; GRANT dream_worker TO dream_api_login`);
  });
  it("inspection only issues SELECT/WITH in a READ ONLY transaction and returns no target secrets", async () => {
    await transaction(async c => {
      const statements: string[] = [];
      const reader = { query: async (sql: string) => { statements.push(sql); return c.query(sql); } } as unknown as PoolClient;
      const result = await inspectPostgresMigrationStateV2(reader, { ...options, version: 4 });
      expect(statements.every(sql => /^(SELECT|WITH)\b/.test(sql))).toBe(true);
      expect(JSON.stringify(result)).toBe('{"state":"complete","version":4,"pending":0}');
      expect((await c.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
    }, true);
  });
  it("target identity/search path mismatch rejects; unexpected driver errors are redacted", async () => {
    await transaction(async c => {
      await expect(inspectPostgresMigrationStateV2(c, { ...options, version: 4, port: options.port + 1 })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
      await c.query("SET LOCAL search_path=public");
      await expect(inspectPostgresMigrationStateV2(c, { ...options, version: 4 })).rejects.toMatchObject({ code: "MIGRATION_STATE" });
    }, true);
    const reader = { query: async () => { throw Error("postgresql://private:secret@unapproved.invalid/db"); } } as unknown as PoolClient;
    await expect(inspectPostgresMigrationStateV2(reader, { ...options, version: 4 })).rejects.toMatchObject({ code: "MIGRATION_FAILED", message: "MIGRATION_FAILED" });
  });
});
