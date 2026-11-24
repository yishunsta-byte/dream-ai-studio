BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
  IF current_database()<>'dream_test_t367'
    OR current_setting('server_version_num')::int/10000<>17
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
    OR to_regrole('local_audio_edit') IS NULL
  THEN RAISE EXCEPTION 'OWNED_REVIEW_TARGET'; END IF;
END $$;
CREATE ROLE local_project_review NOLOGIN;
GRANT USAGE ON SCHEMA dream TO local_project_review;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_project_review;
GRANT USAGE ON DOMAIN dream.safe_positive,dream.sha256 TO local_project_review;
GRANT SELECT(id,owner_id,menu_id,archived_at,aspect,content_revision,current_timeline_rev_id,template_snapshot_json,inputs_json),
  UPDATE(id) ON dream.projects TO local_project_review;
GRANT SELECT(owner_id,project_id,stage,status,approved_revision),
  UPDATE(status,approved_revision,approved_at,approved_plan_id) ON dream.stage_states TO local_project_review;
GRANT SELECT(owner_id,project_id,id,content_revision,timeline_json,timeline_sha256) ON dream.timeline_revisions TO local_project_review;
GRANT SELECT(owner_id,project_id,content_revision,template_item_id,status,note,required),
  INSERT(owner_id,id,project_id,content_revision,template_item_id,label,source,required,status,note,checked_at),
  UPDATE(status,note,checked_at) ON dream.review_items TO local_project_review;
GRANT INSERT(owner_id,project_id,id,actor,action,detail_json,created_at) ON dream.activity_log TO local_project_review;
GRANT SELECT(id,owner_id,project_id,position,selected_version_id,duration_sec,archived_at,needs_recheck),UPDATE(id) ON dream.scenes TO local_project_review;
GRANT SELECT(id,owner_id,scene_id,status,kind,result_asset_id),UPDATE(id) ON dream.scene_versions TO local_project_review;
GRANT SELECT(id,owner_id,kind,archived_at,duration_ms,is_mock,size_bytes,mime),UPDATE(id) ON dream.assets TO local_project_review;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projects','stage_states','timeline_revisions','review_items','scenes','scene_versions','assets'] LOOP
    EXECUTE format('CREATE POLICY project_review_read ON dream.%I FOR SELECT TO local_project_review USING(owner_id=dream.actor_id())',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['projects','scenes','scene_versions','assets'] LOOP
    EXECUTE format('CREATE POLICY project_review_lock ON dream.%I FOR UPDATE TO local_project_review USING(owner_id=dream.actor_id()) WITH CHECK(false)',t);
  END LOOP;
END $$;
CREATE POLICY project_review_stages ON dream.stage_states FOR UPDATE TO local_project_review
  USING(owner_id=dream.actor_id()) WITH CHECK(owner_id=dream.actor_id() AND approved_plan_id IS NULL AND
    ((stage='edit' AND status='approved') OR (stage='review' AND status IN ('todo','in_progress','approved'))
    OR (stage='export' AND status='todo')));
CREATE POLICY project_review_items_insert ON dream.review_items FOR INSERT TO local_project_review
  WITH CHECK(owner_id=dream.actor_id() AND source IN ('common','menu','conditional'));
CREATE POLICY project_review_items_update ON dream.review_items FOR UPDATE TO local_project_review
  USING(owner_id=dream.actor_id() AND source IN ('common','menu','conditional'))
  WITH CHECK(owner_id=dream.actor_id());
CREATE POLICY project_review_log ON dream.activity_log FOR INSERT TO local_project_review
  WITH CHECK(owner_id=dream.actor_id() AND (action IN ('review.item','review.approve')
    OR (action='stage.complete' AND detail_json::jsonb->>'stage'='edit')));
COMMIT;
