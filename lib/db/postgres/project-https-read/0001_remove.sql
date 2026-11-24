-- Disable the app flag and withdraw the Data API profile first. This script
-- removes v1 and deletes its approval list. Export that list separately if needed.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 1);
LOCK TABLE dream.projects, dream.stage_states, dream.jobs IN SHARE UPDATE EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_namespace
      WHERE nspowner = to_regrole(current_user) AND
       ((nspname = 'project_read' AND obj_description(oid,'pg_namespace') = 'Dream project HTTPS read candidate v1 profile') OR
        (nspname = 'project_read_private' AND obj_description(oid,'pg_namespace') = 'Dream project HTTPS read candidate v1 private'))) <> 2 THEN
    RAISE EXCEPTION 'project HTTPS read v1: version markers missing or installer changed';
  END IF;
  IF (SELECT count(*) FROM pg_class
      WHERE relowner = to_regrole(current_user) AND obj_description(oid,'pg_class') = 'Dream project HTTPS read candidate v1 relation'
        AND ((relkind = 'r' AND oid = to_regclass('project_read_private.approved_users')) OR
             (relkind = 'v' AND oid IN (to_regclass('project_read_private.project_data'),
               to_regclass('project_read.project_list'),to_regclass('project_read.project_detail'))))) <> 4 OR
     (SELECT count(*) FROM pg_policy WHERE polname = 'project_https_read_v1'
       AND polrelid IN ('dream.projects'::regclass,'dream.stage_states'::regclass,'dream.jobs'::regclass)
       AND polcmd = 'r' AND polpermissive AND polroles = ARRAY['authenticated'::regrole::oid]
       AND obj_description(oid,'pg_policy') = 'Dream project HTTPS read candidate v1 policy') <> 3 THEN
    RAISE EXCEPTION 'project HTTPS read v1: candidate objects or policies are incomplete';
  END IF;
END
$preflight$;

DROP VIEW project_read.project_list, project_read.project_detail RESTRICT;
DROP VIEW project_read_private.project_data RESTRICT;

DROP POLICY project_https_read_v1 ON dream.jobs;
DROP POLICY project_https_read_v1 ON dream.stage_states;
DROP POLICY project_https_read_v1 ON dream.projects;

REVOKE SELECT (project_id,status) ON dream.jobs FROM authenticated RESTRICT;
REVOKE SELECT (project_id,stage,status,approved_plan_id,approved_revision,approved_at,note) ON dream.stage_states FROM authenticated RESTRICT;
REVOKE SELECT (id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,
  approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at) ON dream.projects FROM authenticated RESTRICT;

DROP TABLE project_read_private.approved_users RESTRICT;
DROP SCHEMA project_read, project_read_private RESTRICT;
COMMIT;
