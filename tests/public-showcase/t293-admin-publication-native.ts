import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Client } from "pg";
import sharp from "sharp";
import type { PublicationAction } from "../../components/admin/publication-model";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import type { AdminPublicationWork } from "../../lib/public-showcase/admin-publication-service";
import { readApprovedSnapshot } from "../../lib/public-showcase/showcase-source";
import { applyPgPublication } from "./t293-admin-publication-adapter";

assert.equal(process.platform, "win32");
assert.equal(process.argv.length, 2, "Only the fixed local tool directory is supported");
const exec = promisify(execFile);
const keep = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "TEMP", "TMP"]);
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key.toUpperCase()))),
  NODE_ENV: "test",
};
for (const key of Object.keys(process.env)) {
  if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$|NEXT_PUBLIC_SUPABASE)/i.test(key)) delete process.env[key];
}
const { Client: PgClient } = (await import("pg")).default;
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const samePath = (first: string, second: string) => first.replaceAll("/", "\\").toLowerCase() === second.replaceAll("/", "\\").toLowerCase();
assert(samePath(await realpath(bin), bin));
assert(process.env.SystemRoot);
const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
async function ps(script: string, values: Record<string, string>) {
  await exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script],
    { env: { ...env, ...values }, windowsHide: true, timeout: 25_000 });
}
for (const tool of ["postgres.exe", "initdb.exe", "pg_ctl.exe"]) {
  const path = join(bin, tool);
  assert(samePath(await realpath(path), path));
  await ps("$sig=Get-AuthenticodeSignature -LiteralPath $env:T293_TOOL; if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected PG tool signature' }", { T293_TOOL: path });
  const { stdout } = await exec(path, ["--version"], { env, windowsHide: true, timeout: 10_000 });
  assert.match(stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const fixed = (await readFile(new URL("../fixtures/postgres/t253-showcase-publication.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(fixed).digest("hex"), "7b9a252ec3093df0c7e7b900555d081baa1e5a5a8a20a2f18ce27c7c03f2b46c");
const candidate = await readFile(new URL("t293-admin-publication.sql", import.meta.url), "utf8");
const ownerA = "10000000-0000-4000-8000-0000000000a1";
const ownerB = "10000000-0000-4000-8000-0000000000b1";
const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#123456" } }).webp().toBuffer();
const coverSha = createHash("sha256").update(bytes).digest("hex");
const auth = (userId: string) => async (): Promise<ServerAuthResult> => ({ kind: "verified", userId, email: "synthetic@example.invalid" });
const bootstrapUser = "t293_bootstrap";
const db = "t253_" + randomUUID().replaceAll("-", "");
const listener = createServer();
await new Promise<void>((ok, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", ok); });
const address = listener.address();
assert(address && typeof address !== "string");
const { port } = address;
await new Promise<void>((ok, fail) => listener.close(error => error ? fail(error) : ok()));
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t293-"));
const data = join(root, "cluster");
const passfile = join(root, "bootstrap-password");
const clients = new Set<Client>();
const password = randomBytes(32).toString("hex");
let startAttempted = false;
const tools = (tool: string, args: string[], timeout = 30_000) =>
  exec(join(bin, tool + ".exe"), args, { env, windowsHide: true, timeout });

async function start() {
  const output = await open(join(root, "startup.log"), "wx");
  try {
    const launcher = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-o",
      `-h 127.0.0.1 -p ${port} -c log_min_error_statement=panic`, "-w", "-t", "30", "start"],
    { env, windowsHide: true, stdio: ["ignore", output.fd, output.fd], timeout: 40_000 });
    await new Promise<void>((ok, fail) => {
      launcher.once("error", fail);
      launcher.once("exit", code => code === 0 ? ok() : fail(new Error("Owned PG17 start failed")));
    });
  } finally { await output.close(); }
}

async function verifyListener() {
  const [pid, dir, , actualPort] = (await readFile(join(data, "postmaster.pid"), "utf8")).split(/\r?\n/);
  assert(samePath(dir, data) && Number(actualPort) === port && /^[1-9][0-9]*$/.test(pid));
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T293_PID)
  $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T293_PORT) -ErrorAction SilentlyContinue)
  if (!$p -or $p.ExecutablePath -ine $env:T293_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T293_DATA) -or
      $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T293_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T293_PID: pid, T293_PORT: String(port), T293_PG: join(bin, "postgres.exe"), T293_DATA: data });
}

async function connect(user = bootstrapUser, authPassword = password, database = db) {
  const client = new PgClient({ host: "127.0.0.1", port, database, user, password: authPassword, ssl: false,
    connectionTimeoutMillis: 5000, statement_timeout: 12_000 });
  await client.connect();
  clients.add(client);
  const row = (await client.query(`SELECT current_database() db, current_setting('server_version_num') version,
    host(inet_server_addr()) host, inet_server_port() port, session_user login`)).rows[0];
  assert.deepEqual(row, { db: database, version: "170012", host: "127.0.0.1", port, login: user });
  return client;
}

function action(command: PublicationAction["command"], slug: string, expectedVersion: string, generation: string | null = null): PublicationAction {
  return { requestId: randomUUID(), command, slug, expectedVersion, generation, rightsConfirmed: command !== "revoke" };
}
const failed = (status: string) => ({ status });
const success = (status: string, version: string, generation: string) => ({ status, version, generation });
const samples: Record<string, AdminPublicationWork> = {};

function evidence(work: AdminPublicationWork, generation = "1", expiresAtMs: number | null = null) {
  const scope = { ownerId: work.ownerId, workId: work.id, artifactId: work.artifact.id, artifactRevision: work.artifact.revision, sourceSha: work.artifact.sha };
  return { source: { ...scope, status: "complete" }, rights: { ...scope, status: "confirmed", scope: "public_showcase", reference: "synthetic-confirmed", expiresAtMs },
    cover: { ...scope, status: "verified", mime: "image/webp", sha: coverSha, sizeBytes: bytes.length, width: 8, height: 6,
      objectKey: `${work.slug}/${generation}/${coverSha}.webp` } };
}

async function seed(admin: Client, slug: string, ownerId = ownerA) {
  const work: AdminPublicationWork = { id: randomUUID(), ownerId, slug, revision: "0", media: "image",
    artifact: { id: randomUUID(), revision: "4", sha: "a".repeat(64), status: "complete" },
    display: { kind: "광고", title: slug, subtitle: "Synthetic subtitle", creator: "Fixture", genre: "Design", format: "WebP",
      description: "Synthetic work only", width: 8, height: 6 }, review: null, active: null };
  const proof = evidence(work);
  samples[slug] = work;
  await admin.query("INSERT INTO t293.works VALUES ($1,$2,$3)", [ownerId, slug, work]);
  await admin.query("INSERT INTO t293.evidence VALUES ($1,$2,$3)", [ownerId, slug, proof]);
  await admin.query("INSERT INTO t293.cover_objects VALUES ($1,$2,$3)", [ownerId, proof.cover.objectKey, bytes]);
  await admin.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,$3,$4,true)",
    [ownerId, work.artifact.id, work.artifact.revision, work.artifact.sha]);
}

async function snapshot(admin: Client) {
  return (await admin.query(`SELECT jsonb_build_object(
    'works',(SELECT jsonb_agg(to_jsonb(w) ORDER BY slug) FROM t293.works w),
    'slots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY slug) FROM t253_showcase.slots s),
    'sql',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor,request_id) FROM t253_showcase.requests r),
    'app',(SELECT jsonb_agg(to_jsonb(r) ORDER BY owner_id,request_id) FROM t293.app_requests r),
    'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY owner_id,request_id) FROM t293.audit a),
    'manifests',(SELECT jsonb_agg(to_jsonb(m) ORDER BY slug,generation) FROM t293.manifests m)
  ) AS state`)).rows[0].state;
}

async function waitForLock(admin: Client, blocker: number, waiter: number) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const { rows } = await admin.query<{ pids: number[] }>("SELECT pg_blocking_pids($1) AS pids", [waiter]);
    if (rows[0].pids.includes(blocker)) return;
    await delay(25);
  }
  throw new Error("Expected PostgreSQL transaction lock was not observed");
}

async function exercise(admin: Client, a: Client, a2: Client, b: Client, list: Client, file: Client) {
  const backendPid = async (client: Client) => (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const [adminPid, aPid, a2Pid] = await Promise.all([backendPid(admin), backendPid(a), backendPid(a2)]);
  const apply = (client: Client, intent: PublicationAction, hooks?: Parameters<typeof applyPgPublication>[3]) =>
    applyPgPublication(client, auth(client === b ? ownerB : ownerA), intent, hooks);
  const cover = (slug: string, generation: string) => file.query("SELECT * FROM t253_showcase.find_cover($1,$2)", [slug, generation]);
  const listing = async () => (await list.query("SELECT t253_showcase.list_approved() AS value")).rows[0].value;
  const proof = async (slug: string, value: ReturnType<typeof evidence>) => {
    await admin.query("BEGIN");
    await admin.query("SELECT slug FROM t293.works WHERE slug=$1 FOR UPDATE", [slug]);
    await admin.query("UPDATE t293.evidence SET value=$2 WHERE slug=$1", [slug, value]);
    await admin.query("COMMIT");
  };
  const rogue = await snapshot(admin);
  assert.deepEqual(await apply(b, action("prepare", "main", "0")), failed("denied"));
  assert.deepEqual(await applyPgPublication(a, auth(ownerB), action("prepare", "foreign", "0")), failed("denied"));
  assert.deepEqual(await applyPgPublication(a, async () => ({ kind: "local" }), action("prepare", "main", "0")), failed("denied"));
  assert.deepEqual(await snapshot(admin), rogue);
  await a.query("BEGIN");
  await a.query("SELECT set_config('t293.actor',$1,true),set_config('t253.actor',$1,true)", [ownerB]);
  assert.equal((await a.query("SELECT * FROM t293.works")).rowCount, 0);
  assert.equal((await a.query("SELECT t293.can_publish() AS ok")).rows[0].ok, false);
  await a.query("ROLLBACK");
  await assert.rejects(a.query("SELECT * FROM t253_showcase.requests"), { code: "42501" });
  await assert.rejects(a.query("SELECT t253_showcase.apply_command(NULL,NULL,NULL,NULL,NULL,NULL)"), { code: "42501" });
  await assert.rejects(list.query("SELECT * FROM t293.app_requests"), { code: "42501" });
  await assert.rejects(list.query("SELECT * FROM t253_showcase.find_cover('main',1)"), { code: "42501" });
  await assert.rejects(file.query("SELECT t253_showcase.list_approved()"), { code: "42501" });
  assert.deepEqual(await apply(b, action("prepare", "foreign", "0")), success("prepared", "1", "1"));
  console.log("A/B restricted logins, cross-owner denial and independent list/file roles passed");

  const initialAction = action("prepare", "main", "0");
  const prep = { ...initialAction, requestId: initialAction.requestId.toUpperCase() };
  assert.deepEqual(await apply(a, prep), success("prepared", "1", "1"));
  assert.deepEqual(await apply(a2, initialAction), success("prepared", "1", "1"));
  assert.equal((await cover("main", "1")).rowCount, 0);
  const complete = action("complete", "main", "1", "1");
  assert.deepEqual(await apply(a, complete, { afterCommit() { throw new Error("synthetic lost acknowledgment"); } }), failed("unavailable"));
  const committed = await snapshot(admin);
  const initialManifest = committed.manifests.find((row: { slug: string }) => row.slug === "main").value;
  const sqlOutcome = committed.sql.find((row: { request_id: string }) => row.request_id === complete.requestId);
  assert.deepEqual(sqlOutcome.fingerprint.payload, initialManifest);
  assert.equal(committed.app.find((row: { request_id: string }) => row.request_id === complete.requestId).manifest_generation, 1);
  assert.deepEqual(readApprovedSnapshot(await listing()).ids, ["main"]);
  assert.deepEqual((await cover("main", "1")).rows, [{ object_key: `main/1/${coverSha}.webp`, mime: "image/webp", size_bytes: bytes.length, sha: coverSha }]);
  await proof("main", { ...evidence(samples.main), rights: { ...evidence(samples.main).rights, reference: "changed-since-first-request" } });
  assert.deepEqual(await apply(a2, complete), success("published", "2", "1"));
  assert.deepEqual(await snapshot(admin), committed);
  await admin.query("BEGIN");
  await admin.query("SELECT slug FROM t293.works WHERE slug='main' FOR UPDATE");
  const waitingReplay = apply(a, complete);
  try {
    await waitForLock(admin, adminPid, aPid);
    await admin.query("DELETE FROM t253_showcase.publishers WHERE actor=$1", [ownerA]);
    await admin.query("COMMIT");
  } catch (error) { await admin.query("ROLLBACK"); throw error; }
  assert.deepEqual(await waitingReplay, failed("denied"));
  assert.deepEqual(await apply(a, complete), failed("denied"));
  await admin.query("INSERT INTO t253_showcase.publishers VALUES ($1)", [ownerA]);
  assert.deepEqual(await apply(a, action("revoke", "main", "2", "1")), success("revoked", "3", "1"));
  assert.deepEqual(readApprovedSnapshot(await listing()).ids, []);
  assert.equal((await cover("main", "1")).rowCount, 0);
  assert.deepEqual(await apply(a, complete), success("published", "2", "1"));
  assert.equal((await cover("main", "1")).rowCount, 0);
  console.log("Atomic T253/app/audit commit, original manifest, acknowledgment loss and retired generation replay passed");

  async function race(first: PublicationAction, second: PublicationAction, wantedFirst: unknown, wantedSecond: unknown) {
    const written = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const one = apply(a, first, { async afterWrites() { written.resolve(); await release.promise; } });
    let two: ReturnType<typeof apply> | undefined;
    try {
      const started = await Promise.race([written.promise.then(() => true), one.then(() => false)]);
      assert(started, "First command did not reach its uncommitted writes");
      two = apply(a2, second);
      await waitForLock(admin, aPid, a2Pid);
    } finally { release.resolve(); }
    assert.deepEqual(await Promise.all([one, two]), [wantedFirst, wantedSecond]);
  }
  const prepareRace = action("prepare", "race", "0");
  await race(prepareRace, prepareRace, success("prepared", "1", "1"), success("prepared", "1", "1"));
  const left = action("prepare", "dupe-left", "0");
  await race(left, { ...left, slug: "dupe-right" }, success("prepared", "1", "1"), failed("invalid"));
  assert.equal((await admin.query("SELECT 1 FROM t253_showcase.slots WHERE slug='dupe-right'")).rowCount, 0);
  await race(action("revoke", "race", "1", "1"), action("complete", "race", "1", "1"), success("revoked", "2", "1"), failed("conflict"));
  assert.equal((await cover("race", "1")).rowCount, 0);
  assert.deepEqual(await apply(a, action("prepare", "finish-first", "0")), success("prepared", "1", "1"));
  await race(action("complete", "finish-first", "1", "1"), action("revoke", "finish-first", "1", "1"), success("published", "2", "1"), success("revoked", "3", "1"));
  assert.equal((await cover("finish-first", "1")).rowCount, 0);
  console.log("Two real connections observed blocking; duplicate and both complete/revoke orders passed");

  const rollback = action("prepare", "rollback", "0");
  const before = await snapshot(admin);
  assert.deepEqual(await apply(a, rollback, { async afterWrites() { throw new Error("synthetic rollback"); } }), failed("unavailable"));
  assert.deepEqual(await snapshot(admin), before);
  assert.deepEqual(await apply(a, rollback), success("prepared", "1", "1"));
  const retry = action("complete", "rollback", "1", "1");
  const preRetry = await snapshot(admin);
  assert.deepEqual(await apply(a, retry, { failReadCover() { throw new Error("synthetic transient storage"); } }), failed("unavailable"));
  assert.deepEqual(await snapshot(admin), preRetry);
  assert.deepEqual(await apply(a, retry), success("published", "2", "1"));

  const future = action("complete", "evidence", "1", "1");
  assert.deepEqual(await apply(a, future), failed("conflict"));
  const invalidExpiry = action("prepare", "evidence", "0");
  await proof("evidence", evidence(samples.evidence, "1", Date.now() + 60_000));
  const beforeFailure = await snapshot(admin);
  assert.deepEqual(await apply(a, invalidExpiry, { afterCommit() { throw new Error("synthetic lost failure acknowledgment"); } }), failed("unavailable"));
  const afterFailure = await snapshot(admin);
  const { app: beforeApp, ...beforePublic } = beforeFailure;
  const { app: afterApp, ...afterPublic } = afterFailure;
  assert.deepEqual(afterPublic, beforePublic);
  assert.equal(afterApp.length, beforeApp.length + 1);
  assert.deepEqual(afterApp.find((row: { request_id: string }) => row.request_id === invalidExpiry.requestId).entry.outcome, failed("source-unavailable"));
  await proof("evidence", evidence(samples.evidence));
  assert.deepEqual(await apply(a2, invalidExpiry), failed("source-unavailable"));
  assert.deepEqual(await apply(a, action("prepare", "evidence", "0")), success("prepared", "1", "1"));
  assert.deepEqual(await apply(a2, future), failed("conflict"));
  assert.deepEqual(await apply(a, action("complete", "evidence", "1", "1")), success("published", "2", "1"));
  console.log("Rollbacks, unknown storage retries, and fixed failure confirmation after lost reply passed");

  const drift = action("prepare", "drift", "0");
  await admin.query("UPDATE t253_showcase.source_images SET finished=false WHERE source_id=$1", [samples.drift.artifact.id]);
  const beforeDrift = await snapshot(admin);
  assert.deepEqual(await apply(a, drift), failed("unavailable"));
  assert.deepEqual(await snapshot(admin), beforeDrift);
  await admin.query("UPDATE t253_showcase.source_images SET finished=true WHERE source_id=$1", [samples.drift.artifact.id]);
  assert.deepEqual(await apply(a, drift), success("prepared", "1", "1"));
  console.log("T253/app disagreement rolled back both sides; UUID reusable after reconciliation");
}

try {
  await writeFile(passfile, password, { flag: "wx", mode: 0o600 });
  try { await tools("initdb", ["-D", data, "-U", bootstrapUser, "--pwfile=" + passfile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], 120_000); }
  finally { await unlink(passfile); }
  startAttempted = true;
  await start();
  await verifyListener();
  const bootstrap = await connect(bootstrapUser, password, "postgres");
  assert(samePath((await bootstrap.query("SHOW data_directory")).rows[0].data_directory, data));
  await bootstrap.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
  const admin = await connect();
  await admin.query("BEGIN");
  await admin.query(fixed);
  await admin.query(candidate);
  const roles = [["t293_actor_a", "t293_app"], ["t293_actor_b", "t293_app"], ["t293_list", "t253_list"], ["t293_file", "t253_file"]];
  const logins = new Map<string, string>();
  for (const [login, role] of roles) {
    const token = randomBytes(24).toString("hex");
    await admin.query(`CREATE ROLE ${login} LOGIN INHERIT NOBYPASSRLS PASSWORD '${token}'; GRANT ${role} TO ${login}`);
    logins.set(login, token);
  }
  await admin.query("INSERT INTO t253_showcase.publishers VALUES ($1),($2)", [ownerA, ownerB]);
  for (const slug of ["main", "race", "dupe-left", "dupe-right", "finish-first", "rollback", "evidence", "drift"]) await seed(admin, slug);
  await seed(admin, "foreign", ownerB);
  await admin.query("COMMIT");
  const login = (name: string) => { const secret = logins.get(name); assert(secret); return connect(name, secret); };
  const [a, a2, b, list, file] = await Promise.all([login("t293_actor_a"), login("t293_actor_a"), login("t293_actor_b"), login("t293_list"), login("t293_file")]);
  await exercise(admin, a, a2, b, list, file);
} finally {
  await Promise.allSettled([...clients].map(client => client.end()));
  const pidFile = join(data, "postmaster.pid");
  const exists = await access(pidFile).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
  if (startAttempted && exists) {
    await verifyListener();
    await tools("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
  }
  await assert.rejects(access(pidFile), { code: "ENOENT" });
  if (startAttempted) await ps("if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T293_PORT) -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Unexpected remaining listener' }", { T293_PORT: String(port) });
  const cleanup = await realpath(root);
  assert(samePath(dirname(cleanup), temp) && basename(cleanup).startsWith("dream-t293-"));
  await rm(cleanup, { recursive: true, force: false });
  console.log("Owned PG17 listener and temporary cluster removed");
}
