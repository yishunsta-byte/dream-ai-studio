import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Client } from "pg";

const exec = promisify(execFile);
const db = "dream_test_t259";
const bootstrap = "t259_bootstrap";
const migrationOwner = "t259_migration";
const apiLogin = "dream_api_login";
const host = "127.0.0.1";
const version = 170012;
const authIds = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const executableNames = ["postgres.exe", "initdb.exe", "pg_ctl.exe"] as const;

function samePath(actual: string, expected: string) {
  return actual.replaceAll("/", "\\").toLowerCase() === expected.toLowerCase();
}

async function fileIfPresent(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "Expected a TCP port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function loopbackStatus(port: number) {
  return new Promise<string>(resolve => {
    const socket = createConnection({ host, port });
    socket.setTimeout(2000, () => socket.destroy(Object.assign(new Error(), { code: "TIMEOUT" })));
    socket.once("connect", () => { socket.destroy(); resolve("CONNECTED"); });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "ERROR"));
  });
}

type Snapshot = {
  history_exists: boolean;
  schemas: string[];
  roles: string[];
  auth_ids: string[];
  relations: number;
  functions: number;
};
type HistoryRow = { ordinal: number; id: string; checksum: string; applied_at: string; row_version: string };

async function snapshot(client: Client) {
  const { rows: [state] } = await client.query<Snapshot>(`
    SELECT to_regclass('dream_migrations.history') IS NOT NULL AS history_exists,
      ARRAY(SELECT nspname::text FROM pg_namespace
        WHERE nspname IN ('dream','dream_migrations') ORDER BY nspname) AS schemas,
      ARRAY(SELECT rolname::text FROM pg_roles
        WHERE rolname IN ('dream_api','dream_worker','dream_api_login','dream_worker_login')
        ORDER BY rolname) AS roles,
      ARRAY(SELECT id::text FROM auth.users ORDER BY id) AS auth_ids,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('dream','dream_migrations')) AS relations,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('dream','dream_migrations')) AS functions`);
  const history = state.history_exists
    ? (await client.query<HistoryRow>(`
        SELECT ordinal,id,checksum,applied_at::text AS applied_at,xmin::text AS row_version
        FROM dream_migrations.history ORDER BY ordinal`)).rows
    : [];
  return { ...state, history };
}

async function main() {
  assert(process.platform === "win32" && process.argv.length === 2, "Run without arguments on Windows");
  const systemRoot = process.env.SystemRoot;
  assert(systemRoot, "Missing Windows SystemRoot");
  const osVariables = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "TEMP", "TMP"]);
  const childEnv: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => osVariables.has(key.toUpperCase()))),
    NODE_ENV: "test",
  };
  for (const key of Object.keys(process.env)) {
    if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$|NEXT_PUBLIC_SUPABASE)/i.test(key)) {
      delete process.env[key];
    }
  }

  const { Client: PgClient } = (await import("pg")).default;
  const { loadPostgresMigrationsV2 } = await import("../../lib/db/postgres/migration-manifest-v2");
  const { postgresMigrationApprovalHashV2, runPostgresMigrationsV2 } = await import("../../lib/db/postgres/migration-runner-v2");
  const { inspectMigrationTarget } = await import("../../lib/db/postgres/migration-target");
  const { inspectPostgresMigrationStateV2 } = await import("../../lib/db/postgres/migration-state-v2");
  const { postgresProvisionTemplate } = await import("../../lib/db/postgres/provision-template");
  const manifest = await loadPostgresMigrationsV2(3);
  const expectedHistory = manifest.map(({ id, checksum }, index) => ({ ordinal: index + 1, id, checksum }));

  const ps = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
  assert(samePath(await realpath(bin), bin), "Expected the existing unlinked PG17 bin directory");
  async function powershell(command: string, variables: Record<string, string> = {}) {
    const { stdout } = await exec(ps, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + command],
      { env: { ...childEnv, ...variables }, windowsHide: true, timeout: 30000 });
    return stdout.trim();
  }
  const signatures = JSON.parse(await powershell(`
    $names = @('postgres.exe','initdb.exe','pg_ctl.exe')
    $results = @(foreach ($name in $names) {
      $file = Join-Path $env:T259_BIN $name
      $sig = Get-AuthenticodeSignature -LiteralPath $file
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'PG signature rejected' }
      [pscustomobject]@{ name=$name; valid=$true; signer='EnterpriseDB Corporation'; sha256=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant() }
    })
    ConvertTo-Json -InputObject $results -Compress`, { T259_BIN: bin }));
  for (const name of executableNames) {
    const tool = join(bin, name);
    assert(samePath(await realpath(tool), tool), "Linked PostgreSQL executable");
    const { stdout } = await exec(tool, ["--version"], { env: childEnv, windowsHide: true, timeout: 10000 });
    assert.match(stdout.trim(), /\(PostgreSQL\) 17\.12$/, "Unexpected PostgreSQL tool version");
  }

  const scratch = fileURLToPath(new URL("../../tmp", import.meta.url));
  assert(samePath(await realpath(scratch), scratch), "Expected an unlinked workspace tmp directory");
  const root = join(scratch, "t259-pg17-" + randomUUID());
  await mkdir(root);
  const data = join(root, "data");
  const pidFile = join(data, "postmaster.pid");
  const serverLog = join(root, "postgres.log");
  const port = await availablePort();
  const password = randomBytes(32).toString("hex");
  const migrationPassword = randomBytes(32).toString("hex");
  const apiPassword = randomBytes(32).toString("hex");
  const passwordFile = join(root, "init-password.txt");
  const writeEvidence = (name: string, value: unknown) =>
    writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await writeEvidence("preflight.json", { root, bin, signatures, postgres: "17.12", data, host, port, db, bootstrap, migrationOwner, apiLogin, expectedHistory });
  console.log("T259 evidence:", root);

  const postgres = join(bin, "postgres.exe");
  const cases: Record<string, unknown>[] = [];
  let phase = "initdb";
  let startAttempted = false;
  let pid: number | undefined;
  let stopStatus: string | undefined;
  const dsn = (login: string, secret: string) => `postgresql://${login}:${secret}@${host}:${port}/${db}`;
  const target = { connectionString: dsn(migrationOwner, migrationPassword), profile: "synthetic" } as const;
  async function readPostmasterPid() {
    const text = await fileIfPresent(pidFile);
    if (text === null) return undefined;
    const [recordedPid, directory, , recordedPort] = text.split(/\r?\n/);
    assert(/^[1-9][0-9]+$/.test(recordedPid), "Invalid postmaster PID");
    assert(samePath(await realpath(directory), data), "Postmaster data directory mismatch");
    assert.equal(Number(recordedPort), port, "Postmaster port mismatch");
    return Number(recordedPid);
  }
  async function osState(pid: number | undefined) {
    return JSON.parse(await powershell(String.raw`
      $directory = [regex]::Escape($env:T259_DATA)
      $dataArgument = '(?:^|\s)-D\s+(?:"' + $directory + '"|' + $directory + ')(?:\s|$)'
      $owned = @(Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'" | Where-Object {
        $_.ExecutablePath -ieq $env:T259_POSTGRES -and $_.CommandLine -and
        $_.CommandLine.Replace('/', '\') -match $dataArgument
      })
      $listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq ([int]$env:T259_PORT))
      [pscustomobject]@{
        pidPresent=($env:T259_PID -ne '0' -and @(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:T259_PID)).Count -gt 0)
        ownedPids=@($owned | ForEach-Object { [int]$_.ProcessId })
        listeners=@($listeners | ForEach-Object { @{address=$_.LocalAddress; pid=[int]$_.OwningProcess} })
      } | ConvertTo-Json -Depth 4 -Compress`,
    { T259_POSTGRES: postgres, T259_DATA: data, T259_PORT: String(port), T259_PID: String(pid ?? 0) }));
  }
  async function withConnection<T>(database: string, fn: (client: Client) => Promise<T>, asMigration = false) {
    const username = asMigration ? migrationOwner : bootstrap;
    const client = new PgClient({
      host, port, database, user: username, password: asMigration ? migrationPassword : password, ssl: false,
      connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: "t259-diagnostic",
    });
    try {
      await client.connect();
      const { rows: [identity] } = await client.query(`
        SELECT current_setting('server_version_num')::int version, ${asMigration ? "NULL" : "current_setting('data_directory')"} dir,
          current_database() db, session_user AS username, current_user AS active,
          host(inet_server_addr()) address, inet_server_port() port,
          current_setting('server_encoding') encoding, datcollate, datctype,
          (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) superuser
        FROM pg_database WHERE datname=current_database()`);
      if (!asMigration) assert(samePath(await realpath(identity.dir), data), "Unexpected SQL data directory");
      assert.deepEqual({ ...identity, dir: asMigration ? null : data }, {
        version, dir: asMigration ? null : data, db: database, username, active: username, address: host, port,
        encoding: "UTF8", datcollate: "C", datctype: "C", superuser: !asMigration,
      }, "Unexpected SQL target identity");
      return await fn(client);
    } finally {
      await client.end();
    }
  }
  const readSnapshot = () => withConnection(db, async client => {
    await client.query("BEGIN READ ONLY");
    try { return await snapshot(client); }
    finally { assert.equal((await client.query("ROLLBACK")).command, "ROLLBACK"); }
  });
  const runMigration = (mode: "dry-run" | "apply") => {
    const { targetHash } = inspectMigrationTarget(target);
    return runPostgresMigrationsV2({
      version: 3, mode, target, expectedTargetHash: targetHash,
      expectedApprovalHash: postgresMigrationApprovalHashV2(3, targetHash, mode),
    });
  };

  try {
    await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    try {
      const { stdout } = await exec(join(bin, "initdb.exe"),
        ["-D", data, "-U", bootstrap, "--pwfile=" + passwordFile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"],
        { env: childEnv, windowsHide: true, timeout: 120000 });
      await writeFile(join(root, "initdb.log"), stdout);
    } finally {
      await unlink(passwordFile);
    }
    assert(samePath(await realpath(data), data), "Unexpected initialized data directory");
    assert.equal(await loopbackStatus(port), "ECONNREFUSED", "Port no longer available");

    phase = "start";
    // pg_ctl starts the Windows postmaster with a restricted token.
    const options = `-h ${host} -p ${port} -c log_statement=all -c log_line_prefix=%p[%a] -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0`;
    const startOutput = await open(join(root, "start.log"), "wx");
    startAttempted = true;
    let launcherPid: number | undefined;
    try {
      // The postmaster may inherit pg_ctl's Windows handles. Redirect to a file
      // so waiting for launcher exit cannot hang on an inherited output pipe.
      const start = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", serverLog, "-o", options, "-w", "-t", "45", "start"], {
        env: childEnv, windowsHide: true, timeout: 55000, stdio: ["ignore", startOutput.fd, startOutput.fd],
      });
      launcherPid = start.pid;
      const exited = new Promise<void>((resolve, reject) => {
        start.once("error", reject);
        start.once("exit", (code) => code === 0 ? resolve() : reject(new Error("pg_ctl start failed")));
      });
      const outcomes = await Promise.allSettled([
        exited,
        writeEvidence("start-attempt.json", { launcherPid, data, port, startedAt: new Date().toISOString() }),
      ]);
      for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    } finally {
      await startOutput.close();
    }
    pid = await readPostmasterPid();
    assert(pid, "Missing postmaster identity");
    await writeEvidence("spawn.json", { launcherPid, pid, data, port, executable: postgres, observedAt: new Date().toISOString() });
    const startup = await osState(pid);
    assert.equal(startup.pidPresent, true, "Owned process missing");
    assert(startup.ownedPids.includes(pid), "OS executable or command line does not match the owned postmaster");
    assert.deepEqual(startup.listeners, [{ address: host, pid }], "Unexpected listener owner");
    await writeEvidence("listener.json", startup);

    phase = "bootstrap and explicit migration privileges";
    await withConnection("postgres", client => client.query("CREATE DATABASE dream_test_t259 TEMPLATE template0"));
    await withConnection(db, async client => {
      await client.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
      await client.query("INSERT INTO auth.users VALUES ($1),($2)", authIds);
      await client.query("SET log_statement='none'; SET log_min_error_statement='panic'");
      await client.query("CREATE ROLE t259_migration LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
      await client.query("ALTER ROLE t259_migration PASSWORD '" + migrationPassword + "'");
      await client.query("GRANT CONNECT, CREATE ON DATABASE dream_test_t259 TO t259_migration");
      await client.query("GRANT USAGE ON SCHEMA auth TO t259_migration");
      await client.query("GRANT REFERENCES ON auth.users TO t259_migration");
    });
    const before = await readSnapshot();
    assert.deepEqual(before, { history_exists: false, schemas: [], roles: [], auth_ids: authIds, relations: 0, functions: 0, history: [] });
    const { rows: [grants] } = await withConnection(db, client => client.query(
      "SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolinherit, r.rolreplication, " +
      "has_database_privilege(current_database(),'CREATE') AS db_create, has_schema_privilege('auth','USAGE') AS auth_usage, " +
      "has_table_privilege('auth.users','REFERENCES') AS auth_references, has_table_privilege('auth.users','SELECT') AS auth_select " +
      "FROM pg_roles r WHERE rolname=session_user"), true);
    await writeEvidence("sql-target.json", { version, data, host, port, database: db, bootstrap, migrationOwner, encoding: "UTF8", collation: "C", grants });
    assert.deepEqual(grants, { rolsuper: false, rolcreaterole: true, rolcreatedb: false, rolbypassrls: false, rolinherit: false,
      rolreplication: false, db_create: true, auth_usage: true, auth_references: true, auth_select: false });
    cases.push({ phase, grants, state: before });

    phase = "migration dry-run";
    const dryRun = await runMigration("dry-run");
    assert.equal(dryRun.fromVersion, null);
    assert.equal(dryRun.applied, 0);
    assert.equal(dryRun.pending, 3);
    assert.deepEqual(await readSnapshot(), before);
    cases.push({ phase, result: dryRun });

    phase = "non-superuser migration apply";
    let fresh: Awaited<ReturnType<typeof runMigration>>;
    try {
      fresh = await runMigration("apply");
    } catch (error) {
      const afterFailure = await readSnapshot();
      await writeEvidence("apply-failure-state.json", { before, afterFailure, restored: JSON.stringify(before) === JSON.stringify(afterFailure) });
      throw error;
    }
    assert.equal(fresh.fromVersion, null);
    assert.equal(fresh.applied, 3);
    assert.equal(fresh.pending, 0);
    const migrated = await readSnapshot();
    assert.deepEqual(migrated.auth_ids, before.auth_ids);
    assert.deepEqual(migrated.schemas, ["dream", "dream_migrations"]);
    assert.deepEqual(migrated.roles, ["dream_api", "dream_worker"]);
    assert.deepEqual(migrated.history.map(({ ordinal, id, checksum }) => ({ ordinal, id, checksum })), expectedHistory);

    phase = "migration-owned role edges";
    const readEdges = () => withConnection(db, async client => (await client.query(
      "SELECT child.rolname AS member, parent.rolname AS role, grantor.rolname AS grantor, m.admin_option, m.inherit_option, m.set_option " +
      "FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid " +
      "JOIN pg_roles grantor ON grantor.oid=m.grantor " +
      "WHERE parent.rolname IN ('dream_api','dream_worker','dream_api_login','dream_worker_login') " +
      "OR child.rolname IN ('dream_api','dream_worker','dream_api_login','dream_worker_login') ORDER BY 1,2,3")).rows);
    const edges = await readEdges();
    await writeEvidence("migration.json", { fresh, migrated, edges });
    const rootEdge = (role: string) => ({ member: migrationOwner, role, grantor: bootstrap, admin_option: true, inherit_option: false, set_option: false });
    assert.deepEqual(edges, [rootEdge("dream_api"), rootEdge("dream_worker")], "Unexpected automatic admin edges");
    cases.push({ phase, fresh, migrated, edges });

    phase = "API login alone is rejected";
    await withConnection(db, async client => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL search_path=pg_catalog");
        await client.query("CREATE ROLE dream_api_login LOGIN PASSWORD NULL NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION");
        await client.query("GRANT dream_api TO dream_api_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
        await assert.rejects(inspectPostgresMigrationStateV2(client, { version: 3, database: db, username: migrationOwner, port }), { code: "MIGRATION_STATE" });
      } finally {
        assert.equal((await client.query("ROLLBACK")).command, "ROLLBACK");
      }
    }, true);
    assert.deepEqual(await readSnapshot(), migrated);
    assert.deepEqual(await readEdges(), edges);
    cases.push({ phase, code: "MIGRATION_STATE", rolledBack: true });

    phase = "existing template and restricted login pair";
    await withConnection(db, client => client.query(postgresProvisionTemplate()), true);
    const loginEdge = (member: string, role: string) => ({ member, role, grantor: migrationOwner, admin_option: false, inherit_option: false, set_option: true });
    const provisioned = await readEdges();
    await writeEvidence("role-pair.json", { provisioned });
    assert.deepEqual(provisioned, [
      loginEdge(apiLogin, "dream_api"), loginEdge("dream_worker_login", "dream_worker"),
      rootEdge("dream_api"), rootEdge(apiLogin), rootEdge("dream_worker"), rootEdge("dream_worker_login"),
    ]);
    const repeated = await runMigration("apply");
    assert.equal(repeated.fromVersion, 3);
    assert.equal(repeated.applied, 0);
    assert.equal(repeated.pending, 0);
    assert.deepEqual(await readSnapshot(), { ...migrated, roles: ["dream_api", "dream_api_login", "dream_worker", "dream_worker_login"] });
    cases.push({ phase, provisioned, repeated });

    phase = "restricted login credential and GET checks";
    await withConnection(db, async client => {
      await client.query("SET log_statement='none'; SET log_min_error_statement='panic'");
      await client.query("ALTER ROLE dream_api_login PASSWORD '" + apiPassword + "'");
    });
    const runtimeDsn = dsn(apiLogin, apiPassword);
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    const log = await open(join(root, "read-tests.log"), "wx");
    let testExit: number | null;
    try {
      const child = spawn(process.execPath, [join(repo, "node_modules", "vitest", "vitest.mjs"), "run",
        "tests/postgres/t259-pg17-read-role.test.ts"], {
        cwd: repo, env: { ...childEnv, T259_API_DSN: runtimeDsn, T259_API_PORT: String(port) },
        windowsHide: true, timeout: 90000, stdio: ["ignore", log.fd, log.fd],
      });
      testExit = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
    } finally {
      await log.close();
    }
    await writeEvidence("read-test-exit.json", { exitCode: testExit });
    assert.equal(testExit, 0, "Restricted login GET and management checks failed");
    assert.deepEqual(await readEdges(), provisioned, "Read test changed role edges");
    assert.deepEqual((await readSnapshot()).history, migrated.history, "Read test changed migration history");
    cases.push({ phase, testExit });
    await writeEvidence("result.json", { cases });
    phase = "complete";
  } catch (error) {
    const failure = error as { name?: string; code?: string; message?: string };
    const message = failure.name === "AssertionError" ? failure.message?.split("\n")[0] : undefined;
    await writeEvidence("failure.json", { phase, name: failure.name, code: failure.code,
      ...(message ? { assertion: message } : {}), cases });
    process.exitCode = 1;
  } finally {
    try {
      if (startAttempted) {
        // A failed or timed-out pg_ctl command can leave a postmaster behind.
        // If it has not finished publishing its PID file, do not target a PID
        // based on the port alone.
        const deadline = Date.now() + 15000;
        let candidate = await readPostmasterPid();
        while (!candidate && !pid && Date.now() < deadline) {
          await delay(200);
          candidate = await readPostmasterPid();
        }
        if (candidate) {
          assert(pid === undefined || candidate === pid, "Postmaster PID changed");
          pid = candidate;
          const ownership = await osState(pid);
          assert(ownership.ownedPids.includes(pid), "Cannot verify the executable and data path before stop");
          const { stdout } = await exec(join(bin, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"],
            { env: childEnv, windowsHide: true, timeout: 35000 });
          await writeFile(join(root, "stop.log"), stdout);
          stopStatus = "pg_ctl fast";
        }
      }
      const cleanup = { pid, stopStatus, pidFileAbsent: (await fileIfPresent(pidFile)) === null,
        loopback: await loopbackStatus(port), passwordFileAbsent: (await fileIfPresent(passwordFile)) === null,
        os: await osState(pid) };
      await writeEvidence("cleanup.json", cleanup);
      assert(cleanup.pidFileAbsent && cleanup.passwordFileAbsent && cleanup.loopback === "ECONNREFUSED", "Owned files or listener remained");
      assert(!cleanup.os.pidPresent && cleanup.os.ownedPids.length === 0 && cleanup.os.listeners.length === 0, "Owned process or listener remained");
    } catch {
      process.exitCode = 1;
      await writeEvidence("cleanup-failure.json", { pid, data, port, stopStatus });
      console.error("T259 shutdown verification failed. Preserve evidence and inspect only the recorded owned instance.");
    }
  }
  console.log("T259 final phase:", phase);
}

main().catch(() => {
  console.error("T259 preflight or evidence writing failed.");
  process.exitCode = 1;
});
