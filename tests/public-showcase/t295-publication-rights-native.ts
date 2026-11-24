import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Client } from "pg";
import sharp from "sharp";
import { readApprovedSnapshot } from "../../lib/public-showcase/showcase-source";

assert.equal(process.platform, "win32");
assert.equal(process.argv.length, 2, "Only the fixed loopback PG17 fixture is supported");
const exec = promisify(execFile);
const keep = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "TEMP", "TMP"]);
const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key.toUpperCase()))), NODE_ENV: "test" };
for (const key of Object.keys(process.env)) {
  if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$|NEXT_PUBLIC_SUPABASE)/i.test(key)) delete process.env[key];
}
const { Client: PgClient } = (await import("pg")).default;
assert(process.env.SystemRoot);
const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const samePath = (first: string, second: string) => first.replaceAll("/", "\\").toLowerCase() === second.replaceAll("/", "\\").toLowerCase();
assert(samePath(await realpath(bin), bin));
function ps(script: string, values: Record<string, string>) {
  return exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script],
    { env: { ...env, ...values }, windowsHide: true, timeout: 25_000 });
}
const tools = (tool: string, args: string[], timeout = 30_000) => exec(join(bin, tool + ".exe"), args, { env, windowsHide: true, timeout });
for (const tool of ["postgres", "initdb", "pg_ctl"]) {
  const path = join(bin, tool + ".exe");
  assert(samePath(await realpath(path), path));
  await ps("$sig=Get-AuthenticodeSignature -LiteralPath $env:T295_TOOL; if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected binary signature' }", { T295_TOOL: path });
  assert.match((await tools(tool, ["--version"])).stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const sqlFiles = ["../fixtures/postgres/t253-showcase-publication.sql", "t293-admin-publication.sql", "t295-publication-rights.sql"];
const [t253, t293, candidate] = await Promise.all(sqlFiles.map(async file =>
  (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n")));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
assert.equal(hash(t253), "7b9a252ec3093df0c7e7b900555d081baa1e5a5a8a20a2f18ce27c7c03f2b46c");
assert.equal(hash(t293), "4c855c28d42b42f74283ed452e23f801bb23ac377723f2987a1a0ab81002f7ea");
const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#485c61" } }).webp().toBuffer();
const sha = hash(image);
const ownerA = "10000000-0000-4000-8000-0000000000a1";
const ownerB = "10000000-0000-4000-8000-0000000000b1";
const db = "t253_" + randomUUID().replaceAll("-", "");
const bootstrap = "t293_bootstrap";
const password = randomBytes(32).toString("hex");
const listener = createServer();
await new Promise<void>((ok, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", ok); });
const address = listener.address();
assert(address && typeof address !== "string");
const { port } = address;
await new Promise<void>((ok, fail) => listener.close(error => error ? fail(error) : ok()));
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t295-"));
const data = join(root, "cluster");
const passfile = join(root, "bootstrap-password");
const clients = new Set<Client>();
let startAttempted = false;

async function start() {
  const log = await open(join(root, "startup.log"), "wx");
  try {
    const launcher = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-o",
      `-h 127.0.0.1 -p ${port} -c log_min_error_statement=panic`, "-w", "-t", "30", "start"],
    { env, windowsHide: true, stdio: ["ignore", log.fd, log.fd], timeout: 40_000 });
    await new Promise<void>((ok, fail) => {
      launcher.once("error", fail);
      launcher.once("exit", code => code === 0 ? ok() : fail(new Error("Owned PG17 start failed")));
    });
  } finally { await log.close(); }
}

async function checkListener() {
  const [pid, dir, , actualPort] = (await readFile(join(data, "postmaster.pid"), "utf8")).split(/\r?\n/);
  assert(samePath(dir, data) && Number(actualPort) === port && /^[1-9][0-9]*$/.test(pid));
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T295_PID)
  $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T295_PORT) -ErrorAction SilentlyContinue)
  if (!$p -or $p.ExecutablePath -ine $env:T295_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T295_DATA) -or
      $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T295_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T295_PID: pid, T295_PORT: String(port), T295_PG: join(bin, "postgres.exe"), T295_DATA: data });
}

async function connect(user = bootstrap, secret = password, database = db) {
  const client = new PgClient({ host: "127.0.0.1", port, database, user, password: secret, ssl: false,
    connectionTimeoutMillis: 5000, statement_timeout: 12_000 });
  await client.connect();
  clients.add(client);
  assert.deepEqual((await client.query(`SELECT current_database() db,current_setting('server_version_num') version,
    host(inet_server_addr()) host,inet_server_port() port,session_user login`)).rows[0],
  { db: database, version: "170012", host: "127.0.0.1", port, login: user });
  return client;
}

async function seed(admin: Client, slug: string, owner = ownerA) {
  const sourceId = randomUUID();
  const manifest = { sourceId, sourceRevision: "1", sourceSha: "a".repeat(64), rightsRef: "fixture-rights", coverSha: sha,
    coverBytes: image.length, display: { kind: "광고", title: slug, subtitle: "Synthetic only", creator: "Fixture",
      genre: "Design", format: "WebP", description: "Synthetic work", width: 8, height: 6 } };
  await admin.query("INSERT INTO t293.works VALUES($1,$2,$3)", [owner, slug, { ownerId: owner, slug }]);
  await admin.query("INSERT INTO t253_showcase.source_images VALUES($1,$2,1,$3,true)", [owner, sourceId, manifest.sourceSha]);
  return manifest;
}

type Command = "prepare" | "complete" | "revoke";
const intent = (command: Command, slug: string, version: string, generation: string | null = null,
  reference: string | null = command === "prepare" ? "fixture-rights" : null) => [randomUUID(), command, slug, version, generation, reference];
const applied = (status: string, version: string, generation: string) => ({ status, version, generation });
const unavailable = { status: "source-unavailable" };

async function verify(admin: Client, a: Client, b: Client, list: Client, file: Client, concurrentList: Client, concurrentFile: Client) {
  const run = async (client: Client, command: ReturnType<typeof intent>, commit = true) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('t293.actor',$1,true)", [client === b ? ownerB : ownerA]);
      const { rows } = await client.query("SELECT t295.apply($1,$2,$3,$4,$5,$6) AS outcome", command);
      if (commit) await client.query("COMMIT");
      return rows[0].outcome;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  };
  const approved = async (client = list) => readApprovedSnapshot((await client.query("SELECT t295.list_approved() v")).rows[0].v);
  const cover = (slug: string, gen: string, client = file) => client.query("SELECT * FROM t295.find_cover($1,$2)", [slug, gen]);
  async function visibility(slug: string, gen: string, allowed: boolean, listClient = list, fileClient = file) {
    const [feed, imageRow] = await Promise.all([approved(listClient), cover(slug, gen, fileClient)]);
    assert.equal(feed.records.some(row => row.id === slug), allowed);
    assert.equal(imageRow.rowCount, Number(allowed));
    if (allowed) assert.deepEqual(imageRow.rows[0], { object_key: `${slug}/${gen}/${sha}.webp`, mime: "image/webp", size_bytes: image.length, sha });
  }
  const expiryIn = async (seconds: number) => (await admin.query<{ cutoff: string }>(
    "SELECT (clock_timestamp()+make_interval(secs=>$1))::text AS cutoff", [seconds])).rows[0].cutoff;
  const sleepTo = (cutoff: string) => admin.query("SELECT pg_sleep_until($1::timestamptz + interval '5 milliseconds')", [cutoff]);
  async function rights(slug: string, manifest: Awaited<ReturnType<typeof seed>>, cutoff: string | null, owner = ownerA) {
    await admin.query("INSERT INTO t295.attestations VALUES($1,$2,$3,$4,$5,$6)",
      [owner, slug, manifest.rightsRef, manifest, cutoff === null ? "perpetual" : "timed", cutoff]);
  }
  async function publish(slug: string) {
    assert.deepEqual(await run(a, intent("prepare", slug, "0")), applied("prepared", "1", "1"));
    assert.deepEqual(await run(a, intent("complete", slug, "1", "1")), applied("published", "2", "1"));
  }

  const perpetual = await seed(admin, "perpetual");
  const other = await seed(admin, "other-owner", ownerB);
  await rights("perpetual", perpetual, null);
  await rights("other-owner", other, null, ownerB);
  await assert.rejects(run(b, intent("prepare", "perpetual", "0")), { code: "42501" });
  await assert.rejects(run(a, intent("prepare", "other-owner", "0")), { code: "42501" });
  await assert.rejects(list.query("SELECT * FROM t295.frozen_manifest"), { code: "42501" });
  await assert.rejects(file.query("UPDATE t295.activation SET expires_at=NULL"), { code: "42501" });
  await assert.rejects(list.query("SELECT t295.apply(NULL,NULL,NULL,NULL,NULL,NULL)"), { code: "42501" });
  await assert.rejects(list.query("SELECT t253_showcase.list_approved()"), { code: "42501" });
  await assert.rejects(file.query("SELECT * FROM t253_showcase.find_cover('perpetual',1)"), { code: "42501" });
  await assert.rejects(list.query("SELECT * FROM t295.find_cover('perpetual',1)"), { code: "42501" });
  await assert.rejects(file.query("SELECT t295.list_approved()"), { code: "42501" });
  await publish("perpetual");
  await visibility("perpetual", "1", true);

  const timed = await seed(admin, "timed");
  const deadline = await expiryIn(3);
  await rights("timed", timed, deadline);
  const boundary = (await admin.query(`SELECT
    t295.valid_rights('timed',$1,$1::timestamptz-interval '1 microsecond') AS before,
    t295.valid_rights('timed',$1,$1) AS exact,
    t295.valid_rights('timed',$1,$1::timestamptz+interval '1 microsecond') AS after,
    t295.valid_rights('timed',NULL,$1) AS missing,
    t295.valid_rights('perpetual',NULL,$1) AS permanent`, [deadline])).rows[0];
  assert.deepEqual(boundary, { before: true, exact: false, after: false, missing: false, permanent: true });
  const prepare = intent("prepare", "timed", "0");
  const complete = intent("complete", "timed", "1", "1");
  assert.deepEqual(await run(a, prepare), applied("prepared", "1", "1"));
  await visibility("timed", "1", false);
  assert.deepEqual(await run(a, complete), applied("published", "2", "1"));
  const bindings = (await admin.query(`SELECT m.expires_at::text manifest_expiry,a.expires_at::text active_expiry,
    m.manifest=r.fingerprint->'payload' AS original FROM t295.frozen_manifest m JOIN t295.activation a USING(owner_id,slug,generation)
    JOIN t253_showcase.requests r ON r.actor=a.owner_id AND r.request_id=$1 WHERE m.slug='timed'`, [complete[0]])).rows[0];
  assert.deepEqual(bindings, { manifest_expiry: deadline, active_expiry: deadline, original: true });
  await Promise.all([concurrentList.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"), concurrentFile.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")]);
  try {
    await visibility("timed", "1", true, concurrentList, concurrentFile);
    await sleepTo(deadline);
    await Promise.all([visibility("timed", "1", false, concurrentList, concurrentFile), visibility("timed", "1", false)]);
  } finally { await Promise.all([concurrentList.query("ROLLBACK"), concurrentFile.query("ROLLBACK")]); }
  assert.deepEqual(await run(a, complete), applied("published", "2", "1"));
  await visibility("timed", "1", false);
  await visibility("perpetual", "1", true);
  assert.deepEqual(await run(a, intent("revoke", "timed", "2", "1")), applied("revoked", "3", "1"));
  await rights("timed", { ...timed, rightsRef: "renewed-proof" }, null);
  assert.deepEqual(await run(a, intent("prepare", "timed", "3", null, "renewed-proof")), applied("prepared", "4", "4"));
  assert.deepEqual(await run(a, intent("complete", "timed", "4", "4")), applied("published", "5", "4"));
  assert.deepEqual(await run(a, [...prepare.slice(0, 5), "renewed-proof"]), applied("prepared", "1", "1"));
  assert.deepEqual(await run(a, [...prepare.slice(0, 5), null]), applied("prepared", "1", "1"));
  assert.deepEqual(await run(a, complete), applied("published", "2", "1"));
  await visibility("timed", "4", true);
  assert.equal((await cover("timed", "1")).rowCount, 0);
  console.log("DB microsecond boundary, concurrent snapshots, perpetual authority and retired-generation replay passed");

  const drift = await seed(admin, "drift");
  const missing = intent("prepare", "drift", "0");
  assert.deepEqual(await run(a, missing), unavailable);
  const firstDeadline = await expiryIn(600);
  await rights("drift", drift, firstDeadline);
  assert.deepEqual(await run(a, missing), unavailable);
  assert.deepEqual(await run(a, intent("prepare", "drift", "0")), applied("prepared", "1", "1"));
  const proofDrift = intent("complete", "drift", "1", "1");
  await admin.query("UPDATE t295.attestations SET expires_at=expires_at+interval '1 second' WHERE slug='drift'");
  assert.deepEqual(await run(a, proofDrift), unavailable);
  await visibility("drift", "1", false);
  await admin.query("UPDATE t295.attestations SET expires_at=$1 WHERE slug='drift'", [firstDeadline]);
  assert.deepEqual(await run(a, proofDrift), unavailable);
  assert.deepEqual(await run(a, intent("complete", "drift", "1", "1")), applied("published", "2", "1"));
  await visibility("drift", "1", true);
  await admin.query("UPDATE t295.activation SET expires_at=expires_at+interval '1 second' WHERE slug='drift'");
  await visibility("drift", "1", false);
  await admin.query("DELETE FROM t295.activation WHERE slug='drift'");
  await visibility("drift", "1", false);
  assert.equal((await admin.query("SELECT active_generation::text g FROM t253_showcase.slots WHERE slug='drift'")).rows[0].g, "1");

  const late = await seed(admin, "late");
  const expiredPending = await seed(admin, "expired-pending");
  const lateDeadline = await expiryIn(3);
  await rights("late", late, lateDeadline);
  await rights("expired-pending", expiredPending, lateDeadline);
  assert.deepEqual(await run(a, intent("prepare", "late", "0")), applied("prepared", "1", "1"));
  assert.deepEqual(await run(a, intent("prepare", "expired-pending", "0")), applied("prepared", "1", "1"));
  const lateComplete = intent("complete", "late", "1", "1");
  assert.deepEqual(await run(a, lateComplete, false), applied("published", "2", "1"));
  await visibility("late", "1", false);
  await a.query("ROLLBACK");
  assert.equal((await admin.query("SELECT 1 FROM t295.activation WHERE slug='late'")).rowCount, 0);
  assert.equal((await admin.query("SELECT 1 FROM t253_showcase.requests WHERE request_id=$1", [lateComplete[0]])).rowCount, 0);
  assert.deepEqual(await run(a, lateComplete, false), applied("published", "2", "1"));
  await sleepTo(lateDeadline);
  await a.query("COMMIT");
  assert.equal((await admin.query("SELECT 1 FROM t295.activation WHERE slug='late'")).rowCount, 1);
  await visibility("late", "1", false);
  assert.deepEqual(await run(a, intent("complete", "expired-pending", "1", "1")), unavailable);
  await visibility("expired-pending", "1", false);
  assert.equal((await admin.query("SELECT 1 FROM t295.activation WHERE slug='expired-pending'")).rowCount, 0);
  console.log("Missing and mismatched proofs, rollback, commit past expiry, owner isolation and public role restrictions passed");
}

try {
  await writeFile(passfile, password, { flag: "wx", mode: 0o600 });
  try { await tools("initdb", ["-D", data, "-U", bootstrap, "--pwfile=" + passfile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], 120_000); }
  finally { await unlink(passfile); }
  startAttempted = true;
  await start();
  await checkListener();
  const system = await connect(bootstrap, password, "postgres");
  assert(samePath((await system.query("SHOW data_directory")).rows[0].data_directory, data));
  await system.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
  const admin = await connect();
  await admin.query("BEGIN");
  for (const sql of [t253, t293, candidate]) await admin.query(sql);
  const users = [["t293_actor_a", "t293_app"], ["t293_actor_b", "t293_app"], ["t295_read_list", "t295_list"], ["t295_read_file", "t295_file"]];
  const logins = new Map<string, string>();
  for (const [user, role] of users) {
    const secret = randomBytes(24).toString("hex");
    await admin.query(`CREATE ROLE ${user} LOGIN INHERIT NOBYPASSRLS PASSWORD '${secret}'; GRANT ${role} TO ${user}`);
    logins.set(user, secret);
  }
  await admin.query("INSERT INTO t253_showcase.publishers VALUES($1),($2)", [ownerA, ownerB]);
  await admin.query("COMMIT");
  const login = (name: string) => { const secret = logins.get(name); assert(secret); return connect(name, secret); };
  const [a, b, list, file, list2, file2] = await Promise.all([login("t293_actor_a"), login("t293_actor_b"), login("t295_read_list"),
    login("t295_read_file"), login("t295_read_list"), login("t295_read_file")]);
  await verify(admin, a, b, list, file, list2, file2);
} finally {
  await Promise.allSettled([...clients].map(client => client.end()));
  const pidfile = join(data, "postmaster.pid");
  const exists = await access(pidfile).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
  if (startAttempted && exists) {
    await checkListener();
    await tools("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
  }
  await assert.rejects(access(pidfile), { code: "ENOENT" });
  if (startAttempted) await ps("if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T295_PORT) -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Unexpected leftover listener' }", { T295_PORT: String(port) });
  const cleanup = await realpath(root);
  assert(samePath(dirname(cleanup), temp) && basename(cleanup).startsWith("dream-t295-"));
  await rm(cleanup, { recursive: true, force: false });
  console.log("Owned PG17 listener and temporary cluster removed");
}
