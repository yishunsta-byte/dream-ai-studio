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
const db = "dream_test_t258";
const username = "t258_bootstrap";
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
      $file = Join-Path $env:T258_BIN $name
      $sig = Get-AuthenticodeSignature -LiteralPath $file
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'PG signature rejected' }
      [pscustomobject]@{ name=$name; valid=$true; signer='EnterpriseDB Corporation'; sha256=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant() }
    })
    ConvertTo-Json -InputObject $results -Compress`, { T258_BIN: bin }));
  for (const name of executableNames) {
    const tool = join(bin, name);
    assert(samePath(await realpath(tool), tool), "Linked PostgreSQL executable");
    const { stdout } = await exec(tool, ["--version"], { env: childEnv, windowsHide: true, timeout: 10000 });
    assert.match(stdout.trim(), /\(PostgreSQL\) 17\.12$/, "Unexpected PostgreSQL tool version");
  }

  const scratch = fileURLToPath(new URL("../../tmp", import.meta.url));
  assert(samePath(await realpath(scratch), scratch), "Expected an unlinked workspace tmp directory");
  const root = join(scratch, "t258-pg17-" + randomUUID());
  await mkdir(root);
  const data = join(root, "data");
  const pidFile = join(data, "postmaster.pid");
  const serverLog = join(root, "postgres.log");
  const port = await availablePort();
  const password = randomBytes(32).toString("hex");
  const passwordFile = join(root, "init-password.txt");
  const writeEvidence = (name: string, value: unknown) =>
    writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await writeEvidence("preflight.json", { root, bin, signatures, postgres: "17.12", data, host, port, db, username, expectedHistory });
  console.log("T258 evidence:", root);

  const postgres = join(bin, "postgres.exe");
  const cases: Record<string, unknown>[] = [];
  let phase = "initdb";
  let startAttempted = false;
  let pid: number | undefined;
  let stopStatus: string | undefined;
  const target = { connectionString: `postgresql://${username}:${password}@${host}:${port}/${db}`, profile: "synthetic" } as const;
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
      $directory = [regex]::Escape($env:T258_DATA)
      $dataArgument = '(?:^|\s)-D\s+(?:"' + $directory + '"|' + $directory + ')(?:\s|$)'
      $owned = @(Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'" | Where-Object {
        $_.ExecutablePath -ieq $env:T258_POSTGRES -and $_.CommandLine -and
        $_.CommandLine.Replace('/', '\') -match $dataArgument
      })
      $listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq ([int]$env:T258_PORT))
      [pscustomobject]@{
        pidPresent=($env:T258_PID -ne '0' -and @(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:T258_PID)).Count -gt 0)
        ownedPids=@($owned | ForEach-Object { [int]$_.ProcessId })
        listeners=@($listeners | ForEach-Object { @{address=$_.LocalAddress; pid=[int]$_.OwningProcess} })
      } | ConvertTo-Json -Depth 4 -Compress`,
    { T258_POSTGRES: postgres, T258_DATA: data, T258_PORT: String(port), T258_PID: String(pid ?? 0) }));
  }
  async function withConnection<T>(database: string, fn: (client: Client) => Promise<T>) {
    const client = new PgClient({
      host, port, database, user: username, password, ssl: false,
      connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: "t258-diagnostic",
    });
    try {
      await client.connect();
      const { rows: [identity] } = await client.query(`
        SELECT current_setting('server_version_num')::int version, current_setting('data_directory') dir,
          current_database() db, session_user AS username, current_user AS active,
          host(inet_server_addr()) address, inet_server_port() port,
          current_setting('server_encoding') encoding, datcollate, datctype,
          (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) superuser
        FROM pg_database WHERE datname=current_database()`);
      assert(samePath(await realpath(identity.dir), data), "Unexpected SQL data directory");
      assert.deepEqual({ ...identity, dir: data }, {
        version, dir: data, db: database, username, active: username, address: host, port,
        encoding: "UTF8", datcollate: "C", datctype: "C", superuser: true,
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
  const runMigration = (mode: "dry-run" | "apply", schemaVersion: 3 | 4 = 3) => {
    const { targetHash } = inspectMigrationTarget(target);
    return runPostgresMigrationsV2({
      version: schemaVersion, mode, target, expectedTargetHash: targetHash,
      expectedApprovalHash: postgresMigrationApprovalHashV2(schemaVersion, targetHash, mode),
    });
  };

  try {
    await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    try {
      const { stdout } = await exec(join(bin, "initdb.exe"),
        ["-D", data, "-U", username, "--pwfile=" + passwordFile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"],
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

    phase = "fixture";
    await withConnection("postgres", client => client.query("CREATE DATABASE dream_test_t258 TEMPLATE template0"));
    await withConnection(db, async client => {
      await client.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
      await client.query("INSERT INTO auth.users VALUES ($1),($2)", authIds);
    });
    await writeEvidence("sql-target.json", { version, data, host, port, database: db, username, encoding: "UTF8", collation: "C", superuser: true });
    const before = await readSnapshot();
    assert.deepEqual(before, { history_exists: false, schemas: [], roles: [], auth_ids: authIds, relations: 0, functions: 0, history: [] });

    phase = "dry-run";
    const dryRun = await runMigration("dry-run");
    assert.equal(dryRun.fromVersion, null);
    assert.equal(dryRun.applied, 0);
    assert.equal(dryRun.pending, 3);
    assert.deepEqual(await readSnapshot(), before, "Dry-run changed initial state");
    cases.push({ phase, result: dryRun, state: before });

    phase = "schema 4 fresh remains rejected at prefix";
    const logOffset = (await readFile(serverLog)).length;
    await assert.rejects(runMigration("apply", 4), { code: "MIGRATION_STATE" });
    const attemptLog = (await readFile(serverLog)).subarray(logOffset).toString("utf8");
    const journalInserts = attemptLog.match(/\[dream-backend\].*execute .*: INSERT INTO dream_migrations.history/g)?.length ?? 0;
    assert.equal(journalInserts, 3, "The schema 4 path passed or did not reach the schema 3 prefix");
    assert(!attemptLog.includes("CREATE TABLE dream.storage_policy_versions"), "Schema 4 SQL was executed");
    assert.deepEqual(await readSnapshot(), before, "Schema 4 rejection left changes");
    cases.push({ phase, code: "MIGRATION_STATE", journalInserts, schema4SqlStarted: false, state: before });

    phase = "fresh schema 3 apply";
    const first = await runMigration("apply");
    assert.equal(first.fromVersion, null);
    assert.equal(first.applied, 3);
    assert.equal(first.pending, 0);
    const complete = await readSnapshot();
    assert.deepEqual(complete.schemas, ["dream", "dream_migrations"]);
    assert.deepEqual(complete.roles, ["dream_api", "dream_worker"]);
    assert.deepEqual(complete.auth_ids, authIds);
    assert.deepEqual(complete.history.map(({ ordinal, id, checksum }) => ({ ordinal, id, checksum })), expectedHistory);
    assert(complete.history.every(row => row.applied_at && row.row_version), "Journal stamp or row version missing");
    cases.push({ phase, result: first, state: complete });

    phase = "schema 3 reapply";
    const repeated = await runMigration("apply");
    assert.equal(repeated.fromVersion, 3);
    assert.equal(repeated.applied, 0);
    assert.equal(repeated.pending, 0);
    assert.deepEqual(await readSnapshot(), complete, "Reapply changed the committed history or catalog counts");
    cases.push({ phase, result: repeated, state: complete });

    phase = "schema 4 upgrade remains rejected";
    await assert.rejects(runMigration("apply", 4), { code: "MIGRATION_STATE" });
    assert.deepEqual(await readSnapshot(), complete, "Rejected upgrade changed schema 3");
    cases.push({ phase, code: "MIGRATION_STATE", state: complete });

    const inspect = (client: Client) => inspectPostgresMigrationStateV2(client, { version: 3, database: db, username, port });
    const drifts = [
      ["column NOT NULL", "ALTER TABLE dream.projects ALTER COLUMN title DROP NOT NULL", "MIGRATION_STATE"],
      ["check constraint", "ALTER TABLE dream.projects DROP CONSTRAINT projects_aspect_check", "MIGRATION_STATE"],
      ["RLS policy", "ALTER POLICY owner_access ON dream.projects USING (false)", "MIGRATION_STATE"],
      ["table ACL", "GRANT TRUNCATE ON dream.projects TO dream_api", "MIGRATION_STATE"],
      ["role flags", "ALTER ROLE dream_api INHERIT", "MIGRATION_STATE"],
      ["journal checksum", "UPDATE dream_migrations.history SET checksum=repeat('0',64) WHERE ordinal=2", "MIGRATION_HISTORY"],
    ] as const;
    for (const [label, sql, code] of drifts) {
      phase = label;
      await withConnection(db, async client => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL search_path=pg_catalog");
          assert.deepEqual(await inspect(client), { state: "complete", version: 3, pending: 0 });
          const result = await client.query(sql);
          if (label === "journal checksum") assert.equal(result.rowCount, 1);
          await assert.rejects(inspect(client), { code });
        } finally {
          assert.equal((await client.query("ROLLBACK")).command, "ROLLBACK");
        }
      });
      const restored = await runMigration("dry-run");
      assert.equal(restored.fromVersion, 3);
      assert.equal(restored.applied, 0);
      assert.equal(restored.pending, 0);
      assert.deepEqual(await readSnapshot(), complete, "Rollback did not restore the committed state");
      cases.push({ phase, code, rolledBack: true, restored });
    }
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
      console.error("T258 shutdown verification failed. Preserve evidence and inspect only the recorded owned instance.");
    }
  }
  console.log("T258 final phase:", phase);
}

main().catch(() => {
  console.error("T258 preflight or evidence writing failed.");
  process.exitCode = 1;
});
