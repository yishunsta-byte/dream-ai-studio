BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() <> 'dream_test_t367' OR current_setting('server_version_num')::int / 10000 <> 17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned', true) IS DISTINCT FROM 'on'
     OR to_regclass('local_wav.files') IS NULL THEN
    RAISE EXCEPTION 'OWNED_RENDER_INPUT_TARGET';
  END IF;
END $$;

CREATE ROLE local_wav_render_read NOLOGIN;
GRANT USAGE ON SCHEMA dream, local_wav TO local_wav_render_read;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_wav_render_read;
GRANT USAGE ON DOMAIN dream.sha256, dream.safe_positive TO local_wav_render_read;
GRANT SELECT(id, owner_id, content_revision, current_timeline_rev_id, menu_id, archived_at, aspect, inputs_json)
  ON dream.projects TO local_wav_render_read;
GRANT SELECT(owner_id, project_id, stage, status) ON dream.stage_states TO local_wav_render_read;
GRANT SELECT(owner_id, project_id, id, revision, content_revision, timeline_json, timeline_sha256)
  ON dream.timeline_revisions TO local_wav_render_read;
GRANT SELECT(owner_id, project_id, asset_id, purpose) ON dream.project_assets TO local_wav_render_read;
GRANT SELECT(owner_id, id, archived_at, kind, mime, sha256, size_bytes, duration_ms, file_path, is_mock)
  ON dream.assets TO local_wav_render_read;
GRANT SELECT(owner_id, asset_id, content, digest, size_bytes, duration_ms)
  ON local_wav.files TO local_wav_render_read;

DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['projects','stage_states','timeline_revisions','project_assets','assets'] LOOP
    EXECUTE format('CREATE POLICY owned_render_read ON dream.%I FOR SELECT TO local_wav_render_read
      USING (owner_id = dream.actor_id())', relation);
  END LOOP;
END $$;
CREATE POLICY owned_render_read ON local_wav.files FOR SELECT TO local_wav_render_read
  USING (owner_id = dream.actor_id());
COMMIT;
