-- Rollback of managed-scene-result 0003 (candidate, local PG17 rehearsal only): back to the 0002 install state.
-- Run as the migration owner with the 0001-0002 install settings. The writer's two dream.projects policies go back to the
-- exact 0001 text (shopping-shorts only); register(), grants and roles are untouched and the 0002 scope check runs again.
-- Registered topic-shorts versions stay; new topic-shorts registrations answer NOT_FOUND. Re-applying 0003 is allowed.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.scene_result.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_result.install_database', true)
    OR to_regclass('dream_scene_result.installation') IS NULL THEN
    RAISE EXCEPTION 'SCENE_RESULT_TOPIC_SHORTS_ROLLBACK_TARGET';
  END IF;
  IF NOT EXISTS (SELECT FROM dream_scene_result.installation WHERE version=1
      AND project_ref=current_setting('dream.scene_result.install_ref', true))
    OR (SELECT relowner FROM pg_class WHERE oid='dream.projects'::regclass) IS DISTINCT FROM to_regrole(current_user)
    OR 2 <> (SELECT count(*) FROM pg_policy p WHERE p.polrelid='dream.projects'::regclass
      AND (p.polname, p.polcmd) IN (('scene_result_read','r'),('scene_result_lock','w'))
      AND p.polroles=ARRAY[to_regrole('dream_scene_result_writer')::oid] AND pg_get_expr(p.polqual,p.polrelid) LIKE '%menu_id = ANY (ARRAY[''shopping-shorts''::text, ''topic-shorts''::text])%') THEN
    RAISE EXCEPTION 'SCENE_RESULT_TOPIC_SHORTS_ROLLBACK_TARGET';
  END IF;
END $$;

ALTER POLICY scene_result_read ON dream.projects
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL);
ALTER POLICY scene_result_lock ON dream.projects
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL) WITH CHECK (false);

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
