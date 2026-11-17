-- Cloud schema v1: new empty database only; never run against the SQLite journal.
-- Auth users must already exist. Application UUIDs are supplied by the service.
-- No login/credential or Supabase project is created by this migration.
BEGIN;
CREATE SCHEMA dream;
REVOKE ALL ON SCHEMA dream FROM PUBLIC;
CREATE DOMAIN dream.safe_uint AS bigint CHECK (VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN dream.safe_positive AS bigint CHECK (VALUE BETWEEN 1 AND 9007199254740991);
CREATE DOMAIN dream.sha256 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE FUNCTION dream.valid_object_key(value text, owner uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
 SELECT value LIKE owner::text || '/%' AND value !~ '(^|/)[.]{1,2}(/|$)'
   AND value !~ '(^/|//|/$|:)' AND position(chr(92) in value)=0
$$;

CREATE TABLE dream.activity_log (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail_json" TEXT NOT NULL CHECK ("detail_json" IS NULL OR "detail_json"::jsonb IS NOT NULL),
  "created_at" timestamptz NOT NULL,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.assets (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('image','video','audio','text','doc','link')),
  "title" TEXT NOT NULL,
  "source_url" TEXT,
  "rights_note" TEXT,
  "role" TEXT NOT NULL CHECK ("role" IN ('original','intermediate','selected','final')),
  "file_path" TEXT,
  CHECK (file_path IS NULL OR dream.valid_object_key(file_path,owner_id)), 
  "mime" TEXT,
  "size_bytes" bigint CHECK ("size_bytes" IS NULL OR ("size_bytes" >= 0 AND "size_bytes" <= 9007199254740991)),
  "sha256" dream.sha256,
  "width" bigint CHECK ("width" IS NULL OR ("width" >= 1 AND "width" <= 9007199254740991)),
  "height" bigint CHECK ("height" IS NULL OR ("height" >= 1 AND "height" <= 9007199254740991)),
  "duration_ms" bigint CHECK ("duration_ms" IS NULL OR ("duration_ms" >= 0 AND "duration_ms" <= 9007199254740991)),
  "origin" TEXT NOT NULL CHECK ("origin" IN ('upload','link','generated','render','import')),
  "generation_id" uuid,
  "is_mock" bigint NOT NULL DEFAULT 0 CHECK ("is_mock" IS NULL OR ("is_mock" >= 0 AND "is_mock" <= 9007199254740991)) CHECK ("is_mock" IN (0,1)),
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  CHECK ((kind = 'link' AND file_path IS NULL AND source_url IS NOT NULL) OR (kind <> 'link' AND file_path IS NOT NULL AND mime IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)),
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.backups (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('auto','manual')),
  "path" TEXT NOT NULL,
  "db_sha256" dream.sha256,
  "file_inventory_sha256" dream.sha256,
  "status" TEXT NOT NULL CHECK ("status" IN ('running','succeeded','failed')),
  "error" TEXT,
  "created_at" timestamptz NOT NULL,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.characters (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "locked_json" TEXT NOT NULL CHECK ("locked_json" IS NULL OR "locked_json"::jsonb IS NOT NULL),
  "ref_asset_ids_json" TEXT NOT NULL CHECK ("ref_asset_ids_json" IS NULL OR "ref_asset_ids_json"::jsonb IS NOT NULL),
  "voice_profile_json" TEXT NOT NULL CHECK ("voice_profile_json" IS NULL OR "voice_profile_json"::jsonb IS NOT NULL),
  "status" TEXT NOT NULL CHECK ("status" IN ('confirmed','unconfirmed')),
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.exports (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "content_revision" bigint NOT NULL CHECK ("content_revision" IS NULL OR ("content_revision" >= 1 AND "content_revision" <= 9007199254740991)),
  "status" TEXT NOT NULL CHECK ("status" IN ('running','succeeded','failed')),
  "file_path" TEXT,
  CHECK (file_path IS NULL OR dream.valid_object_key(file_path,owner_id)), 
  "manifest_version" bigint NOT NULL DEFAULT 1 CHECK ("manifest_version" IS NULL OR ("manifest_version" >= 1 AND "manifest_version" <= 9007199254740991)),
  "manifest_json" TEXT CHECK ("manifest_json" IS NULL OR "manifest_json"::jsonb IS NOT NULL),
  "sha256" dream.sha256,
  "error" TEXT,
  "created_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  CHECK (status <> 'succeeded' OR (file_path IS NOT NULL AND manifest_json IS NOT NULL AND sha256 IS NOT NULL AND completed_at IS NOT NULL)),
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.generations (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "job_id" uuid NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "params_json" TEXT NOT NULL CHECK ("params_json" IS NULL OR "params_json"::jsonb IS NOT NULL),
  "reference_snapshot_json" TEXT NOT NULL CHECK ("reference_snapshot_json" IS NULL OR "reference_snapshot_json"::jsonb IS NOT NULL),
  "seed" bigint CHECK ("seed" IS NULL OR ("seed" >= 0 AND "seed" <= 9007199254740991)),
  "cost_estimate_micros" bigint NOT NULL DEFAULT 0 CHECK ("cost_estimate_micros" IS NULL OR ("cost_estimate_micros" >= 0 AND "cost_estimate_micros" <= 9007199254740991)),
  "cost_actual_micros" bigint CHECK ("cost_actual_micros" IS NULL OR ("cost_actual_micros" >= 0 AND "cost_actual_micros" <= 9007199254740991)),
  "currency" TEXT NOT NULL,
  "settlement" TEXT NOT NULL CHECK ("settlement" IN ('none','reserved','settled','refunded')),
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.jobs (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL,
  "payload_version" bigint NOT NULL DEFAULT 1 CHECK ("payload_version" IS NULL OR ("payload_version" >= 1 AND "payload_version" <= 9007199254740991)),
  "input_snapshot_json" TEXT NOT NULL CHECK ("input_snapshot_json" IS NULL OR "input_snapshot_json"::jsonb IS NOT NULL),
  "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','succeeded','failed','canceled')),
  "project_id" uuid,
  "ref_type" TEXT NOT NULL,
  "ref_id" uuid NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_job_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "attempts" bigint NOT NULL DEFAULT 0 CHECK ("attempts" IS NULL OR ("attempts" >= 0 AND "attempts" <= 9007199254740991)),
  "max_attempts" bigint NOT NULL DEFAULT 3 CHECK ("max_attempts" IS NULL OR ("max_attempts" >= 1 AND "max_attempts" <= 9007199254740991)),
  "next_run_at" timestamptz,
  "lease_until" timestamptz,
  "heartbeat_at" timestamptz,
  "cancel_requested_at" timestamptz,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.plans (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "version" bigint NOT NULL CHECK ("version" IS NULL OR ("version" >= 1 AND "version" <= 9007199254740991)),
  "steps_json" TEXT NOT NULL CHECK ("steps_json" IS NULL OR "steps_json"::jsonb IS NOT NULL),
  "script" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('draft','approved')),
  "approved_scene_snapshot_json" TEXT CHECK ("approved_scene_snapshot_json" IS NULL OR "approved_scene_snapshot_json"::jsonb IS NOT NULL),
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_scene_snapshot_json IS NOT NULL)),
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.project_assets (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
"project_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "purpose" TEXT NOT NULL,
  PRIMARY KEY (owner_id,"project_id","asset_id","purpose")
);

CREATE TABLE dream.project_characters (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
"project_id" uuid NOT NULL,
  "character_id" uuid NOT NULL,
  PRIMARY KEY (owner_id,"project_id","character_id")
);

CREATE TABLE dream.projects (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "menu_id" TEXT NOT NULL,
  "template_version" TEXT NOT NULL,
  "template_snapshot_json" TEXT NOT NULL CHECK ("template_snapshot_json" IS NULL OR "template_snapshot_json"::jsonb IS NOT NULL),
  "inputs_json" TEXT NOT NULL CHECK ("inputs_json" IS NULL OR "inputs_json"::jsonb IS NOT NULL),
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "aspect" TEXT NOT NULL CHECK ("aspect" IN ('9:16','16:9','1:1')),
  "length_sec" bigint NOT NULL CHECK ("length_sec" IS NULL OR ("length_sec" >= 1 AND "length_sec" <= 9007199254740991)),
  "approved_plan_id" uuid,
  "content_revision" bigint NOT NULL DEFAULT 1 CHECK ("content_revision" IS NULL OR ("content_revision" >= 1 AND "content_revision" <= 9007199254740991)),
  "current_timeline_rev_id" uuid,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.review_items (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "content_revision" bigint NOT NULL CHECK ("content_revision" IS NULL OR ("content_revision" >= 1 AND "content_revision" <= 9007199254740991)),
  "template_item_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "source" TEXT NOT NULL CHECK ("source" IN ('common','menu','conditional','custom')),
  "required" bigint NOT NULL CHECK ("required" IS NULL OR ("required" >= 0 AND "required" <= 9007199254740991)) CHECK ("required" IN (0,1)),
  "status" TEXT NOT NULL CHECK ("status" IN ('unchecked','pass','hold')),
  "note" TEXT,
  "checked_at" timestamptz,
  CHECK (status <> 'hold' OR length(trim(coalesce(note,''))) > 0),
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.scene_versions (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "scene_id" uuid NOT NULL,
  "version" bigint NOT NULL CHECK ("version" IS NULL OR ("version" >= 1 AND "version" <= 9007199254740991)),
  "plan_id" uuid NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('image','video','speech')),
  "input_snapshot_json" TEXT NOT NULL CHECK ("input_snapshot_json" IS NULL OR "input_snapshot_json"::jsonb IS NOT NULL),
  "job_id" uuid,
  "generation_id" uuid,
  "result_asset_id" uuid,
  "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','succeeded','failed','canceled')),
  "created_at" timestamptz NOT NULL,
  CHECK (status <> 'succeeded' OR result_asset_id IS NOT NULL),
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.scenes (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "position" bigint NOT NULL CHECK ("position" IS NULL OR ("position" >= 0 AND "position" <= 9007199254740991)),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "dialogue_json" TEXT NOT NULL CHECK ("dialogue_json" IS NULL OR "dialogue_json"::jsonb IS NOT NULL),
  "character_ids_json" TEXT NOT NULL CHECK ("character_ids_json" IS NULL OR "character_ids_json"::jsonb IS NOT NULL),
  "duration_sec" bigint NOT NULL CHECK ("duration_sec" IS NULL OR ("duration_sec" >= 1 AND "duration_sec" <= 9007199254740991)),
  "needs_recheck" bigint NOT NULL DEFAULT 0 CHECK ("needs_recheck" IS NULL OR ("needs_recheck" >= 0 AND "needs_recheck" <= 9007199254740991)) CHECK ("needs_recheck" IN (0,1)),
  "selected_version_id" uuid,
  "archived_at" timestamptz,
  UNIQUE (owner_id,id)
);

CREATE TABLE dream.settings (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
"key" TEXT NOT NULL,
  "value_json" TEXT NOT NULL CHECK ("value_json" IS NULL OR "value_json"::jsonb IS NOT NULL),
  PRIMARY KEY (owner_id,key)
);

CREATE TABLE dream.stage_states (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
"project_id" uuid NOT NULL,
  "stage" TEXT NOT NULL CHECK ("stage" IN ('intake','brief','plan','produce','edit','review','export')),
  "status" TEXT NOT NULL CHECK ("status" IN ('locked','todo','in_progress','needs_approval','approved','failed')),
  "approved_plan_id" uuid,
  "approved_revision" bigint CHECK ("approved_revision" IS NULL OR ("approved_revision" >= 0 AND "approved_revision" <= 9007199254740991)),
  "approved_at" timestamptz,
  "note" TEXT,
  PRIMARY KEY (owner_id,"project_id","stage")
);

CREATE TABLE dream.timeline_revisions (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 id uuid PRIMARY KEY, project_id uuid NOT NULL, revision dream.safe_positive NOT NULL,
 content_revision dream.safe_positive NOT NULL, timeline_json text NOT NULL CHECK (timeline_json::jsonb IS NOT NULL),
 timeline_sha256 dream.sha256 NOT NULL, source text NOT NULL CHECK (source IN ('p1-migration','user','restore-version')),
 restored_from_id uuid, migrated_from_key text, created_at timestamptz NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,project_id,revision),
 CHECK ((source='restore-version')=(restored_from_id IS NOT NULL)),
 CHECK ((source='p1-migration')=(migrated_from_key IS NOT NULL)),
 FOREIGN KEY(owner_id,project_id) REFERENCES dream.projects(owner_id,id),
 FOREIGN KEY(owner_id,restored_from_id) REFERENCES dream.timeline_revisions(owner_id,id)
);
CREATE TABLE dream.renders (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 id uuid PRIMARY KEY, project_id uuid NOT NULL, job_id uuid NOT NULL UNIQUE, timeline_rev_id uuid NOT NULL,
 timeline_revision dream.safe_positive NOT NULL, content_revision dream.safe_positive NOT NULL,
 input_json text NOT NULL CHECK (jsonb_typeof(input_json::jsonb)='object'), input_sha256 dream.sha256 NOT NULL,
 status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','canceled')),
 stage text CHECK (stage IN ('prepare','compose','verify')),
 progress_permille integer NOT NULL DEFAULT 0 CHECK (progress_permille BETWEEN 0 AND 1000),
 frames_total dream.safe_positive NOT NULL, frames_done dream.safe_uint NOT NULL DEFAULT 0 CHECK (frames_done<=frames_total),
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 5 AND 120 AND display_name LIKE '%.mp4'
   AND display_name !~ '[/\:*?"<>|]' AND position(chr(92) in display_name)=0),
 name_seq dream.safe_positive NOT NULL, is_sample smallint NOT NULL CHECK(is_sample IN (0,1)),
 file_path text UNIQUE, sha256 dream.sha256, size_bytes dream.safe_positive,
 verify_json text CHECK (jsonb_typeof(verify_json::jsonb)='object'),
 canceled_late smallint NOT NULL DEFAULT 0 CHECK(canceled_late IN(0,1)),
 cleanup_left_json text CHECK (jsonb_typeof(cleanup_left_json::jsonb)='array'),
 error_code text, error_message text, created_at timestamptz NOT NULL, started_at timestamptz, finished_at timestamptz,
 UNIQUE(owner_id,id), UNIQUE(owner_id,project_id,timeline_rev_id,name_seq),
 FOREIGN KEY(owner_id,project_id) REFERENCES dream.projects(owner_id,id),
 FOREIGN KEY(owner_id,job_id) REFERENCES dream.jobs(owner_id,id),
 FOREIGN KEY(owner_id,timeline_rev_id) REFERENCES dream.timeline_revisions(owner_id,id),
 CHECK ((file_path IS NULL AND sha256 IS NULL AND size_bytes IS NULL) OR
   (file_path IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL AND verify_json IS NOT NULL
     AND file_path=owner_id::text || '/' || project_id::text || '/' || id::text || '.mp4')),
 CHECK (status<>'succeeded' OR (file_path IS NOT NULL AND canceled_late=0 AND error_code IS NULL)),
 CHECK (canceled_late=0 OR (status='canceled' AND file_path IS NOT NULL)),
 CHECK (file_path IS NULL OR status='succeeded' OR canceled_late=1),
 CHECK (status<>'failed' OR error_code IS NOT NULL),
 CHECK ((status IN ('queued','running'))=(finished_at IS NULL))
);
CREATE UNIQUE INDEX renders_one_active ON dream.renders(owner_id,project_id) WHERE status IN ('queued','running');
CREATE INDEX renders_project_idx ON dream.renders(owner_id,project_id,created_at);
CREATE INDEX renders_timeline_idx ON dream.renders(owner_id,timeline_rev_id);
CREATE INDEX timeline_revisions_project_idx ON dream.timeline_revisions(owner_id,project_id,revision);

ALTER TABLE dream.activity_log ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.assets ADD FOREIGN KEY (owner_id, "generation_id") REFERENCES dream.generations(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.exports ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.generations ADD FOREIGN KEY (owner_id, "job_id") REFERENCES dream.jobs(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.jobs ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.plans ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.project_assets ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.project_assets ADD FOREIGN KEY (owner_id, "asset_id") REFERENCES dream.assets(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.project_characters ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.project_characters ADD FOREIGN KEY (owner_id, "character_id") REFERENCES dream.characters(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.projects ADD FOREIGN KEY (owner_id, "approved_plan_id") REFERENCES dream.plans(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.review_items ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scene_versions ADD FOREIGN KEY (owner_id, "scene_id") REFERENCES dream.scenes(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scene_versions ADD FOREIGN KEY (owner_id, "plan_id") REFERENCES dream.plans(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scene_versions ADD FOREIGN KEY (owner_id, "job_id") REFERENCES dream.jobs(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scene_versions ADD FOREIGN KEY (owner_id, "generation_id") REFERENCES dream.generations(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scene_versions ADD FOREIGN KEY (owner_id, "result_asset_id") REFERENCES dream.assets(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scenes ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.scenes ADD FOREIGN KEY (owner_id, "selected_version_id") REFERENCES dream.scene_versions(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.stage_states ADD FOREIGN KEY (owner_id, "project_id") REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.stage_states ADD FOREIGN KEY (owner_id, "approved_plan_id") REFERENCES dream.plans(owner_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE dream.projects ADD FOREIGN KEY (owner_id,current_timeline_rev_id) REFERENCES dream.timeline_revisions(owner_id,id);
CREATE INDEX "activity_project_idx" ON dream.activity_log(owner_id,"project_id");
CREATE INDEX "assets_kind_idx" ON dream.assets(owner_id,"kind");
CREATE INDEX "assets_generation_idx" ON dream.assets(owner_id,"generation_id");
CREATE INDEX "backups_status_idx" ON dream.backups(owner_id,"status");
CREATE INDEX "characters_status_idx" ON dream.characters(owner_id,"status");
CREATE INDEX "exports_project_idx" ON dream.exports(owner_id,"project_id");
CREATE INDEX "exports_status_idx" ON dream.exports(owner_id,"status");
CREATE INDEX "generations_job_idx" ON dream.generations(owner_id,"job_id");
CREATE INDEX "generations_settlement_idx" ON dream.generations(owner_id,"settlement");
CREATE UNIQUE INDEX "jobs_idempotency_key" ON dream.jobs(owner_id,"idempotency_key");
CREATE INDEX "jobs_claim_idx" ON dream.jobs(owner_id,"status","next_run_at");
CREATE INDEX "jobs_project_idx" ON dream.jobs(owner_id,"project_id");
CREATE UNIQUE INDEX "plans_project_version" ON dream.plans(owner_id,"project_id","version");
CREATE INDEX "plans_status_idx" ON dream.plans(owner_id,"status");
CREATE INDEX "project_assets_asset_idx" ON dream.project_assets(owner_id,"asset_id");
CREATE INDEX "project_characters_character_idx" ON dream.project_characters(owner_id,"character_id");
CREATE INDEX "projects_menu_idx" ON dream.projects(owner_id,"menu_id");
CREATE INDEX "projects_plan_idx" ON dream.projects(owner_id,"approved_plan_id");
CREATE UNIQUE INDEX "review_project_revision_item" ON dream.review_items(owner_id,"project_id","content_revision","template_item_id");
CREATE INDEX "review_status_idx" ON dream.review_items(owner_id,"status");
CREATE UNIQUE INDEX "scene_versions_scene_version" ON dream.scene_versions(owner_id,"scene_id","version");
CREATE INDEX "versions_plan_idx" ON dream.scene_versions(owner_id,"plan_id");
CREATE INDEX "versions_job_idx" ON dream.scene_versions(owner_id,"job_id");
CREATE INDEX "versions_generation_idx" ON dream.scene_versions(owner_id,"generation_id");
CREATE INDEX "versions_asset_idx" ON dream.scene_versions(owner_id,"result_asset_id");
CREATE INDEX "versions_status_idx" ON dream.scene_versions(owner_id,"status");
CREATE INDEX "scenes_project_idx" ON dream.scenes(owner_id,"project_id");
CREATE INDEX "scenes_selected_idx" ON dream.scenes(owner_id,"selected_version_id");
CREATE INDEX "stages_status_idx" ON dream.stage_states(owner_id,"status");
CREATE INDEX "stages_plan_idx" ON dream.stage_states(owner_id,"approved_plan_id");
CREATE INDEX activity_log_owner_idx ON dream.activity_log(owner_id);
CREATE INDEX assets_owner_idx ON dream.assets(owner_id);
CREATE INDEX backups_owner_idx ON dream.backups(owner_id);
CREATE INDEX characters_owner_idx ON dream.characters(owner_id);
CREATE INDEX exports_owner_idx ON dream.exports(owner_id);
CREATE INDEX generations_owner_idx ON dream.generations(owner_id);
CREATE INDEX jobs_owner_idx ON dream.jobs(owner_id);
CREATE INDEX plans_owner_idx ON dream.plans(owner_id);
CREATE INDEX project_assets_owner_idx ON dream.project_assets(owner_id);
CREATE INDEX project_characters_owner_idx ON dream.project_characters(owner_id);
CREATE INDEX projects_owner_idx ON dream.projects(owner_id);
CREATE INDEX review_items_owner_idx ON dream.review_items(owner_id);
CREATE INDEX scene_versions_owner_idx ON dream.scene_versions(owner_id);
CREATE INDEX scenes_owner_idx ON dream.scenes(owner_id);
CREATE INDEX settings_owner_idx ON dream.settings(owner_id);
CREATE INDEX stage_states_owner_idx ON dream.stage_states(owner_id);
CREATE INDEX timeline_revisions_owner_idx ON dream.timeline_revisions(owner_id);
CREATE INDEX renders_owner_idx ON dream.renders(owner_id);
COMMIT;
