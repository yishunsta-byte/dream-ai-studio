-- Run in an approved PostgreSQL 17 catalog session. One row per effective
-- forbidden privilege. A clean check instead returns one 'match' row.
-- Tests existing objects and inherited privileges, not future default ACLs,
-- role switching, function execution, or RLS policy definitions.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH roles AS (
  SELECT wanted.name, r.oid
  FROM (VALUES ('anon'), ('authenticated'), ('authenticator')) wanted(name)
  LEFT JOIN pg_roles r ON r.rolname = wanted.name
), schemas AS (
  SELECT wanted.name, n.oid
  FROM (VALUES ('dream'), ('project_read'), ('project_read_private')) wanted(name)
  LEFT JOIN pg_namespace n ON n.nspname = wanted.name
), relations AS (
  SELECT s.name || '.' || wanted.name AS path, c.oid
  FROM (VALUES ('dream','projects'), ('dream','jobs'), ('dream','stage_states'),
               ('project_read','project_list'), ('project_read','project_detail'),
               ('project_read_private','project_data'), ('project_read_private','approved_users')
       ) wanted(schema_name,name)
  JOIN schemas s ON s.name = wanted.schema_name
  LEFT JOIN pg_class c ON c.relnamespace = s.oid AND c.relname = wanted.name
), checks AS (
  SELECT r.name AS role_name, s.name AS target, p.privilege,
         has_schema_privilege(r.oid, s.oid, p.privilege) AS observed
  FROM roles r CROSS JOIN schemas s
  CROSS JOIN (VALUES ('CREATE'), ('CREATE WITH GRANT OPTION'), ('USAGE WITH GRANT OPTION')) p(privilege)
  UNION ALL
  SELECT r.name, rel.path, p.privilege || opt.suffix,
         has_table_privilege(r.oid, rel.oid, p.privilege || opt.suffix)
  FROM roles r CROSS JOIN relations rel
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                     ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(privilege)
  CROSS JOIN (VALUES (''), (' WITH GRANT OPTION')) opt(suffix)
  WHERE p.privilege <> 'SELECT' OR opt.suffix <> ''
  UNION ALL
  SELECT r.name, rel.path || '.' || a.attname, p.privilege || opt.suffix,
         has_column_privilege(r.oid, rel.oid, a.attnum, p.privilege || opt.suffix)
  FROM roles r CROSS JOIN relations rel
  JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN (VALUES ('SELECT'), ('UPDATE'), ('INSERT'), ('REFERENCES')) p(privilege)
  CROSS JOIN (VALUES (''), (' WITH GRANT OPTION')) opt(suffix)
  WHERE p.privilege <> 'SELECT' OR opt.suffix <> ''
), findings AS (
  SELECT role_name, target, privilege,
         CASE WHEN observed THEN 'mismatch' ELSE 'unverified' END AS result
  FROM checks WHERE observed IS DISTINCT FROM false
)
SELECT * FROM findings
UNION ALL
SELECT NULL, NULL, NULL, 'match' WHERE NOT EXISTS (SELECT FROM findings)
ORDER BY result, role_name, target, privilege;

ROLLBACK;
