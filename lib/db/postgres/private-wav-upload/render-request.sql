BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$ BEGIN
  IF current_database() <> 'dream_test_t367' OR current_setting('server_version_num')::int / 10000 <> 17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned', true) IS DISTINCT FROM 'on'
     OR to_regrole('local_audio_edit') IS NULL THEN
    RAISE EXCEPTION 'OWNED_RENDER_REQUEST_TARGET';
  END IF;
END $$;
CREATE ROLE local_render_request NOLOGIN;
CREATE SCHEMA local_render_request;
REVOKE ALL ON SCHEMA local_render_request FROM PUBLIC;
CREATE TABLE local_render_request.keys (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, job_id uuid NOT NULL,
  PRIMARY KEY(owner_id, request_id),
  FOREIGN KEY(owner_id, job_id) REFERENCES dream.jobs(owner_id, id)
);
ALTER TABLE local_render_request.keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_render_request.keys FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA dream, local_render_request TO local_render_request;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_render_request;
GRANT USAGE ON DOMAIN dream.safe_positive, dream.sha256 TO local_render_request;
GRANT SELECT, INSERT ON local_render_request.keys TO local_render_request;
CREATE POLICY request_key_select ON local_render_request.keys FOR SELECT TO local_render_request USING(owner_id = dream.actor_id());
CREATE POLICY request_key_insert ON local_render_request.keys FOR INSERT TO local_render_request WITH CHECK(owner_id = dream.actor_id());

GRANT SELECT(id, owner_id, content_revision, current_timeline_rev_id, menu_id, archived_at, aspect),
      UPDATE(id) ON dream.projects TO local_render_request;
GRANT SELECT(owner_id, project_id, stage, status, approved_revision), UPDATE(stage) ON dream.stage_states TO local_render_request;
GRANT SELECT(owner_id, project_id, id, revision, content_revision, timeline_json, timeline_sha256)
  ON dream.timeline_revisions TO local_render_request;
CREATE POLICY render_request_project ON dream.projects FOR SELECT TO local_render_request USING(owner_id = dream.actor_id());
CREATE POLICY render_request_stage ON dream.stage_states FOR SELECT TO local_render_request USING(owner_id = dream.actor_id());
CREATE POLICY render_request_timeline ON dream.timeline_revisions FOR SELECT TO local_render_request USING(owner_id = dream.actor_id());
CREATE POLICY render_request_project_lock ON dream.projects FOR UPDATE TO local_render_request USING(owner_id = dream.actor_id()) WITH CHECK(false);
CREATE POLICY render_request_stage_lock ON dream.stage_states FOR UPDATE TO local_render_request USING(owner_id = dream.actor_id()) WITH CHECK(false);

GRANT SELECT(owner_id, id, project_id, kind, status, input_snapshot_json, idempotency_key, created_at),
      INSERT(owner_id, id, kind, payload_version, input_snapshot_json, status, project_id, ref_type, ref_id,
             provider, idempotency_key, created_at, updated_at)
  ON dream.jobs TO local_render_request;
CREATE POLICY render_request_job_read ON dream.jobs FOR SELECT TO local_render_request
  USING(owner_id = dream.actor_id() AND kind = 'render-prepare');
CREATE POLICY render_request_job_insert ON dream.jobs FOR INSERT TO local_render_request
  WITH CHECK(owner_id = dream.actor_id() AND kind = 'render-prepare' AND status = 'queued' AND attempts = 0
    AND payload_version = 1 AND ref_type = 'project' AND ref_id = project_id AND provider = 'local' AND next_run_at IS NULL);
GRANT INSERT(owner_id, id, project_id, actor, action, detail_json, created_at) ON dream.activity_log TO local_render_request;
CREATE POLICY render_request_log ON dream.activity_log FOR INSERT TO local_render_request
  WITH CHECK(owner_id = dream.actor_id() AND action = 'render.requested');
COMMIT;
