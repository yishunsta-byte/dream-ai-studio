/* global console, process, Request, URL */
// P2 managed scene result registration HTTP candidate: isolated PG17 (TLS, non-superuser installer) + the product handler
// (sceneResultRegisterHandler -> project-core login reads the caller's own asset hash -> registration login runs
// dream_scene_result.register()). The connections are the product defaults (openManagedProjectCore, openManagedSceneResult,
// openManagedSceneSelect) built from environment values.
// Test doubles: the Auth decision is injected (resolveAuth), a socket redirect sends db.<ref>.supabase.co:5432 to the
// isolated cluster (same idea as managed-project-core-transport.mjs, no DNS lookup), asset rows/receipts are metadata
// fixtures (managed-project-core-asset-fixture.mjs, no storage provider), projects/scenes are seeded by the cluster superuser.
// Run (cwd = repo): P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/managed-scene-register-http.pg17.mjs
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import net, { createServer } from "node:net";
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
const { createSceneResultRegisterRequest, sceneResultRegisterHandler } = await tsModule("lib/services/postgres/scene-result-register.ts");
const { managedSceneResultConfig } = await tsModule("lib/cloud/managed-scene-result-connection.ts");
const { sceneSelectHandler, createSceneSelectRequest } = await tsModule("lib/services/postgres/scene-select.ts");
const route = await tsModule("app/api/projects/[id]/scene-results/route.ts");

const sql = async file => (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
const pinned = [
  ["0001_schema.sql", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification.sql", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
  ["managed-project-core/0001_install.sql", "c4e4bc131d2816e6107f0cff4033d8dc7b20825ccd56a6e40e8f6069f3546182"],
  ["managed-project-core/0002_asset_choices.sql", "5b96880eb254337bb7a095b8269a1cea2d9dfae366c1eb778e2276277d87546c"],
  ["managed-scene-result/0001_install.sql", "8201ea90addca44cc16b9eba4d852ceaeaef2133e5bafbe89b0cbba478c8a441"],
  ["managed-scene-result/0002_transaction.sql", "93d300d809c759e81b8ac938085ddda47c85a8ab2e6faa09e5f5efac48e2095a"],
  ["managed-scene-read/0001_install.sql", "ff1fee5a36dd863a5bca8675fbd8e7f829d2dc0d0a53dc607c0acae0f98ec89e"],
  ["managed-scene-select/0001_install.sql", "a6f32545211a5bf033297608c07b6e8d6eeb273686ffb4b96f3c6cf9f2f4ad8c"],
];
const sources = {};
for (const [file, hash] of pinned) { sources[file] = await sql(file); assert.equal(digest(sources[file]), hash, file); }
for (const file of ["managed-project-plan/0001_install.sql", "managed-project-plan/0002_approval.sql"]) sources[file] = await sql(file);
const out = (name, value) => console.log(JSON.stringify({ check: name, ...value }));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, loopback, resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent, "dream-p2reg-"));
const data = join(root, "cluster"), password = randomBytes(28).toString("hex"), port = await freePort();
// Test double: the product pools connect to db.<ref>.supabase.co:5432; send exactly that socket to the isolated cluster.
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  if (args[0] === 5432 && args[1] === dbHost) return socketConnect.call(this, port, loopback);
  if (typeof args[0] === "object" && args[0]?.host === dbHost && Number(args[0]?.port) === 5432) return socketConnect.call(this, { ...args[0], host: loopback, port }, ...args.slice(1));
  return socketConnect.apply(this, args);
};
let started = false, admin;
try {
  const pw = join(root, "bootstrap.txt");
  await writeFile(pw, password + "\n", { flag: "wx" });
  await pgExec("initdb", ["-D", data, "--username=p102_root", "--pwfile=" + pw, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
  await rm(pw);
  const ca = join(data, "server.crt"), key = join(data, "server.key"), cfg = join(root, "openssl.cnf");
  await writeFile(cfg, "[req]\ndistinguished_name=dn\n[dn]\n");
  await exec(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "1", "-config", cfg, "-subj", "/CN=P2 scene register isolated",
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

  // 1) Install as a non-superuser migration owner (published order, every candidate file pinned).
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
  const at = prefix => ({ ["dream." + prefix + ".install_ref"]: projectRef, ["dream." + prefix + ".install_database"]: "postgres" });
  for (const file of ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql", "0004_storage_verification.sql"]) await install(file);
  await install("managed-project-core/0001_install.sql", { "dream.project_core.install_ref": projectRef });
  await install("managed-project-core/0002_asset_choices.sql", { "dream.project_core.install_ref": projectRef });
  await install("managed-project-plan/0001_install.sql", at("managed_plan"));
  await install("managed-project-plan/0002_approval.sql", at("managed_plan"));
  await install("managed-scene-result/0001_install.sql", at("scene_result"));
  await install("managed-scene-result/0002_transaction.sql", at("scene_result"));
  await install("managed-scene-read/0001_install.sql", at("scene_read"));
  await install("managed-scene-select/0001_install.sql", at("scene_select"));
  // Every grant, policy, role attribute, membership and function ACL in the database (the route must not change any).
  const privileges = async () => (await admin.query(`SELECT md5(string_agg(t,'|' ORDER BY t)) AS h FROM (
      SELECT 'c|'||n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'') t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      UNION ALL SELECT 'a|'||a.attrelid::regclass::text||'.'||a.attname||'|'||a.attacl::text FROM pg_attribute a WHERE a.attacl IS NOT NULL
      UNION ALL SELECT 'p|'||polrelid::regclass::text||'.'||polname||'|'||polcmd::text||'|'||polroles::text||'|'||coalesce(pg_get_expr(polqual,polrelid),'')||'|'||coalesce(pg_get_expr(polwithcheck,polrelid),'') FROM pg_policy
      UNION ALL SELECT 'r|'||rolname||'|'||concat_ws(',',rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication)||'|'||coalesce(rolconfig::text,'') FROM pg_roles WHERE rolname !~ '^pg_'
      UNION ALL SELECT 'm|'||roleid::regrole::text||'|'||member::regrole::text||'|'||concat_ws(',',admin_option,inherit_option,set_option) FROM pg_auth_members
      UNION ALL SELECT 'f|'||p.oid::regprocedure::text||'|'||coalesce(p.proacl::text,'')||'|'||p.prosecdef::text||'|'||p.proowner::regrole::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      UNION ALL SELECT 'n|'||nspname||'|'||coalesce(nspacl::text,'') FROM pg_namespace WHERE nspname !~ '^pg_') x`)).rows[0].h;

  // Logins for the rehearsal only (operator step): random secrets, never printed.
  const secrets = { core: randomBytes(28).toString("hex"), result: randomBytes(28).toString("hex"), select: randomBytes(28).toString("hex") };
  await admin.query("ALTER ROLE dream_project_core_app LOGIN PASSWORD '" + secrets.core + "'");
  await admin.query("ALTER ROLE dream_scene_result_app LOGIN PASSWORD '" + secrets.result + "'; ALTER ROLE dream_scene_result_app SET plan_cache_mode='force_generic_plan'");
  await admin.query("ALTER ROLE dream_scene_select_app LOGIN PASSWORD '" + secrets.select + "'");
  const privilegesBefore = await privileges();
  out("install", { postgres: (await admin.query("SHOW server_version")).rows[0].server_version, tls: transport.version, pinnedFiles: pinned.length,
    nonSuperuserInstaller: true, logins: ["dream_project_core_app", "dream_scene_result_app", "dream_scene_select_app"] });

  // 2) Configuration: only DREAM_SCENE_RESULT_BACKEND + its own login on the project host is accepted.
  const dsn = (role, secret) => "postgresql://" + role + ":" + secret + "@" + dbHost + ":5432/postgres";
  const publicEnv = { DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://" + projectRef + ".supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_p102_fixture_only_key" };
  const fullEnv = { ...publicEnv,
    DREAM_PROJECT_CORE_BACKEND: "supabase-postgres", DREAM_PROJECT_CORE_DB_URL: dsn("dream_project_core_app", secrets.core), DREAM_PROJECT_CORE_DB_CA: cert,
    DREAM_SCENE_RESULT_BACKEND: "supabase-postgres", DREAM_SCENE_RESULT_DB_URL: dsn("dream_scene_result_app", secrets.result), DREAM_SCENE_RESULT_DB_CA: cert,
    DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_app", secrets.select), DREAM_SCENE_SELECT_DB_CA: cert };
  assert(managedSceneResultConfig(fullEnv));
  const refusedConfig = {
    noBackend: { ...fullEnv, DREAM_SCENE_RESULT_BACKEND: undefined },
    otherRole: { ...fullEnv, DREAM_SCENE_RESULT_DB_URL: dsn("dream_project_core_app", secrets.core) },
    authOff: { ...fullEnv, DREAM_AUTH_MODE: "off" },
    otherHost: { ...fullEnv, DREAM_SCENE_RESULT_DB_URL: "postgresql://dream_scene_result_app:x@127.0.0.1:5432/postgres" },
    otherDatabase: { ...fullEnv, DREAM_SCENE_RESULT_DB_URL: dsn("dream_scene_result_app", secrets.result).replace("/postgres", "/other") },
  };
  for (const [name, value] of Object.entries(refusedConfig)) assert.equal(managedSceneResultConfig(value), null, name);
  out("config", { accepted: "DREAM_SCENE_RESULT_BACKEND=supabase-postgres + own login on db.<ref>", refused: Object.keys(refusedConfig) });

  // Fixtures (superuser, synthetic): two owners, projects in several states, assets with receipts.
  const A = v7(), B = v7();
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  await fixturePolicy(admin);
  const SHA = "a".repeat(64);
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
        await admin.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_plan_id,approved_revision,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [owner, project, stage, status, planStage ? plan : null, planStage ? revision : null, status === "approved" ? new Date().toISOString() : null]);
      }
      for (const [i, id] of scenes.entries()) await admin.query(`INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec)
        VALUES($1,$2,$3,$4,'scene','desc','[]','[]',3)`, [owner, id, project, i + 1]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    return { owner, project, plan, scenes, revision };
  }
  const bypass = async fn => { await admin.query("SET session_replication_role=replica"); try { return await fn(); } finally { await admin.query("SET session_replication_role=origin"); } };
  const main = await seedProject(A), second = await seedProject(A), draft = await seedProject(A, { approved: false });
  const done = await seedProject(A, { produce: "approved" }), other = await seedProject(B);
  const [s1, s2, s3] = main.scenes;
  const imageA = await registeredAsset(admin, A, "image"), videoA = await registeredAsset(admin, A, "video");
  const assetB = await registeredAsset(admin, B, "image"), expiredA = await registeredAsset(admin, A, "image", true);
  const archivedA = await registeredAsset(admin, A, "image");
  await bypass(() => admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1", [archivedA]));
  const unverifiedA = v7(); // an asset row without a storage object or receipt
  await admin.query("INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,sha256,size_bytes,origin,created_at) VALUES($1,$2,'image','raw','original',$3,'image/png',$4,123,'upload',now())",
    [A, unverifiedA, A + "/assets/" + unverifiedA + "/" + SHA + ".png", SHA]);
  const rows = async () => (await admin.query(`SELECT md5(string_agg(t,'|' ORDER BY t)) h FROM (SELECT to_jsonb(x)::text t FROM dream.scenes x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.projects x UNION ALL SELECT to_jsonb(x)::text FROM dream.stage_states x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.activity_log x UNION ALL SELECT to_jsonb(x)::text FROM dream_scene_result.requests x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.project_assets x UNION ALL SELECT to_jsonb(x)::text FROM dream.scene_versions x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.assets x UNION ALL SELECT to_jsonb(x)::text FROM dream.asset_receipt_state x) s`)).rows[0].h;

  // The product handler and request object; only the Auth decision and the environment are injected.
  const verified = owner => async () => ({ kind: "verified", userId: owner, email: "fixture@example.invalid" });
  const sameOrigin = { origin: "http://127.0.0.1", host: "127.0.0.1", "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const replies = [];
  let paramReads = 0, envReads = 0;
  const post = async (id, payload, { auth = verified(A), environment = fullEnv, headers = sameOrigin, raw } = {}) => {
    const handler = sceneResultRegisterHandler(() => createSceneResultRegisterRequest({ resolveAuth: auth, environment: () => { envReads++; return environment; } }));
    const request = new Request("http://127.0.0.1/api/projects/" + id + "/scene-results", { method: "POST", headers, body: raw ?? JSON.stringify(payload) });
    const response = await handler(request, { params: { then(resolve) { paramReads++; resolve({ id }); } } }); // counted only when awaited
    const text = await response.text();
    replies.push(text);
    return { status: response.status, cache: response.headers.get("cache-control"), body: JSON.parse(text) };
  };
  const code = r => r.status + ":" + (r.body.code ?? r.body.outcome);
  const input = (extra = {}) => ({ requestId: v7(), revision: main.revision, sceneId: s1, assetId: imageA, ...extra });

  // 3) New registration: 201 with the server-held asset hash recorded; the project revision does not move.
  const before = await rows();
  const first = input();
  const created = await post(main.project, first);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.cache, "no-store");
  assert.deepEqual({ ...created.body, versionId: "x" }, { projectId: main.project, sceneId: s1, assetId: imageA, versionId: "x", version: 1, outcome: "created" });
  const { rows: [saved] } = await admin.query("SELECT owner_id,scene_id,version::int,plan_id,kind,result_asset_id,status,input_snapshot_json::jsonb AS input FROM dream.scene_versions WHERE id=$1", [created.body.versionId]);
  assert.deepEqual({ ...saved, input: { ...saved.input, requestId: "x" } }, { owner_id: A, scene_id: s1, version: 1, plan_id: main.plan, kind: "image", result_asset_id: imageA, status: "succeeded",
    input: { schemaVersion: 1, source: "managed-source", requestId: "x", projectId: main.project, sceneId: s1, assetId: imageA, sha256: SHA, sizeBytes: 123 } });
  assert.equal(saved.input.requestId, first.requestId);
  assert.equal((await admin.query("SELECT content_revision::int r FROM dream.projects WHERE id=$1", [main.project])).rows[0].r, main.revision);
  const { rows: [linked] } = await admin.query(`SELECT (SELECT count(*)::int FROM dream.project_assets WHERE project_id=$1 AND asset_id=$2 AND purpose='scene_result') links,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='scene.result_register') logs,
    (SELECT count(*)::int FROM dream_scene_result.requests WHERE project_id=$1) receipts`, [main.project, imageA]);
  assert.deepEqual(linked, { links: 1, logs: 1, receipts: 1 });
  assert.notEqual(await rows(), before);
  out("created", { status: 201, version: 1, storedHashFromServer: true, revisionUnchanged: main.revision, rows: linked });

  // 4) Same request again: 200 replayed with the same version, no write. Same key, different content: 409, no write.
  const afterCreate = await rows();
  const replay = await post(main.project, first);
  assert.deepEqual([replay.status, replay.body.outcome, replay.body.versionId, replay.body.version], [200, "replayed", created.body.versionId, 1]);
  const reused = await post(main.project, { ...first, assetId: videoA });
  assert.equal(code(reused), "409:CONFLICT");
  assert.equal(await rows(), afterCreate);
  out("same-request", { replay: "200 replayed same version", reusedWithOtherAsset: "409 CONFLICT", writes: 0 });

  // 5) Refusals: every one leaves all rows unchanged.
  const refusals = {
    otherOwnerOnMyProject: await post(main.project, input({ assetId: assetB }), { auth: verified(B) }),
    myAssetOnOtherOwnersProject: await post(other.project, input({ sceneId: other.scenes[0] })),
    otherOwnersAsset: await post(main.project, input({ assetId: assetB })),
    otherOwnerUsingMyAsset: await post(other.project, input({ sceneId: other.scenes[0] }), { auth: verified(B) }),
    otherProjectsScene: await post(main.project, input({ sceneId: second.scenes[0] })),
    unknownScene: await post(main.project, input({ sceneId: v7() })),
    unknownProject: await post(v7(), input()),
    unknownAsset: await post(main.project, input({ assetId: v7() })),
    staleRevision: await post(main.project, input({ revision: main.revision - 1 })),
    futureRevision: await post(main.project, input({ revision: main.revision + 1 })),
    planNotApproved: await post(draft.project, input({ sceneId: draft.scenes[0] })),
    produceApproved: await post(done.project, input({ sceneId: done.scenes[0] })),
    expiredReceipt: await post(main.project, input({ assetId: expiredA })),
    archivedAsset: await post(main.project, input({ assetId: archivedA })),
    unverifiedAsset: await post(main.project, input({ assetId: unverifiedA })),
  };
  const refusalCodes = Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, code(v)]));
  assert.deepEqual(refusalCodes, {
    otherOwnerOnMyProject: "404:NOT_FOUND", myAssetOnOtherOwnersProject: "404:NOT_FOUND", otherOwnersAsset: "404:NOT_FOUND",
    otherOwnerUsingMyAsset: "404:NOT_FOUND", otherProjectsScene: "404:NOT_FOUND", unknownScene: "404:NOT_FOUND", unknownProject: "404:NOT_FOUND",
    unknownAsset: "404:NOT_FOUND", staleRevision: "409:CONFLICT", futureRevision: "409:CONFLICT", planNotApproved: "409:PLAN_NOT_APPROVED",
    produceApproved: "409:STAGE_LOCKED", expiredReceipt: "409:ASSET_NOT_READY", archivedAsset: "409:ASSET_NOT_READY", unverifiedAsset: "409:ASSET_NOT_READY",
  });
  // Another owner's view of a missing project and of my project is the same body.
  assert.deepEqual(refusals.otherOwnerOnMyProject.body, refusals.unknownProject.body);
  assert.equal(await rows(), afterCreate);
  out("refusals", { codes: refusalCodes, writes: 0, otherOwnerBodyEqualsMissing: true });

  // 6) The body is strict: a client hash, owner, receipt or extra field is refused before any database call.
  const trust = {
    clientSha256: await post(main.project, { ...input(), sha256: "f".repeat(64) }),
    clientOwner: await post(main.project, { ...input(), ownerId: B }),
    clientReceipt: await post(main.project, { ...input(), receiptId: v7(), verifiedAt: new Date().toISOString() }),
    clientProjectId: await post(main.project, { ...input(), projectId: other.project }),
    missingAsset: await post(main.project, { requestId: v7(), revision: main.revision, sceneId: s1 }),
    badRequestId: await post(main.project, input({ requestId: "not-a-uuid" })),
    revisionZero: await post(main.project, input({ revision: 0 })),
    revisionText: await post(main.project, input({ revision: "3" })),
    notJson: await post(main.project, null, { raw: "{" }),
    projectNotUuid: await post("not-a-uuid", input()),
  };
  assert(Object.values(trust).every(r => code(r) === "400:INVALID_INPUT"), JSON.stringify(Object.fromEntries(Object.entries(trust).map(([k, v]) => [k, code(v)]))));
  assert.equal(await rows(), afterCreate);
  out("body-trust", { refused: Object.keys(trust), status: "400 INVALID_INPUT", writes: 0 });

  // 7) Auth first (no environment, params or body read on refusal), then origin, type and size.
  const reads = { env: envReads, params: paramReads };
  const authCodes = {
    anonymous: code(await post(main.project, input(), { auth: async () => ({ kind: "denied", status: 401, code: "AUTH_REQUIRED" }) })),
    notAllowed: code(await post(main.project, input(), { auth: async () => ({ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" }) })),
    authThrows: code(await post(main.project, input(), { auth: async () => { throw new Error("synthetic auth outage"); } })),
    noEmail: code(await post(main.project, input(), { auth: async () => ({ kind: "verified", userId: A, email: "" }) })),
    badUserId: code(await post(main.project, input(), { auth: async () => ({ kind: "verified", userId: "not-a-uuid", email: "x@example.invalid" }) })),
  };
  assert.deepEqual(authCodes, { anonymous: "401:AUTH_REQUIRED", notAllowed: "403:AUTH_FORBIDDEN", authThrows: "503:AUTH_UNAVAILABLE", noEmail: "503:AUTH_UNAVAILABLE", badUserId: "503:AUTH_UNAVAILABLE" });
  assert.deepEqual({ env: envReads, params: paramReads }, reads);
  const transportCodes = {
    foreignOrigin: code(await post(main.project, input(), { headers: { ...sameOrigin, origin: "https://foreign.invalid" } })),
    crossSite: code(await post(main.project, input(), { headers: { ...sameOrigin, "sec-fetch-site": "cross-site" } })),
    textBody: code(await post(main.project, input(), { headers: { ...sameOrigin, "content-type": "text/plain" } })),
    tooLarge: code(await post(main.project, null, { raw: JSON.stringify({ ...input(), pad: "x".repeat(2100) }) })),
  };
  assert.deepEqual(transportCodes, { foreignOrigin: "403:AUTH_ORIGIN_REJECTED", crossSite: "403:AUTH_ORIGIN_REJECTED", textBody: "415:UNSUPPORTED_MEDIA_TYPE", tooLarge: "413:PAYLOAD_TOO_LARGE" });
  assert.equal(await rows(), afterCreate);
  out("auth-transport", { auth: authCodes, envOrParamsReadOnAuthRefusal: 0, transport: transportCodes, writes: 0 });

  // 8) Backends: both managed logins are required; nothing falls back to local SQLite.
  const backendCodes = {
    noRegistrationBackend: code(await post(main.project, input(), { environment: { ...fullEnv, DREAM_SCENE_RESULT_BACKEND: undefined } })),
    noCoreBackend: code(await post(main.project, input(), { environment: { ...fullEnv, DREAM_PROJECT_CORE_BACKEND: undefined } })),
    registrationOtherRole: code(await post(main.project, input(), { environment: refusedConfig.otherRole })),
    authModeOff: code(await post(main.project, input(), { environment: refusedConfig.authOff })),
  };
  assert(Object.values(backendCodes).every(c => c === "503:SCENE_RESULT_UNAVAILABLE"), JSON.stringify(backendCodes));
  assert.equal(await rows(), afterCreate);
  out("backends", { codes: backendCodes, writes: 0 });

  // 9) Database failures roll everything back and answer 503 without internals; the same request then succeeds.
  const retry = input({ sceneId: s2, assetId: videoA });
  await admin.query("CREATE FUNCTION public.p2reg_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='scene.result_register' THEN RAISE EXCEPTION 'synthetic register failure dream_scene_result PG_TRANSACTION'; END IF; RETURN NEW; END $$; CREATE TRIGGER p2reg_fail BEFORE INSERT ON dream.activity_log FOR EACH ROW EXECUTE FUNCTION public.p2reg_fail()");
  let failed;
  try { failed = await post(main.project, retry); } finally { await admin.query("DROP TRIGGER p2reg_fail ON dream.activity_log; DROP FUNCTION public.p2reg_fail()"); }
  assert.equal(code(failed), "503:SCENE_RESULT_UNAVAILABLE");
  assert.equal(await rows(), afterCreate);
  const drift = {};
  await admin.query("UPDATE dream_scene_result.installation SET project_ref='zzzzzzzzzzzzzzzzzzzz'");
  try { drift.registrationInstallation = code(await post(main.project, retry)); } finally { await admin.query("UPDATE dream_scene_result.installation SET project_ref=$1", [projectRef]); }
  await admin.query("UPDATE dream_project_core.installation SET project_ref='zzzzzzzzzzzzzzzzzzzz'");
  try { drift.coreInstallation = code(await post(main.project, retry)); } finally { await admin.query("UPDATE dream_project_core.installation SET project_ref=$1", [projectRef]); }
  await admin.query("GRANT dream_api TO dream_scene_result_app WITH INHERIT FALSE, SET TRUE");
  try { drift.registrationLoginWidened = code(await post(main.project, retry)); } finally { await admin.query("REVOKE dream_api FROM dream_scene_result_app"); }
  const blocker = await connect("p102_root");
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM dream.projects WHERE id=$1 FOR UPDATE", [main.project]);
    const started = Date.now();
    drift.projectRowLocked = code(await post(main.project, retry));
    drift.lockWaitMs = Date.now() - started;
  } finally { await blocker.query("ROLLBACK"); await blocker.end(); }
  assert.deepEqual({ ...drift, lockWaitMs: drift.lockWaitMs >= 5000 }, { registrationInstallation: "503:SCENE_RESULT_UNAVAILABLE", coreInstallation: "503:SCENE_RESULT_UNAVAILABLE",
    registrationLoginWidened: "503:SCENE_RESULT_UNAVAILABLE", projectRowLocked: "503:SCENE_RESULT_UNAVAILABLE", lockWaitMs: true });
  assert.equal(await rows(), afterCreate);
  const recovered = await post(main.project, retry);
  assert.deepEqual([recovered.status, recovered.body.version, recovered.body.outcome], [201, 1, "created"]);
  out("database-failures", { failedWrite: "503 SCENE_RESULT_UNAVAILABLE, rows unchanged", drift, retryAfterRecovery: "201 created" });

  // 10) Concurrency: the same request twice -> one created, one replayed (same version); 6 different requests on one scene ->
  // 6 versions numbered without gaps.
  const twin = input({ sceneId: s3 });
  const pair = await Promise.all([post(main.project, twin), post(main.project, twin)]);
  assert.deepEqual(pair.map(r => r.status).sort(), [200, 201]);
  assert.equal(pair[0].body.versionId, pair[1].body.versionId);
  const assets6 = [];
  for (let i = 0; i < 6; i++) assets6.push(await registeredAsset(admin, A, "image"));
  const many = await Promise.all(assets6.map(asset => post(main.project, input({ sceneId: s3, assetId: asset }))));
  assert(many.every(r => r.status === 201), JSON.stringify(many.map(code)));
  assert.deepEqual(many.map(r => r.body.version).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7]);
  out("concurrency", { sameRequest: pair.map(r => r.status).sort(), sixRequests: "201 x6, versions 2..7" });

  // 11) The registered version is selectable through the existing selection route (default connection), and the next
  // registration must use the revision the selection produced.
  const select = sceneSelectHandler(() => createSceneSelectRequest({ resolveAuth: verified(A), environment: () => fullEnv }));
  const selectReply = await select(new Request("http://127.0.0.1/api/projects/" + main.project + "/scene-selection", { method: "POST", headers: sameOrigin,
    body: JSON.stringify({ requestId: v7(), revision: main.revision, sceneId: s1, versionId: created.body.versionId, expectedVersionId: null }) }), { params: Promise.resolve({ id: main.project }) });
  const selected = await selectReply.json();
  assert.deepEqual([selectReply.status, selected.outcome, selected.revision], [200, "selected", main.revision + 1]);
  assert.equal(code(await post(main.project, input({ sceneId: s1, assetId: videoA }))), "409:CONFLICT");
  const afterSelect = await post(main.project, input({ sceneId: s1, assetId: videoA, revision: main.revision + 1 }));
  assert.deepEqual([afterSelect.status, afterSelect.body.version], [201, 2]);
  out("select-link", { registeredThenSelected: "200 selected revision " + main.revision + "->" + (main.revision + 1),
    oldRevisionAfterSelect: "409 CONFLICT", newRevision: "201 version 2" });

  // 12) Responses never carry internals or secrets; privileges are unchanged; the route module exposes POST only.
  const leaks = [/PG_/, /postgres/i, /dream_/, /synthetic/i, /\/assets\//, /\bat [\w.]+ \(/, /password/i, new RegExp(SHA), ...Object.values(secrets).map(s => new RegExp(s))];
  const leaked = replies.filter(text => leaks.some(pattern => pattern.test(text)));
  assert.deepEqual(leaked, []);
  assert.equal(await privileges(), privilegesBefore);
  assert.equal(typeof route.POST, "function");
  assert.equal(route.GET, undefined);
  const defaultRoute = await route.POST(new Request("http://127.0.0.1/api/projects/" + main.project + "/scene-results", { method: "POST", headers: sameOrigin, body: JSON.stringify(input()) }),
    { params: Promise.resolve({ id: main.project }) });
  assert.equal(defaultRoute.status, 503); // no Auth configuration in this process
  await defaultRoute.body?.cancel();
  const { rows: tls } = await admin.query(`SELECT a.usename AS role, bool_and(s.ssl AND s.version='TLSv1.3') AS verified FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid)
    WHERE a.usename IN ('dream_project_core_app','dream_scene_result_app','dream_scene_select_app') GROUP BY a.usename ORDER BY a.usename`);
  assert.deepEqual(tls, [{ role: "dream_project_core_app", verified: true }, { role: "dream_scene_result_app", verified: true }, { role: "dream_scene_select_app", verified: true }]);
  out("preservation", { responsesChecked: replies.length, internalsOrSecretsInResponses: 0, privilegesUnchanged: true, routeMethods: ["POST"],
    defaultRouteWithoutAuthConfig: 503, runtimeLoginsTls: tls.map(r => r.role) });
  console.log(JSON.stringify({ result: "PASS" }));
} catch (error) {
  const log = await readFile(join(root, "postgres.log"), "utf8").catch(() => "");
  console.error(log.split(/\r?\n/).filter(line => / (?:ERROR|FATAL):/.test(line)).slice(-12).join("\n"));
  throw error;
} finally {
  await admin?.end().catch(() => {});
  if (started) await pgExec("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "50", "stop"]);
  const actual = await realpath(root);
  assert.equal(dirname(actual), parent);
  assert.match(basename(actual), /^dream-p2reg-[A-Za-z0-9]+$/);
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
