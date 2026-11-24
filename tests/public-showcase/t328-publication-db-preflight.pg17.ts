import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, appendFile, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { openVerifiedPublicationDatabase, PublicationDatabaseUnavailable, verifyPublicationDatabase } from "../../lib/public-showcase/publication-db-preflight";
import { runT332VerifiedAdapters } from "./t332-publication-verified-adapters.pg17";
import { runT336PublicationIntegration } from "./t336-publication-db-cover-integration.pg17";
import { runT338PublicationInstallation } from "./t338-publication-installation.pg17";
import { runT339LimitedPublicationInstaller } from "./t339-publication-limited-installer.pg17";
import { runT341DelegatedPublicationInstaller } from "./t341-publication-delegated-installer.pg17";
import { runT342PublicationSealedRuntime } from "./t342-publication-sealed-runtime.pg17";

// No target arguments or inherited DB configuration. All DDL is confined to the owned loopback cluster.
const installOnly = process.argv.length === 3 && process.argv[2] === "--publication-installation";
const limitedInstaller = process.argv.length === 3 && process.argv[2] === "--limited-publication-installer";
const playbackInstaller = process.argv.length === 3 && process.argv[2] === "--playback-publication-installer";
const delegatedInstaller = process.argv.length === 3 && process.argv[2] === "--delegated-publication-installer";
const sealedRuntime = process.argv.length === 3 && process.argv[2] === "--sealed-publication-runtime";
assert(process.platform === "win32" && (process.argv.length === 2 || installOnly || limitedInstaller || delegatedInstaller || playbackInstaller || sealedRuntime));
const exec = promisify(execFile);
const host = "127.0.0.1";
const bootstrap = "t293_bootstrap";
const database = `t253_${randomBytes(16).toString("hex")}`;
const secret = () => randomBytes(24).toString("hex");
const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP)$/i.test(key))), NODE_ENV: "test" };
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const openssl = join(process.env.ProgramFiles!, "Git", "usr", "bin", "openssl.exe");
const powershell = join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const run = (path: string, args: string[], extra: Record<string, string> = {}) => exec(path, args, {
  env: { ...env, ...extra }, encoding: "utf8", windowsHide: true, timeout: 90_000,
});
const samePath = (a: string, b: string) => a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase();
assert(samePath(await realpath(bin), bin));
for (const name of ["postgres.exe", "initdb.exe", "pg_ctl.exe"]) {
  const tool = join(bin, name);
  assert(samePath(await realpath(tool), tool));
  await run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$s=Get-AuthenticodeSignature -LiteralPath $env:T328_TOOL; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { exit 1 }"], { T328_TOOL: tool });
  assert.match((await run(tool, ["--version"])).stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const socket = createServer();
await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, host, resolve); });
const address = socket.address();
assert(address && typeof address !== "string");
const { port } = address;
await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));

const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t328-"));
const data = join(root, "cluster");
const pidfile = join(data, "postmaster.pid");
const clientPassword = secret();
const sql = (file: string) => readFile(new URL(file, import.meta.url), "utf8");
const passwordFile = join(root, "bootstrap-password");
const url = (name: string, password: string, db = database, hostname = host) => `postgresql://${name}:${password}@${hostname}:${port}/${db}`;
let admin: Client | undefined;

async function verifyOwnedListener() {
  const lines = (await readFile(pidfile, "utf8")).split(/\r?\n/);
  assert(samePath(lines[1], data) && Number(lines[3]) === port);
  const pid = Number(lines[0]);
  assert(Number.isSafeInteger(pid) && pid > 0);
  await run(powershell, ["-NoProfile", "-NonInteractive", "-Command", `
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T328_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T328_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T328_EXE -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T328_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T328_PID -or $s[0].LocalAddress -ne '127.0.0.1') { exit 1 }`],
  { T328_PID: String(pid), T328_PORT: String(port), T328_EXE: join(bin, "postgres.exe"), T328_DATA: data });
}

async function certificate(name: string) {
  const key = join(root, `${name}.key`);
  const cert = join(root, `${name}.crt`);
  const config = join(root, `${name}.cnf`);
  await writeFile(config, `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=${name}\n[v3]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n`);
  await run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", config, "-keyout", key, "-out", cert]);
  return { key, cert, pem: await readFile(cert, "utf8") };
}

async function startCluster() {
  const log = await open(join(root, "launcher.log"), "a");
  try {
    const child = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-w", "-t", "30", "start"],
      { env, windowsHide: true, timeout: 40_000, stdio: ["ignore", log.fd, log.fd] });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Owned PG17 startup failed")));
    });
  } finally { await log.close(); }
}

scenarios: try {
  const tls = await certificate("t328-server");
  const wrongCa = await certificate("t328-other");
  await writeFile(passwordFile, clientPassword, { flag: "wx" });
  try {
    await run(join(bin, "initdb.exe"), ["-D", data, "-U", bootstrap, `--pwfile=${passwordFile}`,
      "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
  } finally { await unlink(passwordFile); }
  await appendFile(join(data, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${port}\nssl=on\nssl_cert_file='${tls.cert.replaceAll("\\", "/")}'\nssl_key_file='${tls.key.replaceAll("\\", "/")}'\n`);
  await writeFile(join(data, "pg_hba.conf"), "hostssl all all 127.0.0.1/32 scram-sha-256\n");
  await startCluster();
  await verifyOwnedListener();
  const openBootstrap = async (db: string) => {
    const client = new Client({ connectionString: url(bootstrap, clientPassword, db), ssl: { ca: tls.pem, rejectUnauthorized: true }, connectionTimeoutMillis: 5000 });
    await client.connect();
    return client;
  };
  admin = await openBootstrap("postgres");
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  admin = await openBootstrap(database);
  if (installOnly) {
    await runT338PublicationInstallation(admin, { host, port, database, ca: tls.pem, installer: bootstrap,
      url, openInstaller: () => openBootstrap(database) });
    break scenarios;
  }
  if (limitedInstaller) {
    await runT339LimitedPublicationInstaller(admin, { host, port, database, ca: tls.pem, installer: bootstrap,
      url, openInstaller: () => openBootstrap(database) });
    break scenarios;
  }
  if (delegatedInstaller || playbackInstaller) {
    await runT341DelegatedPublicationInstaller(admin, { host, port, database, ca: tls.pem, bootstrap, url, openBootstrap }, undefined, playbackInstaller);
    break scenarios;
  }
  if (sealedRuntime) {
    await runT342PublicationSealedRuntime(admin, { host, port, database, ca: tls.pem, bootstrap, url, openBootstrap });
    break scenarios;
  }
  await admin.query(await sql("../fixtures/postgres/t253-showcase-publication.sql"));
  await admin.query(await sql("./t293-admin-publication.sql"));
  await admin.query(await sql("./t295-publication-rights.sql"));
  await admin.query("REVOKE EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) FROM t293_app");
  await admin.query("GRANT EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) TO t295_writer");
  await admin.query("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC");
  const definitions = [
    ["admin", "t293_actor_a", "t293_app"], ["list", "t328_list", "t295_list"], ["cover", "t328_cover", "t295_file"],
  ] as const;
  const logins = {} as Record<typeof definitions[number][0], { name: string; connectionString: string }>;
  for (const [kind, name, role] of definitions) {
    const password = secret();
    await admin.query(`CREATE ROLE ${name} LOGIN INHERIT PASSWORD '${password}'; GRANT ${role} TO ${name};
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ${name}`);
    logins[kind] = { name, connectionString: url(name, password) };
  }
  const systemIdentifier: string = (await admin.query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0].id;
  const target = { host, port, database, systemIdentifier };
  const options = { target, logins, ca: tls.pem };
  const inactive = { mode: "inactive" };
  let passed = 0;
  async function noSessions(control: Client, label: string) {
    for (let tries = 0; ; tries++) {
      const count = (await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='dream-backend'")).rows[0].n;
      if (count === 0) break;
      assert(tries < 20, `${label}: preflight session left open`);
      await delay(50);
    }
  }
  async function check(input: Parameters<typeof verifyPublicationDatabase>[0], expected: object, label: string) {
    assert.deepEqual(await verifyPublicationDatabase(input), expected, label);
    await noSessions(admin!, label);
    passed++;
  }
  const verified = { mode: "verified", targetId: JSON.stringify([host, port, database, systemIdentifier]) };
  await check(options, verified, "separate writer/list/cover over trusted TLS");
  await check(undefined, inactive, "missing config");
  await check({ ...options, logins: { ...logins, cover: undefined! } }, inactive, "missing login");
  await check({ ...options, logins: { ...logins, cover: logins.list } }, inactive, "duplicate login");
  await check({ ...options, logins: { ...logins, cover: { ...logins.cover, connectionString: logins.cover.connectionString.replace(database, "postgres") } } }, inactive, "different database DSN");
  await check({ ...options, target: { ...target, systemIdentifier: "1" } }, inactive, "wrong pinned cluster");
  await check({ ...options, ca: wrongCa.pem }, inactive, "untrusted certificate");
  const withLocalhost = ({ name, connectionString }: typeof logins.admin) => ({ name, connectionString: connectionString.replace("@127.0.0.1:", "@localhost:") });
  await check({ ...options, target: { ...target, host: "localhost" }, logins: {
    admin: withLocalhost(logins.admin), list: withLocalhost(logins.list), cover: withLocalhost(logins.cover),
  } }, inactive, "trusted certificate for a different host");
  await check({ ...options, logins: { ...logins, cover: { ...logins.cover, connectionString: url(logins.cover.name, secret()) } } }, inactive, "one login authentication failure");
  await check({ ...options, logins: { ...logins, list: logins.cover, cover: logins.list } }, inactive, "swapped reader roles");

  const changes = [
    ["REVOKE EXECUTE ON FUNCTION t295.find_cover(text,bigint) FROM t295_file", "GRANT EXECUTE ON FUNCTION t295.find_cover(text,bigint) TO t295_file", "missing cover capability"],
    ["REVOKE USAGE ON SCHEMA t295 FROM t295_list", "GRANT USAGE ON SCHEMA t295 TO t295_list", "missing list schema use"],
    ["GRANT EXECUTE ON FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) TO t328_list", "REVOKE EXECUTE ON FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) FROM t328_list", "reader can write"],
    ["GRANT EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) TO t293_app", "REVOKE EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) FROM t293_app", "writer can bypass current contract"],
    ["REVOKE EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) FROM t295_writer", "GRANT EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) TO t295_writer", "internal writer permission is missing"],
    ["GRANT SELECT (sha) ON t253_showcase.slots TO t328_cover", "REVOKE SELECT (sha) ON t253_showcase.slots FROM t328_cover", "reader can access an underlying column"],
    ["GRANT t293_app TO t328_cover WITH INHERIT FALSE", "REVOKE t293_app FROM t328_cover", "reader has a separate role path"],
    ["GRANT t295_list TO t328_list WITH ADMIN TRUE", "REVOKE ADMIN OPTION FOR t295_list FROM t328_list", "reader may grant its role"],
    ["ALTER ROLE t328_list BYPASSRLS", "ALTER ROLE t328_list NOBYPASSRLS", "reader can bypass RLS"],
    ["ALTER ROLE t293_actor_a SET default_transaction_read_only = on", "ALTER ROLE t293_actor_a RESET default_transaction_read_only", "writer connection is read-only"],
    ["REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM t328_cover", "GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO t328_cover", "one cluster probe query fails"],
  ];
  for (const [change, restore, label] of changes) {
    await admin.query(change);
    await check(options, inactive, label);
    await admin.query(restore);
  }
  await check(options, verified, "recovered config with no leaked sessions");
  console.log(`T328 ${passed} PG17/TLS cases passed`);
  await runT332VerifiedAdapters(admin, options);
  await runT336PublicationIntegration(admin, options);

  // T330 checks the same database again when an adapter is about to send SQL.
  const openConnections = async (input: Parameters<typeof openVerifiedPublicationDatabase>[0] = options) => {
    const result = await openVerifiedPublicationDatabase(input);
    assert.equal(result.mode, "verified");
    assert.equal(result.active, true);
    assert.equal(result.targetId, verified.targetId);
    return result;
  };
  const assertUnavailable = (operation: Promise<unknown>) => assert.rejects(operation, PublicationDatabaseUnavailable);
  const unexpected = async () => assert.fail("Unverified session must never reach an adapter callback");
  async function assertClosed(connections: Awaited<ReturnType<typeof openConnections>>) {
    assert.equal(connections.active, false);
    await Promise.all([connections.withAdmin(unexpected), connections.withList(unexpected), connections.withCover(unexpected)]
      .map(assertUnavailable));
    await connections.close();
  }

  const live = await openConnections();
  try {
    const owner = "10000000-0000-4000-8000-0000000000a1";
    const slug = "t330-fixture";
    const sourceId = randomUUID();
    const manifest = { sourceId, sourceRevision: "1", sourceSha: "a".repeat(64), rightsRef: "fixture-rights", coverSha: "b".repeat(64),
      coverBytes: 42, display: { kind: "광고", title: slug, subtitle: "Synthetic", creator: "Fixture", genre: "Design",
        format: "WebP", description: "Synthetic work", width: 8, height: 6 } };
    await admin.query("INSERT INTO t253_showcase.publishers VALUES($1)", [owner]);
    await admin.query("INSERT INTO t293.works VALUES($1,$2,$3)", [owner, slug, { ownerId: owner, slug }]);
    await admin.query("INSERT INTO t253_showcase.source_images VALUES($1,$2,1,$3,true)", [owner, sourceId, manifest.sourceSha]);
    await admin.query("INSERT INTO t295.attestations VALUES($1,$2,$3,$4,'perpetual',NULL)", [owner, slug, manifest.rightsRef, manifest]);
    const command = (type: "prepare" | "complete" | "revoke", version: string, generation: string | null, commit = true) => live.withAdmin(async query => {
      await query("BEGIN");
      await query("SELECT set_config('t293.actor',$1,true)", [owner]);
      const result = await query("SELECT t295.apply($1,$2,$3,$4,$5,$6) AS outcome", [randomUUID(), type, slug, version, generation,
        type === "prepare" ? manifest.rightsRef : null]);
      if (commit) await query("COMMIT");
      return result.rows[0].outcome;
    });
    const visible = async (expected: boolean) => {
      const [list, file] = await Promise.all([
        live.withList(query => query<{ value: { rows: { slug: string; generation: string }[] } }>("SELECT t295.list_approved() AS value")),
        live.withCover(query => query("SELECT * FROM t295.find_cover($1,1)", [slug])),
      ]);
      assert.equal(list.rows[0].value.rows.some(row => row.slug === slug && row.generation === "1"), expected);
      assert.equal(file.rowCount, Number(expected));
      if (expected) assert.equal(file.rows[0].object_key, `${slug}/1/${manifest.coverSha}.webp`);
    };
    await assert.rejects(live.withList(query => query("SELECT t295.apply(NULL,NULL,NULL,NULL,NULL,NULL)")), { code: "42501" });
    await assert.rejects(live.withList(query => query("SELECT * FROM t295.find_cover($1,1)", [slug])), { code: "42501" });
    await assert.rejects(live.withCover(query => query("SELECT t295.list_approved()")), { code: "42501" });
    await assert.rejects(live.withAdmin(query => query("SELECT t295.list_approved()")), { code: "42501" });
    await visible(false);
    assert.deepEqual(await command("prepare", "0", null, false), { status: "prepared", version: "1", generation: "1" });
    await visible(false);
    assert.deepEqual(await command("prepare", "0", null), { status: "prepared", version: "1", generation: "1" });
    assert.deepEqual(await command("complete", "1", "1"), { status: "published", version: "2", generation: "1" });
    await visible(true);
    assert.deepEqual(await command("revoke", "2", "1"), { status: "revoked", version: "3", generation: "1" });
    await visible(false);
    const retained = await live.withList(async query => query);
    await assertUnavailable(retained("SELECT 1"));
    const processId = () => live.withList(async query => (await query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    assert.notEqual(await processId(), await processId());
  } finally { await live.close(); }
  await assertClosed(live);
  await noSessions(admin, "normal requests and shutdown");
  console.log("T330 verified publish/revoke, role separation, rollback on release and fresh sessions");

  assert.deepEqual(await openVerifiedPublicationDatabase({ ...options, ca: wrongCa.pem }), inactive);
  assert.deepEqual(await openVerifiedPublicationDatabase({ ...options, logins: { ...logins, cover: { ...logins.cover,
    connectionString: url(logins.cover.name, secret()) } } }), inactive);
  await noSessions(admin, "partial startup");

  const changedRole = await openConnections();
  const running = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const list = changedRole.withList(async query => {
    await query("SELECT t295.list_approved()");
    running.resolve();
    await finish.promise;
    await assertUnavailable(query("SELECT t295.list_approved()"));
  });
  try {
    await Promise.race([running.promise, list]);
    await admin.query("REVOKE t295_file FROM t328_cover");
    await assertUnavailable(changedRole.withCover(unexpected));
    assert.equal(changedRole.active, false);
    await assertUnavailable(changedRole.withAdmin(unexpected));
    finish.resolve();
    await list;
    await assertClosed(changedRole);
  } finally {
    finish.resolve();
    await list.catch(() => undefined);
    await changedRole.close();
    await admin.query("GRANT t295_file TO t328_cover");
  }
  const failedLogin = await openConnections();
  try {
    await admin.query("ALTER ROLE t328_list NOLOGIN");
    await assertUnavailable(failedLogin.withList(unexpected));
    await assertClosed(failedLogin);
  } finally {
    await failedLogin.close();
    await admin.query("ALTER ROLE t328_list LOGIN");
  }
  await noSessions(admin, "changed role and failed login");

  const disconnected = await openConnections();
  const connectedPid = Promise.withResolvers<number>();
  const resume = Promise.withResolvers<void>();
  const interrupted = disconnected.withCover(async query => {
    connectedPid.resolve((await query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await resume.promise;
    await assertUnavailable(query("SELECT 1"));
  });
  try {
    const pid = await Promise.race([connectedPid.promise, interrupted.then(() => assert.fail("Lease finished early"))]);
    assert.equal((await admin.query("SELECT pg_terminate_backend($1) AS stopped", [pid])).rows[0].stopped, true);
    for (let tries = 0; disconnected.active; tries++) {
      assert(tries < 40, "terminated lease did not deactivate the connection group");
      await delay(50);
    }
    resume.resolve();
    await interrupted;
    await assertClosed(disconnected);
  } finally {
    resume.resolve();
    await interrupted.catch(() => undefined);
    await disconnected.close();
  }
  await noSessions(admin, "terminated checked-out session");

  const readDatabaseOid = async () => (await admin!.query<{ oid: string }>(
    "SELECT oid::text FROM pg_database WHERE datname=$1", [database])).rows[0].oid;
  const originalOid = await readDatabaseOid();
  const approved = { ...options, approvedDatabaseOid: originalOid };
  const changedDatabase = await openConnections();
  const pinned: { method: "withAdmin" | "withList" | "withCover"; connections: Awaited<ReturnType<typeof openConnections>> }[] = [];
  try {
    for (const method of ["withAdmin", "withList", "withCover"] as const) {
      const connections = await openConnections(approved);
      pinned.push({ method, connections });
      const oid = await connections[method](async query => (await query<{ oid: string }>(
        "SELECT oid::text FROM pg_database WHERE datname=current_database()")).rows[0].oid);
      assert.equal(oid, originalOid);
    }
    await admin.end();
    admin = await openBootstrap("postgres");
    const replacement = `${database}_new`;
    await admin.query(`CREATE DATABASE ${replacement} TEMPLATE ${database}`);
    await admin.query(`ALTER DATABASE ${database} RENAME TO ${database}_old`);
    await admin.query(`ALTER DATABASE ${replacement} RENAME TO ${database}`);
    await assertUnavailable(changedDatabase.withList(unexpected));
    await assertClosed(changedDatabase);
    for (const { method, connections } of pinned) {
      await assertUnavailable(connections[method](unexpected));
      await assertClosed(connections);
    }
  } finally {
    await Promise.all([changedDatabase.close(), ...pinned.map(({ connections }) => connections.close())]);
  }
  await check(approved, inactive, "same-name replacement rejected by the original approved OID");
  for (const malformed of ["0", "01", "4294967296"]) {
    await check({ ...options, approvedDatabaseOid: malformed }, inactive, "invalid approved OID");
  }
  const replacementOid = await readDatabaseOid();
  assert.notEqual(replacementOid, originalOid);
  await check({ ...options, approvedDatabaseOid: replacementOid }, verified, "fresh group accepts the separately supplied replacement OID");
  const replacementConnections = await openConnections();
  await replacementConnections.close();
  await noSessions(admin, "database replaced under the original name");
  console.log("T330 partial startup, role/authentication drift, database replacement and cleanup passed");
  console.log("T343 approved OID pinned for writer/list/cover, same-name replacement rejected, new OID verified independently");
} finally {
  try { await admin?.end(); }
  finally {
    if (await access(pidfile).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    })) {
      await verifyOwnedListener();
      await run(join(bin, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
    }
    await assert.rejects(access(pidfile), { code: "ENOENT" });
    const connected = await new Promise<boolean>(resolve => {
      const connection = createConnection({ host, port });
      connection.once("connect", () => { connection.destroy(); resolve(true); });
      connection.once("error", () => resolve(false));
    });
    assert.equal(connected, false);
    const resolved = await realpath(root);
    assert(samePath(dirname(resolved), temp) && basename(resolved).startsWith("dream-t328-"));
    await rm(resolved, { recursive: true });
    await assert.rejects(access(root), { code: "ENOENT" });
    console.log("Owned PG17 listener and temporary cluster removed");
  }
}
