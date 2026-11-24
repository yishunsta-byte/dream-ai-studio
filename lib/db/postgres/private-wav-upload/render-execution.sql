BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() <> 'dream_test_t367' OR current_setting('server_version_num')::int / 10000 <> 17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned', true) IS DISTINCT FROM 'on'
     OR to_regnamespace('local_render_request') IS NULL THEN
    RAISE EXCEPTION 'OWNED_RENDER_EXECUTION_TARGET';
  END IF;
END $$;
CREATE ROLE local_render_execute NOLOGIN;
GRANT USAGE ON SCHEMA dream, local_wav, local_render_request TO local_render_execute;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_render_execute;
GRANT USAGE ON DOMAIN dream.safe_positive, dream.sha256 TO local_render_execute;

CREATE TABLE local_render_request.outputs (
  owner_id uuid NOT NULL, job_id uuid NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 16777216),
  sha256 text GENERATED ALWAYS AS (encode(sha256(content),'hex')) STORED,
  size_bytes integer GENERATED ALWAYS AS (octet_length(content)) STORED,
  frames integer NOT NULL CHECK (frames > 0),
  verify_json jsonb NOT NULL CHECK (verify_json->>'result' = 'passed'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_id, job_id),
  FOREIGN KEY(owner_id, job_id) REFERENCES dream.jobs(owner_id, id)
);
ALTER TABLE local_render_request.outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_render_request.outputs FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON local_render_request.outputs TO local_render_execute;
CREATE POLICY local_render_output_select ON local_render_request.outputs FOR SELECT TO local_render_execute USING(owner_id = dream.actor_id());
CREATE POLICY local_render_output_insert ON local_render_request.outputs FOR INSERT TO local_render_execute WITH CHECK(owner_id = dream.actor_id());

GRANT SELECT(id,owner_id,menu_id,archived_at,aspect,content_revision,current_timeline_rev_id), UPDATE(id) ON dream.projects TO local_render_execute;
GRANT SELECT(owner_id,project_id,stage,status,approved_revision), UPDATE(stage) ON dream.stage_states TO local_render_execute;
GRANT SELECT(id,owner_id,project_id,selected_version_id,duration_sec,needs_recheck,archived_at), UPDATE(id) ON dream.scenes TO local_render_execute;
GRANT SELECT(id,owner_id,scene_id,kind,status,result_asset_id) ON dream.scene_versions TO local_render_execute;
GRANT SELECT(id,owner_id,archived_at,is_mock,kind,mime,file_path,sha256,size_bytes,duration_ms,width,height), UPDATE(id) ON dream.assets TO local_render_execute;
GRANT SELECT(owner_id,project_id,asset_id,purpose), UPDATE(asset_id) ON dream.project_assets TO local_render_execute;
GRANT SELECT(owner_id,asset_id,digest,size_bytes,duration_ms) ON local_wav.files TO local_render_execute;
GRANT SELECT(owner_id,asset_id,object_id,status,current_receipt_id), UPDATE(asset_id) ON dream.asset_receipt_state TO local_render_execute;
GRANT SELECT(owner_id,id,registered_asset_id,bucket,object_key,kind,mime,size_bytes,sha256,lifecycle,active_generation,identity_digest),
      UPDATE(id) ON dream.storage_objects TO local_render_execute;
GRANT SELECT(owner_id,id,object_id,asset_id,identity_digest,generation,operation_id,policy_id,policy_epoch,policy_digest,verified_at,not_after,width,height)
  ON dream.storage_verification_receipts TO local_render_execute;
GRANT SELECT(owner_id,id,object_id,generation,terminal_receipt_id,status) ON dream.storage_verification_operations TO local_render_execute;
GRANT SELECT(policy_id,epoch,digest), UPDATE(epoch) ON dream.storage_policies TO local_render_execute;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['projects','stage_states','scenes','scene_versions','assets','project_assets',
    'asset_receipt_state','storage_objects','storage_verification_receipts','storage_verification_operations'] LOOP
    EXECUTE format('CREATE POLICY local_render_execute_read ON dream.%I FOR SELECT TO local_render_execute
      USING (owner_id = dream.actor_id())', tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['projects','stage_states','scenes','assets','project_assets','asset_receipt_state','storage_objects'] LOOP
    EXECUTE format('CREATE POLICY local_render_execute_lock ON dream.%I FOR UPDATE TO local_render_execute
      USING (owner_id = dream.actor_id()) WITH CHECK (false)', tab);
  END LOOP;
END $$;
CREATE POLICY local_render_execute_read ON local_wav.files FOR SELECT TO local_render_execute USING(owner_id = dream.actor_id());
CREATE POLICY local_render_execute_policy ON dream.storage_policies FOR SELECT TO local_render_execute USING(policy_id = 't367-local-png');
CREATE POLICY local_render_execute_policy_lock ON dream.storage_policies FOR UPDATE TO local_render_execute
  USING(policy_id = 't367-local-png') WITH CHECK(false);

GRANT SELECT(owner_id,id,project_id,kind,status,input_snapshot_json,attempts,max_attempts,lease_until),
      UPDATE(status,attempts,lease_until,updated_at,finished_at,error_code)
  ON dream.jobs TO local_render_execute;
CREATE POLICY local_render_execute_job_read ON dream.jobs FOR SELECT TO local_render_execute
  USING(owner_id = dream.actor_id() AND kind = 'render-prepare');
CREATE POLICY local_render_execute_job_update ON dream.jobs FOR UPDATE TO local_render_execute
  USING(owner_id = dream.actor_id() AND kind = 'render-prepare')
  WITH CHECK(owner_id = dream.actor_id() AND kind = 'render-prepare' AND status IN ('running','failed','succeeded'));
GRANT INSERT(owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO local_render_execute;
CREATE POLICY local_render_execute_activity ON dream.activity_log FOR INSERT TO local_render_execute
  WITH CHECK(owner_id = dream.actor_id() AND action = 'render.completed');
COMMIT;
