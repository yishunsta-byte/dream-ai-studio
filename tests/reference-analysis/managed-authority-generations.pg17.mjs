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
  await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T281_TOOL
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
  { T281_TOOL: path });
  const { stdout } = await exec(path, ["--version"], { env, windowsHide: true, timeout: 10_000 });
  assert.match(stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const manifest = [
  ["0001_schema", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
  ["0005_upload_reservation", "f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339"],
];
const sources = [];
for (const [name, checksum] of manifest) {
  const sql = (await readFile(new URL("../../lib/db/postgres/" + name + ".sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"), checksum, "Fixed source mismatch: " + name);
  sources.push(sql);
}
const candidate = await readFile(new URL("managed-authority-generations.sql", import.meta.url), "utf8");

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t281-"));
const data = join(root, "cluster");
const port = await freePort();
const password = randomBytes(24).toString("hex");
const passfile = join(root, "bootstrap-password");
const dbName = "dream_test_t281";
const adminUser = "t281_bootstrap";
const ownerA = "10000000-0000-4000-8000-000000000081";
const ownerD = "10000000-0000-4000-8000-000000000092";
const ownerC = "10000000-0000-4000-8000-000000000089";
const projectC = "10000000-0000-4000-8000-000000000090";
const assetC = "10000000-0000-4000-8000-000000000091";
const ownerB = "10000000-0000-4000-8000-000000000082";
const projectA = "10000000-0000-4000-8000-000000000083";
const projectA2 = "10000000-0000-4000-8000-000000000084";
const projectB = "10000000-0000-4000-8000-000000000085";
const assetA = "10000000-0000-4000-8000-000000000086";
const assetA2 = "10000000-0000-4000-8000-000000000087";
const assetB = "10000000-0000-4000-8000-000000000088";
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
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T281_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T281_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T281_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T281_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T281_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T281_PID: String(pid), T281_PG: join(bin, "postgres.exe"), T281_DATA: data, T281_PORT: String(port) });
}

async function connect(user = adminUser, database = dbName) {
  const client = new Client({
    host: "127.0.0.1", port, user, password, database, ssl: false, connectionTimeoutMillis: 2_500,
    statement_timeout: 8_000, application_name: "t281-synthetic",
  });
  clients.add(client);
  await client.connect();
  return client;
}
async function begin(client, role, actor) {
  const roles = { api: "SET LOCAL ROLE dream_api", operator: "SET LOCAL ROLE t281_operator", worker: "SET LOCAL ROLE dream_worker" };
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query(roles[role]);
  await client.query("SELECT set_config('dream.actor_id',$1,true)", [actor]);
}
async function inActor(client, role, actor, work) {
  await begin(client, role, actor);
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

const first = async (client, sql, args = []) => (await client.query(sql, args)).rows[0];
const setOwner = (client, enabled) => first(client, "SELECT rea_t281.owner_permission($1) AS ok", [enabled]);
const setScope = (client, project, asset, enabled) =>
  first(client, "SELECT rea_t281.scope_permission($1,$2,$3) AS ok", [project, asset, enabled]);
const link = (client, oldSide, newSide) => first(client,
  "SELECT rea_t281.change_link($1,$2,$3,$4,$5,$6) AS ok", [...(oldSide ?? [null,null,null]), ...(newSide ?? [null,null,null])]);
const state = (client, owner, project, asset) => first(client,
  `SELECT o.enabled,o.generation,g.active,g.link_generation,g.permission_generation
    FROM rea_t281.owner_state o LEFT JOIN rea_t281.scope_state g
    ON g.owner_id=o.owner_id AND g.project_id=$2 AND g.asset_id=$3 WHERE o.owner_id=$1`, [owner, project, asset]);
const snapshot = async client => ({
  owners: (await client.query("SELECT * FROM rea_t281.owner_state ORDER BY owner_id")).rows,
  scopes: (await client.query("SELECT * FROM rea_t281.scope_state ORDER BY owner_id,project_id,asset_id")).rows,
  links: (await client.query("SELECT * FROM dream.project_assets ORDER BY owner_id,project_id,asset_id,purpose")).rows,
});
const errorCode = code => error => error?.code === code;

async function blockedBy(admin, waiter, blocker) {
  for (let i = 0; i < 40; i++) {
    const value = await first(admin, "SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked", [blocker.processID, waiter.processID]);
    if (value.blocked) return;
    await delay(25);
  }
  throw new Error("Expected a native block on the owner lock");
}

async function race(admin, a, b, actor, operation, winnerRollsBack = false) {
  await begin(a, "operator", actor);
  await begin(b, "operator", actor);
  assert.deepEqual(await operation(a), { ok: true });
  const waiting = operation(b);
  void waiting.catch(() => {});
  await blockedBy(admin, b, a);
  await a.query(winnerRollsBack ? "ROLLBACK" : "COMMIT");
  assert.deepEqual(await waiting, { ok: winnerRollsBack });
  await b.query("COMMIT");
}
async function seed(admin) {
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await admin.query("INSERT INTO auth.users VALUES($1),($2),($3),($4)", [ownerA, ownerB, ownerC, ownerD]);
  for (const sql of sources.slice(0, 4)) await admin.query(sql);
  assert.equal((await first(admin, "SHOW server_version_num")).server_version_num, "170012");

  await admin.query("CREATE ROLE t281_migration NOLOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS");
  await admin.query("SET ROLE t281_migration");
  const preflight = await first(admin, `SELECT oid::text, rolcreaterole AND NOT rolsuper AND NOT rolbypassrls AS allowed
    FROM pg_roles WHERE rolname=current_user`);
  assert(preflight.allowed);
  await admin.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false), set_config('dream.b27_expected_pg_major','18',false)", [preflight.oid]);
  await assert.rejects(admin.query(sources[4]), { message: "B27_PREFLIGHT_UNVERIFIED" });
  await admin.query("ROLLBACK; RESET ROLE");
  assert.deepEqual(await first(admin, `SELECT to_regnamespace('dream_reservation') IS NULL AS no_schema,
    to_regrole('dream_upload_reserver') IS NULL AS no_role`), { no_schema: true, no_role: true });
  console.log("SQL5 unchanged: PG17 B27_PREFLIGHT_UNVERIFIED; no reservation schema or role");

  for (const [owner, id] of [[ownerA,projectA],[ownerA,projectA2],[ownerB,projectB],[ownerC,projectC]]) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
      title,goal,target,aspect,length_sec,created_at,updated_at)
      VALUES($1,$2,'probe','1','{}','{}','synthetic','synthetic','synthetic','16:9',10,now(),now())`, [owner,id]);
  }
  for (const [owner, id] of [[ownerA,assetA],[ownerA,assetA2],[ownerB,assetB],[ownerC,assetC]]) {
    await admin.query(`INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,size_bytes,sha256,origin,created_at)
      VALUES($1,$2,'video','synthetic','original',$3,'video/mp4',8,$4,'upload',now())`,
    [owner,id,owner + "/" + id + ".mp4", "a".repeat(64)]);
  }
  await admin.query("INSERT INTO dream.project_assets VALUES($1,$2,$3,'rea-reference')", [ownerA,projectA,assetA]);
  await admin.query("SET rea_t281.synthetic='on'");
  await admin.query(candidate);
  for (const [login, role] of [["t281_api_login","dream_api"], ["t281_operator_login","t281_operator"], ["t281_worker_login","dream_worker"]]) {
    await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}';
      GRANT ${role} TO ${login} WITH INHERIT FALSE, SET TRUE`);
  }
}

async function exercise(admin) {
  const api = await connect("t281_api_login");
  const operator = await connect("t281_operator_login");
  const operator2 = await connect("t281_operator_login");
  const worker = await connect("t281_worker_login");
  const useApi = (actor, callback) => inActor(api, "api", actor, callback);
  const useOperator = (actor, callback) => inActor(operator, "operator", actor, callback);
  const a = [projectA,assetA,purpose];
  const moved = [projectA2,assetA2,purpose];
  const b = [projectB,assetB,purpose];
  assert.deepEqual(await state(admin,ownerA,projectA,assetA), {
    enabled: false, generation: "0", active: false, link_generation: "0", permission_generation: "0",
  });
  assert.equal(await state(admin,ownerB,projectB,assetB), undefined);
  const initial = await snapshot(admin);
  assert.deepEqual(await useOperator(ownerB, c => setScope(c,projectB,assetB,true)), { ok: false });
  assert.deepEqual(await useOperator(ownerB, c => setScope(c,projectB,assetB,false)), { ok: false });
  assert.deepEqual(await useOperator(ownerB, c => setOwner(c,false)), { ok: false });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA,assetA,true)), { ok: false });
  assert.deepEqual(await snapshot(admin), initial);
  console.log("Denied permission on absent/existing owner and missing link: all rows unchanged");

  const locker = await connect();
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM dream.projects WHERE id = $1 FOR UPDATE", [projectC]);
  await begin(operator,"operator",ownerC);
  const denied = setScope(operator,projectC,assetC,true);
  void denied.catch(() => {});
  await blockedBy(admin,operator,locker);
  await begin(operator2,"operator",ownerC);
  const approved = setOwner(operator2,true);
  void approved.catch(() => {});
  await blockedBy(admin,operator2,operator);
  await locker.query("COMMIT");
  assert.deepEqual(await denied, { ok: false });
  // The denied caller keeps its outer transaction open; the inner rollback must release its lock.
  assert.deepEqual(await approved, { ok: true });
  assert.deepEqual(await snapshot(admin), initial);
  await operator2.query("COMMIT");
  await operator.query("COMMIT");
  assert.deepEqual(await state(admin,ownerC,projectC,assetC), {
    enabled: true, generation: "1", active: null, link_generation: null, permission_generation: null,
  });
  const c = [projectC,assetC,purpose];
  assert.deepEqual(await useApi(ownerC, db => link(db,null,c)), { ok: true });
  await race(admin, operator, operator2, ownerC, db => setScope(db,projectC,assetC,true), true);
  assert.deepEqual(await state(admin,ownerC,projectC,assetC), {
    enabled: true, generation: "1", active: true, link_generation: "1", permission_generation: "1",
  });
  await race(admin, operator, operator2, ownerD, db => setOwner(db,true), true);
  assert.deepEqual(await first(admin, "SELECT enabled,generation FROM rea_t281.owner_state WHERE owner_id=$1", [ownerD]),
    { enabled: true, generation: "1" });
  console.log("Native denied-vs-first-approval wait and owner/scope winner rollback handoff: passed");

  await race(admin, operator, operator2, ownerB, c => setOwner(c,true));
  assert.deepEqual(await useApi(ownerB, c => link(c,null,b)), { ok: true });
  await race(admin, operator, operator2, ownerB, c => setScope(c,projectB,assetB,true));
  assert.deepEqual(await state(admin,ownerB,projectB,assetB), {
    enabled: true, generation: "1", active: true, link_generation: "1", permission_generation: "1",
  });
  const bBefore = await state(admin,ownerB,projectB,assetB);
  console.log("Inactive baseline and real concurrent first owner/scope approval: passed");

  await useApi(ownerA, async c => {
    assert.deepEqual((await c.query("SELECT owner_id FROM rea_t281.owner_state")).rows, [{ owner_id: ownerA }]);
    assert.equal((await c.query("SELECT * FROM rea_t281.scope_state WHERE owner_id = $1",[ownerB])).rowCount, 0);
  });
  await useApi(ownerB, async c => {
    assert.deepEqual((await c.query("SELECT owner_id FROM rea_t281.scope_state")).rows, [{ owner_id: ownerB }]);
  });
  const beforeDenials = await snapshot(admin);
  await assert.rejects(useApi(ownerA, c => link(c,null,b)), errorCode("42501"));
  await assert.rejects(useOperator(ownerA, c => setScope(c,projectB,assetB,true)), errorCode("42501"));
  await assert.rejects(useApi(ownerA, c => setOwner(c,true)), errorCode("42501"));
  await assert.rejects(useApi(ownerA, c => c.query("UPDATE dream.project_assets SET purpose = 'input'")), errorCode("42501"));
  await assert.rejects(useApi(ownerA, c => c.query("UPDATE dream.projects SET archived_at = now()")), errorCode("42501"));
  await assert.rejects(useApi(ownerA, c => c.query("UPDATE rea_t281.owner_state SET enabled = true")), errorCode("42501"));
  await assert.rejects(inActor(worker,"worker",ownerA,c => c.query("DELETE FROM dream.project_assets")), errorCode("42501"));
  await assert.rejects(inActor(worker,"worker",ownerA,c => c.query("INSERT INTO dream.project_assets SELECT * FROM dream.project_assets")), errorCode("42501"));
  await assert.rejects(inActor(worker,"worker",ownerA,c => c.query("UPDATE dream.assets SET archived_at = now()")), errorCode("42501"));
  assert.deepEqual(await snapshot(admin), beforeDenials);
  await api.query("BEGIN; SET LOCAL ROLE dream_api");
  await assert.rejects(link(api,null,a), errorCode("42501"));
  await api.query("ROLLBACK");
  assert.equal((await first(admin, `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
    WHERE s.nspname='rea_t281' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity`)).n, 2);
  assert.deepEqual(await first(admin, `SELECT
    has_function_privilege('dream_api','rea_t281.lock_owner()','EXECUTE') AS helper,
    has_function_privilege('dream_worker','rea_t281.change_link(uuid,uuid,text,uuid,uuid,text)','EXECUTE') AS worker_change,
    has_table_privilege('t281_operator','rea_t281.scope_state','UPDATE') AS operator_raw`),
  { helper: false, worker_change: false, operator_raw: false });
  console.log("Two actors, real role logins, forced RLS and direct-DML denial: passed");

  assert.deepEqual(await useOperator(ownerA, c => setOwner(c,true)), { ok: true });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA,assetA,true)), { ok: true });
  assert.deepEqual(await useApi(ownerA, c => link(c,null,[projectA,assetA,"input"])), { ok: true });
  const enabledA = await state(admin,ownerA,projectA,assetA);
  assert.deepEqual(await useApi(ownerA, c => link(c,[projectA,assetA,"input"],null)), { ok: true });
  assert.deepEqual(await state(admin,ownerA,projectA,assetA), enabledA);
  await useApi(ownerA, async c => {
    assert.deepEqual(await link(c,a,null), { ok: true });
    assert.deepEqual(await link(c,null,a), { ok: true });
  });
  assert.deepEqual(await state(admin,ownerA,projectA,assetA), { ...enabledA, active: false, link_generation: "2" });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA,assetA,true)), { ok: true });

  assert.deepEqual(await useApi(ownerA, c => link(c,null,moved)), { ok: true });
  const beforeFailure = await snapshot(admin);
  await assert.rejects(useApi(ownerA, c => link(c,a,moved)), errorCode("23505"));
  assert.deepEqual(await snapshot(admin), beforeFailure);
  assert.deepEqual(await useApi(ownerA, c => link(c,moved,null)), { ok: true });
  assert.deepEqual(await useApi(ownerA, c => link(c,a,moved)), { ok: true });
  assert.deepEqual(await state(admin,ownerA,projectA,assetA), {
    enabled: true, generation: "1", active: false, link_generation: "3", permission_generation: "2",
  });
  assert.deepEqual(await state(admin,ownerA,projectA2,assetA2), {
    enabled: true, generation: "1", active: false, link_generation: "3", permission_generation: "0",
  });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA,assetA,true)), { ok: false });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA2,assetA2,true)), { ok: true });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA2,assetA2,false)), { ok: true });
  assert.deepEqual(await state(admin,ownerA,projectA2,assetA2), {
    enabled: true, generation: "1", active: false, link_generation: "3", permission_generation: "2",
  });
  assert.deepEqual(await useOperator(ownerA, c => setScope(c,projectA2,assetA2,true)), { ok: true });
  assert.deepEqual(await useOperator(ownerA, c => setOwner(c,false)), { ok: true });
  assert.deepEqual(await useOperator(ownerA, c => setOwner(c,true)), { ok: true });
  assert.deepEqual(await state(admin,ownerA,projectA2,assetA2), {
    enabled: true, generation: "3", active: false, link_generation: "3", permission_generation: "4",
  });
  assert.deepEqual(await state(admin,ownerB,projectB,assetB), bBefore);
  console.log("Unlink/relink, both-side move, approval/revocation and failed destination rollback: passed");
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
  if (startAttempted) await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T281_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Unexpected remaining listener' }`, { T281_PORT: String(port) });
  const resolved = await realpath(root);
  assert(samePath(dirname(resolved), temp) && basename(resolved).startsWith("dream-t281-"), "Unsafe cleanup target");
  await rm(resolved, { recursive: true, force: false });
  console.log("Owned PG17 process stopped, listener and temporary cluster removed");
}
