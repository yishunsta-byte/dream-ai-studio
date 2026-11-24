-- P2 managed scene version selection (candidate, local PG17 rehearsal only).
-- Prerequisites: SQL 1-4, managed-project-core 0001-0002, managed-project-plan 0001-0002. Run as the migration owner with
-- dream.scene_select.install_ref and dream.scene_select.install_database set in the install session.
-- The login role dream_scene_select_app (NOLOGIN here; login provisioning is a separate operation) has no table privilege:
-- it can read its installation row and EXECUTE dream_scene_select.select_version(). The function (SECURITY DEFINER, owned
-- by the NOLOGIN, non-inheriting role dream_scene_select_writer that nobody can SET ROLE to) applies the local product
-- contract (lib/services/production.ts select + workflow.changeContent "produce") in one call:
--   owner's open shopping-shorts project, revision CAS, approved current plan (plan stage approved, all seven stage rows),
--   the scene of that project and not archived, the expected previous selection, a succeeded version of that scene whose
--   result asset is registered and ready (not archived, not a sample); same version again = no write.
--   Writes (all or none): scene selection + needs_recheck (version of an older plan), content_revision + 1,
--   produce -> in_progress and edit/review/export -> locked with approvals cleared, one activity line, one receipt.
-- Lock order (same first row as plan saves/approvals, which lock the project row FOR UPDATE, and the managed scene result
-- registration, which takes the project FOR SHARE): request advisory lock -> project FOR NO KEY UPDATE -> the seven stage
-- rows FOR NO KEY UPDATE (stage order) -> scene FOR NO KEY UPDATE -> version, asset, storage object, receipt state FOR SHARE.
-- A request id answers its first result again (no state check); the same id with other inputs is REQUEST_REUSED.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.scene_select.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_select.install_database', true)
    OR to_regprocedure('dream.actor_id()') IS NULL
    OR to_regrole('dream_scene_select_app') IS NOT NULL OR to_regrole('dream_scene_select_writer') IS NOT NULL
    OR to_regnamespace('dream_scene_select') IS NOT NULL
    OR to_regclass('managed_project_plan.approval_installation') IS NULL OR to_regclass('dream_project_core.installation') IS NULL THEN
    RAISE EXCEPTION 'SCENE_SELECT_INSTALL_TARGET';
  END IF;
  IF NOT EXISTS (SELECT FROM managed_project_plan.approval_installation WHERE version=1
      AND project_ref=current_setting('dream.scene_select.install_ref', true))
    OR NOT EXISTS (SELECT FROM dream_project_core.installation WHERE version=1
      AND project_ref=current_setting('dream.scene_select.install_ref', true))
    OR 13 <> (SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.stage_states'::regclass,
      'dream.plans'::regclass,'dream.scenes'::regclass,'dream.scene_versions'::regclass,'dream.assets'::regclass,
      'dream.storage_objects'::regclass,'dream.asset_receipt_state'::regclass,'dream.activity_log'::regclass,
      'dream.renders'::regclass,'dream.timeline_revisions'::regclass,'dream.jobs'::regclass,'dream.settings'::regclass)
      AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner=to_regrole(current_user)) THEN
    RAISE EXCEPTION 'SCENE_SELECT_INSTALL_TARGET';
  END IF;
END $$;

CREATE ROLE dream_scene_select_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE dream_scene_select_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA dream_scene_select;
REVOKE ALL ON SCHEMA dream_scene_select FROM PUBLIC;

CREATE TABLE dream_scene_select.installation (
  version integer PRIMARY KEY CHECK (version = 1),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$')
);
INSERT INTO dream_scene_select.installation VALUES (1, current_setting('dream.scene_select.install_ref'));
REVOKE ALL ON dream_scene_select.installation FROM PUBLIC;

-- One row per (owner, request id): the first result of a request, so a retry after an uncertain COMMIT gets it again.
CREATE TABLE dream_scene_select.requests (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, project_id uuid NOT NULL, scene_id uuid NOT NULL, version_id uuid NOT NULL,
  expected_version_id uuid, previous_revision bigint NOT NULL CHECK (previous_revision BETWEEN 1 AND 9007199254740990),
  content_revision bigint NOT NULL CHECK (content_revision = previous_revision + 1), log_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, request_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES dream.projects (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, log_id) REFERENCES dream.activity_log (owner_id, id) ON DELETE RESTRICT
);
ALTER TABLE dream_scene_select.requests ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dream_scene_select.requests FROM PUBLIC;

GRANT USAGE ON SCHEMA dream, dream_scene_select TO dream_scene_select_writer;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_scene_select_writer;
GRANT SELECT, INSERT ON dream_scene_select.requests TO dream_scene_select_writer;
CREATE POLICY scene_select_request ON dream_scene_select.requests FOR ALL TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (owner_id=(SELECT dream.actor_id()));

-- Writer rows: the actor's own only. Columns: what the contract reads and the fields it changes.
GRANT SELECT (owner_id,id,menu_id,archived_at,content_revision,approved_plan_id,current_timeline_rev_id),
  UPDATE (content_revision,updated_at) ON dream.projects TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.projects FOR SELECT TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL);
CREATE POLICY scene_select_write ON dream.projects FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL)
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL);
GRANT SELECT (owner_id,project_id,stage,status,approved_plan_id),
  UPDATE (status,approved_plan_id,approved_revision,approved_at) ON dream.stage_states TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.stage_states FOR SELECT TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY scene_select_write ON dream.stage_states FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id()) AND stage IN ('produce','edit','review','export'))
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND approved_plan_id IS NULL AND approved_revision IS NULL AND approved_at IS NULL
    AND ((stage='produce' AND status='in_progress') OR (stage IN ('edit','review','export') AND status='locked')));
-- Row locks (FOR NO KEY UPDATE) on all seven rows need an UPDATE policy that sees them; its check never passes, so
-- the only rows that can change are the four above, into the states above.
CREATE POLICY scene_select_lock ON dream.stage_states FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (false);
GRANT SELECT (owner_id,id,project_id,status) ON dream.plans TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.plans FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));
GRANT SELECT (owner_id,id,project_id,archived_at,selected_version_id,needs_recheck),
  UPDATE (selected_version_id,needs_recheck) ON dream.scenes TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.scenes FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY scene_select_write ON dream.scenes FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id()) AND archived_at IS NULL)
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND archived_at IS NULL AND selected_version_id IS NOT NULL);
GRANT SELECT (owner_id,id,scene_id,plan_id,status,result_asset_id) ON dream.scene_versions TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.scene_versions FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));
GRANT SELECT (owner_id,id,archived_at,is_mock) ON dream.assets TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.assets FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));
GRANT SELECT (owner_id,id,registered_asset_id,lifecycle), UPDATE (id) ON dream.storage_objects TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.storage_objects FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));
-- UPDATE(id) + a never-true check only lets the function take FOR SHARE row locks; no update can pass.
CREATE POLICY scene_select_lock ON dream.storage_objects FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (false);
GRANT SELECT (owner_id,asset_id,object_id,status), UPDATE (asset_id) ON dream.asset_receipt_state TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.asset_receipt_state FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));
CREATE POLICY scene_select_lock ON dream.asset_receipt_state FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (false);
GRANT UPDATE (id) ON dream.assets TO dream_scene_select_writer;
CREATE POLICY scene_select_lock ON dream.assets FOR UPDATE TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (false);
GRANT SELECT (owner_id,id), INSERT (owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.activity_log FOR SELECT TO dream_scene_select_writer
  USING (owner_id=(SELECT dream.actor_id()) AND actor='managed-selector' AND action='scene.select');
CREATE POLICY scene_select_log ON dream.activity_log FOR INSERT TO dream_scene_select_writer
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND actor='managed-selector' AND action='scene.select');
-- dream.guard_row() plans its jobs branch (which reads renders) on every UPDATE and checks the project's timeline
-- pointer: the writer needs these column privileges, renders shows it no row, timeline rows only the actor's own.
GRANT SELECT (owner_id,job_id) ON dream.renders TO dream_scene_select_writer;
CREATE POLICY scene_select_denied ON dream.renders AS RESTRICTIVE FOR SELECT TO dream_scene_select_writer USING (false);
GRANT SELECT (owner_id,id,project_id) ON dream.timeline_revisions TO dream_scene_select_writer;
CREATE POLICY scene_select_read ON dream.timeline_revisions FOR SELECT TO dream_scene_select_writer USING (owner_id=(SELECT dream.actor_id()));

CREATE FUNCTION dream_scene_select.select_version(p_request uuid, p_project uuid, p_scene uuid, p_version uuid,
  p_expected uuid, p_revision bigint, p_log_id uuid)
RETURNS TABLE (r_outcome text, r_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_owner uuid := dream.actor_id();
  v_prev record; v_project record; v_scene record; v_version record; v_stages bigint; v_next bigint;
BEGIN
  IF v_owner IS NULL OR p_request IS NULL OR p_project IS NULL OR p_scene IS NULL OR p_version IS NULL OR p_log_id IS NULL
    OR p_revision IS NULL OR p_revision < 1 OR p_revision > 9007199254740990 THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::bigint; RETURN;
  END IF;
  -- Same request: serialize on (owner, request) and answer from the receipt (state is not re-checked).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || '/scene-select/' || p_request::text, 104));
  SELECT q.project_id, q.scene_id, q.version_id, q.expected_version_id, q.previous_revision, q.content_revision INTO v_prev
    FROM dream_scene_select.requests q WHERE q.owner_id=v_owner AND q.request_id=p_request;
  IF FOUND THEN
    IF (v_prev.project_id, v_prev.scene_id, v_prev.version_id, v_prev.previous_revision) <> (p_project, p_scene, p_version, p_revision)
      OR v_prev.expected_version_id IS DISTINCT FROM p_expected THEN
      RETURN QUERY SELECT 'REQUEST_REUSED'::text, NULL::bigint; RETURN;
    END IF;
    RETURN QUERY SELECT 'REPLAYED'::text, v_prev.content_revision; RETURN;
  END IF;
  -- Lock 1: project row (serializes with plan saves/approvals and other selections of this project).
  SELECT p.content_revision, p.approved_plan_id INTO v_project FROM dream.projects p
    WHERE p.owner_id=v_owner AND p.id=p_project AND p.menu_id='shopping-shorts' AND p.archived_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::bigint; RETURN; END IF;
  IF v_project.content_revision <> p_revision THEN RETURN QUERY SELECT 'STALE_REVISION'::text, v_project.content_revision; RETURN; END IF;
  -- Lock 2: the seven stage rows in stage order (the product requires all of them).
  SELECT count(*) INTO v_stages FROM (SELECT st.stage FROM dream.stage_states st
    WHERE st.owner_id=v_owner AND st.project_id=p_project ORDER BY st.stage FOR NO KEY UPDATE) locked;
  IF v_stages <> 7 THEN RETURN QUERY SELECT 'STAGE_LOCKED'::text, NULL::bigint; RETURN; END IF;
  IF v_project.approved_plan_id IS NULL OR NOT EXISTS (SELECT FROM dream.plans pl WHERE pl.owner_id=v_owner
      AND pl.id=v_project.approved_plan_id AND pl.project_id=p_project AND pl.status='approved')
    OR NOT EXISTS (SELECT FROM dream.stage_states st WHERE st.owner_id=v_owner AND st.project_id=p_project
      AND st.stage='plan' AND st.status='approved') THEN
    RETURN QUERY SELECT 'PLAN_NOT_APPROVED'::text, NULL::bigint; RETURN;
  END IF;
  -- Lock 3: the scene.
  SELECT s.selected_version_id INTO v_scene FROM dream.scenes s
    WHERE s.owner_id=v_owner AND s.id=p_scene AND s.project_id=p_project AND s.archived_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::bigint; RETURN; END IF;
  IF v_scene.selected_version_id IS DISTINCT FROM p_expected THEN RETURN QUERY SELECT 'SELECTION_CHANGED'::text, NULL::bigint; RETURN; END IF;
  -- Lock 4: an eligible version and its stored result (no archive, cleanup or revocation can pass meanwhile).
  SELECT v.plan_id INTO v_version FROM dream.scene_versions v
    JOIN dream.assets a ON (a.owner_id,a.id)=(v.owner_id,v.result_asset_id)
    JOIN dream.storage_objects o ON (o.owner_id,o.registered_asset_id)=(a.owner_id,a.id)
    JOIN dream.asset_receipt_state rs ON (rs.owner_id,rs.asset_id,rs.object_id)=(a.owner_id,a.id,o.id)
    WHERE v.owner_id=v_owner AND v.id=p_version AND v.scene_id=p_scene AND v.status='succeeded'
      AND a.archived_at IS NULL AND a.is_mock=0 AND o.lifecycle='registered' AND rs.status='ready'
    FOR SHARE OF a, o, rs;
  IF NOT FOUND THEN RETURN QUERY SELECT 'INVALID_VERSION'::text, NULL::bigint; RETURN; END IF;
  IF v_scene.selected_version_id = p_version THEN RETURN QUERY SELECT 'UNCHANGED'::text, p_revision; RETURN; END IF;
  -- Writes: all or none (any failure aborts the caller's transaction).
  v_next := p_revision + 1;
  UPDATE dream.scenes SET selected_version_id=p_version,
    needs_recheck=CASE WHEN v_version.plan_id=v_project.approved_plan_id THEN 0 ELSE 1 END
    WHERE owner_id=v_owner AND id=p_scene;
  UPDATE dream.projects SET content_revision=v_next, updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=p_project;
  UPDATE dream.stage_states SET status=CASE WHEN stage='produce' THEN 'in_progress' ELSE 'locked' END,
    approved_plan_id=NULL, approved_revision=NULL, approved_at=NULL
    WHERE owner_id=v_owner AND project_id=p_project AND stage IN ('produce','edit','review','export');
  INSERT INTO dream.activity_log (owner_id,id,project_id,actor,action,detail_json,created_at)
    VALUES (v_owner, p_log_id, p_project, 'managed-selector', 'scene.select',
      jsonb_build_object('previousRevision',p_revision,'contentRevision',v_next,'origin','produce',
        'sceneId',p_scene,'versionId',p_version,'expectedVersionId',p_expected)::text, clock_timestamp());
  INSERT INTO dream_scene_select.requests (owner_id,request_id,project_id,scene_id,version_id,expected_version_id,
    previous_revision,content_revision,log_id,created_at)
    VALUES (v_owner,p_request,p_project,p_scene,p_version,p_expected,p_revision,v_next,p_log_id,clock_timestamp());
  RETURN QUERY SELECT 'SELECTED'::text, v_next;
END $$;
-- Privileges are set while the installer still owns the function (a non-owner REVOKE/GRANT is silently ignored).
REVOKE ALL ON FUNCTION dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA dream_scene_select TO dream_scene_select_app;
GRANT SELECT ON dream_scene_select.installation TO dream_scene_select_app;
GRANT EXECUTE ON FUNCTION dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid) TO dream_scene_select_app;
-- Owner transfer needs SET on the writer and CREATE on the schema for the new owner, both only for this statement.
DO $$ BEGIN
  EXECUTE format('GRANT dream_scene_select_writer TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE', current_user);
END $$;
GRANT CREATE ON SCHEMA dream_scene_select TO dream_scene_select_writer;
ALTER FUNCTION dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO dream_scene_select_writer;
REVOKE CREATE ON SCHEMA dream_scene_select FROM dream_scene_select_writer;
DO $$
BEGIN
  IF pg_has_role(current_user, 'dream_scene_select_writer', 'MEMBER') THEN
    EXECUTE format('REVOKE dream_scene_select_writer FROM %I', current_user);
  END IF;
  IF pg_has_role(current_user, 'dream_scene_select_app', 'MEMBER') THEN
    EXECUTE format('REVOKE dream_scene_select_app FROM %I', current_user);
  END IF;
END $$;

DO $$
DECLARE fn oid := 'dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure;
BEGIN
  -- Writer-role guard, the same text the selection login re-checks on every request. The only membership allowed on
  -- these roles is the ADMIN-only one CREATE ROLE gives the installer (the owner of dream_scene_select.installation;
  -- it cannot revoke a superuser's grant): no SET, no INHERIT, no other member, and the roles are members of nothing.
  IF (
  -- role-guard:begin (identical in lib/cloud/managed-scene-select.ts and managed-scene-select/0001_install.sql)
  EXISTS (SELECT FROM pg_roles w WHERE w.rolname='dream_scene_select_writer'
    AND NOT (w.rolcanlogin OR w.rolinherit OR w.rolsuper OR w.rolbypassrls OR w.rolcreaterole OR w.rolcreatedb OR w.rolreplication))
  AND NOT EXISTS (SELECT FROM pg_auth_members m
    WHERE m.member IN (to_regrole('dream_scene_select_writer'), to_regrole('dream_scene_select_app'))
      OR (m.roleid IN (to_regrole('dream_scene_select_writer'), to_regrole('dream_scene_select_app'))
        AND NOT (m.admin_option AND NOT m.set_option AND NOT m.inherit_option
          AND m.member = (SELECT i.relowner FROM pg_class i WHERE i.oid = to_regclass('dream_scene_select.installation')))))
  AND EXISTS (SELECT FROM pg_proc f WHERE f.oid = to_regprocedure('dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)')
    AND f.prosecdef AND f.proowner = to_regrole('dream_scene_select_writer'))
  AND NOT has_schema_privilege('dream_scene_select_writer', 'dream_scene_select', 'CREATE')
  AND NOT has_column_privilege('dream_scene_select_writer', (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dream' AND c.relname='scene_versions'), 'input_snapshot_json', 'SELECT')
  AND NOT has_column_privilege('dream_scene_select_writer', (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dream' AND c.relname='assets'), 'file_path', 'SELECT')
  AND NOT has_any_column_privilege('dream_scene_select_writer', (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dream' AND c.relname='assets'), 'INSERT')
  -- role-guard:end
  ) IS NOT TRUE
    OR has_function_privilege('public', fn, 'EXECUTE') OR NOT has_function_privilege('dream_scene_select_app', fn, 'EXECUTE')
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('dream','dream_scene_select','dream_project_core','managed_project_plan','local_plan_materials')
        AND c.relkind IN ('r','v','m','p','f','S') AND c.oid <> 'dream_scene_select.installation'::regclass
        AND (has_table_privilege('dream_scene_select_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege('dream_scene_select_app', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
    OR EXISTS (SELECT FROM pg_policy p WHERE to_regrole('dream_scene_select_app')::oid = ANY(p.polroles))
    OR has_schema_privilege('dream_scene_select_app', 'dream', 'USAGE') THEN
    RAISE EXCEPTION 'SCENE_SELECT_SCOPE';
  END IF;
END $$;
COMMIT;
