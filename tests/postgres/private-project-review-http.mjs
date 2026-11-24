/* global fetch,console */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { v7 } from "uuid";

export async function installProjectReview(admin, cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/project-review.sql", import.meta.url), "utf8"));
  const { rows: [password] } = await admin.query("SELECT quote_literal($1::text) AS literal", [cfg.password]);
  await admin.query("CREATE ROLE local_project_review_login LOGIN NOINHERIT PASSWORD " + password.literal);
  await admin.query("GRANT local_project_review TO local_project_review_login WITH INHERIT FALSE, SET TRUE");
}

export async function testProjectReview({ origin, owner, other, admin, project }) {
  const path = origin + "/api/projects/" + project + "/review";
  const call = async (cookie, command) => {
    const response = await fetch(path, {
      method: command ? "POST" : "GET",
      headers: { ...(cookie && { cookie }), ...(command && { "content-type": "application/json", origin }) },
      body: command && JSON.stringify(command),
    });
    assert.equal(response.headers.get("cache-control"), cookie ? "private, no-store" : "no-store");
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(other)).status, 404);
  const initial = await call(owner);
  assert.equal(initial.status, 200);
  const { revision, timelineId, items } = initial.body;
  assert.equal(initial.body.blockedReason, null);
  assert.equal(initial.body.editCompleted, false);
  assert.ok(items.some(item => item.id === "x.music-rights" && item.required && item.status === "unchecked"));
  const send = (action, fields) => call(owner, { action, revision, timelineId, ...fields });
  assert.equal((await send("approve-review")).body.code, "EDIT_COMPLETION_REQUIRED");
  assert.equal((await send("complete-edit", { revision: revision - 1 })).body.code, "CURRENT_TIMELINE_CONFLICT");
  assert.equal((await send("complete-edit", { timelineId: v7() })).body.code, "CURRENT_TIMELINE_CONFLICT");

  await admin.query("UPDATE dream.stage_states SET status='in_progress' WHERE project_id=$1 AND stage='produce'", [project]);
  assert.equal((await send("complete-edit")).body.code, "PRODUCE_APPROVAL_REQUIRED");
  await admin.query("UPDATE dream.stage_states SET status='approved' WHERE project_id=$1 AND stage='produce'", [project]);
  await admin.query("UPDATE dream.scenes SET needs_recheck=1 WHERE project_id=$1", [project]);
  assert.equal((await call(owner)).body.blockedReason, "BASE_TIMELINE_STALE");
  assert.equal((await send("complete-edit")).body.code, "BASE_TIMELINE_STALE");
  await admin.query("UPDATE dream.scenes SET needs_recheck=0 WHERE project_id=$1", [project]);

  const counts = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='stage.complete') AS completed,
    (SELECT count(*)::int FROM dream.review_items WHERE project_id=$1) AS items,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='review.item') AS checked,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='review.approve') AS approved`, [project])).rows[0];
  assert.deepEqual(await counts(), { completed: 0, items: 0, checked: 0, approved: 0 });
  const completed = await Promise.all([send("complete-edit"), send("complete-edit")]);
  assert.ok(completed.every(entry => entry.status === 200 && entry.body.editCompleted));
  assert.equal((await counts()).completed, 1);
  assert.equal((await send("approve-review")).body.code, "REQUIRED_ITEMS_INCOMPLETE");
  const required = items.filter(item => item.required);
  const itemId = required[0].id;
  assert.equal((await send("review-item", { input: { itemId, status: "hold", note: " " } })).status, 400);
  const held = await send("review-item", { input: { itemId, status: "hold", note: "Check rights" } });
  assert.equal(held.status, 200);
  assert.equal(held.body.items.find(item => item.id === itemId).note, "Check rights");
  assert.equal((await send("approve-review")).body.code, "REQUIRED_ITEMS_INCOMPLETE");
  for (const { id } of required) {
    const checked = await send("review-item", { input: { itemId: id, status: "pass", note: "" } });
    assert.equal(checked.status, 200, JSON.stringify(checked));
    assert.equal(checked.body.approved, false);
  }
  const queue = () => fetch(origin + "/api/projects/" + project + "/renders", {
    method: "POST", headers: { cookie: owner, "content-type": "application/json", "idempotency-key": v7() },
    body: JSON.stringify({ revision, timelineId }),
  });
  assert.equal((await queue()).status, 409);
  await admin.query("CREATE FUNCTION local_wav.test_review_log_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
  await admin.query("CREATE TRIGGER test_review_log_failure BEFORE INSERT ON dream.activity_log FOR EACH ROW WHEN (NEW.action='review.approve') EXECUTE FUNCTION local_wav.test_review_log_failure()");
  try {
    assert.equal((await send("approve-review")).status, 503);
    assert.equal((await call(owner)).body.approved, false);
    const { rows: [stage] } = await admin.query("SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='export'", [project]);
    assert.equal(stage.status, "locked");
  } finally { await admin.query("DROP TRIGGER test_review_log_failure ON dream.activity_log; DROP FUNCTION local_wav.test_review_log_failure()"); }

  const approved = await Promise.all([send("approve-review"), send("approve-review")]);
  assert.ok(approved.every(entry => entry.status === 200 && entry.body.approved), JSON.stringify(approved));
  assert.deepEqual(await counts(), { completed: 1, items: required.length, checked: required.length + 1, approved: 1 });
  assert.equal((await send("review-item", { input: { itemId, status: "hold", note: "Recheck" } })).body.code, "REVIEW_ALREADY_APPROVED");
  assert.equal((await queue()).status, 202);
  const { rows: [audio] } = await admin.query("SELECT asset_id FROM dream.project_assets WHERE project_id=$1 AND purpose='productionAudio'", [project]);
  const changed = await fetch(origin + "/api/projects/" + project + "/timeline/audio-clips", {
    method: "POST", headers: { cookie: owner, "content-type": "application/json", "idempotency-key": v7() },
    body: JSON.stringify({ assetId: audio.asset_id, expectedContentRevision: revision, expectedTimelineId: timelineId }),
  });
  assert.equal(changed.status, 200);
  assert.equal((await send("approve-review")).body.code, "CURRENT_TIMELINE_CONFLICT");
  const afterEdit = (await call(owner)).body;
  assert.equal(afterEdit.revision, revision + 1);
  assert.equal(afterEdit.editCompleted, false);
  assert.equal(afterEdit.approved, false);
  assert.ok(afterEdit.items.every(item => item.status === "unchecked"));
  assert.equal((await counts()).items, required.length);
  console.log("Review HTTP: scene and timeline gates, explicit edit completion, music rights, failed approval rollback and render queue gating passed");
}
