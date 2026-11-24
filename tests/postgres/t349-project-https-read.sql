-- Disposable PG17 fixture. The gateway verifies JWTs outside PostgreSQL in this probe.
CREATE ROLE t349_authenticated NOLOGIN NOBYPASSRLS;
CREATE ROLE t349_anon NOLOGIN NOBYPASSRLS;
CREATE ROLE t349_approval_reader NOLOGIN NOBYPASSRLS;
CREATE SCHEMA t349_private;
CREATE SCHEMA t349_api;
REVOKE ALL ON SCHEMA t349_private, t349_api FROM PUBLIC;
CREATE TABLE t349_private.approved_users (id uuid PRIMARY KEY REFERENCES auth.users(id));

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
CREATE FUNCTION t349_private.approved() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM t349_private.approved_users WHERE id=auth.uid())
$$;
REVOKE ALL ON FUNCTION auth.uid(), t349_private.approved() FROM PUBLIC;
GRANT USAGE ON SCHEMA auth, t349_private TO t349_approval_reader;
GRANT SELECT (id) ON t349_private.approved_users TO t349_approval_reader;
GRANT EXECUTE ON FUNCTION auth.uid() TO t349_approval_reader;
ALTER FUNCTION t349_private.approved() OWNER TO t349_approval_reader;
GRANT EXECUTE ON FUNCTION auth.uid(), t349_private.approved() TO t349_authenticated;
GRANT USAGE ON SCHEMA t349_api TO t349_authenticated;

CREATE POLICY t349_read_projects ON dream.projects FOR SELECT TO t349_authenticated
  USING (owner_id=(SELECT auth.uid()) AND archived_at IS NULL AND (SELECT t349_private.approved()));
CREATE POLICY t349_read_stages ON dream.stage_states FOR SELECT TO t349_authenticated
  USING (owner_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM dream.projects WHERE id=stage_states.project_id));
CREATE POLICY t349_read_jobs ON dream.jobs FOR SELECT TO t349_authenticated
  USING (owner_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM dream.projects WHERE id=jobs.project_id));

GRANT SELECT (id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,
  approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at)
  ON dream.projects TO t349_authenticated;
GRANT SELECT (project_id,stage,status,approved_plan_id,approved_revision,approved_at,note)
  ON dream.stage_states TO t349_authenticated;
GRANT SELECT (project_id,status) ON dream.jobs TO t349_authenticated;

CREATE VIEW t349_private.project_data WITH (security_invoker=true) AS
SELECT p.*,
  ARRAY(SELECT j.status FROM dream.jobs j WHERE j.project_id=p.id ORDER BY j.status) AS jobs,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'projectId',s.project_id,'stage',s.stage,'status',s.status,'approvedPlanId',s.approved_plan_id,
    'approvedRevision',s.approved_revision,'approvedAt',to_char(s.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'note',s.note) ORDER BY s.stage) FROM dream.stage_states s WHERE s.project_id=p.id),'[]'::jsonb) AS states
FROM (SELECT id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,
  approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at FROM dream.projects) p;
GRANT SELECT ON t349_private.project_data TO t349_authenticated;

CREATE VIEW t349_api.project_list WITH (security_invoker=true) AS
SELECT id,title,menu_id AS "menuId",template_snapshot_json::jsonb#>>'{menu,label}' AS "menuLabel",
  aspect,length_sec AS "lengthSec",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
  jobs,states FROM t349_private.project_data;

CREATE VIEW t349_api.project_detail WITH (security_invoker=true) AS
SELECT id, jsonb_build_object('id',id,'menuId',menu_id,'templateVersion',template_version,
  'templateSnapshotJson',template_snapshot_json,'inputsJson',inputs_json,'title',title,'goal',goal,'target',target,
  'aspect',aspect,'lengthSec',length_sec,'approvedPlanId',approved_plan_id,'contentRevision',content_revision,
  'currentTimelineRevId',current_timeline_rev_id,'archivedAt',to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS project,
  template_snapshot_json::jsonb AS snapshot,inputs_json::jsonb AS inputs,states
FROM t349_private.project_data;
GRANT SELECT ON t349_api.project_list,t349_api.project_detail TO t349_authenticated;
