BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 OR current_setting('server_encoding') <> 'UTF8'
    OR coalesce(current_setting('dream.managed_plan.install_ref', true), '') !~ '^[a-z0-9]{20}$'
    OR current_database() IS DISTINCT FROM current_setting('dream.managed_plan.install_database', true)
    OR 5 <> (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='dream' AND c.relname IN ('projects','plans','stage_states','activity_log','scenes')
        AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)
    OR to_regprocedure('dream.actor_id()') IS NULL THEN
    RAISE EXCEPTION 'MANAGED_PLAN_TARGET';
  END IF;
  IF to_regrole('local_project_brief') IS NOT NULL AND (
    to_regprocedure('local_plan_materials.has_safe_version(uuid,uuid,uuid)') IS NULL OR
    2 <> (SELECT count(*) FROM pg_policy p WHERE p.polrelid='dream.plans'::regclass AND NOT p.polpermissive
      AND (p.polname,p.polcmd) IN (('plan_materials_version_guard','a'),('plan_materials_approval_guard','w'))
      AND to_regrole('local_project_brief')=ANY(p.polroles))
  ) THEN
    RAISE EXCEPTION 'MANAGED_PLAN_LOCAL_PROTECTION_REQUIRED';
  END IF;
END
$$;

CREATE ROLE dream_plan_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE dream_plan_guard NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE SCHEMA managed_project_plan;
REVOKE ALL ON SCHEMA managed_project_plan FROM PUBLIC;
GRANT USAGE ON SCHEMA managed_project_plan TO dream_plan_app, dream_plan_guard;
CREATE TABLE managed_project_plan.installation (
  version integer PRIMARY KEY CHECK (version=1),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$')
);
REVOKE ALL ON TABLE managed_project_plan.installation FROM PUBLIC;
INSERT INTO managed_project_plan.installation VALUES (1, current_setting('dream.managed_plan.install_ref'));
GRANT SELECT ON managed_project_plan.installation TO dream_plan_app;

CREATE SCHEMA IF NOT EXISTS local_plan_materials;
REVOKE ALL ON SCHEMA local_plan_materials FROM PUBLIC;
CREATE TABLE IF NOT EXISTS local_plan_materials.drafts (
  owner_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  PRIMARY KEY (owner_id, plan_id),
  FOREIGN KEY (owner_id,plan_id) REFERENCES dream.plans(owner_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class c WHERE c.oid='local_plan_materials.drafts'::regclass AND c.relkind='r'
      AND 3=(SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND a.attnotnull AND (a.attname,a.atttypid) IN (('owner_id','uuid'::regtype),('plan_id','uuid'::regtype),('payload','jsonb'::regtype)))
      AND EXISTS (SELECT FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p'
        AND pg_get_constraintdef(k.oid)='PRIMARY KEY (owner_id, plan_id)')
      AND EXISTS (SELECT FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f' AND k.confrelid='dream.plans'::regclass
        AND k.condeferrable AND k.condeferred AND k.convalidated AND k.confdeltype='r'
        AND pg_get_constraintdef(k.oid) LIKE 'FOREIGN KEY (owner_id, plan_id) REFERENCES dream.plans(owner_id, id)%')
  ) THEN RAISE EXCEPTION 'MANAGED_PLAN_MATERIALS_TARGET'; END IF;
END
$$;
ALTER TABLE local_plan_materials.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_plan_materials.drafts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE local_plan_materials.drafts FROM PUBLIC;
GRANT USAGE ON SCHEMA dream, local_plan_materials TO dream_plan_app, dream_plan_guard;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO dream_plan_app;

GRANT SELECT (owner_id,id,menu_id,archived_at,content_revision,approved_plan_id,template_snapshot_json,length_sec),
  UPDATE (id) ON dream.projects TO dream_plan_app;
CREATE POLICY managed_plan_read ON dream.projects FOR SELECT TO dream_plan_app
  USING (owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL);
CREATE POLICY managed_plan_lock ON dream.projects FOR UPDATE TO dream_plan_app
  USING (owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL) WITH CHECK (false);
GRANT SELECT (owner_id,project_id,stage,status) ON dream.stage_states TO dream_plan_app;
CREATE POLICY managed_plan_stage ON dream.stage_states FOR SELECT TO dream_plan_app
  USING (owner_id=dream.actor_id() AND stage IN ('brief','plan','produce')
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(stage_states.owner_id,stage_states.project_id)));

GRANT SELECT (owner_id,id,project_id,version,steps_json,script,status),
  INSERT (owner_id,id,project_id,version,steps_json,script,status,created_at) ON dream.plans TO dream_plan_app;
CREATE POLICY managed_plan_read ON dream.plans FOR SELECT TO dream_plan_app
  USING (owner_id=dream.actor_id()
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(plans.owner_id,plans.project_id)));
CREATE POLICY managed_plan_insert ON dream.plans FOR INSERT TO dream_plan_app
  WITH CHECK (owner_id=dream.actor_id() AND status='draft'
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(plans.owner_id,plans.project_id) AND p.approved_plan_id IS NULL)
    AND 3=(SELECT count(*) FROM dream.stage_states s WHERE (s.owner_id,s.project_id)=(plans.owner_id,plans.project_id)
      AND ((s.stage='brief' AND s.status='approved') OR (s.stage='plan' AND s.status IN ('todo','in_progress','needs_approval'))
        OR (s.stage='produce' AND s.status='locked'))));

GRANT SELECT (owner_id,plan_id,payload), INSERT (owner_id,plan_id,payload) ON local_plan_materials.drafts TO dream_plan_app;
CREATE POLICY managed_plan_read ON local_plan_materials.drafts FOR SELECT TO dream_plan_app
  USING (owner_id=dream.actor_id() AND EXISTS (SELECT FROM dream.plans p WHERE (p.owner_id,p.id)=(drafts.owner_id,drafts.plan_id)));
CREATE POLICY managed_plan_insert ON local_plan_materials.drafts FOR INSERT TO dream_plan_app
  WITH CHECK (owner_id=dream.actor_id() AND NOT EXISTS (SELECT FROM dream.plans p WHERE p.id=drafts.plan_id AND p.owner_id=drafts.owner_id));
GRANT INSERT (owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO dream_plan_app;
CREATE POLICY managed_plan_log ON dream.activity_log FOR INSERT TO dream_plan_app
  WITH CHECK (owner_id=dream.actor_id() AND actor='managed-user' AND action='plan.draft'
    AND EXISTS (SELECT FROM dream.projects p WHERE (p.owner_id,p.id)=(activity_log.owner_id,activity_log.project_id)));

-- A non-login role sees only plan identities. The trigger also covers older writers.
GRANT SELECT (owner_id,id,project_id) ON dream.plans TO dream_plan_guard;
GRANT SELECT (owner_id,plan_id) ON local_plan_materials.drafts TO dream_plan_guard;
CREATE POLICY managed_plan_guard_read ON dream.plans FOR SELECT TO dream_plan_guard USING (true);
CREATE POLICY managed_plan_guard_read ON local_plan_materials.drafts FOR SELECT TO dream_plan_guard USING (true);
CREATE FUNCTION managed_project_plan.protect_materials() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA='local_plan_materials' THEN
    IF EXISTS (SELECT FROM dream.plans p WHERE (p.owner_id,p.id)=(NEW.owner_id,NEW.plan_id))
    THEN RAISE EXCEPTION 'MANAGED_PLAN_VERSION_ALREADY_EXISTS' USING ERRCODE='42501'; END IF;
  ELSIF TG_OP='INSERT' THEN
    IF EXISTS (SELECT FROM dream.plans p JOIN local_plan_materials.drafts d ON (d.owner_id,d.plan_id)=(p.owner_id,p.id)
               WHERE (p.owner_id,p.project_id)=(NEW.owner_id,NEW.project_id))
      AND NOT EXISTS (SELECT FROM local_plan_materials.drafts d WHERE (d.owner_id,d.plan_id)=(NEW.owner_id,NEW.id))
    THEN RAISE EXCEPTION 'MANAGED_PLAN_MATERIALS_REQUIRED' USING ERRCODE='42501'; END IF;
  ELSIF EXISTS (SELECT FROM local_plan_materials.drafts d WHERE (d.owner_id,d.plan_id)=(OLD.owner_id,OLD.id)) THEN
    IF (NEW.owner_id,NEW.id,NEW.project_id,NEW.version,NEW.steps_json,NEW.script)
      IS DISTINCT FROM (OLD.owner_id,OLD.id,OLD.project_id,OLD.version,OLD.steps_json,OLD.script)
      OR (NEW.status='approved' AND OLD.status<>'approved'
        AND current_setting('local_plan_materials.reviewed_plan_id', true) IS DISTINCT FROM OLD.id::text)
    THEN RAISE EXCEPTION 'MANAGED_PLAN_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION managed_project_plan.protect_materials() FROM PUBLIC;
CREATE TRIGGER managed_plan_materials_guard BEFORE INSERT OR UPDATE ON dream.plans
  FOR EACH ROW EXECUTE FUNCTION managed_project_plan.protect_materials();
CREATE TRIGGER managed_plan_materials_attach BEFORE INSERT ON local_plan_materials.drafts
  FOR EACH ROW EXECUTE FUNCTION managed_project_plan.protect_materials();
GRANT dream_plan_guard TO CURRENT_USER;
GRANT CREATE ON SCHEMA managed_project_plan TO dream_plan_guard;
ALTER FUNCTION managed_project_plan.protect_materials() OWNER TO dream_plan_guard;
REVOKE CREATE ON SCHEMA managed_project_plan FROM dream_plan_guard;
REVOKE dream_plan_guard FROM CURRENT_USER;
COMMIT;
