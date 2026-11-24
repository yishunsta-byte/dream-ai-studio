/* global console, process */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
assert.equal(process.platform, "win32");
assert.equal(process.argv.length, 2, "The probe accepts no host, credentials or target arguments");
const systemRoot = process.env.SystemRoot;
assert(systemRoot);
const keep = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "TEMP", "TMP"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key.toUpperCase())));
for (const key of Object.keys(process.env)) if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$|NEXT_PUBLIC_SUPABASE)/i.test(key)) delete process.env[key];

const { Client } = (await import("pg")).default;
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const samePath = (a, b) => a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase();
assert(samePath(await realpath(bin), bin), "Expected owned PG17 directory");
const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
async function ps(script, args = {}) {
  return (await exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script],
    { env: { ...env, ...args }, windowsHide: true, timeout: 25_000 })).stdout.trim();
}
const binaries = ["postgres.exe", "initdb.exe", "pg_ctl.exe"];
for (const executable of binaries) {
  const path = join(bin, executable);
  assert(samePath(await realpath(path), path), "Linked tool denied");
  await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T310_TOOL
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
  { T310_TOOL: path });
  const { stdout } = await exec(path, ["--version"], { env, windowsHide: true, timeout: 10_000 });
  assert.match(stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const manifest = [
  ["0001_schema", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
];
const sources = [];
for (const [name, checksum] of manifest) {
  const sql = (await readFile(new URL("../../lib/db/postgres/" + name + ".sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"), checksum, "Fixed source mismatch: " + name);
  sources.push(sql);
}
const candidate = (await readFile(new URL("managed-authority-generations.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(candidate).digest("hex"), "4430829dd3f717d72aff13cdd01ddf2058634be8d0346e4288c05ac0e1dd3ad8");
const witness = (await readFile(new URL("studio-analysis-authority-store.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(witness).digest("hex"), "00a72fd018c7beffe4939d96ca257eba63a31f6d344b3a4166801eb8dad7da41");
const issuer = await readFile(new URL("t310-authority-issuance.sql", import.meta.url), "utf8");

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
const temp = await realpath(tmpdir());
const port = await freePort();
const root = await mkdtemp(join(temp, "dream-t310-"));
const data = join(root, "cluster");
const password = randomBytes(24).toString("hex");
const passfile = join(root, "bootstrap-password");
const dbName = "dream_test_t281";
const adminUser = "t281_bootstrap";
const ownerA = "10000000-0000-4000-8000-000000000081";
const projectA = "10000000-0000-4000-8000-000000000083";
const assetA = "10000000-0000-7000-8000-000000000086";
const purpose = "rea-reference";
const clients = new Set();
let startAttempted = false;

async function startServer() {
  const out = await open(join(root, "startup.log"), "wx");
  try {
    const launcher = spawn(join(bin, "pg_ctl.exe"), [
      "-D", data, "-l", join(root, "postgres.log"), "-o", "-h 127.0.0.1 -p " + port, "-w", "-t", "30", "start",
    ], { env, windowsHide: true, stdio: ["ignore", out.fd, out.fd], timeout: 40_000 });
    await new Promise((resolve, reject) => {
      launcher.once("error", reject);
      launcher.once("exit", code => code === 0 ? resolve() : reject(new Error("Synthetic postmaster failed to start")));
    });
  } finally { await out.close(); }
}

async function verifyListener() {
  const lines = (await readFile(join(data, "postmaster.pid"), "utf8")).split(/\r?\n/);
  assert(samePath(lines[1], data) && Number(lines[3]) === port);
  const pid = Number(lines[0]);
  assert(Number.isSafeInteger(pid) && pid > 0);
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T310_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T310_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T310_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T310_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T310_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T310_PID: String(pid), T310_PG: join(bin, "postgres.exe"), T310_DATA: data, T310_PORT: String(port) });
}

async function connect(user = adminUser, database = dbName, credential = password) {
  const client = new Client({
    host: "127.0.0.1", port, user, password: credential, database, ssl: false, connectionTimeoutMillis: 2_500,
    statement_timeout: 8_000, application_name: "t310-fixture",
  });
  clients.add(client);
  await client.connect();
  return client;
}
const login = "t310_issuer";
const issuerPassword = randomBytes(24).toString("hex");
const store = "fixture-store";
const generation = "restore-1";
const verification = "60000000-0000-7000-8000-000000000086";
const reserved = { outcome: "reserved", revision: null, changed: false };
const conflict = { outcome: "conflict", revision: null, changed: false };
const first = async (client, sql, args = []) => (await client.query(sql, args)).rows[0];
const identify = number => `10000000-0000-7000-8000-${String(number).padStart(12, "0")}`;
const request = (id, revision, operation = "issue") => [store, generation, identify(id), 1, operation, ownerA, assetA, revision, verification];
const submit = (client, args, reserveOnly) =>
  first(client, "SELECT * FROM rea_t310.submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [...args,reserveOnly]);
const observe = (client, args) => first(client, "SELECT * FROM rea_t310.observe($1,$2,$3)", args.slice(0,3));
const pointer = admin => first(admin, "SELECT state,revision,source_generation FROM rea_t310.pointer");
const lockCommit = admin => admin.query("SELECT pg_advisory_lock(310001,17)");
const unlockCommit = async admin => assert.deepEqual(await first(admin, "SELECT pg_advisory_unlock(310001,17) AS done"), { done: true });

async function seed(admin) {
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await admin.query("INSERT INTO auth.users VALUES($1)", [ownerA]);
  for (const sql of sources) await admin.query(sql);
  await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
    title,goal,target,aspect,length_sec,created_at,updated_at)
    VALUES($1,$2,'probe','1','{}','{}','synthetic','synthetic','synthetic','16:9',10,now(),now())`, [ownerA,projectA]);
  const sha = "a".repeat(64);
  const key = `${ownerA}/assets/${assetA}/${sha}.png`;
  await admin.query(`INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,size_bytes,sha256,origin,width,height,created_at)
    VALUES($1,$2,'image','synthetic','original',$3,'image/png',8,$4,'upload',16,16,now())`, [ownerA,assetA,key,sha]);
  await admin.query("INSERT INTO dream.project_assets VALUES($1,$2,$3,$4)", [ownerA,projectA,assetA,purpose]);
  await admin.query("SET rea_t281.synthetic='on'; SET rea_t310.synthetic='on'");
  await admin.query(candidate);
  await admin.query(witness);
  await admin.query("SELECT rea_t307.seed_registration($1,$2,false)", [ownerA,assetA]);
  await admin.query(issuer);
  await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${issuerPassword}'`);
  await admin.query(`GRANT USAGE ON SCHEMA rea_t310 TO ${login};
    GRANT EXECUTE ON FUNCTION rea_t310.submit(text,text,uuid,bigint,text,uuid,uuid,bigint,uuid,boolean),
      rea_t310.observe(text,text,uuid) TO ${login}`);
}

async function waitBlocked(admin, waiter, blocker, query) {
  for (let i = 0; i < 120; i++) {
    const row = await first(admin, `SELECT $2::integer=ANY(pg_blocking_pids(pid)) AS blocked,query,wait_event_type
      FROM pg_stat_activity WHERE pid=$1 AND application_name='t310-fixture'`, [waiter.processID,blocker.processID]);
    if (row?.blocked && row.wait_event_type === "Lock" && row.query.startsWith(query)) return;
    await delay(15);
  }
  assert.fail("Expected owned PostgreSQL backend to wait on the named lock");
}

async function startHeldCommit(client, args, reserveOnly, expected) {
  await client.query("BEGIN; SET LOCAL rea_t310.pause_commit='on'");
  assert.deepEqual(await submit(client,args,reserveOnly),expected);
  const commit = client.query("COMMIT");
  void commit.catch(() => {});
  return { commit };
}

async function assertUnknown(client, args, reserveOnly) {
  await client.query("BEGIN; SET LOCAL lock_timeout='250ms'");
  try {
    await assert.rejects(submit(client,args,reserveOnly), { code: "55P03" });
    await assert.rejects(client.query("SELECT 1"), { code: "25P02" });
  } finally { await client.query("ROLLBACK"); }
}

async function cancelCommit(admin, writer, commit) {
  assert.deepEqual(await first(admin, "SELECT pg_cancel_backend($1) AS cancelled", [writer.processID]), { cancelled: true });
  await assert.rejects(commit, { code: "57014" });
  // pg reports the error before ReadyForQuery. Prove the connection has left the transaction.
  await writer.query("SELECT 1");
  assert.equal(writer.getTransactionStatus(), "I");
}

async function reservationRace(admin, writer, contender, deadline, args) {
  await lockCommit(admin);
  try {
    const { commit } = await startHeldCommit(writer,args,true,reserved);
    await waitBlocked(admin,writer,admin,"COMMIT");
    assert.equal(await observe(contender,args), undefined);
    assert.deepEqual(await pointer(admin), { state: "empty", revision: "0", source_generation: null });
    await assertUnknown(deadline,args,true);
    assert.equal(await observe(contender,args), undefined);
    const duplicate = submit(contender,args,true);
    void duplicate.catch(() => {});
    await waitBlocked(admin,contender,writer,"SELECT * FROM rea_t310.submit");
    const different = submit(deadline,request(1,1),true);
    void different.catch(() => {});
    await waitBlocked(admin,deadline,writer,"SELECT * FROM rea_t310.submit");
    await unlockCommit(admin);
    assert.equal((await commit).command,"COMMIT");
    assert.deepEqual(await duplicate,reserved);
    assert.deepEqual(await different,conflict);
  } finally {
    await admin.query("SELECT pg_advisory_unlock_all()");
  }
  assert.deepEqual(await observe(contender,args), { state: "reserved", revision: null });
  assert.deepEqual(await first(admin,"SELECT count(*)::int AS count FROM rea_t310.ledger"), { count: 1 });
  assert.deepEqual(await submit(contender,request(1,0,"revoke"),false),conflict);
  console.log("Reservation COMMIT waiting: separate ledger row absent, deadline unknown, same-key waiter reuses the committed reservation");
}

async function executionRace(admin, writer, contender, deadline, args) {
  await lockCommit(admin);
  try {
    const { commit } = await startHeldCommit(writer,args,false,{ outcome: "issued", revision: "1", changed: true });
    await waitBlocked(admin,writer,admin,"COMMIT");
    assert.deepEqual(await observe(contender,args), { state: "reserved", revision: null });
    assert.equal((await pointer(admin)).revision,"0");
    await assertUnknown(deadline,args,false);
    const duplicate = submit(contender,args,false);
    void duplicate.catch(() => {});
    await waitBlocked(admin,contender,writer,"SELECT * FROM rea_t310.submit");
    await unlockCommit(admin);
    assert.equal((await commit).command,"COMMIT");
    assert.deepEqual(await duplicate,{ outcome: "issued", revision: "1", changed: false });
  } finally {
    await admin.query("SELECT pg_advisory_unlock_all()");
  }
  assert.deepEqual(await observe(contender,args), { state: "issued", revision: "1" });
  const current = await pointer(admin);
  assert.equal(current.revision,"1");
  assert.match(current.source_generation,/^[0-9a-f-]{36}$/);
  assert.deepEqual(await submit(contender,args,false), { outcome: "issued", revision: "1", changed: false });
  assert.deepEqual(await pointer(admin),current);
  console.log("Issuance COMMIT waiting: separate reader sees reservation only, follower returns the committed result, pointer written once");
}

async function rollbackRace(admin, writer, contender, deadline, args) {
  assert.deepEqual(await submit(contender,args,true),reserved);
  await lockCommit(admin);
  try {
    const { commit } = await startHeldCommit(writer,args,false,{ outcome: "issued", revision: "2", changed: true });
    await waitBlocked(admin,writer,admin,"COMMIT");
    const original = await pointer(admin);
    assert.equal(original.revision,"1");
    assert.deepEqual(await observe(contender,args), { state: "reserved", revision: null });
    await assertUnknown(deadline,args,false);
    assert.deepEqual(await pointer(admin),original);
    await cancelCommit(admin,writer,commit);
    assert.deepEqual(await pointer(admin),original);
    assert.deepEqual(await observe(contender,args), { state: "reserved", revision: null });
  } finally {
    await admin.query("SELECT pg_advisory_unlock_all()");
  }
  assert.deepEqual(await submit(contender,args,false),{ outcome: "issued", revision: "2", changed: true });
  assert.deepEqual(await submit(contender,args,false),{ outcome: "issued", revision: "2", changed: false });
  assert.equal((await pointer(admin)).revision,"2");
  console.log("Cancelled COMMIT: rollback confirmed, pointer and reservation unchanged, then exactly one valid retry");
}

async function reservationRollback(admin, writer, contender, deadline, args) {
  await lockCommit(admin);
  try {
    const { commit } = await startHeldCommit(writer,args,true,reserved);
    await waitBlocked(admin,writer,admin,"COMMIT");
    assert.equal(await observe(contender,args),undefined);
    await assertUnknown(deadline,args,true);
    await cancelCommit(admin,writer,commit);
    assert.equal(await observe(contender,args),undefined);
  } finally {
    await admin.query("SELECT pg_advisory_unlock_all()");
  }
  assert.deepEqual(await submit(contender,args,true),reserved);
  assert.deepEqual(await observe(contender,args),{ state: "reserved", revision: null });
  console.log("Cancelled reservation COMMIT: same-key reservation created only after rollback was confirmed");
}

async function exercise(admin) {
  const [writer, contender, deadline] = await Promise.all(Array.from({length:3}, () => connect(login,dbName,issuerPassword)));
  await assert.rejects(contender.query("SELECT * FROM rea_t310.ledger"), { code: "42501" });
  await assert.rejects(contender.query("UPDATE rea_t310.pointer SET revision=99"), { code: "42501" });
  await assert.rejects(contender.query("SELECT rea_t310.lock_request('', '', NULL, 1)"), { code: "42501" });
  await assert.rejects(contender.query("SET ROLE t310_guard"), { code: "42501" });
  const needsReservation = { outcome: "reservation_required", revision: null, changed: false };
  assert.deepEqual(await submit(contender,request(1,0),false),needsReservation);
  await contender.query("BEGIN");
  try {
    assert.deepEqual(await submit(contender,request(1,0),true),reserved);
    assert.deepEqual(await submit(contender,request(1,0),false),needsReservation);
    assert.equal(await observe(deadline,request(1,0)),undefined);
  } finally { await contender.query("ROLLBACK"); }
  assert.equal(await observe(contender,request(1,0)),undefined);
  await contender.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try { await assert.rejects(submit(contender,request(1,0),true),{ code: "25001" }); }
  finally { await contender.query("ROLLBACK"); }

  await reservationRace(admin,writer,contender,deadline,request(1,0));
  await executionRace(admin,writer,contender,deadline,request(1,0));
  await rollbackRace(admin,writer,contender,deadline,request(2,1));
  const late = request(3,2);
  const revoke = request(4,2,"revoke");
  assert.deepEqual(await submit(writer,late,true),reserved);
  assert.deepEqual(await submit(contender,revoke,true),reserved);
  assert.deepEqual(await submit(contender,revoke,false),{ outcome: "revoked", revision: "3", changed: true });
  assert.deepEqual(await submit(contender,revoke,false),{ outcome: "revoked", revision: "3", changed: false });
  assert.deepEqual(await submit(writer,late,false),{ outcome: "stale_pointer", revision: null, changed: false });
  assert.deepEqual(await observe(writer,late),{ state: "reserved", revision: null });
  assert.deepEqual(await submit(writer,request(1,0),false),{ outcome: "issued", revision: "1", changed: false });
  assert.deepEqual(await pointer(admin),{ state: "revoked", revision: "3", source_generation: null });
  await reservationRollback(admin,writer,contender,deadline,request(5,3));
  assert.deepEqual(await pointer(admin),{ state: "revoked", revision: "3", source_generation: null });
  await admin.query("UPDATE rea_t310.control SET work_number=2");
  assert.deepEqual(await submit(writer,late,false),{ outcome: "inactive", revision: null, changed: false });
  assert.deepEqual(await first(admin,`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE usename='t310_issuer' AND state LIKE 'idle in transaction%'`), { count: 0 });
  await Promise.all([writer,contender,deadline].map(client => client.end()));
  assert.deepEqual(await first(admin,"SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename='t310_issuer'"), { count: 0 });
  console.log("Revocation preserved revision 3, blocked stale issuance and old work number, and left no issuer sessions");
}
try {
  await writeFile(passfile, password, { flag: "wx" });
  try {
    await exec(join(bin, "initdb.exe"), ["-D",data,"-U",adminUser,"--pwfile=" + passfile,
      "--auth=scram-sha-256","--encoding=UTF8","--locale=C"], { env, windowsHide: true, timeout: 120_000 });
  } finally { await unlink(passfile); }
  startAttempted = true;
  await startServer();
  await verifyListener();
  const bootstrap = await connect(adminUser, "postgres");
  await bootstrap.query("CREATE DATABASE dream_test_t281 TEMPLATE template0");
  const admin = await connect();
  await seed(admin);
  await exercise(admin);
} finally {
  await Promise.allSettled([...clients].map(client => client.end()));
  const pidFile = join(data, "postmaster.pid");
  const pidExists = await access(pidFile).then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (startAttempted && pidExists) {
    await verifyListener();
    await exec(join(bin, "pg_ctl.exe"), ["-D",data,"-m","fast","-w","-t","25","stop"],
      { env, windowsHide: true, timeout: 30_000 });
  }
  await assert.rejects(access(pidFile), { code: "ENOENT" });
  if (startAttempted) await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T310_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Unexpected remaining listener' }`, { T310_PORT: String(port) });
  const resolved = await realpath(root);
  assert(samePath(dirname(resolved), temp) && basename(resolved).startsWith("dream-t310-"), "Unsafe cleanup target");
  await rm(resolved, { recursive: true, force: false });
  console.log("Owned PG17 process stopped, listener and temporary cluster removed");
}
