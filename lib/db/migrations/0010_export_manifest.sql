-- P2-6 S2 (T-158): editing bundle manifest 2 (a bundle that carries the sound source files of a v2 timeline) becomes
-- writable. No column or table changes; 0001-0009 and every stored row stay byte-identical. This step is the feature gate:
-- 1) Its journal entry makes an app built before it (1..9) see this database, and any backup of it, as too new, so
--    such an app refuses it at start, backup inspection and restore instead of misreading a manifest 2 row.
-- 2) An export row may only hold manifest_version 1 or 2, and a row with a manifest must agree with it: the column
--    equals manifestVersion, kind is editing-bundle, the project and content revision are the row's, manifest 1 has
--    no timeline and manifest 2 has the v2 timeline with the fixed mix profile and at least one file. A row without a
--    manifest is not finished (status running or failed) and keeps manifest_version 1. A finished row has a 64-hex
--    sha256 and its fixed file path. Every comparison is IS / COALESCE, so a missing value never makes the condition
--    NULL (a NULL WHEN would let the row through). The full row check (lib/db/export-data.ts) reads every row again
--    after this step, after a live upgrade and on every restore; it does not rely on these triggers being present.
CREATE TRIGGER export_manifest_insert_guard BEFORE INSERT ON exports
WHEN NOT COALESCE((
  typeof(NEW.manifest_version) IS 'integer' AND NEW.manifest_version IN (1,2)
  AND ((NEW.manifest_json IS NULL AND NEW.status IS NOT 'succeeded' AND NEW.manifest_version IS 1)
    OR (NEW.manifest_json IS NOT NULL AND json_valid(NEW.manifest_json) IS 1
      AND json_extract(NEW.manifest_json,'$.manifestVersion') IS NEW.manifest_version
      AND json_type(NEW.manifest_json,'$.manifestVersion') IS 'integer'
      AND json_extract(NEW.manifest_json,'$.kind') IS 'editing-bundle'
      AND json_extract(NEW.manifest_json,'$.project.id') IS NEW.project_id
      AND json_extract(NEW.manifest_json,'$.contentRevision') IS NEW.content_revision
      AND COALESCE(json_array_length(NEW.manifest_json,'$.files'),0) >= 1
      AND ((NEW.manifest_version IS 1 AND json_type(NEW.manifest_json,'$.timeline') IS NULL)
        OR (NEW.manifest_version IS 2 AND json_type(NEW.manifest_json,'$.timeline') IS 'object'
          AND json_extract(NEW.manifest_json,'$.timeline.schemaVersion') IS 2
          AND json_extract(NEW.manifest_json,'$.timeline.audioMixProfile') IS 'p2-5-local-v1'))
      AND (NEW.status IS NOT 'succeeded' OR (length(NEW.sha256) IS 64 AND NEW.sha256 NOT GLOB '*[^0-9a-f]*'
        AND NEW.file_path IS 'projects/' || NEW.project_id || '/exports/' || NEW.id || '.zip'))))
),0)
BEGIN SELECT RAISE(ABORT,'export manifest differs'); END;
CREATE TRIGGER export_manifest_update_guard BEFORE UPDATE ON exports
WHEN NOT COALESCE((
  typeof(NEW.manifest_version) IS 'integer' AND NEW.manifest_version IN (1,2)
  AND ((NEW.manifest_json IS NULL AND NEW.status IS NOT 'succeeded' AND NEW.manifest_version IS 1)
    OR (NEW.manifest_json IS NOT NULL AND json_valid(NEW.manifest_json) IS 1
      AND json_extract(NEW.manifest_json,'$.manifestVersion') IS NEW.manifest_version
      AND json_type(NEW.manifest_json,'$.manifestVersion') IS 'integer'
      AND json_extract(NEW.manifest_json,'$.kind') IS 'editing-bundle'
      AND json_extract(NEW.manifest_json,'$.project.id') IS NEW.project_id
      AND json_extract(NEW.manifest_json,'$.contentRevision') IS NEW.content_revision
      AND COALESCE(json_array_length(NEW.manifest_json,'$.files'),0) >= 1
      AND ((NEW.manifest_version IS 1 AND json_type(NEW.manifest_json,'$.timeline') IS NULL)
        OR (NEW.manifest_version IS 2 AND json_type(NEW.manifest_json,'$.timeline') IS 'object'
          AND json_extract(NEW.manifest_json,'$.timeline.schemaVersion') IS 2
          AND json_extract(NEW.manifest_json,'$.timeline.audioMixProfile') IS 'p2-5-local-v1'))
      AND (NEW.status IS NOT 'succeeded' OR (length(NEW.sha256) IS 64 AND NEW.sha256 NOT GLOB '*[^0-9a-f]*'
        AND NEW.file_path IS 'projects/' || NEW.project_id || '/exports/' || NEW.id || '.zip'))))
),0)
BEGIN SELECT RAISE(ABORT,'export manifest differs'); END;
