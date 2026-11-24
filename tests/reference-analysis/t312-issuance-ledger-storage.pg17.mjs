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
  await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T312_TOOL
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
  { T312_TOOL: path });
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
const storageFixture = (await readFile(new URL("t311-current-storage-evidence.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(storageFixture).digest("hex"), "59cc6087ffd4f70dd7d39ebe056cc11965c18fde4e4495e6744bb560b48ce6e5");
const integration = await readFile(new URL("t312-issuance-ledger-storage.sql", import.meta.url), "utf8");

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
const temp = await realpath(tmpdir());
const port = await freePort();
const root = await mkdtemp(join(temp, "dream-t312-"));
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
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T312_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T312_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T312_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T312_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T312_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T312_PID: String(pid), T312_PG: join(bin, "postgres.exe"), T312_DATA: data, T312_PORT: String(port) });
}

async function connect(user = adminUser, database = dbName, credential = password) {
  const client = new Client({
    host: "127.0.0.1", port, user, password: credential, database, ssl: false, connectionTimeoutMillis: 2_500,
    statement_timeout: 8_000, application_name: "t312-fixture",
  });
  clients.add(client);
  await client.connect();
  return client;
}
const issuerLogin = "t312_issue_login";
const readerLogin = "t312_read_login";
const issuePassword = randomBytes(24).toString("hex");
const readPassword = randomBytes(24).toString("hex");
const first = async (client, sql, args = []) => (await client.query(sql, args)).rows[0];
const actorSetting = "SELECT set_config('dream.actor_id',$1,true)";
const policy = async client => (await first(client,"SELECT rea_t311.rotate_policy() AS epoch")).epoch;
const reverify = async (client, owner, asset, succeeds) =>
  (await first(client,"SELECT rea_t311.reverify($1,$2,$3) AS generation",[owner,asset,succeeds])).generation;
const evidence = async (admin, owner, asset) =>
  (await first(admin,"SELECT snapshot FROM rea_t312.storage_snapshot WHERE (owner_id,asset_id)=($1,$2)",[owner,asset]))?.snapshot;
const proof = (admin, owner, asset) => first(admin,`SELECT revision,evidence,source_generation,retired,retired_storage_generation
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
  await admin.query("SET rea_t281.synthetic='on'; SET rea_t310.synthetic='on'; SET rea_t311.synthetic='on'; SET rea_t312.synthetic='on'");
  await admin.query(candidate);
  await admin.query(witness);
  await admin.query("SELECT rea_t307.seed_registration($1,$2,false),rea_t307.seed_registration($3,$4,false)",[ownerA,assetA,ownerB,assetB]);
  await admin.query(ledger);
  await admin.query(storageFixture);
  await admin.query(integration);
  await admin.query(`CREATE ROLE ${issuerLogin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${issuePassword}'`);
  await admin.query(`CREATE ROLE ${readerLogin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${readPassword}'`);
  await admin.query(`GRANT USAGE ON SCHEMA rea_t312 TO ${issuerLogin};
    GRANT EXECUTE ON FUNCTION rea_t312.request(uuid,bigint,text,uuid,jsonb,bigint,boolean),rea_t312.observe(uuid) TO ${issuerLogin};
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
    const list = (await reader.query("SELECT asset_id FROM rea_t312.readable ORDER BY asset_id")).rows.map(row => row.asset_id);
    const project = asset===assetA ? projectA : projectB;
    const one = await first(reader,"SELECT asset_id FROM rea_t312.readable WHERE (project_id,asset_id)=($1,$2)",[project,asset]);
    assert.equal(one?.asset_id,list.includes(asset) ? asset : undefined);
    await reader.query("COMMIT");
    return list;
  } catch (error) {
    await reader.query("ROLLBACK");
    throw error;
  }
}

const result = (outcome, revision = null, changed = false) => ({ outcome, revision, changed });
const reserved = result("reserved");
const requestId = id => `12000000-0000-7000-8000-${String(id).padStart(12,"0")}`;
const request = (id, asset, snapshot, revision, operation = "issue") => [requestId(id),1,operation,asset,snapshot,revision];
const submit = (client, args, reserveOnly = false) =>
  first(client,"SELECT * FROM rea_t312.request($1,$2,$3,$4,$5,$6,$7)",[...args,reserveOnly]);
const observe = (client, owner, args) =>
  transaction(client,c => first(c,"SELECT * FROM rea_t312.observe($1)",[args[0]]),owner);
const submitAs = (client, owner, args, reserveOnly = false) =>
  transaction(client,c => submit(c,args,reserveOnly),owner);
const atomicState = (admin, owner, asset, args) => first(admin,`SELECT
    (SELECT jsonb_build_object('state',state,'revision',result_revision::text) FROM rea_t310.ledger
      WHERE (store_id,restore_generation,request_id)=('fixture-store','restore-1',$3)) AS ledger,
    (SELECT jsonb_build_object('revision',revision::text,'retired',retired,'generation',source_generation,
      'evidence',evidence,'retiredStorageGeneration',retired_storage_generation::text) FROM rea_t311.proof
      WHERE (owner_id,asset_id)=($1,$2)) AS pointer`,[owner,asset,args[0]]);
const lockCommit = admin => admin.query("SELECT pg_advisory_lock(310001,17)");
const unlockCommit = async admin => assert.deepEqual(await first(admin,"SELECT pg_advisory_unlock(310001,17) AS done"),{done:true});

async function waitBlocked(admin, waiter, blocker, query) {
  for (let i=0; i<125; i++) {
    const row = await first(admin,`SELECT $2::integer=ANY(pg_blocking_pids(pid)) AS blocked,query,wait_event_type
      FROM pg_stat_activity WHERE pid=$1 AND application_name='t312-fixture'`,[waiter.processID,blocker.processID]);
    if (row?.blocked && row.wait_event_type==="Lock" && row.query.startsWith(query)) return;
    await delay(15);
  }
  assert.fail("Expected an owned PostgreSQL backend to wait for the named owner");
}

async function lockDeadline(client, run, owner) {
  await client.query("BEGIN; SET LOCAL lock_timeout='250ms'");
  try {
    if (owner) await client.query(actorSetting,[owner]);
    await assert.rejects(run(client),{code:"55P03"});
    await assert.rejects(client.query("SELECT 1"),{code:"25P02"});
  } finally { await client.query("ROLLBACK"); }
}

async function heldCommit(issuer, owner, args, expected) {
  await issuer.query("BEGIN; SET LOCAL rea_t310.pause_commit='on'");
  await issuer.query(actorSetting,[owner]);
  assert.deepEqual(await submit(issuer,args),expected);
  const commit = issuer.query("COMMIT");
  void commit.catch(() => {});
  return { commit };
}

async function initial(admin, issuer, owner, asset, id) {
  const args = request(id,asset,await evidence(admin,owner,asset),0);
  assert(args[4].eligible);
  assert.deepEqual(await submitAs(issuer,owner,args,true),reserved);
  assert.deepEqual(await submitAs(issuer,owner,args),result("issued","1",true));
  const current = await atomicState(admin,owner,asset,args);
  assert.deepEqual(current.ledger,{state:"issued",revision:"1"});
  assert.equal(current.pointer.revision,"1");
  return args;
}

async function commitAgainstPolicy(admin, issuer, retry, writer, short, reader, initialA) {
  await reverify(writer,ownerA,assetA,true);
  const snapshot = await evidence(admin,ownerA,assetA);
  assert.notEqual(snapshot.verificationId,initialA[4].verificationId);
  assert(snapshot.storageGeneration>initialA[4].storageGeneration);
  const renewal = request(4,assetA,snapshot,1);
  assert.deepEqual(await submitAs(issuer,ownerA,renewal,true),reserved);
  const before = await atomicState(admin,ownerA,assetA,renewal);
  assert.deepEqual(before.ledger,{state:"reserved",revision:null});
  assert.deepEqual(await visible(reader,ownerA,assetA),[]);

  await lockCommit(admin);
  try {
    const { commit } = await heldCommit(issuer,ownerA,renewal,result("issued","2",true));
    await waitBlocked(admin,issuer,admin,"COMMIT");
    assert.deepEqual(await atomicState(admin,ownerA,assetA,renewal),before);
    await lockDeadline(short,c => submit(c,renewal),ownerA);
    const retrying = submitAs(retry,ownerA,renewal);
    void retrying.catch(() => {});
    await waitBlocked(admin,retry,issuer,"SELECT * FROM rea_t312.request");
    const rotating = policy(writer);
    void rotating.catch(() => {});
    await waitBlocked(admin,writer,issuer,"SELECT rea_t311.rotate_policy");
    await unlockCommit(admin);
    // The harness synchronizes with the driver's completion, but supplies no
    // result to the originating caller. The other connection must reconcile.
    await commit;
    assert.deepEqual(await retrying,result("issued","2"));
    assert.equal(await rotating,"2");
  } finally { await admin.query("SELECT pg_advisory_unlock_all()"); }
  const after = await atomicState(admin,ownerA,assetA,renewal);
  assert.deepEqual(after.ledger,{state:"issued",revision:"2"});
  assert.equal(after.pointer.revision,"2");
  assert.equal(after.pointer.evidence.verificationId,snapshot.verificationId);
  assert.notEqual(after.pointer.generation,before.pointer.generation);
  assert.deepEqual(await observe(retry,ownerA,renewal),after.ledger);
  assert.deepEqual(await submitAs(retry,ownerA,renewal),result("issued","2"));
  assert.deepEqual(await atomicState(admin,ownerA,assetA,renewal),after);
  assert.deepEqual(await visible(reader,ownerA,assetA),[]);
  assert.deepEqual(await visible(reader,ownerB,assetB),[]);
  console.log("Renewal COMMIT + duplicate + policy rotation: complete result pair once, no old proof visible after rotation");
}

async function retryAgainstVerification(admin, issuer, retry, writer, reader, succeeds) {
  const snapshot = await evidence(admin,ownerA,assetA);
  assert(snapshot.eligible);
  const renewal = request(succeeds ? 13 : 6,assetA,snapshot,2);
  assert.deepEqual(await submitAs(issuer,ownerA,renewal,true),reserved);
  const before = await atomicState(admin,ownerA,assetA,renewal);
  await writer.query("BEGIN");
  try {
    await reverify(writer,ownerA,assetA,succeeds);
    const firstTry = submitAs(issuer,ownerA,renewal);
    void firstTry.catch(() => {});
    await waitBlocked(admin,issuer,writer,"SELECT * FROM rea_t312.request");
    const sameRequest = submitAs(retry,ownerA,renewal);
    void sameRequest.catch(() => {});
    await waitBlocked(admin,retry,issuer,"SELECT * FROM rea_t312.request");
    assert.deepEqual(await atomicState(admin,ownerA,assetA,renewal),before);
    await writer.query("COMMIT");
    assert.deepEqual(await firstTry,result("stale_evidence"));
    assert.deepEqual(await sameRequest,result("stale_evidence"));
  } finally { await writer.query("ROLLBACK"); }
  assert.deepEqual(await atomicState(admin,ownerA,assetA,renewal),before);
  const state = await storageState(admin,ownerA,assetA);
  assert(BigInt(state.active_generation)>BigInt(snapshot.storageGeneration));
  assert.deepEqual(await visible(reader,ownerA,assetA),[]);
  assert.deepEqual(await visible(reader,ownerB,assetA),[assetB]);
  if (succeeds) {
    assert.equal(state.status,"ready");
    assert.notEqual(state.current_receipt_id,snapshot.verificationId);
    console.log("Successful verification changes the current record before the same-key attempt and retry; neither writes");
    return;
  }
  assert.equal(state.status,"revoked");
  assert.equal(state.current_receipt_id,snapshot.verificationId);
  const failed = await evidence(admin,ownerA,assetA);
  assert.equal(failed.eligible,null);
  const revoke = request(7,assetA,failed,2,"revoke");
  assert.deepEqual(await submitAs(retry,ownerA,revoke,true),reserved);
  assert.deepEqual(await submitAs(retry,ownerA,revoke),result("revoked","3",true));
  assert.deepEqual(await submitAs(issuer,ownerA,revoke),result("revoked","3"));
  const retired = await atomicState(admin,ownerA,assetA,revoke);
  assert.deepEqual(retired.ledger,{state:"revoked",revision:"3"});
  assert.equal(retired.pointer.retired,true);
  assert.equal(retired.pointer.retiredStorageGeneration,state.active_generation);
  console.log("Failed verification wins over original and same-key retry; explicit failed-state revocation retires proof once");
}

async function cancelAndReplayRecovery(admin, issuer, retry, writer, reader) {
  await reverify(writer,ownerA,assetA,true);
  const recovery = request(8,assetA,await evidence(admin,ownerA,assetA),3);
  assert.deepEqual(await submitAs(retry,ownerA,recovery,true),reserved);
  const before = await atomicState(admin,ownerA,assetA,recovery);
  await lockCommit(admin);
  try {
    const { commit } = await heldCommit(issuer,ownerA,recovery,result("issued","4",true));
    await waitBlocked(admin,issuer,admin,"COMMIT");
    assert.deepEqual(await atomicState(admin,ownerA,assetA,recovery),before);
    assert.deepEqual(await first(admin,"SELECT pg_cancel_backend($1) AS cancelled",[issuer.processID]),{cancelled:true});
    await assert.rejects(commit,{code:"57014"});
    await issuer.query("SELECT 1");
    assert.equal(issuer.getTransactionStatus(),"I");
    assert.deepEqual(await atomicState(admin,ownerA,assetA,recovery),before);
  } finally { await admin.query("SELECT pg_advisory_unlock_all()"); }
  assert.deepEqual(await submitAs(retry,ownerA,recovery),result("issued","4",true));
  assert.deepEqual(await submitAs(issuer,ownerA,recovery),result("issued","4"));
  assert.deepEqual(await visible(reader,ownerA,assetA),[assetA]);
  console.log("Cancelled COMMIT rolled back pointer and ledger together; one same-key recovery restored visibility");
}

async function delayedIssueAfterRevocation(admin, issuer, retry, writer, reader) {
  await reverify(writer,ownerA,assetA,true);
  const snapshot = await evidence(admin,ownerA,assetA);
  const delayed = request(9,assetA,snapshot,4);
  const revoke = request(10,assetA,snapshot,4,"revoke");
  assert.deepEqual(await submitAs(issuer,ownerA,delayed,true),reserved);
  assert.deepEqual(await submitAs(retry,ownerA,revoke,true),reserved);
  assert.deepEqual(await submitAs(retry,ownerA,revoke),result("revoked","5",true));
  const after = await atomicState(admin,ownerA,assetA,revoke);
  assert.equal(after.pointer.retired,true);
  assert.equal(after.pointer.retiredStorageGeneration,String(snapshot.storageGeneration));
  assert.deepEqual(await evidence(admin,ownerA,assetA),snapshot);
  assert.deepEqual(await submitAs(issuer,ownerA,delayed),result("stale_pointer"));
  assert.deepEqual(await observe(issuer,ownerA,delayed),{state:"reserved",revision:null});
  const reissuedOld = request(11,assetA,snapshot,5);
  assert.deepEqual(await submitAs(issuer,ownerA,reissuedOld,true),reserved);
  assert.deepEqual(await submitAs(issuer,ownerA,reissuedOld),result("renewal_requires_new_verification"));
  assert.deepEqual(await atomicState(admin,ownerA,assetA,revoke),after);
  assert.deepEqual(await visible(reader,ownerA,assetA),[]);
  await reverify(writer,ownerA,assetA,true);
  const current = await evidence(admin,ownerA,assetA);
  const newIssue = request(12,assetA,current,5);
  assert.notEqual(current.verificationId,snapshot.verificationId);
  assert(current.storageGeneration>snapshot.storageGeneration);
  assert.deepEqual(await submitAs(issuer,ownerA,newIssue,true),reserved);
  assert.deepEqual(await submitAs(issuer,ownerA,newIssue),result("issued","6",true));
  assert.deepEqual(await visible(reader,ownerA,assetB),[assetA]);
  console.log("Revocation defeated delayed issuance and old-record reuse; only a post-revocation verification could reissue");
}

async function revokeVisibleProof(admin, issuer, retry, reader) {
  const revoke = request(14,assetB,await evidence(admin,ownerB,assetB),2,"revoke");
  assert.deepEqual(await submitAs(retry,ownerB,revoke,true),reserved);
  const before = await atomicState(admin,ownerB,assetB,revoke);
  await lockCommit(admin);
  try {
    const { commit } = await heldCommit(issuer,ownerB,revoke,result("revoked","3",true));
    await waitBlocked(admin,issuer,admin,"COMMIT");
    assert.deepEqual(await atomicState(admin,ownerB,assetB,revoke),before);
    assert.deepEqual(await visible(reader,ownerB,assetB),[assetB]);
    await unlockCommit(admin);
    await commit;
  } finally { await admin.query("SELECT pg_advisory_unlock_all()"); }
  const after = await atomicState(admin,ownerB,assetB,revoke);
  assert.deepEqual(after.ledger,{state:"revoked",revision:"3"});
  assert.equal(after.pointer.revision,"3");
  assert.equal(after.pointer.retired,true);
  assert.deepEqual(await evidence(admin,ownerB,assetB),revoke[4]);
  assert.deepEqual(await visible(reader,ownerB,assetB),[]);
  assert.deepEqual(await visible(reader,ownerA,assetB),[assetA]);
  assert.deepEqual(await submitAs(retry,ownerB,revoke),result("revoked","3"));
  assert.deepEqual(await atomicState(admin,ownerB,assetB,revoke),after);
  console.log("Revocation changed a visible proof and ledger together even though its SQL4 evidence remained current");
}

async function exercise(admin) {
  const [issuer,retry,writer,short,reader] = await Promise.all([
    connect(issuerLogin,dbName,issuePassword),connect(issuerLogin,dbName,issuePassword),
    connect(),connect(issuerLogin,dbName,issuePassword),connect(readerLogin,dbName,readPassword),
  ]);
  await assert.rejects(issuer.query("UPDATE rea_t310.ledger SET state='issued'"),{code:"42501"});
  await assert.rejects(issuer.query("SET ROLE t311_guard"),{code:"42501"});
  await assert.rejects(issuer.query("SELECT rea_t311.issue(NULL,NULL,0,1)"),{code:"42501"});
  await assert.rejects(reader.query("SELECT rea_t312.request(NULL,1,'issue',NULL,NULL,0,false)"),{code:"42501"});
  const initialA = await initial(admin,issuer,ownerA,assetA,1);
  await initial(admin,issuer,ownerB,assetB,2);
  assert.deepEqual(await visible(reader,ownerA,assetB),[assetA]);
  assert.deepEqual(await visible(reader,ownerB,assetA),[assetB]);
  assert.equal(await observe(retry,ownerB,initialA),undefined);
  assert.deepEqual(await submitAs(retry,ownerB,initialA),result("unavailable"));
  const hijack = request(1,assetB,await evidence(admin,ownerB,assetB),1);
  assert.deepEqual(await submitAs(retry,ownerB,hijack,true),result("unavailable"));
  const clash = request(1,assetA,initialA[4],1);
  assert.deepEqual(await submitAs(retry,ownerA,clash),result("conflict"));
  const sameVerification = request(3,assetA,initialA[4],1);
  assert.deepEqual(await submitAs(issuer,ownerA,sameVerification,true),reserved);
  assert.deepEqual(await submitAs(issuer,ownerA,sameVerification),result("renewal_requires_new_verification"));

  await commitAgainstPolicy(admin,issuer,retry,writer,short,reader,initialA);
  await reverify(writer,ownerB,assetB,true);
  const bRenewal = request(5,assetB,await evidence(admin,ownerB,assetB),1);
  assert.deepEqual(await submitAs(issuer,ownerB,bRenewal,true),reserved);
  assert.deepEqual(await submitAs(issuer,ownerB,bRenewal),result("issued","2",true));
  const fixedB = await proof(admin,ownerB,assetB);
  await reverify(writer,ownerA,assetA,true);
  await retryAgainstVerification(admin,issuer,retry,writer,reader,true);
  await retryAgainstVerification(admin,issuer,retry,writer,reader,false);
  await cancelAndReplayRecovery(admin,issuer,retry,writer,reader);
  await delayedIssueAfterRevocation(admin,issuer,retry,writer,reader);
  assert.deepEqual(await proof(admin,ownerB,assetB),fixedB);
  assert.deepEqual(await visible(reader,ownerB,assetA),[assetB]);
  await revokeVisibleProof(admin,issuer,retry,reader);
  assert.deepEqual(await first(admin,`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE application_name='t312-fixture' AND state LIKE 'idle in transaction%'`),{count:0});
  await Promise.all([issuer,retry,writer,short,reader].map(c => c.end()));
  assert.deepEqual(await first(admin,`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE usename IN ('t312_issue_login','t312_read_login')`),{count:0});
  console.log("A/B isolation and restricted roles held; no issuer or reader sessions remain");
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
  if (startAttempted) await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T312_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Unexpected remaining listener' }`, { T312_PORT: String(port) });
  const resolved = await realpath(root);
  assert(samePath(dirname(resolved), temp) && basename(resolved).startsWith("dream-t312-"), "Unsafe cleanup target");
  await rm(resolved, { recursive: true, force: false });
  console.log("Owned PG17 process stopped, listener and temporary cluster removed");
}
