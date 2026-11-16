-- P2-5C (T-137): render input envelope B (a v2 timeline with audioPlan 1) becomes writable. No column or table
-- changes; 0001-0008 and every stored row stay byte-identical. This step is the feature gate:
-- 1) Its journal entry makes an app built before it see this database (and any backup of it) as too new, so an app
--    that only knows the silent envelope refuses it at start/restore instead of misreading an envelope B row.
-- 2) A new render row is envelope A (no audioPlan: never a v2 timeline nor an AAC output; its other rules are the
--    0006/0007 ones, unchanged) or envelope B (a v2
--    timeline, audioPlan 1: mode none = silent output and no sound clips, mode mix = AAC output, the fixed mix
--    profile and at least one sound clip). Every comparison is IS / COALESCE, so a missing value never turns the
--    condition into NULL (a NULL WHEN would let the row through). The full row check (lib/db/render-data.ts) reads
--    every row again after this step and on every restore.
CREATE TRIGGER render_input_envelope_guard BEFORE INSERT ON renders
WHEN NOT COALESCE((
  (json_type(NEW.input_json,'$.audioPlan') IS NULL AND json_extract(NEW.input_json,'$.timeline.schemaVersion') IS NOT 2
    AND json_extract(NEW.input_json,'$.output.audio') IS NOT 'aac')
  OR (json_type(NEW.input_json,'$.audioPlan') IS 'object' AND json_extract(NEW.input_json,'$.timeline.schemaVersion') IS 2
    AND json_extract(NEW.input_json,'$.audioPlan.schemaVersion') IS 1 AND json_type(NEW.input_json,'$.timeline.audio') IS 'array'
    AND ((json_extract(NEW.input_json,'$.audioPlan.mode') IS 'none' AND json_extract(NEW.input_json,'$.output.audio') IS 'none'
          AND json_array_length(NEW.input_json,'$.timeline.audio') IS 0)
      OR (json_extract(NEW.input_json,'$.audioPlan.mode') IS 'mix' AND json_extract(NEW.input_json,'$.output.audio') IS 'aac'
          AND json_extract(NEW.input_json,'$.audioPlan.profile') IS 'p2-5-local-v1'
          AND COALESCE(json_array_length(NEW.input_json,'$.timeline.audio'),0) >= 1
          AND json_type(NEW.input_json,'$.audioPlan.sources') IS 'array'
          AND COALESCE(json_array_length(NEW.input_json,'$.audioPlan.sources'),0) >= 1)))
),0)
BEGIN SELECT RAISE(ABORT,'render input envelope differs'); END;
