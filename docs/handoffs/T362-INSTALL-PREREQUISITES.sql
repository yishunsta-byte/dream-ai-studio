-- Compare the v1 installer prerequisites using only system catalogs.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH required(relation, type_name, columns) AS (
  VALUES
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
), base AS (
  SELECT c.oid, c.relname, c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='dream' AND c.relkind='r' AND c.relname IN ('projects','jobs','stage_states')
), owner_check AS (
  SELECT CASE WHEN count(*)=3 AND count(DISTINCT relowner)=1 THEN (array_agg(relowner))[1] END AS oid FROM base
), uid_function AS (
  SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='auth' AND p.proname='uid' AND p.pronargs=0
), checks(item, expected, observed) AS (
  SELECT 'PostgreSQL 17 or newer','true',(current_setting('server_version_num')::int >= 170000)::text
  UNION ALL
  SELECT 'base table common owner has database CREATE','true',
         has_database_privilege(oid,current_database(),'CREATE')::text FROM owner_check
  UNION ALL
  SELECT 'auth.uid() is a nonvolatile scalar UUID function','true',
         (SELECT (prokind='f' AND prorettype='uuid'::regtype AND NOT proretset AND provolatile IN ('s','i'))::text FROM uid_function)
  UNION ALL
  SELECT 'authenticated can execute auth.uid()','true',
         has_function_privilege((SELECT oid FROM pg_roles WHERE rolname='authenticated'),
                                (SELECT oid FROM uid_function),'EXECUTE')::text
  UNION ALL
  SELECT r.relation || '.' || w.name, format_type(to_regtype(r.type_name),NULL),
         CASE WHEN b.oid IS NOT NULL THEN coalesce(format_type(a.atttypid,NULL),'missing') END
  FROM required r CROSS JOIN LATERAL unnest(r.columns) w(name)
  LEFT JOIN base b ON b.relname=r.relation
  LEFT JOIN pg_attribute a ON a.attrelid=b.oid AND a.attname=w.name AND a.attnum>0 AND NOT a.attisdropped
)
SELECT item, expected, observed,
       CASE WHEN observed IS NULL THEN 'unverified'
            WHEN observed=expected THEN 'match' ELSE 'mismatch' END AS result
FROM checks ORDER BY item;
ROLLBACK;
