import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { v7 } from "uuid";
import { z } from "zod";
import { rejectCrossSite } from "@/lib/auth/config";
import { reviewInputSchema, reviewItems } from "@/lib/domain/review";
import { canonicalJson, outputFrames, timelineSchema, timelineSrt, timelineVtt } from "@/lib/edit/timeline";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { lockSceneResults, readScenes, scenesMatchTimeline } from "./local-timeline-scenes";
import { localWavTransaction, openLocalWavAccess } from "./local-wav-access";
import { hasLocalRenderApproval, loadLocalRenderProject } from "./local-render-request";
import { readBoundedUpload } from "./read-bounded-upload";

const basis = { revision: z.number().int().positive(), timelineId: z.uuid() };
const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...basis, action: z.literal("complete-edit") }),
  z.strictObject({ ...basis, action: z.literal("review-item"), input: reviewInputSchema }),
  z.strictObject({ ...basis, action: z.literal("approve-review") }),
]);
type Command = z.infer<typeof commandSchema>;
type Keys = [ownerId: string, projectId: string];
type Stage = { stage: string; status: string; approved_revision: string | null };
type SavedItem = { template_item_id: string; status: "unchecked" | "pass" | "hold"; note: string | null; required: string };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const fail = (code: string, status = 409) => reply({ code }, status);

async function reviewTimeline(client: Client, keys: Keys, revision: number, timelineId: string, aspect: string, lock: boolean) {
  const { rows: [saved] } = await client.query<{ timeline_json: string; timeline_sha256: string }>(`
    SELECT timeline_json,timeline_sha256 FROM dream.timeline_revisions
    WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND content_revision=$4`, [...keys, timelineId, revision]);
  if (!saved || createHash("sha256").update(saved.timeline_json).digest("hex") !== saved.timeline_sha256) return null;
  const parsed = timelineSchema.safeParse(JSON.parse(saved.timeline_json));
  if (!parsed.success || parsed.data.aspect !== aspect || canonicalJson(parsed.data) !== saved.timeline_json ||
      !parsed.data.video.length || !outputFrames(parsed.data)) return null;
  let scenes = await readScenes(client, ...keys, lock);
  if (lock) {
    await lockSceneResults(client, keys[0], scenes);
    scenes = await readScenes(client, ...keys);
  }
  return scenes.every(scene => scene.ready) && scenesMatchTimeline(scenes, parsed.data) ? parsed.data : null;
}

async function logReview(client: Client, keys: Keys, action: "stage.complete" | "review.item" | "review.approve", details: object) {
  await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
    VALUES($1,$2,$3,'local-user',$4,$5,clock_timestamp())`, [...keys, v7(), action, JSON.stringify(details)]);
}

async function handle(client: Client, keys: Keys, command?: Command) {
  const { rows: [project] } = await client.query<{
    content_revision: string; current_timeline_rev_id: string | null; aspect: string;
    template_snapshot_json: string; inputs_json: string;
  }>(`SELECT content_revision,current_timeline_rev_id,aspect,template_snapshot_json,inputs_json
    FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL${command ? " FOR UPDATE" : ""}`, keys);
  if (!project) return fail("PROJECT_MISSING", 404);
  const revision = Number(project.content_revision), timelineId = project.current_timeline_rev_id;
  if (command && (revision !== command.revision || timelineId !== command.timelineId)) return fail("CURRENT_TIMELINE_CONFLICT");

  const { rows } = await client.query<Stage>(`SELECT stage,status,approved_revision FROM dream.stage_states
    WHERE owner_id=$1 AND project_id=$2 AND stage IN ('produce','edit','review','export')
    ORDER BY stage${command ? " FOR UPDATE" : ""}`, keys);
  const stages = new Map(rows.map(stage => [stage.stage, stage]));
  const atRevision = (stage: string) => stages.get(stage)?.status === "approved" &&
    Number(stages.get(stage)?.approved_revision) === revision;
  let blockedReason = stages.get("produce")?.status !== "approved" ? "PRODUCE_APPROVAL_REQUIRED" :
    timelineId ? null : "TIMELINE_REQUIRED";
  const timeline = !blockedReason && timelineId ? await reviewTimeline(client, keys, revision, timelineId, project.aspect, !!command) : null;
  if (!timeline && !blockedReason) blockedReason = "BASE_TIMELINE_STALE";
  if (command && blockedReason) return fail(blockedReason);
  let editCompleted = !blockedReason && atRevision("edit");
  let approved = editCompleted && atRevision("review");
  const expected = timeline ? reviewItems(
    menuSnapshotSchema.parse(JSON.parse(project.template_snapshot_json)),
    z.record(z.string(), z.unknown()).parse(JSON.parse(project.inputs_json)), timeline,
  ) : [];
  const { rows: stored } = expected.length ? await client.query<SavedItem>(`SELECT template_item_id,status,note,required
    FROM dream.review_items WHERE owner_id=$1 AND project_id=$2 AND content_revision=$3`, [...keys, revision]) : { rows: [] };
  const savedItems = new Map(stored.map(item => [item.template_item_id, item]));
  const response = () => reply({
    revision, timelineId, editCompleted, approved, blockedReason,
    items: expected.map(({ id, label, source, required }) => ({
      id, label, source, required, status: savedItems.get(id)?.status ?? "unchecked", note: savedItems.get(id)?.note ?? null,
    })),
  });
  if (!command) return response();

  const details = { contentRevision: revision, timelineId };
  if (command.action === "complete-edit") {
    if (editCompleted) return response();
    if (!["todo", "in_progress"].includes(stages.get("edit")?.status ?? "") ||
        stages.get("review")?.status !== "locked") return fail("EDIT_COMPLETION_REQUIRED");
    const transition = await client.query(`UPDATE dream.stage_states SET
      status=CASE stage WHEN 'edit' THEN 'approved' ELSE 'todo' END,
      approved_revision=CASE WHEN stage='edit' THEN $3::bigint END,
      approved_at=CASE WHEN stage='edit' THEN clock_timestamp() END,approved_plan_id=NULL
      WHERE owner_id=$1 AND project_id=$2 AND stage IN ('edit','review')`, [...keys, revision]);
    if (transition.rowCount !== 2) throw new Error("Edit completion changed");
    await logReview(client, keys, "stage.complete", { ...details, stage: "edit", status: "approved" });
    editCompleted = true;
    return response();
  }

  if (!editCompleted) return fail("EDIT_COMPLETION_REQUIRED");
  if (approved) return command.action === "approve-review" ? response() : fail("REVIEW_ALREADY_APPROVED");
  if (!["todo", "in_progress", "needs_approval"].includes(stages.get("review")?.status ?? "")) return fail("REVIEW_STAGE_LOCKED");
  if (command.action === "review-item") {
    const { itemId, status } = command.input;
    const note = command.input.note || null;
    const item = expected.find(row => row.id === itemId);
    if (!item) return fail("REVIEW_ITEM_MISSING", 404);
    const previous = savedItems.get(itemId);
    if ((previous?.status ?? "unchecked") === status && (previous?.note ?? null) === note) return response();
    const updated = previous
      ? await client.query(`UPDATE dream.review_items SET status=$5,note=$6,
          checked_at=CASE WHEN $5='unchecked' THEN NULL ELSE clock_timestamp() END
          WHERE owner_id=$1 AND project_id=$2 AND content_revision=$3 AND template_item_id=$4`,
        [...keys, revision, itemId, status, note])
      : await client.query(`INSERT INTO dream.review_items
          (owner_id,id,project_id,content_revision,template_item_id,label,source,required,status,note,checked_at)
          VALUES($1,$4,$2,$3,$5,$6,$7,$8,$9,$10,CASE WHEN $9='unchecked' THEN NULL ELSE clock_timestamp() END)`,
        [...keys, revision, v7(), itemId, item.label, item.source, Number(item.required), status, note]);
    if (updated.rowCount !== 1) throw new Error("Review item changed");
    if (stages.get("review")?.status === "todo") {
      const started = await client.query("UPDATE dream.stage_states SET status='in_progress' WHERE owner_id=$1 AND project_id=$2 AND stage='review'", keys);
      if (started.rowCount !== 1) throw new Error("Review stage changed");
    }
    await logReview(client, keys, "review.item", { ...details, itemId, status });
    savedItems.set(itemId, { template_item_id: itemId, status, note, required: previous?.required ?? String(Number(item.required)) });
    return response();
  }

  const required = expected.filter(item => item.required);
  if (!required.length || required.some(item => {
    const row = savedItems.get(item.id);
    return row?.status !== "pass" || Number(row.required) !== 1;
  }) || stored.some(item => Number(item.required) === 1 && item.status !== "pass")) return fail("REQUIRED_ITEMS_INCOMPLETE");
  if (stages.get("export")?.status !== "locked") return fail("REVIEW_STAGE_LOCKED");
  const transition = await client.query(`UPDATE dream.stage_states SET
    status=CASE stage WHEN 'review' THEN 'approved' ELSE 'todo' END,
    approved_revision=CASE WHEN stage='review' THEN $3::bigint END,
    approved_at=CASE WHEN stage='review' THEN clock_timestamp() END,approved_plan_id=NULL
    WHERE owner_id=$1 AND project_id=$2 AND stage IN ('review','export')`, [...keys, revision]);
  if (transition.rowCount !== 2) throw new Error("Review approval changed");
  await logReview(client, keys, "review.approve", details);
  approved = true;
  return response();
}

export async function localProjectReview(request: Request, params: Promise<{ id: string }>) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  if (!z.uuidv7().safeParse(id).success) return fail("PROJECT_MISSING", 404);
  let command: Command | undefined;
  if (request.method === "POST") {
    const denied = rejectCrossSite(request, { json: true });
    if (denied) return denied;
    const bytes = await readBoundedUpload(request, 16384).catch(() => undefined);
    try { command = commandSchema.safeParse(JSON.parse(bytes?.toString("utf8") ?? "")).data; }
    catch { /* Invalid JSON and malformed commands use the same response. */ }
    if (!command) return fail("INVALID_REQUEST", 400);
  }
  return localWavTransaction(access, "local_project_review", !!command, client => handle(client, [access.owner, id], command));
}


const downloadQuery = z.strictObject({
  format: z.enum(["srt", "vtt"]),
  revision: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(basis.revision),
  timelineId: basis.timelineId,
});

export async function downloadProjectSubtitles(request: Request, params: Promise<{ id: string }>) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  if (!z.uuidv7().safeParse(id).success) return fail("PROJECT_MISSING", 404);
  const query = new URL(request.url).searchParams;
  const parsed = downloadQuery.safeParse(Object.fromEntries(query));
  if (!parsed.success || query.size !== 3) return fail("INVALID_REQUEST", 400);
  const { format, revision, timelineId } = parsed.data;
  const keys: Keys = [access.owner, id];
  return localWavTransaction(access, "local_project_review", false, async client => {
    const project = await loadLocalRenderProject(client, ...keys, false);
    if (!project) return fail("PROJECT_MISSING", 404);
    if (Number(project.content_revision) !== revision || project.current_timeline_rev_id !== timelineId) {
      return fail("CURRENT_TIMELINE_CONFLICT");
    }
    if (!await hasLocalRenderApproval(client, ...keys, revision, false)) return fail("REVIEW_APPROVAL_REQUIRED");
    const timeline = await reviewTimeline(client, keys, revision, timelineId, project.aspect, false);
    if (!timeline) return fail("BASE_TIMELINE_STALE");
    const text = format === "srt" ? timelineSrt(timeline.text) : timelineVtt(timeline.text);
    if (!text) return fail("SUBTITLES_EMPTY", 404);
    return new Response(text, { headers: {
      "Content-Type": format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
      "Content-Disposition": `attachment; filename="subtitles-r${revision}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
