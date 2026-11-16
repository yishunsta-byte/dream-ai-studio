-- P2-5A (T-132): timeline schemaVersion 2 (sound settings) becomes writable. No column or table changes; 0001-0007 and
-- every stored row stay byte-identical. This step is the feature gate:
-- 1) Its journal entry makes an app built before it see this database (and any backup of it) as too new, so an old
--    app that only knows timeline v1 refuses it at start/restore instead of failing on a v2 row later.
-- 2) New timeline rows must be v1 without sound or v2 with the fixed mix profile. Rows written before this step are
--    not rewritten; this step's data check (lib/db/timeline-data.ts checkTimelineRows) reads every row once.
CREATE TRIGGER timeline_revisions_schema_guard BEFORE INSERT ON timeline_revisions
WHEN NOT ((json_extract(NEW.timeline_json,'$.schemaVersion') IS 1 AND json_type(NEW.timeline_json,'$.audio') IS 'array'
    AND json_array_length(NEW.timeline_json,'$.audio') IS 0)
  OR (json_extract(NEW.timeline_json,'$.schemaVersion') IS 2 AND json_extract(NEW.timeline_json,'$.audioMixProfile') IS 'p2-5-local-v1'
    AND json_type(NEW.timeline_json,'$.audio') IS 'array' AND json_type(NEW.timeline_json,'$.audioJoins') IS 'array'
    AND json_type(NEW.timeline_json,'$.audioRights') IS 'array'))
BEGIN SELECT RAISE(ABORT,'timeline schema is not writable'); END;
