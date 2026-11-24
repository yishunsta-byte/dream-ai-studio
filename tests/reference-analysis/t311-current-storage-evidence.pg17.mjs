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
  await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T311_TOOL
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
  { T311_TOOL: path });
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
const ledger = (await readFile(new URL("t310-authority-issuance.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(ledger).digest("hex"), "7015f2c3fed9444b2eea3358cdd7f1b7ef3a758bf4a113f1bcf77df9336c46ee");
const fixture = await readFile(new URL("t311-current-storage-evidence.sql", import.meta.url), "utf8");

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
const temp = await realpath(tmpdir());
const port = await freePort();
const root = await mkdtemp(join(temp, "dream-t311-"));
const data = join(root, "cluster");
const password = randomBytes(24).toString("hex");
const passfile = join(root, "bootstrap-password");
const dbName = "dream_test_t281";
const adminUser = "t281_bootstrap";
const ownerA = "10000000-0000-4000-8000-000000000081";
const ownerB = "10000000-0000-4000-8000-000000000082";
const projectA = "10000000-0000-4000-8000-000000000083";
const projectB = "10000000-0000-4000-8000-000000000085";
const assetA = "10000000-0000-7000-8000-000000000086";
const assetB = "10000000-0000-7000-8000-000000000088";
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
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T311_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T311_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T311_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T311_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T311_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T311_PID: String(pid), T311_PG: join(bin, "postgres.exe"), T311_DATA: data, T311_PORT: String(port) });
}

async function connect(user = adminUser, database = dbName, credential = password) {
  const client = new Client({
    host: "127.0.0.1", port, user, password: credential, database, ssl: false, connectionTimeoutMillis: 2_500,
    statement_timeout: 8_000, application_name: "t311-fixture",
  });
  clients.add(client);
  await client.connect();
  return client;
}
const issuerLogin = "t311_issue_login";
const readerLogin = "t311_read_login";
const issuePassword = randomBytes(24).toString("hex");
const readPassword = randomBytes(24).toString("hex");
const first = async (client, sql, args = []) => (await client.query(sql, args)).rows[0];
const actorSetting = "SELECT set_config('dream.actor_id',$1,true)";
const policy = async client => (await first(client,"SELECT rea_t311.rotate_policy() AS epoch")).epoch;
const reverify = async (client, owner, asset, succeeds) =>
  (await first(client,"SELECT rea_t311.reverify($1,$2,$3) AS generation",[owner,asset,succeeds])).generation;
const issue = async (client, asset, tuple, revision) =>
  (await first(client,"SELECT rea_t311.issue($1,$2,$3,1) AS outcome",[asset,tuple,revision])).outcome;
const evidence = async (admin, owner, asset) =>
  (await first(admin,"SELECT evidence FROM rea_t311.current_evidence WHERE (owner_id,asset_id)=($1,$2)",[owner,asset]))?.evidence;
const proof = (admin, owner, asset) => first(admin,`SELECT revision,evidence,source_generation
  FROM rea_t311.proof WHERE (owner_id,asset_id)=($1,$2)`,[owner,asset]);
const storageState = (admin, owner, asset) => first(admin,`SELECT s.status,s.current_receipt_id,s.revision,o.active_generation
  FROM dream.asset_receipt_state s JOIN dream.storage_objects o ON (s.owner_id,s.object_id)=(o.owner_id,o.id)
  WHERE (s.owner_id,s.asset_id)=($1,$2)`,[owner,asset]);

async function transaction(client, run, owner) {
  await client.query("BEGIN");
  try {
    if (owner) await client.query(actorSetting,[owner]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seed(admin) {
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await admin.query("INSERT INTO auth.users VALUES($1),($2)",[ownerA,ownerB]);
  for (const sql of sources) await admin.query(sql);
  for (const [owner, project, asset] of [[ownerA,projectA,assetA],[ownerB,projectB,assetB]]) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
      title,goal,target,aspect,length_sec,created_at,updated_at)
      VALUES($1,$2,'probe','1','{}','{}','synthetic','synthetic','synthetic','16:9',10,now(),now())`,[owner,project]);
    const sha = "a".repeat(64);
    const key = `${owner}/assets/${asset}/${sha}.png`;
    await admin.query(`INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,size_bytes,sha256,origin,width,height,created_at)
      VALUES($1,$2,'image','synthetic','original',$3,'image/png',8,$4,'upload',16,16,now())`,[owner,asset,key,sha]);
    await admin.query("INSERT INTO dream.project_assets VALUES($1,$2,$3,$4)",[owner,project,asset,purpose]);
  }
  await admin.query("SET rea_t281.synthetic='on'; SET rea_t310.synthetic='on'; SET rea_t311.synthetic='on'");
  await admin.query(candidate);
  await admin.query(witness);
  await admin.query("SELECT rea_t307.seed_registration($1,$2,false),rea_t307.seed_registration($3,$4,false)",[ownerA,assetA,ownerB,assetB]);
  await admin.query(ledger);
  await admin.query(fixture);
  await admin.query(`CREATE ROLE ${issuerLogin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${issuePassword}'`);
  await admin.query(`CREATE ROLE ${readerLogin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${readPassword}'`);
  await admin.query(`GRANT USAGE ON SCHEMA rea_t311 TO ${issuerLogin};
    GRANT EXECUTE ON FUNCTION rea_t311.issue(uuid,jsonb,bigint,bigint) TO ${issuerLogin};
    GRANT t311_read TO ${readerLogin} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  for (const [owner, project, asset] of [[ownerA,projectA,assetA],[ownerB,projectB,assetB]]) {
    await transaction(admin,async client => {
      await client.query("SET LOCAL ROLE t281_operator");
      assert.equal((await first(client,"SELECT rea_t281.owner_permission(true) AS ok")).ok,true);
      assert.equal((await first(client,"SELECT rea_t281.scope_permission($1,$2,true) AS ok",[project,asset])).ok,true);
    },owner);
  }
}

async function visible(reader, owner, asset) {
  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await reader.query("SET LOCAL ROLE t311_read");
    await reader.query(actorSetting,[owner]);
    const list = (await reader.query("SELECT asset_id FROM rea_t311.readable ORDER BY asset_id")).rows.map(row => row.asset_id);
    const project = asset===assetA ? projectA : projectB;
    const one = await first(reader,"SELECT asset_id FROM rea_t311.readable WHERE (project_id,asset_id)=($1,$2)",[project,asset]);
    assert.equal(one?.asset_id,list.includes(asset) ? asset : undefined);
    await reader.query("COMMIT");
    return list;
  } catch (error) {
    await reader.query("ROLLBACK");
    throw error;
  }
}

async function waitBlocked(admin, waiter, blocker, layer) {
  for (let i=0; i<125; i++) {
    const row = await first(admin,`SELECT $2::integer=ANY(pg_blocking_pids(pid)) AS blocked,wait_event_type
      FROM pg_stat_activity WHERE pid=$1 AND application_name='t311-fixture'`,[waiter.processID,blocker.processID]);
    if (row?.blocked && row.wait_event_type==="Lock") {
      const locks = await first(admin,`SELECT
        bool_or(relation='dream.storage_policies'::regclass AND granted AND mode='RowShareLock') AS policy,
        bool_or(relation='dream.storage_objects'::regclass AND granted AND mode='RowShareLock') AS object,
        bool_or(relation='dream.storage_verification_operations'::regclass AND granted) AS operation,
        bool_or(relation='dream.asset_receipt_state'::regclass AND granted) AS state
        FROM pg_locks WHERE pid=$1 AND locktype='relation'`,[waiter.processID]);
      assert.deepEqual(locks,{ policy:true, object:layer==="object", operation:false, state:false });
      return;
    }
    await delay(15);
  }
  assert.fail("Expected owned backend to block at the policy or object layer");
}

async function lockDeadline(client, run, owner) {
  await client.query("BEGIN; SET LOCAL lock_timeout='250ms'");
  try {
    if (owner) await client.query(actorSetting,[owner]);
    await assert.rejects(run(client),{ code:"55P03" });
    await assert.rejects(client.query("SELECT 1"),{ code:"25P02" });
  } finally { await client.query("ROLLBACK"); }
}

async function refresh(admin, issuer, owner, asset) {
  const current = await evidence(admin,owner,asset);
  assert(current);
  const before = await proof(admin,owner,asset);
  assert.equal(await transaction(issuer,c => issue(c,asset,current,before?.revision ?? 0),owner),"issued");
  const issued = await proof(admin,owner,asset);
  assert.deepEqual(issued.evidence,current);
  assert.notEqual(issued.source_generation,before?.source_generation);
  return issued;
}

async function writerWins(admin, writer, issuer, short, reader, mode) {
  const before = await proof(admin,ownerA,assetA);
  const old = await storageState(admin,ownerA,assetA);
  const isPolicy = mode==="policy";
  const layer = isPolicy ? "policy" : "object";
  const change = isPolicy ? policy : c => reverify(c,ownerA,assetA,mode==="success");
  const stale = c => issue(c,assetA,before.evidence,before.revision);
  await writer.query("BEGIN");
  try {
    await change(writer);
    assert.deepEqual(await visible(reader,ownerA,assetA),[assetA]);
    await lockDeadline(short,stale,ownerA);
    assert.deepEqual(await proof(admin,ownerA,assetA),before);
    const waiting = transaction(issuer,stale,ownerA);
    void waiting.catch(() => {});
    await waitBlocked(admin,issuer,writer,layer);
    await writer.query("COMMIT");
    assert.equal(await waiting,"stale_evidence");
  } finally { await writer.query("ROLLBACK"); }
  assert.deepEqual(await proof(admin,ownerA,assetA),before);
  assert.deepEqual(await visible(reader,ownerA,assetA),[]);
  assert.deepEqual(await visible(reader,ownerB,assetB),isPolicy ? [] : [assetB]);
  await verifyTransition(admin,mode,old);
  console.log(`${mode}: storage writer first, deadline rolled back and old evidence could not write or read`);
}

async function issuerWins(admin, writer, shortWriter, issuer, reader, mode) {
  const before = await proof(admin,ownerA,assetA);
  const old = await storageState(admin,ownerA,assetA);
  const isPolicy = mode==="policy";
  const layer = isPolicy ? "policy" : "object";
  const change = isPolicy ? policy : c => reverify(c,ownerA,assetA,mode==="success");
  await issuer.query("BEGIN");
  try {
    await issuer.query(actorSetting,[ownerA]);
    assert.equal(await issue(issuer,assetA,before.evidence,before.revision),"issued");
    await lockDeadline(shortWriter,change);
    assert.deepEqual(await storageState(admin,ownerA,assetA),old);
    const waiting = change(writer);
    void waiting.catch(() => {});
    await waitBlocked(admin,writer,issuer,layer);
    await issuer.query("COMMIT");
    await waiting;
  } finally { await issuer.query("ROLLBACK"); }
  const committed = await proof(admin,ownerA,assetA);
  assert.equal(BigInt(committed.revision),BigInt(before.revision)+1n);
  assert.deepEqual(committed.evidence,before.evidence);
  assert.notEqual(committed.source_generation,before.source_generation);
  assert.equal(await transaction(issuer,c => issue(c,assetA,before.evidence,committed.revision),ownerA),"stale_evidence");
  assert.deepEqual(await proof(admin,ownerA,assetA),committed);
  assert.deepEqual(await visible(reader,ownerA,assetA),[]);
  assert.deepEqual(await visible(reader,ownerB,assetB),isPolicy ? [] : [assetB]);
  await verifyTransition(admin,mode,old);
  console.log(`${mode}: issuer first, storage writer waited and the next committed transition hid the old proof`);
}

async function verifyTransition(admin, mode, old) {
  const next = await storageState(admin,ownerA,assetA);
  if (mode==="policy") {
    assert.deepEqual(next,old);
    assert.equal(await evidence(admin,ownerA,assetA),undefined);
    return;
  }
  assert.equal(BigInt(next.active_generation),BigInt(old.active_generation)+1n);
  assert.equal(BigInt(next.revision),BigInt(old.revision)+1n);
  const current = await evidence(admin,ownerA,assetA);
  if (mode==="failure") {
    assert.equal(next.status,"revoked");
    assert.equal(next.current_receipt_id,old.current_receipt_id);
    assert.equal(current,undefined);
  } else {
    assert.equal(next.status,"ready");
    assert.notEqual(next.current_receipt_id,old.current_receipt_id);
    assert.equal(current.verificationId,next.current_receipt_id);
    assert.equal(String(current.storageGeneration),next.active_generation);
  }
}

async function exercise(admin) {
  const [writer,shortWriter,issuer,shortIssuer,reader] = await Promise.all([
    connect(),connect(),connect(issuerLogin,dbName,issuePassword),
    connect(issuerLogin,dbName,issuePassword),connect(readerLogin,dbName,readPassword),
  ]);
  await assert.rejects(issuer.query("UPDATE rea_t311.proof SET revision=99"),{code:"42501"});
  await assert.rejects(issuer.query("SET ROLE t311_guard"),{code:"42501"});
  await assert.rejects(issuer.query("SELECT rea_t311.rotate_policy()"),{code:"42501"});
  await assert.rejects(reader.query("SELECT * FROM rea_t311.readable"),{code:"42501"});
  await reader.query("SET ROLE t311_read");
  assert.deepEqual((await reader.query("SELECT asset_id FROM rea_t311.readable")).rows,[]);
  await assert.rejects(reader.query("SELECT rea_t311.issue(NULL,NULL,0,1)"),{code:"42501"});
  await reader.query("RESET ROLE");
  const firstA = await refresh(admin,issuer,ownerA,assetA);
  const firstB = await refresh(admin,issuer,ownerB,assetB);
  assert.deepEqual(await visible(reader,ownerA,assetB),[assetA]);
  assert.deepEqual(await visible(reader,ownerB,assetA),[assetB]);
  assert.equal(await transaction(issuer,c => issue(c,assetB,firstB.evidence,firstB.revision),ownerA),"unavailable");
  assert.equal(await transaction(issuer,c => issue(c,assetA,firstA.evidence,firstA.revision),ownerB),"unavailable");
  assert.equal(await transaction(issuer,c => issue(c,assetA,firstA.evidence,0),ownerA),"stale_pointer");
  for (const field of ["policyId","policyEpoch","policyDigest","objectId","identityDigest","verificationId","storageGeneration"]) {
    assert.equal(await transaction(issuer,c => issue(c,assetA,{...firstA.evidence,[field]:"mismatch"},firstA.revision),ownerA),"stale_evidence");
  }
  assert.deepEqual(await proof(admin,ownerA,assetA),firstA);
  assert.deepEqual(await proof(admin,ownerB,assetB),firstB);

  for (const [mode, firstWriter] of [["policy",true],["policy",false],["success",true],["success",false],["failure",true],["failure",false]]) {
    const beforeB = await proof(admin,ownerB,assetB);
    if (firstWriter) await writerWins(admin,writer,issuer,shortIssuer,reader,mode);
    else await issuerWins(admin,writer,shortWriter,issuer,reader,mode);
    assert.deepEqual(await proof(admin,ownerB,assetB),beforeB);
    if (mode!=="success") await reverify(writer,ownerA,assetA,true);
    if (mode==="policy") {
      await reverify(writer,ownerB,assetB,true);
      const nextB = await refresh(admin,issuer,ownerB,assetB);
      assert.notEqual(nextB.evidence.policyEpoch,beforeB.evidence.policyEpoch);
      assert.notEqual(nextB.evidence.policyDigest,beforeB.evidence.policyDigest);
    }
    assert.deepEqual(await visible(reader,ownerA,assetA),[]);
    const nextA = await refresh(admin,issuer,ownerA,assetA);
    assert.equal(nextA.evidence.policyId,"fixture");
    assert.deepEqual(await visible(reader,ownerA,assetB),[assetA]);
    assert.deepEqual(await visible(reader,ownerB,assetA),[assetB]);
  }
  assert.deepEqual(await first(admin,`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE application_name='t311-fixture' AND state LIKE 'idle in transaction%'`),{count:0});
  await Promise.all([writer,shortWriter,issuer,shortIssuer,reader].map(c => c.end()));
  assert.deepEqual(await first(admin,`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE usename IN ('t311_issue_login','t311_read_login')`),{count:0});
  console.log("Six lock races passed; fresh policy/verification evidence issued, A/B remained isolated, and application sessions drained");
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
  if (startAttempted) await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T311_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Unexpected remaining listener' }`, { T311_PORT: String(port) });
  const resolved = await realpath(root);
  assert(samePath(dirname(resolved), temp) && basename(resolved).startsWith("dream-t311-"), "Unsafe cleanup target");
  await rm(resolved, { recursive: true, force: false });
  console.log("Owned PG17 process stopped, listener and temporary cluster removed");
}
