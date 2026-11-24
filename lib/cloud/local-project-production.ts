import "server-only";
import type { Client } from "pg";
import { v7 } from "uuid";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { rejectCrossSite } from "@/lib/auth/config";
import { localProjectFormEnabled } from "./local-project-form-enabled";
import { localWavTransaction, openLocalWavAccess } from "./local-wav-access";
import { readBoundedUpload } from "./read-bounded-upload";

export type ProductionResult = { id: string; version: number; assetId: string; title: string };
export type ProductionScene = {
  id: string; position: number; title: string; description: string; durationSec: number;
  readiness: "waiting" | "selected" | "recheck";
  selectedVersionId: string | null;
  results: ProductionResult[];
};
export type LocalProduction = {
  planVersion: number; planId: string; revision: number; canRegister: boolean; canSelect: boolean;
  canApprove: boolean; productionApproved: boolean; editOpen: boolean;
  sources: { id: string; title: string }[]; scenes: ProductionScene[];
};
export type SceneSelection = { sceneId: string; selectedVersionId: string; revision: number; canApprove: boolean };
type SceneRow = {
  id: string; position: string; title: string; description: string; duration_sec: string;
  needs_recheck: boolean; selected_version_id: string | null; selected: boolean;
  selected_png_asset: string | null;
};

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const notFound = () => reply({ error: "제작 장면 또는 원본을 찾을 수 없어요." }, 404);
const conflict = () => reply({ error: "기획 상태가 바뀌었어요. 장면 목록을 다시 확인해 주세요." }, 409);
const registerPngSchema = z.strictObject({
  action: z.literal("register-png"), sceneId: z.uuidv7(), assetId: z.uuidv7(), planId: z.uuidv7(),
  revision: z.number().int().nonnegative(),
});
const attachPngSchema = registerPngSchema.omit({ sceneId: true }).extend({ action: z.literal("attach-png") });
const selectSchema = z.strictObject({
  action: z.literal("select"), sceneId: z.uuidv7(), versionId: z.uuidv7(), planId: z.uuidv7(),
  revision: registerPngSchema.shape.revision, expectedVersionId: z.uuidv7().nullable(),
});
const approveSchema = z.strictObject({
  action: z.literal("approve-production"), planId: z.uuidv7(),
  revision: registerPngSchema.shape.revision, acknowledged: z.literal(true),
});
const commandSchema = z.discriminatedUnion("action", [attachPngSchema, registerPngSchema, selectSchema, approveSchema]);
type ProductionCommand = z.infer<typeof commandSchema>;
const requiredScenesSchema = z.array(z.object({ id: z.uuidv7() })).min(1).max(100);

async function approvedProduction(client: Client, keys: [string, string]) {
  const { rows: [approved] } = await client.query<{
    id: string; version: string; content_revision: string; can_register: boolean; can_select: boolean;
    approved_scene_snapshot_json: string; production_status: string; edit_status: string | null;
  }>(`SELECT p.id,p.version,project.content_revision,producing.status IN ('todo','in_progress') AS can_register,
      producing.status IN ('todo','in_progress') AND project.current_timeline_rev_id IS NULL AS can_select,
      p.approved_scene_snapshot_json,producing.status AS production_status,editing.status AS edit_status
    FROM dream.projects project
    JOIN dream.plans p ON p.owner_id=project.owner_id AND p.project_id=project.id
      AND p.id=project.approved_plan_id AND p.status='approved'
    JOIN dream.stage_states planning ON planning.owner_id=project.owner_id AND planning.project_id=project.id
      AND planning.stage='plan' AND planning.status='approved' AND planning.approved_plan_id=p.id
    JOIN dream.stage_states producing ON producing.owner_id=project.owner_id AND producing.project_id=project.id
      AND producing.stage='produce' AND producing.status<>'locked'
    LEFT JOIN dream.stage_states editing ON (editing.owner_id,editing.project_id)=(project.owner_id,project.id)
      AND editing.stage='edit'
    WHERE project.owner_id=$1 AND project.id=$2 AND project.menu_id='shopping-shorts' AND project.archived_at IS NULL`, keys);
  return approved;
}

// These are project-linked candidates. Registration checks the current
// verification receipt and identity again while holding their share locks.
const pngSources = `FROM dream.project_assets link
  JOIN dream.assets a ON (a.owner_id,a.id)=(link.owner_id,link.asset_id)
  JOIN dream.asset_receipt_state receipt ON (receipt.owner_id,receipt.asset_id)=(a.owner_id,a.id)
  WHERE link.owner_id=$1 AND link.project_id=$2 AND link.purpose IN ('productAssets','productionImage')
    AND a.kind='image' AND a.mime='image/png' AND a.archived_at IS NULL AND receipt.status='ready'`;

async function readScenes(client: Client, keys: [string, string], planId: string, lock = false) {
  const { rows } = await client.query<SceneRow>(`SELECT s.id,s.position,s.title,s.description,s.duration_sec,
      s.needs_recheck<>0 AS needs_recheck,s.selected_version_id,v.id IS NOT NULL AS selected,
      CASE WHEN v.plan_id=$3 AND v.kind='image' THEN v.result_asset_id END AS selected_png_asset
    FROM dream.scenes s LEFT JOIN dream.scene_versions v ON v.owner_id=s.owner_id
      AND v.scene_id=s.id AND v.id=s.selected_version_id AND v.status='succeeded'
    WHERE s.owner_id=$1 AND s.project_id=$2 AND s.archived_at IS NULL ORDER BY s.position,s.id`
    + (lock ? " FOR SHARE OF s" : ""), [...keys, planId]);
  return rows;
}

function approvalAssets(snapshot: string, scenes: SceneRow[], sources: { id: string }[]) {
  const required = requiredScenesSchema.safeParse(JSON.parse(snapshot));
  if (!required.success || required.data.length !== scenes.length) return null;
  const requiredIds = new Set(required.data.map(scene => scene.id));
  const sourceIds = new Set(sources.map(source => source.id));
  const assets = new Set<string>();
  for (const scene of scenes) {
    if (!requiredIds.delete(scene.id) || scene.needs_recheck ||
        !scene.selected_png_asset || !sourceIds.has(scene.selected_png_asset)) return null;
    assets.add(scene.selected_png_asset);
  }
  return [...assets].sort();
}

export async function localProduction(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) {
    return await requireApiAuth() ?? reply({ error: "제작 장면을 불러올 수 없어요." }, 503);
  }
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  if (!z.uuidv7().safeParse(id).success) return notFound();

  let command: ProductionCommand | undefined;
  if (request.method === "POST") {
    const denied = rejectCrossSite(request, { json: true });
    if (denied) return denied;
    const body = await readBoundedUpload(request, 4096).catch(() => undefined);
    try { command = commandSchema.safeParse(JSON.parse(body?.toString("utf8") ?? "")).data; }
    catch { /* Malformed JSON receives the same response as invalid input. */ }
    if (!command) return reply({ error: "장면과 결과를 확인해 주세요." }, 400);
  }
  const keys: [string, string] = [access.owner, id];
  if (command) return localWavTransaction(access, "local_project_brief", true, client => changeProduction(client, keys, command));

  return localWavTransaction(access, "local_project_brief", false, async client => {
    const approved = await approvedProduction(client, keys);
    if (!approved) return notFound();

    const rows = await readScenes(client, keys, approved.id);
    const { rows: versions } = await client.query<{
      id: string; scene_id: string; version: string; asset_id: string; title: string;
    }>(`SELECT v.id,v.scene_id,v.version,a.id AS asset_id,a.title
      FROM dream.scenes s JOIN dream.scene_versions v ON (v.owner_id,v.scene_id)=(s.owner_id,s.id)
        AND v.plan_id=$3 AND v.status='succeeded' AND v.kind='image'
      JOIN dream.assets a ON (a.owner_id,a.id)=(v.owner_id,v.result_asset_id) AND a.mime='image/png'
      WHERE s.owner_id=$1 AND s.project_id=$2 AND s.archived_at IS NULL
      ORDER BY v.scene_id,v.version DESC`, [...keys, approved.id]);
    const results = new Map<string, ProductionResult[]>();
    for (const row of versions) {
      const result = { id: row.id, version: Number(row.version), assetId: row.asset_id, title: row.title };
      const previous = results.get(row.scene_id) ?? [];
      previous.push(result);
      results.set(row.scene_id, previous);
    }
    const { rows: sources } = await client.query<{ id: string; title: string }>(
      `SELECT a.id,a.title ${pngSources} ORDER BY (link.purpose='productAssets') DESC,a.title,a.id`, keys);
    const scenes = rows.map<ProductionScene>(row => ({
      id: row.id, position: Number(row.position), title: row.title, description: row.description,
      durationSec: Number(row.duration_sec),
      readiness: row.needs_recheck || (row.selected_version_id && !row.selected) ? "recheck" :
        row.selected ? "selected" : "waiting",
      selectedVersionId: row.selected_version_id,
      results: results.get(row.id) ?? [],
    }));
    return reply({
      planVersion: Number(approved.version), planId: approved.id, revision: Number(approved.content_revision),
      canRegister: approved.can_register, canSelect: approved.can_select, scenes, sources,
      canApprove: approved.can_select && approved.edit_status === "locked" &&
        Boolean(approvalAssets(approved.approved_scene_snapshot_json, rows, sources)),
      productionApproved: approved.production_status === "approved",
      editOpen: approved.production_status === "approved" && Boolean(approved.edit_status && approved.edit_status !== "locked"),
    } satisfies LocalProduction);
  });
}

async function changeProduction(client: Client, keys: [string, string], command: ProductionCommand) {
  // Serialize with plan approval and other project writes before reading the expected basis.
  const locked = await client.query(`SELECT id FROM dream.projects
    WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL FOR UPDATE`, keys);
  if (!locked.rowCount) return notFound();
  const approved = await approvedProduction(client, keys);
  if (!approved || !(command.action === "register-png" ? approved.can_register : approved.can_select) ||
      approved.id !== command.planId || Number(approved.content_revision) !== command.revision) {
    return conflict();
  }
  if (command.action === "approve-production") {
    if (approved.edit_status !== "locked") return conflict();
    return approveProduction(client, keys, command, approved.approved_scene_snapshot_json);
  }
  if (command.action === "attach-png") return attachPng(client, keys, command.assetId);
  const { rows: [scene] } = await client.query<{ selected_version_id: string | null; needs_recheck: boolean }>(`
    SELECT selected_version_id,needs_recheck<>0 AS needs_recheck FROM dream.scenes
    WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL FOR SHARE`, [...keys, command.sceneId]);
  if (!scene) return notFound();
  if (command.action === "select") {
    if (scene.selected_version_id !== command.expectedVersionId) return conflict();
    return selectResult(client, keys, command, scene.needs_recheck,
      approved.edit_status === "locked" ? approved.approved_scene_snapshot_json : null);
  }
  return registerPng(client, keys, command);
}

async function attachPng(client: Client, keys: [string, string], assetId: string) {
  const { rows: [asset] } = await client.query<{ id: string; title: string; sha256: string }>(`
    SELECT id,title,sha256 FROM dream.assets WHERE owner_id=$1 AND id=$2
      AND kind='image' AND mime='image/png' AND archived_at IS NULL`, [keys[0], assetId]);
  if (!asset) return notFound();
  const { rows: [verified] } = await client.query<{ ok: boolean }>(
    "SELECT private_image_create_v1.verified_scene_png($1) AS ok", [assetId]);
  if (!verified?.ok) return reply({ error: "PNG 원본의 검증 상태를 확인해 주세요." }, 409);

  const { rows: [linked] } = await client.query<{ id: string; title: string }>(`SELECT a.id,a.title
    FROM dream.project_assets link JOIN dream.assets a ON (a.owner_id,a.id)=(link.owner_id,link.asset_id)
    WHERE link.owner_id=$1 AND link.project_id=$2 AND link.purpose IN ('productAssets','productionImage')
      AND (a.id=$3 OR (a.sha256=$4 AND a.archived_at IS NULL))
    ORDER BY (a.id=$3) DESC LIMIT 1`, [...keys, assetId, asset.sha256]);
  if (linked) {
    if (linked.id !== assetId) return reply({ error: "같은 이미지가 이미 프로젝트에 연결되어 있어요." }, 409);
    return reply(linked);
  }

  await client.query(`INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose)
    VALUES($1,$2,$3,'productionImage')`, [...keys, assetId]);
  await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
    VALUES($1,$2,$3,'local-user','production.png_attached',$4,clock_timestamp())`,
  [...keys, v7(), JSON.stringify({ assetId })]);
  return reply({ id: asset.id, title: asset.title }, 201);
}

async function approveProduction(client: Client, keys: [string, string], command: z.infer<typeof approveSchema>, snapshot: string) {
  const scenes = await readScenes(client, keys, command.planId, true);
  const { rows: sources } = await client.query<{ id: string }>(`SELECT a.id ${pngSources}`, keys);
  const assets = approvalAssets(snapshot, scenes, sources);
  const incomplete = () => reply({ code: "SCENE_RESULTS_REQUIRED", error: "모든 장면에서 유효한 결과를 선택하고 확인해 주세요." }, 409);
  if (!assets) return incomplete();
  for (const asset of assets) {
    const { rows: [verified] } = await client.query<{ ok: boolean }>(
      "SELECT private_image_create_v1.verified_scene_png($1) AS ok", [asset]);
    if (!verified?.ok) return incomplete();
  }
  const finished = await client.query(`UPDATE dream.stage_states SET status='approved',approved_plan_id=$3,
    approved_revision=$4,approved_at=transaction_timestamp()
    WHERE owner_id=$1 AND project_id=$2 AND stage='produce' AND status IN ('todo','in_progress')`,
  [...keys, command.planId, command.revision]);
  const opened = await client.query(`UPDATE dream.stage_states SET status='todo'
    WHERE owner_id=$1 AND project_id=$2 AND stage='edit' AND status='locked'`, keys);
  if (finished.rowCount !== 1 || opened.rowCount !== 1) throw new Error("Production approval stage changed");
  await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
    VALUES($1,$2,$3,'local-user','produce.approve',$4,clock_timestamp())`,
  [...keys, v7(), JSON.stringify({ planId: command.planId, contentRevision: command.revision,
    selections: scenes.map(scene => ({ sceneId: scene.id, versionId: scene.selected_version_id })) })]);
  return reply({ productionApproved: true, editOpen: true });
}

async function registerPng(client: Client, keys: [string, string], command: z.infer<typeof registerPngSchema>) {
  const sourceLink = await client.query(`SELECT a.id ${pngSources} AND a.id=$3`, [...keys, command.assetId]);
  if (!sourceLink.rowCount) return notFound();
  const { rows: [verified] } = await client.query<{ ok: boolean }>(
    "SELECT private_image_create_v1.verified_scene_png($1) AS ok", [command.assetId]);
  if (!verified?.ok) return reply({ error: "PNG 원본의 검증 상태를 확인해 주세요." }, 409);
  const { rows: [source] } = await client.query<{ id: string; title: string; sha256: string; rights_note: string | null }>(
    `SELECT a.id,a.title,a.sha256,a.rights_note ${pngSources} AND a.id=$3`, [...keys, command.assetId]);
  if (!source) return notFound();

  const resultKeys = [keys[0], command.sceneId, command.planId, source.id];
  const { rows: [existing] } = await client.query<{ id: string; version: string }>(`SELECT id,version FROM dream.scene_versions
    WHERE owner_id=$1 AND scene_id=$2 AND plan_id=$3 AND result_asset_id=$4 AND kind='image' AND status='succeeded'
    ORDER BY version DESC LIMIT 1`, resultKeys);
  if (existing) return reply({ id: existing.id, version: Number(existing.version), assetId: source.id, title: source.title });

  const { rows: [counter] } = await client.query<{ next: string }>(
    "SELECT COALESCE(MAX(version),0)+1 AS next FROM dream.scene_versions WHERE owner_id=$1 AND scene_id=$2", resultKeys.slice(0, 2));
  const version = Number(counter.next);
  if (!Number.isSafeInteger(version)) return conflict();
  const id = v7();
  const input = JSON.stringify({ schemaVersion: 1, source: "verified-png", assetId: source.id,
    sha256: source.sha256, rightsNote: source.rights_note });
  await client.query(`INSERT INTO dream.scene_versions(owner_id,scene_id,plan_id,result_asset_id,id,version,kind,input_snapshot_json,status,created_at)
    VALUES($1,$2,$3,$4,$5,$6,'image',$7,'succeeded',clock_timestamp())`, [...resultKeys, id, version, input]);
  await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
    VALUES($1,$2,$3,'local-user','scene.result_registered',$4,clock_timestamp())`,
  [...keys, v7(), JSON.stringify({ sceneId: command.sceneId, versionId: id, assetId: source.id, planId: command.planId, version })]);
  return reply({ id, version, assetId: source.id, title: source.title } satisfies ProductionResult, 201);
}

async function selectResult(client: Client, keys: [string, string], command: z.infer<typeof selectSchema>,
  needsRecheck: boolean, snapshot: string | null) {
  const { rows: [result] } = await client.query<{ result_asset_id: string }>(`SELECT result_asset_id FROM dream.scene_versions
    WHERE owner_id=$1 AND scene_id=$2 AND id=$3 AND plan_id=$4 AND status='succeeded' AND kind='image'`,
  [keys[0], command.sceneId, command.versionId, command.planId]);
  if (!result) return notFound();
  const source = await client.query(`SELECT a.id ${pngSources} AND a.id=$3`, [...keys, result.result_asset_id]);
  if (!source.rowCount) return notFound();
  const { rows: [verified] } = await client.query<{ ok: boolean }>(
    "SELECT private_image_create_v1.verified_scene_png($1) AS ok", [result.result_asset_id]);
  if (!verified?.ok) return reply({ error: "PNG 원본의 검증 상태를 확인해 주세요." }, 409);
  const selection = { sceneId: command.sceneId, selectedVersionId: command.versionId, revision: command.revision };
  const readReply = async () => {
    const { rows: sources } = await client.query<{ id: string }>(`SELECT a.id ${pngSources}`, keys);
    const canApprove = Boolean(snapshot && approvalAssets(snapshot, await readScenes(client, keys, command.planId), sources));
    return reply({ ...selection, canApprove } satisfies SceneSelection);
  };
  if (command.expectedVersionId === command.versionId && !needsRecheck) return readReply();
  if (command.revision >= Number.MAX_SAFE_INTEGER) return conflict();

  const updated = await client.query(`UPDATE dream.scenes SET selected_version_id=$4,needs_recheck=0
    WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL
      AND selected_version_id IS NOT DISTINCT FROM $5::uuid`,
  [...keys, command.sceneId, command.versionId, command.expectedVersionId]);
  if (updated.rowCount !== 1) return conflict();
  const project = await client.query(`UPDATE dream.projects SET content_revision=content_revision+1,updated_at=clock_timestamp()
    WHERE owner_id=$1 AND id=$2 AND content_revision=$3 AND approved_plan_id=$4 AND current_timeline_rev_id IS NULL`,
  [...keys, command.revision, command.planId]);
  if (project.rowCount !== 1) throw new Error("Selection revision changed");
  selection.revision++;
  await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
    VALUES($1,$2,$3,'local-user','scene.select',$4,clock_timestamp())`,
  [...keys, v7(), JSON.stringify({ ...selection, previousVersionId: command.expectedVersionId, planId: command.planId })]);
  return readReply();
}
