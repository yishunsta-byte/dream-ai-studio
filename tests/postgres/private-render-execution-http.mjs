/* global URL, fetch, Buffer, console */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { v7 } from "uuid";
import { SAMPLES_PER_FRAME } from "../../lib/audio/profile.ts";

export async function installRenderExecution(admin, cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/render-execution.sql", import.meta.url), "utf8"));
  const { rows: [password] } = await admin.query("SELECT quote_literal($1::text) AS literal", [cfg.password]);
  await admin.query("CREATE ROLE local_render_execute_login LOGIN NOINHERIT PASSWORD " + password.literal);
  await admin.query("GRANT local_render_execute TO local_render_execute_login WITH INHERIT FALSE, SET TRUE");
}

export async function testRenderExecution({ origin, owner, other, admin, storage, expected, assetId, frames = 60, secondImage, inspectDownload }) {
  const endpoint = origin + "/api/projects/" + expected.projectId;
  const pendingRoots = async () => (await readdir(tmpdir())).filter(name => name.startsWith("dream-pg-wav-render-")).sort();
  const initialRoots = await pendingRoots();
  const state = job => admin.query(`SELECT j.status,j.attempts::int,j.lease_until,j.error_code,o.sha256,o.frames,
    (SELECT count(*)::int FROM dream.activity_log WHERE action='render.completed' AND detail_json::jsonb->>'jobId'=$1::uuid::text) AS logs
    FROM dream.jobs j LEFT JOIN local_render_request.outputs o ON (o.owner_id,o.job_id)=(j.owner_id,j.id) WHERE j.id=$1`, [job])
    .then(result => result.rows[0]);
  async function post(path, body, cookie = owner) {
    return fetch(endpoint + path, { method: "POST", headers: { ...(cookie && { cookie }),
      ...(body && { "Content-Type": "application/json", "Idempotency-Key": v7() }) },
    ...(body && { body: JSON.stringify(body) }) });
  }
  async function enqueue(basis) {
    await admin.query("UPDATE dream.stage_states SET status='approved',approved_revision=$2,approved_at=now() WHERE project_id=$1 AND stage='review'",
      [expected.projectId, basis.revision]);
    const res = await post("/renders", basis);
    assert.equal(res.status, 202);
    return (await res.json()).result.jobId;
  }
  let basis = { revision: expected.contentRevision, timelineId: expected.timelineId };
  const job = await enqueue(basis);
  const route = "/renders/" + job + "/execute";
  const get = (path, cookie) => fetch(endpoint + path, { headers: { cookie } });
  const waitForStorage = (gate, pending) => Promise.race([gate.entered.promise, pending.then(res => assert.fail("Execution ended before Storage: " + res.status)),
    delay(15000, undefined, { ref: false }).then(() => assert.fail("Storage was not reached"))]);
  assert.equal((await post(route, undefined, null)).status, 401);
  assert.equal((await post(route, undefined, other)).status, 404);
  assert.equal((await get(route, other)).status, 404);
  assert.equal((await get(route, owner)).status, 404);
  assert.equal((await state(job)).attempts, 0);

  if (secondImage) {
    await admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1", [secondImage]);
    try {
      const missing = await post(route);
      assert.equal(missing.status, 409);
      assert.equal((await missing.json()).code, "RENDER_SOURCE_UNAVAILABLE");
      assert.equal((await state(job)).attempts, 0);
    } finally { await admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1", [secondImage]); }
  }
  storage.state.corrupt = true;
  try {
    const failure = await post(route);
    assert.equal(failure.status, 409, await failure.clone().text());
    assert.equal((await failure.json()).code, "RENDER_SOURCE_UNAVAILABLE");
  } finally { storage.state.corrupt = false; }
  assert.deepEqual(await state(job), { status: "failed", attempts: 1, lease_until: null, error_code: "RENDER_SOURCE_UNAVAILABLE", sha256: null, frames: null, logs: 0 });
  assert.deepEqual(await pendingRoots(), initialRoots);

  const gate = storage.hold();
  const running = post(route);
  try {
    await waitForStorage(gate, running);
    const concurrent = await post(route);
    assert.equal(concurrent.status, 409);
    assert.equal((await concurrent.json()).code, "RENDER_RUNNING");
    assert.equal((await state(job)).status, "running");
  } finally { gate.release.resolve(); }
  const completed = await running;
  assert.equal(completed.status, 200, await completed.clone().text());
  const receipt = (await completed.json()).result;
  assert.equal(receipt.frames, frames);
  assert.equal(receipt.status, "succeeded");
  assert.deepEqual((await (await post(route)).json()).result, receipt);
  assert.deepEqual(await state(job), { status: "succeeded", attempts: 2, lease_until: null, error_code: null, sha256: receipt.sha256, frames, logs: 1 });
  const download = await get(route, owner);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "video/mp4");
  assert.match(download.headers.get("cache-control"), /no-store/);
  const mp4 = Buffer.from(await download.arrayBuffer());
  assert.equal(mp4.length, receipt.sizeBytes);
  assert.equal(createHash("sha256").update(mp4).digest("hex"), receipt.sha256);
  const { rows: [verified] } = await admin.query("SELECT verify_json FROM local_render_request.outputs WHERE job_id=$1", [job]);
  assert.equal(verified.verify_json.result, "passed");
  assert.equal(verified.verify_json.probe.codec, "h264");
  assert.equal(verified.verify_json.probe.audioStreams, 1);
  assert.equal(verified.verify_json.audio.output.decodedSamples, frames * SAMPLES_PER_FRAME);
  const downloadDetails = await inspectDownload?.(mp4);
  const listing = (await (await get("/renders", owner)).json()).result.requests;
  assert.equal(listing.find(request => request.jobId === job).status, "succeeded");

  async function edit() {
    const res = await post("/timeline/audio-clips", { assetId, expectedContentRevision: basis.revision, expectedTimelineId: basis.timelineId });
    assert.equal(res.status, 200, await res.clone().text());
    const saved = await res.json();
    basis = { revision: saved.contentRevision, timelineId: saved.timelineId };
  }
  await edit();
  assert.equal((await post(route)).status, 409);
  const staleJob = await enqueue(basis);
  const staleRoute = "/renders/" + staleJob + "/execute";
  const held = storage.hold();
  const unfinished = post(staleRoute);
  try {
    await waitForStorage(held, unfinished);
    await edit();
  } finally { held.release.resolve(); }
  const discarded = await unfinished;
  assert.equal(discarded.status, 409, await discarded.clone().text());
  assert.equal((await discarded.json()).code, "CURRENT_TIMELINE_CONFLICT");
  assert.deepEqual(await state(staleJob), { status: "failed", attempts: 1, lease_until: null,
    error_code: "CURRENT_TIMELINE_CONFLICT", sha256: null, frames: null, logs: 0 });
  assert.deepEqual(await pendingRoots(), initialRoots);
  if (secondImage) {
    const archiveJob = await enqueue(basis);
    const gate = storage.hold();
    const rendering = post("/renders/" + archiveJob + "/execute");
    try {
      await waitForStorage(gate, rendering);
      await admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1", [secondImage]);
      gate.release.resolve();
      const discarded = await rendering;
      assert.equal(discarded.status, 409);
      assert.equal((await discarded.json()).code, "RENDER_SOURCE_UNAVAILABLE");
      assert.deepEqual(await state(archiveJob), { status: "failed", attempts: 1, lease_until: null,
        error_code: "RENDER_SOURCE_UNAVAILABLE", sha256: null, frames: null, logs: 0 });
    } finally {
      gate.release.resolve();
      await admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1", [secondImage]);
    }
    assert.deepEqual(await pendingRoots(), initialRoots);
  }
  console.log("PG_QUEUED_RENDER " + JSON.stringify({ ...receipt, ...downloadDetails, refusedStale: true, cleanup: true }));
}
