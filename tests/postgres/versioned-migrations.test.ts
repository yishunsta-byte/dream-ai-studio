import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type QueryResult } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as connection from "@/lib/db/postgres/connection";
import * as state from "@/lib/db/postgres/migration-state-v2";
import { inspectMigrationTarget, type MigrationTarget } from "@/lib/db/postgres/migration-target";
import { postgresMigrationManifestsV2 } from "@/lib/db/postgres/migration-manifest-v2";
import { migrationLock, runPostgresMigrations } from "@/lib/db/postgres/migration-runner";
import { postgresMigrationApprovalHashV2, runPostgresMigrationsV2, type PostgresMigrationOptionsV2 } from "@/lib/db/postgres/migration-runner-v2";
vi.mock("server-only", () => ({}));
afterEach(() => vi.restoreAllMocks());
const syntheticUri = "postgresql://dream_test_admin:synthetic-secret@127.0.0.1:54321/dream_test_b23";
function options(version: 3 | 4 = 4, mode: "apply" | "dry-run" = "apply", uri = syntheticUri): PostgresMigrationOptionsV2 {
  const target = { connectionString: uri, profile: "synthetic" as const }, hash = inspectMigrationTarget(target).targetHash;
  return { version, mode, target, expectedTargetHash: hash, expectedApprovalHash: postgresMigrationApprovalHashV2(version, hash, mode) };
}
function fakeRuntime(fault?: string) {
  const client = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  const statements: string[] = [];
  let inspecting = 0;
  client.query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if ((fault === "begin" && sql.startsWith("BEGIN")) || (fault === "lock" && sql.includes("pg_advisory_xact_lock")) ||
      (fault === "ddl" && sql.startsWith("CREATE SCHEMA dream_migrations")) ||
      (["commit", "rollback"].includes(fault ?? "") && sql === (fault === "commit" ? "COMMIT" : "ROLLBACK"))) throw Error("driver postgresql://private:secret@hidden.invalid/db");
    if (fault === "rollback" && sql.startsWith("CREATE SCHEMA dream_migrations")) throw Error("DDL failed secret");
    if (fault === "client-error" && sql === "COMMIT") client.emit("error", Error("secret client error"));
    return { rows: [], command: sql === "COMMIT" && fault === "commit-command" ? "ROLLBACK" : sql === "COMMIT" ? "COMMIT" : sql === "ROLLBACK" ? "ROLLBACK" : "OK" };
  });
  client.release = vi.fn(() => { if (fault === "release") throw Error("secret release error"); });
  client.end = vi.fn(async () => {});
  const pool = { connect: vi.fn(async () => { if (fault === "connect") throw Error("secret connect error"); return client; }),
    end: vi.fn(async () => { if (fault === "end") throw Error("secret pool end error"); }) };
  const create = vi.spyOn(connection, "createPostgresPool").mockReturnValue(pool as unknown as Pool);
  vi.spyOn(state, "inspectPostgresMigrationStateV2").mockImplementation(async (_client, value) => {
    inspecting++;
    if (fault === "post-inspect" && inspecting > 1) throw new Error("secret invalid catalog");
    if (fault === "complete") return { state: "complete", version: 4, pending: 0 };
    return inspecting === 1 ? { state: "fresh", version: null, pending: value.version as 3 | 4 }
      : { state: "complete", version: value.version as 3 | 4, pending: 0 };
  });
  return { client, pool, create, statements };
}

describe("B23 admission and owned lifecycle faults", () => {
  it("approval binding fixes target/version and exact ordered manifest", () => {
    const hash = inspectMigrationTarget(options().target).targetHash;
    expect(postgresMigrationApprovalHashV2(3, hash, "apply")).not.toBe(postgresMigrationApprovalHashV2(4, hash, "apply"));
    expect(postgresMigrationApprovalHashV2(4, "0".repeat(64), "apply")).not.toBe(postgresMigrationApprovalHashV2(4, hash, "apply"));
    expect(postgresMigrationApprovalHashV2(4, hash, "dry-run")).not.toBe(postgresMigrationApprovalHashV2(4, hash, "apply"));
    expect(postgresMigrationManifestsV2[4]).toHaveLength(4);
  });
  it.each(["pool", "poolFactory", "factory", "client", "hooks", "latest"])("rejects injected %s before connecting", async key => {
    const runtime = fakeRuntime();
    await expect(runPostgresMigrationsV2({ ...options(), [key]: {} } as PostgresMigrationOptionsV2)).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 2, 5, "4"])("rejects unsupported schema version %s before connecting", async version => {
    const runtime = fakeRuntime();
    await expect(runPostgresMigrationsV2({ ...options(), version } as PostgresMigrationOptionsV2)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it.each([{ expectedTargetHash: "0".repeat(64) }, { expectedApprovalHash: "0".repeat(64) }, { mode: "latest" }])("rejects approval/mode mismatch before pool creation %s", async change => {
    const runtime = fakeRuntime();
    await expect(runPostgresMigrationsV2({ ...options(), ...change } as PostgresMigrationOptionsV2)).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("rejects accessors without invoking them or an external prototype", async () => {
    const runtime = fakeRuntime(), getter = vi.fn(() => options().target);
    const value = { ...options() }; Object.defineProperty(value, "target", { get: getter });
    await expect(runPostgresMigrationsV2(value)).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    await expect(runPostgresMigrationsV2(Object.assign(Object.create({ pool: {} }), options()))).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(getter).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("snapshots every approval field before source awaits and creates one exact max1 pool", async () => {
    const runtime = fakeRuntime(), input = { ...options(), target: { ...options().target } };
    const result = runPostgresMigrationsV2(input);
    input.target.connectionString = "postgresql://changed:secret@remote.invalid:5432/nope"; input.version = 3; input.mode = "dry-run"; input.expectedApprovalHash = "wrong";
    const value = await result; expect(value).toMatchObject({ schemaVersion: 4, mode: "apply", applied: 4, pending: 0 });
    expect(runtime.create).toHaveBeenCalledExactlyOnceWith({ connectionString: syntheticUri, max: 1, localTestWithoutTls: true });
    expect(runtime.client.release).toHaveBeenCalledExactlyOnceWith(false); expect(runtime.pool.end).toHaveBeenCalledOnce();
    expect(runtime.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(runtime.statements.indexOf("SELECT pg_advisory_xact_lock($1,$2)")).toBeGreaterThan(0);
    expect(JSON.stringify(value)).not.toMatch(/secret|dream_test_admin|127\.0\.0\.1/); expect(Object.isFrozen(value.manifest[0])).toBe(true);
  });
  it("dry-run uses READ ONLY REPEATABLE READ without lock/DDL and still closes ownership", async () => {
    const runtime = fakeRuntime(); expect(await runPostgresMigrationsV2(options(4, "dry-run"))).toMatchObject({ applied: 0, pending: 4 });
    expect(runtime.statements).toEqual(["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL search_path=pg_catalog", "COMMIT"]);
    expect(runtime.pool.end).toHaveBeenCalledOnce();
  });
  it("dry-run approval cannot authorize apply by changing only mode", async () => {
    const runtime = fakeRuntime();
    await expect(runPostgresMigrationsV2({ ...options(4, "dry-run"), mode: "apply" })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("complete4 reexecution applies zero and never executes source/history DDL", async () => {
    const runtime = fakeRuntime("complete"); expect(await runPostgresMigrationsV2(options())).toMatchObject({ applied: 0, pending: 0, fromVersion: 4 });
    expect(runtime.statements.some(sql => /^(CREATE|INSERT)/.test(sql))).toBe(false);
  });
  it.each(["connect", "begin", "lock", "ddl", "post-inspect"])("%s failure redacts errors, disposes pool and reports no applied transaction", async fault => {
    const runtime = fakeRuntime(fault);
    await expect(runPostgresMigrationsV2(options())).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "not-applied", message: "MIGRATION_FAILED" });
    expect(runtime.pool.end).toHaveBeenCalledOnce();
    if (fault !== "connect") expect(runtime.client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(runtime.statements.filter(sql => sql === "COMMIT")).toHaveLength(0);
  });
  it.each(["commit", "commit-command", "client-error", "rollback"])("%s uncertainty destroys client, never retries/compensates and reports unknown", async fault => {
    const runtime = fakeRuntime(fault);
    await expect(runPostgresMigrationsV2(options())).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "unknown", message: "MIGRATION_FAILED" });
    expect(runtime.client.release).toHaveBeenCalledExactlyOnceWith(true); expect(runtime.pool.end).toHaveBeenCalledOnce(); expect(runtime.pool.connect).toHaveBeenCalledOnce();
    if (fault !== "rollback") expect(runtime.statements).not.toContain("ROLLBACK");
    expect(runtime.statements.some(sql => /^(DROP|DELETE)/.test(sql))).toBe(false);
  });
  it.each(["release", "end"])("%s cleanup failure preserves confirmed outcome and does not report success", async fault => {
    const runtime = fakeRuntime(fault);
    await expect(runPostgresMigrationsV2(options())).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "committed" });
    expect(runtime.pool.end).toHaveBeenCalledOnce(); expect(runtime.client.end).toHaveBeenCalledOnce();
  });
  it("factory failure is redacted as target failure", async () => {
    vi.spyOn(connection, "createPostgresPool").mockImplementation(() => { throw Error("private DSN secret"); });
    await expect(runPostgresMigrationsV2(options())).rejects.toMatchObject({ code: "MIGRATION_TARGET", message: "MIGRATION_TARGET" });
  });
  it("checksum drift rejects before owned factory/connection", async () => {
    const runtime = fakeRuntime(), directory = join(process.cwd(), "tmp", `b23-source-${randomUUID()}`); await mkdir(directory, { recursive: true });
    for (const entry of postgresMigrationManifestsV2[4]) await writeFile(join(directory, entry.file), await readFile(new URL(`../../lib/db/postgres/${entry.file}`, import.meta.url)));
    await writeFile(join(directory, "0004_storage_verification.sql"), "-- changed");
    await expect(runPostgresMigrationsV2({ ...options(), sourceRoot: pathToFileURL(`${directory}/`) })).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("keeps exact managed session bindings and CA requirement without any network access", async () => {
    const runtime = fakeRuntime(), ref = "abcdefghijklmnopqrst", role = "migration_owner", host = "aws-0-ap-northeast-2.pooler.supabase.com";
    const target: MigrationTarget = { profile: "managed-session-staging", connectionString: `postgresql://${role}.${ref}:secret@${host}:5432/postgres`, projectRef: ref,
      sessionHost: host, sessionPort: "5432", sessionDatabase: "postgres", sessionUsername: `${role}.${ref}`, sessionRole: role };
    const hash = inspectMigrationTarget(target).targetHash, approved = { ...options(), target, expectedTargetHash: hash, expectedApprovalHash: postgresMigrationApprovalHashV2(4, hash, "apply") };
    await expect(runPostgresMigrationsV2(approved)).rejects.toMatchObject({ code: "MIGRATION_TARGET" }); expect(runtime.create).not.toHaveBeenCalled();
    await runPostgresMigrationsV2({ ...approved, ca: "synthetic-test-ca" });
    expect(runtime.create).toHaveBeenCalledExactlyOnceWith({ connectionString: target.connectionString, max: 1, ca: "synthetic-test-ca" });
  });
  it.each([
    "postgresql://owner:secret@remote.invalid:5432/dream_test_unit",
    "postgresql://owner:secret@127.0.0.1:5432/production",
    `${syntheticUri}?sslmode=disable`, `${syntheticUri}#secret`,
  ])("synthetic target boundary rejects %s before any network", async connectionString => {
    const runtime = fakeRuntime();
    await expect(runPostgresMigrationsV2({ ...options(), target: { ...options().target, connectionString } })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it.each(["managed-session-staging", "managed-session-live", "managed-staging"] as const)("%s uses existing TLS connection contract with no local override (mock only)", async profile => {
    const runtime = fakeRuntime(), ref = "abcdefghijklmnopqrst", role = "migration_owner", host = "aws-0-ap-northeast-2.pooler.supabase.com";
    const target: MigrationTarget = profile === "managed-staging" ? { profile, projectRef: ref, connectionString: `postgresql://${role}:secret@db.${ref}.supabase.co:5432/postgres` }
      : { profile, projectRef: ref, connectionString: `postgresql://${role}.${ref}:secret@${host}:5432/postgres`, sessionHost: host, sessionPort: "5432", sessionDatabase: "postgres", sessionUsername: `${role}.${ref}`, sessionRole: role };
    const hash = inspectMigrationTarget(target).targetHash;
    await runPostgresMigrationsV2({ ...options(), target, ca: "synthetic-ca", expectedTargetHash: hash, expectedApprovalHash: postgresMigrationApprovalHashV2(4, hash, "apply") });
    expect(runtime.create).toHaveBeenCalledExactlyOnceWith({ connectionString: target.connectionString, max: 1, ca: "synthetic-ca" });
  });
  it.each([{ sessionPort: "6543" }, { sessionRole: "another" }, { projectRef: "wrong" }, { sessionHost: "other.pooler.supabase.com" }, { sessionDatabase: "other" }])("managed session metadata mismatch rejects before connection %s", async change => {
    const runtime = fakeRuntime(), ref = "abcdefghijklmnopqrst", role = "migration_owner", host = "aws-0-ap-northeast-2.pooler.supabase.com";
    const target: MigrationTarget = { profile: "managed-session-staging", projectRef: ref, connectionString: `postgresql://${role}.${ref}:secret@${host}:5432/postgres`, sessionHost: host, sessionPort: "5432", sessionDatabase: "postgres", sessionUsername: `${role}.${ref}`, sessionRole: role };
    const hash = inspectMigrationTarget(target).targetHash;
    await expect(runPostgresMigrationsV2({ ...options(), target: { ...target, ...change }, ca: "synthetic-ca", expectedTargetHash: hash, expectedApprovalHash: postgresMigrationApprovalHashV2(4, hash, "apply") })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(runtime.create).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.env.DREAM_PG_B23_SCHEMA_TEST !== "1")("B23 owned PostgreSQL18.7 transaction and concurrency matrix", () => {
  let admin: Pool, uri: string;
  const owner = "00000000-0000-4000-8000-000000000001";
  const run = (version: 3 | 4 = 4, mode: "apply" | "dry-run" = "apply") => runPostgresMigrationsV2(options(version, mode, uri));
  const runV1 = () => { const target = { connectionString: uri, profile: "synthetic" as const }; return runPostgresMigrations({ target, expectedTargetHash: inspectMigrationTarget(target).targetHash, mode: "apply" }); };
  const history = async () => (await admin.query("SELECT ordinal,id,checksum,applied_at FROM dream_migrations.history ORDER BY ordinal")).rows;
  beforeAll(async () => {
    uri = process.env.DREAM_PG_TEST_ADMIN_URL ?? ""; const u = new URL(uri);
    if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || !u.port || u.username !== "dream_test_admin" || !/^\/dream_test_[a-z0-9_]+$/.test(u.pathname) || u.search || u.hash) throw Error("Explicit fresh owned synthetic target required");
    admin = new Pool({ connectionString: uri, max: 5 });
    expect((await admin.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('auth') AS auth")).rows[0]).toEqual({ dream: null, auth: null });
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)"); await admin.query("INSERT INTO auth.users VALUES($1)", [owner]);
  });
  beforeEach(async () => {
    await admin.query("DROP EVENT TRIGGER IF EXISTS b23_fail; DROP FUNCTION IF EXISTS public.b23_fail(); DROP SEQUENCE IF EXISTS public.b23_once; DROP SCHEMA IF EXISTS dream CASCADE; DROP SCHEMA IF EXISTS dream_migrations CASCADE; DROP ROLE IF EXISTS dream_api_login; DROP ROLE IF EXISTS dream_worker_login; DROP ROLE IF EXISTS dream_api; DROP ROLE IF EXISTS dream_worker");
  });
  afterAll(async () => { await admin?.end(); });
  async function fresh() {
    expect((await admin.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('dream_migrations') AS history")).rows[0]).toEqual({ dream: null, history: null });
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('dream_api','dream_worker')")).rows[0].n).toBe(0);
  }
  async function failDdl(once = false) {
    if (once) await admin.query("CREATE SEQUENCE public.b23_once");
    await admin.query(`CREATE FUNCTION public.b23_fail() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF to_regclass('dream.storage_verification_runs') IS NOT NULL ${once ? "AND nextval('public.b23_once')=1" : ""} THEN RAISE EXCEPTION 'owned synthetic SQL4 failure'; END IF; END $$; CREATE EVENT TRIGGER b23_fail ON ddl_command_start WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.b23_fail()`);
  }
  async function inspect(version: 3 | 4) {
    const c = await admin.connect(), u = new URL(uri);
    try { await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog"); return await state.inspectPostgresMigrationStateV2(c, { version, database: u.pathname.slice(1), username: u.username, port: Number(u.port) }); }
    finally { await c.query("ROLLBACK"); c.release(); }
  }
  async function waiters(minimum: number) {
    const deadline = Date.now() + 5000;
    do {
      const rows = (await admin.query("SELECT l.pid,a.wait_event_type,a.wait_event FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.classid=$1::oid AND l.objid=$2::oid AND NOT l.granted ORDER BY l.pid", [...migrationLock])).rows;
      if (rows.length >= minimum) { expect(rows.every(r => r.wait_event_type === "Lock" && r.wait_event === "advisory")).toBe(true); return rows; }
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw Error("Owned advisory wait was not observed");
  }
  async function compete(first: () => Promise<unknown>, second: () => Promise<unknown>) {
    const gate = await admin.connect(), work: Promise<unknown>[] = [];
    try {
      await gate.query("BEGIN"); await gate.query("SELECT pg_advisory_xact_lock($1,$2)", [...migrationLock]);
      work.push(first()); work[0].catch(() => {}); await waiters(1);
      work.push(second()); work[1].catch(() => {}); const observed = await waiters(2);
      await appendFile(join(process.env.DREAM_PG_B23_EVIDENCE_ROOT!, "lock-observations.jsonl"), JSON.stringify({ pids: observed, at: new Date().toISOString() }) + "\n");
      await gate.query("COMMIT"); return await Promise.allSettled(work);
    } finally { await gate.query("ROLLBACK"); gate.release(); await Promise.allSettled(work); }
  }
  it.each([3, 4] as const)("fresh%s apply is atomic and same-version reexecution is zero", async version => {
    expect(await run(version, "dry-run")).toMatchObject({ applied: 0, pending: version, fromVersion: null }); await fresh();
    expect(await run(version)).toMatchObject({ applied: version, pending: 0, schemaVersion: version, fromVersion: null });
    const before = await history(); expect(await run(version)).toMatchObject({ applied: 0, pending: 0, fromVersion: version }); expect(await history()).toEqual(before);
    expect(await inspect(version)).toMatchObject({ state: "complete", version, pending: 0 });
  });
  it("complete3→4 preserves exact first3 history and existing business data", async () => {
    await runV1(); const before = await history(); await admin.query("INSERT INTO dream.settings(owner_id,key,value_json) VALUES($1,'sentinel',$2)", [owner, ' {"preserve":true} ']);
    expect(await run(4, "dry-run")).toMatchObject({ applied: 0, pending: 1, fromVersion: 3 });
    expect(await run(4)).toMatchObject({ applied: 1, pending: 0, fromVersion: 3 }); expect((await history()).slice(0, 3)).toEqual(before);
    expect((await admin.query("SELECT value_json FROM dream.settings WHERE key='sentinel'")).rows[0].value_json).toBe(' {"preserve":true} ');
    await expect(run(3)).rejects.toMatchObject({ code: "MIGRATION_STATE" }); await expect(runV1()).rejects.toMatchObject({ code: "MIGRATION_HISTORY" });
  });
  it("mid-SQL4 failure on fresh4 rolls back SQL1–4/history/roles together", async () => {
    await failDdl(); await expect(run()).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "not-applied" }); await fresh();
    expect((await admin.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n).toBe(1);
  });
  it("mid-SQL2 failure on fresh3 rolls back all prefix DDL and history", async () => {
    await admin.query("CREATE FUNCTION public.b23_fail() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF to_regclass('dream.assets') IS NOT NULL THEN RAISE EXCEPTION 'owned SQL2 failure'; END IF; END $$; CREATE EVENT TRIGGER b23_fail ON ddl_command_start WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION public.b23_fail()");
    await expect(run(3)).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "not-applied" }); await fresh();
  });
  it("postcatalog rejection after row4 insertion rolls back the entire fresh4 transaction", async () => {
    await admin.query("CREATE FUNCTION public.b23_fail() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF to_regclass('dream.creation_operations') IS NOT NULL THEN EXECUTE 'ALTER TABLE dream.assets ADD COLUMN b23_drift text'; END IF; END $$; CREATE EVENT TRIGGER b23_fail ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.b23_fail()");
    const original = state.inspectPostgresMigrationStateV2; let observedRows = 0;
    vi.spyOn(state, "inspectPostgresMigrationStateV2").mockImplementation(async (client, value) => {
      if (value.version === 4 && (await client.query("SELECT to_regclass('dream.creation_operations') AS object")).rows[0].object) {
        observedRows = (await client.query("SELECT count(*)::int AS n FROM dream_migrations.history")).rows[0].n;
      }
      return original(client, value);
    });
    await expect(run()).rejects.toMatchObject({ code: "MIGRATION_STATE" }); expect(observedRows).toBe(4); await fresh();
  });
  it("mid-SQL4 upgrade failure retains complete3 history/data and no SQL4 residue", async () => {
    await run(3); const before = await history(); await admin.query("INSERT INTO dream.settings VALUES($1,'keep','{}')", [owner]); await failDdl();
    await expect(run()).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "not-applied" }); expect(await history()).toEqual(before);
    expect((await admin.query("SELECT to_regclass('dream.storage_objects') AS object")).rows[0].object).toBeNull(); expect((await admin.query("SELECT key FROM dream.settings")).rows).toEqual([{ key: "keep" }]);
    expect(await inspect(3)).toMatchObject({ state: "complete", version: 3 });
  });
  it.each(["partial", "checksum", "unknown", "catalog", "historyless"])("%s state rejects without repair or history adoption", async kind => {
    await run(3);
    if (kind === "partial") await admin.query("DELETE FROM dream_migrations.history WHERE ordinal=3");
    if (kind === "checksum") await admin.query("UPDATE dream_migrations.history SET checksum=repeat('0',64) WHERE ordinal=1");
    if (kind === "unknown") await admin.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES(5,'unknown',repeat('0',64))");
    if (kind === "catalog") await admin.query("ALTER TABLE dream.assets ADD COLUMN extra text");
    if (kind === "historyless") { const { loadPostgresMigrationsV2 } = await import("@/lib/db/postgres/migration-manifest-v2"); const source = await loadPostgresMigrationsV2(4); await admin.query(source[3].sql); }
    const before = await history(); await expect(run()).rejects.toMatchObject({ code: ["catalog", "historyless"].includes(kind) ? "MIGRATION_STATE" : "MIGRATION_HISTORY" }); expect(await history()).toEqual(before);
  });
  it("two real fresh4 callers wait then reobserve winner, with applied4/0", async () => {
    const results = await compete(() => run(), () => run()); expect(results).toMatchObject([{ status: "fulfilled", value: { applied: 4 } }, { status: "fulfilled", value: { applied: 0, fromVersion: 4 } }]);
    expect(await history()).toHaveLength(4);
  });
  it("two real upgrade4 callers wait then reobserve winner, with applied1/0", async () => {
    await run(3); const before = await history(); const results = await compete(() => run(), () => run());
    expect(results).toMatchObject([{ status: "fulfilled", value: { applied: 1 } }, { status: "fulfilled", value: { applied: 0, fromVersion: 4 } }]); expect((await history()).slice(0, 3)).toEqual(before);
  });
  it("mixed v1-first then v2 observes complete3 and upgrades only4", async () => {
    expect(await compete(runV1, () => run())).toMatchObject([{ status: "fulfilled", value: { applied: 3 } }, { status: "fulfilled", value: { applied: 1, fromVersion: 3 } }]);
  });
  it("mixed v2-first then v1 retains v1 rejection of complete4", async () => {
    expect(await compete(() => run(), runV1)).toMatchObject([{ status: "fulfilled", value: { applied: 4 } }, { status: "rejected", reason: { code: "MIGRATION_HISTORY" } }]);
  });
  it("first real runner rolls back DDL; waiting second reobserves fresh and succeeds", async () => {
    await failDdl(true);
    expect(await compete(() => run(), () => run())).toMatchObject([{ status: "rejected", reason: { code: "MIGRATION_FAILED", outcome: "not-applied" } }, { status: "fulfilled", value: { applied: 4, fromVersion: null } }]);
    expect(await inspect(4)).toMatchObject({ state: "complete", version: 4 });
  });
  it("a stale dry-run is not authority; apply rejects intervening drift", async () => {
    await run(3); expect(await run(4, "dry-run")).toMatchObject({ pending: 1 }); await admin.query("GRANT SELECT ON dream_migrations.history TO dream_api");
    await expect(run()).rejects.toMatchObject({ code: "MIGRATION_STATE" }); expect(await history()).toHaveLength(3);
  });
  it("all owned API pools close without remaining backend connections", async () => {
    await run(4); await run(4, "dry-run");
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='dream-backend'")).rows[0].n).toBe(0);
  });
  it("real committed SQL4 with deliberately lost response reports unknown and next approved run inspects zero", async () => {
    const original = connection.createPostgresPool, releases: unknown[] = [], statements: string[] = [];
    vi.spyOn(connection, "createPostgresPool").mockImplementation(value => {
      const pool = original(value), acquire = pool.connect.bind(pool);
      Object.defineProperty(pool, "connect", { value: async () => {
        const client = await acquire(), query = client.query.bind(client) as (sql: string, values?: unknown[]) => Promise<QueryResult>;
        const release = client.release.bind(client);
        client.release = error => { releases.push(error); release(error); };
        Object.defineProperty(client, "query", { value: async (sql: string, values?: unknown[]) => {
          statements.push(sql); const result = await query(sql, values);
          if (sql === "COMMIT") throw Error("owned response discarded after real server COMMIT");
          return result;
        } });
        return client;
      } });
      return pool;
    });
    await expect(run()).rejects.toMatchObject({ code: "MIGRATION_FAILED", outcome: "unknown" });
    expect(releases).toEqual([true]); expect(statements).not.toContain("ROLLBACK");
    expect(await history()).toHaveLength(4); expect(await inspect(4)).toMatchObject({ state: "complete", version: 4 });
    vi.restoreAllMocks();
    expect(await run()).toMatchObject({ applied: 0, pending: 0, fromVersion: 4 });
  });
});
