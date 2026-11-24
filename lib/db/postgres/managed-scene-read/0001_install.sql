-- P2 managed scene read (candidate, local PG17 rehearsal only): scene ids, project revision and scene versions of the
-- owner's approved plan, read-only. Prerequisites: SQL 1-4, managed-project-core 0001, managed-project-plan 0001-0002.
-- Run as the migration owner. The role is NOLOGIN; login provisioning is a separate operation.
-- Set dream.scene_read.install_ref and dream.scene_read.install_database in the install session.
-- The role has SELECT on the listed columns only (no INSERT/UPDATE/DELETE anywhere, no row locks). It never sees
-- asset paths/keys/hashes, version input snapshots (request ids, hashes) or any request receipt table.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.scene_read.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_read.install_database', true)
    OR to_regprocedure('dream.actor_id()') IS NULL OR to_regrole('dream_scene_read_app') IS NOT NULL
    OR to_regnamespace('dream_scene_read') IS NOT NULL
    OR to_regclass('managed_project_plan.approval_installation') IS NULL
    OR to_regclass('dream_project_core.installation') IS NULL THEN
    RAISE EXCEPTION 'SCENE_READ_INSTALL_TARGET';
  END IF;
  IF NOT EXISTS (SELECT FROM managed_project_plan.approval_installation WHERE version=1
      AND project_ref=current_setting('dream.scene_read.install_ref', true))
    OR NOT EXISTS (SELECT FROM dream_project_core.installation WHERE version=1
      AND project_ref=current_setting('dream.scene_read.install_ref', true))
    OR 5 <> (SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.stage_states'::regclass,
      'dream.plans'::regclass,'dream.scenes'::regclass,'dream.scene_versions'::regclass)
      AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner=to_regrole(current_user)) THEN
    RAISE EXCEPTION 'SCENE_READ_INSTALL_TARGET';
  END IF;
END $$;

CREATE ROLE dream_scene_read_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA dream_scene_read;
REVOKE ALL ON SCHEMA dream_scene_read FROM PUBLIC;
GRANT USAGE ON SCHEMA dream, dream_scene_read TO dream_scene_read_app;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_scene_read_app;

CREATE TABLE dream_scene_read.installation (
  version integer PRIMARY KEY CHECK (version = 1),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$')
);
INSERT INTO dream_scene_read.installation VALUES (1, current_setting('dream.scene_read.install_ref'));
REVOKE ALL ON dream_scene_read.installation FROM PUBLIC;
GRANT SELECT ON dream_scene_read.installation TO dream_scene_read_app;

-- Owner-only, open shopping-shorts projects (same visibility as the managed project read).
GRANT SELECT (owner_id,id,menu_id,content_revision,approved_plan_id,archived_at) ON dream.projects TO dream_scene_read_app;
CREATE POLICY scene_read ON dream.projects FOR SELECT TO dream_scene_read_app
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL);
GRANT SELECT (owner_id,project_id,stage,status,approved_plan_id) ON dream.stage_states TO dream_scene_read_app;
CREATE POLICY scene_read ON dream.stage_states FOR SELECT TO dream_scene_read_app
  USING (owner_id=(SELECT dream.actor_id()) AND stage IN ('plan','produce'));
GRANT SELECT (owner_id,id,project_id,version,status) ON dream.plans TO dream_scene_read_app;
CREATE POLICY scene_read ON dream.plans FOR SELECT TO dream_scene_read_app
  USING (owner_id=(SELECT dream.actor_id()));
-- Scene identity, order and selection only (no title, description, dialogue or characters).
GRANT SELECT (owner_id,id,project_id,position,selected_version_id,archived_at) ON dream.scenes TO dream_scene_read_app;
CREATE POLICY scene_read ON dream.scenes FOR SELECT TO dream_scene_read_app
  USING (owner_id=(SELECT dream.actor_id()));
-- Version identity and state only (no input_snapshot_json: it holds request ids and hashes).
GRANT SELECT (owner_id,id,scene_id,version,plan_id,kind,job_id,generation_id,result_asset_id,status,created_at)
  ON dream.scene_versions TO dream_scene_read_app;
CREATE POLICY scene_read ON dream.scene_versions FOR SELECT TO dream_scene_read_app
  USING (owner_id=(SELECT dream.actor_id()));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('dream','dream_scene_read','dream_project_core','managed_project_plan','local_plan_materials') AND c.relkind IN ('r','v','m','p','f','S')
        AND (has_table_privilege('dream_scene_read_app', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege('dream_scene_read_app', c.oid, 'INSERT,UPDATE,REFERENCES')))
    OR has_column_privilege('dream_scene_read_app', 'dream.scene_versions', 'input_snapshot_json', 'SELECT')
    OR has_any_column_privilege('dream_scene_read_app', 'dream.assets', 'SELECT')
    OR has_any_column_privilege('dream_scene_read_app', 'dream_project_core.requests', 'SELECT')
    OR 5 <> (SELECT count(*) FROM pg_policy p WHERE to_regrole('dream_scene_read_app')::oid = ANY(p.polroles) AND p.polcmd='r')
    OR EXISTS (SELECT FROM pg_policy p WHERE to_regrole('dream_scene_read_app')::oid = ANY(p.polroles) AND p.polcmd<>'r') THEN
    RAISE EXCEPTION 'SCENE_READ_SCOPE';
  END IF;
END $$;
COMMIT;
