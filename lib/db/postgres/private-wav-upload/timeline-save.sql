BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
 OR to_regrole('local_project_audio') IS NULL THEN RAISE EXCEPTION 'OWNED_TIMELINE_TARGET'; END IF;
END $$;
CREATE ROLE local_audio_edit NOLOGIN;
GRANT USAGE ON SCHEMA dream,local_wav TO local_audio_edit;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_audio_edit;
GRANT USAGE ON DOMAIN dream.safe_positive,dream.sha256 TO local_audio_edit;
GRANT SELECT(id,owner_id,project_id,status) ON dream.plans TO local_audio_edit;
GRANT SELECT(id,owner_id,current_timeline_rev_id,content_revision,menu_id,aspect,length_sec,inputs_json,archived_at),
 UPDATE(content_revision,current_timeline_rev_id,updated_at) ON dream.projects TO local_audio_edit;
GRANT SELECT(owner_id,project_id,stage,status),UPDATE(status,approved_at,approved_revision,approved_plan_id) ON dream.stage_states TO local_audio_edit;
GRANT SELECT,INSERT ON dream.timeline_revisions,dream.activity_log TO local_audio_edit;
GRANT SELECT(owner_id,project_id,asset_id,purpose),UPDATE(asset_id) ON dream.project_assets TO local_audio_edit;
GRANT SELECT(id,owner_id,kind,mime,is_mock,file_path,size_bytes,sha256,duration_ms,title,rights_note,archived_at),UPDATE(id) ON dream.assets TO local_audio_edit;
GRANT SELECT(owner_id,asset_id,digest,size_bytes,duration_ms) ON local_wav.files TO local_audio_edit;
GRANT SELECT(id,owner_id,project_id,position,selected_version_id,duration_sec,archived_at,needs_recheck),UPDATE(id) ON dream.scenes TO local_audio_edit;
GRANT SELECT(id,owner_id,scene_id,status,kind,result_asset_id),UPDATE(id) ON dream.scene_versions TO local_audio_edit;
CREATE POLICY wav_edit_read ON local_wav.files FOR SELECT TO local_audio_edit USING(owner_id=dream.actor_id());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['plans','projects','stage_states','timeline_revisions','project_assets','assets','scenes','scene_versions'] LOOP
 EXECUTE format('CREATE POLICY wav_edit_read ON dream.%I FOR SELECT TO local_audio_edit USING(owner_id=dream.actor_id())',t);
 END LOOP;
END $$;
CREATE POLICY wav_edit_log_read ON dream.activity_log FOR SELECT TO local_audio_edit USING(owner_id=dream.actor_id() AND action IN ('timeline.audio.add','timeline.initialize','timeline.subtitles.save'));
CREATE POLICY wav_edit_log_add ON dream.activity_log FOR INSERT TO local_audio_edit WITH CHECK(owner_id=dream.actor_id() AND action IN ('timeline.audio.add','timeline.initialize','timeline.subtitles.save'));
CREATE POLICY wav_edit_revision ON dream.timeline_revisions FOR INSERT TO local_audio_edit WITH CHECK(owner_id=dream.actor_id() AND source='user');
CREATE POLICY wav_edit_project_update ON dream.projects FOR UPDATE TO local_audio_edit USING(owner_id=dream.actor_id() AND archived_at IS NULL AND menu_id='shopping-shorts') WITH CHECK(owner_id=dream.actor_id());
CREATE POLICY wav_edit_stage_update ON dream.stage_states FOR UPDATE TO local_audio_edit USING(owner_id=dream.actor_id())
 WITH CHECK(owner_id=dream.actor_id() AND ((stage='edit' AND status='in_progress') OR (stage IN ('review','export') AND status='locked')));
CREATE POLICY wav_edit_asset_lock ON dream.assets FOR UPDATE TO local_audio_edit USING(owner_id=dream.actor_id()) WITH CHECK(false);
CREATE POLICY wav_edit_scene_lock ON dream.scenes FOR UPDATE TO local_audio_edit USING(owner_id=dream.actor_id()) WITH CHECK(false);
CREATE POLICY wav_edit_link_lock ON dream.project_assets FOR UPDATE TO local_audio_edit USING(owner_id=dream.actor_id()) WITH CHECK(false);
CREATE POLICY wav_edit_version_lock ON dream.scene_versions FOR UPDATE TO local_audio_edit USING(owner_id=dream.actor_id()) WITH CHECK(false);
COMMIT;
