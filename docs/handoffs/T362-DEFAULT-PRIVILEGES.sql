-- Scope: new schemas and relations created by the common base-table owner.
-- List non-owner default grants for manual review against the v1 installer.
-- Such a grant does not itself prove any existing object is exposed.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH installer AS (
  SELECT CASE WHEN count(*) = 3 AND count(DISTINCT relowner) = 1
              THEN (array_agg(relowner))[1] END AS oid
  FROM pg_class
  WHERE relnamespace = to_regnamespace('dream') AND relkind = 'r'
    AND relname IN ('projects','stage_states','jobs')
), grants AS (
  SELECT CASE d.defaclobjtype WHEN 'n' THEN 'schema' ELSE 'relation' END AS object_type,
         CASE WHEN d.defaclnamespace = 0 THEN 'global' ELSE n.nspname END AS scope,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
         a.privilege_type, a.is_grantable
  FROM installer i JOIN pg_default_acl d ON d.defaclrole = i.oid
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE a.grantee <> i.oid AND (
    (d.defaclnamespace = 0 AND d.defaclobjtype IN ('n','r')) OR
    (d.defaclobjtype = 'r' AND n.nspname IN ('dream','project_read','project_read_private'))
  )
)
SELECT 'review' AS result, object_type, scope, grantee, privilege_type, is_grantable
FROM grants
UNION ALL
SELECT CASE WHEN oid IS NULL THEN 'unverified' ELSE 'no non-owner default grants' END,
       NULL, NULL, NULL, NULL, NULL
FROM installer WHERE NOT EXISTS (SELECT FROM grants)
ORDER BY result, object_type, scope, grantee, privilege_type;

ROLLBACK;
