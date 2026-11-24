/* global console, process */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { v7 } from "uuid";
import { readAdminRenderQueue } from "../../lib/services/postgres/admin-render-queue.ts";
import { withActorTransaction } from "../../lib/db/postgres/transaction.ts";

export async function verify({ admin, cfg, a, b, worker, baselineProject }) {
  const { rows: [password] } = await admin.query("SELECT quote_literal($1::text) AS literal", [cfg.password]);
  await admin.query("CREATE ROLE admin_queue_test_login LOGIN NOINHERIT PASSWORD " + password.literal);
  await admin.query("GRANT dream_api TO admin_queue_test_login WITH INHERIT FALSE, SET TRUE");
  const pool = new Pool({ ...cfg, user: "admin_queue_test_login", max: 1 });
  const archived = v7(), project2 = v7(), other = v7();
  for (const [actor, id, title, isArchived] of [
    [a, project2, "second owned project", false],
    [a, archived, "archived title", true],
    [b, other, "other account title", false],
  ]) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,
      inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at,archived_at)
      VALUES($1,$2,'fixture','1','{}','{}',$3,'','','9:16',4,now(),now(),CASE WHEN $4 THEN now() END)`,
      [actor.id, id, title, isArchived]);
  }

  async function job(actor, project, kind, status, minute) {
    const id = v7(), createdAt = new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
    const completed = ["succeeded", "failed", "canceled"].includes(status);
    await admin.query(`INSERT INTO dream.jobs(owner_id,id,project_id,kind,input_snapshot_json,status,
      ref_type,ref_id,provider,provider_job_id,idempotency_key,error_message,created_at,updated_at,finished_at)
      VALUES($1,$2,$3,$4,'{"private":"never in the DTO"}',$5,'project',$3,'local','private-provider',$2::uuid::text,
        'fixture private details',$6,$6,CASE WHEN $7 THEN $6::timestamptz END)`,
      [actor.id, id, project, kind, status, createdAt, completed]);
    return { id, createdAt, completed, status };
  }

  const states = ["queued", "running", "succeeded", "failed", "canceled"];
  const owned = [];
  for (let i = 0; i < 55; i++) {
    owned.push(await job(a, i % 2 ? project2 : baselineProject, i % 2 ? "render" : "render-prepare",
      states[i % states.length], Math.floor(i / 2)));
  }
  const foreign = await job(b, other, "render-prepare", "running", 30);
  await job(a, archived, "render-prepare", "queued", 31);
  await job(a, project2, "backup", "queued", 32);

  const dbState = async () => (await admin.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(j)||jsonb_build_object('rowVersion',j.xmin::text) ORDER BY j.id) FROM dream.jobs j) AS jobs,
    (SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('rowVersion',p.xmin::text) ORDER BY p.id) FROM dream.projects p) AS projects,
    (SELECT count(*) FROM dream.renders) AS renders,(SELECT count(*) FROM dream.activity_log) AS activity`)).rows[0];
  const before = await dbState();
  const verified = actor => ({ kind: "verified", userId: actor.id, email: "allowlisted@example.invalid" });
  let getPoolCalls = 0;
  const open = auth => readAdminRenderQueue({
    resolveAuth: async () => auth,
    getPool: () => { getPoolCalls++; return pool; },
  });

  try {
    assert.equal((await open({ kind: "denied", status: 401, code: "AUTH_REQUIRED" })).status, 401);
    assert.equal((await open({ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" })).status, 403);
    assert.equal((await open({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" })).body.code, "AUTH_UNAVAILABLE");
    assert.equal((await open({ kind: "local" })).status, 401);
    assert.equal((await open({ ...verified(a), userId: "invalid" })).status, 503);
    assert.equal(getPoolCalls, 0, "No pool selection before verified Auth");

    const visible = await withActorTransaction(pool, a, async tx => {
      const { rows } = await tx.query("SELECT DISTINCT owner_id FROM dream.jobs");
      return rows.map(row => row.owner_id);
    }, { mode: "read-only-repeatable-read" });
    assert.deepEqual(visible, [a.id]);

    const first = await open(verified(a));
    assert.equal(first.status, 200);
    assert.equal(first.headers["cache-control"], "private, no-store");
    assert.equal(first.body.jobs.length, 50);
    assert.deepEqual(first.body.jobs.map(row => row.jobId), owned.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 50).map(row => row.id));
    const labels = { queued: "대기", running: "진행 중", succeeded: "성공", failed: "실패", canceled: "취소" };
    assert.deepEqual(new Set(first.body.jobs.map(row => row.projectTitle)), new Set(["preexisting", "second owned project"]));
    assert.equal(new Set(first.body.jobs.map(row => row.status)).size, 5);
    for (const item of first.body.jobs) {
      assert.equal(item.statusLabel, labels[item.status]);
      assert.equal(item.finishedAt === null, item.status === "queued" || item.status === "running");
      assert.deepEqual(Object.keys(item).sort(), [
        "createdAt", "finishedAt", "jobId", "projectId", "projectTitle", "status", "statusLabel", "updatedAt",
      ]);
    }

    const second = await open(verified(b));
    assert.deepEqual(second.body.jobs.map(job => job.jobId), [foreign.id]);
    assert.deepEqual((await open(verified(worker))).body, { jobs: [] });
    assert.deepEqual(await open(verified(a)), first, "Reusing a pooled connection preserves account isolation");
    assert.deepEqual(await dbState(), before, "No jobs, projects, renders or activity changed");
    if (process.env.ADMIN_RENDER_QUEUE_VERIFY_HTTP === "1") {
      const { verifyAdminQueueHttp } = await import("./admin-render-queue-http.mjs");
      await verifyAdminQueueHttp({ admin, cfg, a, b, worker, first, foreign, dbState, before });
    }
  } finally { await pool.end(); }
  const unavailable = await open(verified(a));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, {
    code: "ADMIN_RENDER_QUEUE_UNAVAILABLE", error: "렌더 작업을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  });
  console.log("Admin render queue PG17: Auth before pool, five statuses, owner RLS, deterministic 50 rows, empty, unavailable, and no writes verified");
}
