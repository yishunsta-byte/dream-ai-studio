/* global console, process, URL, setTimeout */
// P2 managed scene result as one bounded database operation (candidate 0002) on an isolated local PostgreSQL 17 with TLS.
// The 0001 candidate file is pinned unchanged; 0002 moves every write behind dream_scene_result.register().
// Run (cwd = repo): P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/managed-scene-result-transaction.pg17.mjs
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { checkServerIdentity } from "node:tls";
import { promisify } from "node:util";
import pg from "pg";
import { v7 } from "uuid";
import { fixturePolicy, registeredAsset } from "./managed-project-core-asset-fixture.mjs";

const run = promisify(execFile);
const loopback = "127.0.0.1", projectRef = "abcdefghijklmnopqrst", dbHost = "db." + projectRef + ".supabase.co";
const rootPath = new URL("../../", import.meta.url);
const bin = await realpath(process.env.P102_PG_BIN ?? "");
const openssl = process.env.P102_OPENSSL || join(process.env.ProgramFiles, "Git", "usr", "bin", "openssl.exe");
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP|PATH)$/i.test(name)));
const exec = (file, args) => run(file, args, { env, windowsHide: true, timeout: 120_000 });
const pgExec = (name, args) => exec(join(bin, name + ".exe"), args);
for (const name of ["initdb", "pg_ctl", "postgres"]) assert.match((await pgExec(name, ["--version"])).stdout, /\(PostgreSQL\) 17\./);
const digest = text => createHash("sha256").update(text).digest("hex");
const tsModule = path => import(new URL(path, rootPath).href);
const { withActorTransaction } = await tsModule("lib/db/postgres/transaction.ts");
const { actorFromVerifiedUserId } = await tsModule("lib/db/postgres/types.ts");
const { registerManagedSceneResult, sceneResultSession, isSceneResultError } = await tsModule("lib/cloud/managed-scene-result.ts");

// Fixed sources: existing files must match their published hashes; the candidate file is reported.
const sql = async file => (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
const pinned = [
  ["0001_schema.sql", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification.sql", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
  ["managed-project-core/0001_install.sql", "c4e4bc131d2816e6107f0cff4033d8dc7b20825ccd56a6e40e8f6069f3546182"],
  ["managed-scene-result/0001_install.sql", "8201ea90addca44cc16b9eba4d852ceaeaef2133e5bafbe89b0cbba478c8a441"],
];
const sources = {};
for (const [file, hash] of pinned) { sources[file] = await sql(file); assert.equal(digest(sources[file]), hash, file); }
for (const file of ["managed-project-core/0002_asset_choices.sql", "managed-project-plan/0001_install.sql", "managed-project-plan/0002_approval.sql", "managed-scene-result/0002_transaction.sql"]) sources[file] = await sql(file);
const sourceHashes = Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, digest(text)]));
const out = (name, value) => console.log(JSON.stringify({ check: name, ...value }));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, loopback, resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent, "dream-p2tx-"));
const data = join(root, "cluster"), password = randomBytes(28).toString("hex"), port = await freePort();
let started = false, admin, pool;
try {
  const pw = join(root, "bootstrap.txt");
  await writeFile(pw, password + "\n", { flag: "wx" });
  await pgExec("initdb", ["-D", data, "--username=p102_root", "--pwfile=" + pw, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
  await rm(pw);
  const ca = join(data, "server.crt"), key = join(data, "server.key"), cfg = join(root, "openssl.cnf");
  await writeFile(cfg, "[req]\ndistinguished_name=dn\n[dn]\n");
  await exec(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "1", "-config", cfg, "-subj", "/CN=P2 scene result isolated",
    "-addext", "subjectAltName=IP:" + loopback + ",DNS:" + dbHost, "-keyout", key, "-out", ca]);
  started = true;
  const output = await open(join(root, "pg-start.log"), "wx");
  try {
    await new Promise((resolve, reject) => {
      const server = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-o", "-h " + loopback + " -p " + port + " -c ssl=on", "-w", "-t", "30", "start"],
        { env, windowsHide: true, stdio: ["ignore", output.fd, output.fd], timeout: 40_000 });
      server.once("error", reject);
      server.once("exit", code => code === 0 ? resolve() : reject(new Error("Local PostgreSQL startup failed.")));
    });
  } finally { await output.close(); }
  const cert = await readFile(ca, "utf8");
  const ssl = { ca: cert, servername: dbHost, rejectUnauthorized: true, checkServerIdentity };
  const connect = async (user, secret = password) => { const c = new pg.Client({ host: loopback, port, database: "postgres", user, password: secret, ssl, connectionTimeoutMillis: 5000, query_timeout: 15000 }); await c.connect(); return c; };
  admin = await connect("p102_root");
  const { rows: [transport] } = await admin.query("SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl");
  assert.equal(transport.version, admin.connection.stream.getProtocol());

  // Install as a non-superuser migration owner, in the published order.
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE authenticator NOLOGIN");
  await admin.query("CREATE ROLE p102_migrate NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS CREATEROLE; GRANT CREATE ON DATABASE postgres TO p102_migrate; GRANT USAGE ON SCHEMA auth TO p102_migrate; GRANT REFERENCES ON auth.users TO p102_migrate");
  const install = async (file, settings = {}) => {
    await admin.query("SET ROLE p102_migrate");
    try {
      for (const [name, value] of Object.entries(settings)) await admin.query("SELECT set_config($1,$2,false)", [name, value]);
      assert.equal((await admin.query(sources[file])).at(-1).command, "COMMIT", file);
    } catch (error) { await admin.query("ROLLBACK").catch(() => {}); throw error; }
    finally { await admin.query("RESET ROLE"); }
  };
  for (const file of ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql", "0004_storage_verification.sql"]) await install(file);
  await install("managed-project-core/0001_install.sql", { "dream.project_core.install_ref": projectRef });
  await install("managed-project-core/0002_asset_choices.sql", { "dream.project_core.install_ref": projectRef });
  const planSettings = { "dream.managed_plan.install_ref": projectRef, "dream.managed_plan.install_database": "postgres" };
  await install("managed-project-plan/0001_install.sql", planSettings);
  await install("managed-project-plan/0002_approval.sql", planSettings);

  // ACL / policy / role snapshot of everything that existed before the candidate (candidate role filtered out).
  const aclSnapshot = async () => (await admin.query(`WITH f AS (SELECT '^dream_scene_result_(app|writer)=' AS skip)
    SELECT jsonb_build_object(
      'relations', (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text,
          ARRAY(SELECT x::text FROM unnest(coalesce(c.relacl,'{}'::aclitem[])) x WHERE x::text !~ (SELECT skip FROM f) ORDER BY 1)) ORDER BY n.nspname,c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials','auth')),
      'columns', (SELECT jsonb_agg(row ORDER BY row) FROM (SELECT jsonb_build_array(n.nspname,c.relname,a.attname,
          ARRAY(SELECT x::text FROM unnest(a.attacl) x WHERE x::text !~ (SELECT skip FROM f) ORDER BY 1)) AS row
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials') AND a.attnum>0 AND a.attacl IS NOT NULL
          AND EXISTS (SELECT FROM unnest(a.attacl) x WHERE x::text !~ (SELECT skip FROM f))) s),
      'policies', (SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,
          (SELECT array_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid=ANY(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
          ORDER BY c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE NOT EXISTS (SELECT FROM pg_roles r WHERE r.oid=ANY(p.polroles) AND r.rolname IN ('dream_scene_result_app','dream_scene_result_writer'))),
      'roles', (SELECT jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb) ORDER BY rolname) FROM pg_roles
        WHERE rolname NOT IN ('dream_scene_result_app','dream_scene_result_writer') AND rolname NOT LIKE 'pg\\_%'),
      'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname,ARRAY(SELECT x::text FROM unnest(coalesce(nspacl,'{}'::aclitem[])) x WHERE x::text !~ (SELECT skip FROM f) ORDER BY 1)) ORDER BY nspname)
        FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema','dream_scene_result')),
      'functions', (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,ARRAY(SELECT x::text FROM unnest(coalesce(p.proacl,'{}'::aclitem[])) x WHERE x::text !~ (SELECT skip FROM f) ORDER BY 1)) ORDER BY 1)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('dream','managed_project_plan')),
      'types', (SELECT jsonb_agg(jsonb_build_array(t.typname,ARRAY(SELECT x::text FROM unnest(coalesce(t.typacl,'{}'::aclitem[])) x WHERE x::text !~ (SELECT skip FROM f) ORDER BY 1)) ORDER BY 1)
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='dream' AND t.typtype='d')
    ) AS snap`)).rows[0].snap;
  const beforeAcl = await aclSnapshot();

  // Candidate install: refused without the install settings, then installed.
  await admin.query("SET ROLE p102_migrate");
  await assert.rejects(admin.query(sources["managed-scene-result/0001_install.sql"]), { message: "SCENE_RESULT_INSTALL_TARGET" });
  await admin.query("ROLLBACK"); await admin.query("RESET ROLE");
  await install("managed-scene-result/0001_install.sql", { "dream.scene_result.install_ref": projectRef, "dream.scene_result.install_database": "postgres" });
  const afterAcl = await aclSnapshot();
  assert.deepEqual(afterAcl, beforeAcl);
  const { rows: [roleRow] } = await admin.query("SELECT rolcanlogin,rolsuper,rolinherit,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname='dream_scene_result_app'");
  assert.deepEqual(roleRow, { rolcanlogin: false, rolsuper: false, rolinherit: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
  // 0002: refused without the settings, then installed on top of the unchanged 0001.
  await admin.query("SELECT set_config('dream.scene_result.install_ref','',false), set_config('dream.scene_result.install_database','',false)");
  await admin.query("SET ROLE p102_migrate");
  await assert.rejects(admin.query(sources["managed-scene-result/0002_transaction.sql"]), { message: "SCENE_RESULT_TRANSACTION_TARGET" });
  await admin.query("ROLLBACK"); await admin.query("RESET ROLE");
  await install("managed-scene-result/0002_transaction.sql", { "dream.scene_result.install_ref": projectRef, "dream.scene_result.install_database": "postgres" });
  assert.deepEqual(await aclSnapshot(), beforeAcl);
  const { rows: [writerRow] } = await admin.query("SELECT rolcanlogin,rolsuper,rolinherit,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname='dream_scene_result_writer'");
  assert.deepEqual(writerRow, roleRow);
  const { rows: [fn] } = await admin.query(`SELECT prosecdef,proowner::regrole::text AS owner,proconfig,provolatile,
      ARRAY(SELECT split_part(x::text,'/',1) FROM unnest(proacl) x ORDER BY 1) AS acl FROM pg_proc WHERE oid='dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid)'::regprocedure`);
  assert.deepEqual(fn, { prosecdef: true, owner: "dream_scene_result_writer", proconfig: ["search_path=pg_catalog"], provolatile: "v",
    acl: ["dream_scene_result_app=X", "dream_scene_result_writer=X"] });
  const { rows: memberships } = await admin.query(`SELECT m.roleid::regrole::text AS role, m.member::regrole::text AS member, m.admin_option, m.inherit_option, m.set_option
    FROM pg_auth_members m WHERE m.roleid IN ('dream_scene_result_writer'::regrole,'dream_scene_result_app'::regrole) OR m.member IN ('dream_scene_result_writer'::regrole,'dream_scene_result_app'::regrole) ORDER BY 1,2`);
  assert(memberships.every(m => m.member === "p102_migrate" && m.admin_option && !m.inherit_option && !m.set_option), JSON.stringify(memberships));
  out("install", { postgres: (await admin.query("SHOW server_version")).rows[0].server_version, tls: transport.version, sourceHashes, nonSuperuserInstaller: true,
    refusedWithoutSettings: "SCENE_RESULT_INSTALL_TARGET", existingAclPoliciesRolesUnchanged: true, roleBeforeLogin: roleRow,
    transaction: { refusedWithoutSettings: "SCENE_RESULT_TRANSACTION_TARGET", writerRole: writerRow, register: fn, memberships } });

  // Login provisioning for the rehearsal only (operator step, not part of the install file).
  const appSecret = randomBytes(28).toString("hex");
  await admin.query("ALTER ROLE dream_scene_result_app LOGIN PASSWORD '" + appSecret + "'; ALTER ROLE dream_scene_result_app SET plan_cache_mode='force_generic_plan'");
  pool = new pg.Pool({ host: loopback, port, database: "postgres", user: "dream_scene_result_app", password: appSecret, ssl, max: 12, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {});

  // Fixtures as the superuser (synthetic only): two owners, registered assets with receipts, projects in several states.
  const A = v7(), B = v7();
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  await fixturePolicy(admin);
  const assetA = await registeredAsset(admin, A, "video"), imageA = await registeredAsset(admin, A, "image"), imageA2 = await registeredAsset(admin, A, "image");
  // used only by the rollback step (the inherited test reused imageA2, which the mixed-content race may already have linked)
  const rollbackAsset = await registeredAsset(admin, A, "image");
  const assetB = await registeredAsset(admin, B, "video"), expiredA = await registeredAsset(admin, A, "image", true);
  const unregisteredA = v7();
  await admin.query("INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,sha256,size_bytes,origin,created_at) VALUES($1,$2,'image','raw','original',$4,'image/png',$3,123,'upload',now())", [A, unregisteredA, "a".repeat(64), A + "/assets/" + unregisteredA + "/" + "a".repeat(64) + ".png"]);
  const SHA = "a".repeat(64); // registeredAsset bytes hash
  const stageRows = produce => [["intake", "approved"], ["brief", "approved"], ["plan", "approved"], ["produce", produce], ["edit", "locked"], ["review", "locked"], ["export", "locked"]];
  async function seedProject(owner, { approved = true, produce = "todo", revision = 3 } = {}) {
    const project = v7(), plan = v7(), scenes = [v7(), v7(), v7()];
    await admin.query("BEGIN");
    try {
      await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,content_revision,created_at,updated_at)
        VALUES($1,$2,'shopping-shorts','1','{}','{}','synthetic','goal','target','9:16',30,$3,now(),now())`, [owner, project, revision]);
      await admin.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,approved_scene_snapshot_json,approved_at,created_at)
        VALUES($1,$2,$3,1,'[]','script',$4,$5,$6,now())`, [owner, plan, project, approved ? "approved" : "draft", approved ? JSON.stringify(scenes.map((id, i) => ({ id, position: i + 1 }))) : null, approved ? new Date().toISOString() : null]);
      if (approved) await admin.query("UPDATE dream.projects SET approved_plan_id=$3 WHERE owner_id=$1 AND id=$2", [owner, project, plan]);
      for (const [stage, wanted] of stageRows(produce)) {
        const status = approved ? wanted : stage === "plan" ? "todo" : stage === "produce" ? "locked" : wanted, planStage = approved && stage === "plan";
        await admin.query(`INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_plan_id,approved_revision,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [owner, project, stage, status, planStage ? plan : null, planStage ? revision : null, status === "approved" ? new Date().toISOString() : null]);
      }
      for (const [i, id] of scenes.entries()) await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec)
        VALUES($1,$2,$3,$4,'scene','desc','[]','[]',3)`, [owner, id, project, i + 1]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    return { project, plan, scenes, revision };
  }
  const main = await seedProject(A), draft = await seedProject(A, { approved: false }), done = await seedProject(A, { produce: "approved" }), other = await seedProject(B);
  await admin.query("UPDATE dream.scenes SET archived_at=now() WHERE id=$1", [main.scenes[2]]);
  const draftPlanInMain = v7(); // a second (draft) plan in the same project, for the plan-mismatch database check
  await admin.query("INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,created_at) VALUES($1,$2,$3,2,'[]','draft','draft',now())", [A, draftPlanInMain, main.project]);
  // Existing generated result on main scene 1: succeeded generate job + version 1, selected.
  const job = v7(), generatedVersion = v7();
  await admin.query(`INSERT INTO dream.jobs(owner_id,id,kind,input_snapshot_json,status,project_id,ref_type,ref_id,provider,idempotency_key,attempts,created_at,updated_at,finished_at)
    VALUES($1,$2,'generate','{"schemaVersion":1,"model":"mock"}','succeeded',$3,'scene',$4,'mock','gen:1',1,now(),now(),now())`, [A, job, main.project, main.scenes[0]]);
  await admin.query(`INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,job_id,result_asset_id,status,created_at)
    VALUES($1,$2,$3,1,$4,'image','{"schemaVersion":1,"model":"mock"}',$5,$6,'succeeded',now())`, [A, generatedVersion, main.scenes[0], main.plan, job, imageA]);
  await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [main.scenes[0], generatedVersion]);
  const existingRow = async () => (await admin.query("SELECT to_jsonb(v) AS row FROM dream.scene_versions v WHERE id=$1", [generatedVersion])).rows[0].row;
  const existingBefore = await existingRow();
  const receiptState = async () => (await admin.query(`SELECT md5(string_agg(t,'|' ORDER BY t)) AS h FROM (
      SELECT 'o'||to_jsonb(o)::text t FROM dream.storage_objects o UNION ALL SELECT 'r'||to_jsonb(r)::text FROM dream.storage_verification_receipts r
      UNION ALL SELECT 's'||to_jsonb(s)::text FROM dream.asset_receipt_state s UNION ALL SELECT 'v'||to_jsonb(v)::text FROM dream.storage_verification_operations v
      UNION ALL SELECT 'p'||to_jsonb(p)::text FROM dream.storage_policies p UNION ALL SELECT 'a'||to_jsonb(a)::text FROM dream.assets a) x`)).rows[0].h;
  const receiptsBefore = await receiptState();
  const counts = async () => (await admin.query(`SELECT (SELECT count(*)::int FROM dream.scene_versions) versions,(SELECT count(*)::int FROM dream_scene_result.requests) requests,
    (SELECT count(*)::int FROM dream.project_assets) links,(SELECT count(*)::int FROM dream.activity_log) logs,
    (SELECT jsonb_object_agg(id,content_revision ORDER BY id) FROM dream.projects) revisions,(SELECT jsonb_object_agg(id,selected_version_id ORDER BY id) FROM dream.scenes) selected`)).rows[0];

  const call = (owner, input) => withActorTransaction(pool, actorFromVerifiedUserId(owner), tx => registerManagedSceneResult(tx, input),
    { prepareSession: sceneResultSession(projectRef), preserveDomainError: isSceneResultError });
  const code = promise => promise.then(value => ({ ok: true, ...value }), error => ({ ok: false, code: error.code ?? error.name }));
  const base = { projectId: main.project, sceneId: main.scenes[0], assetId: assetA, sha256: SHA, revision: main.revision };

  // 1) Normal registration and owner-only read.
  const before1 = await counts();
  const r1 = await call(A, { ...base, requestId: v7() });
  assert.deepEqual({ version: r1.version, duplicate: r1.duplicate }, { version: 2, duplicate: false });
  const { rows: [row1] } = await admin.query("SELECT owner_id,scene_id,version,plan_id,kind,job_id,generation_id,result_asset_id,status,input_snapshot_json::jsonb AS input FROM dream.scene_versions WHERE id=$1", [r1.versionId]);
  assert.deepEqual({ ...row1, input: { ...row1.input, requestId: "x" } }, { owner_id: A, scene_id: main.scenes[0], version: "2", plan_id: main.plan, kind: "video", job_id: null, generation_id: null, result_asset_id: assetA, status: "succeeded",
    input: { schemaVersion: 1, source: "managed-source", requestId: "x", projectId: main.project, sceneId: main.scenes[0], assetId: assetA, sha256: SHA, sizeBytes: 123 } });
  const after1 = await counts();
  assert.deepEqual({ v: after1.versions - before1.versions, r: after1.requests - before1.requests, l: after1.links - before1.links, g: after1.logs - before1.logs }, { v: 1, r: 1, l: 1, g: 1 });
  assert.deepEqual(after1.revisions, before1.revisions); assert.deepEqual(after1.selected, before1.selected);
  const read = async (owner, text, values) => { const c = await connect("dream_scene_result_app", appSecret); try { await c.query("BEGIN"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [owner]); return (await c.query(text, values)).rows; } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); } };
  const readCode = (owner, text, values) => read(owner, text, values).then(() => "allowed", error => error.code);
  assert.equal(await readCode(A, "SELECT id FROM dream.scene_versions WHERE id=$1", [r1.versionId]), "42501");
  assert.equal(await readCode(A, "SELECT request_id FROM dream_scene_result.requests"), "42501");
  assert.equal((await read(A, "SELECT version FROM dream_scene_result.installation")).length, 1);
  const { rows: [logged] } = await admin.query("SELECT detail_json::jsonb AS d FROM dream.activity_log WHERE action='scene.result_register' AND detail_json::jsonb->>'versionId'=$1", [r1.versionId]);
  assert.deepEqual({ ...logged.d, requestId: "x" }, { sceneId: main.scenes[0], versionId: r1.versionId, version: 2, assetId: assetA, requestId: "x" });
  const { rows: [receipt] } = await admin.query("SELECT input_sha::text AS sha,project_id,scene_id FROM dream_scene_result.requests WHERE scene_version_id=$1", [r1.versionId]);
  assert.deepEqual(receipt, { sha: digest(JSON.stringify([main.project, main.scenes[0], assetA, SHA])), project_id: main.project, scene_id: main.scenes[0] });
  out("normal", { version: 2, kind: "video", planIsApproved: true, rowsAdded: { versions: 1, requests: 1, links: 1, logs: 1 }, revisionUnchanged: true, selectionUnchanged: true,
    loginTableRead: "42501", receiptInputShaSameFormatAs0001: true, logDetailMatches: true });

  // 2) Same request: replay (also after the revision moved) returns the same version; different content conflicts.
  const reqSame = v7();
  const first = await call(A, { ...base, requestId: reqSame, sceneId: main.scenes[1] });
  assert.equal((await call(A, { ...base, requestId: reqSame, sceneId: main.scenes[1] })).versionId, first.versionId);
  await admin.query("UPDATE dream.projects SET content_revision=content_revision+1 WHERE id=$1", [main.project]);
  const replay = await call(A, { ...base, requestId: reqSame, sceneId: main.scenes[1], revision: 1 });
  assert.deepEqual(replay, { versionId: first.versionId, version: first.version, duplicate: true });
  base.revision = main.revision + 1;
  const c0 = await counts();
  assert.deepEqual(await code(call(A, { ...base, requestId: reqSame, sceneId: main.scenes[1], assetId: imageA2 })), { ok: false, code: "CONFLICT" });
  assert.deepEqual(await counts(), c0);
  out("same-request", { replay: "same version", replayAfterRevisionChange: "same version", differentContent: "CONFLICT", rowsAdded: 0 });

  // 3) Concurrent: 8 connections with the same request; 8 with different requests on one scene; 6 mixed-content on one request.
  const c1 = await counts(), reqC = v7();
  const same = await Promise.all(Array.from({ length: 8 }, () => code(call(A, { ...base, requestId: reqC, sceneId: main.scenes[1] }))));
  assert(same.every(r => r.ok)); assert.equal(new Set(same.map(r => r.versionId)).size, 1); assert.equal(same.filter(r => !r.duplicate).length, 1);
  const c2 = await counts();
  assert.deepEqual({ v: c2.versions - c1.versions, r: c2.requests - c1.requests, g: c2.logs - c1.logs }, { v: 1, r: 1, g: 1 });
  const distinct = await Promise.all(Array.from({ length: 8 }, () => code(call(A, { ...base, requestId: v7(), sceneId: main.scenes[1] }))));
  assert(distinct.every(r => r.ok && !r.duplicate));
  const versions = (await admin.query("SELECT version::int FROM dream.scene_versions WHERE scene_id=$1 ORDER BY version", [main.scenes[1]])).rows.map(r => r.version);
  assert.deepEqual(versions, Array.from({ length: versions.length }, (_, i) => i + 1)); assert.equal(versions.length, 10);
  const reqM = v7(), c3 = await counts();
  const mixed = await Promise.all(Array.from({ length: 6 }, (_, i) => code(call(A, { ...base, requestId: reqM, sceneId: main.scenes[1], assetId: i % 2 ? imageA2 : assetA }))));
  const winner = mixed.find(r => r.ok && !r.duplicate);
  assert(winner); assert.equal(mixed.filter(r => r.ok && !r.duplicate).length, 1);
  const c4 = await counts();
  assert.equal(c4.versions - c3.versions, 1);
  assert(mixed.every(r => (r.ok && r.versionId === winner.versionId) || (!r.ok && r.code === "CONFLICT")));
  out("concurrent", { sameRequest: { connections: 8, created: 1, duplicates: 7, versionIds: 1 }, distinctRequests: { connections: 8, created: 8, sceneVersions: versions },
    mixedContentSameRequest: { connections: 6, created: 1, conflicts: mixed.filter(r => !r.ok).length, sameAsWinner: mixed.filter(r => r.ok).length } });

  // 4) Partial failure: the last write (activity log) fails → version, request and project link all roll back.
  const reqR = v7(), c5 = await counts();
  const linkCount = async asset => Number((await admin.query("SELECT count(*) FROM dream.project_assets WHERE asset_id=$1", [asset])).rows[0].count);
  assert.equal(await linkCount(rollbackAsset), 0);
  await admin.query("CREATE FUNCTION public.p2_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='scene.result_register' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END$$; CREATE TRIGGER p2_fail BEFORE INSERT ON dream.activity_log FOR EACH ROW EXECUTE FUNCTION public.p2_fail()");
  const failed = await code(call(A, { ...base, requestId: reqR, sceneId: main.scenes[1], assetId: rollbackAsset }));
  assert.deepEqual(failed, { ok: false, code: "PG_TRANSACTION" });
  assert.deepEqual(await counts(), c5); assert.equal(await linkCount(rollbackAsset), 0);
  await admin.query("DROP TRIGGER p2_fail ON dream.activity_log; DROP FUNCTION public.p2_fail()");
  const retried = await call(A, { ...base, requestId: reqR, sceneId: main.scenes[1], assetId: rollbackAsset });
  assert.equal(retried.duplicate, false); assert.equal((await call(A, { ...base, requestId: reqR, sceneId: main.scenes[1], assetId: rollbackAsset })).duplicate, true);
  assert.equal(await linkCount(rollbackAsset), 1);
  out("rollback", { injectedFailure: "activity_log", result: "PG_TRANSACTION", rowsAfterFailure: 0, linkAfterFailure: 0, retryCreated: 1, retryReplay: "duplicate" });

  // 5) No-write refusals through the service.
  const c6 = await counts();
  const refusals = {
    otherOwnerProject: await code(call(B, { ...base, requestId: v7() })),
    otherOwnerAsset: await code(call(A, { ...base, requestId: v7(), assetId: assetB })),
    otherOwnerSceneInOwnProject: await code(call(A, { ...base, requestId: v7(), sceneId: other.scenes[0] })),
    planNotApproved: await code(call(A, { ...base, requestId: v7(), projectId: draft.project, sceneId: draft.scenes[0], revision: draft.revision })),
    produceCompleted: await code(call(A, { ...base, requestId: v7(), projectId: done.project, sceneId: done.scenes[0], revision: done.revision })),
    staleRevision: await code(call(A, { ...base, requestId: v7(), revision: base.revision - 1 })),
    archivedScene: await code(call(A, { ...base, requestId: v7(), sceneId: main.scenes[2] })),
    expiredReceipt: await code(call(A, { ...base, requestId: v7(), assetId: expiredA })),
    noReceipt: await code(call(A, { ...base, requestId: v7(), assetId: unregisteredA })),
    shaMismatch: await code(call(A, { ...base, requestId: v7(), sha256: "b".repeat(64) })),
    badInput: await code(call(A, { ...base, requestId: "not-a-uuid" })),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, v.code])), {
    otherOwnerProject: "NOT_FOUND", otherOwnerAsset: "NOT_FOUND", otherOwnerSceneInOwnProject: "NOT_FOUND", planNotApproved: "PLAN_NOT_APPROVED",
    produceCompleted: "STAGE_LOCKED", staleRevision: "CONFLICT", archivedScene: "NOT_FOUND", expiredReceipt: "ASSET_NOT_READY", noReceipt: "ASSET_NOT_READY",
    shaMismatch: "ASSET_NOT_READY", badInput: "INVALID_INPUT" });
  assert.deepEqual(await counts(), c6);
  out("refusals", { codes: Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, v.code])), rowsAdded: 0 });

  // 6) Direct SQL as the app role (bypassing the service): the database policies refuse every out-of-contract write.
  const direct = async (owner, text, values = []) => {
    const c = await connect("dream_scene_result_app", appSecret);
    const steps = Array.isArray(text) ? text : [[text, values]];
    try { await c.query("BEGIN"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [owner]); for (const [t, v] of steps) await c.query(t, v); return "allowed"; }
    catch (error) { return error.code; } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
  };
  const snap = (asset, extra = {}) => JSON.stringify({ schemaVersion: 1, source: "managed-source", assetId: asset, sha256: SHA, ...extra });
  const ins = "INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,result_asset_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())";
  const c7 = await counts();
  const defense = {
    queuedStatus: await direct(A, ins, [A, v7(), main.scenes[0], 90, main.plan, "video", snap(assetA), assetA, "queued"]),
    notApprovedPlanSameProject: await direct(A, ins, [A, v7(), main.scenes[0], 91, draftPlanInMain, "video", snap(assetA), assetA, "succeeded"]),
    unlinkedAsset: await direct(A, ins, [A, v7(), main.scenes[0], 92, main.plan, "image", snap(imageA), imageA, "succeeded"]),
    expiredAssetLinked: await direct(A, [["INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,'scene_result')", [A, main.project, expiredA]],
      [ins, [A, v7(), main.scenes[0], 93, main.plan, "image", snap(expiredA), expiredA, "succeeded"]]]),
    kindMismatch: await direct(A, ins, [A, v7(), main.scenes[0], 94, main.plan, "image", snap(assetA), assetA, "succeeded"]),
    notManagedSource: await direct(A, ins, [A, v7(), main.scenes[0], 95, main.plan, "video", JSON.stringify({ assetId: assetA }), assetA, "succeeded"]),
    produceCompletedProject: await direct(A, ins, [A, v7(), done.scenes[0], 96, done.plan, "video", snap(assetA), assetA, "succeeded"]),
    otherOwnerRow: await direct(A, ins, [B, v7(), other.scenes[0], 97, other.plan, "video", snap(assetB), assetB, "succeeded"]),
    jobColumn: await direct(A, "INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,job_id,result_asset_id,status,created_at) VALUES($1,$2,$3,98,$4,'video',$5,$6,$7,'succeeded',now())", [A, v7(), main.scenes[0], main.plan, snap(assetA), job, assetA]),
    updateVersion: await direct(A, "UPDATE dream.scene_versions SET status='failed' WHERE id=$1", [r1.versionId]),
    deleteVersion: await direct(A, "DELETE FROM dream.scene_versions WHERE id=$1", [r1.versionId]),
    selectVersion: await direct(A, "UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [main.scenes[0], r1.versionId]),
    bumpRevision: await direct(A, "UPDATE dream.projects SET content_revision=content_revision+1 WHERE id=$1", [main.project]),
    approvePlan: await direct(A, "UPDATE dream.stage_states SET status='approved' WHERE project_id=$1 AND stage='produce'", [main.project]),
    otherLinkPurpose: await direct(A, "INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,'product')", [A, main.project, imageA]),
    otherLogAction: await direct(A, "INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at) VALUES($1,$2,$3,'managed-scene-result','plan.approve','{}',now())", [A, v7(), main.project]),
    forgedRequest: await direct(A, "INSERT INTO dream_scene_result.requests VALUES($1,$2,$3,$4,$5,$6,now())", [A, v7(), "c".repeat(64), draft.project, main.scenes[0], r1.versionId]),
    updateRequest: await direct(A, "UPDATE dream_scene_result.requests SET input_sha=$1", ["d".repeat(64)]),
    receiptWrite: await direct(A, "UPDATE dream.asset_receipt_state SET status='ready' WHERE asset_id=$1", [expiredA]),
    setRoleApi: await direct(A, "SET ROLE dream_api"),
    readJobs: await direct(A, "SELECT id FROM dream.jobs"),
    // independent review X1/X2: policy-shaped direct writes that 0001 allowed for the login
    versionWithoutReceiptOrLog: await direct(A, ins, [A, v7(), main.scenes[1], 777777, main.plan, "video", snap(assetA), assetA, "succeeded"]),
    snapshotOfOtherProject: await direct(A, ins, [A, v7(), main.scenes[1], 31, main.plan, "video", snap(assetA, { projectId: draft.project, sceneId: draft.scenes[0] }), assetA, "succeeded"]),
    maxVersionNumber: await direct(A, ins, [A, v7(), main.scenes[1], 9007199254740991, main.plan, "video", snap(assetA), assetA, "succeeded"]),
    linkOnly: await direct(A, "INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,'scene_result')", [A, main.project, imageA]),
    logOnly: await direct(A, "INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at) VALUES($1,$2,$3,'managed-scene-result','scene.result_register','{}',now())", [A, v7(), main.project]),
    lockProject: await direct(A, "SELECT id FROM dream.projects WHERE id=$1 FOR SHARE", [main.project]),
    setRoleWriter: await direct(A, "SET ROLE dream_scene_result_writer"),
    readActor: await direct(A, "SELECT dream.actor_id()"),
    createInResultSchema: await direct(A, "CREATE TABLE dream_scene_result.x(id int)"),
  };
  // After 0002 the login holds no table privilege: every direct read/write/lock is a privilege error (42501).
  assert(Object.values(defense).every(v => v === "42501"), JSON.stringify(defense));
  assert.deepEqual(await counts(), c7);
  // The function itself, called directly by the login, refuses without writing (outcome row, no SQL error).
  const fnCall = async (owner, args) => { const c = await connect("dream_scene_result_app", appSecret);
    try { await c.query("BEGIN"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
      const { rows: [r] } = await c.query("SELECT r_outcome FROM dream_scene_result.register($1,$2,$3,$4,$5,$6,$7,$8)", args); await c.query("COMMIT"); return r.r_outcome; }
    catch (error) { await c.query("ROLLBACK").catch(() => {}); return error.code; } finally { await c.end(); } };
  const fa = (over = {}) => { const v = { request: v7(), project: main.project, scene: main.scenes[1], asset: assetA, sha: SHA, revision: base.revision, version: v7(), log: v7(), ...over };
    return [v.request, v.project, v.scene, v.asset, v.sha, v.revision, v.version, v.log]; };
  const functionDirect = {
    otherOwnerActor: await fnCall(B, fa()),
    noActor: await fnCall("", fa()),
    upperCaseSha: await fnCall(A, fa({ sha: "A".repeat(64) })),
    zeroRevision: await fnCall(A, fa({ revision: 0 })),
    nullVersionId: await fnCall(A, fa({ version: null })),
    existingVersionId: await fnCall(A, fa({ version: r1.versionId })),
  };
  assert.deepEqual(functionDirect, { otherOwnerActor: "NOT_FOUND", noActor: "INVALID_INPUT", upperCaseSha: "INVALID_INPUT", zeroRevision: "INVALID_INPUT",
    nullVersionId: "INVALID_INPUT", existingVersionId: "23505" });
  assert.deepEqual(await counts(), c7);
  out("database-defense", { attempts: Object.keys(defense).length, rowsAdded: 0, codes: defense, functionDirect });

  // 7) Compatibility and preservation.
  assert.deepEqual(await existingRow(), existingBefore);
  assert.equal(await receiptState(), receiptsBefore);
  assert.deepEqual(await aclSnapshot(), beforeAcl);
  const { rows: [selected] } = await admin.query("SELECT selected_version_id FROM dream.scenes WHERE id=$1", [main.scenes[0]]);
  assert.equal(selected.selected_version_id, generatedVersion);
  // A managed version is selectable by the existing (legacy) owner path: dream_api with the owner actor.
  await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE dream_api"); await admin.query("SELECT set_config('dream.actor_id',$1,true)", [A]);
  assert.equal((await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [main.scenes[0], r1.versionId])).rowCount, 1);
  const apiSees = (await admin.query("SELECT count(*)::int n FROM dream.scene_versions WHERE scene_id=$1", [main.scenes[0]])).rows[0].n;
  await admin.query("ROLLBACK");
  const privileges = (await admin.query(`SELECT table_schema||'.'||table_name AS t, string_agg(privilege_type||'('||column_name||')', ',' ORDER BY privilege_type,column_name) AS p
    FROM information_schema.column_privileges WHERE grantee='dream_scene_result_app' GROUP BY 1 ORDER BY 1`)).rows;
  const tablePrivileges = (await admin.query(`SELECT table_schema||'.'||table_name AS t, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
    FROM information_schema.role_table_grants WHERE grantee='dream_scene_result_app' GROUP BY 1 ORDER BY 1`)).rows;
  const policies = (await admin.query(`SELECT c.relnamespace::regnamespace||'.'||c.relname AS t, p.polname, p.polcmd FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE 'dream_scene_result_app'::regrole::oid=ANY(p.polroles) ORDER BY 1,2`)).rows;
  out("compatibility", { existingGeneratedVersionUnchanged: true, existingSelectionUnchanged: true, receiptsAndAssetsUnchanged: true, aclPoliciesRolesUnchanged: true,
    legacyOwnerApiCanSelectManagedVersion: true, legacyOwnerApiSeesVersions: apiSees });
  out("role-scope", { tablePrivileges, columnPrivileges: privileges, policies });

  // 8) Produce completion vs registration. TEST DOUBLE: the product has no managed produce-completion path yet. The double
  // follows the product's existing stage transitions (managed-project-core-http brief confirm: project row FOR UPDATE, then
  // UPDATE stage_states), as the superuser; a second variant updates the stage row only (the independent review X6b shape).
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const lockWaiters = async filter => Number((await admin.query(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${filter}`)).rows[0].count);
  const untilWaiting = async (filter, label) => { const end = Date.now() + 8000;
    while (await lockWaiters(filter) < 1) { if (Date.now() > end) throw new Error("no lock wait: " + label); await sleep(20); } };
  const completion = async (holder, project, lockProject) => {
    if (lockProject) await holder.query("SELECT id FROM dream.projects WHERE id=$1 FOR UPDATE", [project]);
    const n = (await holder.query("UPDATE dream.stage_states SET status='approved',approved_at=clock_timestamp() WHERE project_id=$1 AND stage='produce' AND status IN ('todo','in_progress')", [project])).rowCount;
    // Commit order, not approved_at: an UPDATE computes its new values before it waits for a row lock, so approved_at can
    // predate a registration that committed first. What the completion sees once it holds the row lock is the measure.
    const seen = (await holder.query("SELECT count(*)::int AS n FROM dream.scene_versions v JOIN dream.scenes c ON c.id=v.scene_id WHERE c.project_id=$1", [project])).rows[0].n;
    return { n, seen };
  };
  const sceneState = async s => (await admin.query(`SELECT (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='produce') produce,
      (SELECT count(*)::int FROM dream.scene_versions v JOIN dream.scenes c ON c.id=v.scene_id WHERE c.project_id=$1) versions,
      (SELECT count(*)::int FROM dream_scene_result.requests WHERE project_id=$1) requests,
      (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='scene.result_register') logs`, [s.project])).rows[0];
  const baseFor = (s, scene = 0, asset = assetA) => ({ requestId: v7(), projectId: s.project, sceneId: s.scenes[scene], assetId: asset, sha256: SHA, revision: s.revision });
  const races = {};
  for (const lockProject of [true, false]) {
    // (a) completion holds its locks first → registration waits, then sees the committed completion → STAGE_LOCKED, no write.
    const s = await seedProject(A), holder = await connect("p102_root");
    try {
      await holder.query("BEGIN"); assert.deepEqual(await completion(holder, s.project, lockProject), { n: 1, seen: 0 });
      const pending = code(call(A, baseFor(s)));
      await untilWaiting("usename='dream_scene_result_app'", "registration behind completion");
      await holder.query("COMMIT");
      const result = await pending, state = await sceneState(s);
      assert.deepEqual({ result: result.code, produce: state.produce, versions: state.versions, requests: state.requests, logs: state.logs },
        { result: "STAGE_LOCKED", produce: "approved", versions: 0, requests: 0, logs: 0 });
      races[(lockProject ? "projectThenStage" : "stageOnly") + ":completionFirst"] = { registrationWaited: true, result: result.code, versions: 0, requests: 0, logs: 0 };
    } finally { await holder.query("ROLLBACK").catch(() => {}); await holder.end(); }
    // (b) registration holds its locks first (open transaction) → completion waits; after both commit the version predates completion.
    const t = await seedProject(A), holder2 = await connect("p102_root"), reg = await connect("dream_scene_result_app", appSecret);
    try {
      await reg.query("BEGIN"); await reg.query("SELECT set_config('dream.actor_id',$1,true)", [A]);
      const { rows: [created] } = await reg.query("SELECT r_outcome,r_version FROM dream_scene_result.register($1,$2,$3,$4,$5,$6,$7,$8)", [v7(), t.project, t.scenes[0], assetA, SHA, t.revision, v7(), v7()]);
      assert.equal(created.r_outcome, "CREATED");
      const pid = (await holder2.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await holder2.query("BEGIN"); const pendingCompletion = completion(holder2, t.project, lockProject);
      await untilWaiting("pid=" + Number(pid), "completion behind registration");
      await reg.query("COMMIT");
      const completed = await pendingCompletion; await holder2.query("COMMIT");
      assert.deepEqual(completed, { n: 1, seen: 1 });
      const state = await sceneState(t);
      assert.deepEqual({ produce: state.produce, versions: state.versions, requests: state.requests, logs: state.logs }, { produce: "approved", versions: 1, requests: 1, logs: 1 });
      races[(lockProject ? "projectThenStage" : "stageOnly") + ":registrationFirst"] = { completionWaited: true, registration: "CREATED", produceAfter: "approved", completionSawVersion: completed.seen };
    } finally { await reg.query("ROLLBACK").catch(() => {}); await reg.end(); await holder2.query("ROLLBACK").catch(() => {}); await holder2.end(); }
  }
  out("completion-race", { testDouble: "produce completion (no managed product path): superuser, project FOR UPDATE then stage UPDATE, or stage UPDATE only", cases: races });

  // 9) Lock-order stress: per project 6 registrations (two scenes, distinct requests) and one completion start together.
  // No deadlock or lock timeout; every outcome is CREATED or STAGE_LOCKED; every version committed before the completion took the produce row.
  const stress = [];
  for (let round = 0; round < 6; round++) {
    const s = await seedProject(A), holder = await connect("p102_root"), lockProject = round % 2 === 0;
    try {
      // registrations start every 15 ms; the completion starts between them (10..60 ms) so some register before it and some after
      const registrations = Array.from({ length: 6 }, (_, i) => sleep(i * 15).then(() => code(call(A, baseFor(s, i % 2)))));
      const done = (async () => { await sleep(10 + round * 10); await holder.query("BEGIN"); const c = await completion(holder, s.project, lockProject); await holder.query("COMMIT"); return c; })();
      const [results, completed] = await Promise.all([Promise.all(registrations), done]);
      const outcomes = results.map(r => r.ok ? "CREATED" : r.code), state = await sceneState(s);
      assert(outcomes.every(o => o === "CREATED" || o === "STAGE_LOCKED"), JSON.stringify(outcomes));
      const created = outcomes.filter(o => o === "CREATED").length;
      assert.equal(completed.n, 1);
      // every committed version was visible to the completion once it held the produce row: none was registered after it
      assert.equal(completed.seen, state.versions);
      assert.deepEqual({ produce: state.produce, versions: state.versions, requests: state.requests, logs: state.logs }, { produce: "approved", versions: created, requests: created, logs: created });
      stress.push({ completion: lockProject ? "projectThenStage" : "stageOnly", created, stageLocked: 6 - created, completionSaw: completed.seen });
    } finally { await holder.query("ROLLBACK").catch(() => {}); await holder.end(); }
  }
  assert(stress.some(r => r.created > 0 && r.stageLocked > 0), JSON.stringify(stress));
  out("lock-order-stress", { rounds: stress, deadlocksOrTimeouts: 0 });

  // 10) Two scenes, one new asset, 8 concurrent registrations: one project link, 8 versions (link insert is idempotent).
  const s10 = await seedProject(A), assetC = await registeredAsset(admin, A, "image");
  const linkRace = await Promise.all(Array.from({ length: 8 }, (_, i) => code(call(A, baseFor(s10, i % 2, assetC)))));
  assert(linkRace.every(r => r.ok && !r.duplicate), JSON.stringify(linkRace));
  const s10State = await sceneState(s10);
  assert.deepEqual({ versions: s10State.versions, requests: s10State.requests, logs: s10State.logs, links: await linkCount(assetC) }, { versions: 8, requests: 8, logs: 8, links: 1 });
  out("link-race", { connections: 8, scenes: 2, created: 8, links: 1 });
  console.log(JSON.stringify({ result: "PASS" }));
} catch (error) {
  const log = await readFile(join(root, "postgres.log"), "utf8").catch(() => "");
  console.error(log.split(/\r?\n/).filter(line => / (?:ERROR|FATAL):/.test(line)).slice(-12).join("\n"));
  throw error;
} finally {
  await pool?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (started) await pgExec("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "50", "stop"]);
  const actual = await realpath(root);
  assert.equal(dirname(actual), parent);
  assert.match(basename(actual), /^dream-p2tx-[A-Za-z0-9]+$/);
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
