-- P1-02 managed project creation and brief approval. Existing SQL 1–4 are prerequisites.
-- Set dream.project_core.install_ref to the matching Supabase Auth ref in the install session.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version_num')::int / 10000 <> 17
    OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.project_core.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR to_regnamespace('dream_project_core') IS NOT NULL OR to_regrole('dream_project_core_app') IS NOT NULL
    OR to_regprocedure('dream.actor_id()') IS NULL
    OR 16 <> (
      SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='dream' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
        AND c.relowner=to_regrole(current_user)
        AND c.relname IN ('projects','stage_states','jobs','renders','plans','timeline_revisions','assets','characters','project_assets','project_characters',
          'activity_log','storage_objects','storage_verification_operations','storage_verification_receipts','asset_receipt_state','storage_policies')
    ) THEN RAISE EXCEPTION 'PROJECT_CORE_INSTALL_TARGET'; END IF;
END $$;

CREATE ROLE dream_project_core_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA dream_project_core;
REVOKE ALL ON SCHEMA dream_project_core FROM PUBLIC;
GRANT USAGE ON SCHEMA dream, dream_project_core TO dream_project_core_app;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_project_core_app;
GRANT USAGE ON DOMAIN dream.sha256 TO dream_project_core_app;

CREATE TABLE dream_project_core.installation (
  version integer PRIMARY KEY CHECK (version = 1),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$')
);
INSERT INTO dream_project_core.installation VALUES (1, current_setting('dream.project_core.install_ref'));

CREATE TABLE dream_project_core.requests (
  owner_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create','brief')),
  request_id uuid NOT NULL,
  input_sha dream.sha256 NOT NULL,
  project_id uuid NOT NULL,
  response_revision dream.safe_positive,
  PRIMARY KEY (owner_id, operation, request_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES dream.projects(owner_id,id) ON DELETE RESTRICT,
  CHECK ((operation='brief') = (response_revision IS NOT NULL))
);
REVOKE ALL ON ALL TABLES IN SCHEMA dream_project_core FROM PUBLIC;
GRANT SELECT ON dream_project_core.installation TO dream_project_core_app;
ALTER TABLE dream_project_core.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_project_core.requests FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON dream_project_core.requests TO dream_project_core_app;
CREATE POLICY core_read ON dream_project_core.requests FOR SELECT TO dream_project_core_app
  USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY core_insert ON dream_project_core.requests FOR INSERT TO dream_project_core_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()));

GRANT SELECT (owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,
  approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at),
  INSERT (owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
  title,goal,target,aspect,length_sec,content_revision,created_at,updated_at), UPDATE (id)
  ON dream.projects TO dream_project_core_app;
CREATE POLICY core_read ON dream.projects FOR SELECT TO dream_project_core_app
  USING (owner_id=(SELECT dream.actor_id()) AND archived_at IS NULL);
CREATE POLICY core_insert ON dream.projects FOR INSERT TO dream_project_core_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND content_revision=1
    AND approved_plan_id IS NULL AND current_timeline_rev_id IS NULL AND archived_at IS NULL);
CREATE POLICY core_lock ON dream.projects FOR UPDATE TO dream_project_core_app
  USING (owner_id=(SELECT dream.actor_id()) AND archived_at IS NULL) WITH CHECK (false);

GRANT SELECT (owner_id,project_id,stage,status,approved_plan_id,approved_revision,approved_at,note),
  INSERT (owner_id,project_id,stage,status,approved_at), UPDATE (status,approved_revision,approved_at)
  ON dream.stage_states TO dream_project_core_app;
CREATE POLICY core_read ON dream.stage_states FOR SELECT TO dream_project_core_app
  USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY core_insert ON dream.stage_states FOR INSERT TO dream_project_core_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND approved_plan_id IS NULL AND approved_revision IS NULL AND note IS NULL
    AND (CASE stage WHEN 'intake' THEN status='approved' AND approved_at IS NOT NULL
                    WHEN 'brief' THEN status='todo' AND approved_at IS NULL ELSE status='locked' AND approved_at IS NULL END));
CREATE POLICY core_brief ON dream.stage_states FOR UPDATE TO dream_project_core_app
  USING (owner_id=(SELECT dream.actor_id()) AND ((stage='brief' AND status='todo') OR (stage='plan' AND status='locked')))
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND approved_plan_id IS NULL AND
    ((stage='brief' AND status='approved' AND approved_at IS NOT NULL AND approved_revision IS NOT NULL)
      OR (stage='plan' AND status='todo' AND approved_at IS NULL AND approved_revision IS NULL)));

GRANT SELECT (owner_id,project_id,status) ON dream.jobs TO dream_project_core_app;
-- The shared guard_row can prepare generic plans for these conditions even
-- when the new project has no plan or timeline and only its brief changes.
-- This role receives no row policy on these tables.
GRANT SELECT (owner_id,job_id) ON dream.renders TO dream_project_core_app;
GRANT SELECT (owner_id,id,project_id,status) ON dream.plans TO dream_project_core_app;
GRANT SELECT (owner_id,id,project_id) ON dream.timeline_revisions TO dream_project_core_app;
GRANT SELECT (owner_id,id,kind,mime,file_path,sha256,size_bytes,width,height,duration_ms,is_mock,archived_at), UPDATE (id)
  ON dream.assets TO dream_project_core_app;
GRANT SELECT (owner_id,id,archived_at), UPDATE (id) ON dream.characters TO dream_project_core_app;
GRANT INSERT (owner_id,project_id,asset_id,purpose) ON dream.project_assets TO dream_project_core_app;
GRANT INSERT (owner_id,project_id,character_id) ON dream.project_characters TO dream_project_core_app;
GRANT INSERT (owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO dream_project_core_app;

GRANT SELECT (owner_id,id,registered_asset_id,lifecycle,object_key,identity_digest,active_generation,kind,mime,sha256,size_bytes), UPDATE (id)
  ON dream.storage_objects TO dream_project_core_app;
GRANT SELECT (owner_id,id,object_id,generation,status,terminal_receipt_id) ON dream.storage_verification_operations TO dream_project_core_app;
GRANT SELECT (owner_id,id,object_id,asset_id,identity_digest,generation,operation_id,policy_id,policy_epoch,policy_digest,
  width,height,duration_ms,verified_at,not_after) ON dream.storage_verification_receipts TO dream_project_core_app;
GRANT SELECT (owner_id,asset_id,object_id,status,current_receipt_id), UPDATE (asset_id) ON dream.asset_receipt_state TO dream_project_core_app;
GRANT SELECT (policy_id,epoch,digest), UPDATE (policy_id) ON dream.storage_policies TO dream_project_core_app;
CREATE POLICY core_read ON dream.storage_policies FOR SELECT TO dream_project_core_app USING (true);
CREATE POLICY core_lock ON dream.storage_policies FOR UPDATE TO dream_project_core_app USING (true) WITH CHECK (false);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','assets','characters','storage_objects','storage_verification_operations',
      'storage_verification_receipts','asset_receipt_state'] LOOP
    EXECUTE format('CREATE POLICY core_read ON dream.%I FOR SELECT TO dream_project_core_app USING (owner_id=(SELECT dream.actor_id()))',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['assets','characters','storage_objects','asset_receipt_state'] LOOP
    EXECUTE format('CREATE POLICY core_lock ON dream.%I FOR UPDATE TO dream_project_core_app USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (false)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['project_assets','project_characters'] LOOP
    EXECUTE format('CREATE POLICY core_insert ON dream.%I FOR INSERT TO dream_project_core_app WITH CHECK (owner_id=(SELECT dream.actor_id()))',t);
  END LOOP;
END $$;
CREATE POLICY core_insert ON dream.activity_log FOR INSERT TO dream_project_core_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND action IN ('project.create','brief.confirm') AND project_id IS NOT NULL);

COMMIT;
