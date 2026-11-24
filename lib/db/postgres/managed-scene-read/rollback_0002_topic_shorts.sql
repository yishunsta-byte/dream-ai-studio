-- Rollback of managed-scene-read 0002 (candidate, local PG17 rehearsal only): back to the 0001 install state.
-- Run as the migration owner with the 0001 install settings. The scene_read policy on dream.projects goes back to the exact
-- 0001 text (shopping-shorts only); nothing else changes. Topic-shorts rows already written stay; the read role stops seeing
-- topic-shorts projects (404). The runtime check accepts both states, so code does not have to change with it.
-- Re-applying 0002 afterwards is allowed (its target check expects this state).
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.scene_read.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.scene_read.install_database', true)
    OR to_regclass('dream_scene_read.installation') IS NULL THEN
    RAISE EXCEPTION 'SCENE_READ_TOPIC_SHORTS_ROLLBACK_TARGET';
  END IF;
  IF NOT EXISTS (SELECT FROM dream_scene_read.installation WHERE version=1
      AND project_ref=current_setting('dream.scene_read.install_ref', true))
    OR (SELECT relowner FROM pg_class WHERE oid='dream.projects'::regclass) IS DISTINCT FROM to_regrole(current_user)
    OR 1 <> (SELECT count(*) FROM pg_policy p WHERE p.polrelid='dream.projects'::regclass AND p.polname='scene_read'
      AND p.polcmd='r' AND p.polroles=ARRAY[to_regrole('dream_scene_read_app')::oid] AND pg_get_expr(p.polqual,p.polrelid) LIKE '%menu_id = ANY (ARRAY[''shopping-shorts''::text, ''topic-shorts''::text])%') THEN
    RAISE EXCEPTION 'SCENE_READ_TOPIC_SHORTS_ROLLBACK_TARGET';
  END IF;
END $$;

ALTER POLICY scene_read ON dream.projects
  USING (owner_id=(SELECT dream.actor_id()) AND menu_id='shopping-shorts' AND archived_at IS NULL);

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
