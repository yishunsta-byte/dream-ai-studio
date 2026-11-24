-- v1 schema, pg_class and routine inventory, including the approval primary key.
-- Other catalog classes and the individual objects' behavior require separate review.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH expected(path, kind, marker) AS (
  VALUES
    ('project_read','schema','Dream project HTTPS read candidate v1 profile'),
    ('project_read_private','schema','Dream project HTTPS read candidate v1 private'),
    ('project_read.project_list','v','Dream project HTTPS read candidate v1 relation'),
    ('project_read.project_detail','v','Dream project HTTPS read candidate v1 relation'),
    ('project_read_private.project_data','v','Dream project HTTPS read candidate v1 relation'),
    ('project_read_private.approved_users','r','Dream project HTTPS read candidate v1 relation'),
    ('project_read_private.approved_users_pkey','i',NULL)
), namespaces AS (
  SELECT * FROM pg_namespace WHERE nspname IN ('project_read','project_read_private')
), actual(path, kind, marker, owner_oid) AS (
  SELECT nspname::text, 'schema', obj_description(oid,'pg_namespace'), nspowner FROM namespaces
  UNION ALL
  SELECT n.nspname || '.' || quote_ident(c.relname), c.relkind::text,
         obj_description(c.oid,'pg_class'), c.relowner
  FROM namespaces n JOIN pg_class c ON c.relnamespace = n.oid
  UNION ALL
  SELECT n.nspname || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'routine', NULL, p.proowner
  FROM namespaces n JOIN pg_proc p ON p.pronamespace = n.oid
), base_owner AS (
  SELECT CASE WHEN count(*)=3 AND count(DISTINCT relowner)=1 THEN (array_agg(relowner))[1] END AS oid
  FROM pg_class WHERE relnamespace=to_regnamespace('dream') AND relkind='r'
    AND relname IN ('projects','jobs','stage_states')
)
SELECT coalesce(e.path,a.path) AS object_path, e.kind AS expected_kind, a.kind AS observed_kind,
       CASE WHEN e.path IS NULL THEN 'unexpected'
            WHEN a.path IS NULL THEN 'missing'
            WHEN a.kind <> e.kind OR (e.marker IS NOT NULL AND a.marker IS DISTINCT FROM e.marker)
              THEN 'mismatch'
            WHEN b.oid IS NULL THEN 'owner unverified'
            WHEN b.oid <> a.owner_oid THEN 'mismatch'
            ELSE 'match' END AS result
FROM expected e FULL JOIN actual a USING(path) CROSS JOIN base_owner b
ORDER BY object_path;
ROLLBACK;
