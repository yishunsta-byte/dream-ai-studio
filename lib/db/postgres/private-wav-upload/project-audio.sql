BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
 OR to_regclass('local_wav.files') IS NULL THEN RAISE EXCEPTION 'OWNED_WAV_TARGET'; END IF;
END $$;
CREATE ROLE local_project_audio NOLOGIN;
ALTER TABLE local_wav.files ADD COLUMN size_bytes integer GENERATED ALWAYS AS (octet_length(content)) STORED;
GRANT USAGE ON SCHEMA local_wav,dream TO local_project_audio;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_project_audio;
GRANT SELECT(owner_id,asset_id,digest,size_bytes,duration_ms) ON local_wav.files TO local_project_audio;
CREATE POLICY attached_source ON local_wav.files FOR SELECT TO local_project_audio USING(owner_id=dream.actor_id());
GRANT SELECT(id,owner_id,menu_id,archived_at),UPDATE(id) ON dream.projects TO local_project_audio;
GRANT SELECT(id,owner_id,kind,mime,title,rights_note,file_path,sha256,duration_ms,size_bytes,archived_at),UPDATE(id) ON dream.assets TO local_project_audio;
CREATE POLICY audio_project ON dream.projects FOR SELECT TO local_project_audio USING(owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL);
CREATE POLICY audio_asset ON dream.assets FOR SELECT TO local_project_audio USING(owner_id=dream.actor_id() AND kind='audio' AND archived_at IS NULL);
-- PostgreSQL requires an UPDATE policy for a locking read. Actual updates fail WITH CHECK.
CREATE POLICY audio_project_lock ON dream.projects FOR UPDATE TO local_project_audio USING(owner_id=dream.actor_id()) WITH CHECK(false);
CREATE POLICY audio_asset_lock ON dream.assets FOR UPDATE TO local_project_audio USING(owner_id=dream.actor_id()) WITH CHECK(false);
GRANT SELECT, INSERT ON dream.project_assets TO local_project_audio;
CREATE POLICY audio_link_read ON dream.project_assets FOR SELECT TO local_project_audio USING(owner_id=dream.actor_id() AND purpose='productionAudio');
CREATE POLICY audio_link_add ON dream.project_assets FOR INSERT TO local_project_audio WITH CHECK(owner_id=dream.actor_id() AND purpose='productionAudio'
 AND EXISTS(SELECT FROM dream.projects p WHERE p.id=project_id)
 AND EXISTS(SELECT FROM dream.assets a JOIN local_wav.files f ON f.owner_id=a.owner_id AND f.asset_id=a.id
   WHERE a.id=project_assets.asset_id AND a.mime='audio/wav' AND a.sha256=f.digest AND a.size_bytes=f.size_bytes AND a.duration_ms=f.duration_ms
   AND a.file_path=a.owner_id::text||'/assets/'||a.id::text||'/'||f.digest||'.wav'));
GRANT INSERT ON dream.activity_log TO local_project_audio;
CREATE POLICY audio_link_log ON dream.activity_log FOR INSERT TO local_project_audio WITH CHECK(owner_id=dream.actor_id()
 AND action='project.audio.attach' AND actor='local-user' AND EXISTS(SELECT FROM dream.project_assets l
 WHERE l.project_id=activity_log.project_id AND l.asset_id::text=activity_log.detail_json::jsonb->>'assetId'));
COMMIT;
