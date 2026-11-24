import "server-only";
import type { Client } from "pg";
import { v7 } from "uuid";
import { z } from "zod";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { sceneFrameRange } from "@/lib/edit/timeline";
import { LocalRenderError, renderLocalPgStill, type StillSelection } from "@/lib/render/local-pg-still-render";
import { localWavTransaction, openLocalWavAccess } from "./local-wav-access";
import { hasLocalRenderApproval, loadLocalRenderProject, localRenderJobInput } from "./local-render-request";

const paramsSchema = z.object({ id: z.uuidv7(), jobId: z.uuidv7() });
const headers = { "Cache-Control": "private, no-store" };
const fail = (code: string, status: number) => Response.json({ code }, { status, headers });
type Key = [owner: string, project: string, jobId: string];
type Basis = z.infer<typeof localRenderJobInput>;
type Job = { status: string; attempts: string; max_attempts: string; active: boolean; input_snapshot_json: string };
type Claim = { attempt: number; basis: Basis; selections: StillSelection[] };

async function jobAndApproval(client: Client, key: Key, lock: boolean) {
  const [owner, project] = key;
  const current = await loadLocalRenderProject(client, owner, project, lock);
  if (!current) return fail("PROJECT_MISSING", 404);
  const { rows: [job] } = await client.query<Job>(`SELECT status,attempts,max_attempts,input_snapshot_json,
    lease_until>clock_timestamp() AS active FROM dream.jobs
    WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND kind='render-prepare'${lock ? " FOR UPDATE" : ""}`, key);
  if (!job) return fail("RENDER_REQUEST_MISSING", 404);
  const basis = localRenderJobInput.parse(JSON.parse(job.input_snapshot_json));
  if (basis.projectId !== project || current.current_timeline_rev_id !== basis.timelineId || Number(current.content_revision) !== basis.revision)
    return fail("CURRENT_TIMELINE_CONFLICT", 409);
  if (!await hasLocalRenderApproval(client, owner, project, basis.revision, lock))
    return fail("REVIEW_APPROVAL_REQUIRED", 409);
  return { job, basis };
}

async function readSelections(client: Client, [owner, project]: Key): Promise<StillSelection[] | undefined> {
  // Read every eligible selection in a stable order for the claim and settlement comparison.
  const { rows } = await client.query<{
    scene_id: string; version_id: string; duration_sec: string; asset_id: string; object_key: string; sha256: string; size_bytes: string;
    receipt_id: string; active_count: string;
  }>(`SELECT s.id AS scene_id,v.id AS version_id,s.duration_sec,a.id AS asset_id,o.object_key,o.sha256,o.size_bytes,r.id AS receipt_id,active.count AS active_count
    FROM dream.scenes s
    CROSS JOIN (SELECT count(*) FROM dream.scenes WHERE owner_id=$1 AND project_id=$2 AND archived_at IS NULL) active
    JOIN dream.scene_versions v ON (v.owner_id,v.id,v.scene_id)=(s.owner_id,s.selected_version_id,s.id)
    JOIN dream.assets a ON (a.owner_id,a.id)=(v.owner_id,v.result_asset_id)
    JOIN dream.asset_receipt_state ar ON (ar.owner_id,ar.asset_id)=(a.owner_id,a.id)
    JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(ar.owner_id,ar.object_id,ar.asset_id)
    JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
      =(ar.owner_id,ar.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
    JOIN dream.storage_verification_operations op ON (op.owner_id,op.id,op.object_id,op.generation,op.terminal_receipt_id)
      =(r.owner_id,r.operation_id,r.object_id,r.generation,r.id)
    JOIN dream.storage_policies p ON (p.policy_id,p.epoch,p.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
    WHERE s.owner_id=$1 AND s.project_id=$2 AND s.archived_at IS NULL AND s.needs_recheck=0
      AND active.count BETWEEN 1 AND 2
      AND v.kind='image' AND v.status='succeeded' AND a.kind='image' AND a.mime='image/png' AND a.archived_at IS NULL AND a.is_mock=0
      AND ar.status='ready' AND o.lifecycle='registered' AND o.bucket='t367-private' AND op.status='succeeded'
      AND p.policy_id='t367-local-png' AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp()
      AND (a.kind,a.mime,a.file_path,a.size_bytes,a.sha256,a.width,a.height)=(o.kind,o.mime,o.object_key,o.size_bytes,o.sha256,r.width,r.height)
    ORDER BY s.id FOR SHARE OF s,a,ar,o,p`, [owner, project]);
  if (!rows.length || rows.length !== Number(rows[0].active_count)) return undefined;
  return rows.map(row => ({ sceneId: row.scene_id, versionId: row.version_id, verificationId: row.receipt_id,
    frames: sceneFrameRange(Number(row.duration_sec), null).durationFrames,
    source: { ownerId: owner, id: row.asset_id, kind: "image", mime: "image/png", objectKey: row.object_key, sha256: row.sha256, sizeBytes: Number(row.size_bytes) } }));
}

async function stillOwnsWavs(client: Client, [owner, project]: Key, sources: { id: string; sha256: string }[]) {
  const { rows } = await client.query<{ id: string; sha256: string }>(`SELECT a.id,a.sha256 FROM dream.assets a
    JOIN local_wav.files f ON (f.owner_id,f.asset_id)=(a.owner_id,a.id)
    JOIN dream.project_assets l ON (l.owner_id,l.asset_id)=(a.owner_id,a.id)
    WHERE a.owner_id=$1 AND l.project_id=$2 AND a.archived_at IS NULL AND a.kind='audio' AND a.mime='audio/wav'
      AND l.purpose='productionAudio' AND a.id=ANY($3::uuid[])
      AND (a.sha256,a.size_bytes,a.duration_ms)=(f.digest,f.size_bytes,f.duration_ms)
    ORDER BY a.id FOR SHARE OF a,l`, [owner, project, sources.map(source => source.id)]);
  return rows.length === sources.length && sources.every(source => rows.some(row => row.id === source.id && row.sha256 === source.sha256));
}

async function result(client: Client, [owner, project, job]: Key, download: boolean) {
  const { rows: [output] } = await client.query<{ sha256: string; size_bytes: number; frames: number; content: Buffer | null }>(
    "SELECT sha256,size_bytes,frames,CASE WHEN $3::boolean THEN content END AS content FROM local_render_request.outputs WHERE owner_id=$1 AND job_id=$2",
    [owner, job, download]);
  if (!output) return fail("RENDER_OUTPUT_MISSING", 404);
  if (download && output.content) return new Response(Uint8Array.from(output.content), { headers: { ...headers,
    "Content-Type": "video/mp4", "Content-Length": String(output.size_bytes), "Content-Disposition": `attachment; filename="${job}.mp4"`,
    "X-Content-Type-Options": "nosniff" } });
  return Response.json({ result: { jobId: job, status: "succeeded", sha256: output.sha256, sizeBytes: output.size_bytes, frames: output.frames,
    downloadHref: `/api/projects/${project}/renders/${job}/execute` } }, { headers });
}

function failureCode(error: unknown) {
  if (error instanceof LocalRenderError) return error.code;
  const code = error instanceof Error && "code" in error ? error.code : "";
  if (code === "STALE_TIMELINE") return "CURRENT_TIMELINE_CONFLICT";
  if (code === "INVALID_TIMELINE") return "RENDER_INPUT_UNSUPPORTED";
  if (code === "REQUIRED_DISCLOSURE_MISSING") return "RENDER_REQUIRED_DISCLOSURE_MISSING";
  return typeof code === "string" && (code.startsWith("STORAGE_") || code.startsWith("SOURCE_"))
    ? "RENDER_SOURCE_UNAVAILABLE" : "RENDER_EXECUTION_FAILED";
}

export async function executeLocalRender(request: Request, params: Promise<{ id: string; jobId: string }>, download: boolean) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const route = paramsSchema.safeParse(await params);
  if (!route.success) return fail("RENDER_REQUEST_MISSING", 404);
  const key: Key = [access.owner, route.data.id, route.data.jobId];
  if (download) return localWavTransaction(access, "local_render_execute", false, async client => {
    const state = await jobAndApproval(client, key, false);
    if (state instanceof Response) return state;
    return state.job.status === "succeeded" ? result(client, key, true) : fail("RENDER_OUTPUT_MISSING", 404);
  });
  // Claim commits before any file work. The numbered attempt fences retries after an expired lease.
  const claimed = await localWavTransaction(access, "local_render_execute", true, async client => {
    const state = await jobAndApproval(client, key, true);
    if (state instanceof Response) return state;
    const { job, basis } = state;
    if (job.status === "succeeded") return result(client, key, false);
    if (job.status === "running" && job.active) return fail("RENDER_RUNNING", 409);
    if (!["queued", "failed", "running"].includes(job.status) || Number(job.attempts) >= Number(job.max_attempts))
      return fail("RENDER_RETRY_UNAVAILABLE", 409);
    const selections = await readSelections(client, key);
    if (!selections) return fail("RENDER_SOURCE_UNAVAILABLE", 409);
    const attempt = Number(job.attempts) + 1;
    await client.query(`UPDATE dream.jobs SET status='running',attempts=$4,lease_until=clock_timestamp()+interval '10 minutes',
      updated_at=clock_timestamp(),finished_at=NULL,error_code=NULL WHERE owner_id=$1 AND project_id=$2 AND id=$3`, [...key, attempt]);
    return Response.json({ claim: { basis, selections, attempt } }, { headers });
  });
  if (!claimed.ok) return claimed;
  const { claim } = await claimed.clone().json() as { claim?: Claim };
  if (!claim) return claimed;
  const { basis, selections, attempt } = claim;
  let settled: Response;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(9 * 60 * 1000)]);
    const output = await renderLocalPgStill(access, actorFromVerifiedUserId(access.owner), basis, selections, signal);
    signal.throwIfAborted();
    settled = await localWavTransaction(access, "local_render_execute", true, async client => {
      const state = await jobAndApproval(client, key, true);
      if (state instanceof Response) return state;
      if (state.job.status !== "running" || Number(state.job.attempts) !== attempt || !state.job.active) return fail("RENDER_CLAIM_LOST", 409);
      const current = await readSelections(client, key);
      if (!current || JSON.stringify(current) !== JSON.stringify(selections) || !await stillOwnsWavs(client, key, output.sources))
        return fail("RENDER_SOURCE_UNAVAILABLE", 409);
      signal.throwIfAborted();
      await client.query("INSERT INTO local_render_request.outputs(owner_id,job_id,content,frames,verify_json) VALUES($1,$2,$3,$4,$5)",
        [key[0], key[2], output.bytes, output.frames, JSON.stringify(output.verify)]);
      await client.query(`UPDATE dream.jobs SET status='succeeded',lease_until=NULL,updated_at=clock_timestamp(),finished_at=clock_timestamp()
        WHERE owner_id=$1 AND project_id=$2 AND id=$3`, key);
      await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
        VALUES($1,$2,$3,'local-user','render.completed',$4,clock_timestamp())`, [key[0], key[1], v7(),
        JSON.stringify({ jobId: key[2], timelineId: basis.timelineId, contentRevision: basis.revision })]);
      return result(client, key, false);
    });
  } catch (error) {
    const code = failureCode(error);
    settled = fail(code, ["RENDER_SOURCE_UNAVAILABLE", "CURRENT_TIMELINE_CONFLICT", "RENDER_INPUT_UNSUPPORTED",
      "RENDER_REQUIRED_DISCLOSURE_MISSING"].includes(code) ? 409 : 503);
  }
  if (settled.ok) return settled;
  const { code } = await settled.clone().json() as { code: string };
  const recorded = await localWavTransaction(access, "local_render_execute", true, async client => {
    await client.query(`UPDATE dream.jobs SET status='failed',lease_until=NULL,error_code=$5,updated_at=clock_timestamp(),finished_at=clock_timestamp()
      WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND status='running' AND attempts=$4`, [...key, attempt, code]);
    return new Response(null, { status: 204 });
  });
  // An uncertain commit may already have finished the job. A repeat POST returns its original receipt.
  return recorded.ok ? settled : recorded;
}
