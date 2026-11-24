-- P2 managed scene version selection 0002 (candidate, local PG17 rehearsal only): topic-shorts projects.
-- Install after managed-scene-select 0001 (unchanged). Topic-shorts projects come from managed-project-core 0003 and
-- reach approved scenes through managed-project-plan 0003; this file only widens which menus the role may touch.
-- Run as the same migration owner with the same dream.scene_select.install_ref / install_database settings.
-- Changes only the menu condition: the writer's two dream.projects policies and the project lookup inside
-- dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid) (body otherwise identical to 0001). The function keeps its owner (the writer),
-- SECURITY DEFINER, search_path and EXECUTE grants. The installer holds an INHERIT membership in the writer only for the
-- replacement (no SET ROLE), revoked before the 0001 scope guard runs again.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.scene_select.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_select.install_database', true)
    OR to_regclass('dream_scene_select.installation') IS NULL OR to_regrole('dream_scene_select_writer') IS NULL
    OR to_regprocedure('dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SCENE_SELECT_TOPIC_SHORTS_TARGET';
  END IF;
  IF NOT EXISTS (SELECT FROM dream_scene_select.installation WHERE version=1
      AND project_ref=current_setting('dream.scene_select.install_ref', true))
    OR (SELECT relowner FROM pg_class WHERE oid='dream.projects'::regclass) IS DISTINCT FROM to_regrole(current_user)
    OR (SELECT relowner FROM pg_class WHERE oid='dream_scene_select.installation'::regclass) IS DISTINCT FROM to_regrole(current_user)
    OR NOT EXISTS (SELECT FROM pg_proc f WHERE f.oid=to_regprocedure('dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)') AND f.prosecdef
      AND f.proowner=to_regrole('dream_scene_select_writer') AND f.prosrc LIKE '%p.menu_id=''shopping-shorts''%'
      AND f.prosrc NOT LIKE '%topic-shorts%')
    OR 2 <> (SELECT count(*) FROM pg_policy p WHERE p.polrelid='dream.projects'::regclass
      AND (p.polname, p.polcmd) IN (('scene_select_read','r'),('scene_select_write','w')) AND p.polpermissive
      AND p.polroles=ARRAY[to_regrole('dream_scene_select_writer')::oid]
      AND pg_get_expr(p.polqual,p.polrelid) LIKE '%(menu_id = ''shopping-shorts''::text)%'
      AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%topic-shorts%') THEN
    RAISE EXCEPTION 'SCENE_SELECT_TOPIC_SHORTS_TARGET';
  END IF;
END $$;

-- Owner-only, open shopping-shorts and topic-shorts projects (same menus as project core 0003, plan 0003, scene read 0002).
ALTER POLICY scene_select_read ON dream.projects
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL);
ALTER POLICY scene_select_write ON dream.projects
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL)
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL);

-- Replace the function body with the owner's privileges (INHERIT membership for this statement only; no role switch).
DO $$ BEGIN
  EXECUTE format('GRANT dream_scene_select_writer TO %I WITH ADMIN FALSE, INHERIT TRUE, SET FALSE', current_user);
END $$;
CREATE OR REPLACE FUNCTION dream_scene_select.select_version(p_request uuid, p_project uuid, p_scene uuid, p_version uuid,
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
    WHERE p.owner_id=v_owner AND p.id=p_project AND p.menu_id IN ('shopping-shorts','topic-shorts') AND p.archived_at IS NULL FOR NO KEY UPDATE;
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
DO $$
BEGIN
  IF pg_has_role(current_user, 'dream_scene_select_writer', 'MEMBER') THEN
    EXECUTE format('REVOKE dream_scene_select_writer FROM %I', current_user);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_proc f WHERE f.oid=to_regprocedure('dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)')
      AND f.prosecdef AND f.proowner=to_regrole('dream_scene_select_writer') AND f.proconfig=ARRAY['search_path=pg_catalog']
      AND f.prosrc LIKE '%p.menu_id IN (''shopping-shorts'',''topic-shorts'')%' AND f.prosrc NOT LIKE '%p.menu_id=''shopping-shorts''%') THEN
    RAISE EXCEPTION 'SCENE_SELECT_TOPIC_SHORTS_FUNCTION';
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
