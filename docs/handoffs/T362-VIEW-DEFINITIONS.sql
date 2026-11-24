-- Read-only comparison with 0001_install.sql as installed on PG17.12.
-- Deparser differences between server builds can require manual review.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH expected(namespace, name, definition_hash) AS (
  VALUES
    ('project_read','project_list','4d392cc64c517ab4348357e729224d51c670dd4f40cca938aaecf383f5247322'),
    ('project_read','project_detail','21d9274faa0eeb74e066ff49d513fe6ca76ba720b26553b8118c8c79adbec982'),
    ('project_read_private','project_data','39721b4e11742a8d265c06da55714cfe30656072245fa11963d925a37f76d692')
), base_owner AS (
  SELECT CASE WHEN count(*) = 3 AND count(DISTINCT relowner) = 1
              THEN (array_agg(relowner))[1] END AS oid
  FROM pg_class WHERE relnamespace = to_regnamespace('dream') AND relkind = 'r'
    AND relname IN ('projects','stage_states','jobs')
), results AS (
  SELECT e.namespace, e.name, p.item, p.ok
  FROM expected e CROSS JOIN base_owner b
  LEFT JOIN pg_namespace n ON n.nspname = e.namespace
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
  CROSS JOIN LATERAL (VALUES
    ('view exists', c.relkind = 'v'),
    ('common base owner', c.relowner = b.oid),
    ('security_invoker', CASE WHEN c.relkind = 'v' THEN EXISTS (
       SELECT FROM pg_options_to_table(c.reloptions)
       WHERE option_name = 'security_invoker' AND option_value::boolean) END),
    ('v1 marker', CASE WHEN c.oid IS NOT NULL THEN obj_description(c.oid,'pg_class')
       IS NOT DISTINCT FROM 'Dream project HTTPS read candidate v1 relation' END),
    ('definition SHA-256', CASE WHEN c.relkind = 'v' THEN
       encode(sha256(convert_to(pg_get_viewdef(c.oid,false),'UTF8')),'hex') = e.definition_hash END)
  ) p(item,ok)
)
SELECT namespace, name, item,
       CASE WHEN ok IS NULL THEN 'unverified' WHEN ok THEN 'match' ELSE 'mismatch' END AS result
FROM results ORDER BY namespace, name, item;

ROLLBACK;
