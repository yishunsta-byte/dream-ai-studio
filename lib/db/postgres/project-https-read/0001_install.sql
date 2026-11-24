-- Separate from Dream's numbered base migrations. Apply explicitly as the common
-- base table owner with CREATE on this database; never as a Data API role.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 1);

DO $preflight$
DECLARE
  browser_role text;
  rel record;
  expected record;
  authenticated_oid oid;
BEGIN
  IF current_setting('server_version_num')::int < 170000 OR
     to_regnamespace('project_read') IS NOT NULL OR
     to_regnamespace('project_read_private') IS NOT NULL THEN
    RAISE EXCEPTION 'project HTTPS read v1: unsupported server or candidate namespace already exists';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('authenticated','anon','authenticator','dream_api','dream_worker')) <> 5 OR
     to_regprocedure('auth.uid()') IS NULL OR EXISTS (
       SELECT FROM pg_proc WHERE oid = to_regprocedure('auth.uid()') AND
         (prorettype <> 'uuid'::regtype OR proretset OR provolatile = 'v')
     ) OR NOT has_function_privilege('authenticated','auth.uid()','EXECUTE') OR
     NOT pg_has_role('authenticator','authenticated','SET') OR NOT pg_has_role('authenticator','anon','SET') OR
     NOT has_database_privilege(current_database(),'CREATE') THEN
    RAISE EXCEPTION 'project HTTPS read v1: incompatible roles, auth.uid() or installer';
  END IF;
  SELECT oid INTO authenticated_oid FROM pg_roles WHERE rolname = 'authenticated';
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('authenticated','anon') AND rolcanlogin) OR
     pg_has_role('anon','authenticated','MEMBER') OR pg_has_role('anon','authenticator','MEMBER') OR
     pg_has_role('authenticated','authenticator','MEMBER') OR EXISTS (
       SELECT FROM pg_roles WHERE (rolsuper OR rolbypassrls OR has_schema_privilege(oid,'dream','USAGE')) AND
         (pg_has_role('anon',oid,'SET') OR pg_has_role('authenticated',oid,'SET'))
     ) THEN
    RAISE EXCEPTION 'project HTTPS read v1: unsafe browser role membership';
  END IF;
  FOREACH browser_role IN ARRAY ARRAY['authenticated','anon','authenticator'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = browser_role AND (rolsuper OR rolbypassrls OR rolcreaterole)) OR
       pg_has_role(browser_role,'dream_api','MEMBER') OR pg_has_role(browser_role,'dream_worker','MEMBER') OR
       pg_has_role(browser_role,current_user,'MEMBER') OR has_schema_privilege(browser_role,'dream','USAGE') THEN
      RAISE EXCEPTION 'project HTTPS read v1: browser role can reach a privileged Dream boundary';
    END IF;
  END LOOP;

  -- Stabilize the inspected relations and refuse deployment over drift. DDL upgrades
  -- these locks briefly; a busy database times out and rolls back atomically.
  LOCK TABLE dream.projects, dream.stage_states, dream.jobs IN SHARE UPDATE EXCLUSIVE MODE;
  FOR rel IN
    SELECT oid,relname,relkind,relowner,relrowsecurity,relforcerowsecurity
    FROM pg_class WHERE relnamespace = 'dream'::regnamespace AND relname IN ('projects','stage_states','jobs')
  LOOP
    IF rel.relkind <> 'r' OR rel.relowner <> to_regrole(current_user) OR
       NOT rel.relrowsecurity OR NOT rel.relforcerowsecurity OR EXISTS (
         SELECT FROM pg_policy p WHERE p.polrelid = rel.oid AND (
           p.polname = 'project_https_read_v1' OR (p.polcmd IN ('r','*') AND EXISTS (
             SELECT FROM unnest(p.polroles) AS target(role_oid)
             WHERE CASE WHEN role_oid = 0 THEN true ELSE pg_has_role(authenticated_oid,role_oid,'USAGE') END
           ))
         )
       ) THEN
      RAISE EXCEPTION 'project HTTPS read v1: incompatible table owner, RLS or policies on %', rel.relname;
    END IF;
    FOREACH browser_role IN ARRAY ARRAY['authenticated','anon','authenticator'] LOOP
      IF has_table_privilege(browser_role,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
         has_any_column_privilege(browser_role,rel.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'project HTTPS read v1: existing browser grants on %', rel.relname;
      END IF;
    END LOOP;
  END LOOP;

  FOR expected IN SELECT * FROM (VALUES
    ('projects','uuid',ARRAY['owner_id','id','approved_plan_id','current_timeline_rev_id']),
    ('projects','text',ARRAY['menu_id','template_version','template_snapshot_json','inputs_json','title','goal','target','aspect']),
    ('projects','bigint',ARRAY['length_sec','content_revision']),
    ('projects','timestamptz',ARRAY['archived_at','created_at','updated_at']),
    ('stage_states','uuid',ARRAY['owner_id','project_id','approved_plan_id']),
    ('stage_states','text',ARRAY['stage','status','note']),
    ('stage_states','bigint',ARRAY['approved_revision']),
    ('stage_states','timestamptz',ARRAY['approved_at']),
    ('jobs','uuid',ARRAY['owner_id','project_id']),
    ('jobs','text',ARRAY['status'])
  ) AS requirement(relation,type_name,column_names)
  LOOP
    IF (SELECT count(*) FROM pg_attribute
        WHERE attrelid = to_regclass('dream.' || expected.relation) AND attnum > 0 AND NOT attisdropped
          AND atttypid = to_regtype(expected.type_name) AND attname = ANY(expected.column_names))
       <> cardinality(expected.column_names) THEN
      RAISE EXCEPTION 'project HTTPS read v1: incompatible columns on %', expected.relation;
    END IF;
  END LOOP;
END
$preflight$;

CREATE SCHEMA project_read_private;
CREATE SCHEMA project_read;
COMMENT ON SCHEMA project_read_private IS 'Dream project HTTPS read candidate v1 private';
COMMENT ON SCHEMA project_read IS 'Dream project HTTPS read candidate v1 profile';
REVOKE ALL ON SCHEMA project_read, project_read_private FROM PUBLIC;

-- Deliberately independent of auth.users: no new trigger or write dependency on Auth.
-- Approval is an explicit UUID allowlist. Owners manage it from a trusted SQL session.
CREATE TABLE project_read_private.approved_users (id uuid PRIMARY KEY);
ALTER TABLE project_read_private.approved_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_own_approval ON project_read_private.approved_users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
REVOKE ALL ON TABLE project_read_private.approved_users FROM PUBLIC;
GRANT SELECT (id) ON project_read_private.approved_users TO authenticated;

CREATE POLICY project_https_read_v1 ON dream.projects FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND archived_at IS NULL AND
    EXISTS (SELECT 1 FROM project_read_private.approved_users WHERE id = (SELECT auth.uid())));
CREATE POLICY project_https_read_v1 ON dream.stage_states FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM dream.projects WHERE id = stage_states.project_id));
CREATE POLICY project_https_read_v1 ON dream.jobs FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM dream.projects WHERE id = jobs.project_id));
COMMENT ON POLICY project_https_read_v1 ON dream.projects IS 'Dream project HTTPS read candidate v1 policy';
COMMENT ON POLICY project_https_read_v1 ON dream.stage_states IS 'Dream project HTTPS read candidate v1 policy';
COMMENT ON POLICY project_https_read_v1 ON dream.jobs IS 'Dream project HTTPS read candidate v1 policy';

-- Invoker views need the referenced columns, but the role has no USAGE on the
-- base or private schemas. The owner column is used only inside the policies.
GRANT SELECT (id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,
  approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at) ON dream.projects TO authenticated;
GRANT SELECT (project_id,stage,status,approved_plan_id,approved_revision,approved_at,note) ON dream.stage_states TO authenticated;
GRANT SELECT (project_id,status) ON dream.jobs TO authenticated;

CREATE VIEW project_read_private.project_data WITH (security_invoker=true) AS
SELECT p.*,
  ARRAY(SELECT j.status FROM dream.jobs j WHERE j.project_id = p.id ORDER BY j.status) AS jobs,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'projectId',s.project_id,'stage',s.stage,'status',s.status,'approvedPlanId',s.approved_plan_id,
    'approvedRevision',s.approved_revision,'approvedAt',to_char(s.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'note',s.note) ORDER BY s.stage) FROM dream.stage_states s WHERE s.project_id = p.id),'[]'::jsonb) AS states
FROM (SELECT id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,
  approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at FROM dream.projects) AS p;

CREATE VIEW project_read.project_list WITH (security_invoker=true) AS
SELECT id,title,menu_id AS "menuId",template_snapshot_json::jsonb#>>'{menu,label}' AS "menuLabel",
  aspect,length_sec AS "lengthSec",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
  jobs,states FROM project_read_private.project_data;

CREATE VIEW project_read.project_detail WITH (security_invoker=true) AS
SELECT id, jsonb_build_object('id',id,'menuId',menu_id,'templateVersion',template_version,
  'templateSnapshotJson',template_snapshot_json,'inputsJson',inputs_json,'title',title,'goal',goal,'target',target,
  'aspect',aspect,'lengthSec',length_sec,'approvedPlanId',approved_plan_id,'contentRevision',content_revision,
  'currentTimelineRevId',current_timeline_rev_id,'archivedAt',to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS project,
  template_snapshot_json::jsonb AS snapshot,inputs_json::jsonb AS inputs,states
FROM project_read_private.project_data;

COMMENT ON TABLE project_read_private.approved_users IS 'Dream project HTTPS read candidate v1 relation';
COMMENT ON VIEW project_read_private.project_data IS 'Dream project HTTPS read candidate v1 relation';
COMMENT ON VIEW project_read.project_list IS 'Dream project HTTPS read candidate v1 relation';
COMMENT ON VIEW project_read.project_detail IS 'Dream project HTTPS read candidate v1 relation';

REVOKE ALL ON TABLE project_read_private.project_data, project_read.project_list, project_read.project_detail FROM PUBLIC;
GRANT SELECT ON project_read_private.project_data, project_read.project_list, project_read.project_detail TO authenticated;
GRANT USAGE ON SCHEMA project_read TO authenticated;

-- Reject ambient default privileges rather than silently carrying an unexpected
-- grant into a Data API profile.
DO $verify_acl$
DECLARE browser_oid oid := 'authenticated'::regrole;
BEGIN
  IF EXISTS (
    SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname IN ('project_read','project_read_private') AND a.grantee <> n.nspowner
      AND NOT (n.nspname = 'project_read' AND a.grantee = browser_oid AND a.privilege_type = 'USAGE' AND NOT a.is_grantable)
  ) OR EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname IN ('project_read','project_read_private') AND a.grantee <> c.relowner
      AND NOT (c.relkind = 'v' AND a.grantee = browser_oid AND a.privilege_type = 'SELECT' AND NOT a.is_grantable)
  ) OR has_schema_privilege('anon','project_read','USAGE') OR has_schema_privilege('authenticator','project_read','USAGE') THEN
    RAISE EXCEPTION 'project HTTPS read v1: unexpected effective or default grants';
  END IF;
END
$verify_acl$;
COMMIT;
