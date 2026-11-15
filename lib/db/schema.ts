import { integer, text, sqliteTable, primaryKey, uniqueIndex, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

const identifier = () => text("id").primaryKey().$defaultFn(v7);
const created = () => text("created_at").notNull().$defaultFn(() => new Date().toISOString());
const updated = () => text("updated_at").notNull().$defaultFn(() => new Date().toISOString());
export const projects = sqliteTable("projects", {
  id:identifier(), menuId:text("menu_id").notNull(), templateVersion:text("template_version").notNull(), templateSnapshotJson:text("template_snapshot_json").notNull(), inputsJson:text("inputs_json").notNull(),
  title:text("title").notNull(), goal:text("goal").notNull(), target:text("target").notNull(), aspect:text("aspect").notNull(), lengthSec:integer("length_sec").notNull(),
  approvedPlanId:text("approved_plan_id").references((): AnySQLiteColumn=>plans.id), contentRevision:integer("content_revision").notNull().default(1), currentTimelineRevId:text("current_timeline_rev_id"), archivedAt:text("archived_at"), createdAt:created(), updatedAt:updated(),
},(t)=>[index("projects_menu_idx").on(t.menuId),index("projects_plan_idx").on(t.approvedPlanId)]);
export const stageStates = sqliteTable("stage_states", {
  projectId:text("project_id").notNull().references(()=>projects.id), stage:text("stage").notNull(), status:text("status").notNull(), approvedPlanId:text("approved_plan_id").references((): AnySQLiteColumn=>plans.id), approvedRevision:integer("approved_revision"), approvedAt:text("approved_at"), note:text("note"),
},(t)=>[primaryKey({columns:[t.projectId,t.stage]}),index("stages_status_idx").on(t.status),index("stages_plan_idx").on(t.approvedPlanId)]);
export const assets = sqliteTable("assets", {
  id:identifier(), kind:text("kind").notNull(),title:text("title").notNull(),sourceUrl:text("source_url"),rightsNote:text("rights_note"),role:text("role").notNull(),filePath:text("file_path"),mime:text("mime"),sizeBytes:integer("size_bytes"),sha256:text("sha256"),width:integer("width"),height:integer("height"),durationMs:integer("duration_ms"),origin:text("origin").notNull(),generationId:text("generation_id").references((): AnySQLiteColumn=>generations.id),isMock:integer("is_mock",{mode:"boolean"}).notNull().default(false),archivedAt:text("archived_at"),createdAt:created(),
},(t)=>[index("assets_kind_idx").on(t.kind),index("assets_generation_idx").on(t.generationId)]);
export const projectAssets = sqliteTable("project_assets",{
  projectId:text("project_id").notNull().references(()=>projects.id),assetId:text("asset_id").notNull().references(()=>assets.id),purpose:text("purpose").notNull(),
},(t)=>[primaryKey({columns:[t.projectId,t.assetId,t.purpose]}),index("project_assets_asset_idx").on(t.assetId)]);
export const characters = sqliteTable("characters",{
  id:identifier(),name:text("name").notNull(),description:text("description").notNull(),lockedJson:text("locked_json").notNull(),refAssetIdsJson:text("ref_asset_ids_json").notNull(),voiceProfileJson:text("voice_profile_json").notNull(),status:text("status").notNull(),archivedAt:text("archived_at"),createdAt:created(),
},(t)=>[index("characters_status_idx").on(t.status)]);
export const projectCharacters = sqliteTable("project_characters",{projectId:text("project_id").notNull().references(()=>projects.id),characterId:text("character_id").notNull().references(()=>characters.id)},(t)=>[primaryKey({columns:[t.projectId,t.characterId]}),index("project_characters_character_idx").on(t.characterId)]);
export const plans = sqliteTable("plans",{
  id:identifier(),projectId:text("project_id").notNull().references(()=>projects.id),version:integer("version").notNull(),stepsJson:text("steps_json").notNull(),script:text("script").notNull(),status:text("status").notNull(),approvedSceneSnapshotJson:text("approved_scene_snapshot_json"),approvedAt:text("approved_at"),createdAt:created(),
},(t)=>[uniqueIndex("plans_project_version").on(t.projectId,t.version),index("plans_status_idx").on(t.status)]);
export const scenes = sqliteTable("scenes",{
  id:identifier(),projectId:text("project_id").notNull().references(()=>projects.id),position:integer("position").notNull(),title:text("title").notNull(),description:text("description").notNull(),dialogueJson:text("dialogue_json").notNull(),characterIdsJson:text("character_ids_json").notNull(),durationSec:integer("duration_sec").notNull(),needsRecheck:integer("needs_recheck",{mode:"boolean"}).notNull().default(false),selectedVersionId:text("selected_version_id").references(():AnySQLiteColumn=>sceneVersions.id),archivedAt:text("archived_at"),
},(t)=>[index("scenes_project_idx").on(t.projectId),index("scenes_selected_idx").on(t.selectedVersionId)]);
export const jobs = sqliteTable("jobs",{
  id:identifier(),kind:text("kind").notNull(),payloadVersion:integer("payload_version").notNull().default(1),inputSnapshotJson:text("input_snapshot_json").notNull(),status:text("status").notNull(),projectId:text("project_id").references(()=>projects.id),refType:text("ref_type").notNull(),refId:text("ref_id").notNull(),provider:text("provider").notNull(),providerJobId:text("provider_job_id"),idempotencyKey:text("idempotency_key").notNull(),attempts:integer("attempts").notNull().default(0),maxAttempts:integer("max_attempts").notNull().default(3),nextRunAt:text("next_run_at"),leaseUntil:text("lease_until"),heartbeatAt:text("heartbeat_at"),cancelRequestedAt:text("cancel_requested_at"),errorCode:text("error_code"),errorMessage:text("error_message"),createdAt:created(),updatedAt:updated(),finishedAt:text("finished_at"),
},(t)=>[uniqueIndex("jobs_idempotency_key").on(t.idempotencyKey),index("jobs_claim_idx").on(t.status,t.nextRunAt),index("jobs_project_idx").on(t.projectId)]);
export const generations = sqliteTable("generations",{
  id:identifier(),jobId:text("job_id").notNull().references(()=>jobs.id),provider:text("provider").notNull(),model:text("model").notNull(),paramsJson:text("params_json").notNull(),referenceSnapshotJson:text("reference_snapshot_json").notNull(),seed:integer("seed"),costEstimateMicros:integer("cost_estimate_micros").notNull().default(0),costActualMicros:integer("cost_actual_micros"),currency:text("currency").notNull(),settlement:text("settlement").notNull(),startedAt:text("started_at").notNull(),finishedAt:text("finished_at"),
},(t)=>[index("generations_job_idx").on(t.jobId),index("generations_settlement_idx").on(t.settlement)]);
export const sceneVersions = sqliteTable("scene_versions",{
  id:identifier(),sceneId:text("scene_id").notNull().references(()=>scenes.id),version:integer("version").notNull(),planId:text("plan_id").notNull().references(()=>plans.id),kind:text("kind").notNull(),inputSnapshotJson:text("input_snapshot_json").notNull(),jobId:text("job_id").references(()=>jobs.id),generationId:text("generation_id").references(()=>generations.id),resultAssetId:text("result_asset_id").references(()=>assets.id),status:text("status").notNull(),createdAt:created(),
},(t)=>[uniqueIndex("scene_versions_scene_version").on(t.sceneId,t.version),index("versions_plan_idx").on(t.planId),index("versions_job_idx").on(t.jobId),index("versions_generation_idx").on(t.generationId),index("versions_asset_idx").on(t.resultAssetId),index("versions_status_idx").on(t.status)]);
export const reviewItems = sqliteTable("review_items",{
  id:identifier(),projectId:text("project_id").notNull().references(()=>projects.id),contentRevision:integer("content_revision").notNull(),templateItemId:text("template_item_id").notNull(),label:text("label").notNull(),source:text("source").notNull(),required:integer("required",{mode:"boolean"}).notNull(),status:text("status").notNull(),note:text("note"),checkedAt:text("checked_at"),
},(t)=>[uniqueIndex("review_project_revision_item").on(t.projectId,t.contentRevision,t.templateItemId),index("review_status_idx").on(t.status)]);
export const exports = sqliteTable("exports",{
  id:identifier(),projectId:text("project_id").notNull().references(()=>projects.id),contentRevision:integer("content_revision").notNull(),status:text("status").notNull(),filePath:text("file_path"),manifestVersion:integer("manifest_version").notNull().default(1),manifestJson:text("manifest_json"),sha256:text("sha256"),error:text("error"),createdAt:created(),completedAt:text("completed_at"),
},(t)=>[index("exports_project_idx").on(t.projectId),index("exports_status_idx").on(t.status)]);
export const activityLog = sqliteTable("activity_log",{id:identifier(),projectId:text("project_id").references(()=>projects.id),actor:text("actor").notNull(),action:text("action").notNull(),detailJson:text("detail_json").notNull(),createdAt:created()},(t)=>[index("activity_project_idx").on(t.projectId)]);
export const settings = sqliteTable("settings",{key:text("key").primaryKey(),valueJson:text("value_json").notNull()});
export const backups = sqliteTable("backups",{id:identifier(),kind:text("kind").notNull(),path:text("path").notNull(),dbSha256:text("db_sha256"),fileInventorySha256:text("file_inventory_sha256"),status:text("status").notNull(),error:text("error"),createdAt:created()},(t)=>[index("backups_status_idx").on(t.status)]);
