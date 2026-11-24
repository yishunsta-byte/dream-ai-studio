/* global Buffer, URLSearchParams, fetch, console */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { newTextLayer } from "../../lib/edit/text-ops.ts";
import { canonicalJson } from "../../lib/edit/timeline.ts";

export async function testProjectSubtitles({ origin, owner, other, admin, project }) {
  const endpoint = origin + "/api/projects/" + project + "/timeline/subtitles";
  const request = async (cookie, body, key = v7()) => {
    const response = await fetch(endpoint, { method: body ? "POST" : "GET", headers: {
      ...(cookie && { cookie }), ...(body && { "content-type": "application/json", origin, "idempotency-key": key }),
    }, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const download = (format, current, cookie = owner) => {
    const query = new URLSearchParams({ format, revision: String(current.contentRevision), timelineId: current.timelineId });
    return fetch(endpoint + "/download?" + query, { headers: cookie ? { cookie } : {} });
  };
  const assertDownloadError = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal((await response.json()).code, code);
  };
  async function approve(current) {
    const review = async (action, input) => {
      const response = await fetch(origin + "/api/projects/" + project + "/review", {
        method: "POST", headers: { cookie: owner, origin, "content-type": "application/json" },
        body: JSON.stringify({ action, revision: current.contentRevision, timelineId: current.timelineId, ...input }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const ready = await review("complete-edit");
    for (const item of ready.items.filter(item => item.required)) {
      await review("review-item", { input: { itemId: item.id, status: "pass", note: "" } });
    }
    assert.equal((await review("approve-review")).approved, true);
  }
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(other)).status, 404);
  const initial = await request(owner);
  assert.equal(initial.status, 200, JSON.stringify(initial));
  assert.equal(initial.body.blockedReason, null);
  assert.deepEqual(initial.body.subtitles, []);
  const revision = initial.body.contentRevision + 1, timelineId = v7();
  const load = async id => (await admin.query("SELECT timeline_json::jsonb AS timeline FROM dream.timeline_revisions WHERE id=$1", [id])).rows[0].timeline;
  const timeline = await load(initial.body.timelineId);
  const frameInfo = { startFrame: 0, videoFrames: 30, plannedFrames: 30 };
  const kept = newTextLayer("subtitle", { ...frameInfo, content: "이전 자막" });
  const fixed = newTextLayer("disclosure", { ...frameInfo, content: "광고" });
  const title = newTextLayer("title", { ...frameInfo, content: "보존할 제목" });
  timeline.text = [title, kept, fixed];
  const json = canonicalJson(timeline);
  // Import a saved baseline with styled text, an old locked disclosure and one newly required flag.
  await admin.query(`INSERT INTO dream.timeline_revisions(owner_id,id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,created_at)
    SELECT owner_id,$2,id,$3,$4,$5,$6,'user',now() FROM dream.projects WHERE id=$1`,
    [project, timelineId, initial.body.timelineRevision + 1, revision, json, createHash("sha256").update(json).digest("hex")]);
  await admin.query(`UPDATE dream.projects SET current_timeline_rev_id=$2,content_revision=$3,
    inputs_json=(inputs_json::jsonb || '{"isAd":true,"realisticAi":true}'::jsonb)::text WHERE id=$1`, [project, timelineId, revision]);
  await admin.query("UPDATE dream.stage_states SET status='approved',approved_revision=$2,approved_at=now() WHERE project_id=$1 AND stage IN ('edit','review','export')", [project, revision]);

  const updated = { id: kept.id, content: "새 자막\n둘째 줄", startFrame: 4, endFrame: 21 };
  const added = { id: v7(), content: "추가 자막", startFrame: 22, endFrame: 30 };
  const body = { expectedContentRevision: revision, expectedTimelineId: timelineId, subtitles: [updated, added] };
  assert.equal((await request(null, body)).status, 401);
  assert.equal((await request(other, body)).status, 404);
  assert.equal((await request(owner, { ...body, expectedContentRevision: revision - 1 })).body.code, "CURRENT_TIMELINE_CONFLICT");
  assert.equal((await request(owner, { ...body, subtitles: [{ ...updated, id: fixed.id }] })).body.code, "PROTECTED_TEXT_LAYER");
  assert.equal((await request(owner, { ...body, subtitles: [{ ...updated, endFrame: 10000 }] })).body.code, "SUBTITLE_TIME_EXCEEDED");
  assert.equal((await request(owner, { ...body, subtitles: [updated, updated] })).status, 400);
  const key = v7();
  const held = await request(owner);
  assert.deepEqual(held.body.subtitles, [{ id: kept.id, content: kept.content, ...kept.timing }]);
  await admin.query("CREATE FUNCTION local_wav.fail_subtitle_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
  await admin.query("CREATE TRIGGER fail_subtitle_log BEFORE INSERT ON dream.activity_log FOR EACH ROW WHEN (NEW.action='timeline.subtitles.save') EXECUTE FUNCTION local_wav.fail_subtitle_log()");
  try {
    assert.equal((await request(owner, body, key)).status, 503);
    assert.deepEqual(await request(owner), held);
    const { rows: [review] } = await admin.query("SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='review'", [project]);
    assert.equal(review.status, "approved");
  } finally { await admin.query("DROP TRIGGER fail_subtitle_log ON dream.activity_log; DROP FUNCTION local_wav.fail_subtitle_log()"); }

  const both = await Promise.all([request(owner, body, key), request(owner, body, key)]);
  const [saved, replay] = both;
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.deepEqual(replay, saved);
  assert.equal(saved.body.contentRevision, revision + 1);
  assert.equal(saved.body.changed, true);
  assert.equal((await request(owner, { ...body, subtitles: [] }, key)).body.code, "REQUEST_CONFLICT");
  assert.equal((await request(owner, body)).body.code, "CURRENT_TIMELINE_CONFLICT");
  const refreshed = (await request(owner)).body;
  assert.deepEqual(refreshed.subtitles, [updated, added]);
  assert.equal(refreshed.timelineId, saved.body.timelineId);
  const actual = await load(saved.body.timelineId);
  assert.deepEqual(await load(timelineId), timeline);
  assert.deepEqual({ ...actual, text: [] }, { ...timeline, text: [] });
  assert.deepEqual(actual.text[0], title);
  assert.deepEqual(actual.text[1], { ...kept, content: updated.content, timing: { startFrame: 4, endFrame: 21 } });
  assert.deepEqual(actual.text[2], fixed);
  assert.ok(actual.text.some(layer => layer.kind === "disclosure" && layer.locked && layer.content === "AI 생성" &&
    layer.timing.startFrame === 0 && layer.timing.endFrame === 30));
  const { rows: stages } = await admin.query("SELECT stage,status,approved_revision FROM dream.stage_states WHERE project_id=$1 AND stage IN ('edit','review','export') ORDER BY stage", [project]);
  assert.deepEqual(stages.map(row => [row.status, row.approved_revision]), [["in_progress", null], ["locked", null], ["locked", null]]);
  const { rows: [audit] } = await admin.query("SELECT count(*)::int AS count FROM dream.activity_log WHERE project_id=$1 AND action='timeline.subtitles.save'", [project]);
  assert.equal(audit.count, 1);

  await assertDownloadError(await download("srt", refreshed, null), 401, "AUTH_REQUIRED");
  await assertDownloadError(await download("vtt", refreshed, other), 404, "PROJECT_MISSING");
  await assertDownloadError(await download("txt", refreshed), 400, "INVALID_REQUEST");
  await assertDownloadError(await download("srt", refreshed), 409, "REVIEW_APPROVAL_REQUIRED");
  await approve(refreshed);
  await assertDownloadError(await download("vtt", { ...refreshed, timelineId: v7() }), 409, "CURRENT_TIMELINE_CONFLICT");
  await assertDownloadError(await download("srt", { ...refreshed, contentRevision: refreshed.contentRevision - 1 }), 409, "CURRENT_TIMELINE_CONFLICT");
  const formats = [
    ["srt", "application/x-subrip; charset=utf-8",
      `1\n00:00:00,133 --> 00:00:00,700\n${updated.content}\n\n2\n00:00:00,733 --> 00:00:01,000\n${added.content}\n`],
    ["vtt", "text/vtt; charset=utf-8",
      `WEBVTT\n\n${updated.id}\n00:00:00.133 --> 00:00:00.700\n${updated.content}\n\n${added.id}\n00:00:00.733 --> 00:00:01.000\n${added.content}\n`],
  ];
  const counts = async () => (await admin.query(`SELECT
    (SELECT count(*) FROM dream.activity_log WHERE project_id=$1) AS activities,
    (SELECT count(*) FROM dream.timeline_revisions WHERE project_id=$1) AS revisions,
    (SELECT count(*) FROM dream.jobs WHERE project_id=$1) AS jobs`, [project])).rows[0];
  await admin.query("UPDATE dream.scenes SET needs_recheck=1 WHERE project_id=$1", [project]);
  try { await assertDownloadError(await download("vtt", refreshed), 409, "BASE_TIMELINE_STALE"); }
  finally { await admin.query("UPDATE dream.scenes SET needs_recheck=0 WHERE project_id=$1", [project]); }

  const beforeDownloads = await counts();
  for (const [format, mime, expected] of formats) {
    const response = await download(format, refreshed);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="subtitles-r' + refreshed.contentRevision + "." + format + '"');
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(expected, "utf8"));
  }
  assert.deepEqual(await counts(), beforeDownloads);

  const base = { expectedContentRevision: refreshed.contentRevision, expectedTimelineId: refreshed.timelineId };
  const noopKey = v7(), noop = await request(owner, { ...base, subtitles: refreshed.subtitles }, noopKey);
  assert.deepEqual(noop.body, { ...saved.body, changed: false });
  const changed = await Promise.all([
    request(owner, { ...base, subtitles: [added] }),
    request(owner, { ...base, subtitles: [{ ...added, content: "다른 탭" }] }),
  ]);
  assert.deepEqual(changed.map(result => result.status).sort(), [200, 409]);
  assert.deepEqual(await request(owner, body, key), saved);
  assert.deepEqual(await request(owner, { ...base, subtitles: refreshed.subtitles }, noopKey), noop);
  assert.equal((await request(owner)).body.subtitles.length, 1);
  const latest = (await request(owner)).body;
  await assertDownloadError(await download("vtt", refreshed), 409, "CURRENT_TIMELINE_CONFLICT");
  await assertDownloadError(await download("srt", latest), 409, "REVIEW_APPROVAL_REQUIRED");
  const emptied = await request(owner, { expectedContentRevision: latest.contentRevision, expectedTimelineId: latest.timelineId, subtitles: [] });
  assert.equal(emptied.status, 200);
  await approve(emptied.body);
  for (const format of ["srt", "vtt"]) {
    await assertDownloadError(await download(format, emptied.body), 404, "SUBTITLES_EMPTY");
  }
  console.log("Approved subtitle download HTTP: exact Korean SRT/VTT bytes, no writes, stale and unapproved rejection, and empty subtitle response verified");
  console.log("Subtitle HTTP: actual read/save, preserved layers, locked disclosures, revision CAS, replay and approval rollback passed");
}
