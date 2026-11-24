import "server-only";

import { readFile } from "node:fs/promises";
import type { Client } from "pg";
import { v7 } from "uuid";
import { z } from "zod";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { PgEditingBundleError, useLocalPgEditingBundle as withLocalPgEditingBundle } from "@/lib/export/local-pg-editing-bundle";
import { pgBundleSha256 } from "@/lib/export/local-pg-editing-input";
import { localWavTransaction, openLocalWavAccess } from "./local-wav-access";

const projectIdSchema = z.uuidv7();
const basisSchema = z.strictObject({ revision: z.number().int().positive().safe(), timelineId: z.uuidv7() });
const headers = { "Cache-Control": "private, no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
const fail = (code: string, status: number) => response({ code }, status);
const conflict = (code: string) => fail(code, 409);
type Key = [owner: string, project: string];
type Basis = z.infer<typeof basisSchema>;
type Current = { content_revision: string; current_timeline_rev_id: string | null; approved_plan_id: string | null };
type Claim = { id: string; attemptId: string; planId: string; timelineSha256: string };
type Row = {
  export_id: string; content_revision: string; timeline_id: string; plan_id: string; timeline_sha256: string;
  active: boolean; status: "running" | "failed" | "succeeded"; sha256: string | null; size_bytes: number | null;
};

const bundleRows = `SELECT c.export_id,c.content_revision,c.timeline_id,c.plan_id,c.timeline_sha256,
  c.lease_until>clock_timestamp() AS active,e.status,e.sha256,o.size_bytes
  FROM local_editing_bundle.claims c JOIN dream.exports e ON (e.owner_id,e.id,e.project_id)=(c.owner_id,c.export_id,c.project_id)
  LEFT JOIN local_editing_bundle.outputs o ON (o.owner_id,o.export_id)=(c.owner_id,c.export_id)
  WHERE c.owner_id=$1 AND c.project_id=$2`;

function receipt(project: string, row: Row) {
  return {
    id: row.export_id, contentRevision: Number(row.content_revision), timelineId: row.timeline_id, status: row.status,
    sha256: row.sha256, sizeBytes: row.size_bytes,
    downloadHref: row.status === "succeeded" && row.size_bytes
      ? `/api/projects/${project}/exports/${row.export_id}` : null,
  };
}

async function readProject(client: Client, key: Key, lock = false) {
  const { rows: [project] } = await client.query<Current>(`SELECT content_revision,current_timeline_rev_id,approved_plan_id
    FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL${lock ? " FOR UPDATE" : ""}`, key);
  return project;
}

const matches = (project: Current, basis: Basis) =>
  Number(project.content_revision) === basis.revision && project.current_timeline_rev_id === basis.timelineId;

async function approvedTimeline(client: Client, key: Key, project: Current, basis: Basis) {
  if (!project.approved_plan_id) return;
  const { rows: [timeline] } = await client.query<{ timeline_sha256: string }>(`SELECT t.timeline_sha256
    FROM dream.timeline_revisions t JOIN dream.stage_states plan ON (plan.owner_id,plan.project_id)=(t.owner_id,t.project_id)
      AND plan.stage='plan' AND plan.status='approved' AND plan.approved_plan_id=$5
    JOIN dream.stage_states produce ON (produce.owner_id,produce.project_id)=(t.owner_id,t.project_id)
      AND produce.stage='produce' AND produce.status='approved' AND produce.approved_plan_id=$5
    JOIN dream.stage_states edit ON (edit.owner_id,edit.project_id)=(t.owner_id,t.project_id)
      AND edit.stage='edit' AND edit.status='approved' AND edit.approved_revision=$3
    JOIN dream.stage_states review ON (review.owner_id,review.project_id)=(t.owner_id,t.project_id)
      AND review.stage='review' AND review.status='approved' AND review.approved_revision=$3
    WHERE t.owner_id=$1 AND t.project_id=$2 AND t.content_revision=$3 AND t.id=$4`,
  [...key, basis.revision, basis.timelineId, project.approved_plan_id]);
  return timeline && { timelineSha256: timeline.timeline_sha256, planId: project.approved_plan_id };
}

async function listExports(client: Client, key: Key) {
  const project = await readProject(client, key);
  if (!project) return fail("PROJECT_MISSING", 404);
  const revision = Number(project.content_revision), timelineId = project.current_timeline_rev_id;
  const canCreate = !!timelineId && !!await approvedTimeline(client, key, project, { revision, timelineId });
  const { rows } = canCreate ? await client.query<Row>(bundleRows +
    " AND c.content_revision=$3 AND c.timeline_id=$4 ORDER BY e.created_at DESC", [...key, revision, timelineId]) : { rows: [] };
  return response({ result: { contentRevision: revision, timelineId, canCreate, rows: rows.map(row => receipt(key[1], row)) } });
}

async function claimBundle(client: Client, key: Key, basis: Basis, requestId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["local-editing-bundle:" + key[0]]);
  const project = await readProject(client, key, true);
  if (!project) return fail("PROJECT_MISSING", 404);
  if (!matches(project, basis)) return conflict("CURRENT_TIMELINE_CONFLICT");
  const approved = await approvedTimeline(client, key, project, basis);
  if (!approved) return conflict("EXPORT_REVIEW_REQUIRED");
  const { rows: [bound] } = await client.query<{ project_id: string; export_id: string; timeline_id: string; content_revision: string }>(
    `SELECT c.project_id,c.export_id,c.timeline_id,c.content_revision FROM local_editing_bundle.keys k
      JOIN local_editing_bundle.claims c ON (c.owner_id,c.export_id)=(k.owner_id,k.export_id)
      WHERE k.owner_id=$1 AND k.request_id=$2`, [key[0], requestId]);
  if (bound && (bound.project_id !== key[1] || bound.timeline_id !== basis.timelineId || Number(bound.content_revision) !== basis.revision))
    return conflict("REQUEST_CONFLICT");
  const { rows: [previous] } = await client.query<Row>(bundleRows +
    " AND c.content_revision=$3 AND c.timeline_id=$4 FOR UPDATE OF c", [...key, basis.revision, basis.timelineId]);
  if (previous && (previous.plan_id !== approved.planId || previous.timeline_sha256 !== approved.timelineSha256))
    return conflict("CURRENT_TIMELINE_CONFLICT");
  const id = previous?.export_id ?? v7(), attemptId = v7();
  if (previous?.status === "succeeded" || previous?.active) {
    if (!bound) await client.query("INSERT INTO local_editing_bundle.keys(owner_id,request_id,export_id) VALUES($1,$2,$3)", [key[0], requestId, id]);
    return previous.status === "succeeded" ? response({ result: receipt(key[1], previous) }) : conflict("EXPORT_IN_PROGRESS");
  }
  if (previous) {
    await client.query(`UPDATE local_editing_bundle.claims SET attempt_id=$3,lease_until=clock_timestamp()+interval '10 minutes'
      WHERE owner_id=$1 AND export_id=$2`, [key[0], id, attemptId]);
    await client.query("UPDATE dream.exports SET status='running',error=NULL WHERE owner_id=$1 AND id=$2", [key[0], id]);
  } else {
    await client.query(`INSERT INTO dream.exports(owner_id,project_id,id,content_revision,status,created_at)
      VALUES($1,$2,$3,$4,'running',clock_timestamp())`, [...key, id, basis.revision]);
    await client.query(`INSERT INTO local_editing_bundle.claims
      (owner_id,project_id,export_id,content_revision,timeline_id,plan_id,timeline_sha256,attempt_id,lease_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '10 minutes')`,
    [...key, id, basis.revision, basis.timelineId, approved.planId, approved.timelineSha256, attemptId]);
  }
  if (!bound) await client.query("INSERT INTO local_editing_bundle.keys(owner_id,request_id,export_id) VALUES($1,$2,$3)", [key[0], requestId, id]);
  return response({ claim: { id, attemptId, ...approved } satisfies Claim });
}

async function download(client: Client, key: Key, id: string) {
  const project = await readProject(client, key);
  if (!project) return fail("PROJECT_MISSING", 404);
  const { rows: [row] } = await client.query<Row>(bundleRows + " AND c.export_id=$3", [...key, id]);
  if (!row || row.status !== "succeeded") return fail("EXPORT_MISSING", 404);
  const basis = { revision: Number(row.content_revision), timelineId: row.timeline_id };
  if (!matches(project, basis)) return conflict("CURRENT_TIMELINE_CONFLICT");
  const approved = await approvedTimeline(client, key, project, basis);
  if (!approved) return conflict("EXPORT_REVIEW_REQUIRED");
  if (approved.planId !== row.plan_id || approved.timelineSha256 !== row.timeline_sha256)
    return conflict("CURRENT_TIMELINE_CONFLICT");
  const { rows: [output] } = await client.query<{ content: Buffer; sha256: string; size_bytes: number }>(
    "SELECT content,sha256,size_bytes FROM local_editing_bundle.outputs WHERE owner_id=$1 AND export_id=$2", [key[0], id]);
  if (!output || output.content.length !== row.size_bytes || output.sha256 !== row.sha256 ||
      pgBundleSha256(output.content) !== row.sha256)
    return fail("EXPORT_UNAVAILABLE", 503);
  return new Response(Uint8Array.from(output.content), { headers: {
    ...headers, "Content-Type": "application/zip", "Content-Length": String(output.size_bytes),
    "Content-Disposition": `attachment; filename="editing-${id}.zip"`, "X-Content-Type-Options": "nosniff",
  } });
}

const conflictCodes = new Set([
  "CURRENT_TIMELINE_CONFLICT", "EXPORT_REVIEW_REQUIRED", "EXPORT_TIMELINE_INVALID",
  "EXPORT_ASSET_UNAVAILABLE", "EXPORT_ASSET_CHANGED", "EXPORT_SNAPSHOT_CHANGED",
]);

export async function localEditingExport(request: Request, params: Promise<{ id: string; exportId?: string }>) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const route = await params;
  if (!projectIdSchema.safeParse(route.id).success) return fail("PROJECT_MISSING", 404);
  const key: Key = [access.owner, route.id];
  const transaction = (write: boolean, operation: (client: Client) => Promise<Response>) =>
    localWavTransaction(access, "local_editing_bundle_export", write, operation);
  if (request.method === "GET") {
    if (route.exportId === undefined) return transaction(false, client => listExports(client, key));
    const id = projectIdSchema.safeParse(route.exportId);
    return id.success ? transaction(false, client => download(client, key, id.data)) : fail("EXPORT_MISSING", 404);
  }

  const requestId = projectIdSchema.safeParse(request.headers.get("idempotency-key"));
  const input = basisSchema.safeParse(await request.json().catch(() => null));
  if (!requestId.success || !input.success) return fail("INVALID_REQUEST", 400);
  const basis = input.data;
  const claimed = await transaction(true, client => claimBundle(client, key, basis, requestId.data));
  if (!claimed.ok) return claimed;
  const { claim } = await claimed.clone().json() as { claim?: Claim };
  if (!claim) return claimed;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(9 * 60 * 1000)]);
  let result: Response;
  try {
    result = await withLocalPgEditingBundle({ ...access, storageOrigin: process.env.DREAM_OWNED_CREATE_STORAGE_ORIGIN ?? "" },
      actorFromVerifiedUserId(key[0]), { projectId: key[1], ...basis }, async artifact => {
        if (artifact.timelineSha256 !== claim.timelineSha256 || artifact.manifest.planId !== claim.planId)
          return conflict("CURRENT_TIMELINE_CONFLICT");
        const bytes = await readFile(artifact.filename, { signal });
        if (bytes.length !== artifact.sizeBytes || pgBundleSha256(bytes) !== artifact.sha256)
          return fail("EXPORT_ASSET_CHANGED", 409);
        return transaction(true, async client => {
          const project = await readProject(client, key, true);
          if (!project || !matches(project, basis)) return conflict("CURRENT_TIMELINE_CONFLICT");
          const approved = await approvedTimeline(client, key, project, basis);
          if (!approved) return conflict("EXPORT_REVIEW_REQUIRED");
          if (approved.planId !== claim.planId || approved.timelineSha256 !== claim.timelineSha256)
            return conflict("CURRENT_TIMELINE_CONFLICT");
          const lease = await client.query(`UPDATE local_editing_bundle.claims SET lease_until=NULL
            WHERE owner_id=$1 AND export_id=$2 AND attempt_id=$3 AND lease_until>clock_timestamp()
            RETURNING export_id`, [key[0], claim.id, claim.attemptId]);
          if (!lease.rowCount) return conflict("EXPORT_CLAIM_LOST");
          signal.throwIfAborted();
          const { rows: [stored] } = await client.query<{ sha256: string; size_bytes: number }>(
            `INSERT INTO local_editing_bundle.outputs(owner_id,export_id,content) VALUES($1,$2,$3)
            RETURNING sha256,size_bytes`, [key[0], claim.id, bytes]);
          if (stored.sha256 !== artifact.sha256 || stored.size_bytes !== artifact.sizeBytes)
            throw new Error("Editing archive hash changed on insert");
          const filePath = key.join("/") + "/" + claim.id + ".zip";
          const record = await client.query(`UPDATE dream.exports SET status='succeeded',file_path=$3,manifest_version=$4,
            manifest_json=$5,sha256=$6,completed_at=clock_timestamp(),error=NULL
            WHERE owner_id=$1 AND id=$2 AND status='running'`,
          [key[0], claim.id, filePath, artifact.manifest.manifestVersion, JSON.stringify(artifact.manifest), artifact.sha256]);
          const stage = await client.query(`UPDATE dream.stage_states SET status='approved',approved_revision=$3,
            approved_at=clock_timestamp(),approved_plan_id=NULL WHERE owner_id=$1 AND project_id=$2
            AND stage='export' AND status IN ('todo','in_progress')`, [...key, basis.revision]);
          if (record.rowCount !== 1 || stage.rowCount !== 1) throw new Error("Editing archive state changed on insert");
          await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
            VALUES($1,$2,$3,'local-user','export.succeeded',$4,clock_timestamp())`, [...key, v7(),
            JSON.stringify({ exportId: claim.id, contentRevision: basis.revision, timelineId: basis.timelineId, sha256: artifact.sha256 })]);
          signal.throwIfAborted();
          return response({ result: receipt(key[1], { export_id: claim.id, content_revision: String(basis.revision),
            timeline_id: basis.timelineId, plan_id: claim.planId, timeline_sha256: claim.timelineSha256,
            active: false, status: "succeeded", ...stored }) }, 201);
        });
      }, signal);
  } catch (error) {
    const code = error instanceof PgEditingBundleError ? error.code : signal.aborted ? "EXPORT_CANCELED" : "EXPORT_UNAVAILABLE";
    result = fail(code, conflictCodes.has(code) ? 409 : code === "PROJECT_MISSING" ? 404 : 503);
  }
  if (result.ok) return result;
  const { code } = await result.clone().json() as { code: string };
  const settled = await transaction(true, async client => {
    const lease = await client.query(`UPDATE local_editing_bundle.claims SET lease_until=NULL
      WHERE owner_id=$1 AND export_id=$2 AND attempt_id=$3 AND lease_until IS NOT NULL RETURNING export_id`,
    [key[0], claim.id, claim.attemptId]);
    if (lease.rowCount) await client.query("UPDATE dream.exports SET status='failed',error=$3 WHERE owner_id=$1 AND id=$2 AND status='running'",
      [key[0], claim.id, code]);
    return new Response(null, { status: 204 });
  });
  return settled.ok ? result : settled;
}
