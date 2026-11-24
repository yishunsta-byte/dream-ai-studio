/* global console, process, URL, Request, Buffer, URLSearchParams */
// P2 managed scene read (candidate) on an isolated local PostgreSQL 17 with TLS, at the HTTP handler level
// (sceneReadHandler → createSceneReadRequest → withActorTransaction as dream_scene_read_app). No Next build, no network
// beyond 127.0.0.1: the Auth decision is injected as the ServerAuthResult the product resolver returns.
// Run (cwd = repo): P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/managed-scene-read.pg17.mjs
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
const { createSceneReadRequest, sceneReadHandler, sceneReadLimits } = await tsModule("lib/services/postgres/scene-reads.ts");
const { sceneReadSession, managedSceneReadConfig } = await tsModule("lib/cloud/managed-scene-read.ts");
const route = await tsModule("app/api/projects/[id]/scenes/route.ts");

const sql = async file => (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
const pinned = [
  ["0001_schema.sql", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification.sql", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
  ["managed-project-core/0001_install.sql", "c4e4bc131d2816e6107f0cff4033d8dc7b20825ccd56a6e40e8f6069f3546182"],
  ["managed-project-core/0002_asset_choices.sql", "5b96880eb254337bb7a095b8269a1cea2d9dfae366c1eb778e2276277d87546c"],
  ["managed-project-plan/0001_install.sql", "33cc4d7714151eca427da7cb070ad55e26381727913d0a81fe8e7601b99cbef8"],
];
const sources = {};
for (const [file, hash] of pinned) { sources[file] = await sql(file); assert.equal(digest(sources[file]), hash, file); }
for (const file of ["managed-project-plan/0002_approval.sql", "managed-scene-read/0001_install.sql"]) sources[file] = await sql(file);
const sourceHashes = Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, digest(text)]));
const out = (name, value) => console.log(JSON.stringify({ check: name, ...value }));

// Product config parser (no connection): the managed scene read is selected only by its own backend switch.
{
  const publicEnv = { DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://" + projectRef + ".supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_p102_fixture_only_key" };
  const dsn = user => "postgresql://" + user + ":synthetic@" + dbHost + ":5432/postgres";
  const good = managedSceneReadConfig({ ...publicEnv, DREAM_SCENE_READ_BACKEND: "supabase-postgres", DREAM_SCENE_READ_DB_URL: dsn("dream_scene_read_app") });
  assert.deepEqual({ host: good?.host, user: good?.user, port: good?.port, ref: good?.ref }, { host: dbHost, user: "dream_scene_read_app", port: 5432, ref: projectRef });
  const refused = {
    noBackend: managedSceneReadConfig({ ...publicEnv, DREAM_SCENE_READ_DB_URL: dsn("dream_scene_read_app") }),
    otherRole: managedSceneReadConfig({ ...publicEnv, DREAM_SCENE_READ_BACKEND: "supabase-postgres", DREAM_SCENE_READ_DB_URL: dsn("dream_project_core_app") }),
    authOff: managedSceneReadConfig({ ...publicEnv, DREAM_AUTH_MODE: "off", DREAM_SCENE_READ_BACKEND: "supabase-postgres", DREAM_SCENE_READ_DB_URL: dsn("dream_scene_read_app") }),
    otherHost: managedSceneReadConfig({ ...publicEnv, DREAM_SCENE_READ_BACKEND: "supabase-postgres", DREAM_SCENE_READ_DB_URL: "postgresql://dream_scene_read_app:x@127.0.0.1:5432/postgres" }),
  };
  assert(Object.values(refused).every(value => value === null));
  out("config", { selected: "DREAM_SCENE_READ_BACKEND=supabase-postgres + own DSN role", refused: Object.keys(refused) });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, loopback, resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent, "dream-p2rd-"));
const data = join(root, "cluster"), password = randomBytes(28).toString("hex"), port = await freePort();
let started = false, admin, pool;
try {
  const pw = join(root, "bootstrap.txt");
  await writeFile(pw, password + "\n", { flag: "wx" });
  await pgExec("initdb", ["-D", data, "--username=p102_root", "--pwfile=" + pw, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
  await rm(pw);
  const ca = join(data, "server.crt"), key = join(data, "server.key"), cfg = join(root, "openssl.cnf");
  await writeFile(cfg, "[req]\ndistinguished_name=dn\n[dn]\n");
  await exec(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "1", "-config", cfg, "-subj", "/CN=P2 scene read isolated",
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

  const skip = "^dream_scene_read_app=";
  const aclSnapshot = async () => (await admin.query(`SELECT jsonb_build_object(
      'relations', (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text,
          ARRAY(SELECT x::text FROM unnest(coalesce(c.relacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY n.nspname,c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials','auth')),
      'columns', (SELECT jsonb_agg(row ORDER BY row) FROM (SELECT jsonb_build_array(n.nspname,c.relname,a.attname,
          ARRAY(SELECT x::text FROM unnest(a.attacl) x WHERE x::text !~ $1 ORDER BY 1)) AS row
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials') AND a.attnum>0 AND a.attacl IS NOT NULL
          AND EXISTS (SELECT FROM unnest(a.attacl) x WHERE x::text !~ $1)) s),
      'policies', (SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,
          (SELECT array_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid=ANY(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
          ORDER BY c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        WHERE NOT EXISTS (SELECT FROM pg_roles r WHERE r.oid=ANY(p.polroles) AND r.rolname='dream_scene_read_app')),
      'roles', (SELECT jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb) ORDER BY rolname) FROM pg_roles
        WHERE rolname<>'dream_scene_read_app' AND rolname !~ '^pg_'),
      'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname,ARRAY(SELECT x::text FROM unnest(coalesce(nspacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY nspname)
        FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','dream_scene_read')),
      'functions', (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,ARRAY(SELECT x::text FROM unnest(coalesce(p.proacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY 1)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('dream','managed_project_plan'))
    ) AS snap`, [skip])).rows[0].snap;
  const beforeAcl = await aclSnapshot();

  await admin.query("SET ROLE p102_migrate");
  await assert.rejects(admin.query(sources["managed-scene-read/0001_install.sql"]), { message: "SCENE_READ_INSTALL_TARGET" });
  await admin.query("ROLLBACK"); await admin.query("RESET ROLE");
  await install("managed-scene-read/0001_install.sql", { "dream.scene_read.install_ref": projectRef, "dream.scene_read.install_database": "postgres" });
  assert.deepEqual(await aclSnapshot(), beforeAcl);
  const { rows: [roleRow] } = await admin.query("SELECT rolcanlogin,rolsuper,rolinherit,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname='dream_scene_read_app'");
  assert.deepEqual(roleRow, { rolcanlogin: false, rolsuper: false, rolinherit: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
  const { rows: [coreScope] } = await admin.query("SELECT has_any_column_privilege('dream_project_core_app','dream.scenes','SELECT') AS core_scenes, has_any_column_privilege('dream_project_core_app','dream.scene_versions','SELECT') AS core_versions");
  assert.deepEqual(coreScope, { core_scenes: false, core_versions: false });
  out("install", { postgres: (await admin.query("SHOW server_version")).rows[0].server_version, tls: transport.version, sourceHashes, nonSuperuserInstaller: true,
    refusedWithoutSettings: "SCENE_READ_INSTALL_TARGET", existingAclPoliciesRolesUnchanged: true, roleBeforeLogin: roleRow,
    projectCoreRoleStillWithoutSceneRead: true });

  const appSecret = randomBytes(28).toString("hex");
  await admin.query("ALTER ROLE dream_scene_read_app LOGIN PASSWORD '" + appSecret + "'");
  pool = new pg.Pool({ host: loopback, port, database: "postgres", user: "dream_scene_read_app", password: appSecret, ssl, max: 6, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {});

  // Fixtures as the superuser (synthetic only).
  const A = v7(), B = v7(), SHA = "a".repeat(64);
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  await fixturePolicy(admin);
  const videoA = await registeredAsset(admin, A, "video"), imageA = await registeredAsset(admin, A, "image"), videoB = await registeredAsset(admin, B, "video");
  const filePaths = (await admin.query("SELECT file_path FROM dream.assets")).rows.map(r => r.file_path);
  const stageRows = (approved, produce) => [["intake", "approved"], ["brief", "approved"], ["plan", approved ? "approved" : "todo"], ["produce", approved ? produce : "locked"], ["edit", "locked"], ["review", "locked"], ["export", "locked"]];
  async function seedProject(owner, { approved = true, produce = "in_progress", revision = 4, positions = [3, 1, 2], archived = false } = {}) {
    const project = v7(), plan = v7(), scenes = positions.map(() => v7());
    await admin.query("BEGIN");
    try {
      await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,content_revision,created_at,updated_at)
        VALUES($1,$2,'shopping-shorts','1','{}','{}','synthetic','goal','target','9:16',30,$3,now(),now())`, [owner, project, revision]);
      if (approved) {
        await admin.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,approved_scene_snapshot_json,approved_at,created_at)
          VALUES($1,$2,$3,2,'[]','script','approved',$4,now(),now())`, [owner, plan, project, JSON.stringify(scenes.map((id, i) => ({ id, position: positions[i] })))]);
        await admin.query("UPDATE dream.projects SET approved_plan_id=$3 WHERE owner_id=$1 AND id=$2", [owner, project, plan]);
      } else {
        await admin.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,created_at) VALUES($1,$2,$3,1,'[]','draft','draft',now())`, [owner, plan, project]);
      }
      for (const [stage, status] of stageRows(approved, produce)) {
        const planStage = approved && stage === "plan";
        await admin.query(`INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_plan_id,approved_revision,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [owner, project, stage, status, planStage ? plan : null, planStage ? revision : null, status === "approved" ? new Date().toISOString() : null]);
      }
      if (approved) for (const [i, id] of scenes.entries()) await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec)
        VALUES($1,$2,$3,$4,'secret-scene-title','secret-scene-description','[{"text":"secret-dialogue"}]','[]',3)`, [owner, id, project, positions[i]]);
      if (archived) await admin.query("UPDATE dream.projects SET archived_at=now() WHERE id=$1", [project]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    return { project, plan, scenes: approved ? scenes : [], revision };
  }
  const job = async (owner, project, scene, status) => {
    const id = v7();
    await admin.query(`INSERT INTO dream.jobs(owner_id,id,kind,input_snapshot_json,status,project_id,ref_type,ref_id,provider,idempotency_key,attempts,created_at,updated_at,finished_at)
      VALUES($1,$2,'generate','{"schemaVersion":1,"model":"mock"}',$3,$4,'scene',$5,'mock',$6,1,now(),now(),$7)`,
      [owner, id, status, project, scene, "gen:" + id, ["succeeded", "failed", "canceled"].includes(status) ? new Date().toISOString() : null]);
    return id;
  };
  const version = async (owner, s, scene, n, { kind = "image", status = "succeeded", jobId = null, asset = null, snapshot = '{"schemaVersion":1,"model":"mock"}', at }) => {
    const id = v7();
    await admin.query(`INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,job_id,result_asset_id,status,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [owner, id, scene, n, s.plan, kind, snapshot, jobId, asset, status, at]);
    return id;
  };
  // main: scenes inserted at positions 3,1,2 (+ one archived scene at position 0 with a version).
  const main = await seedProject(A);
  const [s3, s1, s2] = main.scenes;
  const archivedScene = v7();
  await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec,archived_at)
    VALUES($1,$2,$3,0,'archived','archived','[]','[]',3,now())`, [A, archivedScene, main.project]);
  const requestId = v7();
  const t = i => new Date(Date.UTC(2026, 10, 24, 0, 0, i)).toISOString();
  // scene at position 1: v3 failed job, v1 generated job (selected), v2 managed-source direct (inserted out of order)
  const v1s1Job = await job(A, main.project, s1, "succeeded"), v3s1Job = await job(A, main.project, s1, "failed");
  const v3s1 = await version(A, main, s1, 3, { status: "failed", jobId: v3s1Job, at: t(3) });
  const v1s1 = await version(A, main, s1, 1, { jobId: v1s1Job, asset: imageA, at: t(1) });
  const v2s1 = await version(A, main, s1, 2, { kind: "video", asset: videoA, at: t(2),
    snapshot: JSON.stringify({ schemaVersion: 1, source: "managed-source", requestId, projectId: main.project, sceneId: s1, assetId: videoA, sha256: SHA, sizeBytes: 123 }) });
  await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [s1, v1s1]);
  // scene at position 3: one queued job version (no result yet). position 2: no versions.
  const v1s3Job = await job(A, main.project, s3, "queued");
  const v1s3 = await version(A, main, s3, 1, { kind: "video", status: "queued", jobId: v1s3Job, at: t(4) });
  await version(A, main, archivedScene, 1, { asset: imageA, jobId: await job(A, main.project, archivedScene, "succeeded"), at: t(5) });
  const draft = await seedProject(A, { approved: false });
  const archivedProject = await seedProject(A, { archived: true });
  const other = await seedProject(B);
  await version(B, other, other.scenes[0], 1, { kind: "video", asset: videoB, jobId: await job(B, other.project, other.scenes[0], "succeeded"), at: t(6) });
  const fixtureState = async () => (await admin.query(`SELECT md5(string_agg(t,'|' ORDER BY t)) h FROM (SELECT to_jsonb(x)::text t FROM dream.scenes x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.scene_versions x UNION ALL SELECT to_jsonb(x)::text FROM dream.projects x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.stage_states x UNION ALL SELECT to_jsonb(x)::text FROM dream.plans x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.activity_log x) s`)).rows[0].h;
  let stateBefore = await fixtureState();

  // HTTP handler with the product request object; only the Auth decision and the pool target are injected.
  const backendEnv = { DREAM_SCENE_READ_BACKEND: "supabase-postgres" };
  const managed = { pool, prepareSession: sceneReadSession(projectRef) };
  const verified = owner => async () => ({ kind: "verified", userId: owner, email: "fixture@example.invalid" });
  const get = async (id, { auth = verified(A), environment = backendEnv, openManaged = () => managed, params, query = "" } = {}) => {
    const handler = sceneReadHandler(() => createSceneReadRequest({ resolveAuth: auth, environment: () => environment, openManaged }));
    const response = await handler(new Request("http://127.0.0.1/api/projects/" + id + "/scenes" + query), { params: params ?? Promise.resolve({ id }) });
    const raw = await response.text();
    return { status: response.status, cache: response.headers.get("cache-control"), type: response.headers.get("content-type"), raw, body: JSON.parse(raw) };
  };

  // 1) Normal: identifiers, revision, states, the selected version and the newest versions (number descending); scenes by
  // position; archived scene left out; no cursor while a scene has no more than the recent count.
  const normal = await get(main.project);
  assert.equal(normal.status, 200); assert.equal(normal.cache, "no-store"); assert.match(normal.type, /^application\/json/);
  const job1 = { kind: "image", status: "succeeded", origin: "job", planId: main.plan };
  assert.deepEqual(normal.body, {
    projectId: main.project, revision: 4, approvedPlanId: main.plan, approvedPlanVersion: 2, stages: { plan: "approved", produce: "in_progress" },
    scenes: [
      { id: s1, position: 1, selectedVersionId: v1s1, selectedVersion: { id: v1s1, version: 1, ...job1, resultAssetId: imageA, createdAt: t(1) }, recentVersions: [
        { id: v3s1, version: 3, kind: "image", status: "failed", origin: "job", planId: main.plan, resultAssetId: null, createdAt: t(3) },
        { id: v2s1, version: 2, kind: "video", status: "succeeded", origin: "direct", planId: main.plan, resultAssetId: videoA, createdAt: t(2) },
        { id: v1s1, version: 1, ...job1, resultAssetId: imageA, createdAt: t(1) }], olderCursor: null },
      { id: s2, position: 2, selectedVersionId: null, selectedVersion: null, recentVersions: [], olderCursor: null },
      { id: s3, position: 3, selectedVersionId: null, selectedVersion: null, recentVersions: [
        { id: v1s3, version: 1, kind: "video", status: "queued", origin: "job", planId: main.plan, resultAssetId: null, createdAt: t(4) }], olderCursor: null },
    ] });
  // Nothing internal in the response text: asset paths/keys, hashes, request ids, input snapshots, titles or scene text.
  const forbidden = [...filePaths, SHA, requestId, "managed-source", "sizeBytes", "secret-scene", "secret-dialogue", "archived", archivedScene, "input", "sha256", "owner"];
  const leaked = forbidden.filter(value => normal.raw.includes(value));
  assert.deepEqual(leaked, []);
  out("normal", { status: 200, cache: normal.cache, scenes: normal.body.scenes.map(s => ({ position: s.position, versions: s.recentVersions.map(v => v.version + ":" + v.status + ":" + v.origin) })),
    selectedIsListed: true, archivedSceneOmitted: true, forbiddenValuesChecked: forbidden.length, leaked: 0 });

  // 2) Empty: a project before plan approval has no scenes; its stages say why.
  const empty = await get(draft.project);
  assert.deepEqual({ status: empty.status, body: empty.body }, { status: 200, body: { projectId: draft.project, revision: 4, approvedPlanId: null, approvedPlanVersion: null,
    stages: { plan: "todo", produce: "locked" }, scenes: [] } });
  out("empty", { status: 200, scenes: 0, stages: empty.body.stages, approvedPlanId: null });

  // 3) Other owner, archived, unknown, invalid: the existing project-read codes (404 hides another owner's project).
  const codes = {
    otherOwnerReadsMain: await get(main.project, { auth: verified(B) }),
    ownerReadsOtherOwner: await get(other.project),
    archivedProject: await get(archivedProject.project),
    unknownProject: await get(v7()),
    invalidId: await get("not-a-project"),
  };
  const compact = Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, v.status + ":" + v.body.code]));
  assert.deepEqual(compact, { otherOwnerReadsMain: "404:NOT_FOUND", ownerReadsOtherOwner: "404:NOT_FOUND", archivedProject: "404:NOT_FOUND", unknownProject: "404:NOT_FOUND", invalidId: "400:INVALID_INPUT" });
  assert.equal(codes.otherOwnerReadsMain.raw, codes.unknownProject.raw);
  const otherView = await get(other.project, { auth: verified(B) });
  assert.equal(otherView.status, 200); assert.equal(otherView.body.scenes.reduce((n, s) => n + s.recentVersions.length, 0), 1);
  out("scope", { codes: compact, otherOwnerSameBodyAsUnknown: true, otherOwnerOwnRead: 200 });

  // 4) No permission / no backend: Auth first; denied requests never read route params.
  const throwingParams = { then: () => { throw new Error("params read"); } };
  const unauth = {
    required: await get(main.project, { auth: async () => ({ kind: "denied", status: 401, code: "AUTH_REQUIRED" }), params: throwingParams }),
    forbidden: await get(main.project, { auth: async () => ({ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" }), params: throwingParams }),
    authLocal: await get(main.project, { auth: async () => ({ kind: "local" }), params: throwingParams }),
    authThrows: await get(main.project, { auth: async () => { throw new Error("auth down"); }, params: throwingParams }),
    verifiedNotUuid: await get(main.project, { auth: async () => ({ kind: "verified", userId: "x", email: "a@example.invalid" }), params: throwingParams }),
    noBackend: await get(main.project, { environment: {}, params: throwingParams }),
    backendUnconfigured: await get(main.project, { openManaged: () => null, params: throwingParams }),
  };
  const unauthCodes = Object.fromEntries(Object.entries(unauth).map(([k, v]) => [k, v.status + ":" + v.body.code]));
  assert.deepEqual(unauthCodes, { required: "401:AUTH_REQUIRED", forbidden: "403:AUTH_FORBIDDEN", authLocal: "503:AUTH_UNAVAILABLE", authThrows: "503:AUTH_UNAVAILABLE",
    verifiedNotUuid: "503:AUTH_UNAVAILABLE", noBackend: "503:PROJECT_READ_UNAVAILABLE", backendUnconfigured: "503:PROJECT_READ_UNAVAILABLE" });
  assert(Object.values(unauth).every(v => v.cache === "no-store"));
  // The real route (process env: login off, no backend) answers without touching SQLite or PostgreSQL.
  const routeReply = await route.GET(new Request("http://127.0.0.1/api/projects/" + main.project + "/scenes"), { params: Promise.resolve({ id: main.project }) });
  const routeBody = await routeReply.json();
  assert.equal(typeof route.GET, "function"); assert.equal(routeReply.status, 503);
  out("no-permission", { codes: unauthCodes, paramsReadWhenDenied: false, routeWithoutLoginOrBackend: routeReply.status + ":" + routeBody.code });

  // 5) Installation drift fails closed (503) per request.
  const drift = {};
  for (const [name, grant, revoke] of [
    ["writeGrant", "GRANT INSERT (id) ON dream.scenes TO dream_scene_read_app", "REVOKE INSERT (id) ON dream.scenes FROM dream_scene_read_app"],
    ["snapshotColumn", "GRANT SELECT (input_snapshot_json) ON dream.scene_versions TO dream_scene_read_app", "REVOKE SELECT (input_snapshot_json) ON dream.scene_versions FROM dream_scene_read_app"],
    ["assetRead", "GRANT SELECT (file_path) ON dream.assets TO dream_scene_read_app", "REVOKE SELECT (file_path) ON dream.assets FROM dream_scene_read_app"],
    ["extraPolicy", "CREATE POLICY p2_extra ON dream.scenes FOR UPDATE TO dream_scene_read_app USING (true)", "DROP POLICY p2_extra ON dream.scenes"],
    ["inheritingMember", "GRANT dream_api TO dream_scene_read_app WITH INHERIT FALSE, SET FALSE", "REVOKE dream_api FROM dream_scene_read_app"],
  ]) {
    await admin.query(grant);
    try { const r = await get(main.project); drift[name] = r.status + ":" + r.body.code; } finally { await admin.query(revoke); }
  }
  assert(Object.values(drift).every(v => v === "503:PROJECT_READ_UNAVAILABLE"), JSON.stringify(drift));
  assert.equal((await get(main.project)).status, 200);
  out("installation-drift", { codes: drift, restored: 200 });

  // 6) Inconsistent data fails closed: a selection that is not one of the scene's versions.
  await admin.query("ALTER TABLE dream.scenes DISABLE TRIGGER USER");
  try {
    await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [s2, v1s3]);
    const bad = await get(main.project);
    assert.deepEqual([bad.status, bad.body.code], [503, "PROJECT_READ_UNAVAILABLE"]);
    await admin.query("UPDATE dream.scenes SET selected_version_id=NULL WHERE id=$1", [s2]);
  } finally { await admin.query("ALTER TABLE dream.scenes ENABLE TRIGGER USER"); }
  out("inconsistent-selection", { result: "503:PROJECT_READ_UNAVAILABLE", fixtureRestored: true });

  // 7) Direct SQL as the read login: nothing to write, lock or see beyond the listed columns and the owner's rows.
  const direct = async (owner, text, values = []) => {
    const c = await connect("dream_scene_read_app", appSecret);
    try { await c.query("BEGIN"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [owner]); const r = await c.query(text, values); return "rows:" + r.rowCount; }
    catch (error) { return error.code; } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
  };
  const defense = {
    insertScene: await direct(A, "INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec) VALUES($1,$2,$3,9,'t','d','[]','[]',1)", [A, v7(), main.project]),
    insertVersion: await direct(A, "INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,status,created_at) VALUES($1,$2,$3,9,$4,'image','{}','queued',now())", [A, v7(), s2, main.plan]),
    selectVersion: await direct(A, "UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [s1, v2s1]),
    deleteVersion: await direct(A, "DELETE FROM dream.scene_versions WHERE id=$1", [v3s1]),
    bumpRevision: await direct(A, "UPDATE dream.projects SET content_revision=content_revision+1 WHERE id=$1", [main.project]),
    lockScene: await direct(A, "SELECT id FROM dream.scenes WHERE id=$1 FOR SHARE", [s1]),
    readSnapshot: await direct(A, "SELECT input_snapshot_json FROM dream.scene_versions WHERE id=$1", [v2s1]),
    readTitle: await direct(A, "SELECT title FROM dream.scenes WHERE id=$1", [s1]),
    readAssets: await direct(A, "SELECT file_path FROM dream.assets"),
    readCoreReceipts: await direct(A, "SELECT * FROM dream_project_core.requests"),
    readJobs: await direct(A, "SELECT id FROM dream.jobs"),
    setRoleApi: await direct(A, "SET ROLE dream_api"),
    otherOwnerScenes: await direct(B, "SELECT id FROM dream.scenes WHERE project_id=$1", [main.project]),
    otherOwnerVersions: await direct(B, "SELECT id FROM dream.scene_versions WHERE scene_id=$1", [s1]),
    noActorScenes: await direct("", "SELECT id FROM dream.scenes"),
    archivedProjectRow: await direct(A, "SELECT id FROM dream.projects WHERE id=$1", [archivedProject.project]),
  };
  const expectedDefense = { insertScene: "42501", insertVersion: "42501", selectVersion: "42501", deleteVersion: "42501", bumpRevision: "42501", lockScene: "42501",
    readSnapshot: "42501", readTitle: "42501", readAssets: "42501", readCoreReceipts: "42501", readJobs: "42501", setRoleApi: "42501",
    otherOwnerScenes: "rows:0", otherOwnerVersions: "rows:0", noActorScenes: "rows:0", archivedProjectRow: "rows:0" };
  assert.deepEqual(defense, expectedDefense);
  out("database-defense", { attempts: Object.keys(defense).length, codes: defense });

  // 7b) Bounded reads (pagination candidate). Every step below is checked for zero writes against the fixture state.
  assert.equal(await fixtureState(), stateBefore);
  const rebase = async () => { stateBefore = await fixtureState(); };
  const codeOf = r => r.status + ":" + (r.body.code ?? "ok");
  const olderQuery = (scene, cursor) => "?scene=" + encodeURIComponent(scene) + "&cursor=" + encodeURIComponent(cursor);
  const bulkVersions = async (owner, s, scene, from, to, status = "failed") => admin.query(`INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,status,created_at)
    SELECT $1,gen_random_uuid(),$2,n,$3,'image','{"schemaVersion":1,"model":"mock"}',$6,timestamptz '2026-11-01 00:00:00+00' + n*interval '1 second'
    FROM generate_series($4::bigint,$5::bigint) n`, [owner, scene, s.plan, from, to, status]);
  // long: scene L with 2,105 versions (selected: an old succeeded one, number 7), scene M with exactly 6, scene N with exactly 5.
  const long = await seedProject(A, { positions: [1, 2, 3] });
  const [L, M, N] = long.scenes;
  await bulkVersions(A, long, L, 1, 6); await bulkVersions(A, long, L, 8, 2105);
  const v7L = await version(A, long, L, 7, { asset: await registeredAsset(admin, A, "image"), jobId: await job(A, long.project, L, "succeeded"), at: t(7) });
  await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [L, v7L]);
  await bulkVersions(A, long, M, 1, 6); await bulkVersions(A, long, N, 1, 5);
  await rebase();
  const first = await get(long.project);
  assert.equal(first.status, 200);
  const [fl, fm, fn] = first.body.scenes;
  assert.deepEqual(fl.recentVersions.map(v => v.version), [2105, 2104, 2103, 2102, 2101]);
  assert.deepEqual([fl.selectedVersionId, fl.selectedVersion?.id, fl.selectedVersion?.version, fl.selectedVersion?.status], [v7L, v7L, 7, "succeeded"]);
  assert.equal(typeof fl.olderCursor, "string");
  assert.deepEqual(fm.recentVersions.map(v => v.version), [6, 5, 4, 3, 2]); assert.equal(typeof fm.olderCursor, "string");
  assert.deepEqual(fn.recentVersions.map(v => v.version), [5, 4, 3, 2, 1]); assert.equal(fn.olderCursor, null);
  const walk = async (scene, cursor, { between } = {}) => {
    const seen = [], pages = [];
    let next = cursor;
    while (next) {
      const page = await get(long.project, { query: olderQuery(scene, next) });
      assert.equal(page.status, 200, page.raw);
      assert.deepEqual(Object.keys(page.body).sort(), ["olderCursor", "projectId", "revision", "sceneId", "versions"]);
      assert(page.body.versions.length <= sceneReadLimits.page);
      pages.push({ count: page.body.versions.length, bytes: Buffer.byteLength(page.raw) });
      seen.push(...page.body.versions.map(v => v.version));
      next = page.body.olderCursor;
      if (between && pages.length === 1) await between();
    }
    return { seen, pages };
  };
  const full = await walk(L, fl.olderCursor);
  const expectedOlder = Array.from({ length: 2100 }, (_, i) => 2100 - i);
  assert.deepEqual(full.seen, expectedOlder);
  assert.equal(full.pages.length, 42); assert(full.pages.every(p => p.count === 50));
  const mWalk = await walk(M, fm.olderCursor);
  assert.deepEqual(mWalk.seen, [1]); assert.equal(mWalk.pages.length, 1);
  const firstBytes = Buffer.byteLength(first.raw), maxPageBytes = Math.max(...full.pages.map(p => p.bytes));
  assert.equal(await fixtureState(), stateBefore);
  out("long-history", { versionsInScene: 2105, initial: { status: 200, recent: fl.recentVersions.length, selected: 7, bytes: firstBytes },
    olderPages: full.pages.length, olderVersions: full.seen.length, missing: 0, duplicates: full.seen.length - new Set(full.seen).size, strictlyDescending: true,
    lastPageExactBoundary: "page 42 holds 50, next cursor null", sixVersionScene: "1 older page of 1", fiveVersionScene: "no cursor", maxPageBytes, writes: 0 });

  // Boundary changes between pages: new versions and a new selection after page 1 do not shift, repeat or drop older ones;
  // an archived scene ends the walk with 404; the project revision is reported on every page.
  const again = await walk(L, fl.olderCursor, { between: async () => {
    await bulkVersions(A, long, L, 2106, 2110);
    const fresh = await version(A, long, L, 2111, { asset: await registeredAsset(admin, A, "image"), jobId: await job(A, long.project, L, "succeeded"), at: t(9) });
    await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [L, fresh]);
    await admin.query("UPDATE dream.projects SET content_revision=content_revision+1, updated_at=now() WHERE id=$1", [long.project]);
  } });
  assert.deepEqual(again.seen, expectedOlder);
  await rebase();
  const afterChange = await get(long.project);
  assert.deepEqual(afterChange.body.scenes[0].recentVersions.map(v => v.version), [2111, 2110, 2109, 2108, 2107]);
  assert.equal(afterChange.body.scenes[0].selectedVersion.version, 2111); assert.equal(afterChange.body.revision, 5);
  const resumeCursor = (await get(long.project, { query: olderQuery(L, fl.olderCursor) })).body.olderCursor;
  await admin.query("UPDATE dream.scenes SET archived_at=now() WHERE id=$1", [M]);
  await rebase();
  const archivedMid = await get(long.project, { query: olderQuery(M, fm.olderCursor) });
  const stillL = await get(long.project, { query: olderQuery(L, resumeCursor) });
  assert.equal(codeOf(archivedMid), "404:NOT_FOUND");
  assert.deepEqual(stillL.body.versions.map(v => v.version), Array.from({ length: 50 }, (_, i) => 2050 - i));
  assert.equal(await fixtureState(), stateBefore);
  out("boundary-change", { addedAfterPage1: "2106..2111 + new selection + revision 4->5", olderSequenceUnchanged: true, duplicates: 0, missing: 0,
    newInitialRecent: "2111..2107", archivedSceneNextPage: codeOf(archivedMid), otherSceneCursorStillWorks: true, writes: 0 });

  // Wrong cursors and queries: 400 before the database, or 404 when the database does not show the scene to this owner.
  const raw64 = value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64url");
  const forged = fields => raw64({ v: 1, p: long.project, s: L, b: 100, ...fields });
  const otherProjectCursor = raw64({ v: 1, p: main.project, s: L, b: 100 });
  const unknownProject = v7();
  const wrong = {
    sceneOnly: await get(long.project, { query: "?scene=" + L }),
    cursorOnly: await get(long.project, { query: "?cursor=" + fl.olderCursor }),
    extraParam: await get(long.project, { query: olderQuery(L, fl.olderCursor) + "&limit=1000" }),
    duplicateScene: await get(long.project, { query: olderQuery(L, fl.olderCursor) + "&scene=" + L }),
    sceneNotUuid: await get(long.project, { query: olderQuery("x", fl.olderCursor) }),
    notBase64: await get(long.project, { query: olderQuery(L, "!!!") }),
    notJson: await get(long.project, { query: olderQuery(L, raw64("not json")) }),
    jsonArray: await get(long.project, { query: olderQuery(L, raw64([1])) }),
    otherFormat: await get(long.project, { query: olderQuery(L, forged({ v: 2 })) }),
    extraKey: await get(long.project, { query: olderQuery(L, forged({ o: B })) }),
    beforeOne: await get(long.project, { query: olderQuery(L, forged({ b: 1 })) }),
    beforeNegative: await get(long.project, { query: olderQuery(L, forged({ b: -5 })) }),
    beforeFraction: await get(long.project, { query: olderQuery(L, forged({ b: 1.5 })) }),
    beforeText: await get(long.project, { query: olderQuery(L, forged({ b: "100" })) }),
    beforeUnsafe: await get(long.project, { query: olderQuery(L, forged({ b: 2 ** 53 })) }),
    upperCaseIds: await get(long.project, { query: olderQuery(L, forged({ s: L.toUpperCase() })) }),
    tooLong: await get(long.project, { query: olderQuery(L, "A".repeat(300)) }),
    otherScenesCursor: await get(long.project, { query: olderQuery(N, fl.olderCursor) }),
    otherProjectsCursor: await get(long.project, { query: olderQuery(L, otherProjectCursor) }),
    cursorOnOtherPath: await get(main.project, { query: olderQuery(L, fl.olderCursor) }),
    sceneOfOtherProject: await get(long.project, { query: olderQuery(s1, forged({ s: s1 })) }),
    otherOwnerWithCursor: await get(long.project, { auth: verified(B), query: olderQuery(L, fl.olderCursor) }),
    unknownProjectCursor: await get(unknownProject, { query: olderQuery(L, raw64({ v: 1, p: unknownProject, s: L, b: 100 })) }),
  };
  const wrongCodes = Object.fromEntries(Object.entries(wrong).map(([k, v]) => [k, codeOf(v)]));
  assert.deepEqual(wrongCodes, { sceneOnly: "400:INVALID_INPUT", cursorOnly: "400:INVALID_INPUT", extraParam: "400:INVALID_INPUT", duplicateScene: "400:INVALID_INPUT",
    sceneNotUuid: "400:INVALID_INPUT", notBase64: "400:INVALID_CURSOR", notJson: "400:INVALID_CURSOR", jsonArray: "400:INVALID_CURSOR", otherFormat: "400:INVALID_CURSOR",
    extraKey: "400:INVALID_CURSOR", beforeOne: "400:INVALID_CURSOR", beforeNegative: "400:INVALID_CURSOR", beforeFraction: "400:INVALID_CURSOR",
    beforeText: "400:INVALID_CURSOR", beforeUnsafe: "400:INVALID_CURSOR", upperCaseIds: "400:INVALID_CURSOR", tooLong: "400:INVALID_CURSOR",
    otherScenesCursor: "400:INVALID_CURSOR", otherProjectsCursor: "400:INVALID_CURSOR", cursorOnOtherPath: "400:INVALID_CURSOR",
    sceneOfOtherProject: "404:NOT_FOUND", otherOwnerWithCursor: "404:NOT_FOUND", unknownProjectCursor: "404:NOT_FOUND" });
  assert.equal(wrong.otherOwnerWithCursor.raw, wrong.unknownProjectCursor.raw);
  assert(Object.values(wrong).every(v => v.cache === "no-store"));
  // A query is never read before Auth, the backend and the route params.
  let searchReads = 0;
  const countingSearch = () => { searchReads += 1; return new URLSearchParams("scene=" + L + "&cursor=" + fl.olderCursor); };
  const deniedFirst = await createSceneReadRequest({ resolveAuth: async () => ({ kind: "denied", status: 401, code: "AUTH_REQUIRED" }), environment: () => backendEnv, openManaged: () => managed })
    .get(async () => long.project, countingSearch);
  const noBackendFirst = await createSceneReadRequest({ resolveAuth: verified(A), environment: () => ({}), openManaged: () => managed }).get(async () => long.project, countingSearch);
  const badIdFirst = await createSceneReadRequest({ resolveAuth: verified(A), environment: () => backendEnv, openManaged: () => managed }).get(async () => "x", countingSearch);
  assert.deepEqual([deniedFirst.status, noBackendFirst.status, badIdFirst.status, searchReads], [401, 503, 400, 0]);
  const pageText = (await get(long.project, { query: olderQuery(L, fl.olderCursor) })).raw;
  const pageLeaks = forbidden.filter(value => pageText.includes(value));
  assert.deepEqual(pageLeaks, []);
  assert.equal(await fixtureState(), stateBefore);
  out("cursor-validation", { codes: wrongCodes, otherOwnerSameBodyAsUnknown: true, queryReadsBeforeAuthBackendParams: searchReads, pageLeaks: pageLeaks.length, writes: 0 });

  // Response bound: 200 open scenes with 6 versions each answer 200 within scenes × recent versions;
  // 201 open scenes answer 422 SCENE_READ_LIMIT (not retryable), unlike a database failure (503).
  const wide = await seedProject(A, { positions: [1] });
  await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec)
    SELECT $1,gen_random_uuid(),$2,n,'t','d','[]','[]',3 FROM generate_series(2,200) n`, [A, wide.project]);
  await admin.query(`INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,status,created_at)
    SELECT s.owner_id,gen_random_uuid(),s.id,n,$3,'image','{"schemaVersion":1}','failed',now() FROM dream.scenes s CROSS JOIN generate_series(1,6) n
    WHERE s.owner_id=$1 AND s.project_id=$2`, [A, wide.project, wide.plan]);
  await rebase();
  const wideRead = await get(wide.project);
  assert.equal(wideRead.status, 200); assert.equal(wideRead.body.scenes.length, 200);
  assert(wideRead.body.scenes.every(s => s.recentVersions.length === 5 && typeof s.olderCursor === "string"));
  const wideBytes = Buffer.byteLength(wideRead.raw);
  await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec)
    VALUES($1,$2,$3,201,'t','d','[]','[]',3)`, [A, v7(), wide.project]);
  await rebase();
  const overLimit = await get(wide.project);
  assert.equal(codeOf(overLimit), "422:SCENE_READ_LIMIT"); assert.equal(overLimit.cache, "no-store");
  // Database unavailable: a pool that cannot connect, and a lock held past the session lock_timeout (6s).
  const closedPort = await freePort();
  const deadPool = new pg.Pool({ host: loopback, port: closedPort, database: "postgres", user: "dream_scene_read_app", password: appSecret, ssl, max: 1, connectionTimeoutMillis: 2000 });
  deadPool.on("error", () => {});
  const unreachable = { initial: await get(long.project, { openManaged: () => ({ pool: deadPool, prepareSession: managed.prepareSession }) }),
    olderPage: await get(long.project, { openManaged: () => ({ pool: deadPool, prepareSession: managed.prepareSession }), query: olderQuery(L, fl.olderCursor) }) };
  await deadPool.end().catch(() => {});
  const holder = await connect("p102_root");
  let lockWait;
  try {
    await holder.query("BEGIN"); await holder.query("LOCK TABLE dream.scene_versions IN ACCESS EXCLUSIVE MODE");
    const startedAt = Date.now();
    lockWait = { result: await get(long.project), ms: Date.now() - startedAt };
  } finally { await holder.query("ROLLBACK").catch(() => {}); await holder.end(); }
  const failures = { overLimit: codeOf(overLimit), unreachableInitial: codeOf(unreachable.initial), unreachableOlderPage: codeOf(unreachable.olderPage),
    lockTimeout: codeOf(lockWait.result) };
  assert.deepEqual(failures, { overLimit: "422:SCENE_READ_LIMIT", unreachableInitial: "503:PROJECT_READ_UNAVAILABLE", unreachableOlderPage: "503:PROJECT_READ_UNAVAILABLE",
    lockTimeout: "503:PROJECT_READ_UNAVAILABLE" });
  assert(lockWait.ms >= 5500, String(lockWait.ms));
  assert.notEqual(overLimit.body.error, unreachable.initial.body.error);
  assert.equal((await get(long.project)).status, 200);
  assert.equal(await fixtureState(), stateBefore);
  out("response-bound", { scenes200x6: { status: 200, versionsInBody: 200 * 5, bytes: wideBytes }, scenes201: failures.overLimit,
    databaseFailures: { unreachableInitial: failures.unreachableInitial, unreachableOlderPage: failures.unreachableOlderPage, lockTimeout: failures.lockTimeout, lockWaitMs: lockWait.ms },
    distinctCodes: true, afterRecovery: 200, writes: 0 });

  // 8) A read never writes; existing roles and grants are unchanged.
  assert.equal(await fixtureState(), stateBefore);
  assert.deepEqual(await aclSnapshot(), beforeAcl);
  const scope = (await admin.query(`SELECT table_schema||'.'||table_name AS t, string_agg(privilege_type||'('||column_name||')', ',' ORDER BY privilege_type,column_name) AS p
    FROM information_schema.column_privileges WHERE grantee='dream_scene_read_app' GROUP BY 1 ORDER BY 1`)).rows;
  const policies = (await admin.query(`SELECT c.relnamespace::regnamespace||'.'||c.relname AS t, p.polname, p.polcmd FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE 'dream_scene_read_app'::regrole::oid=ANY(p.polroles) ORDER BY 1,2`)).rows;
  out("preservation", { rowsChanged: 0, aclPoliciesRolesUnchanged: true, limits: sceneReadLimits });
  out("role-scope", { columnPrivileges: scope, policies });
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
  assert.match(basename(actual), /^dream-p2rd-[A-Za-z0-9]+$/);
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
