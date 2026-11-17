import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "@/lib/db/postgres/connection";
import { inspectMigrationTarget, type MigrationTarget } from "@/lib/db/postgres/migration-target";
import { runPostgresMigrations, migrationLock } from "@/lib/db/postgres/migration-runner";
import { postgresMigrationManifest } from "@/lib/db/postgres/migration-manifest";
import { postgresProvisionTemplate } from "@/lib/db/postgres/provision-template";
import { runMigrationCli } from "../../scripts/postgres/migrate";
vi.mock("server-only", () => ({}));
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
describe.skipIf(process.env.DREAM_PG_MIGRATION_TEST !== "1")("B5 actual atomic migration/provision runner", () => {
  let pool: Pool, target: MigrationTarget, hash: string, api: Pool, worker: Pool;
  let runtimePoolsClosed = false;
  beforeAll(async () => {
    const uri = process.env.DREAM_PG_MIGRATION_TEST_URL ?? "";
    target = { connectionString: uri, profile: "synthetic" };
    const identity = inspectMigrationTarget(target);
    if (identity.username !== "dream_test_admin") throw new Error("Synthetic migration admin required");
    hash = identity.targetHash;
    pool = createPostgresPool({ connectionString: uri, max: 4, localTestWithoutTls: true });
    const state = (await pool.query("SELECT to_regnamespace('dream')::text AS dream,to_regnamespace('auth')::text AS auth")).rows[0];
    if (state.dream || state.auth) throw new Error("Fresh owned cluster required");
  });
  afterAll(async () => { await Promise.all([pool?.end(), ...(runtimePoolsClosed ? [] : [api?.end(), worker?.end()])]); });
  const run = (mode: "dry-run" | "apply" = "apply") => runPostgresMigrations({ target, expectedTargetHash: hash, mode });
  const absent = async () => (await pool.query("SELECT to_regnamespace('dream')::text AS dream,to_regnamespace('dream_migrations')::text AS history,(SELECT count(*)::int FROM pg_roles WHERE rolname IN ('dream_api','dream_worker')) AS roles")).rows[0];

  it("dry-run rejects missing Auth FK prerequisites without creating anything", async () => {
    await expect(run("dry-run")).rejects.toMatchObject({ code: "MIGRATION_STATE" });
    expect(await absent()).toEqual({ dream: null, history: null, roles: 0 });
    await pool.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id text PRIMARY KEY)");
    await expect(run("dry-run")).rejects.toMatchObject({ code: "MIGRATION_STATE" });
    await pool.query("ALTER TABLE auth.users ALTER COLUMN id TYPE uuid USING id::uuid");
    await pool.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  });
  it("fresh dry-run reports pending3, safe hash and zero writes", async () => {
    const result = await run("dry-run"); expect(result).toMatchObject({ targetHash: hash, applied: 0, pending: 3 });
    expect(await absent()).toEqual({ dream: null, history: null, roles: 0 });
    expect(JSON.stringify(result)).not.toContain(target.connectionString);
  });
  it("unknown pre-existing role/schema is never adopted or changed", async () => {
    await pool.query("CREATE ROLE dream_api NOLOGIN");
    try { await expect(run()).rejects.toMatchObject({ code: "MIGRATION_STATE" }); }
    finally { await pool.query("DROP ROLE dream_api"); }
    await pool.query("CREATE ROLE dream_api_login NOLOGIN");
    try { await expect(run()).rejects.toMatchObject({ code: "MIGRATION_STATE" }); }
    finally { await pool.query("DROP ROLE dream_api_login"); }
    await pool.query("CREATE SCHEMA dream");
    try { await expect(run()).rejects.toMatchObject({ code: "MIGRATION_STATE" }); }
    finally { await pool.query("DROP SCHEMA dream"); }
  });
  it("a real mid-script SQL failure rolls back all SQL, history and roles", async () => {
    await pool.query("CREATE FUNCTION public.b5_fail() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF current_query() LIKE '%CREATE FUNCTION dream.guard_row%' THEN RAISE EXCEPTION 'synthetic middle failure'; END IF; END $$; CREATE EVENT TRIGGER b5_fail ON ddl_command_start WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION public.b5_fail()");
    try {
      await expect(run()).rejects.toMatchObject({ code: "MIGRATION_FAILED" });
      expect(await absent()).toEqual({ dream: null, history: null, roles: 0 });
    } finally { await pool.query("DROP EVENT TRIGGER b5_fail; DROP FUNCTION public.b5_fail()"); }
  });
  it("two real runners wait on the same advisory lock then apply3/0 exactly once", async () => {
    const gate = await pool.connect(); await gate.query("BEGIN"); await gate.query("SELECT pg_advisory_xact_lock($1,$2)", [...migrationLock]);
    const first = run(), second = run();
    try {
      await vi.waitFor(async () => {
        const row = (await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'")).rows[0];
        expect(row.n).toBe(2);
      });
      expect(await absent()).toEqual({ dream: null, history: null, roles: 0 });
    } finally { await gate.query("COMMIT"); gate.release(); }
    const results = await Promise.all([first, second]);
    expect(results.map(row => row.applied).sort()).toEqual([0, 3]);
    expect((await pool.query("SELECT count(*)::int AS n FROM dream_migrations.history")).rows[0].n).toBe(3);
  });
  it("re-run and dry-run apply zero, while unknown/mismatched history is rejected", async () => {
    expect(await run()).toMatchObject({ applied: 0, pending: 0 });
    expect(await run("dry-run")).toMatchObject({ applied: 0, pending: 0 });
    await pool.query("UPDATE dream_migrations.history SET checksum=$1 WHERE ordinal=1", ["a".repeat(64)]);
    try { await expect(run()).rejects.toMatchObject({ code: "MIGRATION_HISTORY" }); }
    finally { await pool.query("UPDATE dream_migrations.history SET checksum=$1 WHERE ordinal=1", [postgresMigrationManifest[0].checksum]); }
    await pool.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES(4,'unknown',$1)", ["a".repeat(64)]);
    try { await expect(run()).rejects.toMatchObject({ code: "MIGRATION_HISTORY" }); }
    finally { await pool.query("DELETE FROM dream_migrations.history WHERE ordinal=4"); }
  });
  it("18 FORCE RLS tables,36 policies,18 guards remain owned by migration login", async () => {
    expect((await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)")).rows[0].n).toBe(18);
    expect((await pool.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='dream'")).rows[0].n).toBe(36);
    const provision = await pool.connect();
    try {
      await provision.query(postgresProvisionTemplate());
      await expect(provision.query(postgresProvisionTemplate())).rejects.toThrow("Existing login");
      await provision.query("ROLLBACK");
    } finally { provision.release(); }
    expect((await pool.query("SELECT count(*)::int AS n FROM pg_authid WHERE rolname IN ('dream_api_login','dream_worker_login') AND rolpassword IS NULL")).rows[0].n).toBe(2);
    await pool.query("ALTER ROLE dream_api_login PASSWORD 'b5-synthetic-api'; ALTER ROLE dream_worker_login PASSWORD 'b5-synthetic-worker'");
    const apiUrl = new URL(target.connectionString); apiUrl.username = "dream_api_login"; apiUrl.password = "b5-synthetic-api";
    const workerUrl = new URL(target.connectionString); workerUrl.username = "dream_worker_login"; workerUrl.password = "b5-synthetic-worker";
    api = createPostgresPool({ connectionString: apiUrl.toString(), localTestWithoutTls: true });
    worker = createPostgresPool({ connectionString: workerUrl.toString(), localTestWithoutTls: true });
  });
  it("application login cannot run migrations, DDL, history writes or implicit dream reads", async () => {
    await expect(api.query("CREATE TABLE dream.forbidden(id integer)")).rejects.toMatchObject({ code: "42501" });
    await expect(api.query("SELECT * FROM dream.projects")).rejects.toMatchObject({ code: "42501" });
    await expect(api.query("DELETE FROM dream_migrations.history")).rejects.toMatchObject({ code: "42501" });
    const url = new URL(target.connectionString); url.username = "dream_api_login"; url.password = "b5-synthetic-api";
    const deniedTarget = { ...target, connectionString: url.toString() };
    await expect(runPostgresMigrations({ target: deniedTarget, expectedTargetHash: inspectMigrationTarget(deniedTarget).targetHash, mode: "apply" })).rejects.toMatchObject({ code: "MIGRATION_PRIVILEGE" });
  });
  it("API RLS owner isolation and immutable identity guards survive runner application", async () => {
    const client = await api.connect();
    try {
      await client.query("BEGIN; SET LOCAL ROLE dream_api"); await client.query("SELECT set_config('dream.actor_id',$1,true)", [A]);
      await client.query("INSERT INTO dream.settings VALUES($1,'same','{}')", [A]); await client.query("COMMIT");
      await client.query("BEGIN; SET LOCAL ROLE dream_api"); await client.query("SELECT set_config('dream.actor_id',$1,true)", [B]);
      expect((await client.query("SELECT * FROM dream.settings")).rows).toEqual([]);
      await expect(client.query("INSERT INTO dream.settings VALUES($1,'forged','{}')", [A])).rejects.toMatchObject({ code: "42501" }); await client.query("ROLLBACK");
      await client.query("BEGIN; SET LOCAL ROLE dream_api"); await client.query("SELECT set_config('dream.actor_id',$1,true)", [A]);
      await expect(client.query("UPDATE dream.settings SET owner_id=$1", [B])).rejects.toMatchObject({ code: "23514" }); await client.query("ROLLBACK");
    } finally { client.release(); }
    const trusted = await worker.connect();
    try {
      await trusted.query("BEGIN; SET LOCAL ROLE dream_worker");
      expect((await trusted.query("SELECT owner_id FROM dream.settings")).rows).toEqual([{ owner_id: A }]);
      await expect(trusted.query("TRUNCATE dream.settings")).rejects.toMatchObject({ code: "42501" }); await trusted.query("ROLLBACK");
    } finally { trusted.release(); }
  });
  it("actual safe CLI dry-run returns only target hash and manifest, without identifiers/secrets", async () => {
    const lines: string[] = [];
    const code = await runMigrationCli(["dry-run"], { DREAM_PG_MIGRATION_URL: target.connectionString, DREAM_PG_MIGRATION_PROFILE: "synthetic", DREAM_PG_MIGRATION_TARGET_HASH: hash }, line => lines.push(line));
    expect(code).toBe(0); expect(JSON.parse(lines[0])).toMatchObject({ targetHash: hash, applied: 0, pending: 0 });
    expect(lines.join()).not.toContain("dream_test_admin"); expect(lines.join()).not.toContain("127.0.0.1"); expect(lines.join()).not.toContain(target.connectionString);
  });
  it("runner-installed timeline raw-hash and append-only guards reject real writes", async () => {
    const client = await api.connect();
    const project = "00000000-0000-4000-8000-000000000010", timeline = "00000000-0000-4000-8000-000000000020";
    const raw = ' { "schemaVersion": 1, "audio": [] } ';
    try {
      await client.query("BEGIN; SET LOCAL ROLE dream_api"); await client.query("SELECT set_config('dream.actor_id',$1,true)", [A]);
      await client.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,'test','1','{}','{}','Synthetic','test','test','9:16',4,now(),now())", [A, project]);
      await client.query("INSERT INTO dream.timeline_revisions(owner_id,id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,created_at) VALUES($1,$2,$3,1,1,$4,$5,'user',now())", [A, timeline, project, raw, createHash("sha256").update(raw).digest("hex")]);
      expect((await client.query("SELECT timeline_json FROM dream.timeline_revisions")).rows[0].timeline_json).toBe(raw);
      await client.query("SAVEPOINT bad_hash");
      await expect(client.query("INSERT INTO dream.timeline_revisions(owner_id,id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,created_at) VALUES($1,$2,$3,2,1,$4,$5,'user',now())", [A, "00000000-0000-4000-8000-000000000021", project, raw, "a".repeat(64)])).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT bad_hash; RELEASE SAVEPOINT bad_hash");
      await client.query("SAVEPOINT history_guard");
      await expect(client.query("DELETE FROM dream.timeline_revisions")).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT history_guard; RELEASE SAVEPOINT history_guard");
      await client.query("COMMIT");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("actual CLI connection rejection prints no credential, host or driver detail", async () => {
    const url = new URL(target.connectionString); url.password = "b5-wrong-synthetic-password";
    const lines: string[] = [];
    expect(await runMigrationCli(["apply"], { DREAM_PG_MIGRATION_URL: url.toString(), DREAM_PG_MIGRATION_PROFILE: "synthetic", DREAM_PG_MIGRATION_TARGET_HASH: hash }, line => lines.push(line))).toBe(1);
    expect(lines).toEqual([JSON.stringify({ error: "MIGRATION_FAILED" })]);
  });
  it("F1: indirect SET ROLE history DELETE is real, and both modes reject the expanded graph", async () => {
    await pool.query("CREATE ROLE b5_fix_parent NOLOGIN; CREATE ROLE b5_fix_extra NOLOGIN; GRANT USAGE ON SCHEMA dream_migrations TO b5_fix_extra; GRANT DELETE ON dream_migrations.history TO b5_fix_extra; GRANT b5_fix_extra TO b5_fix_parent WITH INHERIT FALSE, SET TRUE; GRANT b5_fix_parent TO dream_api WITH INHERIT FALSE, SET TRUE");
    const end = vi.spyOn(Pool.prototype, "end");
    try {
      const client = await api.connect();
      try {
        await client.query("BEGIN; SET LOCAL ROLE b5_fix_extra");
        expect((await client.query("DELETE FROM dream_migrations.history")).rowCount).toBe(3);
        await client.query("ROLLBACK");
      } finally { client.release(); }
      await expect(run("apply")).rejects.toMatchObject({ code: "MIGRATION_STATE" });
      await expect(run("dry-run")).rejects.toMatchObject({ code: "MIGRATION_STATE" });
      expect(end).toHaveBeenCalledTimes(2);
    } finally { end.mockRestore(); await pool.query("REVOKE b5_fix_parent FROM dream_api; REVOKE b5_fix_extra FROM b5_fix_parent; REVOKE ALL ON TABLE dream_migrations.history FROM b5_fix_extra; REVOKE ALL ON SCHEMA dream_migrations FROM b5_fix_extra; DROP ROLE b5_fix_parent; DROP ROLE b5_fix_extra"); }
  });
  it("F1 template rejects a worker parent before creating either login", async () => {
    // This dedicated synthetic case removes only the logins it provisioned above.
    await api.end(); await worker.end(); runtimePoolsClosed = true;
    await pool.query("DROP ROLE dream_api_login; DROP ROLE dream_worker_login; CREATE ROLE b5_fix_template_parent NOLOGIN; GRANT b5_fix_template_parent TO dream_worker WITH INHERIT FALSE, SET TRUE");
    const client = await pool.connect();
    try {
      await expect(client.query(postgresProvisionTemplate())).rejects.toThrow("Unexpected runtime role graph");
      await client.query("ROLLBACK");
      expect((await client.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('dream_api_login','dream_worker_login')")).rows[0].n).toBe(0);
    } finally {
      await client.query("ROLLBACK"); client.release();
      await pool.query("REVOKE b5_fix_template_parent FROM dream_worker; DROP ROLE b5_fix_template_parent");
    }
    const end = vi.spyOn(Pool.prototype, "end");
    try { expect(await run("dry-run")).toMatchObject({ applied: 0, pending: 0 }); expect(end).toHaveBeenCalledTimes(1); }
    finally { end.mockRestore(); }
  });
  it.each(["apply", "dry-run"] as const)("F2: an independently supplied IPv4 pool with IPv6 target is rejected in %s", async mode => {
    const otherTarget = { ...target, connectionString: target.connectionString.replace("127.0.0.1", "[::1]") };
    expect((await pool.query("SELECT host(inet_server_addr()) AS address")).rows[0].address).toBe("127.0.0.1");
    const legacy = { pool, target: otherTarget, expectedTargetHash: inspectMigrationTarget(otherTarget).targetHash, mode };
    await expect(runPostgresMigrations(legacy as unknown as Parameters<typeof runPostgresMigrations>[0])).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect((await pool.query("SELECT count(*)::int AS n FROM dream_migrations.history")).rows[0].n).toBe(3);
  });
  it.each(["BEGIN", "COMMIT", "ROLLBACK", "COMMIT_AS_ROLLBACK"])("owned client is destroyed and pool ended on %s failure", async point => {
    const originalConnect = Pool.prototype.connect as unknown as (this: Pool) => Promise<PoolClient>;
    let destroyed: boolean | undefined;
    const end = vi.spyOn(Pool.prototype, "end");
    const connect = vi.spyOn(Pool.prototype, "connect").mockImplementation((async function(this: Pool) {
      const client = await originalConnect.call(this);
      return new Proxy(client, { get(real, key) {
        if (key === "release") return (bad: boolean) => { destroyed = bad; real.release(bad); };
        if (key === "query") return async (sql: string, params?: unknown[]) => {
          if ((point === "BEGIN" && sql.startsWith("BEGIN")) || (point === "COMMIT" && sql === "COMMIT") || (point === "ROLLBACK" && (sql === "ROLLBACK" || sql.startsWith("SELECT current_database")))) throw new Error("synthetic driver failure with private text");
          if (point === "COMMIT_AS_ROLLBACK" && sql === "COMMIT") return real.query("ROLLBACK");
          return real.query(sql, params);
        };
        const value = Reflect.get(real, key); return typeof value === "function" ? value.bind(real) : value;
      } });
    }) as unknown as Pool["connect"]);
    try {
      await expect(run("dry-run")).rejects.toMatchObject({ code: "MIGRATION_FAILED" });
      expect(destroyed).toBe(true); expect(end).toHaveBeenCalledTimes(1);
    } finally { connect.mockRestore(); end.mockRestore(); }
  });
});
