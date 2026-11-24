-- PG17, existing approved catalog session. Checks the v1 read grants in
-- 0001_install.sql. Results describe privileges of each current role, including
-- inherited grants. SET ROLE reachability, RLS and view definitions are separate.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH roles AS (
  SELECT name, r.oid
  FROM (VALUES ('anon'), ('authenticated'), ('authenticator')) AS wanted(name)
  LEFT JOIN pg_roles r ON r.rolname = wanted.name
), objects(schema_name, relation_name, table_read, read_columns) AS (
  VALUES
    ('project_read', 'project_list', true, ARRAY[]::text[]),
    ('project_read', 'project_detail', true, ARRAY[]::text[]),
    ('project_read_private', 'project_data', true, ARRAY[]::text[]),
    ('project_read_private', 'approved_users', false, ARRAY['id']),
    ('dream', 'jobs', false, ARRAY['project_id','status']),
    ('dream', 'stage_states', false, ARRAY['project_id','stage','status','approved_plan_id',
      'approved_revision','approved_at','note']),
    ('dream', 'projects', false, ARRAY['id','menu_id','template_version','template_snapshot_json',
      'inputs_json','title','goal','target','aspect','length_sec','approved_plan_id','content_revision',
      'current_timeline_rev_id','archived_at','created_at','updated_at'])
), relations AS (
  SELECT o.*, c.oid, o.schema_name || '.' || o.relation_name AS path
  FROM objects o
  LEFT JOIN pg_namespace n ON n.nspname = o.schema_name
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = o.relation_name
), columns_to_check AS (
  SELECT rel.path, rel.oid, names.column_name, a.attnum,
         rel.table_read OR names.column_name = ANY(rel.read_columns) AS allowed
  FROM relations rel
  CROSS JOIN LATERAL (
    SELECT unnest(rel.read_columns) AS column_name
    UNION
    SELECT attname::text FROM pg_attribute
    WHERE attrelid = rel.oid AND attnum > 0 AND NOT attisdropped
  ) names
  LEFT JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attname = names.column_name
                          AND a.attnum > 0 AND NOT a.attisdropped
), checks AS (
  SELECT r.name, s.schema_name AS object_name, 'USAGE' AS privilege,
         r.name = 'authenticated' AND s.schema_name = 'project_read' AS expected,
         has_schema_privilege(r.oid, n.oid, 'USAGE') AS observed
  FROM roles r CROSS JOIN (SELECT DISTINCT schema_name FROM objects) s
  LEFT JOIN pg_namespace n ON n.nspname = s.schema_name
  UNION ALL
  SELECT r.name, rel.path, 'SELECT', r.name = 'authenticated' AND rel.table_read,
         has_table_privilege(r.oid, rel.oid, 'SELECT')
  FROM roles r CROSS JOIN relations rel
  UNION ALL
  SELECT r.name, col.path || '.' || col.column_name, 'SELECT',
         r.name = 'authenticated' AND col.allowed,
         has_column_privilege(r.oid, col.oid, col.attnum, 'SELECT')
  FROM roles r CROSS JOIN columns_to_check col
)
SELECT name AS role_name, object_name, privilege, expected, observed,
       CASE WHEN observed IS NULL THEN 'unverified'
            WHEN observed = expected THEN 'match' ELSE 'mismatch' END AS result
FROM checks
ORDER BY result DESC, role_name, object_name, privilege;

ROLLBACK;
