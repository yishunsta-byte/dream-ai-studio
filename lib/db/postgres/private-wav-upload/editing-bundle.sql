BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
  IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
     OR to_regclass('local_wav.files') IS NULL THEN
    RAISE EXCEPTION 'OWNED_EDITING_BUNDLE_TARGET';
  END IF;
END $$;

CREATE ROLE local_editing_bundle_read NOLOGIN;
GRANT USAGE ON SCHEMA dream,local_wav TO local_editing_bundle_read;
GRANT USAGE ON DOMAIN dream.sha256,dream.safe_positive TO local_editing_bundle_read;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,menu_id,title,aspect,length_sec,archived_at,content_revision,current_timeline_rev_id,
  approved_plan_id,inputs_json,template_snapshot_json,template_version) ON dream.projects TO local_editing_bundle_read;
GRANT SELECT(owner_id,project_id,stage,status,approved_revision,approved_plan_id) ON dream.stage_states TO local_editing_bundle_read;
GRANT SELECT(owner_id,project_id,id,status,version,script,steps_json,approved_scene_snapshot_json) ON dream.plans TO local_editing_bundle_read;
GRANT SELECT(owner_id,project_id,id,content_revision,revision,timeline_json,timeline_sha256,created_at)
  ON dream.timeline_revisions TO local_editing_bundle_read;
GRANT SELECT(owner_id,project_id,content_revision,template_item_id,status,note,required) ON dream.review_items TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,project_id,selected_version_id,needs_recheck,archived_at,title) ON dream.scenes TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,scene_id,plan_id,status,kind,version,result_asset_id,input_snapshot_json)
  ON dream.scene_versions TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,archived_at,is_mock,kind,mime,file_path,sha256,size_bytes,duration_ms,width,height,title,rights_note)
  ON dream.assets TO local_editing_bundle_read;
GRANT SELECT(owner_id,project_id,asset_id,purpose) ON dream.project_assets TO local_editing_bundle_read;
GRANT SELECT(owner_id,asset_id,digest,size_bytes,duration_ms,content) ON local_wav.files TO local_editing_bundle_read;
GRANT SELECT(owner_id,asset_id,object_id,status,current_receipt_id) ON dream.asset_receipt_state TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,registered_asset_id,bucket,object_key,kind,mime,size_bytes,sha256,lifecycle,active_generation,identity_digest)
  ON dream.storage_objects TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,object_id,asset_id,identity_digest,generation,operation_id,policy_id,policy_epoch,policy_digest,
  verified_at,not_after,width,height) ON dream.storage_verification_receipts TO local_editing_bundle_read;
GRANT SELECT(owner_id,id,object_id,generation,terminal_receipt_id,status) ON dream.storage_verification_operations TO local_editing_bundle_read;
GRANT SELECT(policy_id,epoch,digest) ON dream.storage_policies TO local_editing_bundle_read;

DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['projects','stage_states','plans','timeline_revisions','review_items','scenes','scene_versions',
    'assets','project_assets','asset_receipt_state','storage_objects','storage_verification_receipts','storage_verification_operations'] LOOP
    EXECUTE format('CREATE POLICY owned_editing_bundle_read ON dream.%I FOR SELECT TO local_editing_bundle_read
      USING (owner_id=dream.actor_id())',relation);
  END LOOP;
END $$;
CREATE POLICY owned_editing_bundle_read ON local_wav.files FOR SELECT TO local_editing_bundle_read
  USING (owner_id=dream.actor_id());
CREATE POLICY owned_editing_bundle_policy ON dream.storage_policies FOR SELECT TO local_editing_bundle_read
  USING (policy_id='t367-local-png');
COMMIT;
