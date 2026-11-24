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

// P2 주제별 쇼츠 장면 단계(주인님 지시 2026-11-25): 실제 HTTP(next start)에서 기획 승인까지 마친 같은 주제별 쇼츠 프로젝트로
// 결과 등록 → 장면·버전 읽기(이전 페이지) → 버전 선택 → 다시 읽기. verifySceneFlow는 이전 장면 SQL(0001·0002)만 설치하고 새 코드로
// 쇼핑숏츠 흐름을 통과한다. 여기서 주제별 확장 SQL을 읽기 → 등록 → 선택 순서로 하나씩 더하며 각 상태의 응답을 확인한다.
export async function verifyTopicScenes(context, baseEnv, ids) {
  const { admin, rootPath, projectRef, dbHost, cert, users, startProfile, body } = context;
  const topicFiles = { read: ["managed-scene-read/0002_topic_shorts.sql", "scene_read", "SCENE_READ_TOPIC_SHORTS_TARGET"],
    result: ["managed-scene-result/0003_topic_shorts.sql", "scene_result", "SCENE_RESULT_TOPIC_SHORTS_TARGET"],
    select: ["managed-scene-select/0002_topic_shorts.sql", "scene_select", "SCENE_SELECT_TOPIC_SHORTS_TARGET"] };
  const rollbackFiles = { read: ["managed-scene-read/rollback_0002_topic_shorts.sql", "scene_read", "SCENE_READ_TOPIC_SHORTS_ROLLBACK_TARGET"],
    result: ["managed-scene-result/rollback_0003_topic_shorts.sql", "scene_result", "SCENE_RESULT_TOPIC_SHORTS_ROLLBACK_TARGET"],
    select: ["managed-scene-select/rollback_0002_topic_shorts.sql", "scene_select", "SCENE_SELECT_TOPIC_SHORTS_ROLLBACK_TARGET"] };
  const installed = {};
  const installTopic = async (key, files = topicFiles) => {
    const [file, prefix, refusal] = files[key];
    const text = (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
    await admin.query("SET ROLE p102_migrate");
    try {
      await admin.query("SELECT set_config($1,$2,false),set_config($3,'postgres',false)", ["dream." + prefix + ".install_ref", projectRef, "dream." + prefix + ".install_database"]);
      assert.equal((await admin.query(text)).at(-1).command, "COMMIT", file);
      await assert.rejects(admin.query(text), { message: refusal });
      await admin.query("ROLLBACK");
    } finally { await admin.query("RESET ROLE"); }
    installed[file] = digest(text);
  };
  const [A] = [users[0].id];
  // 세 로그인 비밀번호는 이 확인용으로 새로 정한다(출력하지 않는다).
  const secrets = { read: randomBytes(28).toString("hex"), result: randomBytes(28).toString("hex"), select: randomBytes(28).toString("hex") };
  await admin.query("ALTER ROLE dream_scene_read_app PASSWORD '" + secrets.read + "'; ALTER ROLE dream_scene_result_app PASSWORD '" + secrets.result +
    "'; ALTER ROLE dream_scene_select_app PASSWORD '" + secrets.select + "'");
  const dsn = (role, value) => "postgresql://" + role + ":" + value + "@" + dbHost + ":5432/postgres";
  const env = { ...baseEnv,
    DREAM_SCENE_READ_BACKEND: "supabase-postgres", DREAM_SCENE_READ_DB_URL: dsn("dream_scene_read_app", secrets.read), DREAM_SCENE_READ_DB_CA: cert,
    DREAM_SCENE_RESULT_BACKEND: "supabase-postgres", DREAM_SCENE_RESULT_DB_URL: dsn("dream_scene_result_app", secrets.result), DREAM_SCENE_RESULT_DB_CA: cert,
    DREAM_SCENE_SELECT_BACKEND: "supabase-postgres", DREAM_SCENE_SELECT_DB_URL: dsn("dream_scene_select_app", secrets.select), DREAM_SCENE_SELECT_DB_CA: cert };
  const scenesPath = id => "/api/projects/" + id + "/scenes";
  const resultsPath = id => "/api/projects/" + id + "/scene-results";
  const selectPath = id => "/api/projects/" + id + "/scene-selection";
  const olderPath = (id, scene, cursor) => scenesPath(id) + "?scene=" + encodeURIComponent(scene) + "&cursor=" + encodeURIComponent(cursor);
  const snapshot = async () => (await admin.query(`SELECT md5(string_agg(t,'|' ORDER BY t)) h FROM (SELECT to_jsonb(x)::text t FROM dream.projects x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.scenes x UNION ALL SELECT to_jsonb(x)::text FROM dream.scene_versions x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.stage_states x UNION ALL SELECT to_jsonb(x)::text FROM dream.plans x
    UNION ALL SELECT to_jsonb(x)::text FROM dream.project_assets x UNION ALL SELECT to_jsonb(x)::text FROM dream.activity_log x) s`)).rows[0].h;
  const counts = async id => (await admin.query(`SELECT (SELECT content_revision::int FROM dream.projects WHERE id=$1) AS revision,
      (SELECT count(*)::int FROM dream.scene_versions v JOIN dream.scenes s ON (s.owner_id,s.id)=(v.owner_id,v.scene_id) WHERE s.project_id=$1) AS versions,
      (SELECT count(*)::int FROM dream_scene_result.requests WHERE project_id=$1) AS results,
      (SELECT count(*)::int FROM dream_scene_select.requests WHERE project_id=$1) AS selections,
      (SELECT jsonb_object_agg(stage,status) FROM dream.stage_states WHERE project_id=$1 AND stage IN ('plan','produce')) AS stages`, [id])).rows[0];
  const { rows: [shop] } = await admin.query(`SELECT p.id FROM dream.projects p WHERE p.owner_id=$1 AND p.menu_id='shopping-shorts'
    AND p.approved_plan_id IS NOT NULL AND p.archived_at IS NULL
    ORDER BY (SELECT count(*) FROM dream.scene_versions v JOIN dream.scenes s ON (s.owner_id,s.id)=(v.owner_id,v.scene_id) WHERE s.project_id=p.id) DESC, p.id LIMIT 1`, [A]);
  const { rows: sceneRows } = await admin.query(`SELECT s.id FROM dream.scenes s WHERE s.project_id=$1 AND s.archived_at IS NULL ORDER BY s.position`, [ids.approved]);
  assert.equal(sceneRows.length, 3);
  const [s1, s2, s3] = sceneRows.map(row => row.id);
  const assets = [];
  for (let i = 0; i < 9; i++) assets.push(await registeredAsset(admin, A, i === 0 ? "video" : "image"));
  // 설치 점검 확인용: 규칙 하나를 알려진 상태가 아닌 모양으로 잠시 바꾼다(관리자 연결, 바로 복원).
  const policy = (name, menu) => admin.query("ALTER POLICY " + name + " ON dream.projects USING (owner_id=(SELECT dream.actor_id()) AND " + menu +
    " AND archived_at IS NULL)");
  const wide = "menu_id IN ('shopping-shorts','topic-shorts')", narrow = "menu_id='shopping-shorts'";

  let report;
  await startProfile(env, async call => {
    const status = async (path, options) => { const response = await call(path, options); await response.body?.cancel(); return response.status; };
    const shopRead = await body(call(scenesPath(shop.id)), 200, "shopping scenes");
    const shopPaged = shopRead.scenes.find(s => s.olderCursor);
    const shopOlderPath = olderPath(shop.id, shopPaged.id, shopPaged.olderCursor);
    const shopOlder = await body(call(shopOlderPath), 200, "shopping older page");
    const shoppingSame = async () => {
      assert.deepEqual(await body(call(scenesPath(shop.id)), 200), shopRead);
      assert.deepEqual(await body(call(shopOlderPath), 200), shopOlder);
    };
    const R0 = (await counts(ids.approved)).revision;
    const probe = async () => ({
      read: await status(scenesPath(ids.approved)),
      register: await status(resultsPath(ids.approved), { input: { requestId: v7(), revision: R0, sceneId: s3, assetId: assets[8] } }),
      select: await status(selectPath(ids.approved), { input: { requestId: v7(), revision: R0, sceneId: s3, versionId: v7(), expectedVersionId: null } }),
    });
    const states = {};

    // 0) 이전 설치만(새 코드): 쇼핑숏츠 그대로, 주제별 쇼츠는 읽기·등록·선택 모두 404이고 쓰지 않는다.
    const untouched = await snapshot();
    states.previousOnly = await probe();
    await shoppingSame();
    assert.equal(await snapshot(), untouched);
    assert.deepEqual(states.previousOnly, { read: 404, register: 404, select: 404 });

    // 일부 적용 1: 읽기 0002만. 주제별 읽기는 열리고 등록·선택은 404.
    await installTopic("read");
    states.readOnly = await probe();
    await shoppingSame();
    assert.equal(await snapshot(), untouched);
    assert.deepEqual(states.readOnly, { read: 200, register: 404, select: 404 });

    // 일부 적용 2: 등록 0003까지. 선택은 아직 404. 주제별 등록은 아래 2)에서 실제로 확인한다.
    await installTopic("result");
    const partial = await status(selectPath(ids.approved), { input: { requestId: v7(), revision: R0, sceneId: s3, versionId: v7(), expectedVersionId: null } });
    assert.equal(partial, 404);
    await shoppingSame();
    states.readAndResult = { read: 200, select: partial };

    // 1) 승인 직후 읽기: 장면 3개, 버전 없음.
    const first = await body(call(scenesPath(ids.approved)), 200, "topic scenes");
    assert.deepEqual([first.revision, first.stages, first.scenes.map(s => [s.id, s.recentVersions.length, s.selectedVersionId])],
      [R0, { plan: "approved", produce: "todo" }, sceneRows.map(row => [row.id, 0, null])]);

    // 2) 결과 등록(HTTP): 장면 1에 7개, 장면 2에 1개. 같은 요청 재전송은 같은 버전, 리비전은 그대로.
    const register = (sceneId, assetId, extra = {}) => ({ requestId: v7(), revision: R0, sceneId, assetId, ...extra });
    const registered = [];
    for (let i = 0; i < 7; i++) {
      const input = register(s1, assets[i]);
      const saved = await body(call(resultsPath(ids.approved), { input }), 201, "topic register " + i);
      assert.deepEqual([saved.projectId, saved.sceneId, saved.assetId, saved.version], [ids.approved, s1, assets[i], i + 1]);
      registered.push({ input, versionId: saved.versionId });
    }
    const replay = await body(call(resultsPath(ids.approved), { input: registered[0].input }), 200, "topic register replay");
    assert.equal(replay.versionId, registered[0].versionId);
    const onScene2 = await body(call(resultsPath(ids.approved), { input: register(s2, assets[7]) }), 201);
    assert.equal(onScene2.version, 1);
    const registerCodes = {
      anonymous: await status(resultsPath(ids.approved), { actor: null, input: register(s1, assets[8]) }),
      otherAccount: await status(resultsPath(ids.approved), { actor: 1, input: register(s1, assets[8]) }),
      staleRevision: await status(resultsPath(ids.approved), { input: register(s1, assets[8], { revision: R0 + 1 }) }),
      unknownScene: await status(resultsPath(ids.approved), { input: register(v7(), assets[8]) }),
      beforeApproval: await status(resultsPath(ids.draft), { input: { ...register(v7(), assets[8]), revision: 1 } }),
      lockedMenu: await status(resultsPath(ids.locked), { input: { ...register(v7(), assets[8]), revision: 1 } }),
    };
    assert.deepEqual(registerCodes, { anonymous: 401, otherAccount: 404, staleRevision: 409, unknownScene: 404, beforeApproval: 409, lockedMenu: 404 });
    const afterRegister = await counts(ids.approved);
    assert.deepEqual([afterRegister.revision, afterRegister.versions, afterRegister.results], [R0, 8, 8]);
    // 등록까지 적용한 상태에서도 선택은 아직 404, 그 뒤 선택 0002를 더하면 모두 적용.
    assert.equal(await status(selectPath(ids.approved), { input: { requestId: v7(), revision: R0, sceneId: s1, versionId: registered[0].versionId, expectedVersionId: null } }), 404);
    assert.equal((await counts(ids.approved)).selections, 0);
    await installTopic("select");
    await shoppingSame();

    // 3) 읽기: 최근 5개(7~3), 이전 페이지(2,1), 장면 2는 1개. 반복 읽기는 같고 쓰지 않는다.
    const before = await snapshot();
    const read1 = await body(call(scenesPath(ids.approved)), 200, "topic read after register");
    const scene1 = read1.scenes.find(s => s.id === s1);
    assert.deepEqual(scene1.recentVersions.map(v => v.version), [7, 6, 5, 4, 3]);
    assert.deepEqual(scene1.recentVersions.map(v => v.id), registered.slice(2).reverse().map(r => r.versionId));
    assert(scene1.recentVersions.every(v => v.status === "succeeded" && v.planId === first.approvedPlanId));
    const older = await body(call(olderPath(ids.approved, s1, scene1.olderCursor)), 200, "topic older page");
    assert.deepEqual([older.versions.map(v => v.id), older.olderCursor], [[registered[1].versionId, registered[0].versionId], null]);
    assert.deepEqual(read1.scenes.find(s => s.id === s2).recentVersions.map(v => v.id), [onScene2.versionId]);
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await body(call(scenesPath(ids.approved)), 200), read1);
      assert.deepEqual(await body(call(olderPath(ids.approved, s1, scene1.olderCursor)), 200), older);
    }
    assert.equal(await snapshot(), before);

    // 4) 선택(HTTP): 이전 페이지의 버전 1을 고른다. 재전송은 replayed, 낡은 리비전·다른 계정·익명은 거부.
    const pick = { requestId: v7(), revision: R0, sceneId: s1, versionId: registered[0].versionId, expectedVersionId: null };
    const selected = await body(call(selectPath(ids.approved), { input: pick }), 200, "topic select");
    assert.deepEqual(selected, { projectId: ids.approved, sceneId: s1, selectedVersionId: registered[0].versionId, revision: R0 + 1, outcome: "selected" });
    assert.equal((await body(call(selectPath(ids.approved), { input: pick }), 200)).outcome, "replayed");
    const selectCodes = {
      staleRevision: await status(selectPath(ids.approved), { input: { ...pick, requestId: v7(), versionId: registered[1].versionId } }),
      otherAccount: await status(selectPath(ids.approved), { actor: 1, input: { ...pick, requestId: v7(), revision: R0 + 1 } }),
      anonymous: await status(selectPath(ids.approved), { actor: null, input: { ...pick, requestId: v7(), revision: R0 + 1 } }),
      otherScenesVersion: await status(selectPath(ids.approved), { input: { ...pick, requestId: v7(), revision: R0 + 1, sceneId: s2,
        expectedVersionId: null, versionId: registered[1].versionId } }),
      lockedMenu: await status(selectPath(ids.locked), { input: { ...pick, requestId: v7(), revision: 1 } }),
    };
    assert.deepEqual(selectCodes, { staleRevision: 409, otherAccount: 404, anonymous: 401, otherScenesVersion: 409, lockedMenu: 404 });
    const afterSelect = await counts(ids.approved);
    assert.deepEqual([afterSelect.revision, afterSelect.selections, afterSelect.stages], [R0 + 1, 1, { plan: "approved", produce: "in_progress" }]);
    const read2 = await body(call(scenesPath(ids.approved)), 200);
    const picked = read2.scenes.find(s => s.id === s1);
    assert.deepEqual([read2.revision, picked.selectedVersionId, picked.selectedVersion?.version], [R0 + 1, registered[0].versionId, 1]);

    // 5) 선택 뒤 리비전: 옛 리비전 등록은 409, 새 리비전 등록은 버전 8.
    assert.equal(await status(resultsPath(ids.approved), { input: register(s1, assets[8]) }), 409);
    assert.equal((await body(call(resultsPath(ids.approved), { input: register(s1, assets[8], { revision: R0 + 1 }) }), 201)).version, 8);

    // 6) 설치 점검: 알려진 두 상태(이전 설치·주제별 확장)가 아닌 모양은 쇼핑숏츠까지 503으로 닫히고, 복원하면 다시 열린다.
    //    읽기는 모르는 분야가 섞인 규칙, 등록·선택은 두 규칙(또는 함수와 규칙)이 서로 다른 상태인 경우.
    const drift = {};
    for (const [name, menu, check] of [
      ["scene_read", "menu_id IN ('shopping-shorts','topic-shorts','travel-shorts')", () => status(scenesPath(shop.id))],
      ["scene_result_read", narrow, () => status(resultsPath(shop.id), { input: register(v7(), assets[8], { revision: 1 }) })],
      ["scene_select_read", narrow, () => status(selectPath(shop.id), { input: { ...pick, requestId: v7(), revision: 1 } })],
    ]) {
      await policy(name, menu);
      try { drift[name] = await check(); } finally { await policy(name, wide); }
    }
    assert.deepEqual(drift, { scene_read: 503, scene_result_read: 503, scene_select_read: 503 });
    await shoppingSame();

    // 7) 보관하면 읽기·등록·선택 모두 404.
    await admin.query("UPDATE dream.projects SET archived_at=now() WHERE id=$1", [ids.approved]);
    let archived;
    try {
      archived = { read: await status(scenesPath(ids.approved)), register: await status(resultsPath(ids.approved), { input: register(s1, assets[8], { revision: R0 + 1 }) }),
        select: await status(selectPath(ids.approved), { input: { ...pick, requestId: v7(), revision: R0 + 1 } }) };
    } finally { await admin.query("UPDATE dream.projects SET archived_at=NULL WHERE id=$1", [ids.approved]); }
    assert.deepEqual(archived, { read: 404, register: 404, select: 404 });

    // 8) 되돌리기(선택 → 등록 → 읽기 역순): 이전 설치 상태로 돌아가 쇼핑숏츠는 그대로, 주제별 쇼츠는 404. 이미 만든 버전·선택은
    //    남고 다시 실행하면 거부된다. 그 뒤 정방향 파일을 다시 설치하면 같은 읽기와 등록·선택 재전송 응답으로 돌아온다.
    const finalRead = await body(call(scenesPath(ids.approved)), 200);
    const kept = await counts(ids.approved);
    for (const key of ["select", "result", "read"]) await installTopic(key, rollbackFiles);
    states.rolledBack = await probe();
    assert.deepEqual(states.rolledBack, { read: 404, register: 404, select: 404 });
    await shoppingSame();
    assert.deepEqual(await counts(ids.approved), kept);
    for (const key of ["read", "result", "select"]) await installTopic(key);
    assert.deepEqual(await body(call(scenesPath(ids.approved)), 200), finalRead);
    const replays = { register: await status(resultsPath(ids.approved), { input: registered[0].input }),
      select: (await body(call(selectPath(ids.approved), { input: pick }), 200)).outcome };
    assert.deepEqual(replays, { register: 200, select: "replayed" });
    assert.deepEqual(await counts(ids.approved), kept);
    await shoppingSame();
    states.reapplied = { read: 200, ...replays };
    report = { installs: installed, states, scenes: 3, registered: 9, recent: [7, 6, 5, 4, 3], olderPage: [2, 1], registerCodes, selected: "200 revision " + R0 + "->" + (R0 + 1),
      selectCodes, afterSelectRegister: { oldRevision: 409, newRevision: "201 version 8" }, unknownStateClosed: drift, shoppingSameInEveryState: true, archived, readsWrite: 0 };
  });
  out("topic-scenes", report);
}
