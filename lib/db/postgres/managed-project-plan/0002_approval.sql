BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR current_database() IS DISTINCT FROM current_setting('dream.managed_plan.install_database', true)
    OR NOT EXISTS (SELECT FROM managed_project_plan.installation WHERE version=1
      AND project_ref=current_setting('dream.managed_plan.install_ref',true))
    OR to_regrole('dream_plan_app') IS NULL OR to_regrole('dream_plan_guard') IS NULL
    OR 8 <> (SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.plans'::regclass,
      'dream.stage_states'::regclass,'dream.activity_log'::regclass,'dream.scenes'::regclass,'dream.renders'::regclass,
      'dream.timeline_revisions'::regclass,'local_plan_materials.drafts'::regclass)
      AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)
    OR 2 <> (SELECT count(*) FROM pg_trigger t WHERE t.tgenabled IN ('O','A')
      AND t.tgfoid='managed_project_plan.protect_materials()'::regprocedure
      AND (t.tgrelid,t.tgname,t.tgtype) IN
        (('dream.plans'::regclass,'managed_plan_materials_guard',23),('local_plan_materials.drafts'::regclass,'managed_plan_materials_attach',7)))
  THEN RAISE EXCEPTION 'MANAGED_PLAN_APPROVAL_TARGET'; END IF;
END
$$;

CREATE ROLE dream_plan_approver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE TABLE managed_project_plan.approval_installation (
  version integer PRIMARY KEY CHECK (version=1),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$')
);
REVOKE ALL ON TABLE managed_project_plan.approval_installation FROM PUBLIC;
INSERT INTO managed_project_plan.approval_installation SELECT version,project_ref FROM managed_project_plan.installation;

GRANT USAGE ON SCHEMA managed_project_plan,dream,local_plan_materials TO dream_plan_approver;
GRANT SELECT ON managed_project_plan.installation,managed_project_plan.approval_installation TO dream_plan_approver;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_plan_approver;

-- A generic plan checks privileges in the shared row trigger before evaluating
-- the render branch or the null timeline pointer. Neither table exposes rows
-- to the approver, including if a permissive policy is later installed.
GRANT SELECT(owner_id,job_id) ON dream.renders TO dream_plan_approver;
CREATE POLICY managed_approval_render_denied ON dream.renders AS RESTRICTIVE FOR SELECT TO dream_plan_approver USING (false);
GRANT SELECT(owner_id,id,project_id) ON dream.timeline_revisions TO dream_plan_approver;
CREATE POLICY managed_approval_timeline_denied ON dream.timeline_revisions
  AS RESTRICTIVE FOR SELECT TO dream_plan_approver USING (false);

GRANT SELECT(owner_id,id,menu_id,archived_at,content_revision,approved_plan_id,template_snapshot_json,length_sec),
  UPDATE(approved_plan_id) ON dream.projects TO dream_plan_approver;
CREATE POLICY managed_approval_project_read ON dream.projects FOR SELECT TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL);
CREATE POLICY managed_approval_project_lock ON dream.projects FOR UPDATE TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL) WITH CHECK (false);
CREATE POLICY managed_approval_project_link ON dream.projects FOR UPDATE TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL AND approved_plan_id IS NULL)
  WITH CHECK (owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL
    AND approved_plan_id::text=current_setting('local_plan_materials.reviewed_plan_id',true));

GRANT SELECT(owner_id,project_id,stage,status,approved_plan_id,approved_revision),
  UPDATE(status,approved_plan_id,approved_at,approved_revision) ON dream.stage_states TO dream_plan_approver;
CREATE POLICY managed_approval_stages_read ON dream.stage_states FOR SELECT TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND stage IN ('brief','plan','produce')
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(stage_states.owner_id,stage_states.project_id)));
CREATE POLICY managed_approval_stages_update ON dream.stage_states FOR UPDATE TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND ((stage='plan' AND status IN ('todo','in_progress','needs_approval'))
    OR (stage='produce' AND status='locked')))
  WITH CHECK (owner_id=dream.actor_id() AND EXISTS (
    SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(stage_states.owner_id,stage_states.project_id)
    AND p.approved_plan_id::text=current_setting('local_plan_materials.reviewed_plan_id',true)
    AND ((stage_states.stage='plan' AND stage_states.status='approved' AND stage_states.approved_plan_id=p.approved_plan_id
      AND stage_states.approved_revision=p.content_revision AND stage_states.approved_at IS NOT NULL)
      OR (stage_states.stage='produce' AND stage_states.status='todo' AND stage_states.approved_plan_id IS NULL
        AND stage_states.approved_revision IS NULL AND stage_states.approved_at IS NULL))));

GRANT SELECT(owner_id,id,project_id,version,steps_json,script,status),
  UPDATE(status,approved_at,approved_scene_snapshot_json) ON dream.plans TO dream_plan_approver;
CREATE POLICY managed_approval_plan_read ON dream.plans FOR SELECT TO dream_plan_approver
  USING (owner_id=dream.actor_id()
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(plans.owner_id,plans.project_id)));
CREATE POLICY managed_approval_plan_update ON dream.plans FOR UPDATE TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND status='draft' AND id::text=current_setting('local_plan_materials.reviewed_plan_id',true)
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(plans.owner_id,plans.project_id) AND p.approved_plan_id IS NULL)
    AND 3=(SELECT count(*) FROM dream.stage_states s WHERE (s.owner_id,s.project_id)=(plans.owner_id,plans.project_id)
      AND ((s.stage='brief' AND s.status='approved') OR (s.stage='plan' AND s.status IN ('todo','in_progress','needs_approval'))
        OR (s.stage='produce' AND s.status='locked'))))
  WITH CHECK (owner_id=dream.actor_id() AND status='approved' AND approved_at IS NOT NULL AND approved_scene_snapshot_json IS NOT NULL);

GRANT SELECT(owner_id,plan_id,payload) ON local_plan_materials.drafts TO dream_plan_approver;
CREATE POLICY managed_approval_materials_read ON local_plan_materials.drafts FOR SELECT TO dream_plan_approver
  USING (owner_id=dream.actor_id()
    AND EXISTS (SELECT FROM dream.plans p WHERE (p.owner_id,p.id)=(drafts.owner_id,drafts.plan_id)));
GRANT SELECT(owner_id,project_id,archived_at),
  INSERT(owner_id,project_id,id,position,title,description,dialogue_json,character_ids_json,duration_sec) ON dream.scenes TO dream_plan_approver;
CREATE POLICY managed_approval_scenes_read ON dream.scenes FOR SELECT TO dream_plan_approver
  USING (owner_id=dream.actor_id() AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(scenes.owner_id,scenes.project_id)));
CREATE POLICY managed_approval_scenes_insert ON dream.scenes FOR INSERT TO dream_plan_approver
  WITH CHECK (owner_id=dream.actor_id() AND EXISTS (
    SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(scenes.owner_id,scenes.project_id)
      AND p.approved_plan_id::text=current_setting('local_plan_materials.reviewed_plan_id',true))
    AND EXISTS (SELECT FROM dream.stage_states s WHERE (s.owner_id,s.project_id)=(scenes.owner_id,scenes.project_id)
      AND s.stage='plan' AND s.status IN ('todo','in_progress','needs_approval')));

GRANT INSERT(owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO dream_plan_approver;
CREATE POLICY managed_approval_log ON dream.activity_log FOR INSERT TO dream_plan_approver
  WITH CHECK (owner_id=dream.actor_id() AND actor='managed-approver' AND action='plan.approve'
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(activity_log.owner_id,activity_log.project_id)
      AND p.approved_plan_id::text=current_setting('local_plan_materials.reviewed_plan_id',true)
      AND p.approved_plan_id::text=(activity_log.detail_json::jsonb->>'planId')));
COMMIT;
