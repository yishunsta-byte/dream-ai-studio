-- P1 schema; generated from lib/db/schema.ts with explicit domain CHECK constraints.

CREATE TABLE "activity_log" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail_json" TEXT NOT NULL CHECK ("detail_json" IS NULL OR json_valid("detail_json")),
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "activity_project_idx" ON "activity_log" ("project_id");

CREATE TABLE "assets" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('image','video','audio','text','doc','link')),
  "title" TEXT NOT NULL,
  "source_url" TEXT,
  "rights_note" TEXT,
  "role" TEXT NOT NULL CHECK ("role" IN ('original','intermediate','selected','final')),
  "file_path" TEXT,
  "mime" TEXT,
  "size_bytes" INTEGER CHECK ("size_bytes" IS NULL OR (typeof("size_bytes")='integer' AND "size_bytes" >= 0 AND "size_bytes" <= 9007199254740991)),
  "sha256" TEXT,
  "width" INTEGER CHECK ("width" IS NULL OR (typeof("width")='integer' AND "width" >= 1 AND "width" <= 9007199254740991)),
  "height" INTEGER CHECK ("height" IS NULL OR (typeof("height")='integer' AND "height" >= 1 AND "height" <= 9007199254740991)),
  "duration_ms" INTEGER CHECK ("duration_ms" IS NULL OR (typeof("duration_ms")='integer' AND "duration_ms" >= 0 AND "duration_ms" <= 9007199254740991)),
  "origin" TEXT NOT NULL CHECK ("origin" IN ('upload','link','generated','render','import')),
  "generation_id" TEXT,
  "is_mock" INTEGER NOT NULL DEFAULT 0 CHECK ("is_mock" IS NULL OR (typeof("is_mock")='integer' AND "is_mock" >= 0 AND "is_mock" <= 9007199254740991)) CHECK ("is_mock" IN (0,1)),
  "archived_at" TEXT,
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("generation_id") REFERENCES "generations" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((kind = 'link' AND file_path IS NULL AND source_url IS NOT NULL) OR (kind <> 'link' AND file_path IS NOT NULL AND mime IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK (file_path IS NULL OR (file_path NOT LIKE '/%' AND file_path NOT LIKE '%..%' AND instr(file_path, ':') = 0 AND instr(file_path, char(92)) = 0)),
  CHECK (sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*'))
) STRICT;

CREATE INDEX "assets_kind_idx" ON "assets" ("kind");

CREATE INDEX "assets_generation_idx" ON "assets" ("generation_id");

CREATE TABLE "backups" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('auto','manual')),
  "path" TEXT NOT NULL,
  "db_sha256" TEXT,
  "file_inventory_sha256" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('running','succeeded','failed')),
  "error" TEXT,
  "created_at" TEXT NOT NULL
) STRICT;

CREATE INDEX "backups_status_idx" ON "backups" ("status");

CREATE TABLE "characters" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "locked_json" TEXT NOT NULL CHECK ("locked_json" IS NULL OR json_valid("locked_json")),
  "ref_asset_ids_json" TEXT NOT NULL CHECK ("ref_asset_ids_json" IS NULL OR json_valid("ref_asset_ids_json")),
  "voice_profile_json" TEXT NOT NULL CHECK ("voice_profile_json" IS NULL OR json_valid("voice_profile_json")),
  "status" TEXT NOT NULL CHECK ("status" IN ('confirmed','unconfirmed')),
  "archived_at" TEXT,
  "created_at" TEXT NOT NULL
) STRICT;

CREATE INDEX "characters_status_idx" ON "characters" ("status");

CREATE TABLE "exports" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT NOT NULL,
  "content_revision" INTEGER NOT NULL CHECK ("content_revision" IS NULL OR (typeof("content_revision")='integer' AND "content_revision" >= 1 AND "content_revision" <= 9007199254740991)),
  "status" TEXT NOT NULL CHECK ("status" IN ('running','succeeded','failed')),
  "file_path" TEXT,
  "manifest_version" INTEGER NOT NULL DEFAULT 1 CHECK ("manifest_version" IS NULL OR (typeof("manifest_version")='integer' AND "manifest_version" >= 1 AND "manifest_version" <= 9007199254740991)),
  "manifest_json" TEXT CHECK ("manifest_json" IS NULL OR json_valid("manifest_json")),
  "sha256" TEXT,
  "error" TEXT,
  "created_at" TEXT NOT NULL,
  "completed_at" TEXT,
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (status <> 'succeeded' OR (file_path IS NOT NULL AND manifest_json IS NOT NULL AND sha256 IS NOT NULL AND completed_at IS NOT NULL))
) STRICT;

CREATE INDEX "exports_project_idx" ON "exports" ("project_id");

CREATE INDEX "exports_status_idx" ON "exports" ("status");

CREATE TABLE "generations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "job_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "params_json" TEXT NOT NULL CHECK ("params_json" IS NULL OR json_valid("params_json")),
  "reference_snapshot_json" TEXT NOT NULL CHECK ("reference_snapshot_json" IS NULL OR json_valid("reference_snapshot_json")),
  "seed" INTEGER CHECK ("seed" IS NULL OR (typeof("seed")='integer' AND "seed" >= 0 AND "seed" <= 9007199254740991)),
  "cost_estimate_micros" INTEGER NOT NULL DEFAULT 0 CHECK ("cost_estimate_micros" IS NULL OR (typeof("cost_estimate_micros")='integer' AND "cost_estimate_micros" >= 0 AND "cost_estimate_micros" <= 9007199254740991)),
  "cost_actual_micros" INTEGER CHECK ("cost_actual_micros" IS NULL OR (typeof("cost_actual_micros")='integer' AND "cost_actual_micros" >= 0 AND "cost_actual_micros" <= 9007199254740991)),
  "currency" TEXT NOT NULL,
  "settlement" TEXT NOT NULL CHECK ("settlement" IN ('none','reserved','settled','refunded')),
  "started_at" TEXT NOT NULL,
  "finished_at" TEXT,
  FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "generations_job_idx" ON "generations" ("job_id");

CREATE INDEX "generations_settlement_idx" ON "generations" ("settlement");

CREATE TABLE "jobs" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL,
  "payload_version" INTEGER NOT NULL DEFAULT 1 CHECK ("payload_version" IS NULL OR (typeof("payload_version")='integer' AND "payload_version" >= 1 AND "payload_version" <= 9007199254740991)),
  "input_snapshot_json" TEXT NOT NULL CHECK ("input_snapshot_json" IS NULL OR json_valid("input_snapshot_json")),
  "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','succeeded','failed','canceled')),
  "project_id" TEXT,
  "ref_type" TEXT NOT NULL,
  "ref_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_job_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" IS NULL OR (typeof("attempts")='integer' AND "attempts" >= 0 AND "attempts" <= 9007199254740991)),
  "max_attempts" INTEGER NOT NULL DEFAULT 3 CHECK ("max_attempts" IS NULL OR (typeof("max_attempts")='integer' AND "max_attempts" >= 1 AND "max_attempts" <= 9007199254740991)),
  "next_run_at" TEXT,
  "lease_until" TEXT,
  "heartbeat_at" TEXT,
  "cancel_requested_at" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "finished_at" TEXT,
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE UNIQUE INDEX "jobs_idempotency_key" ON "jobs" ("idempotency_key");

CREATE INDEX "jobs_claim_idx" ON "jobs" ("status","next_run_at");

CREATE INDEX "jobs_project_idx" ON "jobs" ("project_id");

CREATE TABLE "plans" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" IS NULL OR (typeof("version")='integer' AND "version" >= 1 AND "version" <= 9007199254740991)),
  "steps_json" TEXT NOT NULL CHECK ("steps_json" IS NULL OR json_valid("steps_json")),
  "script" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('draft','approved')),
  "approved_scene_snapshot_json" TEXT CHECK ("approved_scene_snapshot_json" IS NULL OR json_valid("approved_scene_snapshot_json")),
  "approved_at" TEXT,
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_scene_snapshot_json IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX "plans_project_version" ON "plans" ("project_id","version");

CREATE INDEX "plans_status_idx" ON "plans" ("status");

CREATE TABLE "project_assets" (
  "project_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  PRIMARY KEY ("project_id","asset_id","purpose"),
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "project_assets_asset_idx" ON "project_assets" ("asset_id");

CREATE TABLE "project_characters" (
  "project_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  PRIMARY KEY ("project_id","character_id"),
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "project_characters_character_idx" ON "project_characters" ("character_id");

CREATE TABLE "projects" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "menu_id" TEXT NOT NULL,
  "template_version" TEXT NOT NULL,
  "template_snapshot_json" TEXT NOT NULL CHECK ("template_snapshot_json" IS NULL OR json_valid("template_snapshot_json")),
  "inputs_json" TEXT NOT NULL CHECK ("inputs_json" IS NULL OR json_valid("inputs_json")),
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "aspect" TEXT NOT NULL CHECK ("aspect" IN ('9:16','16:9','1:1')),
  "length_sec" INTEGER NOT NULL CHECK ("length_sec" IS NULL OR (typeof("length_sec")='integer' AND "length_sec" >= 1 AND "length_sec" <= 9007199254740991)),
  "approved_plan_id" TEXT,
  "content_revision" INTEGER NOT NULL DEFAULT 1 CHECK ("content_revision" IS NULL OR (typeof("content_revision")='integer' AND "content_revision" >= 1 AND "content_revision" <= 9007199254740991)),
  "current_timeline_rev_id" TEXT,
  "archived_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  FOREIGN KEY ("approved_plan_id") REFERENCES "plans" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "projects_menu_idx" ON "projects" ("menu_id");

CREATE INDEX "projects_plan_idx" ON "projects" ("approved_plan_id");

CREATE TABLE "review_items" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT NOT NULL,
  "content_revision" INTEGER NOT NULL CHECK ("content_revision" IS NULL OR (typeof("content_revision")='integer' AND "content_revision" >= 1 AND "content_revision" <= 9007199254740991)),
  "template_item_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "source" TEXT NOT NULL CHECK ("source" IN ('common','menu','conditional','custom')),
  "required" INTEGER NOT NULL CHECK ("required" IS NULL OR (typeof("required")='integer' AND "required" >= 0 AND "required" <= 9007199254740991)) CHECK ("required" IN (0,1)),
  "status" TEXT NOT NULL CHECK ("status" IN ('unchecked','pass','hold')),
  "note" TEXT,
  "checked_at" TEXT,
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (status <> 'hold' OR length(trim(coalesce(note,''))) > 0)
) STRICT;

CREATE UNIQUE INDEX "review_project_revision_item" ON "review_items" ("project_id","content_revision","template_item_id");

CREATE INDEX "review_status_idx" ON "review_items" ("status");

CREATE TABLE "scene_versions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "scene_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" IS NULL OR (typeof("version")='integer' AND "version" >= 1 AND "version" <= 9007199254740991)),
  "plan_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('image','video','speech')),
  "input_snapshot_json" TEXT NOT NULL CHECK ("input_snapshot_json" IS NULL OR json_valid("input_snapshot_json")),
  "job_id" TEXT,
  "generation_id" TEXT,
  "result_asset_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','succeeded','failed','canceled')),
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("scene_id") REFERENCES "scenes" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("plan_id") REFERENCES "plans" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("generation_id") REFERENCES "generations" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("result_asset_id") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (status <> 'succeeded' OR result_asset_id IS NOT NULL)
) STRICT;

CREATE UNIQUE INDEX "scene_versions_scene_version" ON "scene_versions" ("scene_id","version");

CREATE INDEX "versions_plan_idx" ON "scene_versions" ("plan_id");

CREATE INDEX "versions_job_idx" ON "scene_versions" ("job_id");

CREATE INDEX "versions_generation_idx" ON "scene_versions" ("generation_id");

CREATE INDEX "versions_asset_idx" ON "scene_versions" ("result_asset_id");

CREATE INDEX "versions_status_idx" ON "scene_versions" ("status");

CREATE TABLE "scenes" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" IS NULL OR (typeof("position")='integer' AND "position" >= 0 AND "position" <= 9007199254740991)),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "dialogue_json" TEXT NOT NULL CHECK ("dialogue_json" IS NULL OR json_valid("dialogue_json")),
  "character_ids_json" TEXT NOT NULL CHECK ("character_ids_json" IS NULL OR json_valid("character_ids_json")),
  "duration_sec" INTEGER NOT NULL CHECK ("duration_sec" IS NULL OR (typeof("duration_sec")='integer' AND "duration_sec" >= 1 AND "duration_sec" <= 9007199254740991)),
  "needs_recheck" INTEGER NOT NULL DEFAULT 0 CHECK ("needs_recheck" IS NULL OR (typeof("needs_recheck")='integer' AND "needs_recheck" >= 0 AND "needs_recheck" <= 9007199254740991)) CHECK ("needs_recheck" IN (0,1)),
  "selected_version_id" TEXT,
  "archived_at" TEXT,
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("selected_version_id") REFERENCES "scene_versions" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "scenes_project_idx" ON "scenes" ("project_id");

CREATE INDEX "scenes_selected_idx" ON "scenes" ("selected_version_id");

CREATE TABLE "settings" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value_json" TEXT NOT NULL CHECK ("value_json" IS NULL OR json_valid("value_json"))
) STRICT;

CREATE TABLE "stage_states" (
  "project_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL CHECK ("stage" IN ('intake','brief','plan','produce','edit','review','export')),
  "status" TEXT NOT NULL CHECK ("status" IN ('locked','todo','in_progress','needs_approval','approved','failed')),
  "approved_plan_id" TEXT,
  "approved_revision" INTEGER CHECK ("approved_revision" IS NULL OR (typeof("approved_revision")='integer' AND "approved_revision" >= 0 AND "approved_revision" <= 9007199254740991)),
  "approved_at" TEXT,
  "note" TEXT,
  PRIMARY KEY ("project_id","stage"),
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("approved_plan_id") REFERENCES "plans" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE INDEX "stages_status_idx" ON "stage_states" ("status");

CREATE INDEX "stages_plan_idx" ON "stage_states" ("approved_plan_id");


CREATE TRIGGER approved_plan_immutable BEFORE UPDATE ON plans WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'approved plan is immutable'); END;
CREATE TRIGGER selected_version_guard BEFORE UPDATE OF selected_version_id ON scenes WHEN NEW.selected_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scene_versions WHERE id=NEW.selected_version_id AND scene_id=NEW.id AND status='succeeded') BEGIN SELECT RAISE(ABORT,'selected version must belong to scene and be succeeded'); END;
CREATE TRIGGER selected_version_insert_guard BEFORE INSERT ON scenes WHEN NEW.selected_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scene_versions WHERE id=NEW.selected_version_id AND scene_id=NEW.id AND status='succeeded') BEGIN SELECT RAISE(ABORT,'selected version must belong to scene and be succeeded'); END;
CREATE TRIGGER approved_project_plan_guard BEFORE UPDATE OF approved_plan_id ON projects WHEN NEW.approved_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id=NEW.approved_plan_id AND project_id=NEW.id AND status='approved') BEGIN SELECT RAISE(ABORT,'approved plan must belong to project'); END;
CREATE TRIGGER asset_file_immutable BEFORE UPDATE OF file_path,sha256,size_bytes,mime ON assets WHEN NEW.file_path IS NOT OLD.file_path OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.mime IS NOT OLD.mime BEGIN SELECT RAISE(ABORT,'asset file is immutable'); END;
CREATE TRIGGER completed_export_immutable BEFORE UPDATE ON exports WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT,'completed export is immutable'); END;
CREATE TRIGGER completed_version_immutable BEFORE UPDATE ON scene_versions WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT,'completed version is immutable'); END;

