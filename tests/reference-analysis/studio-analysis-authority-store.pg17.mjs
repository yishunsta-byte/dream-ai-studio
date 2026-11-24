/* global AbortController, console, process */
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
const { openIsolatedStudioAnalysisAuthorityStore } = await import("../../lib/reference-analysis/studio-analysis-authority-store.ts");
const { actorFromVerifiedUserId } = await import("../../lib/db/postgres/types.ts");
const { loadStudioRegisteredAnalysisPage } = await import("../../lib/reference-analysis/studio-registered-analysis-page.ts");
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
  await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T307_TOOL
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
  { T307_TOOL: path });
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
const witness = await readFile(new URL("studio-analysis-authority-store.sql", import.meta.url), "utf8");

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t307-"));
const data = join(root, "cluster");
const port = await freePort();
const password = randomBytes(24).toString("hex");
const passfile = join(root, "bootstrap-password");
const dbName = "dream_test_t281";
const adminUser = "t281_bootstrap";
const ownerA = "10000000-0000-4000-8000-000000000081";
const ownerB = "10000000-0000-4000-8000-000000000082";
const projectA = "10000000-0000-4000-8000-000000000083";
const projectB = "10000000-0000-4000-8000-000000000085";
const assetA = "10000000-0000-7000-8000-000000000086";
const assetA2 = "10000000-0000-7000-8000-000000000087";
const assetB = "10000000-0000-7000-8000-000000000088";
const purpose = "rea-reference";
const clients = new Set();
const stores = [];
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
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T307_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T307_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T307_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T307_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T307_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T307_PID: String(pid), T307_PG: join(bin, "postgres.exe"), T307_DATA: data, T307_PORT: String(port) });
}

async function connect(user = adminUser, database = dbName) {
  const client = new Client({
    host: "127.0.0.1", port, user, password, database, ssl: false, connectionTimeoutMillis: 2_500,
    statement_timeout: 8_000, application_name: "t307-fixture",
  });
  clients.add(client);
  await client.connect();
  return client;
}
const login = "t307_authority_login";
const readerRole = "t307_authority_reader";
const readerPassword = randomBytes(24).toString("hex");
const options = { profile: "t307-loopback-fixture", port, password: readerPassword,
  bucket: "private-test", maxBytes: 8, timeoutMs: 3500 };
const actorA = actorFromVerifiedUserId(ownerA);
const actorB = actorFromVerifiedUserId(ownerB);
const selectA = { projectId: projectA, assetId: assetA };
const selectB = { projectId: projectB, assetId: assetB };
const fresh = () => new AbortController().signal;
const unavailable = { message: "STUDIO_ANALYSIS_AUTHORITY_UNAVAILABLE" };
const first = async (client, sql, values = []) => (await client.query(sql, values)).rows[0];
const actorSetting = "SELECT set_config('dream.actor_id',$1,true)";

async function act(client, role, owner, sql, args) {
  await client.query("BEGIN");
  try {
    await client.query(role === "api" ? "SET LOCAL ROLE dream_api" : "SET LOCAL ROLE t281_operator");
    await client.query(actorSetting, [owner]);
    assert.deepEqual(await first(client, sql, args), { ok: true });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
const ownerPermission = (client, owner, allow) =>
  act(client, "operator", owner, "SELECT rea_t281.owner_permission($1) AS ok", [allow]);
const scopePermission = (client, owner, project, asset, allow) =>
  act(client, "operator", owner, "SELECT rea_t281.scope_permission($1,$2,$3) AS ok", [project, asset, allow]);
const link = (client, from, to) =>
  act(client, "api", ownerA, "SELECT rea_t281.change_link($1,$2,$3,$4,$5,$6) AS ok",
    [...(from ? [projectA, assetA, from] : [null, null, null]), ...(to ? [projectA, assetA, to] : [null, null, null])]);

async function seed(admin, images, videos) {
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [ownerA, ownerB]);
  for (const migration of sources) await admin.query(migration);
  for (const [owner, project] of [[ownerA,projectA],[ownerB,projectB]]) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
      title,goal,target,aspect,length_sec,created_at,updated_at)
      VALUES($1,$2,'probe','1','{}','{}','synthetic','synthetic','synthetic','16:9',10,now(),now())`, [owner,project]);
  }
  for (const [owner, project, asset, isImage] of [[ownerA,projectA,assetA,true],[ownerA,projectA,assetA2,false],[ownerB,projectB,assetB,false]]) {
    const bytes = images?.get(asset);
    const video = videos?.has(asset) ?? false;
    const image = !video && (isImage || Boolean(bytes));
    const sha = bytes ? createHash("sha256").update(bytes).digest("hex") : "a".repeat(64);
    const key = `${owner}/assets/${asset}/${sha}.${image ? "png" : "mp4"}`;
    await admin.query(`INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,size_bytes,sha256,origin,
      width,height,duration_ms,created_at)
      VALUES($1,$2,$3,$4,'original',$4,$5,$8,$6,'upload',16,16,$7,now())`,
    [owner,asset,image ? "image" : "video",key,image ? "image/png" : "video/mp4",sha,image ? null : video ? 2000 : 1000,bytes?.length ?? 8]);
    await admin.query("INSERT INTO dream.project_assets VALUES($1,$2,$3,$4)", [owner,project,asset,purpose]);
  }
  await admin.query("SET rea_t281.synthetic='on'");
  await admin.query(candidate);
  await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${readerPassword}'`);
  assert.equal(await openIsolatedStudioAnalysisAuthorityStore(options), undefined);
  const intentLimit = "incoming,8,deadline";
  if (images) assert.equal(witness.split(intentLimit).length, 2);
  await admin.query(images ? witness.replace(intentLimit, "incoming,asset_row.size_bytes,deadline") : witness);
  await admin.query(`GRANT t307_authority_reader TO ${login} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  for (const [owner, asset, expired] of [[ownerA,assetA,false],[ownerA,assetA2,true],[ownerB,assetB,false]]) {
    await admin.query("SELECT rea_t307.seed_registration($1,$2,$3)", [owner,asset,expired]);
  }
}

async function proveRole() {
  const client = new Client({ host: "127.0.0.1", port, database: dbName, user: login, password: readerPassword,
    ssl: false, connectionTimeoutMillis: 2500, statement_timeout: 2500 });
  clients.add(client);
  await client.connect();
  await assert.rejects(client.query("SELECT * FROM dream.assets"), { code: "42501" });
  await client.query("SET ROLE t307_authority_reader");
  assert.deepEqual((await client.query("SELECT owner_id FROM dream.assets")).rows, []);
  await client.query("BEGIN");
  await client.query(actorSetting, [ownerA]);
  assert.deepEqual((await client.query("SELECT DISTINCT owner_id FROM rea_t307.asset_witness")).rows, [{ owner_id: ownerA }]);
  assert.deepEqual((await client.query("SELECT DISTINCT owner_id FROM dream.storage_objects")).rows, [{ owner_id: ownerA }]);
  await assert.rejects(client.query("UPDATE rea_t307.restore_witness SET restore_generation='forged'"), { code: "42501" });
  await client.query("ROLLBACK");
  await assert.rejects(client.query("DELETE FROM dream.project_assets"), { code: "42501" });
  await assert.rejects(client.query("SELECT rea_t281.owner_permission(true)"), { code: "42501" });
  await assert.rejects(client.query("SELECT rea_t281.change_link(NULL,NULL,NULL,NULL,NULL,NULL)"), { code: "42501" });
  await assert.rejects(client.query("SET ROLE dream_api"), { code: "42501" });
  await assert.rejects(client.query("SET ROLE t281_operator"), { code: "42501" });
}

async function waitFor(admin, predicate, expected = true) {
  for (let i = 0; i < 100; i++) {
    const row = await first(admin, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='t307-studio-authority' AND ${predicate}) AS ok`);
    if (row.ok === expected) return;
    await delay(15);
  }
  assert.fail("Reader backend did not reach the expected PostgreSQL state");
}

async function proveStartupRoleLimits(admin) {
  const logPath = join(root, "postgres.log");
  // Log this fixture login's SQL so each rejected startup proves the role
  // check ran and no authority statement reached the database.
  await admin.query(`ALTER ROLE ${login} SET log_statement='all'`);
  try {
    for (const role of [login, readerRole]) {
      const attributes = ["CREATEDB", "CREATEROLE", "BYPASSRLS", "SUPERUSER", "REPLICATION"];
      if (role === readerRole) attributes.push("LOGIN");
      for (const attribute of attributes) {
        await admin.query(`ALTER ROLE ${role} ${attribute}`);
        try {
          const offset = (await readFile(logPath)).length;
          const rejected = await openIsolatedStudioAnalysisAuthorityStore(options);
          if (rejected) stores.push(rejected);
          assert.equal(rejected, undefined, `${role} with ${attribute} must be rejected`);
          await waitFor(admin, "true", false);
          const statements = (await readFile(logPath)).subarray(offset).toString("utf8");
          assert.match(statements, /SELECT current_database\(\) AS db, session_user AS login/);
          assert.doesNotMatch(statements, /FROM dream\.project_assets l/);
        } finally {
          await admin.query(`ALTER ROLE ${role} NO${attribute}`);
        }
        const restored = await openIsolatedStudioAnalysisAuthorityStore(options);
        assert(restored, `${role} must be accepted after removing ${attribute}`);
        stores.push(restored);
        assert.deepEqual(await restored.listAnalyzableMaterials(actorA), []);
        await restored.close();
        await waitFor(admin, "true", false);
      }
    }
  } finally {
    await admin.query(`ALTER ROLE ${login} RESET log_statement`);
  }
  console.log("Startup rejected individual excess attributes on both roles, issued no authority query and recovered after each reset");
}

async function exercise(admin) {
  await proveStartupRoleLimits(admin);
  const store = await openIsolatedStudioAnalysisAuthorityStore(options);
  assert(store);
  stores.push(store);
  await proveRole();
  await admin.query("ALTER TABLE rea_t307.asset_witness DISABLE ROW LEVEL SECURITY");
  assert.equal(await openIsolatedStudioAnalysisAuthorityStore(options), undefined);
  await admin.query("ALTER TABLE rea_t307.asset_witness ENABLE ROW LEVEL SECURITY");
  assert.equal(await openIsolatedStudioAnalysisAuthorityStore(), undefined);
  assert.equal(await openIsolatedStudioAnalysisAuthorityStore({ ...options, profile: "managed" }), undefined);
  assert.deepEqual(await store.listAnalyzableMaterials(actorA), []);
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  await ownerPermission(admin, ownerA, true);
  await ownerPermission(admin, ownerB, true);
  await scopePermission(admin, ownerA, projectA, assetA, true);
  await scopePermission(admin, ownerA, projectA, assetA2, true);
  await scopePermission(admin, ownerB, projectB, assetB, true);

  const before = await store.readAuthority(actorA, selectA, fresh());
  const boundB = await store.readAuthority(actorB, selectB, fresh());
  assert.equal(before.status, "authorized");
  assert.equal(before.asset.kind, "image");
  assert.equal(before.linkGeneration, "0");
  assert.equal(before.verifiedStorageGeneration, "1");
  assert.equal(boundB.asset.kind, "video");
  assert.equal(await store.readAuthority(actorB, selectA, fresh()), undefined);
  assert.equal(await store.readAuthority(actorA, selectB, fresh()), undefined);
  assert.equal(await store.readAuthority(actorA, { projectId: projectA, assetId: assetA2 }, fresh()), undefined);
  assert.equal(await store.readAuthority(actorA, { ...selectA, ownerId: ownerA }, fresh()), undefined);
  await assert.rejects(store.listAnalyzableMaterials({ id: ownerA }), unavailable);
  const list = await store.listAnalyzableMaterials(actorA);
  assert.deepEqual(list, [{ ownerId: ownerA, ...selectA, label: "등록 이미지 · 00000086", registration: "current", analysisAllowed: true }]);
  assert.deepEqual((await store.listAnalyzableMaterials(actorB)).map(row => row.assetId), [assetB]);
  const page = await loadStudioRegisteredAnalysisPage({
    resolveAuth: async () => ({ kind: "verified", userId: ownerA, email: "synthetic@example.test" }),
    connection: { analysisApiConnected: true, listAnalyzableMaterials: store.listAnalyzableMaterials },
  });
  assert.deepEqual(page, { kind: "connected", materials: [{ ...selectA, label: list[0].label }] });
  assert(!JSON.stringify(page).includes(before.asset.objectKey) && !JSON.stringify(page).includes(before.asset.sha256));

  const limited = await openIsolatedStudioAnalysisAuthorityStore({ ...options, maxBytes: 7 });
  const wrongBucket = await openIsolatedStudioAnalysisAuthorityStore({ ...options, bucket: "other-bucket" });
  assert(limited && wrongBucket);
  stores.push(limited, wrongBucket);
  assert.deepEqual(await limited.listAnalyzableMaterials(actorA), []);
  assert.equal(await wrongBucket.readAuthority(actorA, selectA, fresh()), undefined);
  await limited.close();
  await wrongBucket.close();

  await scopePermission(admin, ownerA, projectA, assetA, false);
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  await scopePermission(admin, ownerA, projectA, assetA, true);
  assert.notEqual((await store.readAuthority(actorA, selectA, fresh())).scopePermissionGeneration, before.scopePermissionGeneration);
  await link(admin, purpose, "generated-output");
  assert.deepEqual(await store.listAnalyzableMaterials(actorA), []);
  await link(admin, "generated-output", purpose);
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  await scopePermission(admin, ownerA, projectA, assetA, true);
  assert.notEqual((await store.readAuthority(actorA, selectA, fresh())).linkGeneration, before.linkGeneration);
  await ownerPermission(admin, ownerA, false);
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  assert.deepEqual(await store.readAuthority(actorB, selectB, fresh()), boundB);
  await ownerPermission(admin, ownerA, true);
  assert.deepEqual(await store.listAnalyzableMaterials(actorA), []);
  await scopePermission(admin, ownerA, projectA, assetA, true);
  assert.notEqual((await store.readAuthority(actorA, selectA, fresh())).ownerPermissionGeneration, before.ownerPermissionGeneration);

  await admin.query("UPDATE rea_t307.restore_witness SET restore_generation='restore-2'");
  assert.deepEqual(await store.listAnalyzableMaterials(actorA), []);
  assert.equal(await store.readAuthority(actorB, selectB, fresh()), undefined);
  await admin.query(`UPDATE rea_t307.asset_witness SET restore_generation='restore-2', source_generation='source-new'
    WHERE owner_id=$1`, [ownerA]);
  const rebound = await store.readAuthority(actorA, selectA, fresh());
  assert.equal(rebound.restoreGeneration, "restore-2");
  assert.equal(rebound.sourceGeneration, "source-new");
  await admin.query("UPDATE rea_t307.asset_witness SET storage_generation=2 WHERE asset_id=$1", [assetA]);
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  await admin.query("UPDATE rea_t307.asset_witness SET storage_generation=1, not_after=now() WHERE asset_id=$1", [assetA]);
  assert.deepEqual(await store.listAnalyzableMaterials(actorA), []);
  await admin.query("UPDATE rea_t307.asset_witness SET not_after=now()+interval '1 hour' WHERE asset_id=$1", [assetA]);
  await admin.query("UPDATE rea_t307.restore_witness SET not_after=now()");
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  await admin.query("UPDATE rea_t307.restore_witness SET not_after=now()+interval '1 hour'");

  const lock = await connect();
  await lock.query("BEGIN; LOCK rea_t307.restore_witness IN ACCESS EXCLUSIVE MODE");
  const observed = store.readAuthority(actorA, selectA, fresh());
  void observed.catch(() => {});
  await waitFor(admin, "wait_event_type='Lock'");
  await scopePermission(admin, ownerA, projectA, assetA, false);
  await lock.query("COMMIT");
  assert.deepEqual(await observed, rebound);
  assert.equal(await store.readAuthority(actorA, selectA, fresh()), undefined);
  await scopePermission(admin, ownerA, projectA, assetA, true);

  await admin.query("UPDATE rea_t307.restore_witness SET not_after=now()+interval '350 milliseconds'");
  await lock.query("BEGIN; LOCK rea_t307.restore_witness IN ACCESS EXCLUSIVE MODE");
  const expiring = store.readAuthority(actorA, selectA, fresh());
  void expiring.catch(() => {});
  await waitFor(admin, "wait_event_type='Lock'");
  await admin.query("SELECT pg_sleep(0.4)");
  await lock.query("COMMIT");
  assert.equal(await expiring, undefined);
  await admin.query("UPDATE rea_t307.restore_witness SET not_after=now()+interval '1 hour'");

  const short = await openIsolatedStudioAnalysisAuthorityStore({ ...options, timeoutMs: 750 });
  assert(short);
  stores.push(short);
  await lock.query("BEGIN; LOCK rea_t307.restore_witness IN ACCESS EXCLUSIVE MODE");
  const cancel = new AbortController();
  const request = store.readAuthority(actorA, selectA, cancel.signal);
  const aborted = assert.rejects(request, unavailable);
  await waitFor(admin, "wait_event_type='Lock'");
  cancel.abort("synthetic cancellation data");
  await aborted;
  await assert.rejects(store.readAuthority(actorA, selectA, cancel.signal), unavailable);
  await assert.rejects(short.listAnalyzableMaterials(actorA), unavailable);
  await lock.query("COMMIT");
  assert.equal((await store.readAuthority(actorA, selectA, fresh())).status, "authorized");
  assert.equal((await short.listAnalyzableMaterials(actorA)).length, 1);
  assert.deepEqual(await first(admin, `SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE application_name='t307-studio-authority' AND state='idle in transaction'`), { count: 0 });
  await admin.query(`UPDATE rea_t307.asset_witness SET restore_generation='restore-2',
    source_generation='source-b-restore-2' WHERE asset_id=$1`, [assetB]);
  assert.equal((await store.readAuthority(actorB, selectB, fresh())).status, "authorized");
  await admin.query(`UPDATE dream.asset_receipt_state SET status='revoked',
    revision=revision+1,updated_at=now(),
    revocation_history_json=jsonb_build_array(jsonb_build_object('revision',revision+1,
      'at',floor(extract(epoch FROM now())*1000)::bigint,'kind','manual','operationId',NULL,
      'principalId',owner_id::text,'authorizers',jsonb_build_array(owner_id::text)))::text
    WHERE asset_id=$1`, [assetB]);
  assert.equal(await store.readAuthority(actorB, selectB, fresh()), undefined);
  await admin.query("DELETE FROM rea_t307.asset_witness WHERE asset_id=$1", [assetA]);
  assert.deepEqual(await store.listAnalyzableMaterials(actorA), []);
  await admin.query("DROP TABLE rea_t307.asset_witness");
  await assert.rejects(store.listAnalyzableMaterials(actorA), unavailable);
  assert.equal(await openIsolatedStudioAnalysisAuthorityStore(options), undefined);
  await store.close();
  await short.close();
  await assert.rejects(store.listAnalyzableMaterials(actorA), unavailable);
  await waitFor(admin, "true", false);
  assert.deepEqual(await first(admin, `SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE application_name='t307-studio-authority'`), { count: 0 });
  console.log("PG17 authority, original storage guards, role/RLS, snapshot, expiry, projection, deadline and cancellation passed");
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
  if (process.env.STUDIO_ANALYSIS_VERIFY_NEXT === "1") {
    // Front: 실제 Next 보호 셸 격리 빌드가 붙는 등록 MP4 공급원(PG17·저장소·제어). 화면 판정은 브라우저 조작이 보고한다.
    const { makeVideos } = await import("./studio-protected-video-browser.pg17.ts");
    const { serveVideoNextFixture } = await import("./studio-protected-video-next.pg17.ts");
    const videos = await makeVideos(root, assetA, assetB);
    await seed(admin, videos, new Set(videos.keys()));
    await serveVideoNextFixture({ admin, root, options, images: videos, ownerA, ownerB, selectA, selectB, ownerPermission, scopePermission });
  } else if (process.env.STUDIO_ANALYSIS_VERIFY_VIDEO_BROWSER === "1") {
    // Front: 보호 목록 → 권리 확인 → 등록 MP4 분석(프레임·장면 전환)·철회·계정 격리의 실제 브라우저 통합.
    const { makeVideos, verifyProtectedVideoBrowser } = await import("./studio-protected-video-browser.pg17.ts");
    const videos = await makeVideos(root, assetA, assetB);
    await seed(admin, videos, new Set(videos.keys()));
    await verifyProtectedVideoBrowser({ admin, root, options, images: videos, ownerA, ownerB, selectA, selectB, ownerPermission, scopePermission });
  } else if (process.env.STUDIO_ANALYSIS_VERIFY_BROWSER === "1") {
    // Front: 보호 목록 → 권리 확인 → 등록 PNG 분석의 실제 브라우저 통합(외부 브라우저 조작을 기다린다).
    const { makeImages } = await import("./studio-analysis-connection.pg17.ts");
    const { verifyProtectedMaterialsBrowser } = await import("./studio-protected-materials-browser.pg17.ts");
    const images = await makeImages(assetA, assetB);
    await seed(admin, images);
    await verifyProtectedMaterialsBrowser({ admin, root, options, images, ownerA, ownerB, selectA, selectB, ownerPermission, scopePermission });
  } else if (process.env.STUDIO_ANALYSIS_VERIFY_CONNECTION === "1") {
    const { makeImages, verifyConnection } = await import("./studio-analysis-connection.pg17.ts");
    const images = await makeImages(assetA, assetB);
    await seed(admin, images);
    await verifyConnection({ admin, root, options, images, ownerA, ownerB, selectA, selectB, ownerPermission, scopePermission });
  } else {
    await seed(admin);
    await exercise(admin);
  }
} finally {
  await Promise.allSettled(stores.map(store => store.close()));
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
  if (startAttempted) await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T307_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Unexpected remaining listener' }`, { T307_PORT: String(port) });
  const resolved = await realpath(root);
  assert(samePath(dirname(resolved), temp) && basename(resolved).startsWith("dream-t307-"), "Unsafe cleanup target");
  await rm(resolved, { recursive: true, force: false });
  console.log("Owned PG17 process stopped, listener and temporary cluster removed");
}
