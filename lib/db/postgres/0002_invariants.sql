-- Database-level parity for historical ownership/immutability and writable envelopes.
-- Full timeline/render/manifest Zod validation and approval gates remain in services.
BEGIN;
CREATE FUNCTION dream.guard_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, dream AS $$
DECLARE old_row jsonb; new_row jsonb; x jsonb; valid boolean;
BEGIN
 IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' AND (new_row->'owner_id' IS DISTINCT FROM old_row->'owner_id'
   OR new_row->'id' IS DISTINCT FROM old_row->'id') THEN
   RAISE EXCEPTION 'row identity is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP <> 'INSERT' THEN
   IF TG_TABLE_NAME IN ('timeline_revisions','activity_log')
     OR (TG_TABLE_NAME='plans' AND old_row->>'status'='approved')
     OR (TG_TABLE_NAME IN ('exports','backups','scene_versions') AND old_row->>'status'='succeeded')
     OR (TG_TABLE_NAME='renders' AND TG_OP='DELETE') THEN
     RAISE EXCEPTION 'history is immutable' USING ERRCODE='23514';
   END IF;
   IF TG_TABLE_NAME='settings' AND ((old_row->>'key' LIKE 'project.%.edit.%' AND old_row->>'key' NOT LIKE '%.current')
     OR old_row->>'key' LIKE 'backup.%.meta') THEN
     RAISE EXCEPTION 'snapshot metadata is immutable' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='assets' AND
     (new_row - ARRAY['title','source_url','rights_note','role','archived_at']) IS DISTINCT FROM
     (old_row - ARRAY['title','source_url','rights_note','role','archived_at']) THEN
     RAISE EXCEPTION 'asset identity and file are immutable' USING ERRCODE='23514';
   ELSIF TG_TABLE_NAME='generations' AND
     (new_row - ARRAY['cost_actual_micros','settlement','finished_at']) IS DISTINCT FROM
     (old_row - ARRAY['cost_actual_micros','settlement','finished_at']) THEN
     RAISE EXCEPTION 'generation inputs are immutable' USING ERRCODE='23514';
   ELSIF TG_TABLE_NAME='projects' AND (new_row->>'content_revision')::bigint<(old_row->>'content_revision')::bigint THEN
     RAISE EXCEPTION 'content revision cannot decrease' USING ERRCODE='23514';
   ELSIF TG_TABLE_NAME='jobs' AND EXISTS (SELECT 1 FROM dream.renders WHERE job_id=(old_row->>'id')::uuid AND owner_id=OLD.owner_id)
     AND (new_row->'kind' IS DISTINCT FROM old_row->'kind' OR new_row->'ref_type' IS DISTINCT FROM old_row->'ref_type'
       OR new_row->'ref_id' IS DISTINCT FROM old_row->'ref_id' OR new_row->'project_id' IS DISTINCT FROM old_row->'project_id') THEN
     RAISE EXCEPTION 'render job identity is immutable' USING ERRCODE='23514';
   END IF;
 END IF;

 IF TG_TABLE_NAME='projects' THEN
   IF NEW.approved_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dream.plans p
     WHERE p.owner_id=NEW.owner_id AND p.id=NEW.approved_plan_id AND p.project_id=NEW.id AND p.status='approved') THEN
     RAISE EXCEPTION 'approved plan must belong to project' USING ERRCODE='23514';
   END IF;
   IF NEW.current_timeline_rev_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dream.timeline_revisions t
     WHERE t.owner_id=NEW.owner_id AND t.id=NEW.current_timeline_rev_id AND t.project_id=NEW.id) THEN
     RAISE EXCEPTION 'timeline pointer must belong to project' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='stage_states' AND new_row->>'approved_plan_id' IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM dream.plans p WHERE p.owner_id=NEW.owner_id AND p.id=NEW.approved_plan_id
     AND p.project_id=NEW.project_id AND p.status='approved') THEN
     RAISE EXCEPTION 'stage plan must belong to project' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='scenes' AND new_row->>'selected_version_id' IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM dream.scene_versions v WHERE v.owner_id=NEW.owner_id
     AND v.id=NEW.selected_version_id AND v.scene_id=NEW.id AND v.status='succeeded') THEN
     RAISE EXCEPTION 'selected version must be succeeded and belong to scene' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='scene_versions' THEN
   IF NOT EXISTS (SELECT 1 FROM dream.scenes s JOIN dream.plans p ON p.owner_id=s.owner_id AND p.project_id=s.project_id
     WHERE s.owner_id=NEW.owner_id AND s.id=NEW.scene_id AND p.id=NEW.plan_id) THEN
     RAISE EXCEPTION 'scene and plan must belong to same project' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='generations' AND new_row->>'currency' !~ '^[A-Z]{3}$' THEN
   RAISE EXCEPTION 'currency must be three uppercase letters' USING ERRCODE='23514';
 ELSIF TG_TABLE_NAME='timeline_revisions' THEN
   x := NEW.timeline_json::jsonb;
   valid := (x->'schemaVersion'='1'::jsonb AND x->'audio'='[]'::jsonb)
     OR (x->'schemaVersion'='2'::jsonb AND x->>'audioMixProfile'='p2-5-local-v1'
       AND jsonb_typeof(x->'audio')='array' AND jsonb_typeof(x->'audioJoins')='array' AND jsonb_typeof(x->'audioRights')='array');
   IF valid IS NOT TRUE OR encode(sha256(convert_to(NEW.timeline_json,'UTF8')),'hex')<>NEW.timeline_sha256 THEN
     RAISE EXCEPTION 'timeline schema or raw hash differs' USING ERRCODE='23514';
   END IF;
   IF NEW.restored_from_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dream.timeline_revisions t
     WHERE t.owner_id=NEW.owner_id AND t.id=NEW.restored_from_id AND t.project_id=NEW.project_id) THEN
     RAISE EXCEPTION 'restored revision must belong to project' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='exports' THEN
   valid := NEW.manifest_version IN (1,2) AND
     ((NEW.manifest_json IS NULL AND NEW.status<>'succeeded' AND NEW.manifest_version=1)
      OR (NEW.manifest_json IS NOT NULL AND jsonb_typeof(NEW.manifest_json::jsonb)='object'));
   IF NEW.manifest_json IS NOT NULL THEN
     x := NEW.manifest_json::jsonb;
     valid := valid AND x->'manifestVersion'=to_jsonb(NEW.manifest_version) AND x->>'kind'='editing-bundle'
       AND x#>>'{project,id}'=NEW.project_id::text AND x->'contentRevision'=to_jsonb(NEW.content_revision)
       AND jsonb_typeof(x->'files')='array';
     IF jsonb_typeof(x->'files')='array' THEN valid := valid AND jsonb_array_length(x->'files')>=1; END IF;
     valid := valid AND ((NEW.manifest_version=1 AND NOT x ? 'timeline')
       OR (NEW.manifest_version=2 AND jsonb_typeof(x->'timeline')='object'
         AND x#>'{timeline,schemaVersion}'='2'::jsonb AND x#>>'{timeline,audioMixProfile}'='p2-5-local-v1'));
   END IF;
   IF NEW.status='succeeded' THEN
     valid := valid AND NEW.file_path=NEW.owner_id::text || '/' || NEW.project_id::text || '/' || NEW.id::text || '.zip';
   END IF;
   IF valid IS NOT TRUE THEN RAISE EXCEPTION 'export manifest differs' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='renders' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.status<>'queued' OR NEW.file_path IS NOT NULL OR NEW.verify_json IS NOT NULL OR NEW.canceled_late<>0
       OR NEW.stage IS NOT NULL OR NEW.progress_permille<>0 OR NEW.frames_done<>0 OR NEW.started_at IS NOT NULL
       OR NEW.error_code IS NOT NULL OR NEW.cleanup_left_json IS NOT NULL THEN
       RAISE EXCEPTION 'render must start queued and empty' USING ERRCODE='23514';
     END IF;
     IF NOT EXISTS (SELECT 1 FROM dream.jobs j WHERE j.owner_id=NEW.owner_id AND j.id=NEW.job_id
       AND j.kind='render' AND j.ref_type='render' AND j.ref_id=NEW.id AND j.project_id=NEW.project_id) THEN
       RAISE EXCEPTION 'render job differs' USING ERRCODE='23514';
     END IF;
     IF NOT EXISTS (SELECT 1 FROM dream.timeline_revisions t WHERE t.owner_id=NEW.owner_id AND t.id=NEW.timeline_rev_id
       AND t.project_id=NEW.project_id AND t.revision=NEW.timeline_revision AND t.content_revision=NEW.content_revision) THEN
       RAISE EXCEPTION 'render timeline differs' USING ERRCODE='23514';
     END IF;
     x := NEW.input_json::jsonb;
     valid := x->'schemaVersion'='1'::jsonb AND x->>'projectId'=NEW.project_id::text
       AND x->>'timelineRevId'=NEW.timeline_rev_id::text AND x->'timelineRevision'=to_jsonb(NEW.timeline_revision)
       AND x->'contentRevision'=to_jsonb(NEW.content_revision);
     valid := valid AND ((NOT x ? 'audioPlan' AND x#>'{timeline,schemaVersion}' IS DISTINCT FROM '2'::jsonb
       AND x#>>'{output,audio}' IS DISTINCT FROM 'aac')
       OR (jsonb_typeof(x->'audioPlan')='object' AND x#>'{timeline,schemaVersion}'='2'::jsonb
         AND x#>'{audioPlan,schemaVersion}'='1'::jsonb AND jsonb_typeof(x#>'{timeline,audio}')='array'
         AND ((x#>>'{audioPlan,mode}'='none' AND x#>>'{output,audio}'='none' AND x#>'{timeline,audio}'='[]'::jsonb)
           OR (x#>>'{audioPlan,mode}'='mix' AND x#>>'{output,audio}'='aac'
             AND x#>>'{audioPlan,profile}'='p2-5-local-v1' AND jsonb_typeof(x#>'{audioPlan,sources}')='array'
             AND x#>'{timeline,audio}'<>'[]'::jsonb AND x#>'{audioPlan,sources}'<>'[]'::jsonb))));
     IF valid IS NOT TRUE OR encode(sha256(convert_to(NEW.input_json,'UTF8')),'hex')<>NEW.input_sha256 THEN
       RAISE EXCEPTION 'render envelope or raw hash differs' USING ERRCODE='23514';
     END IF;
   ELSE
     IF OLD.status IN ('succeeded','failed','canceled') AND
       new_row-'cleanup_left_json' IS DISTINCT FROM old_row-'cleanup_left_json' THEN
       RAISE EXCEPTION 'finished render is immutable' USING ERRCODE='23514';
     END IF;
     IF (new_row-ARRAY['status','stage','progress_permille','frames_done','file_path','sha256','size_bytes','verify_json',
       'canceled_late','cleanup_left_json','error_code','error_message','started_at','finished_at']) IS DISTINCT FROM
       (old_row-ARRAY['status','stage','progress_permille','frames_done','file_path','sha256','size_bytes','verify_json',
       'canceled_late','cleanup_left_json','error_code','error_message','started_at','finished_at']) THEN
       RAISE EXCEPTION 'render inputs are immutable' USING ERRCODE='23514';
     END IF;
     IF NEW.status<>OLD.status AND NOT ((OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
       OR (OLD.status='running' AND NEW.status IN ('queued','succeeded','failed','canceled'))) THEN
       RAISE EXCEPTION 'render status change not allowed' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['activity_log','assets','backups','characters','exports','generations','jobs','plans',
   'project_assets','project_characters','projects','review_items','scene_versions','scenes','settings','stage_states',
   'timeline_revisions','renders'] LOOP
   EXECUTE format('CREATE TRIGGER guard_row BEFORE INSERT OR UPDATE OR DELETE ON dream.%I FOR EACH ROW EXECUTE FUNCTION dream.guard_row()',t);
 END LOOP;
END $$;
COMMIT;
