import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { v7 } from "uuid";
import { z } from "zod";
import { canonicalJson, outputFrames, timelineSchema } from "@/lib/edit/timeline";
import { localWavTransaction, openLocalWavAccess } from "./local-wav-access";

const basis = z.strictObject({ revision: z.number().int().positive().safe(), timelineId: z.uuid() });
export const localRenderJobInput = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.uuidv7(), revision: basis.shape.revision, timelineId: basis.shape.timelineId,
  timelineRevision: z.number().int().positive().safe(), timelineSha256: z.string().regex(/^[a-f0-9]{64}$/),
  outputFrames: z.number().int().positive().safe(),
});
type Project = { content_revision: string; current_timeline_rev_id: string | null; aspect: string };
type Job = { id: string; project_id: string; status: string; input_snapshot_json: string; created_at: Date };
const columns = "id, project_id, status, input_snapshot_json, created_at";
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const fail = (code: string, status: number) => respond({ code }, status);
const reply = (job: Job, existing: boolean) => respond({ result: { jobId: job.id, status: job.status, existing } }, 202);

export function localRenderRequestsEnabled() {
  return process.env.DREAM_PROJECT_CREATE_BACKEND === "owned-pg17" && process.env.DREAM_PRIVATE_UPLOAD_BACKEND === "owned-pg17";
}

export async function loadLocalRenderProject(client: Client, owner: string, project: string, lock: boolean) {
  const { rows: [row] } = await client.query<Project>(`SELECT content_revision,current_timeline_rev_id,aspect FROM dream.projects
    WHERE owner_id=$1 AND id=$2 AND archived_at IS NULL AND menu_id='shopping-shorts'${lock ? " FOR SHARE" : ""}`, [owner, project]);
  return row;
}

export async function hasLocalRenderApproval(client: Client, owner: string, project: string, revision: number, lock: boolean) {
  const { rows: stages } = await client.query<{ stage: string; status: string; approved_revision: string | null }>(
    `SELECT stage,status,approved_revision FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2
      AND stage IN ('produce','review') ORDER BY stage${lock ? " FOR SHARE" : ""}`, [owner, project]);
  return stages.some(stage => stage.stage === "produce" && stage.status === "approved") &&
    stages.some(stage => stage.stage === "review" && stage.status === "approved" && Number(stage.approved_revision) === revision);
}

async function list(client: Client, owner: string, project: string, current: Project) {
  const { rows } = await client.query<Job>(`SELECT ${columns} FROM dream.jobs WHERE owner_id=$1 AND project_id=$2 AND kind='render-prepare'
    ORDER BY created_at DESC,id DESC LIMIT 50`, [owner, project]);
  return respond({ result: {
    workerOnline: false, contentRevision: Number(current.content_revision), timelineId: current.current_timeline_rev_id,
    check: null, renders: [], requests: rows.map(job => {
      const input = localRenderJobInput.parse(JSON.parse(job.input_snapshot_json));
      return { jobId: job.id, status: job.status, createdAt: job.created_at.toISOString(),
        timelineRevision: input.timelineRevision, contentRevision: input.revision, timelineId: input.timelineId,
        stale: input.revision !== Number(current.content_revision) || input.timelineId !== current.current_timeline_rev_id };
    }),
  } });
}

async function enqueue(client: Client, owner: string, project: string, current: Project, input: z.infer<typeof basis>, requestId: string) {
  const key = [owner, project];
  if (input.revision !== Number(current.content_revision) || input.timelineId !== current.current_timeline_rev_id)
    return fail("CURRENT_TIMELINE_CONFLICT", 409);

  if (!await hasLocalRenderApproval(client, owner, project, input.revision, true))
    return fail("REVIEW_APPROVAL_REQUIRED", 409);

  const { rows: [previous] } = await client.query<Job>(`SELECT j.id,j.project_id,j.status,j.input_snapshot_json,j.created_at
    FROM local_render_request.keys k JOIN dream.jobs j ON (j.owner_id,j.id)=(k.owner_id,k.job_id)
    WHERE k.owner_id=$1 AND k.request_id=$2`, [owner, requestId]);
  if (previous) {
    const saved = localRenderJobInput.parse(JSON.parse(previous.input_snapshot_json));
    return previous.project_id === project && saved.revision === input.revision && saved.timelineId === input.timelineId
      ? reply(previous, true) : fail("REQUEST_CONFLICT", 409);
  }

  const { rows: [row] } = await client.query<{ revision: string; content_revision: string; timeline_json: string; timeline_sha256: string }>(`
    SELECT revision,content_revision,timeline_json,timeline_sha256 FROM dream.timeline_revisions
    WHERE owner_id=$1 AND project_id=$2 AND id=$3`, [...key, input.timelineId]);
  if (!row || Number(row.content_revision) !== input.revision ||
      createHash("sha256").update(row.timeline_json).digest("hex") !== row.timeline_sha256)
    return fail("INVALID_BASE_TIMELINE", 409);
  const timeline = timelineSchema.safeParse(JSON.parse(row.timeline_json));
  if (!timeline.success || timeline.data.aspect !== current.aspect || canonicalJson(timeline.data) !== row.timeline_json ||
      !timeline.data.video.length || timeline.data.video.some(clip => !clip.assetId || !clip.sceneVersionId) ||
      timeline.data.schemaVersion === 1 && timeline.data.audio.length > 0)
    return fail("INVALID_BASE_TIMELINE", 409);
  const snapshot = localRenderJobInput.parse({ schemaVersion: 1, projectId: project, ...input, timelineRevision: Number(row.revision),
    timelineSha256: row.timeline_sha256, outputFrames: outputFrames(timeline.data) });
  const jobKey = `render-prepare:${project}:${input.timelineId}:${input.revision}`;
  const { rows: [existing] } = await client.query<Job>(`SELECT ${columns} FROM dream.jobs
    WHERE owner_id=$1 AND project_id=$2 AND kind='render-prepare' AND idempotency_key=$3`, [...key, jobKey]);
  let job = existing;
  if (!job) {
    const { rows: [created] } = await client.query<Job>(`INSERT INTO dream.jobs(
      owner_id,project_id,id,kind,payload_version,input_snapshot_json,status,ref_type,ref_id,provider,idempotency_key,created_at,updated_at)
      VALUES($1,$2,$3,'render-prepare',1,$4,'queued','project',$2,'local',$5,clock_timestamp(),clock_timestamp())
      RETURNING ${columns}`, [...key, v7(), canonicalJson(snapshot), jobKey]);
    job = created;
    await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
      VALUES($1,$2,$3,'local-user','render.requested',$4,clock_timestamp())`, [...key, v7(), canonicalJson({ jobId: job.id, ...snapshot })]);
  }
  await client.query("INSERT INTO local_render_request.keys(owner_id,request_id,job_id) VALUES($1,$2,$3)", [owner, requestId, job.id]);
  return reply(job, !!existing);
}

export async function localRenderRequest(request: Request, params: Promise<{ id: string }>, write: boolean) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  if (!z.uuidv7().safeParse(id).success) return fail("PROJECT_MISSING", 404);
  if (!write) return localWavTransaction(access, "local_render_request", false, async client => {
    const project = await loadLocalRenderProject(client, access.owner, id, false);
    return project ? list(client, access.owner, id, project) : fail("PROJECT_MISSING", 404);
  });
  const input = basis.safeParse(await request.json().catch(() => null));
  const requestId = z.uuidv7().safeParse(request.headers.get("Idempotency-Key"));
  if (!input.success || !requestId.success) return fail("INVALID_REQUEST", 400);
  return localWavTransaction(access, "local_render_request", true, async client => {
    // The same owner's key must resolve consistently even across two different projects.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`local-render-request:${access.owner}`]);
    const project = await loadLocalRenderProject(client, access.owner, id, true);
    return project ? enqueue(client, access.owner, id, project, input.data, requestId.data) : fail("PROJECT_MISSING", 404);
  });
}
