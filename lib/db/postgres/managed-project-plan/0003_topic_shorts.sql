-- Topic shorts planning: the plan draft and approval roles may also read and lock topic-shorts projects.
-- Prerequisites: managed-project-plan 0001 and 0002, and managed-project-core 0003 (topic-shorts creation).
-- Run once with the same install settings as 0001/0002 (dream.managed_plan.install_ref, install_database).
-- Only the menu condition of the five project policies changes. Owner, archive and approval conditions,
-- grants, the other policies and the runtime readiness checks stay as installed. A second run is rejected.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR current_database() IS DISTINCT FROM current_setting('dream.managed_plan.install_database', true)
    OR NOT EXISTS (
      SELECT FROM managed_project_plan.installation i JOIN managed_project_plan.approval_installation a USING (version,project_ref)
      WHERE i.version=1 AND i.project_ref=current_setting('dream.managed_plan.install_ref',true)
    )
    OR NOT EXISTS (SELECT FROM pg_class c WHERE c.oid='dream.projects'::regclass AND c.relowner=to_regrole(current_user)
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR 5 <> (
      SELECT count(*) FROM pg_policy p
      WHERE p.polrelid='dream.projects'::regclass AND p.polpermissive
        AND (p.polname,p.polcmd,p.polroles) IN (
          ('managed_plan_read','r',ARRAY['dream_plan_app'::regrole::oid]),
          ('managed_plan_lock','w',ARRAY['dream_plan_app'::regrole::oid]),
          ('managed_approval_project_read','r',ARRAY['dream_plan_approver'::regrole::oid]),
          ('managed_approval_project_lock','w',ARRAY['dream_plan_approver'::regrole::oid]),
          ('managed_approval_project_link','w',ARRAY['dream_plan_approver'::regrole::oid]))
        AND pg_get_expr(p.polqual,p.polrelid) LIKE '%(menu_id = ''shopping-shorts''::text)%'
        AND coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') NOT LIKE '%topic-shorts%'
        AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%topic-shorts%'
    )
  THEN RAISE EXCEPTION 'MANAGED_PLAN_TOPIC_SHORTS_TARGET'; END IF;
END
$$;

ALTER POLICY managed_plan_read ON dream.projects
  USING (owner_id=dream.actor_id() AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL);
ALTER POLICY managed_plan_lock ON dream.projects
  USING (owner_id=dream.actor_id() AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL) WITH CHECK (false);
ALTER POLICY managed_approval_project_read ON dream.projects
  USING (owner_id=dream.actor_id() AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL);
ALTER POLICY managed_approval_project_lock ON dream.projects
  USING (owner_id=dream.actor_id() AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL) WITH CHECK (false);
ALTER POLICY managed_approval_project_link ON dream.projects
  USING (owner_id=dream.actor_id() AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL AND approved_plan_id IS NULL)
  WITH CHECK (owner_id=dream.actor_id() AND menu_id IN ('shopping-shorts','topic-shorts') AND archived_at IS NULL
    AND approved_plan_id::text=current_setting('local_plan_materials.reviewed_plan_id',true));
COMMIT;
