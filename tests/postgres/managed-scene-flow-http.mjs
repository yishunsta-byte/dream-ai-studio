/* global console, URL */
// P2 managed scene flow (integration candidate): one isolated PG17 cluster, the existing managed project/brief/plan/approval
// handlers on the real Next production server, then the candidate scene-result registration service, the scene read route
// (first page and older pages), the scene-selection route and a re-read. Runs after --http --plan-approval:
//   P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/managed-project-core.pg17.mjs --http --plan-approval --scene-flow
// Test doubles (all synthetic): the HTTPS Supabase Auth stand-in and DNS/TLS transport from managed-project-core-http.mjs,
// asset rows from managed-project-core-asset-fixture.mjs (metadata only, no storage provider), fault triggers created by the
// cluster superuser, and the registration service called in-process (it has no route) with an injected verified actor.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { checkServerIdentity } from "node:tls";
import pg from "pg";
import { v7 } from "uuid";
import { approvalCommand, createBrief, route as planRoute, samplePlan } from "./managed-plan-core-http.mjs";
import { registeredAsset } from "./managed-project-core-asset-fixture.mjs";

const SHA = "a".repeat(64); // the fixture's stored-bytes hash
const newRoles = "^dream_scene_(result|read|select)_(app|writer)";
const out = (check, value) => console.log(JSON.stringify({ check, ...value }));
const digest = text => createHash("sha256").update(text).digest("hex");

export async function verifySceneFlow(context, draftConfig) {
  const { admin, rootPath, projectRef, dbHost, cert, port, loopback, users, startProfile, body, command } = context;
  const tsModule = path => import(new URL(path, rootPath).href);
  const { withActorTransaction } = await tsModule("lib/db/postgres/transaction.ts");
  const { actorFromVerifiedUserId } = await tsModule("lib/db/postgres/types.ts");
  const { registerManagedSceneResult, sceneResultSession, isSceneResultError } = await tsModule("lib/cloud/managed-scene-result.ts");

  // 1) Install: managed-project-core 0002 (a stated prerequisite of the registration install), then the four candidate files.
  const sql = async file => (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
  const install = async (file, settings = {}) => {
    const text = await sql(file);
    await admin.query("SET ROLE p102_migrate");
    try {
      for (const [name, value] of Object.entries(settings)) await admin.query("SELECT set_config($1,$2,false)", [name, value]);
      assert.equal((await admin.query(text)).at(-1).command, "COMMIT", file);
    } catch (error) { await admin.query("ROLLBACK").catch(() => {}); throw error; }
    finally { await admin.query("RESET ROLE"); }
    return digest(text);
  };
  const hashes = {};
  hashes["managed-project-core/0002_asset_choices.sql"] = await install("managed-project-core/0002_asset_choices.sql", { "dream.project_core.install_ref": projectRef });

  // Everything that is not one of the new scene roles/schemas: must be identical before and after the four installs and the flow.
  const existingSnapshot = async () => (await admin.query(`SELECT jsonb_build_object(
      'relations', (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text,
          ARRAY(SELECT x::text FROM unnest(coalesce(c.relacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY n.nspname,c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials','auth','public')),
      'columns', (SELECT jsonb_agg(row ORDER BY row) FROM (SELECT jsonb_build_array(n.nspname,c.relname,a.attname,
          ARRAY(SELECT x::text FROM unnest(a.attacl) x WHERE x::text !~ $1 ORDER BY 1)) AS row
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials') AND a.attnum>0 AND a.attacl IS NOT NULL
          AND EXISTS (SELECT FROM unnest(a.attacl) x WHERE x::text !~ $1)) s),
      'policies', (SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,
          (SELECT array_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid=ANY(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
          ORDER BY c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        WHERE NOT EXISTS (SELECT FROM pg_roles r WHERE r.oid=ANY(p.polroles) AND r.rolname ~ $2)),
      'roles', (SELECT jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication) ORDER BY rolname)
        FROM pg_roles WHERE rolname !~ $2 AND rolname !~ '^pg_'),
      'members', (SELECT jsonb_agg(jsonb_build_array(m.roleid::regrole::text,m.member::regrole::text,m.admin_option,m.inherit_option,m.set_option)
          ORDER BY m.roleid::regrole::text,m.member::regrole::text) FROM pg_auth_members m
        WHERE m.roleid::regrole::text !~ $2 AND m.member::regrole::text !~ $2 AND m.roleid::regrole::text !~ '^pg_'),
      'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname,nspowner::regrole::text,ARRAY(SELECT x::text FROM unnest(coalesce(nspacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY nspname)
        FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','dream_scene_result','dream_scene_read','dream_scene_select')),
      'functions', (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.prosecdef,p.proowner::regrole::text,
          ARRAY(SELECT x::text FROM unnest(coalesce(p.proacl,'{}'::aclitem[])) x WHERE x::text !~ $1 ORDER BY 1)) ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('dream','dream_project_core','managed_project_plan','local_plan_materials','public'))
    ) AS snap`, [newRoles + "=", newRoles + "$"])).rows[0].snap;
  // Everything one new scene role can do (grants anywhere, policies naming it, memberships). Role attributes are compared separately.
  const roleScope = async role => (await admin.query(`SELECT jsonb_build_object(
      'relations', (SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,x::text) ORDER BY n.nspname,c.relname,x::text),'[]')
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, unnest(coalesce(c.relacl,'{}'::aclitem[])) x WHERE x::text ~ ('^'||$1||'=')),
      'columns', (SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,x::text) ORDER BY n.nspname,c.relname,a.attname,x::text),'[]')
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace, unnest(coalesce(a.attacl,'{}'::aclitem[])) x
        WHERE a.attnum>0 AND x::text ~ ('^'||$1||'=')),
      'functions', (SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,x::text) ORDER BY p.oid::regprocedure::text,x::text),'[]')
        FROM pg_proc p, unnest(coalesce(p.proacl,'{}'::aclitem[])) x WHERE x::text ~ ('^'||$1||'=')),
      'owned', (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p WHERE p.proowner=$1::regrole),
      'schemas', (SELECT coalesce(jsonb_agg(jsonb_build_array(nspname,x::text) ORDER BY nspname,x::text),'[]')
        FROM pg_namespace, unnest(coalesce(nspacl,'{}'::aclitem[])) x WHERE x::text ~ ('^'||$1||'=')),
      'policies', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd) ORDER BY c.relname,p.polname),'[]')
        FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE $1::regrole=ANY(p.polroles)),
      'members', (SELECT coalesce(jsonb_agg(jsonb_build_array(m.roleid::regrole::text,m.member::regrole::text,m.admin_option,m.inherit_option,m.set_option)
          ORDER BY m.roleid::regrole::text,m.member::regrole::text),'[]') FROM pg_auth_members m WHERE m.roleid=$1::regrole OR m.member=$1::regrole),
      'attributes', (SELECT jsonb_build_array(rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication) FROM pg_roles WHERE rolname=$1)
    ) AS scope`, [role])).rows[0].scope;
  const browserExposure = async () => (await admin.query(`SELECT count(*)::int AS n FROM pg_roles r CROSS JOIN unnest(ARRAY['dream_scene_result','dream_scene_read','dream_scene_select']) s
    WHERE r.rolname IN ('anon','authenticated','authenticator') AND (has_schema_privilege(r.oid,s,'USAGE')
      OR EXISTS (SELECT FROM pg_roles x WHERE x.rolname ~ $1 AND pg_has_role(r.oid,x.oid,'MEMBER')))`, [newRoles + "$"])).rows[0].n;

  const before = await existingSnapshot();
  const settingsOf = prefix => ({ ["dream." + prefix + ".install_ref"]: projectRef, ["dream." + prefix + ".install_database"]: "postgres" });
  const steps = [
    ["managed-scene-result/0001_install.sql", "scene_result", []],
    ["managed-scene-result/0002_transaction.sql", "scene_result", ["dream_scene_result_app", "dream_scene_result_writer"]],
    ["managed-scene-read/0001_install.sql", "scene_read", ["dream_scene_read_app"]],
    ["managed-scene-select/0001_install.sql", "scene_select", ["dream_scene_select_app", "dream_scene_select_writer"]],
  ];
  const scopes = {};
  for (const [file, prefix, roles] of steps) {
    hashes[file] = await install(file, settingsOf(prefix));
    for (const role of roles) scopes[role] = await roleScope(role);
    // Every role installed so far keeps exactly the scope it had right after its own install.
    for (const [role, scope] of Object.entries(scopes)) assert.deepEqual(await roleScope(role), scope, role + " after " + file);
  }
  assert.deepEqual(await existingSnapshot(), before, "existing grants, policies, roles, memberships, schemas and functions");
  assert.equal(await browserExposure(), 0);
  out("flow-install", { order: steps.map(s => s[0]), sha256LF: hashes, existingPrivilegesUnchanged: true,
    roleScopesStableAcrossLaterInstalls: Object.keys(scopes), browserGrants: 0 });

  // 2) Login provisioning for the rehearsal only (operator step). Random secrets, never printed.
  const secret = () => randomBytes(28).toString("hex");
  const sResult = secret(), sRead = secret(), sSelect = secret(), sApprove = secret();
  await admin.query("ALTER ROLE dream_scene_result_app LOGIN PASSWORD '" + sResult + "'; ALTER ROLE dream_scene_result_app SET plan_cache_mode='force_generic_plan'");
  await admin.query("ALTER ROLE dream_scene_read_app LOGIN PASSWORD '" + sRead + "'");
  await admin.query("ALTER ROLE dream_scene_select_app LOGIN PASSWORD '" + sSelect + "'");
  await admin.query("ALTER ROLE dream_plan_approver PASSWORD '" + sApprove + "'"); // LOGIN + plan_cache_mode already set by the approval run
  const dsn = (role, value) => "postgresql://" + role + ":" + value + "@" + dbHost + ":5432/postgres";
  const env = { ...draftConfig.env,
    DREAM_PROJECT_PLAN_APPROVAL_BACKEND: "supabase-postgres", DREAM_PROJECT_PLAN_APPROVAL_DB_URL: dsn("dream_plan_approver", sApprove), DREAM_PROJECT_PLAN_APPROVAL_DB_CA: cert,
    DREAM_SCENE_READ_BACKEND: "supabase-postgres", DREAM_SCENE_READ_DB_URL: dsn("dream_scene_read_app", sRead), DREAM_SCENE_READ_DB_CA: cert,
    DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_app", sSelect), DREAM_SCENE_SELECT_DB_CA: cert };
  const pool = new pg.Pool({ host: loopback, port, database: "postgres", user: "dream_scene_result_app", password: sResult,
    ssl: { ca: cert, servername: dbHost, rejectUnauthorized: true, checkServerIdentity }, max: 6, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {});
  const [A, B] = [users[0].id, users[1].id];
  const register = (owner, input) => withActorTransaction(pool, actorFromVerifiedUserId(owner), tx => registerManagedSceneResult(tx, input),
    { prepareSession: sceneResultSession(projectRef), preserveDomainError: isSceneResultError })
    .then(value => ({ ok: true, ...value }), error => ({ ok: false, code: error.code ?? error.name }));

  const state = async id => (await admin.query(`SELECT
      (SELECT content_revision::int FROM dream.projects WHERE id=$1) AS revision,
      (SELECT coalesce(jsonb_agg(jsonb_build_array(s.id,s.selected_version_id,s.needs_recheck) ORDER BY s.position),'[]') FROM dream.scenes s WHERE s.project_id=$1) AS scenes,
      (SELECT count(*)::int FROM dream.scene_versions v JOIN dream.scenes s ON (s.owner_id,s.id)=(v.owner_id,v.scene_id) WHERE s.project_id=$1) AS versions,
      (SELECT count(*)::int FROM dream_scene_result.requests WHERE project_id=$1) AS result_requests,
      (SELECT count(*)::int FROM dream_scene_select.requests WHERE project_id=$1) AS select_requests,
      (SELECT count(*)::int FROM dream.project_assets WHERE project_id=$1) AS links,
      (SELECT coalesce(jsonb_object_agg(action,n),'{}') FROM (SELECT action,count(*)::int n FROM dream.activity_log WHERE project_id=$1 GROUP BY action) a) AS audit,
      (SELECT jsonb_object_agg(stage,status) FROM dream.stage_states WHERE project_id=$1) AS stages`, [id])).rows[0];

  await startProfile(env, async call => {
    const scenesPath = id => "/api/projects/" + id + "/scenes";
    const selectPath = id => "/api/projects/" + id + "/scene-selection";
    const project = await createBrief({ call, body, command }, 17);
    const saved = await body(call(planRoute(project.id), { input: { revision: project.revision, version: 0, ...samplePlan(17) } }), 201, "plan save");

    // 3) Before approval: the read is empty, registration and selection refuse, nothing is written.
    const early = await body(call(scenesPath(project.id)), 200, "read before approval");
    assert.deepEqual({ approvedPlanId: early.approvedPlanId, scenes: early.scenes, produce: early.stages.produce }, { approvedPlanId: null, scenes: [], produce: "locked" });
    const earlyAsset = await registeredAsset(admin, A, "image");
    const earlyRegister = await register(A, { requestId: v7(), projectId: project.id, sceneId: v7(), assetId: earlyAsset, sha256: SHA, revision: early.revision });
    const earlySelect = await body(call(selectPath(project.id), { input: { requestId: v7(), revision: early.revision, sceneId: v7(), versionId: v7(), expectedVersionId: null } }), 409, "select before approval");
    assert.deepEqual([earlyRegister, earlySelect.code], [{ ok: false, code: "PLAN_NOT_APPROVED" }, "PLAN_NOT_APPROVED"]);
    const beforeApproval = await state(project.id);
    assert.deepEqual([beforeApproval.versions, beforeApproval.result_requests, beforeApproval.select_requests, beforeApproval.scenes], [0, 0, 0, []]);
    out("flow-before-approval", { read: "200 scenes [] plan " + early.stages.plan + " / produce locked", register: earlyRegister.code, select: "409 " + earlySelect.code, writes: 0 });

    // 4) Existing approval handler creates the scenes; project read and scene read agree on the revision.
    const approved = await body(call(planRoute(project.id), { input: approvalCommand(saved) }), 200, "approve");
    assert.equal(approved.approved, true);
    const afterApproval = await state(project.id);
    const R0 = afterApproval.revision;
    const projectView0 = await body(call("/api/projects/" + project.id), 200, "project read");
    assert.equal(projectView0.project.approvedPlanId, saved.planId);
    const first = await body(call(scenesPath(project.id)), 200, "first read");
    assert.equal(first.revision, R0);
    assert.equal(first.approvedPlanId, saved.planId);
    assert.deepEqual(first.stages, { plan: "approved", produce: "todo" });
    assert.deepEqual(first.scenes.map(s => [s.id, s.position, s.selectedVersionId, s.selectedVersion, s.recentVersions, s.olderCursor]),
      afterApproval.scenes.map(([id], index) => [id, index + 1, null, null, [], null]));
    const [s1, s2, s3] = first.scenes.map(s => s.id);
    out("flow-approved", { revision: R0, scenes: 3, projectReadKeys: Object.keys(projectView0.project).sort(), sceneReadRevisionMatches: true });

    // 5) Registration service (own login, in-process): seven results on scene 1, one on scene 2. Revision never moves.
    const assets = [];
    for (let i = 0; i < 8; i++) assets.push(await registeredAsset(admin, A, i === 0 ? "video" : "image"));
    const registered = [];
    for (let i = 0; i < 7; i++) {
      const requestId = v7();
      const reply = await register(A, { requestId, projectId: project.id, sceneId: s1, assetId: assets[i], sha256: SHA, revision: R0 });
      assert.deepEqual({ ok: reply.ok, version: reply.version, duplicate: reply.duplicate }, { ok: true, version: i + 1, duplicate: false }, "register " + i);
      registered.push({ requestId, versionId: reply.versionId, version: reply.version, assetId: assets[i] });
    }
    const replay = await register(A, { requestId: registered[0].requestId, projectId: project.id, sceneId: s1, assetId: assets[0], sha256: SHA, revision: R0 });
    assert.deepEqual({ ok: replay.ok, versionId: replay.versionId, duplicate: replay.duplicate }, { ok: true, versionId: registered[0].versionId, duplicate: true });
    const onScene2 = await register(A, { requestId: v7(), projectId: project.id, sceneId: s2, assetId: assets[7], sha256: SHA, revision: R0 });
    assert.deepEqual({ ok: onScene2.ok, version: onScene2.version }, { ok: true, version: 1 });
    const refusals = {
      reusedRequestOtherInput: await register(A, { requestId: registered[0].requestId, projectId: project.id, sceneId: s1, assetId: assets[1], sha256: SHA, revision: R0 }),
      otherOwner: await register(B, { requestId: v7(), projectId: project.id, sceneId: s1, assetId: assets[1], sha256: SHA, revision: R0 }),
      staleRevision: await register(A, { requestId: v7(), projectId: project.id, sceneId: s1, assetId: assets[1], sha256: SHA, revision: R0 + 1 }),
      wrongSha: await register(A, { requestId: v7(), projectId: project.id, sceneId: s1, assetId: assets[1], sha256: "f".repeat(64), revision: R0 }),
      unknownScene: await register(A, { requestId: v7(), projectId: project.id, sceneId: v7(), assetId: assets[1], sha256: SHA, revision: R0 }),
    };
    assert(Object.values(refusals).every(r => r.ok === false), JSON.stringify(refusals));
    assert.deepEqual([refusals.otherOwner.code, refusals.staleRevision.code, refusals.wrongSha.code, refusals.unknownScene.code],
      ["NOT_FOUND", "CONFLICT", "ASSET_NOT_READY", "NOT_FOUND"]);
    const afterRegister = await state(project.id);
    assert.equal(afterRegister.revision, R0);
    assert.deepEqual([afterRegister.versions, afterRegister.result_requests, afterRegister.links - beforeApproval.links, afterRegister.audit["scene.result_register"]], [8, 8, 8, 8]);
    assert.deepEqual(afterRegister.scenes, afterApproval.scenes);
    out("flow-register", { created: 8, versionsScene1: registered.map(r => r.version), duplicateReplay: true, revisionUnchanged: R0,
      refusals: Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, v.code])) });

    // 6) Scene read: recent five (newest first) + older page; other owner and anonymous are refused.
    const read1 = await body(call(scenesPath(project.id)), 200, "read after register");
    const scene1 = read1.scenes.find(s => s.id === s1);
    assert.equal(read1.revision, R0);
    assert.deepEqual(scene1.recentVersions.map(v => v.id), registered.slice(2).reverse().map(r => r.versionId));
    assert(scene1.recentVersions.every(v => v.status === "succeeded" && v.planId === saved.planId && v.origin !== undefined));
    assert.equal(typeof scene1.olderCursor, "string");
    const older = await body(call(scenesPath(project.id) + "?scene=" + s1 + "&cursor=" + encodeURIComponent(scene1.olderCursor)), 200, "older page");
    assert.deepEqual(older.versions.map(v => v.id), [registered[1].versionId, registered[0].versionId]);
    assert.equal(older.olderCursor, null);
    const allIds = [...scene1.recentVersions, ...older.versions].map(v => v.id);
    assert.deepEqual([...allIds].sort(), registered.map(r => r.versionId).sort());
    const scene2 = read1.scenes.find(s => s.id === s2);
    assert.deepEqual([scene2.recentVersions.map(v => v.id), scene2.olderCursor], [[onScene2.versionId], null]);
    await body(call(scenesPath(project.id), { actor: 1 }), 404, "other owner read");
    await body(call(scenesPath(project.id), { actor: null }), 401, "anonymous read");
    out("flow-read", { recent: scene1.recentVersions.map(v => v.version), olderPage: older.versions.map(v => v.version), missing: 0, duplicated: 0,
      otherOwner: 404, anonymous: 401 });

    // 7) Selection route: pick version 1 (outside the recent five), replay, refusals; then re-read shows it.
    const pick = { requestId: v7(), revision: R0, sceneId: s1, versionId: registered[0].versionId, expectedVersionId: null };
    const selected = await body(call(selectPath(project.id), { input: pick }), 200, "select");
    assert.deepEqual(selected, { projectId: project.id, sceneId: s1, selectedVersionId: registered[0].versionId, revision: R0 + 1, outcome: "selected" });
    assert.equal((await body(call(selectPath(project.id), { input: pick }), 200, "select replay")).outcome, "replayed");
    const selectRefusals = {
      staleRevision: await body(call(selectPath(project.id), { input: { ...pick, requestId: v7(), versionId: registered[1].versionId } }), 409),
      selectionChanged: await body(call(selectPath(project.id), { input: { ...pick, requestId: v7(), revision: R0 + 1, versionId: registered[1].versionId } }), 409),
      otherOwner: await body(call(selectPath(project.id), { actor: 1, input: { ...pick, requestId: v7(), revision: R0 + 1 } }), 404),
      otherScenesVersion: await body(call(selectPath(project.id), { input: { ...pick, requestId: v7(), revision: R0 + 1, sceneId: s2, versionId: registered[1].versionId } }), 409),
      anonymous: await body(call(selectPath(project.id), { actor: null, input: { ...pick, requestId: v7(), revision: R0 + 1 } }), 401),
    };
    const afterSelect = await state(project.id);
    assert.equal(afterSelect.revision, R0 + 1);
    assert.deepEqual(afterSelect.scenes[0], [s1, registered[0].versionId, 0]);
    assert.deepEqual(afterSelect.stages, { ...afterRegister.stages, produce: "in_progress" });
    assert.deepEqual([afterSelect.select_requests, afterSelect.audit["scene.select"]], [1, 1]);
    const read2 = await body(call(scenesPath(project.id)), 200, "re-read");
    const scene1b = read2.scenes.find(s => s.id === s1);
    assert.equal(read2.revision, R0 + 1);
    assert.deepEqual(read2.stages, { plan: "approved", produce: "in_progress" });
    assert.deepEqual([scene1b.selectedVersionId, scene1b.selectedVersion?.id, scene1b.selectedVersion?.version], [registered[0].versionId, registered[0].versionId, 1]);
    assert.deepEqual(scene1b.recentVersions, scene1.recentVersions);
    const projectView1 = await body(call("/api/projects/" + project.id), 200, "project read after select");
    assert.deepEqual(Object.keys(projectView1.project).sort(), Object.keys(projectView0.project).sort());
    assert.equal(projectView1.project.approvedPlanId, saved.planId);
    const list = await body(call("/api/projects"), 200, "project list");
    assert(list.some(item => item.id === project.id));
    const changedProjectFields = Object.keys(projectView0.project).filter(k => JSON.stringify(projectView0.project[k]) !== JSON.stringify(projectView1.project[k]));
    out("flow-select", { selected: "200 revision " + R0 + "->" + (R0 + 1), replay: "200 replayed",
      refusals: Object.fromEntries(Object.entries(selectRefusals).map(([k, v]) => [k, v.code])),
      reRead: { revision: R0 + 1, selectedVersion: 1, selectedOutsideRecentFive: true, produce: "in_progress" },
      projectReadCompatible: { sameKeys: true, changedFields: changedProjectFields }, listed: true });

    // 8) Revision interplay: registration with the pre-selection revision conflicts; with the new one it appends version 8.
    const staleAfterSelect = await register(A, { requestId: v7(), projectId: project.id, sceneId: s1, assetId: assets[1], sha256: SHA, revision: R0 });
    assert.deepEqual(staleAfterSelect, { ok: false, code: "CONFLICT" });
    const extraAsset = await registeredAsset(admin, A, "image");
    const appended = await register(A, { requestId: v7(), projectId: project.id, sceneId: s1, assetId: extraAsset, sha256: SHA, revision: R0 + 1 });
    assert.deepEqual({ ok: appended.ok, version: appended.version }, { ok: true, version: 8 });
    const read3 = await body(call(scenesPath(project.id)), 200, "read after append");
    const scene1c = read3.scenes.find(s => s.id === s1);
    assert.deepEqual([read3.revision, scene1c.recentVersions[0].id, scene1c.selectedVersionId], [R0 + 1, appended.versionId, registered[0].versionId]);
    out("flow-revision", { registerWithOldRevision: "CONFLICT", registerWithNewRevision: "CREATED version 8", selectionKept: true });

    // 9) Rollback: a failing audit insert inside each candidate transaction leaves no rows; the same request then succeeds.
    const failOn = async action => admin.query("CREATE FUNCTION public.p2flow_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='" + action +
      "' THEN RAISE EXCEPTION 'synthetic flow failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER p2flow_fail BEFORE INSERT ON dream.activity_log FOR EACH ROW EXECUTE FUNCTION public.p2flow_fail()");
    const clearFail = () => admin.query("DROP TRIGGER IF EXISTS p2flow_fail ON dream.activity_log; DROP FUNCTION IF EXISTS public.p2flow_fail()");
    const rollback = {};
    const beforeFail = await state(project.id);
    const retryAsset = await registeredAsset(admin, A, "video");
    const retryRegister = { requestId: v7(), projectId: project.id, sceneId: s3, assetId: retryAsset, sha256: SHA, revision: R0 + 1 };
    await failOn("scene.result_register");
    try { rollback.register = await register(A, retryRegister); } finally { await clearFail(); }
    assert.equal(rollback.register.ok, false);
    assert.deepEqual(await state(project.id), beforeFail);
    const retried = await register(A, retryRegister);
    assert.deepEqual({ ok: retried.ok, version: retried.version, duplicate: retried.duplicate }, { ok: true, version: 1, duplicate: false });
    const beforeSelectFail = await state(project.id);
    const retrySelect = { requestId: v7(), revision: R0 + 1, sceneId: s3, versionId: retried.versionId, expectedVersionId: null };
    await failOn("scene.select");
    try { rollback.select = (await body(call(selectPath(project.id), { input: retrySelect }), 503, "select rollback")).code; } finally { await clearFail(); }
    assert.deepEqual(await state(project.id), beforeSelectFail);
    const selectedAfterRetry = await body(call(selectPath(project.id), { input: retrySelect }), 200, "select retry");
    assert.deepEqual([selectedAfterRetry.outcome, selectedAfterRetry.revision], ["selected", R0 + 2]);
    out("flow-rollback", { register: rollback.register.code + " -> retry CREATED", select: "503 " + rollback.select + " -> retry 200 selected", rowsWhileFailing: 0 });

    // 10) Concurrency across candidates on one scene. Registration holds the project row FOR SHARE, selection FOR NO KEY UPDATE,
    // so they serialize: if the selection commits first the registration sees the new revision (CONFLICT, no row); otherwise both
    // finish. Two selections at the same revision: exactly one wins.
    const raceAsset = await registeredAsset(admin, A, "image");
    const [raceRegister, raceSelect] = await Promise.all([
      register(A, { requestId: v7(), projectId: project.id, sceneId: s2, assetId: raceAsset, sha256: SHA, revision: R0 + 2 }),
      call(selectPath(project.id), { input: { requestId: v7(), revision: R0 + 2, sceneId: s2, versionId: onScene2.versionId, expectedVersionId: null } }),
    ]);
    const raceSelectBody = await raceSelect.json();
    assert.deepEqual([raceSelect.status, raceSelectBody.outcome, raceSelectBody.revision], [200, "selected", R0 + 3]);
    if (raceRegister.ok) assert.equal(raceRegister.version, 2); else assert.equal(raceRegister.code, "CONFLICT");
    const s2Versions = (await admin.query("SELECT count(*)::int n FROM dream.scene_versions WHERE scene_id=$1", [s2])).rows[0].n;
    assert.equal(s2Versions, raceRegister.ok ? 2 : 1);
    const twin = await Promise.all([registered[1], registered[2]].map(r =>
      call(selectPath(project.id), { input: { requestId: v7(), revision: R0 + 3, sceneId: s1, versionId: r.versionId, expectedVersionId: registered[0].versionId } })));
    assert.deepEqual(twin.map(r => r.status).sort(), [200, 409]);
    for (const response of twin) await response.body?.cancel();
    const final = await state(project.id);
    assert.equal(final.revision, R0 + 4);
    const finalRead = await body(call(scenesPath(project.id)), 200, "final read");
    assert.deepEqual(finalRead.scenes.map(s => s.selectedVersionId), final.scenes.map(s => s[1]));
    assert.equal(finalRead.revision, R0 + 4);
    out("flow-concurrency", { registerWithSelect: (raceRegister.ok ? "CREATED v2" : "CONFLICT (selection first), no row") + " + 200 selected", twoSelections: [200, 409], finalRevision: final.revision,
      reReadMatchesDatabase: true });

    // 11) All runtime logins really connected over verified TLS while the server was running.
    const { rows: tls } = await admin.query(`SELECT a.usename AS role, bool_and(s.ssl AND s.version='TLSv1.3') AS verified
      FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid) WHERE a.usename=ANY($1::name[]) GROUP BY a.usename ORDER BY a.usename`,
    [["dream_project_core_app", "dream_plan_app", "dream_plan_approver", "dream_scene_result_app", "dream_scene_read_app", "dream_scene_select_app"]]);
    assert.deepEqual(tls.map(r => r.role), ["dream_plan_app", "dream_plan_approver", "dream_project_core_app", "dream_scene_read_app", "dream_scene_result_app", "dream_scene_select_app"]);
    assert(tls.every(r => r.verified));
    out("flow-tls", { roles: tls.map(r => r.role), tls: "TLSv1.3" });
  });
  await pool.end();

  // 12) After the flow: no scope widened, no existing privilege changed, direct table access still refused for each login.
  for (const [role, scope] of Object.entries(scopes)) assert.deepEqual(await roleScope(role), scope, role + " after flow");
  assert.deepEqual(await existingSnapshot(), before, "existing privileges after flow");
  assert.equal(await browserExposure(), 0);
  const direct = {};
  for (const [role, value, statement] of [
    ["dream_scene_result_app", sResult, "INSERT INTO dream.scene_versions(owner_id) VALUES('" + A + "')"],
    ["dream_scene_result_app", sResult, "SELECT 1 FROM dream_scene_result.requests"],
    ["dream_scene_read_app", sRead, "SELECT input_snapshot_json FROM dream.scene_versions"],
    ["dream_scene_read_app", sRead, "UPDATE dream.scenes SET selected_version_id=NULL"],
    ["dream_scene_select_app", sSelect, "SELECT id FROM dream.scenes"],
    ["dream_scene_select_app", sSelect, "SET ROLE dream_scene_select_writer"],
    ["dream_scene_result_app", sResult, "SET ROLE dream_scene_result_writer"],
  ]) {
    const client = await context.connect(role, value);
    try { await client.query(statement); direct[role + ": " + statement.slice(0, 40)] = "allowed"; }
    catch (error) { direct[role + ": " + statement.slice(0, 40)] = error.code; }
    finally { await client.end(); }
  }
  assert(Object.values(direct).every(code => code === "42501"), JSON.stringify(direct));
  out("flow-scope", { roleScopesUnchangedAfterFlow: Object.keys(scopes), existingPrivilegesUnchanged: true, browserGrants: 0, directAccess: direct });
  out("flow-result", { result: "PASS" });
}
