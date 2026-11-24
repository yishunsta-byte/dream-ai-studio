-- P2 topic shorts: the managed project role may also create the topic-shorts menu.
-- Prerequisite: managed-project-core 0001 (and 0002) in the same install session settings
-- (dream.project_core.install_ref). Run once; a second run is rejected and changes nothing.
-- Only the creation policy changes. Grants, the read/lock policies and the runtime readiness check stay as installed.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version_num')::int/10000<>17
    OR current_setting('server_encoding')<>'UTF8'
    OR NOT EXISTS (
      SELECT FROM dream_project_core.installation WHERE version=1
        AND project_ref=current_setting('dream.project_core.install_ref',true)
    )
    OR NOT EXISTS (
      SELECT FROM pg_roles r WHERE r.rolname='dream_project_core_app'
        AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
    )
    OR NOT EXISTS (
      SELECT FROM pg_class c JOIN pg_policy p ON p.polrelid=c.oid
      WHERE c.oid='dream.projects'::regclass AND c.relowner=to_regrole(current_user)
        AND c.relrowsecurity AND c.relforcerowsecurity AND p.polname='core_insert'
        AND p.polcmd='a' AND p.polroles=ARRAY['dream_project_core_app'::regrole::oid]
        AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%(menu_id = ''shopping-shorts''::text)%'
        AND pg_get_expr(p.polwithcheck,p.polrelid) NOT LIKE '%topic-shorts%'
    )
  THEN RAISE EXCEPTION 'PROJECT_TOPIC_SHORTS_INSTALL_TARGET'; END IF;
END $$;
ALTER POLICY core_insert ON dream.projects
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND menu_id IN ('shopping-shorts','topic-shorts') AND content_revision=1
    AND approved_plan_id IS NULL AND current_timeline_rev_id IS NULL AND archived_at IS NULL);
COMMIT;
