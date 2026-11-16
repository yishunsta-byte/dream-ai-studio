-- P2-4a (T-105): one row per PC render request (T-101 2.6). Contract with jobs: the jobs row is inserted first
-- (kind 'render', ref_type 'render', ref_id = this id, same project), then this row with job_id = that job.
-- The row is tied to one saved timeline revision of the same project. Inputs are fixed at insert, rows are never
-- deleted, and a finished row (succeeded / failed / canceled) only accepts cleanup_left_json afterwards.
-- A file is kept only for a verified success or a verified result that finished after cancel (canceled_late = 1).
CREATE TABLE "renders" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL UNIQUE,
  "timeline_rev_id" TEXT NOT NULL,
  "timeline_revision" INTEGER NOT NULL CHECK (typeof("timeline_revision")='integer' AND "timeline_revision" >= 1),
  "content_revision" INTEGER NOT NULL CHECK (typeof("content_revision")='integer' AND "content_revision" >= 1),
  "input_json" TEXT NOT NULL CHECK (json_valid("input_json") AND json_type("input_json")='object'
    AND json_extract("input_json",'$.schemaVersion') IS 1 AND json_extract("input_json",'$.projectId') IS "project_id"
    AND json_extract("input_json",'$.timelineRevId') IS "timeline_rev_id" AND json_extract("input_json",'$.timelineRevision') IS "timeline_revision"
    AND json_extract("input_json",'$.contentRevision') IS "content_revision"),
  "input_sha256" TEXT NOT NULL CHECK (length("input_sha256")=64 AND "input_sha256" NOT GLOB '*[^0-9a-f]*'),
  "status" TEXT NOT NULL CHECK ("status" IN ('queued','running','succeeded','failed','canceled')),
  "stage" TEXT CHECK ("stage" IS NULL OR "stage" IN ('prepare','compose','verify')),
  "progress_permille" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("progress_permille")='integer' AND "progress_permille" BETWEEN 0 AND 1000),
  "frames_total" INTEGER NOT NULL CHECK (typeof("frames_total")='integer' AND "frames_total" >= 1),
  "frames_done" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("frames_done")='integer' AND "frames_done" >= 0 AND "frames_done" <= "frames_total"),
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 5 AND 120 AND "display_name" GLOB '?*.mp4' AND "display_name" NOT GLOB '*[/\:*?"<>|]*'),
  "name_seq" INTEGER NOT NULL CHECK (typeof("name_seq")='integer' AND "name_seq" >= 1),
  "is_sample" INTEGER NOT NULL CHECK ("is_sample" IN (0,1)),
  "file_path" TEXT UNIQUE,
  "sha256" TEXT,
  "size_bytes" INTEGER,
  "verify_json" TEXT CHECK ("verify_json" IS NULL OR (json_valid("verify_json") AND json_type("verify_json")='object')),
  "canceled_late" INTEGER NOT NULL DEFAULT 0 CHECK ("canceled_late" IN (0,1)),
  "cleanup_left_json" TEXT CHECK ("cleanup_left_json" IS NULL OR (json_valid("cleanup_left_json") AND json_type("cleanup_left_json")='array')),
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "started_at" TEXT,
  "finished_at" TEXT,
  -- File fields come together, at the one fixed relative path under storage/.
  CHECK (("file_path" IS NULL AND "sha256" IS NULL AND "size_bytes" IS NULL)
    OR ("file_path" = 'projects/' || "project_id" || '/renders/' || "id" || '.mp4'
      AND length("sha256")=64 AND "sha256" NOT GLOB '*[^0-9a-f]*'
      AND typeof("size_bytes")='integer' AND "size_bytes" >= 1 AND "verify_json" IS NOT NULL)),
  CHECK ("status" <> 'succeeded' OR ("file_path" IS NOT NULL AND "canceled_late" = 0 AND "error_code" IS NULL)),
  CHECK ("canceled_late" = 0 OR ("status" = 'canceled' AND "file_path" IS NOT NULL)),
  CHECK ("file_path" IS NULL OR "status" = 'succeeded' OR "canceled_late" = 1),
  CHECK ("status" <> 'failed' OR "error_code" IS NOT NULL),
  CHECK (("status" IN ('queued','running')) = ("finished_at" IS NULL)),
  UNIQUE ("project_id","timeline_rev_id","name_seq"),
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("timeline_rev_id") REFERENCES "timeline_revisions" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;
-- One render in progress per project (Master decision T-102 §12).
CREATE UNIQUE INDEX "renders_one_active" ON "renders" ("project_id") WHERE "status" IN ('queued','running');
CREATE INDEX "renders_project_idx" ON "renders" ("project_id","created_at");
CREATE INDEX "renders_timeline_idx" ON "renders" ("timeline_rev_id");
CREATE TRIGGER render_insert_guard BEFORE INSERT ON renders
WHEN NEW.status <> 'queued' OR NEW.file_path IS NOT NULL OR NEW.verify_json IS NOT NULL OR NEW.canceled_late <> 0 OR NEW.stage IS NOT NULL
  OR NEW.progress_permille <> 0 OR NEW.frames_done <> 0 OR NEW.started_at IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.cleanup_left_json IS NOT NULL
BEGIN SELECT RAISE(ABORT,'a render starts queued and empty'); END;
CREATE TRIGGER render_job_guard BEFORE INSERT ON renders
WHEN NOT EXISTS (SELECT 1 FROM jobs WHERE id=NEW.job_id AND kind='render' AND ref_type='render' AND ref_id=NEW.id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'render job differs'); END;
CREATE TRIGGER render_timeline_guard BEFORE INSERT ON renders
WHEN NOT EXISTS (SELECT 1 FROM timeline_revisions WHERE id=NEW.timeline_rev_id AND project_id=NEW.project_id AND revision=NEW.timeline_revision AND content_revision=NEW.content_revision)
BEGIN SELECT RAISE(ABORT,'render timeline differs'); END;
CREATE TRIGGER render_input_immutable BEFORE UPDATE ON renders
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.job_id IS NOT OLD.job_id OR NEW.timeline_rev_id IS NOT OLD.timeline_rev_id
  OR NEW.timeline_revision IS NOT OLD.timeline_revision OR NEW.content_revision IS NOT OLD.content_revision OR NEW.input_json IS NOT OLD.input_json
  OR NEW.input_sha256 IS NOT OLD.input_sha256 OR NEW.frames_total IS NOT OLD.frames_total OR NEW.display_name IS NOT OLD.display_name
  OR NEW.name_seq IS NOT OLD.name_seq OR NEW.is_sample IS NOT OLD.is_sample OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'render input is immutable'); END;
CREATE TRIGGER render_status_guard BEFORE UPDATE OF status ON renders
WHEN NEW.status IS NOT OLD.status AND NOT ((OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
  OR (OLD.status='running' AND NEW.status IN ('queued','succeeded','failed','canceled')))
BEGIN SELECT RAISE(ABORT,'render status change is not allowed'); END;
CREATE TRIGGER render_finished_immutable BEFORE UPDATE ON renders
WHEN OLD.status IN ('succeeded','failed','canceled') AND (NEW.status IS NOT OLD.status OR NEW.stage IS NOT OLD.stage
  OR NEW.progress_permille IS NOT OLD.progress_permille OR NEW.frames_done IS NOT OLD.frames_done OR NEW.file_path IS NOT OLD.file_path
  OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.verify_json IS NOT OLD.verify_json
  OR NEW.canceled_late IS NOT OLD.canceled_late OR NEW.error_code IS NOT OLD.error_code OR NEW.error_message IS NOT OLD.error_message
  OR NEW.started_at IS NOT OLD.started_at OR NEW.finished_at IS NOT OLD.finished_at)
BEGIN SELECT RAISE(ABORT,'finished render is immutable'); END;
CREATE TRIGGER render_delete_guard BEFORE DELETE ON renders
BEGIN SELECT RAISE(ABORT,'renders are never deleted'); END;
