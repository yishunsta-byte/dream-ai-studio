-- P2 managed source → scene result version (candidate, local PG17 rehearsal only).
-- Prerequisites: SQL 1–4, managed-project-core 0001–0002, managed-project-plan 0001–0002.
-- Run as the migration owner. The role is NOLOGIN; login provisioning is a separate operation.
-- Set dream.scene_result.install_ref and dream.scene_result.install_database in the install session.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.scene_result.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_result.install_database', true)
    OR to_regprocedure('dream.actor_id()') IS NULL OR to_regrole('dream_scene_result_app') IS NOT NULL
    OR to_regnamespace('dream_scene_result') IS NOT NULL
    OR to_regclass('managed_project_plan.approval_installation') IS NULL
    OR to_regclass('dream_project_core.installation') IS NULL THEN
    RAISE EXCEPTION 'SCENE_RESULT_INSTALL_TARGET';
  END IF;
  IF NOT EXISTS (SELECT FROM managed_project_plan.approval_installation WHERE version=1
      AND project_ref=current_setting('dream.scene_result.install_ref', true))
    OR NOT EXISTS (SELECT FROM dream_project_core.installation WHERE version=1
      AND project_ref=current_setting('dream.scene_result.install_ref', true))
    OR 13 <> (SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.stage_states'::regclass,
      'dream.plans'::regclass,'dream.scenes'::regclass,'dream.scene_versions'::regclass,'dream.assets'::regclass,
      'dream.project_assets'::regclass,'dream.activity_log'::regclass,'dream.storage_objects'::regclass,
      'dream.storage_verification_operations'::regclass,'dream.storage_verification_receipts'::regclass,
      'dream.asset_receipt_state'::regclass,'dream.storage_policies'::regclass)
      AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner=to_regrole(current_user)) THEN
    RAISE EXCEPTION 'SCENE_RESULT_INSTALL_TARGET';
  END IF;
END $$;

CREATE ROLE dream_scene_result_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA dream_scene_result;
REVOKE ALL ON SCHEMA dream_scene_result FROM PUBLIC;
GRANT USAGE ON SCHEMA dream, dream_scene_result TO dream_scene_result_app;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_scene_result_app;
GRANT USAGE ON DOMAIN dream.sha256 TO dream_scene_result_app;

CREATE TABLE dream_scene_result.installation (
  version integer PRIMARY KEY CHECK (version = 1),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$')
);
INSERT INTO dream_scene_result.installation VALUES (1, current_setting('dream.scene_result.install_ref'));

-- Request receipt: one row per (owner, request). Same request → same version; different content → conflict.
CREATE TABLE dream_scene_result.requests (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  input_sha dream.sha256 NOT NULL,
  project_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  scene_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, request_id),
  UNIQUE (owner_id, scene_version_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES dream.projects(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, scene_id) REFERENCES dream.scenes(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, scene_version_id) REFERENCES dream.scene_versions(owner_id, id) ON DELETE RESTRICT
);
REVOKE ALL ON ALL TABLES IN SCHEMA dream_scene_result FROM PUBLIC;
GRANT SELECT ON dream_scene_result.installation TO dream_scene_result_app;
ALTER TABLE dream_scene_result.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_scene_result.requests FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON dream_scene_result.requests TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream_scene_result.requests FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY scene_result_insert ON dream_scene_result.requests FOR INSERT TO dream_scene_result_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND EXISTS (
    SELECT FROM dream.scene_versions v JOIN dream.scenes s ON (s.owner_id,s.id)=(v.owner_id,v.scene_id)
    WHERE (v.owner_id,v.id,v.scene_id)=(requests.owner_id,requests.scene_version_id,requests.scene_id)
      AND s.project_id=requests.project_id));

-- Project, stages, plan: read and row lock only (UPDATE privilege on id with a lock policy that never passes WITH CHECK).
GRANT SELECT (owner_id,id,menu_id,content_revision,approved_plan_id,archived_at), UPDATE (id) ON dream.projects TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.projects FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL);
CREATE POLICY scene_result_lock ON dream.projects FOR UPDATE TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL) WITH CHECK (false);
GRANT SELECT (owner_id,project_id,stage,status,approved_plan_id,approved_revision) ON dream.stage_states TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.stage_states FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()) AND stage IN ('plan','produce'));
GRANT SELECT (owner_id,id,project_id,status) ON dream.plans TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.plans FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()));

-- Scene: read and lock (version numbers are assigned under the scene lock).
GRANT SELECT (owner_id,id,project_id,archived_at), UPDATE (id) ON dream.scenes TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.scenes FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY scene_result_lock ON dream.scenes FOR UPDATE TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()) AND archived_at IS NULL) WITH CHECK (false);

-- Registered asset with a current verification receipt (same closure as the project-core asset choices).
GRANT SELECT (owner_id,id,kind,mime,file_path,sha256,size_bytes,width,height,duration_ms,is_mock,archived_at) ON dream.assets TO dream_scene_result_app;
GRANT SELECT (owner_id,id,registered_asset_id,lifecycle,identity_digest,active_generation,object_key,kind,mime,sha256,size_bytes), UPDATE (id)
  ON dream.storage_objects TO dream_scene_result_app;
GRANT SELECT (owner_id,id,object_id,generation,status,terminal_receipt_id) ON dream.storage_verification_operations TO dream_scene_result_app;
GRANT SELECT (owner_id,id,object_id,asset_id,identity_digest,generation,operation_id,policy_id,policy_epoch,policy_digest,
  width,height,duration_ms,verified_at,not_after) ON dream.storage_verification_receipts TO dream_scene_result_app;
GRANT SELECT (owner_id,asset_id,object_id,status,current_receipt_id), UPDATE (asset_id) ON dream.asset_receipt_state TO dream_scene_result_app;
GRANT SELECT (policy_id,epoch,digest), UPDATE (policy_id) ON dream.storage_policies TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.storage_policies FOR SELECT TO dream_scene_result_app USING (true);
CREATE POLICY scene_result_lock ON dream.storage_policies FOR UPDATE TO dream_scene_result_app USING (true) WITH CHECK (false);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets','storage_objects','storage_verification_operations','storage_verification_receipts','asset_receipt_state'] LOOP
    EXECUTE format('CREATE POLICY scene_result_read ON dream.%I FOR SELECT TO dream_scene_result_app USING (owner_id=(SELECT dream.actor_id()))',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['storage_objects','asset_receipt_state'] LOOP
    EXECUTE format('CREATE POLICY scene_result_lock ON dream.%I FOR UPDATE TO dream_scene_result_app USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (false)',t);
  END LOOP;
END $$;

-- Project link for the result asset (purpose 'scene_result' only).
GRANT SELECT (owner_id,project_id,asset_id,purpose), INSERT (owner_id,project_id,asset_id,purpose) ON dream.project_assets TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.project_assets FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()) AND purpose='scene_result');
CREATE POLICY scene_result_insert ON dream.project_assets FOR INSERT TO dream_scene_result_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND purpose='scene_result'
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(project_assets.owner_id,project_assets.project_id))
    AND EXISTS (SELECT FROM dream.assets a WHERE (a.owner_id,a.id)=(project_assets.owner_id,project_assets.asset_id) AND a.archived_at IS NULL));

-- Scene version: insert only a succeeded managed-source result for the approved plan of an open project.
-- No UPDATE/DELETE; succeeded rows are already immutable by dream.guard_row.
GRANT SELECT (owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,job_id,generation_id,result_asset_id,status,created_at),
  INSERT (owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,result_asset_id,status,created_at)
  ON dream.scene_versions TO dream_scene_result_app;
CREATE POLICY scene_result_read ON dream.scene_versions FOR SELECT TO dream_scene_result_app
  USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY scene_result_insert ON dream.scene_versions FOR INSERT TO dream_scene_result_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND status='succeeded' AND job_id IS NULL AND generation_id IS NULL
    AND kind IN ('image','video') AND result_asset_id IS NOT NULL
    AND input_snapshot_json::jsonb->>'source'='managed-source'
    AND input_snapshot_json::jsonb->>'assetId'=result_asset_id::text
    AND EXISTS (
      SELECT FROM dream.scenes s JOIN dream.projects p ON (p.owner_id,p.id)=(s.owner_id,s.project_id)
      WHERE (s.owner_id,s.id)=(scene_versions.owner_id,scene_versions.scene_id) AND s.archived_at IS NULL
        AND p.approved_plan_id=scene_versions.plan_id
        AND EXISTS (SELECT FROM dream.stage_states st WHERE (st.owner_id,st.project_id)=(p.owner_id,p.id)
          AND st.stage='plan' AND st.status='approved' AND st.approved_plan_id=p.approved_plan_id)
        AND EXISTS (SELECT FROM dream.stage_states st WHERE (st.owner_id,st.project_id)=(p.owner_id,p.id)
          AND st.stage='produce' AND st.status IN ('todo','in_progress'))
        AND EXISTS (SELECT FROM dream.project_assets pa WHERE (pa.owner_id,pa.project_id,pa.asset_id,pa.purpose)
          =(p.owner_id,p.id,scene_versions.result_asset_id,'scene_result')))
    AND EXISTS (
      SELECT FROM dream.assets a
        JOIN dream.asset_receipt_state rs ON (rs.owner_id,rs.asset_id)=(a.owner_id,a.id)
        JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(rs.owner_id,rs.object_id,rs.asset_id)
        JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
          =(rs.owner_id,rs.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
        JOIN dream.storage_verification_operations v ON (v.owner_id,v.id,v.object_id,v.generation,v.terminal_receipt_id)
          =(r.owner_id,r.operation_id,r.object_id,r.generation,r.id)
        JOIN dream.storage_policies sp ON (sp.policy_id,sp.epoch,sp.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
      WHERE (a.owner_id,a.id)=(scene_versions.owner_id,scene_versions.result_asset_id) AND a.kind=scene_versions.kind
        AND a.archived_at IS NULL AND a.is_mock=0 AND o.lifecycle='registered' AND rs.status='ready' AND v.status='succeeded'
        AND a.sha256::text=input_snapshot_json::jsonb->>'sha256'
        AND (a.file_path,a.sha256,a.size_bytes,a.mime,a.kind,a.width,a.height)=(o.object_key,o.sha256,o.size_bytes,o.mime,o.kind,r.width,r.height)
        AND a.duration_ms IS NOT DISTINCT FROM r.duration_ms
        AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp()));

GRANT INSERT (owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO dream_scene_result_app;
CREATE POLICY scene_result_log ON dream.activity_log FOR INSERT TO dream_scene_result_app
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND actor='managed-scene-result' AND action='scene.result_register' AND project_id IS NOT NULL);
COMMIT;
