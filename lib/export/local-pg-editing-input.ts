import "server-only";

import { createHash } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";
import { reviewItems } from "@/lib/domain/review";
import { canonicalJson, timelineSchema } from "@/lib/edit/timeline";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";

export const bundleBasis = z.strictObject({
  projectId: z.uuidv7(), revision: z.number().int().positive().safe(), timelineId: z.uuidv7(),
});
export type PgEditingBundleBasis = z.infer<typeof bundleBasis>;
export type PgEditingBundleConnection = { port: number; password: string; storageOrigin: string };

export class PgEditingBundleError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const ownedScene = z.object({ id: z.uuidv7() });
const registration = z.object({
  source: z.literal("verified-png"), assetId: z.uuidv7(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), rightsNote: z.string().nullable(),
});
const object = z.record(z.string(), z.unknown());
type Project = {
  title: string; aspect: string; length_sec: string; approved_plan_id: string | null;
  content_revision: string; current_timeline_rev_id: string | null;
  inputs_json: string; template_snapshot_json: string; template_version: string;
};
type Png = {
  scene_id: string; version_id: string; version: string; name: string; title: string;
  width: string; height: string; asset_id: string; sha256: string; size_bytes: string;
  object_key: string; receipt_id: string; rights_note: string | null; input_snapshot_json: string;
};
type Wav = {
  id: string; title: string; rights_note: string | null; sha256: string;
  size_bytes: string; duration_ms: string; bytes: Buffer | null;
};

export const pgBundleSha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export async function readPgEditingSnapshot(
  connection: PgEditingBundleConnection, actor: VerifiedActor, basis: PgEditingBundleBasis,
) {
  if (!isVerifiedActor(actor)) throw new PgEditingBundleError("EXPORT_INPUT_INVALID");
  const client = new Client({ host: "127.0.0.1", database: "dream_test_t367", user: "local_editing_bundle_read_login",
    port: connection.port, password: connection.password, ssl: false, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='8s'");
    const { rows: [target] } = await client.query<{ ok: boolean }>(`SELECT
      inet_server_addr()='127.0.0.1'::inet AND current_database()='dream_test_t367'
      AND current_setting('server_version_num')::int/10000=17
      AND session_user='local_editing_bundle_read_login'
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit)
      AND (SELECT array_agg(p.rolname::text) FROM pg_roles p WHERE p.oid<>r.oid AND pg_has_role(r.oid,p.oid,'MEMBER'))
        = ARRAY['local_editing_bundle_read']::text[] AS ok FROM pg_roles r WHERE r.rolname=session_user`);
    if (!target?.ok) throw new PgEditingBundleError("EXPORT_READ_UNAVAILABLE");
    await client.query("SET LOCAL ROLE local_editing_bundle_read");
    await client.query("SELECT set_config('dream.actor_id',$1,true)", [actor.id]);
    const key = [actor.id, basis.projectId];
    const { rows: [project] } = await client.query<Project>(`SELECT title,aspect,length_sec,approved_plan_id,content_revision,
      current_timeline_rev_id,inputs_json,template_snapshot_json,template_version FROM dream.projects
      WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL`, key);
    if (!project) throw new PgEditingBundleError("PROJECT_MISSING");
    if (Number(project.content_revision) !== basis.revision || project.current_timeline_rev_id !== basis.timelineId)
      throw new PgEditingBundleError("CURRENT_TIMELINE_CONFLICT");
    const { rows: stages } = await client.query<{ stage: string; approved_revision: string | null; approved_plan_id: string | null }>(
      `SELECT stage,approved_revision,approved_plan_id FROM dream.stage_states
      WHERE owner_id=$1 AND project_id=$2 AND status='approved' AND stage IN ('plan','produce','edit','review')`, key);
    const requiredStages = new Map(stages.map(row => [row.stage, row]));
    if (!project.approved_plan_id || ["plan", "produce"].some(stage => requiredStages.get(stage)?.approved_plan_id !== project.approved_plan_id) ||
        ["edit", "review"].some(stage => Number(requiredStages.get(stage)?.approved_revision) !== basis.revision))
      throw new PgEditingBundleError("EXPORT_REVIEW_REQUIRED");
    const { rows: [plan] } = await client.query<{
      id: string; version: string; script: string; steps_json: string; approved_scene_snapshot_json: string;
    }>(`SELECT id,version,script,steps_json,approved_scene_snapshot_json FROM dream.plans
      WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND status='approved'`, [...key, project.approved_plan_id]);
    if (!plan) throw new PgEditingBundleError("EXPORT_REVIEW_REQUIRED");
    const { rows: [stored] } = await client.query<{
      revision: string; timeline_json: string; timeline_sha256: string; created_at: Date;
    }>(`SELECT revision,timeline_json,timeline_sha256,created_at FROM dream.timeline_revisions
      WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND content_revision=$4`, [...key, basis.timelineId, basis.revision]);
    if (!stored || pgBundleSha256(stored.timeline_json) !== stored.timeline_sha256)
      throw new PgEditingBundleError("EXPORT_TIMELINE_INVALID");
    const parsed = timelineSchema.safeParse(JSON.parse(stored.timeline_json));
    if (!parsed.success || canonicalJson(parsed.data) !== stored.timeline_json || parsed.data.aspect !== project.aspect ||
        (parsed.data.schemaVersion === 1 && parsed.data.audio.length > 0))
      throw new PgEditingBundleError("EXPORT_TIMELINE_INVALID");
    const timeline = parsed.data;
    const planScenes = z.array(ownedScene).min(1).parse(JSON.parse(plan.approved_scene_snapshot_json));
    const planIds = new Set(planScenes.map(scene => scene.id));
    if (timeline.video.length !== planScenes.length || planIds.size !== planScenes.length ||
        new Set(timeline.video.map(clip => clip.sceneId)).size !== planIds.size ||
        timeline.video.some(clip => !planIds.has(clip.sceneId)))
      throw new PgEditingBundleError("EXPORT_TIMELINE_INVALID");

    const { rows: pngRows } = await client.query<Png>(`SELECT s.id AS scene_id,s.title AS name,v.id AS version_id,v.version,
      a.id AS asset_id,a.title,a.rights_note,r.width,r.height,o.sha256,o.size_bytes,o.object_key,r.id AS receipt_id,v.input_snapshot_json
      FROM dream.scenes s JOIN dream.scene_versions v ON (v.owner_id,v.scene_id,v.id)=(s.owner_id,s.id,s.selected_version_id)
      JOIN dream.assets a ON (a.owner_id,a.id)=(v.owner_id,v.result_asset_id)
      JOIN dream.asset_receipt_state ar ON (ar.owner_id,ar.asset_id)=(a.owner_id,a.id)
      JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(ar.owner_id,ar.object_id,ar.asset_id)
      JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
        =(ar.owner_id,ar.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
      JOIN dream.storage_verification_operations op ON (op.owner_id,op.id,op.object_id,op.generation,op.terminal_receipt_id)
        =(r.owner_id,r.operation_id,r.object_id,r.generation,r.id)
      JOIN dream.storage_policies policy ON (policy.policy_id,policy.epoch,policy.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
      WHERE s.owner_id=$1 AND s.project_id=$2 AND s.archived_at IS NULL AND s.needs_recheck=0
        AND v.plan_id=$3 AND v.kind='image' AND v.status='succeeded'
        AND a.kind='image' AND a.mime='image/png' AND a.archived_at IS NULL AND a.is_mock=0
        AND ar.status='ready' AND o.lifecycle='registered' AND o.bucket='t367-private' AND op.status='succeeded'
        AND policy.policy_id='t367-local-png' AND r.verified_at<=statement_timestamp() AND r.not_after>statement_timestamp()
        AND (a.kind,a.mime,a.file_path,a.size_bytes,a.sha256,a.width,a.height)=(o.kind,o.mime,o.object_key,o.size_bytes,o.sha256,r.width,r.height)
        AND EXISTS (SELECT FROM dream.project_assets l WHERE (l.owner_id,l.project_id,l.asset_id)=(s.owner_id,s.project_id,a.id)
          AND l.purpose IN ('productAssets','productionImage'))`, [...key, plan.id]);
    const byScene = new Map(pngRows.map(row => [row.scene_id, row]));
    if (pngRows.length !== timeline.video.length) throw new PgEditingBundleError("EXPORT_ASSET_UNAVAILABLE");
    const scenes = timeline.video.map(clip => {
      const row = byScene.get(clip.sceneId);
      if (!row || row.version_id !== clip.sceneVersionId || row.asset_id !== clip.assetId)
        throw new PgEditingBundleError("EXPORT_ASSET_UNAVAILABLE");
      const saved = registration.safeParse(JSON.parse(row.input_snapshot_json));
      if (!saved.success || saved.data.assetId !== row.asset_id || saved.data.sha256 !== row.sha256)
        throw new PgEditingBundleError("EXPORT_ASSET_UNAVAILABLE");
      return {
        id: row.scene_id, name: row.name, versionId: row.version_id, version: Number(row.version), title: row.title,
        width: Number(row.width), height: Number(row.height), receiptId: row.receipt_id,
        currentRights: row.rights_note, registeredRights: saved.data.rightsNote,
        source: { ownerId: actor.id, id: row.asset_id, kind: "image" as const, mime: "image/png" as const,
          objectKey: row.object_key, sha256: row.sha256, sizeBytes: Number(row.size_bytes) },
      };
    });

    const audioIds = timeline.schemaVersion === 2 ? [...new Set(timeline.audio.map(clip => clip.assetId))].sort() : [];
    const { rows: wavRows } = audioIds.length ? await client.query<Wav>(`SELECT a.id,a.title,a.rights_note,a.sha256,a.size_bytes,
      a.duration_ms,f.content AS bytes
      FROM dream.assets a JOIN local_wav.files f ON (f.owner_id,f.asset_id)=(a.owner_id,a.id)
      JOIN dream.project_assets l ON (l.owner_id,l.asset_id)=(a.owner_id,a.id)
      WHERE a.owner_id=$1 AND l.project_id=$2 AND a.id=ANY($3::uuid[]) AND l.purpose='productionAudio'
        AND a.archived_at IS NULL AND a.is_mock=0 AND a.kind='audio' AND a.mime='audio/wav'
        AND (a.sha256,a.size_bytes,a.duration_ms)=(f.digest,f.size_bytes,f.duration_ms)
        AND a.file_path=a.owner_id::text||'/assets/'||a.id::text||'/'||f.digest||'.wav'
      ORDER BY a.id`, [...key, audioIds]) : { rows: [] };
    if (audioIds.length !== wavRows.length) throw new PgEditingBundleError("EXPORT_ASSET_UNAVAILABLE");
    const audio = wavRows.map(row => ({
      id: row.id, title: row.title, rightsNote: row.rights_note, sha256: row.sha256,
      sizeBytes: Number(row.size_bytes), durationMs: Number(row.duration_ms),
    }));

    const inputs = object.parse(JSON.parse(project.inputs_json));
    const menu = menuSnapshotSchema.parse(JSON.parse(project.template_snapshot_json));
    const expectedItems = reviewItems(menu, inputs, timeline);
    const { rows: decisions } = await client.query<{ template_item_id: string; status: string; note: string | null; required: string }>(
      `SELECT template_item_id,status,note,required FROM dream.review_items
      WHERE owner_id=$1 AND project_id=$2 AND content_revision=$3`, [...key, basis.revision]);
    const byItem = new Map(decisions.map(item => [item.template_item_id, item]));
    const reviews = expectedItems.map(item => {
      const decision = byItem.get(item.id);
      if (item.required && (decision?.status !== "pass" || Number(decision.required) !== 1))
        throw new PgEditingBundleError("EXPORT_REVIEW_REQUIRED");
      return { label: item.label, required: item.required, status: decision?.status ?? "unchecked", note: decision?.note ?? null };
    });
    await client.query("COMMIT");
    return {
      metadata: {
        project: { id: basis.projectId, title: project.title, aspect: timeline.aspect, lengthSec: Number(project.length_sec) },
        plan: { id: plan.id, version: Number(plan.version), script: plan.script, steps: JSON.parse(plan.steps_json) as unknown },
        menu: { id: menu.menu.id, label: menu.menu.label }, templateVersion: project.template_version,
        timeline, timelineJson: stored.timeline_json, timelineSha256: stored.timeline_sha256, timelineRevision: Number(stored.revision),
        timelineCreatedAt: stored.created_at.toISOString(), scenes, audio, reviews,
        usageRights: typeof inputs.usageRights === "string" ? inputs.usageRights : null,
      },
      wavBytes: new Map(wavRows.map(row => [row.id, row.bytes])),
    };
  } catch (error) {
    if (error instanceof PgEditingBundleError) throw error;
    throw new PgEditingBundleError("EXPORT_READ_UNAVAILABLE");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export type PgEditingSnapshot = Awaited<ReturnType<typeof readPgEditingSnapshot>>["metadata"];
