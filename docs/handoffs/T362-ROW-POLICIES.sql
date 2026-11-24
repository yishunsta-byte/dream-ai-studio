-- Compare v1 SELECT policies with their PG17.12 catalog representation.
-- Run as an approved catalog reader. A mismatch requires review before use.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH expected(schema_name, table_name, predicate) AS (
  VALUES
    ('project_read_private', 'approved_users', '(id = ( SELECT auth.uid() AS uid))'),
    ('dream', 'jobs', '((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM dream.projects WHERE (projects.id = jobs.project_id))))'),
    ('dream', 'stage_states', '((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM dream.projects WHERE (projects.id = stage_states.project_id))))'),
    ('dream', 'projects', '((owner_id = ( SELECT auth.uid() AS uid)) AND (archived_at IS NULL) AND (EXISTS ( SELECT 1 FROM project_read_private.approved_users WHERE (approved_users.id = ( SELECT auth.uid() AS uid)))))')
), targets AS (
  SELECT e.*, c.oid, c.relrowsecurity, c.relforcerowsecurity, r.oid AS auth_oid,
         CASE WHEN e.schema_name = 'dream' THEN 'project_https_read_v1' ELSE 'read_own_approval' END AS policy_name
  FROM expected e
  LEFT JOIN pg_namespace n ON n.nspname = e.schema_name
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name AND c.relkind = 'r'
  LEFT JOIN pg_roles r ON r.rolname = 'authenticated'
), checks AS (
  SELECT t.schema_name, t.table_name, t.policy_name, check_value.item,
         CASE WHEN t.oid IS NULL OR t.auth_oid IS NULL THEN NULL ELSE check_value.ok END AS ok
  FROM targets t
  LEFT JOIN pg_policy p ON p.polrelid = t.oid AND p.polname = t.policy_name
  CROSS JOIN LATERAL (VALUES
    ('RLS enabled', t.relrowsecurity),
    ('FORCE RLS matches v1', t.relforcerowsecurity = (t.schema_name = 'dream')),
    ('SELECT policy for authenticated', p.oid IS NOT NULL AND p.polcmd = 'r' AND
       p.polpermissive AND p.polroles = ARRAY[t.auth_oid] AND p.polwithcheck IS NULL),
    ('USING predicate', coalesce(regexp_replace(pg_get_expr(p.polqual,p.polrelid), '[[:space:]]+', ' ', 'g') = t.predicate,false)),
    ('policy version marker', t.schema_name <> 'dream' OR
       obj_description(p.oid,'pg_policy') IS NOT DISTINCT FROM 'Dream project HTTPS read candidate v1 policy')
  ) check_value(item,ok)
  UNION ALL
  SELECT t.schema_name, t.table_name, p.polname, 'additional applicable SELECT or ALL policy', false
  FROM targets t
  JOIN pg_policy p ON p.polrelid = t.oid AND p.polcmd IN ('r','*') AND p.polname <> t.policy_name
  WHERE EXISTS (
    SELECT FROM unnest(p.polroles) AS roles(role_oid)
    WHERE CASE WHEN role_oid = 0 THEN true ELSE pg_has_role(t.auth_oid, role_oid, 'USAGE') END
  )
)
SELECT schema_name, table_name, policy_name, item,
       CASE WHEN ok IS NULL THEN 'unverified' WHEN ok THEN 'match' ELSE 'mismatch' END AS result
FROM checks ORDER BY schema_name, table_name, policy_name, item;

ROLLBACK;
