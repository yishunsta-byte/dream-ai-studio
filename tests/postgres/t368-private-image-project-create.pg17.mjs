/* global Buffer, URL, AbortSignal, console, fetch, process */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { v7 } from "uuid";
import { parseMenuConfig } from "../../lib/menus/parse.ts";
import { snapshotForMenu } from "../../lib/menus/snapshot.ts";
import { createOwnedPrivateImageProject } from "../../lib/services/postgres/private-image-project-create.ts";
import { createPrivateObjectReader } from "../../lib/storage/supabase/reader.ts";

const sql = name => readFile(new URL(`../../lib/db/postgres/private-image-project-create/${name}.sql`, import.meta.url), "utf8");
const t368Error = code => ({ code });
const deadline = (promise, label) => Promise.race([promise, delay(4500, undefined, { ref: false }).then(() => { throw Error(label); })]);

async function sdkStorage(fixture) {
  const provider = `http://127.0.0.1:${fixture.server.address().port}`;
  let nextHold;
  const state = { public: false, events: [], errors: [], corrupt: false };
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "GET");
      const gate = nextHold;
      nextHold = undefined;
      if (gate) { gate.entered.resolve(); await gate.release.promise; }
      if (request.url === "/storage/v1/bucket/t367-private") {
        state.events.push("bucket");
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "t367-private", public: state.public }));
        return;
      }
      const prefix = "/storage/v1/object";
      assert.match(request.url, /^\/storage\/v1\/object\/t367-private\/[a-f0-9-]+\/assets\/[a-f0-9-]+\/[a-f0-9]{64}\.png$/);
      state.events.push("object");
      const verified = await fetch(provider + request.url.slice(prefix.length), { redirect: "error", signal: AbortSignal.timeout(4000) });
      const bytes = Buffer.from(await verified.arrayBuffer());
      if (state.corrupt && bytes.length) bytes[0] ^= 255;
      response.writeHead(verified.status, { "content-type": "application/octet-stream" }).end(bytes);
    } catch (error) { state.errors.push(error); response.writeHead(500).end(); }
  });
  await new Promise((done, reject) => server.once("error", reject).listen(0, "127.0.0.1", done));
  return {
    state, origin: `http://127.0.0.1:${server.address().port}`,
    hold() {
      nextHold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
      return nextHold;
    },
    async close() {
      nextHold?.release.resolve();
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    },
  };
}

function lostCommit(pool) {
  let lost = false;
  return {
    async connect() {
      let settling = false;
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, key) {
          if (key === "query") return async (statement, args) => {
            const response = await target.query(statement, args);
            settling ||= statement.startsWith("SELECT private_image_create_v1.finish_create");
            if (!lost && settling && statement === "COMMIT") {
              lost = true;
              throw Error("Synthetic lost COMMIT response");
            }
            return response;
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}

const totals = async admin => (await admin.query(`SELECT
  (SELECT count(*)::int FROM dream.projects) AS projects,
  (SELECT count(*)::int FROM dream.stage_states) AS stages,
  (SELECT count(*)::int FROM dream.project_assets) AS links,
  (SELECT count(*)::int FROM dream.activity_log) AS audit,
  (SELECT count(*)::int FROM dream.creation_operations) AS requests`)).rows[0];

async function acl(admin) {
  return {
    history: (await admin.query("SELECT * FROM dream_migrations.history ORDER BY ordinal")).rows,
    policies: (await admin.query("SELECT * FROM pg_policies WHERE schemaname='dream' ORDER BY tablename,policyname")).rows,
    grants: (await admin.query(`SELECT c.relname,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.relnamespace='dream'::regnamespace ORDER BY 1,2,3,4`)).rows,
    columns: (await admin.query(`SELECT c.relname,m.attname,a.* FROM pg_class c JOIN pg_attribute m ON m.attrelid=c.oid
      CROSS JOIN LATERAL aclexplode(m.attacl) a WHERE c.relnamespace='dream'::regnamespace ORDER BY 1,2,3,4,5`)).rows,
  };
}

async function waitForLock(readWaiting) {
  for (let i = 0; i < 40; i++) {
    if ((await readWaiting()).rows[0].count > 0) return;
    await delay(60);
  }
  throw Error("Expected native lock wait did not occur");
}

async function revoke(admin, owner, asset) {
  const state = (await admin.query("SELECT object_id,revision FROM dream.asset_receipt_state WHERE owner_id=$1 AND asset_id=$2", [owner, asset])).rows[0];
  const event = JSON.stringify([{ revision: Number(state.revision) + 1, at: Date.now(), principalId: owner,
    authorizers: [owner], kind: "manual", operationId: null }]);
  await admin.query("BEGIN");
  try {
    await admin.query(`UPDATE dream.asset_receipt_state SET status='revoked',revision=revision+1,revocation_history_json=$3,updated_at=clock_timestamp()
      WHERE owner_id=$1 AND asset_id=$2`, [owner, asset, event]);
    await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [state.object_id]);
    await admin.query("COMMIT");
  } catch (error) { await admin.query("ROLLBACK"); throw error; }
}

export async function verifyProjects({ admin, cfg, api, a, b, worker, fixture, png, expected, openPolicy, updateLegacy, removeUpload }) {
  const prefix = await realpath(tmpdir());
  const root = await mkdtemp(join(prefix, "dream-t368-reader-"));
  const storage = await sdkStorage(fixture);
  const install = await sql("0001_install"), remove = await sql("0001_remove");
  if (process.env.T371_VERIFY_HTTP === "1") {
    const { installBrief } = await import("./local-project-brief-http.mjs");
    await installBrief(admin,cfg);
    const { installOwnedWav } = await import("./private-wav-http.mjs");
    await installOwnedWav(admin,cfg);
    const { installProjectAudio } = await import('./private-project-audio-http.mjs');
    await installProjectAudio(admin,cfg);
    const { installTimelineSave }=await import('./private-timeline-audio-http.mjs');
    await installTimelineSave(admin,cfg);
    const { installProjectReview } = await import("./private-project-review-http.mjs");
    await installProjectReview(admin,cfg);
    const { installRenderRequest } = await import("./private-render-request-http.mjs");
    await installRenderRequest(admin, cfg);
    if (process.env.T371_VERIFY_RENDER_AUDIO === "1") {
      const { installPgWavRenderReader } = await import("./private-wav-render-output.mjs");
      await installPgWavRenderReader(admin, cfg);
      const { installRenderExecution } = await import("./private-render-execution-http.mjs");
      await installRenderExecution(admin, cfg);
    }
  }
  const baseline = await acl(admin);
  let pool;
  try {
    await admin.query("CREATE SCHEMA private_image_create_v1");
    await assert.rejects(admin.query(install), /T368_OWNED_TARGET_OR_CONFLICT/);
    await admin.query("ROLLBACK; DROP SCHEMA private_image_create_v1");
    await admin.query(install);
    await assert.rejects(admin.query(install), /T368_OWNED_TARGET_OR_CONFLICT/);
    await admin.query("ROLLBACK");
    await admin.query(`CREATE ROLE t368_writer LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${cfg.password}';
      GRANT dream_api,t368_create_runtime TO t368_writer WITH INHERIT FALSE, SET TRUE`);
    pool = new Pool({ ...cfg, user: "t368_writer", max: 5, application_name: "t368-write" });
    await updateLegacy("T368 existing writer inside candidate");
    const c = await pool.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE dream_api");
      await assert.rejects(c.query("SELECT private_image_create_v1.begin_create(NULL,NULL,NULL,NULL)"), { code: "42501" });
      await c.query("ROLLBACK; BEGIN; SET LOCAL ROLE t368_create_runtime");
      await assert.rejects(c.query("SELECT * FROM dream.creation_operations"), { code: "42501" });
    } finally { await c.query("ROLLBACK"); c.release(); }
    const setup = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
    assert.ok(setup.ok);
    const snapshot = snapshotForMenu(setup.config, setup.config.menus[0]);
    const reader = createPrivateObjectReader({ profile: "synthetic", projectUrl: storage.origin, projectRef: "abcdefghijklmnopqrst",
      bucket: "t367-private", privateBucket: true, credential: { mode: "service-role", key: "t368-synthetic-credential" },
      maxBytes: 1024 * 1024, timeoutMs: 6500, maxConcurrent: 3, workRoot: root, ffprobePath: resolve(".tools/ffmpeg/ffprobe.exe") });
    const service = createOwnedPrivateImageProject(pool, reader, worker, snapshot);
    const disconnect = createOwnedPrivateImageProject(lostCommit(pool), reader, worker, snapshot);
    const upload = async owner => {
      const request = v7();
      const { assetId } = await api.reserve(owner, request, expected);
      await api.receive(owner, request, png);
      assert.deepEqual(await api.complete(owner, request), { assetId });
      return assetId;
    };
    const inputs = (asset, title = "T368 private PNG") => ({ title, goal: "show an owned image", target: "viewers", aspect: "9:16", lengthSec: 30,
      productName: "Synthetic fixture", productAssets: [asset], facts: "Synthetic fixture", usageRights: "직접 촬영" });
    const asset = await upload(a);
    if (process.env.T371_VERIFY_HTTP === "1") {
      const { verifyProjectHttp } = await import("./t371-project-create-http.mjs");
      await admin.query(await readFile(new URL("../../lib/db/postgres/local-project-brief/scene-result-source.sql", import.meta.url), "utf8"));
      try {
        await verifyProjectHttp({ cfg, png, fixture, storage, worker, a, b, asset, inputs, admin, revoke, upload, totals });
      } finally {
        await admin.query(`DROP FUNCTION private_image_create_v1.verified_scene_png(uuid);
          REVOKE USAGE ON SCHEMA private_image_create_v1 FROM local_project_brief`);
      }
    }
    const oldTotals = await totals(admin);
    const sharedRequest = v7(), gate = storage.hold();
    const initial = disconnect.create(a, sharedRequest, inputs(asset));
    void initial.catch(() => {});
    let other;
    let project;
    try {
      await deadline(gate.entered.promise, "Storage verification did not begin");
      other = service.create(a, sharedRequest, inputs(asset));
      void other.catch(() => {});
      await waitForLock(() => pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND wait_event='advisory' AND query LIKE 'SELECT private_image_create_v1.begin_create%'`));
      gate.release.resolve();
      await assert.rejects(initial, t368Error("PROJECT_CREATE_UNAVAILABLE"));
      project = await other;
    } finally { gate.release.resolve(); }
    assert.deepEqual(storage.state.events, ["bucket","object"]);
    assert.equal(await service.create(a, sharedRequest, inputs(asset)), project);
    await assert.rejects(service.create(a, sharedRequest, inputs(asset, "Different title")), t368Error("REQUEST_CONFLICT"));
    await assert.rejects(service.create(b, sharedRequest, inputs(asset)), t368Error("INVALID_INPUT"));
    assert.deepEqual(storage.state.events, ["bucket","object"]);
    assert.deepEqual(await totals(admin), { projects: oldTotals.projects + 1, stages: oldTotals.stages + 7,
      links: oldTotals.links + 1, audit: oldTotals.audit + 1, requests: oldTotals.requests + 1 });
    const result = (await admin.query(`SELECT owner_id,project_id,status,revision,result_json::jsonb AS result
      FROM dream.creation_operations WHERE owner_id=$1 AND request_id=$2`, [a.id, sharedRequest])).rows[0];
    assert.deepEqual(result, { owner_id: a.id, project_id: project, status: "succeeded", revision: "1", result: { status: "succeeded", projectId: project } });
    assert.deepEqual((await admin.query("SELECT asset_id,purpose FROM dream.project_assets WHERE project_id=$1", [project])).rows,
      [{ asset_id: asset, purpose: "productAssets" }]);
    const storedStages = (await admin.query("SELECT stage,status FROM dream.stage_states WHERE project_id=$1 ORDER BY stage", [project])).rows;
    assert.deepEqual(storedStages, [
      { stage: "brief", status: "todo" }, { stage: "edit", status: "locked" }, { stage: "export", status: "locked" },
      { stage: "intake", status: "approved" }, { stage: "plan", status: "locked" }, { stage: "produce", status: "locked" },
      { stage: "review", status: "locked" },
    ]);
    assert.deepEqual((await admin.query("SELECT owner_id,action,detail_json::jsonb AS detail FROM dream.activity_log WHERE project_id=$1",
      [project])).rows, [{ owner_id: a.id, action: "project.create",
      detail: { menuId: "shopping-shorts", templateVersion: snapshot.templateVersion, contentRevision: 1 } }]);
    const unused = v7();
    const beforeFailures = await totals(admin);
    storage.state.public = true;
    await assert.rejects(service.create(a, unused, inputs(asset)), t368Error("INVALID_INPUT"));
    assert.equal(storage.state.events.at(-1), "bucket");
    storage.state.public = false;
    storage.state.corrupt = true;
    await assert.rejects(service.create(a, unused, inputs(asset)), t368Error("INVALID_INPUT"));
    storage.state.corrupt = false;
    assert.deepEqual(await totals(admin), beforeFailures);

    await admin.query(`CREATE FUNCTION public.t368_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='succeeded' THEN RAISE EXCEPTION 'test settlement failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t368_fail BEFORE UPDATE ON dream.creation_operations FOR EACH ROW EXECUTE FUNCTION public.t368_fail()`);
    try { await assert.rejects(service.create(a, unused, inputs(asset)), t368Error("PROJECT_CREATE_UNAVAILABLE")); }
    finally { await admin.query("DROP TRIGGER t368_fail ON dream.creation_operations; DROP FUNCTION public.t368_fail()"); }
    assert.deepEqual(await totals(admin), beforeFailures);
    assert.notEqual(await service.create(a, unused, inputs(asset)), project);
    const bAsset = await upload(b);
    const bProject = await service.create(b, sharedRequest, inputs(bAsset));
    assert.notEqual(bProject, project);
    assert.equal(await service.create(b, sharedRequest, inputs(bAsset)), bProject);
    const revokedAsset = await upload(a);
    await revoke(admin, a.id, revokedAsset);
    const beforeStale = await totals(admin);
    const beforeRequests = storage.state.events.length;
    await assert.rejects(service.create(a, v7(), inputs(revokedAsset)), t368Error("INVALID_INPUT"));
    assert.equal(storage.state.events.length, beforeRequests);
    assert.deepEqual(await totals(admin), beforeStale);

    const policyGate = storage.hold();
    const racingId = v7();
    const creating = service.create(a, racingId, inputs(asset));
    void creating.catch(() => {});
    let rotating;
    let policyProject;
    try {
      await deadline(policyGate.entered.promise, "Creation did not acquire evidence");
      rotating = openPolicy(2);
      void rotating.catch(() => {});
      await waitForLock(() => pool.query("SELECT cardinality(pg_blocking_pids($1)) AS count", [admin.processID]));
      policyGate.release.resolve();
      policyProject = await creating;
      await rotating;
    } finally { policyGate.release.resolve(); }
    const afterRotation = await totals(admin);
    const readEvents = storage.state.events.length;
    assert.equal(await service.create(a, racingId, inputs(asset)), policyProject);
    assert.equal(await service.create(a, sharedRequest, inputs(asset)), project);
    await assert.rejects(service.create(a, v7(), inputs(asset)), t368Error("INVALID_INPUT"));
    assert.equal(storage.state.events.length, readEvents);
    assert.deepEqual(await totals(admin), afterRotation);
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(storage.state.errors, []);
    console.log("T368 real T367 PNG and Storage SDK, owner and evidence gates, concurrent replay, lost COMMIT, full rollback and policy ordering passed");

    await admin.query(remove);
    assert.deepEqual(await acl(admin), baseline);
    assert.deepEqual(await totals(admin), afterRotation);
    await assert.rejects(service.create(a, sharedRequest, inputs(asset)), t368Error("PROJECT_CREATE_UNAVAILABLE"));
    await updateLegacy("T368 existing writer after removal");
    await removeUpload();
    console.log("T368 overlay removal retained projects, evidence, SQL4 request history, ACL and legacy writer");
  } finally {
    await pool?.end();
    await storage.close();
    const verified = await realpath(root);
    assert.equal(dirname(verified), prefix);
    assert.ok(basename(verified).startsWith("dream-t368-reader-"));
    await rm(verified, { recursive: true, force: true, maxRetries: 3 });
  }
}
