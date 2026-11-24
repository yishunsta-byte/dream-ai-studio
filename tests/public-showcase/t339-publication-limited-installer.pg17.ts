import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, DatabaseError } from "pg";
import { loadPostgresMigrationsV2 } from "../../lib/db/postgres/migration-manifest-v2";
import { loadPostgresMigrationsV3 } from "../../lib/db/postgres/migration-manifest-v3";
import { inspectPostgresMigrationStateV2, readPostgresCatalogV2 } from "../../lib/db/postgres/migration-state-v2";
import { publicationInstallation } from "../../lib/db/postgres/publication/installation";
import { runT338PublicationInstallation } from "./t338-publication-installation.pg17";

type Fixture = Parameters<typeof runT338PublicationInstallation>[1];
const foundation = "t339_foundation";
const profiles = [
  { name: "t339_db_create", createRole: false, createSchema: true, denied: /permission.*(create role|roles)/i },
  { name: "t339_role_create", createRole: true, createSchema: false, denied: /permission denied for database/i },
  { name: "t339_limited", createRole: true, createSchema: true, denied: /must be able to SET ROLE/i },
] as const;

// Capture only synthetic SQLSTATE/message for precise diagnosis. The public installation API stays sanitized.
function observe(client: Client) {
  let last: DatabaseError | undefined;
  const session = {
    getTransactionStatus: () => client.getTransactionStatus(),
    query: (async (sql: string, values?: unknown[]) => {
      try { return await client.query(sql, values); }
      catch (error) { if (error instanceof DatabaseError) last = error; throw error; }
    }) as Client["query"],
  };
  return { session, failure: () => last };
}

async function readOnly<T>(client: Client, read: () => Promise<T>) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL search_path=pg_catalog");
    return await read();
  } finally { await client.query("ROLLBACK"); }
}

export async function runT339LimitedPublicationInstaller(control: Client, fixture: Fixture) {
  const { host, port, database, ca } = fixture;
  assert(host === "127.0.0.1" && /^t253_[a-f0-9]{32}$/.test(database));
  const { rows: [cluster] } = await control.query("SELECT system_identifier::text AS identifier FROM pg_control_system()");
  const target = { database, systemIdentifier: String(cluster.identifier), port };

  async function login(name: string, createRole: boolean, createSchema: boolean) {
    const password = randomBytes(24).toString("hex");
    await control.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOINHERIT NOBYPASSRLS NOCREATEDB
      NOREPLICATION ${createRole ? "CREATEROLE" : "NOCREATEROLE"}`);
    if (createSchema) await control.query(`GRANT CREATE ON DATABASE ${database} TO ${name}`);
    const client = new Client({ connectionString: fixture.url(name, password), ssl: { ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 5000, statement_timeout: 8000, application_name: "t339-limited-installer" });
    try { await client.connect(); return client; }
    catch (error) { await client.end().catch(() => undefined); throw error; }
  }

  const base = await login(foundation, true, true);
  const inspectBase = (version: 3 | 4) => inspectPostgresMigrationStateV2(base, { version, targetVersion: version, database, username: foundation, port });
  try {
    const authSentinel = randomUUID();
    await control.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      GRANT USAGE ON SCHEMA auth TO ${foundation}; GRANT REFERENCES ON auth.users TO ${foundation}`);
    await control.query("INSERT INTO auth.users VALUES($1)", [authSentinel]);
    const source = await loadPostgresMigrationsV2(4);
    assert.equal(source.length, 4);

    // Owned TLS-only fixture: checksum-checked v2 sources and existing catalog verification.
    // Use the journal contract without adding a non-TLS path for the synthetic v2 CLI profile.
    await base.query("BEGIN");
    try {
      await base.query("SET LOCAL search_path=pg_catalog");
      assert.deepEqual(await inspectBase(3), { state: "fresh", version: null, pending: 3 });
      await base.query(`CREATE SCHEMA dream_migrations; REVOKE ALL ON SCHEMA dream_migrations FROM PUBLIC;
        CREATE TABLE dream_migrations.history(ordinal integer PRIMARY KEY CHECK(ordinal>0),id text NOT NULL UNIQUE,
          checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT transaction_timestamp());
        REVOKE ALL ON TABLE dream_migrations.history FROM PUBLIC`);
      for (const [index, entry] of source.slice(0, 3).entries()) {
        await base.query(entry.sql);
        await base.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES($1,$2,$3)", [index + 1, entry.id, entry.checksum]);
      }
      assert.deepEqual(await inspectBase(3), { state: "complete", version: 3, pending: 0 });
      await base.query("COMMIT");
    } catch (error) { await base.query("ROLLBACK"); throw error; }
    assert.deepEqual(await readOnly(base, () => inspectBase(3)), { state: "complete", version: 3, pending: 0 });
    await assert.rejects(readOnly(base, () => inspectBase(4)), { code: "MIGRATION_STATE" });

    // Exercise fixed SQL4 DDL coexistence only. PG17 schema4 does not pass the v2
    // catalog gate, so this fixture does not add a schema4 migration history row.
    await base.query("BEGIN");
    try {
      await base.query("SET LOCAL search_path=pg_catalog");
      await base.query(source[3].sql);
      await assert.rejects(inspectBase(4), { code: "MIGRATION_STATE" });
      await base.query("COMMIT");
    } catch (error) { await base.query("ROLLBACK"); throw error; }
    const v3 = await loadPostgresMigrationsV3(5);
    assert.match(v3[4].sql, /current_setting\('server_version_num'\)::integer\/10000 <> 18/);
    assert.match(v3[4].sql, /dream\.b27_expected_pg_major.*DISTINCT FROM '18'/);

    const snapshot = () => readOnly(control, async () => ({
      catalog: await readPostgresCatalogV2(control),
      history: (await control.query("SELECT ordinal,id,checksum,applied_at::text FROM dream_migrations.history ORDER BY ordinal")).rows,
      auth: (await control.query("SELECT id::text FROM auth.users ORDER BY id")).rows,
      storage: (await control.query("SELECT to_regclass('dream.storage_objects')::text AS objects, to_regnamespace('dream_reservation')::text AS reservations")).rows[0],
      foundationRoles: (await control.query(`SELECT member.rolname,parent.rolname AS parent,m.admin_option,m.inherit_option,m.set_option
        FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
        WHERE member.rolname=$1 ORDER BY parent.rolname`, [foundation])).rows,
    }));
    const before = await snapshot();
    assert.deepEqual(before.history.map(({ ordinal, id, checksum }) => ({ ordinal, id, checksum })),
      source.slice(0, 3).map(({ id, checksum }, i) => ({ ordinal: i + 1, id, checksum })));
    assert.deepEqual(before.auth, [{ id: authSentinel }]);
    assert.deepEqual(before.storage, { objects: "dream.storage_objects", reservations: null });

    async function assertAbsent() {
      assert.deepEqual(await publicationInstallation(control, { ...target, installer: fixture.installer }, "verify"), { mode: "absent", applied: false });
      const { rows: [installed] } = await control.query(`SELECT count(*)::int AS schemas FROM pg_namespace
        WHERE nspname IN ('t253_showcase','t293','t295','t_publication_install')`);
      assert.equal(installed.schemas, 0);
      assert.deepEqual(await snapshot(), before);
    }

    for (const profile of profiles) {
      const client = await login(profile.name, profile.createRole, profile.createSchema);
      try {
        const flags = (await client.query(`SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication,rolinherit,
          has_database_privilege(current_database(),'CREATE') AS schema_create,current_setting('createrole_self_grant') AS self_grant,
          (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls FROM pg_roles WHERE rolname=current_user`)).rows[0];
        assert.deepEqual(flags, { rolsuper: false, rolcreaterole: profile.createRole, rolcreatedb: false, rolbypassrls: false,
          rolreplication: false, rolinherit: false, schema_create: profile.createSchema, self_grant: "", tls: true });
        const expected = { ...target, installer: profile.name };
        assert.deepEqual(await publicationInstallation(client, expected, "verify"), { mode: "absent", applied: false });
        const observed = observe(client);
        await assert.rejects(publicationInstallation(observed.session, expected, "install"), { code: "PUBLICATION_INSTALL", outcome: "not-applied" });
        assert.equal(observed.failure()?.code, "42501");
        assert.match(observed.failure()?.message ?? "", profile.denied);
        assert.equal(client.getTransactionStatus(), "I");
        console.log(`T339 ${profile.name}: ${observed.failure()?.message}`);
      } finally { await client.end(); }
      await assertAbsent();
    }

    // Positive control on the same owned database. No privileges are added to the restricted installers.
    await runT338PublicationInstallation(control, fixture);
    assert.deepEqual(await snapshot(), before);
    const confirmed = await publicationInstallation(control, { ...target, installer: fixture.installer }, "verify");
    assert.equal(confirmed.mode, "installed");
    const readback = await control.query("SELECT version,source_sha256,catalog_sha256 FROM t_publication_install.history");
    assert.deepEqual(readback.rows, [{ version: 1, source_sha256: confirmed.sourceSha, catalog_sha256: confirmed.catalogSha }]);
    const limited = await login("t339_limited_readback", true, true);
    try {
      const observed = observe(limited);
      await assert.rejects(publicationInstallation(observed.session, { ...target, installer: "t339_limited_readback" }, "verify"),
        { code: "PUBLICATION_INSTALL", outcome: "not-applied" });
      assert.equal(observed.failure()?.code, "42501");
      assert.match(observed.failure()?.message ?? "", /permission denied for schema t_publication_install/i);
      assert.equal(limited.getTransactionStatus(), "I");
    } finally { await limited.end(); }
    assert.deepEqual(await publicationInstallation(control, { ...target, installer: fixture.installer }, "verify"), confirmed);
    assert.deepEqual(await snapshot(), before);
  } finally { await base.end(); }
  assert.equal((await control.query(`SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE application_name IN ('dream-backend','t339-limited-installer')`)).rows[0].n, 0);
  console.log("T339 restricted install and history verification blocked safely; fixed SQL1–4 coexistence and separated histories passed");
}
