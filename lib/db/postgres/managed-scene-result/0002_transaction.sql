-- P2 managed scene result: one bounded database operation (candidate, local PG17 rehearsal only).
-- Prerequisite: managed-scene-result 0001 (unchanged). Run as the same migration owner with the same install settings.
-- After this file the login role dream_scene_result_app has no table privilege at all: it can only read the installation
-- row and EXECUTE dream_scene_result.register(). The function (SECURITY DEFINER, owned by the NOLOGIN, non-inheriting
-- role dream_scene_result_writer that nobody can SET ROLE to) checks and writes the request receipt, the scene version,
-- the project link and the activity log in one call. The writer keeps the 0001 row policies as a second layer.
-- Lock order (shared with the product's stage transitions: project row, then stage rows):
--   project FOR SHARE -> plan/produce stage rows FOR SHARE -> scene FOR NO KEY UPDATE -> asset receipt rows FOR SHARE.
-- A produce completion that updates the produce stage row (with or without locking the project row FOR UPDATE first)
-- either waits for a registration that already holds these locks, or makes the registration wait and then refuse.
-- Unchanged on purpose: the request scope (owner + request) and the replay of a finished request (no state check).
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17
    OR coalesce(current_setting('dream.scene_result.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_result.install_database', true)
    OR to_regclass('dream_scene_result.installation') IS NULL OR to_regrole('dream_scene_result_app') IS NULL
    OR to_regrole('dream_scene_result_writer') IS NOT NULL
    OR to_regprocedure('dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid)') IS NOT NULL
    OR NOT EXISTS (SELECT FROM dream_scene_result.installation WHERE version=1 AND project_ref=current_setting('dream.scene_result.install_ref', true))
    OR (SELECT relowner FROM pg_class WHERE oid='dream_scene_result.requests'::regclass) <> to_regrole(current_user)
    OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dream_scene_result_app') THEN
    RAISE EXCEPTION 'SCENE_RESULT_TRANSACTION_TARGET';
  END IF;
END $$;

CREATE ROLE dream_scene_result_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 1) Move every 0001 privilege and policy from the login role to the writer.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS rel, p.polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      WHERE p.polroles = ARRAY[to_regrole('dream_scene_result_app')::oid] LOOP
    EXECUTE format('ALTER POLICY %I ON %s TO dream_scene_result_writer', r.polname, r.rel);
  END LOOP;
  IF EXISTS (SELECT FROM pg_policy WHERE to_regrole('dream_scene_result_app') = ANY(polroles)) THEN
    RAISE EXCEPTION 'SCENE_RESULT_TRANSACTION_POLICY';
  END IF;
END $$;
REVOKE ALL ON dream.projects, dream.stage_states, dream.plans, dream.scenes, dream.assets, dream.storage_objects,
  dream.storage_verification_operations, dream.storage_verification_receipts, dream.asset_receipt_state, dream.storage_policies,
  dream.project_assets, dream.scene_versions, dream.activity_log, dream_scene_result.requests FROM dream_scene_result_app;
REVOKE ALL ON FUNCTION dream.actor_id() FROM dream_scene_result_app;
REVOKE ALL ON DOMAIN dream.sha256 FROM dream_scene_result_app;
REVOKE ALL ON SCHEMA dream FROM dream_scene_result_app;

GRANT USAGE ON SCHEMA dream, dream_scene_result TO dream_scene_result_writer;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_scene_result_writer;
GRANT USAGE ON DOMAIN dream.sha256 TO dream_scene_result_writer;
GRANT SELECT, INSERT ON dream_scene_result.requests TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,menu_id,content_revision,approved_plan_id,archived_at), UPDATE (id) ON dream.projects TO dream_scene_result_writer;
GRANT SELECT (owner_id,project_id,stage,status,approved_plan_id,approved_revision), UPDATE (stage) ON dream.stage_states TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,project_id,status) ON dream.plans TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,project_id,archived_at), UPDATE (id) ON dream.scenes TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,kind,mime,file_path,sha256,size_bytes,width,height,duration_ms,is_mock,archived_at) ON dream.assets TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,registered_asset_id,lifecycle,identity_digest,active_generation,object_key,kind,mime,sha256,size_bytes), UPDATE (id)
  ON dream.storage_objects TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,object_id,generation,status,terminal_receipt_id) ON dream.storage_verification_operations TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,object_id,asset_id,identity_digest,generation,operation_id,policy_id,policy_epoch,policy_digest,
  width,height,duration_ms,verified_at,not_after) ON dream.storage_verification_receipts TO dream_scene_result_writer;
GRANT SELECT (owner_id,asset_id,object_id,status,current_receipt_id), UPDATE (asset_id) ON dream.asset_receipt_state TO dream_scene_result_writer;
GRANT SELECT (policy_id,epoch,digest), UPDATE (policy_id) ON dream.storage_policies TO dream_scene_result_writer;
GRANT SELECT (owner_id,project_id,asset_id,purpose), INSERT (owner_id,project_id,asset_id,purpose) ON dream.project_assets TO dream_scene_result_writer;
GRANT SELECT (owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,job_id,generation_id,result_asset_id,status,created_at),
  INSERT (owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,result_asset_id,status,created_at)
  ON dream.scene_versions TO dream_scene_result_writer;
GRANT INSERT (owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO dream_scene_result_writer;
-- New: the produce/plan stage rows are share-locked (never updated: WITH CHECK false).
CREATE POLICY scene_result_lock ON dream.stage_states FOR UPDATE TO dream_scene_result_writer
  USING (owner_id=(SELECT dream.actor_id()) AND stage IN ('plan','produce')) WITH CHECK (false);

-- 2) The one write path.
DO $$ BEGIN
  EXECUTE format('GRANT dream_scene_result_writer TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE', current_user);
END $$;
GRANT CREATE ON SCHEMA dream_scene_result TO dream_scene_result_writer;
CREATE FUNCTION dream_scene_result.register(p_request uuid, p_project uuid, p_scene uuid, p_asset uuid, p_sha256 text,
  p_revision bigint, p_version_id uuid, p_log_id uuid)
RETURNS TABLE (r_outcome text, r_version_id uuid, r_version bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  v_owner uuid := dream.actor_id();
  v_input text;
  v_prev record;
  v_project record;
  v_plan record;
  v_produce record;
  v_asset record;
  v_next bigint;
BEGIN
  IF v_owner IS NULL OR p_request IS NULL OR p_project IS NULL OR p_scene IS NULL OR p_asset IS NULL OR p_version_id IS NULL
    OR p_log_id IS NULL OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_revision IS NULL
    OR p_revision < 1 OR p_revision > 9007199254740991 THEN
    RETURN QUERY SELECT 'INVALID_INPUT'::text, NULL::uuid, NULL::bigint; RETURN;
  END IF;
  v_input := encode(sha256(convert_to(format('["%s","%s","%s","%s"]', p_project, p_scene, p_asset, p_sha256), 'UTF8')), 'hex');
  -- Same request: serialize on (owner, request) and answer from the receipt (state is not re-checked).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || '/scene-result/' || p_request::text, 103));
  SELECT q.input_sha::text AS input_sha, q.scene_version_id INTO v_prev
    FROM dream_scene_result.requests q WHERE q.owner_id=v_owner AND q.request_id=p_request;
  IF FOUND THEN
    IF v_prev.input_sha <> v_input THEN RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
    SELECT sv.version INTO v_next FROM dream.scene_versions sv WHERE sv.owner_id=v_owner AND sv.id=v_prev.scene_version_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
    RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.scene_version_id, v_next; RETURN;
  END IF;
  -- Lock order 1/4: project.
  SELECT p.content_revision, p.approved_plan_id INTO v_project FROM dream.projects p
    WHERE p.owner_id=v_owner AND p.id=p_project FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
  IF v_project.content_revision <> p_revision THEN RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
  IF v_project.approved_plan_id IS NULL THEN RETURN QUERY SELECT 'PLAN_NOT_APPROVED'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
  -- Lock order 2/4: plan and produce stage rows (a produce completion updates its row: it waits for us or we wait for it).
  SELECT st.status, st.approved_plan_id INTO v_plan FROM dream.stage_states st
    WHERE st.owner_id=v_owner AND st.project_id=p_project AND st.stage='plan' FOR SHARE;
  SELECT st.status INTO v_produce FROM dream.stage_states st
    WHERE st.owner_id=v_owner AND st.project_id=p_project AND st.stage='produce' FOR SHARE;
  IF v_plan.status IS DISTINCT FROM 'approved' OR v_plan.approved_plan_id IS DISTINCT FROM v_project.approved_plan_id THEN
    RETURN QUERY SELECT 'PLAN_NOT_APPROVED'::text, NULL::uuid, NULL::bigint; RETURN;
  END IF;
  IF v_produce.status IS NULL OR v_produce.status NOT IN ('todo','in_progress') THEN
    RETURN QUERY SELECT 'STAGE_LOCKED'::text, NULL::uuid, NULL::bigint; RETURN;
  END IF;
  -- Lock order 3/4: scene (version numbers of one scene are assigned one at a time).
  PERFORM FROM dream.scenes s WHERE s.owner_id=v_owner AND s.id=p_scene AND s.project_id=p_project AND s.archived_at IS NULL
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
  PERFORM FROM dream.assets a WHERE a.owner_id=v_owner AND a.id=p_asset;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
  -- Lock order 4/4: the current receipt closure of the asset (same as the project-core asset choices).
  SELECT a.kind, a.sha256::text AS sha256, a.size_bytes INTO v_asset FROM dream.assets a
    JOIN dream.asset_receipt_state s ON (s.owner_id,s.asset_id)=(a.owner_id,a.id)
    JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(s.owner_id,s.object_id,s.asset_id)
    JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
      =(s.owner_id,s.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
    JOIN dream.storage_verification_operations v ON (v.owner_id,v.id,v.object_id,v.generation,v.terminal_receipt_id)
      =(r.owner_id,r.operation_id,r.object_id,r.generation,r.id)
    JOIN dream.storage_policies sp ON (sp.policy_id,sp.epoch,sp.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
    WHERE a.owner_id=v_owner AND a.id=p_asset AND a.archived_at IS NULL AND a.is_mock=0
      AND o.lifecycle='registered' AND s.status='ready' AND v.status='succeeded' AND a.kind IN ('image','video')
      AND (a.file_path,a.sha256,a.size_bytes,a.mime,a.kind,a.width,a.height)=(o.object_key,o.sha256,o.size_bytes,o.mime,o.kind,r.width,r.height)
      AND a.duration_ms IS NOT DISTINCT FROM r.duration_ms
      AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp()
    FOR SHARE OF o, s, sp;
  IF NOT FOUND OR v_asset.sha256 <> p_sha256 THEN RETURN QUERY SELECT 'ASSET_NOT_READY'::text, NULL::uuid, NULL::bigint; RETURN; END IF;
  -- Writes: all four or none (any failure aborts the caller's transaction).
  SELECT coalesce(max(sv.version),0)+1 INTO v_next FROM dream.scene_versions sv WHERE sv.owner_id=v_owner AND sv.scene_id=p_scene;
  INSERT INTO dream.project_assets AS pa (owner_id,project_id,asset_id,purpose) VALUES (v_owner,p_project,p_asset,'scene_result')
    ON CONFLICT (owner_id,project_id,asset_id,purpose) DO NOTHING;
  INSERT INTO dream.scene_versions(owner_id,id,scene_id,version,plan_id,kind,input_snapshot_json,result_asset_id,status,created_at)
    VALUES (v_owner, p_version_id, p_scene, v_next, v_project.approved_plan_id, v_asset.kind,
      json_build_object('schemaVersion',1,'source','managed-source','requestId',p_request,'projectId',p_project,'sceneId',p_scene,
        'assetId',p_asset,'sha256',p_sha256,'sizeBytes',v_asset.size_bytes)::text, p_asset, 'succeeded', clock_timestamp());
  INSERT INTO dream_scene_result.requests(owner_id,request_id,input_sha,project_id,scene_id,scene_version_id,created_at)
    VALUES (v_owner, p_request, v_input, p_project, p_scene, p_version_id, clock_timestamp());
  INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at)
    VALUES (v_owner, p_log_id, p_project, 'managed-scene-result', 'scene.result_register',
      json_build_object('sceneId',p_scene,'versionId',p_version_id,'version',v_next,'assetId',p_asset,'requestId',p_request)::text, clock_timestamp());
  RETURN QUERY SELECT 'CREATED'::text, p_version_id, v_next;
END $fn$;
-- Privileges are set while the installer still owns the function (a non-owner REVOKE/GRANT is silently ignored).
REVOKE ALL ON FUNCTION dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid) TO dream_scene_result_app;
ALTER FUNCTION dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid) OWNER TO dream_scene_result_writer;
REVOKE CREATE ON SCHEMA dream_scene_result FROM dream_scene_result_writer;
DO $$ BEGIN
  EXECUTE format('REVOKE dream_scene_result_writer FROM %I', current_user);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_auth_members m WHERE m.roleid=to_regrole('dream_scene_result_writer') AND (m.set_option OR m.inherit_option))
    OR EXISTS (SELECT FROM pg_auth_members m WHERE m.member IN (to_regrole('dream_scene_result_writer'), to_regrole('dream_scene_result_app')))
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('dream','dream_scene_result') AND c.relkind IN ('r','v','m','p') AND c.oid<>'dream_scene_result.installation'::regclass
        AND (has_table_privilege('dream_scene_result_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege('dream_scene_result_app', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
    OR NOT has_function_privilege('dream_scene_result_app', 'dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid)', 'EXECUTE')
    OR EXISTS (SELECT FROM pg_proc f, aclexplode(f.proacl) x WHERE f.oid='dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid)'::regprocedure
      AND x.grantee NOT IN (to_regrole('dream_scene_result_app'), to_regrole('dream_scene_result_writer')))
    OR NOT EXISTS (SELECT FROM pg_proc f WHERE f.oid='dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid)'::regprocedure
      AND f.prosecdef AND f.proowner=to_regrole('dream_scene_result_writer')) THEN
    RAISE EXCEPTION 'SCENE_RESULT_TRANSACTION_SCOPE';
  END IF;
END $$;
COMMIT;
