import { v7 } from "uuid";
import { z } from "zod";
import type { Client } from "pg";
import { requireApiAuth } from "@/lib/auth/api";
import { rejectCrossSite } from "@/lib/auth/config";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { localWavTransaction, openLocalWavAccess } from "@/lib/cloud/local-wav-access";
import { readBoundedUpload } from "@/lib/cloud/read-bounded-upload";
import { planningInputSchema, sceneDraftSchema } from "@/lib/domain/planning-draft";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";

export const runtime = "nodejs";
const saveSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  draft: planningInputSchema,
});
const approveSchema = z.strictObject({
  action: z.literal("approve-plan"),
  acknowledged: z.literal(true),
  revision: saveSchema.shape.revision,
  version: z.number().int().positive(),
  planId: z.uuidv7(),
});
const commandSchema = z.union([saveSchema, approveSchema]);
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
const conflict = () => reply({ error: "현재 기획 상태가 바뀌었어요. 저장된 초안을 확인해 주세요." }, 409);

async function approvePlan(client: Client, owner: string, id: string,
  command: z.infer<typeof approveSchema>, draft: z.infer<typeof planningInputSchema>) {
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
  await logPlan(client, keys, "plan.approve", command.planId, command.version, command.revision);
  return reply({ planId: command.planId, version: command.version, approved: true, produceOpen: true });
}

async function logPlan(client: Client, keys: string[], action: "plan.draft" | "plan.approve",
  planId: string, version: number, contentRevision: number) {
  await client.query(`INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at)
    VALUES($1,$3,$2,'local-user',$4,$5,clock_timestamp())`,
  [...keys, v7(), action, JSON.stringify({ planId, version, contentRevision })]);
}

async function plan(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) {
    return await requireApiAuth() ?? reply({ error: "기획 초안 저장을 사용할 수 없어요." }, 503);
  }
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  const missing = () => reply({ error: "프로젝트를 찾을 수 없어요." }, 404);
  if (!z.uuidv7().safeParse(id).success) return missing();

  const writing = request.method === "POST";
  let command: z.infer<typeof commandSchema> | undefined;
  if (writing) {
    const rejected = rejectCrossSite(request, { json: true });
    if (rejected) return rejected;
    const bytes = await readBoundedUpload(request, 5 * 1024 * 1024).catch(() => undefined);
    if (bytes === null) return reply({ error: "초안이 너무 길어요." }, 413);
    try { command = commandSchema.safeParse(JSON.parse(bytes?.toString("utf8") ?? "")).data; }
    catch { /* Malformed JSON is handled like an invalid command. */ }
    if (!command) return reply({ error: "초안의 내용이나 승인 확인을 다시 확인해 주세요." }, 400);
  }

  return localWavTransaction(access, "local_project_brief", writing, async client => {
    const key = [access.owner, id];
    // Saves and approvals serialize on the same project row.
    const { rows: [project] } = await client.query(`SELECT content_revision, approved_plan_id, template_snapshot_json, length_sec
      FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL`
      + (writing ? " FOR UPDATE" : ""), key);
    if (!project) return missing();
    const { rows: states } = await client.query(`SELECT stage,status FROM dream.stage_states
      WHERE owner_id=$1 AND project_id=$2 AND stage IN ('brief','plan','produce')`, key);
    const stages = Object.fromEntries(states.map(({ stage, status }) => [stage, status]));
    if (stages.brief !== "approved" || !stages.plan || stages.plan === "locked") {
      return reply({ error: "브리프를 먼저 승인해 주세요." }, 409);
    }

    const { rows: [latest] } = await client.query(`SELECT id,version,script,steps_json,status
      FROM dream.plans WHERE owner_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`, key);
    const revision = Number(project.content_revision);
    const version = Number(latest?.version ?? 0);
    const snapshot = menuSnapshotSchema.parse(JSON.parse(project.template_snapshot_json));
    const steps = snapshot.menu.planSteps.map(({ id, label }) => ({ id, label }));
    const existing = latest ? z.array(sceneDraftSchema).safeParse(JSON.parse(latest.steps_json)) : null;
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
    if (!command) return reply({
      revision, version, writable: Boolean(writable), lengthSec: Number(project.length_sec), steps,
      draft: savedDraft, planId: latest?.id ?? null, canApprove: Boolean(reviewedDraft), approved,
      produceOpen: approved && Boolean(stages.produce && stages.produce !== "locked"),
    });
    if (!writable || command.revision !== revision || command.version !== version) return conflict();
    if ("action" in command) {
      if (!reviewedDraft || command.planId !== latest?.id) return conflict();
      return approvePlan(client, access.owner, id, command, reviewedDraft);
    }
    if (version >= Number.MAX_SAFE_INTEGER) return conflict();
    const { script, scenes } = command.draft;
    if (!hasNoSceneReferences(scenes) || !knownSteps(scenes)) {
      return reply({ error: "프로젝트에서 사용할 장면 구성을 확인해 주세요." }, 400);
    }
    const next = version + 1;
    const planId = v7();
    await client.query(`INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,created_at)
      VALUES($1,$3,$2,$4,$5,$6,'draft',clock_timestamp())`, [...key, planId, next, JSON.stringify(scenes), script]);
    await logPlan(client, key, "plan.draft", planId, next, revision);
    return reply({ revision, version: next, planId, draft: { script, scenes } }, 201);
  });
}

export { plan as GET, plan as POST };
