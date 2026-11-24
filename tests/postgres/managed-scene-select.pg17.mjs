/* global console, process, URL, Request, setTimeout */
// P2 managed scene version selection (candidate) on an isolated local PostgreSQL 17 with TLS, at the HTTP handler level
// (sceneSelectHandler -> createSceneSelectRequest -> withActorTransaction as dream_scene_select_app -> one function call).
// No Next build, no network beyond 127.0.0.1: the Auth decision is injected as the ServerAuthResult the product resolver
// returns. Run (cwd = repo): P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/managed-scene-select.pg17.mjs
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
const { createSceneSelectRequest, sceneSelectHandler } = await tsModule("lib/services/postgres/scene-select.ts");
const { sceneSelectSession, managedSceneSelectConfig } = await tsModule("lib/cloud/managed-scene-select.ts");
const route = await tsModule("app/api/projects/[id]/scene-selection/route.ts");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const sql = async file => (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
const pinned = [
  ["0001_schema.sql", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification.sql", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
  ["managed-project-core/0001_install.sql", "c4e4bc131d2816e6107f0cff4033d8dc7b20825ccd56a6e40e8f6069f3546182"],
  ["managed-project-core/0002_asset_choices.sql", "5b96880eb254337bb7a095b8269a1cea2d9dfae366c1eb778e2276277d87546c"],
  ["managed-project-plan/0001_install.sql", "33cc4d7714151eca427da7cb070ad55e26381727913d0a81fe8e7601b99cbef8"],
  ["managed-project-plan/0002_approval.sql", "80e8843af173d180dfd96c7d6f2a7b32d31cf56d36652235393b3f6a3dd65807"],
];
const sources = {};
for (const [file, hash] of pinned) { sources[file] = await sql(file); assert.equal(digest(sources[file]), hash, file); }
sources["managed-scene-select/0001_install.sql"] = await sql("managed-scene-select/0001_install.sql");
const sourceHashes = Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, digest(text)]));
// The writer-role guard is one text: the installer's scope check and the per-request re-check must not drift apart.
const roleGuard = text => { const m = text.match(/-- role-guard:begin[^\n]*\n([\s\S]*?)-- role-guard:end/); assert(m, "role-guard block"); return m[1].replace(/\s+/g, " ").trim(); };
const runtimeSource = (await readFile(new URL("lib/cloud/managed-scene-select.ts", rootPath), "utf8")).replaceAll("\r\n", "\n");
assert.equal(roleGuard(runtimeSource), roleGuard(sources["managed-scene-select/0001_install.sql"]));
const roleGuardHash = digest(roleGuard(runtimeSource));
const out = (name, value) => console.log(JSON.stringify({ check: name, ...value }));

// Product config parser (no connection).
{
  const publicEnv = { DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://" + projectRef + ".supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_p102_fixture_only_key" };
  const dsn = user => "postgresql://" + user + ":synthetic@" + dbHost + ":5432/postgres";
  const good = managedSceneSelectConfig({ ...publicEnv, DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_app") });
  assert.deepEqual({ host: good?.host, user: good?.user, port: good?.port, ref: good?.ref }, { host: dbHost, user: "dream_scene_select_app", port: 5432, ref: projectRef });
  const refused = {
    noBackend: managedSceneSelectConfig({ ...publicEnv, DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_app") }),
    writerRole: managedSceneSelectConfig({ ...publicEnv, DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_writer") }),
    coreRole: managedSceneSelectConfig({ ...publicEnv, DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_project_core_app") }),
    authOff: managedSceneSelectConfig({ ...publicEnv, DREAM_AUTH_MODE: "off", DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_app") }),
    otherHost: managedSceneSelectConfig({ ...publicEnv, DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: "postgresql://dream_scene_select_app:x@127.0.0.1:5432/postgres" }),
  };
  assert(Object.values(refused).every(value => value === null));
  out("config", { selected: "DREAM_SCENE_SELECT_BACKEND=supabase-postgres + own DSN role", refused: Object.keys(refused) });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, loopback, resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent, "dream-p2sel-"));
const data = join(root, "cluster"), password = randomBytes(28).toString("hex"), port = await freePort();
let started = false, admin, pool;
try {
  const pw = join(root, "bootstrap.txt");
  await writeFile(pw, password + "\n", { flag: "wx" });
  await pgExec("initdb", ["-D", data, "--username=p102_root", "--pwfile=" + pw, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
  await rm(pw);
  const ca = join(data, "server.crt"), key = join(data, "server.key"), cfg = join(root, "openssl.cnf");
  await writeFile(cfg, "[req]\ndistinguished_name=dn\n[dn]\n");
  await exec(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "1", "-config", cfg, "-subj", "/CN=P2 scene select isolated",
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

  const mine = "^dream_scene_select_(app|writer)=";
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
        WHERE NOT EXISTS (SELECT FROM pg_roles r WHERE r.oid=ANY(p.polroles) AND r.rolname ~ '^dream_scene_select_')),
      'roles', (SELECT jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb) ORDER BY rolname) FROM pg_roles
        WHERE rolname !~ '^dream_scene_select_' AND rolname !~ '^pg_'),
      'members', (SELECT jsonb_agg(jsonb_build_array(m.roleid::regrole::text,m.member::regrole::text,m.admin_option,m.inherit_option,m.set_option) ORDER BY 1)
        FROM pg_auth_members m WHERE m.roleid::regrole::text !~ '^dream_scene_select_' AND m.member::regrole::text !~ '^dream_scene_select_'),
      'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname,ARRAY(SELECT x::text FROM unnest(coalesce(nspacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY nspname)
        FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','dream_scene_select')),
      'functions', (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,ARRAY(SELECT x::text FROM unnest(coalesce(p.proacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY 1)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('dream','managed_project_plan','dream_project_core'))
    ) AS snap`, [mine])).rows[0].snap;
  const beforeAcl = await aclSnapshot();

  await admin.query("SET ROLE p102_migrate");
  await assert.rejects(admin.query(sources["managed-scene-select/0001_install.sql"]), { message: "SCENE_SELECT_INSTALL_TARGET" });
  await admin.query("ROLLBACK"); await admin.query("RESET ROLE");
  await install("managed-scene-select/0001_install.sql", { "dream.scene_select.install_ref": projectRef, "dream.scene_select.install_database": "postgres" });
  assert.deepEqual(await aclSnapshot(), beforeAcl);
  const roles = (await admin.query("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname ~ '^dream_scene_select_' ORDER BY 1")).rows;
  assert.deepEqual(roles.map(r => [r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolcreaterole]),
    [["dream_scene_select_app", false, false, false, false, false], ["dream_scene_select_writer", false, false, false, false, false]]);
  const { rows: memberRows } = await admin.query(`SELECT m.roleid::regrole::text AS role, m.member::regrole::text AS member, m.admin_option, m.inherit_option, m.set_option
    FROM pg_auth_members m WHERE m.roleid::regrole::text ~ '^dream_scene_select_' OR m.member::regrole::text ~ '^dream_scene_select_' ORDER BY 1`);
  // Only the installer's ADMIN-only membership from CREATE ROLE may remain: no SET ROLE, no inheritance, no member roles.
  assert(memberRows.every(m => m.member === "p102_migrate" && m.admin_option && !m.inherit_option && !m.set_option), JSON.stringify(memberRows));
  out("role-guard-text", { identicalInInstallAndRuntime: true, normalizedSha256: roleGuardHash });
  out("install", { postgres: (await admin.query("SHOW server_version")).rows[0].server_version, tls: transport.version, sourceHashes, nonSuperuserInstaller: true,
    refusedWithoutSettings: "SCENE_SELECT_INSTALL_TARGET", existingAclPoliciesRolesMembersUnchanged: true, rolesBeforeLogin: roles.map(r => r.rolname + ":nologin,noinherit"), memberships: memberRows.map(m => m.member + "->" + m.role + ":admin-only") });

  const appSecret = randomBytes(28).toString("hex");
  await admin.query("ALTER ROLE dream_scene_select_app LOGIN PASSWORD '" + appSecret + "'");
  pool = new pg.Pool({ host: loopback, port, database: "postgres", user: "dream_scene_select_app", password: appSecret, ssl, max: 8, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {});

  // Fixtures (synthetic only) as the superuser.
  const A = v7(), B = v7();
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  await fixturePolicy(admin);
  const timelineJson = JSON.stringify({ schemaVersion: 1, audio: [] });
  const stageRows = (approved) => [["intake", "approved"], ["brief", "approved"], ["plan", approved ? "approved" : "todo"], ["produce", approved ? "todo" : "locked"], ["edit", "locked"], ["review", approved ? "approved" : "locked"], ["export", "locked"]];
  async function seedProject(owner, { approved = true, revision = 4, scenes: count = 2, archived = false, timeline = false } = {}) {
    const project = v7(), plan = v7(), oldPlan = v7(), scenes = Array.from({ length: count }, () => v7());
    await admin.query("BEGIN");
    try {
      await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,content_revision,created_at,updated_at)
        VALUES($1,$2,'shopping-shorts','1','{}','{}','synthetic','goal','target','9:16',30,$3,now(),now())`, [owner, project, revision]);
      await admin.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,created_at) VALUES($1,$2,$3,1,'[]','old','draft',now())`, [owner, oldPlan, project]);
      if (approved) {
        await admin.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,approved_scene_snapshot_json,approved_at,created_at)
          VALUES($1,$2,$3,2,'[]','script','approved','[]',now(),now())`, [owner, plan, project]);
        await admin.query("UPDATE dream.projects SET approved_plan_id=$3 WHERE owner_id=$1 AND id=$2", [owner, project, plan]);
      }
      for (const [stage, status] of stageRows(approved)) {
        const planStage = approved && stage === "plan";
        await admin.query(`INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_plan_id,approved_revision,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [owner, project, stage, status, planStage ? plan : null, status === "approved" && stage !== "intake" && stage !== "brief" ? revision : null, status === "approved" ? new Date().toISOString() : null]);
      }
      for (const [i, id] of scenes.entries()) await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec)
        VALUES($1,$2,$3,$4,'t','d','[]','[]',3)`, [owner, id, project, i + 1]);
      if (timeline) {
        const rev = v7();
        await admin.query(`INSERT INTO dream.timeline_revisions(owner_id,id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,created_at)
          VALUES($1,$2,$3,1,$4,$5,$6,'user',now())`, [owner, rev, project, revision, timelineJson, digest(timelineJson)]);
        await admin.query("UPDATE dream.projects SET current_timeline_rev_id=$3 WHERE owner_id=$1 AND id=$2", [owner, project, rev]);
      }
      if (archived) await admin.query("UPDATE dream.projects SET archived_at=now() WHERE id=$1", [project]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    return { owner, project, plan, oldPlan, scenes, revision };
  }
  const version = async (s, scene, n, { status = "succeeded", asset = null, plan = s.plan, kind = "image" } = {}) => {
    const id = v7();
    await admin.query(`INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,result_asset_id,status,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'{"schemaVersion":1}',$7,$8,now())`, [s.owner, id, scene, n, plan, kind, asset, status]);
    return id;
  };
  const asset = (owner, kind = "image") => registeredAsset(admin, owner, kind);
  const bypass = async fn => { await admin.query("SET session_replication_role=replica"); try { return await fn(); } finally { await admin.query("SET session_replication_role=origin"); } };

  const main = await seedProject(A, { timeline: true });
  const [s1, s2] = main.scenes;
  const v1 = await version(main, s1, 1, { asset: await asset(A) });
  const v2 = await version(main, s1, 2, { asset: await asset(A, "video"), kind: "video" });
  const vOld = await version(main, s1, 3, { asset: await asset(A), plan: main.oldPlan });
  const vFailed = await version(main, s1, 4, { status: "failed" });
  const archivedAsset = await asset(A); const vArchived = await version(main, s1, 5, { asset: archivedAsset });
  await admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1", [archivedAsset]);
  const revokedAsset = await asset(A); const vRevoked = await version(main, s1, 6, { asset: revokedAsset });
  await bypass(() => admin.query("UPDATE dream.asset_receipt_state SET status='revoked',reason_code='fixture' WHERE asset_id=$1", [revokedAsset]));
  const mockAsset = await asset(A); const vMock = await version(main, s1, 7, { asset: mockAsset });
  await bypass(() => admin.query("UPDATE dream.assets SET is_mock=1 WHERE id=$1", [mockAsset]));
  const vOtherScene = await version(main, s2, 1, { asset: await asset(A) });
  const draft = await seedProject(A, { approved: false });
  const archivedProject = await seedProject(A, { archived: true });
  const other = await seedProject(B);
  const vB = await version(other, other.scenes[0], 1, { asset: await asset(B) });
  const second = await seedProject(A);
  const vSecond = await version(second, second.scenes[0], 1, { asset: await asset(A) });
  const archivedScene = await seedProject(A);
  const vArchivedScene = await version(archivedScene, archivedScene.scenes[0], 1, { asset: await asset(A) });
  await admin.query("UPDATE dream.scenes SET archived_at=now() WHERE id=$1", [archivedScene.scenes[0]]);
  const missingStage = await seedProject(A);
  const vMissingStage = await version(missingStage, missingStage.scenes[0], 1, { asset: await asset(A) });
  await admin.query("DELETE FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2 AND stage='export'", [A, missingStage.project]);

  const snapshot = async () => (await admin.query(`SELECT md5(string_agg(t,'|' ORDER BY t)) h FROM (SELECT to_jsonb(x)::text t FROM dream.scenes x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.projects x UNION ALL SELECT to_jsonb(x)::text FROM dream.stage_states x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.activity_log x UNION ALL SELECT to_jsonb(x)::text FROM dream_scene_select.requests x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.scene_versions x UNION ALL SELECT to_jsonb(x)::text FROM dream.assets x) s`)).rows[0].h;
  const projectState = async p => {
    const { rows: [row] } = await admin.query("SELECT content_revision::int AS revision, current_timeline_rev_id AS timeline FROM dream.projects WHERE id=$1", [p]);
    const stages = Object.fromEntries((await admin.query("SELECT stage,status,approved_revision,approved_at IS NOT NULL AS approved FROM dream.stage_states WHERE project_id=$1", [p])).rows
      .map(s => [s.stage, s.status + (s.approved ? "+approval" : "")]));
    const scenes = (await admin.query("SELECT id,selected_version_id AS selected,needs_recheck::int AS recheck FROM dream.scenes WHERE project_id=$1 ORDER BY position", [p])).rows;
    const logs = Number((await admin.query("SELECT count(*) FROM dream.activity_log WHERE project_id=$1 AND action='scene.select'", [p])).rows[0].count);
    const receipts = Number((await admin.query("SELECT count(*) FROM dream_scene_select.requests WHERE project_id=$1", [p])).rows[0].count);
    return { ...row, stages, scenes, logs, receipts };
  };

  // HTTP handler with the product request object; only the Auth decision and the pool target are injected.
  const backendEnv = { DREAM_SCENE_SELECT_BACKEND: "supabase-postgres" };
  const managed = { pool, prepareSession: sceneSelectSession(projectRef) };
  const verified = owner => async () => ({ kind: "verified", userId: owner, email: "fixture@example.invalid" });
  const sameOrigin = { origin: "http://127.0.0.1", host: "127.0.0.1", "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const post = async (id, payload, { auth = verified(A), environment = backendEnv, openManaged = () => managed, params, headers = sameOrigin, raw } = {}) => {
    const handler = sceneSelectHandler(() => createSceneSelectRequest({ resolveAuth: auth, environment: () => environment, openManaged }));
    const request = new Request("http://127.0.0.1/api/projects/" + id + "/scene-selection", { method: "POST", headers, body: raw ?? JSON.stringify(payload) });
    const response = await handler(request, { params: params ?? Promise.resolve({ id }) });
    const text = await response.text();
    return { status: response.status, cache: response.headers.get("cache-control"), body: JSON.parse(text), raw: text };
  };
  const body = (extra = {}) => ({ requestId: v7(), revision: 4, sceneId: s1, versionId: v1, expectedVersionId: null, ...extra });
  const code = r => r.status + ":" + (r.body.code ?? r.body.outcome);

  // 1) Normal selection: every write of the product contract, once.
  const first = body();
  const before1 = await projectState(main.project);
  const selected = await post(main.project, first);
  assert.equal(selected.status, 200); assert.equal(selected.cache, "no-store");
  assert.deepEqual(selected.body, { projectId: main.project, sceneId: s1, selectedVersionId: v1, revision: 5, outcome: "selected" });
  const after1 = await projectState(main.project);
  assert.deepEqual(before1.stages, { intake: "approved+approval", brief: "approved+approval", plan: "approved+approval", produce: "todo", edit: "locked", review: "approved+approval", export: "locked" });
  assert.deepEqual(after1, { revision: 5, timeline: before1.timeline, logs: 1, receipts: 1,
    stages: { intake: "approved+approval", brief: "approved+approval", plan: "approved+approval", produce: "in_progress", edit: "locked", review: "locked", export: "locked" },
    scenes: [{ id: s1, selected: v1, recheck: 0 }, { id: s2, selected: null, recheck: 0 }] });
  const { rows: [log] } = await admin.query("SELECT actor,detail_json FROM dream.activity_log WHERE project_id=$1 AND action='scene.select'", [main.project]);
  assert.deepEqual({ actor: log.actor, detail: JSON.parse(log.detail_json) }, { actor: "managed-selector",
    detail: { previousRevision: 4, contentRevision: 5, origin: "produce", sceneId: s1, versionId: v1, expectedVersionId: null } });
  const { rows: [{ approved_revision: planRevision }] } = await admin.query("SELECT approved_revision FROM dream.stage_states WHERE project_id=$1 AND stage='plan'", [main.project]);
  out("select", { result: code(selected), revision: "4->5", stages: after1.stages, timelinePointerKept: true, planApprovalKept: Number(planRevision), log: "managed-selector scene.select", receipt: 1 });

  // 2) Same request again: the first answer, no write. Same id with other inputs: refused, no write.
  let mark = await snapshot();
  const replay = await post(main.project, first);
  assert.deepEqual(replay.body, { ...selected.body, outcome: "replayed" });
  const reused = await post(main.project, { ...first, versionId: v2 });
  assert.equal(code(reused), "409:REQUEST_REUSED");
  assert.equal(await snapshot(), mark);
  // Same version again with the current revision: no write.
  const unchanged = await post(main.project, body({ revision: 5, expectedVersionId: v1 }));
  assert.deepEqual(unchanged.body, { ...selected.body, outcome: "unchanged" });
  assert.equal(await snapshot(), mark);
  out("same-request", { retry: code(replay), sameIdOtherInput: code(reused), sameVersion: code(unchanged), writes: 0 });

  // 3) Refusals without writes.
  const refusals = {
    staleRevision: await post(main.project, body({ revision: 4, expectedVersionId: v1, versionId: v2 })),
    selectionChanged: await post(main.project, body({ revision: 5, expectedVersionId: null, versionId: v2 })),
    failedVersion: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: vFailed })),
    archivedAsset: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: vArchived })),
    revokedReceipt: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: vRevoked })),
    sampleAsset: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: vMock })),
    otherScenesVersion: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: vOtherScene })),
    unknownVersion: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: v7() })),
    otherOwnerOnMine: await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: v2 }), { auth: verified(B) }),
    mineOnOtherOwner: await post(other.project, body({ revision: 4, sceneId: other.scenes[0], versionId: vB })),
    otherProjectsScene: await post(main.project, body({ revision: 5, sceneId: second.scenes[0], versionId: vSecond })),
    archivedScene: await post(archivedScene.project, body({ sceneId: archivedScene.scenes[0], versionId: vArchivedScene })),
    archivedProject: await post(archivedProject.project, body({ sceneId: archivedProject.scenes[0], versionId: v7() })),
    unknownProject: await post(v7(), body()),
    planNotApproved: await post(draft.project, body({ sceneId: draft.scenes[0], versionId: v7() })),
    missingStageRow: await post(missingStage.project, body({ sceneId: missingStage.scenes[0], versionId: vMissingStage })),
  };
  const refusalCodes = Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, code(v)]));
  assert.deepEqual(refusalCodes, { staleRevision: "409:CONFLICT", selectionChanged: "409:CONFLICT", failedVersion: "409:INVALID_VERSION",
    archivedAsset: "409:INVALID_VERSION", revokedReceipt: "409:INVALID_VERSION", sampleAsset: "409:INVALID_VERSION", otherScenesVersion: "409:INVALID_VERSION",
    unknownVersion: "409:INVALID_VERSION", otherOwnerOnMine: "404:NOT_FOUND", mineOnOtherOwner: "404:NOT_FOUND", otherProjectsScene: "404:NOT_FOUND",
    archivedScene: "404:NOT_FOUND", archivedProject: "404:NOT_FOUND", unknownProject: "404:NOT_FOUND", planNotApproved: "409:PLAN_NOT_APPROVED",
    missingStageRow: "409:STAGE_LOCKED" });
  assert.equal(refusals.otherOwnerOnMine.raw, refusals.unknownProject.raw);
  assert.equal(await snapshot(), mark);
  out("refusals", { codes: refusalCodes, writes: 0, otherOwnerSameBodyAsUnknown: true });

  // 4) A version of an older plan is selectable and marked for recheck (product: needsRecheck = plan differs).
  const recheck = await post(main.project, body({ revision: 5, expectedVersionId: v1, versionId: vOld }));
  assert.deepEqual(recheck.body, { projectId: main.project, sceneId: s1, selectedVersionId: vOld, revision: 6, outcome: "selected" });
  assert.deepEqual((await projectState(main.project)).scenes[0], { id: s1, selected: vOld, recheck: 1 });
  const back = await post(main.project, body({ revision: 6, expectedVersionId: vOld, versionId: v2 }));
  assert.equal(back.body.revision, 7); assert.deepEqual((await projectState(main.project)).scenes[0], { id: s1, selected: v2, recheck: 0 });
  out("older-plan", { selected: code(recheck), needsRecheck: 1, thenCurrentPlanVersion: "needsRecheck 0", revision: "5->6->7" });

  // 5) Concurrency: six different requests from the same screen state -> exactly one transition.
  const race = await seedProject(A);
  const raceVersions = [];
  for (let i = 0; i < 6; i++) raceVersions.push(await version(race, race.scenes[0], i + 1, { asset: await asset(A) }));
  const raced = await Promise.all(raceVersions.map(v => post(race.project, body({ sceneId: race.scenes[0], versionId: v }))));
  const raceCodes = raced.map(code).sort();
  assert.deepEqual(raceCodes, ["200:selected", "409:CONFLICT", "409:CONFLICT", "409:CONFLICT", "409:CONFLICT", "409:CONFLICT"]);
  const raceState = await projectState(race.project);
  assert.equal(raceState.revision, 5); assert.equal(raceState.logs, 1); assert.equal(raceState.receipts, 1);
  assert.equal(raceState.scenes[0].selected, raced.find(r => r.status === 200).body.selectedVersionId);
  // Six copies of one request (a retried POST) -> one transition, the others replay the same answer.
  const same = body({ revision: 5, sceneId: race.scenes[0], versionId: raceVersions.find(v => v !== raceState.scenes[0].selected), expectedVersionId: raceState.scenes[0].selected });
  const copies = await Promise.all(Array.from({ length: 6 }, () => post(race.project, same)));
  assert.deepEqual(copies.map(code).sort(), ["200:replayed", "200:replayed", "200:replayed", "200:replayed", "200:replayed", "200:selected"]);
  assert(copies.every(r => r.body.revision === 6));
  const copyState = await projectState(race.project);
  assert.deepEqual([copyState.revision, copyState.logs, copyState.receipts], [6, 2, 2]);
  out("concurrency", { differentRequests: raceCodes, transitions: 1, sameRequestCopies: copies.map(code).sort(), sameRequestTransitions: 1 });

  // 6) Partial failure: the log or the receipt failing rolls back selection, revision and stages together.
  const partial = await seedProject(A);
  const vp = await version(partial, partial.scenes[0], 1, { asset: await asset(A) });
  const injected = {};
  for (const [name, table, cond] of [["activityLog", "dream.activity_log", "NEW.action='scene.select'"], ["receipt", "dream_scene_select.requests", "true"]]) {
    await admin.query(`CREATE FUNCTION public.p2sel_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected'; END$$;
      CREATE TRIGGER p2sel_fail BEFORE INSERT ON ${table} FOR EACH ROW WHEN (${cond}) EXECUTE FUNCTION public.p2sel_fail()`);
    const pState = await projectState(partial.project), m = await snapshot();
    try {
      const r = await post(partial.project, body({ sceneId: partial.scenes[0], versionId: vp }));
      injected[name] = code(r);
      assert.equal(await snapshot(), m); assert.deepEqual(await projectState(partial.project), pState);
    } finally { await admin.query(`DROP TRIGGER p2sel_fail ON ${table}; DROP FUNCTION public.p2sel_fail()`); }
  }
  assert.deepEqual(injected, { activityLog: "503:SCENE_SELECT_UNAVAILABLE", receipt: "503:SCENE_SELECT_UNAVAILABLE" });
  const recovered = await post(partial.project, body({ sceneId: partial.scenes[0], versionId: vp }));
  assert.equal(code(recovered), "200:selected");
  out("partial-failure", { injected, stateUnchanged: true, afterRemoval: code(recovered) });

  // 7) Lock order evidence: the selection waits for a plan save/approval holding the project row FOR UPDATE and for a
  // scene result registration holding it FOR SHARE, then reads the committed state.
  const lockOrder = {};
  for (const [name, lockSql] of [["projectForUpdate(plan save/approval)", "FOR UPDATE"], ["projectForShare(scene result registration)", "FOR SHARE"]]) {
    const target = await seedProject(A);
    const vt = await version(target, target.scenes[0], 1, { asset: await asset(A) });
    const holder = await connect("p102_root");
    try {
      await holder.query("BEGIN"); await holder.query("SELECT id FROM dream.projects WHERE id=$1 " + lockSql, [target.project]);
      const pending = post(target.project, body({ sceneId: target.scenes[0], versionId: vt }));
      let waited = false;
      for (let i = 0; i < 50 && !waited; i++) {
        await delay(40);
        waited = (await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename='dream_scene_select_app' AND wait_event_type='Lock'")).rows[0].n === 1;
      }
      await holder.query("COMMIT");
      lockOrder[name] = { waitedOnProjectRow: waited, then: code(await pending) };
    } finally { await holder.end(); }
  }
  assert(Object.values(lockOrder).every(v => v.waitedOnProjectRow && v.then === "200:selected"), JSON.stringify(lockOrder));
  out("lock-order", lockOrder);

  // 8) No permission / malformed: Auth first, never the body or params before it; no write.
  mark = await snapshot();
  let paramsReads = 0;
  const throwingParams = { then: () => { paramsReads += 1; throw new Error("params read"); } };
  const unauth = {
    required: await post(main.project, body(), { auth: async () => ({ kind: "denied", status: 401, code: "AUTH_REQUIRED" }), params: throwingParams, raw: "{" }),
    forbidden: await post(main.project, body(), { auth: async () => ({ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" }), params: throwingParams, raw: "{" }),
    authLocal: await post(main.project, body(), { auth: async () => ({ kind: "local" }), params: throwingParams }),
    authThrows: await post(main.project, body(), { auth: async () => { throw new Error("down"); }, params: throwingParams }),
    foreignOrigin: await post(main.project, body(), { headers: { ...sameOrigin, origin: "https://evil.example" }, params: throwingParams }),
    crossSiteFetch: await post(main.project, body(), { headers: { ...sameOrigin, "sec-fetch-site": "cross-site" }, params: throwingParams }),
    notJson: await post(main.project, body(), { headers: { ...sameOrigin, "content-type": "text/plain" }, params: throwingParams }),
    noBackend: await post(main.project, body(), { environment: {}, params: throwingParams }),
    backendUnconfigured: await post(main.project, body(), { openManaged: () => null, params: throwingParams }),
    invalidId: await post("not-a-project", body()),
    badJson: await post(main.project, null, { raw: "{" }),
    unknownField: await post(main.project, { ...body(), ownerId: B }),
    missingField: await post(main.project, { revision: 7, sceneId: s1, versionId: v1, expectedVersionId: v2 }),
    tooLarge: await post(main.project, null, { raw: JSON.stringify({ ...body(), pad: "x".repeat(3000) }) }),
  };
  const unauthCodes = Object.fromEntries(Object.entries(unauth).map(([k, v]) => [k, code(v)]));
  assert.deepEqual(unauthCodes, { required: "401:AUTH_REQUIRED", forbidden: "403:AUTH_FORBIDDEN", authLocal: "503:AUTH_UNAVAILABLE", authThrows: "503:AUTH_UNAVAILABLE",
    foreignOrigin: "403:AUTH_ORIGIN_REJECTED", crossSiteFetch: "403:AUTH_ORIGIN_REJECTED", notJson: "415:UNSUPPORTED_MEDIA_TYPE",
    noBackend: "503:SCENE_SELECT_UNAVAILABLE", backendUnconfigured: "503:SCENE_SELECT_UNAVAILABLE", invalidId: "400:INVALID_INPUT",
    badJson: "400:INVALID_INPUT", unknownField: "400:INVALID_INPUT", missingField: "400:INVALID_INPUT", tooLarge: "413:PAYLOAD_TOO_LARGE" });
  assert(Object.values(unauth).every(v => v.cache === "no-store"));
  assert.equal(paramsReads, 0);
  assert.equal(await snapshot(), mark);
  const routeReply = await route.POST(new Request("http://127.0.0.1/api/projects/" + main.project + "/scene-selection", { method: "POST", headers: sameOrigin, body: JSON.stringify(body()) }),
    { params: Promise.resolve({ id: main.project }) });
  assert.equal(typeof route.POST, "function"); assert.equal(route.GET, undefined);
  out("no-permission", { codes: unauthCodes, paramsReadsBeforeBackendAndParams: paramsReads, writes: 0, routeWithoutLoginOrBackend: routeReply.status + ":" + (await routeReply.json()).code });

  // 9) Installation drift fails closed (503) per request.
  const drift = {};
  for (const [name, change, undo] of [
    ["appTableRead", "GRANT USAGE ON SCHEMA dream TO dream_scene_select_app; GRANT SELECT (id) ON dream.scenes TO dream_scene_select_app", "REVOKE SELECT (id) ON dream.scenes FROM dream_scene_select_app; REVOKE USAGE ON SCHEMA dream FROM dream_scene_select_app"],
    ["appPolicy", "CREATE POLICY p2sel_extra ON dream.scenes FOR SELECT TO dream_scene_select_app USING (true)", "DROP POLICY p2sel_extra ON dream.scenes"],
    ["appMemberOfWriter", "GRANT dream_scene_select_writer TO dream_scene_select_app WITH INHERIT FALSE, SET TRUE", "REVOKE dream_scene_select_writer FROM dream_scene_select_app"],
    ["publicExecute", "GRANT EXECUTE ON FUNCTION dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid) TO PUBLIC", "REVOKE EXECUTE ON FUNCTION dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC"],
    ["receiptRead", "GRANT SELECT ON dream_scene_select.requests TO dream_scene_select_app", "REVOKE SELECT ON dream_scene_select.requests FROM dream_scene_select_app"],
  ]) {
    await admin.query(change);
    try { drift[name] = code(await post(main.project, body({ revision: 7, expectedVersionId: v2, versionId: v1 }))); } finally { await admin.query(undo); }
  }
  assert(Object.values(drift).every(v => v === "503:SCENE_SELECT_UNAVAILABLE"), JSON.stringify(drift));
  assert.equal(await snapshot(), mark);
  out("installation-drift", { codes: drift, writes: 0 });

  // 9b) Writer-role guard (independent review S4): the installer's approved ADMIN-only membership passes; any membership
  // that can SET or INHERIT the writer or app role, any other member, the writer joining a role, a wider writer grant or a
  // changed writer/function attribute fails the per-request re-check (503) before the function runs: no row changes.
  const memberState = async () => (await admin.query(`SELECT coalesce(jsonb_agg(jsonb_build_array(m.roleid::regrole::text,m.member::regrole::text,m.grantor::regrole::text,
      m.admin_option,m.inherit_option,m.set_option) ORDER BY m.roleid::regrole::text,m.member::regrole::text,m.grantor::regrole::text),'[]') AS s FROM pg_auth_members m
    WHERE m.roleid::regrole::text ~ '^dream_scene_select_' OR m.member::regrole::text ~ '^dream_scene_select_'`)).rows[0].s;
  const membersBefore = await memberState();
  assert.deepEqual(membersBefore.map(r => [r[0], r[1], r[3], r[4], r[5]]),
    [["dream_scene_select_app", "p102_migrate", true, false, false], ["dream_scene_select_writer", "p102_migrate", true, false, false]]);
  await admin.query("CREATE ROLE p2sel_other LOGIN NOINHERIT");
  const asInstaller = statement => "SET ROLE p102_migrate; " + statement + "; RESET ROLE";
  const fn = "dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)";
  const guardCases = [
    ["installerSetsWriterForItself", asInstaller("GRANT dream_scene_select_writer TO p102_migrate WITH INHERIT FALSE, SET TRUE"), asInstaller("REVOKE dream_scene_select_writer FROM p102_migrate GRANTED BY p102_migrate")],
    ["installerInheritsWriter", asInstaller("GRANT dream_scene_select_writer TO p102_migrate WITH INHERIT TRUE, SET FALSE"), asInstaller("REVOKE dream_scene_select_writer FROM p102_migrate GRANTED BY p102_migrate")],
    ["installerSetsAppForItself", asInstaller("GRANT dream_scene_select_app TO p102_migrate WITH INHERIT FALSE, SET TRUE"), asInstaller("REVOKE dream_scene_select_app FROM p102_migrate GRANTED BY p102_migrate")],
    ["otherLoginSetWriter", asInstaller("GRANT dream_scene_select_writer TO p2sel_other WITH INHERIT FALSE, SET TRUE"), asInstaller("REVOKE dream_scene_select_writer FROM p2sel_other")],
    ["otherLoginInheritWriter", asInstaller("GRANT dream_scene_select_writer TO p2sel_other WITH INHERIT TRUE, SET FALSE"), asInstaller("REVOKE dream_scene_select_writer FROM p2sel_other")],
    ["otherLoginAdminOnlyWriter", asInstaller("GRANT dream_scene_select_writer TO p2sel_other WITH ADMIN TRUE, INHERIT FALSE, SET FALSE"), asInstaller("REVOKE dream_scene_select_writer FROM p2sel_other")],
    ["writerJoinsRole", "GRANT dream_api TO dream_scene_select_writer WITH INHERIT FALSE, SET FALSE", "REVOKE dream_api FROM dream_scene_select_writer"],
    ["writerReadsSnapshot", "GRANT SELECT (input_snapshot_json) ON dream.scene_versions TO dream_scene_select_writer", "REVOKE SELECT (input_snapshot_json) ON dream.scene_versions FROM dream_scene_select_writer"],
    ["writerReadsFilePath", "GRANT SELECT (file_path) ON dream.assets TO dream_scene_select_writer", "REVOKE SELECT (file_path) ON dream.assets FROM dream_scene_select_writer"],
    ["writerInsertsAssets", "GRANT INSERT (id) ON dream.assets TO dream_scene_select_writer", "REVOKE INSERT (id) ON dream.assets FROM dream_scene_select_writer"],
    ["writerCreatesInSchema", "GRANT CREATE ON SCHEMA dream_scene_select TO dream_scene_select_writer", "REVOKE CREATE ON SCHEMA dream_scene_select FROM dream_scene_select_writer"],
    ["writerCanLogin", "ALTER ROLE dream_scene_select_writer LOGIN", "ALTER ROLE dream_scene_select_writer NOLOGIN"],
    ["writerInherits", "ALTER ROLE dream_scene_select_writer INHERIT", "ALTER ROLE dream_scene_select_writer NOINHERIT"],
    ["functionInvoker", "ALTER FUNCTION " + fn + " SECURITY INVOKER", "ALTER FUNCTION " + fn + " SECURITY DEFINER"],
  ];
  // Each request is built from the current revision and selection, so a guard that let the call through shows 200, not 409.
  const currentBody = async () => {
    const { rows: [row] } = await admin.query('SELECT p.content_revision::int AS revision, s.selected_version_id AS selected FROM dream.projects p JOIN dream.scenes s ON s.project_id=p.id WHERE s.id=$1', [s1]);
    return body({ revision: row.revision, expectedVersionId: row.selected, versionId: row.selected === v1 ? v2 : v1 });
  };
  const guard = {};
  for (const [name, change, undo] of guardCases) {
    await admin.query(change);
    try { guard[name] = code(await post(main.project, await currentBody())); }
    finally { await admin.query(undo); }
    assert.deepEqual(await memberState(), membersBefore, name);
  }
  assert(Object.values(guard).every(v => v === "503:SCENE_SELECT_UNAVAILABLE"), JSON.stringify(guard));
  assert.equal(await snapshot(), mark);
  // With the expected roles restored, the same login selects again and replays as before.
  const restored = body({ revision: 7, expectedVersionId: v2, versionId: v1 });
  const afterGuard = await post(main.project, restored);
  assert.deepEqual(afterGuard.body, { projectId: main.project, sceneId: s1, selectedVersionId: v1, revision: 8, outcome: "selected" });
  assert.equal(code(await post(main.project, restored)), "200:replayed");
  await admin.query("DROP ROLE p2sel_other");
  mark = await snapshot();
  out("writer-role-guard", { approvedMembership: "p102_migrate ADMIN-only on app and writer (from CREATE ROLE)", codes: guard,
    writesWhileRefused: 0, membershipsRestoredEachTime: true, afterRestore: code(afterGuard) + " revision 7->8, retry 200:replayed" });

  // 10) Direct SQL as the selection login: no table, no writer role, no receipts; only the function.
  const direct = async (text, values = []) => {
    const c = await connect("dream_scene_select_app", appSecret);
    try { await c.query("BEGIN"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [A]); const r = await c.query(text, values); return "rows:" + r.rowCount; }
    catch (error) { return error.code; } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
  };
  const defense = {
    readScenes: await direct("SELECT id FROM dream.scenes"),
    updateScene: await direct("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1", [s1, v1]),
    bumpRevision: await direct("UPDATE dream.projects SET content_revision=content_revision+1 WHERE id=$1", [main.project]),
    openStage: await direct("UPDATE dream.stage_states SET status='approved' WHERE project_id=$1", [main.project]),
    insertLog: await direct("INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at) VALUES($1,$2,$3,'managed-selector','scene.select','{}',now())", [A, v7(), main.project]),
    readReceipts: await direct("SELECT * FROM dream_scene_select.requests"),
    insertReceipt: await direct("INSERT INTO dream_scene_select.requests(owner_id,request_id,project_id,scene_id,version_id,previous_revision,content_revision,log_id,created_at) VALUES($1,$2,$3,$4,$5,1,2,$2,now())", [A, v7(), main.project, s1, v1]),
    setRoleWriter: await direct("SET ROLE dream_scene_select_writer"),
    setRoleApi: await direct("SET ROLE dream_api"),
    readInstallation: await direct("SELECT version FROM dream_scene_select.installation"),
  };
  assert.deepEqual(defense, { readScenes: "42501", updateScene: "42501", bumpRevision: "42501", openStage: "42501", insertLog: "42501", readReceipts: "42501",
    insertReceipt: "42501", setRoleWriter: "42501", setRoleApi: "42501", readInstallation: "rows:1" });
  assert.equal(await snapshot(), mark);
  out("database-defense", { attempts: Object.keys(defense).length, codes: defense });

  // 11) Existing roles, grants and policies unchanged after all requests.
  assert.deepEqual(await aclSnapshot(), beforeAcl);
  const writerScope = (await admin.query(`SELECT table_schema||'.'||table_name AS t, string_agg(privilege_type||'('||column_name||')', ',' ORDER BY privilege_type,column_name) AS p
    FROM information_schema.column_privileges WHERE grantee='dream_scene_select_writer' GROUP BY 1 ORDER BY 1`)).rows;
  out("preservation", { aclPoliciesRolesMembersUnchanged: true });
  out("writer-scope", { columnPrivileges: writerScope });
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
  assert.match(basename(actual), /^dream-p2sel-[A-Za-z0-9]+$/);
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
