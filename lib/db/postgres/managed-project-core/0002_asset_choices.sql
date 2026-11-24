-- The file title is the only new privilege needed for the project selector.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version_num')::int/10000<>17
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
      WHERE c.oid='dream.assets'::regclass AND c.relowner=to_regrole(current_user)
        AND c.relrowsecurity AND c.relforcerowsecurity AND p.polname='core_read'
        AND p.polcmd='r' AND p.polroles=ARRAY['dream_project_core_app'::regrole::oid]
    )
  THEN RAISE EXCEPTION 'PROJECT_ASSET_CHOICES_INSTALL_TARGET'; END IF;
END $$;
GRANT SELECT (title) ON dream.assets TO dream_project_core_app;
COMMIT;
