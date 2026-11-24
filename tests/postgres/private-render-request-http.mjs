/* global fetch, URL, console */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { v7 } from "uuid";

export async function installRenderRequest(admin, cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/render-request.sql", import.meta.url), "utf8"));
  const { rows: [password] } = await admin.query("SELECT quote_literal($1::text) AS literal", [cfg.password]);
  await admin.query("CREATE ROLE local_render_request_login LOGIN NOINHERIT PASSWORD " + password.literal);
  await admin.query("GRANT local_render_request TO local_render_request_login WITH INHERIT FALSE, SET TRUE");
}

export async function testRenderRequest({ origin, owner, other, admin, project, actor }) {
  const api = origin + "/api/projects/" + project;
  async function send(route, cookie, method = "GET", body, key) {
    const response = await fetch(api + route, { method, headers: { ...(cookie && { cookie }),
      ...(body && { "Content-Type": "application/json" }), ...(key && { "Idempotency-Key": key }) },
    ...(body && { body: JSON.stringify(body) }) });
    assert.match(response.headers.get("cache-control"), /no-store/);
    return { status: response.status, body: await response.json() };
  }
  const request = (input, key = v7(), cookie = owner) => send("/renders", cookie, "POST", input, key);
  const read = cookie => send("/renders", cookie);
  const { rows: [base] } = await admin.query(`SELECT content_revision::int AS revision,current_timeline_rev_id AS "timelineId"
    FROM dream.projects WHERE id=$1`, [project]);
  const counts = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM dream.jobs WHERE project_id=$1 AND kind='render-prepare') AS jobs,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='render.requested') AS activity,
    (SELECT count(*)::int FROM local_render_request.keys k JOIN dream.jobs j ON j.id=k.job_id WHERE j.project_id=$1) AS keys,
    (SELECT count(*)::int FROM dream.renders WHERE project_id=$1) AS renders`, [project])).rows[0];
  assert.equal((await read(null)).status, 401);
  assert.equal((await request(base, v7(), null)).status, 401);
  assert.equal((await read(other)).status, 404);
  assert.equal((await request(base, v7(), other)).status, 404);
  assert.equal((await send("/renders", owner, "POST", base)).status, 400);
  assert.deepEqual((await read(owner)).body.result.requests, []);
  assert.equal((await request(base)).body.code, "REVIEW_APPROVAL_REQUIRED");

  const approve = async revision => admin.query(`UPDATE dream.stage_states SET status='approved',approved_revision=$2,approved_at=now()
    WHERE project_id=$1 AND stage='review'`, [project, revision]);
  await approve(base.revision - 1);
  assert.equal((await request(base)).body.code, "REVIEW_APPROVAL_REQUIRED");
  await approve(base.revision);
  assert.equal((await request({ ...base, revision: base.revision - 1 })).body.code, "CURRENT_TIMELINE_CONFLICT");
  assert.equal((await request({ ...base, timelineId: v7() })).body.code, "CURRENT_TIMELINE_CONFLICT");

  const firstKey = v7(), alternateKey = v7();
  await admin.query("CREATE FUNCTION local_render_request.fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
  await admin.query(`CREATE TRIGGER fail_render_request_fixture BEFORE INSERT ON dream.activity_log FOR EACH ROW
    WHEN (NEW.action='render.requested') EXECUTE FUNCTION local_render_request.fail_fixture()`);
  try { assert.equal((await request(base, firstKey)).status, 503); }
  finally { await admin.query("DROP TRIGGER fail_render_request_fixture ON dream.activity_log; DROP FUNCTION local_render_request.fail_fixture()"); }
  assert.deepEqual(await counts(), { jobs: 0, activity: 0, keys: 0, renders: 0 });
  const requests = await Promise.all([request(base, firstKey), request(base, firstKey), request(base, alternateKey)]);
  for (const response of requests) assert.equal(response.status, 202, JSON.stringify(response));
  const { jobId } = requests[0].body.result;
  for (const response of requests) {
    assert.equal(response.body.result.jobId, jobId);
    assert.equal(response.body.result.status, "queued");
    assert.equal("renderId" in response.body.result, false);
  }
  assert.equal(requests.filter(response => !response.body.result.existing).length, 1);
  assert.deepEqual(await counts(), { jobs: 1, activity: 1, keys: 2, renders: 0 });
  const { rows: [job] } = await admin.query(`SELECT j.kind,j.attempts,j.next_run_at,j.lease_until,j.input_snapshot_json,
    t.timeline_sha256 FROM dream.jobs j JOIN dream.timeline_revisions t ON t.id=$2 WHERE j.id=$1`, [jobId, base.timelineId]);
  assert.equal(job.kind, "render-prepare");
  assert.equal(job.attempts, "0");
  assert.equal(job.next_run_at, null);
  assert.equal(job.lease_until, null);
  assert.equal(JSON.parse(job.input_snapshot_json).timelineSha256, job.timeline_sha256);
  const initialState = (await read(owner)).body.result;
  assert.equal(initialState.workerOnline, false);
  assert.deepEqual(initialState.renders, []);
  assert.equal(initialState.requests.length, 1);
  assert.equal(initialState.requests[0].jobId, jobId);
  assert.equal(initialState.requests[0].status, "queued");
  assert.equal(initialState.requests[0].stale, false);

  const { rows: [wav] } = await admin.query("SELECT asset_id FROM local_wav.files WHERE owner_id=$1 ORDER BY asset_id LIMIT 1", [actor]);
  assert.equal((await send("/audio-assets/" + wav.asset_id, owner, "PUT")).status, 200);
  const changed = await send("/timeline/audio-clips", owner, "POST",
    { assetId: wav.asset_id, expectedContentRevision: base.revision, expectedTimelineId: base.timelineId }, v7());
  assert.equal(changed.status, 200, JSON.stringify(changed));
  const next = { revision: changed.body.contentRevision, timelineId: changed.body.timelineId };
  assert.equal((await request(base, firstKey)).body.code, "CURRENT_TIMELINE_CONFLICT");
  assert.equal((await request(next)).body.code, "REVIEW_APPROVAL_REQUIRED");
  assert.equal((await read(owner)).body.result.requests[0].stale, true);
  await approve(next.revision);
  assert.equal((await request(next, firstKey)).body.code, "REQUEST_CONFLICT");
  const newRequest = await request(next);
  assert.equal(newRequest.status, 202);
  assert.notEqual(newRequest.body.result.jobId, jobId);
  assert.deepEqual(await counts(), { jobs: 2, activity: 2, keys: 3, renders: 0 });
  console.log("Owned PG render request: approval, replay, concurrent deduplication, stale status, isolation and audit rollback verified");
}
