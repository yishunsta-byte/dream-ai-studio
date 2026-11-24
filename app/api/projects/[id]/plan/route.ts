import { v7 } from "uuid";
import { z } from "zod";
import type { Client } from "pg";
import { authDeniedResponse, requireApiAuth } from "@/lib/auth/api";
import { rejectCrossSite } from "@/lib/auth/config";
import { resolveServerAuth } from "@/lib/auth/resolve";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { localPlanTransaction, openLocalPlanAccess } from "@/lib/cloud/local-plan-access";
import {
  managedPlanApprovalConfiguration, managedPlanApprovalUnavailable, managedPlanConfiguration, managedPlanMaxBytes, managedPlanMenus,
  managedPlanUnavailable,
  openManagedPlanApprovalTransaction, openManagedPlanTransaction,
} from "@/lib/cloud/managed-project-plan";
import { readBoundedUpload } from "@/lib/cloud/read-bounded-upload";
import { planningInputSchema, sceneDraftSchema } from "@/lib/domain/planning-draft";
import { savedShortsPlanMaterials, shortsPlanMaterialsConflict, shortsPlanMaterialsInput } from "@/lib/domain/shorts-plan-materials";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { readLimitedText, rejectForeignWrite } from "@/lib/public-showcase/admin-publication-http";
import { shortsScriptDuration } from "@/lib/reference-analysis/shorts-script-contract";

export const runtime = "nodejs";
const saveSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  draft: planningInputSchema,
});
const importSchema = saveSchema.extend({
  action: z.literal("import-shorts-draft"),
  durationSec: shortsScriptDuration,
  materials: shortsPlanMaterialsInput.optional(),
}).refine(({ draft, durationSec }) => draft.scenes.reduce((total, scene) => total + scene.durationSec, 0) === durationSec,
  { path: ["durationSec"] }).refine(({ draft, materials }) => !materials || materials.scenes.length === draft.scenes.length,
  { path: ["materials", "scenes"] });
const approveSchema = z.strictObject({
  action: z.literal("approve-plan"),
  acknowledged: z.literal(true),
  revision: saveSchema.shape.revision,
  version: z.number().int().positive(),
  planId: z.uuidv7(),
});
const commandSchema = z.union([saveSchema, importSchema, approveSchema]);
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
const conflict = () => reply({ error: "현재 기획 상태가 바뀌었어요. 저장된 초안을 확인해 주세요." }, 409);
const materialsUnavailable = () => reply({ code: "PLAN_MATERIALS_UNAVAILABLE", error: "기획 부가 자료 저장소를 확인해 주세요." }, 503);
const tooLarge = () => reply({ error: "초안이 너무 길어요." }, 413);
const approvalUnavailable = () => reply({ code: "PLAN_APPROVAL_UNAVAILABLE", error: "현재 환경에서는 기획을 승인할 수 없어요." }, 409);
const approvalResult = (planId: string, version: number, managed: boolean) => reply({
  planId, version, approved: true, produceOpen: true, ...(managed && { hostedProductionAvailable: false }),
});

type PlanClient = Pick<Client, "query">;
type PlanAccess = { owner: string; managed: boolean;
  transact: (write: boolean, action: (client: PlanClient) => Promise<Response>) => Promise<Response> };

async function planAccess(request: Request): Promise<PlanAccess | Response> {
  if (process.env.DREAM_PROJECT_PLAN_BACKEND !== undefined) {
    const config = managedPlanConfiguration();
    if (!config) return managedPlanUnavailable();
    const auth = await resolveServerAuth();
    if (auth.kind === "denied") return authDeniedResponse(auth);
    if (auth.kind !== "verified") return authDeniedResponse({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    return { owner: auth.userId, managed: true, transact: (write, action) =>
      openManagedPlanTransaction(config)(auth.userId, write, action) };
  }
  if (!localProjectFormEnabled()) return await requireApiAuth() ?? reply({ error: "기획 초안 저장을 사용할 수 없어요." }, 503);
  const access = await openLocalPlanAccess(request);
  if (access instanceof Response) return access;
  return { owner: access.owner, managed: false, transact: (write, action) => localPlanTransaction(access, write, action) };
}

async function planMaterialsStorage(client: PlanClient) {
  const { rows: [storage] } = await client.query<{ ready: boolean | null }>(`SELECT
    has_schema_privilege(n.oid,'USAGE') AND has_table_privilege(t.oid,'SELECT') AND has_table_privilege(t.oid,'INSERT')
    AND t.relrowsecurity AND t.relforcerowsecurity
    AND EXISTS (SELECT FROM pg_proc f WHERE f.pronamespace=n.oid AND f.proname='has_safe_version'
      AND has_function_privilege(f.oid,'EXECUTE'))
    AND 2 = (SELECT count(*) FROM pg_policy WHERE polrelid='dream.plans'::regclass
      AND (polname,polcmd) IN (('plan_materials_version_guard','a'),('plan_materials_approval_guard','w'))
      AND NOT polpermissive AND 'local_project_brief'::regrole=ANY(polroles)) AS ready
    FROM pg_namespace n LEFT JOIN pg_class t ON t.relnamespace=n.oid AND t.relname='drafts' AND t.relkind='r'
    WHERE n.nspname='local_plan_materials'`);
  return storage ? (storage.ready ? "ready" : "unavailable") : "missing";
}

async function approvePlan(client: PlanClient, owner: string, id: string,
  command: z.infer<typeof approveSchema>, draft: z.infer<typeof planningInputSchema>, managed: boolean) {
  const keys = [owner, id];
  const active = await client.query("SELECT 1 FROM dream.scenes WHERE owner_id=$1 AND project_id=$2 AND archived_at IS NULL LIMIT 1", keys);
  if (active.rowCount) return conflict();
  const scenes = draft.scenes.map((scene, index) => ({
    id: v7(), projectId: id, position: index + 1, title: scene.title, description: scene.description,
    dialogueJson: JSON.stringify(scene.dialogue ? [{ text: scene.dialogue }] : []),
    characterIdsJson: JSON.stringify(scene.characterIds), durationSec: scene.durationSec,
    needsRecheck: false, selectedVersionId: null, archivedAt: null,
  }));
  const approved = await client.query(`UPDATE dream.plans SET status='approved',
    approved_at=transaction_timestamp(),approved_scene_snapshot_json=$4
    WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND status='draft'`,
  [...keys, command.planId, JSON.stringify(scenes)]);
  const linked = await client.query(`UPDATE dream.projects SET approved_plan_id=$3
    WHERE owner_id=$1 AND id=$2 AND approved_plan_id IS NULL`, [...keys, command.planId]);
  if (approved.rowCount !== 1 || linked.rowCount !== 1) throw new Error("Plan approval changed");
  await client.query(`INSERT INTO dream.scenes(owner_id,project_id,id,position,title,description,dialogue_json,character_ids_json,duration_sec)
    SELECT $1,$2,s.id,s.position,s.title,s.description,s."dialogueJson",s."characterIdsJson",s."durationSec"
    FROM jsonb_to_recordset($3::jsonb) AS s(id uuid,position bigint,title text,description text,
      "dialogueJson" text,"characterIdsJson" text,"durationSec" bigint)`, [...keys, JSON.stringify(scenes)]);
  const planned = await client.query(`UPDATE dream.stage_states SET status='approved',approved_plan_id=$3,
    approved_at=transaction_timestamp(),approved_revision=$4
    WHERE owner_id=$1 AND project_id=$2 AND stage='plan' AND status IN ('todo','in_progress','needs_approval')`,
  [...keys, command.planId, command.revision]);
  const opened = await client.query(`UPDATE dream.stage_states SET status='todo'
    WHERE owner_id=$1 AND project_id=$2 AND stage='produce' AND status='locked'`, keys);
  if (planned.rowCount !== 1 || opened.rowCount !== 1) throw new Error("Plan stage changed");
  await logPlan(client, keys, "plan.approve", command.planId, command.version, command.revision, managed ? "managed-approver" : "local-user");
  return approvalResult(command.planId, command.version, managed);
}

async function logPlan(client: PlanClient, keys: string[], action: "plan.draft" | "plan.approve",
  planId: string, version: number, contentRevision: number, actor = "local-user") {
  await client.query(`INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at)
    VALUES($1,$3,$2,$4,$5,$6,clock_timestamp())`,
  [...keys, v7(), actor, action, JSON.stringify({ planId, version, contentRevision })]);
}

async function plan(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await planAccess(request);
  if (access instanceof Response) return access;
  const writing = request.method === "POST";
  if (access.managed && writing) {
    const rejected = rejectForeignWrite(request, process.env);
    if (rejected) return rejected;
  }
  const { id } = await params;
  const missing = () => reply({ error: "프로젝트를 찾을 수 없어요." }, 404);
  if (!z.uuidv7().safeParse(id).success) return missing();

  let command: z.infer<typeof commandSchema> | undefined;
  if (writing) {
    if (!access.managed) {
      const rejected = rejectCrossSite(request, { json: true });
      if (rejected) return rejected;
    }
    const body = access.managed ? await readLimitedText(request, managedPlanMaxBytes).catch(() => undefined) :
      await readBoundedUpload(request, 5 * 1024 * 1024).catch(() => undefined);
    if (body === null || body === "too-large") return tooLarge();
    try { command = commandSchema.safeParse(JSON.parse(body?.toString() ?? "")).data; }
    catch { /* Malformed JSON is handled like an invalid command. */ }
    if (!command) return reply({ error: "초안의 내용이나 승인 확인을 다시 확인해 주세요." }, 400);
  }

  const approvalRequest = Boolean(command && "action" in command && command.action === "approve-plan");
  const approvalSelected = access.managed && process.env.DREAM_PROJECT_PLAN_APPROVAL_BACKEND !== undefined;
  const approvalConfig = approvalSelected && (approvalRequest || !writing) ? managedPlanApprovalConfiguration() : null;
  const approval = approvalConfig ? openManagedPlanApprovalTransaction(approvalConfig) : null;
  const useManagedApproval = approvalSelected && approvalRequest;
  if (useManagedApproval && !approval) return managedPlanApprovalUnavailable();
  const transact: PlanAccess["transact"] = useManagedApproval && approval
    ? (write, action) => approval(access.owner, write, action) : access.transact;
  const write = writing && (!access.managed || !approvalRequest || useManagedApproval);
  return transact(write, async client => {
    const key = [access.owner, id];
    // Saves and approvals serialize on the same project row.
    const { rows: [project] } = await client.query(`SELECT content_revision, approved_plan_id, template_snapshot_json, length_sec
      FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id=ANY($3::text[]) AND archived_at IS NULL`
      + (write ? " FOR UPDATE" : ""), [...key, managedPlanMenus]);
    if (!project) return missing();
    const { rows: states } = await client.query(`SELECT stage,status FROM dream.stage_states
      WHERE owner_id=$1 AND project_id=$2 AND stage IN ('brief','plan','produce')`, key);
    const stages = Object.fromEntries(states.map(({ stage, status }) => [stage, status]));
    if (stages.brief !== "approved" || !stages.plan || stages.plan === "locked") {
      return reply({ error: "브리프를 먼저 승인해 주세요." }, 409);
    }
    if (access.managed && approvalRequest && !useManagedApproval) return approvalUnavailable();

    const { rows: [latest] } = await client.query(`SELECT id,version,script,steps_json,status
      FROM dream.plans WHERE owner_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`, key);
    const imported = command && "action" in command && command.action === "import-shorts-draft" ? command : undefined;
    const storage = access.managed ? "ready" : await planMaterialsStorage(client);
    if (storage === "unavailable" || (imported?.materials && storage !== "ready")) return materialsUnavailable();
    const materialsRow = latest && storage === "ready" ? (await client.query<{ payload: unknown }>(`SELECT payload
      FROM local_plan_materials.drafts WHERE owner_id=$1 AND plan_id=$2`, [access.owner, latest.id])).rows[0] : undefined;
    const savedMaterials = materialsRow ? savedShortsPlanMaterials.safeParse(materialsRow.payload).data : undefined;
    const revision = Number(project.content_revision);
    const version = Number(latest?.version ?? 0);
    const snapshot = menuSnapshotSchema.parse(JSON.parse(project.template_snapshot_json));
    const steps = snapshot.menu.planSteps.map(({ id, label }) => ({ id, label }));
    const existing = latest ? z.array(sceneDraftSchema).safeParse(JSON.parse(latest.steps_json)) : null;
    if (materialsRow && (!savedMaterials || !existing?.success || savedMaterials.scenes.length !== existing.data.length)) {
      return materialsUnavailable();
    }
    const hasNoSceneReferences = (scenes: z.infer<typeof planningInputSchema>["scenes"]) => !scenes.some(scene =>
      scene.sceneId || scene.characterIds.length || scene.assetIds.length);
    const knownSteps = (scenes: z.infer<typeof planningInputSchema>["scenes"]) => scenes.every(scene =>
      scene.stepId === "custom" || steps.some(step => step.id === scene.stepId));
    const writable = !project.approved_plan_id && stages.produce === "locked" &&
      ["todo", "in_progress", "needs_approval"].includes(stages.plan) &&
      (!latest || (latest.status === "draft" && existing?.success && hasNoSceneReferences(existing.data)));
    const savedDraft = latest ? { script: latest.script, scenes: existing?.data ?? [] } : null;
    const reviewedDraft = writable && savedDraft && knownSteps(savedDraft.scenes) ?
      planningInputSchema.safeParse(savedDraft).data : undefined;
    const approved = Boolean(latest?.status === "approved" && project.approved_plan_id === latest.id &&
      stages.plan === "approved");
    const produceOpen = approved && Boolean(stages.produce && stages.produce !== "locked");
    const draftDuration = approvalSelected && reviewedDraft?.scenes.reduce((total, scene) => total + scene.durationSec, 0);
    const matchesLength = draftDuration === Number(project.length_sec);
    const staleMaterials = savedMaterials && reviewedDraft && matchesLength
      ? shortsPlanMaterialsConflict(savedMaterials, reviewedDraft.scenes, Number(project.length_sec)) : null;
    const canApprove = Boolean(reviewedDraft) && (!access.managed ||
      (!command && approval && matchesLength && !staleMaterials && await approval(access.owner, false, async () => true) === true));
    const readState = {
      revision, writable: Boolean(writable), lengthSec: Number(project.length_sec), steps,
      canApprove: Boolean(canApprove), approved, produceOpen,
      ...(access.managed && { capabilities: { saveDraft: Boolean(writable), importShortsDraft: Boolean(writable), approvePlan: Boolean(canApprove) } }),
      ...(approvalSelected && { hostedProductionAvailable: false }),
    };
    if (!command) {
      const result = { ...readState, version, draft: savedDraft, planId: latest?.id ?? null, ...(savedMaterials && { materials: savedMaterials }) };
      if (access.managed && Buffer.byteLength(JSON.stringify(result)) > managedPlanMaxBytes) return managedPlanUnavailable();
      return reply(result);
    }
    if (useManagedApproval && approved && produceOpen && "action" in command && command.action === "approve-plan" &&
        command.planId === latest?.id && command.revision === revision && command.version === version) {
      const { rowCount } = await client.query(`SELECT 1 FROM dream.stage_states
        WHERE owner_id=$1 AND project_id=$2 AND stage='plan' AND status='approved' AND approved_plan_id=$3 AND approved_revision=$4`,
      [...key, command.planId, command.revision]);
      if (rowCount === 1) return approvalResult(command.planId, command.version, true);
    }
    if (!writable || command.revision !== revision || command.version !== version) return conflict();
    if ("action" in command) {
      if (command.action === "approve-plan") {
        if (!reviewedDraft || command.planId !== latest?.id) return conflict();
        if (useManagedApproval && !matchesLength) return conflict();
        if (useManagedApproval && staleMaterials) {
          return reply({ code: "PLAN_MATERIALS_STALE", error: "대본과 부가 자료의 생성 조건을 다시 확인해 주세요.", ...staleMaterials }, 409);
        }
        if (savedMaterials || useManagedApproval) {
          await client.query("SELECT set_config('local_plan_materials.reviewed_plan_id',$1,true)", [command.planId]);
        }
        return approvePlan(client, access.owner, id, command, reviewedDraft, useManagedApproval);
      }
      if (command.durationSec !== Number(project.length_sec)) {
        return reply({ error: "프로젝트 목표 길이와 기획 초안 길이가 달라요. 대상 프로젝트를 다시 확인해 주세요." }, 409);
      }
    }
    if (version >= Number.MAX_SAFE_INTEGER) return conflict();
    const { script, scenes } = command.draft;
    if (!hasNoSceneReferences(scenes) || !knownSteps(scenes)) {
      return reply({ error: "프로젝트에서 사용할 장면 구성을 확인해 주세요." }, 400);
    }
    let materials = savedMaterials;
    if (imported?.materials) {
      const mismatch = shortsPlanMaterialsConflict(imported.materials, scenes, imported.durationSec);
      if (mismatch) return reply({ code: "PLAN_MATERIALS_STALE", error: "대본과 부가 자료의 생성 조건을 다시 확인해 주세요.", ...mismatch }, 409);
      const sceneOrder = scenes.map(() => v7());
      materials = { ...imported.materials, sceneOrder,
        scenes: imported.materials.scenes.map((scene, index) => ({ ...scene, sceneKey: sceneOrder[index] })) };
    } else if (savedMaterials && (imported || JSON.stringify(scenes) !== JSON.stringify(savedDraft?.scenes))) {
      return reply({ code: "PLAN_MATERIALS_REQUIRED", error: "저장된 장면의 부가 자료를 함께 확인해 주세요." }, 409);
    }
    const next = version + 1;
    const planId = v7();
    const result = { revision, version: next, planId, draft: { script, scenes }, ...(materials && { materials }) };
    if (access.managed && Buffer.byteLength(JSON.stringify({ ...readState, ...result })) > managedPlanMaxBytes) return tooLarge();
    if (materials) {
      await client.query("INSERT INTO local_plan_materials.drafts(owner_id,plan_id,payload) VALUES($1,$2,$3::jsonb)",
        [access.owner, planId, JSON.stringify(materials)]);
    }
    await client.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,created_at)
      VALUES($1,$3,$2,$4,$5,$6,'draft',clock_timestamp())`, [...key, planId, next, JSON.stringify(scenes), script]);
    await logPlan(client, key, "plan.draft", planId, next, revision, access.managed ? "managed-user" : "local-user");
    return reply(result, 201);
  });
}

export { plan as GET, plan as POST };
