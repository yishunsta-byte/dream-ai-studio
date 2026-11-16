-- P2-4a (T-109, F107-1/F107-2): guards added after 0006 was issued. 0006 stays byte-identical; nothing is rebuilt.
-- 1) A job that a render row points to keeps its identity (kind, ref_type, ref_id, project_id) for its whole life.
--    Status, attempts, lease, cancel and finish fields stay writable (normal work and restore normalization).
-- 2) The file fields of a render (file_path, sha256, size_bytes) are all NULL or all present and well-formed with
--    verify_json, on every insert and update. 0006's CHECK lets a NULL slip through (a CHECK that is NULL passes).
-- Rows written under 0006 are checked by this step's data check (lib/db/render-data.ts) before it is recorded;
-- a row that breaks these rules stops the migration with its id and reason, and nothing is applied.
CREATE TRIGGER render_job_identity_guard BEFORE UPDATE OF kind,ref_type,ref_id,project_id ON jobs
WHEN (NEW.kind IS NOT OLD.kind OR NEW.ref_type IS NOT OLD.ref_type OR NEW.ref_id IS NOT OLD.ref_id OR NEW.project_id IS NOT OLD.project_id)
  AND EXISTS (SELECT 1 FROM renders WHERE job_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'render job identity is immutable'); END;
CREATE TRIGGER render_file_tuple_insert_guard BEFORE INSERT ON renders
WHEN NOT ((NEW.file_path IS NULL AND NEW.sha256 IS NULL AND NEW.size_bytes IS NULL)
  OR (NEW.file_path IS NOT NULL AND NEW.sha256 IS NOT NULL AND NEW.size_bytes IS NOT NULL AND NEW.verify_json IS NOT NULL
    AND NEW.file_path IS 'projects/' || NEW.project_id || '/renders/' || NEW.id || '.mp4'
    AND length(NEW.sha256) IS 64 AND NEW.sha256 NOT GLOB '*[^0-9a-f]*'
    AND typeof(NEW.size_bytes) IS 'integer' AND NEW.size_bytes >= 1))
BEGIN SELECT RAISE(ABORT,'render file fields are incomplete'); END;
CREATE TRIGGER render_file_tuple_update_guard BEFORE UPDATE ON renders
WHEN NOT ((NEW.file_path IS NULL AND NEW.sha256 IS NULL AND NEW.size_bytes IS NULL)
  OR (NEW.file_path IS NOT NULL AND NEW.sha256 IS NOT NULL AND NEW.size_bytes IS NOT NULL AND NEW.verify_json IS NOT NULL
    AND NEW.file_path IS 'projects/' || NEW.project_id || '/renders/' || NEW.id || '.mp4'
    AND length(NEW.sha256) IS 64 AND NEW.sha256 NOT GLOB '*[^0-9a-f]*'
    AND typeof(NEW.size_bytes) IS 'integer' AND NEW.size_bytes >= 1))
BEGIN SELECT RAISE(ABORT,'render file fields are incomplete'); END;
