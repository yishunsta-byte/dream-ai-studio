-- PG17 catalog check for the role conditions in project-https-read/0001_install.sql.
-- Run in an approved catalog session. No role switch or application-row read.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH actors AS (
  SELECT w.name, r.oid, r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole
  FROM (VALUES ('anon'), ('authenticated'), ('authenticator')) w(name)
  LEFT JOIN pg_roles r ON r.rolname = w.name
), base AS (
  SELECT w.name, c.relowner
  FROM (VALUES ('projects'), ('stage_states'), ('jobs')) w(name)
  LEFT JOIN pg_namespace n ON n.nspname = 'dream'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = w.name AND c.relkind = 'r'
), checks(actor, condition, target, expected, observed) AS (
  SELECT name, 'LOGIN', name, false, rolcanlogin FROM actors WHERE name <> 'authenticator'
  UNION ALL
  SELECT a.name, p.attribute, a.name, false, p.enabled
  FROM actors a CROSS JOIN LATERAL (VALUES
    ('SUPERUSER', a.rolsuper), ('BYPASSRLS', a.rolbypassrls), ('CREATEROLE', a.rolcreaterole)
  ) p(attribute,enabled)
  UNION ALL
  SELECT src.name, p.action, dst.name, p.expected, pg_has_role(src.oid, dst.oid, p.action)
  FROM (VALUES ('authenticator','anon','SET',true), ('authenticator','authenticated','SET',true),
               ('anon','authenticated','MEMBER',false), ('anon','authenticator','MEMBER',false),
               ('authenticated','authenticator','MEMBER',false)) p(source,destination,action,expected)
  JOIN actors src ON src.name = p.source JOIN actors dst ON dst.name = p.destination
  UNION ALL
  SELECT a.name, 'MEMBER', w.name, false, pg_has_role(a.oid, r.oid, 'MEMBER')
  FROM actors a CROSS JOIN (VALUES ('dream_api'), ('dream_worker')) w(name)
  LEFT JOIN pg_roles r ON r.rolname = w.name
  UNION ALL
  SELECT a.name, 'MEMBER OF TABLE OWNER', b.name, false, pg_has_role(a.oid, b.relowner, 'MEMBER')
  FROM actors a CROSS JOIN base b
  UNION ALL
  SELECT 'installer', 'COMMON BASE TABLE OWNER', 'dream', true,
         CASE WHEN count(relowner) = 3 THEN count(DISTINCT relowner) = 1 END FROM base
  UNION ALL
  SELECT name, 'SCHEMA USAGE', 'dream', false,
         has_schema_privilege(oid, to_regnamespace('dream')::oid, 'USAGE') FROM actors
  UNION ALL
  SELECT a.name, 'SET TO PRIVILEGED ROLE', r.rolname, false, pg_has_role(a.oid, r.oid, 'SET')
  FROM actors a CROSS JOIN pg_roles r
  WHERE a.name IN ('anon','authenticated') AND (r.rolsuper OR r.rolbypassrls
    OR has_schema_privilege(r.oid, to_regnamespace('dream')::oid, 'USAGE'))
), findings AS (
  SELECT actor, condition, target, expected, observed,
         CASE WHEN observed IS NULL THEN 'unverified' ELSE 'mismatch' END AS result
  FROM checks WHERE observed IS DISTINCT FROM expected
)
SELECT * FROM findings
UNION ALL
SELECT NULL, NULL, NULL, NULL, NULL, 'match' WHERE NOT EXISTS (SELECT FROM findings)
ORDER BY result, actor, condition, target;

ROLLBACK;
