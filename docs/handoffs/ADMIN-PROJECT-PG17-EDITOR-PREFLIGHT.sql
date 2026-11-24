BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

WITH actor AS (
  SELECT oid, rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin,
         rolinherit, rolcreatedb, rolreplication
  FROM pg_roles
  WHERE rolname = session_user
), auth_id AS (
  SELECT a.attnotnull, a.atttypid = 'uuid'::regtype AS is_uuid,
         EXISTS (
           SELECT FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisunique
             AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum
         ) AS unique_id
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('auth.users') AND a.attname = 'id' AND NOT a.attisdropped
), gateway AS (
  SELECT name, to_regrole(name)::oid AS oid
  FROM (VALUES ('anon'), ('authenticated'), ('authenticator')) AS required(name)
), reserved AS (
  SELECT name, to_regnamespace(name) IS NOT NULL AS present
  FROM (VALUES ('dream'), ('dream_migrations'), ('project_read'), ('project_read_private')) AS required(name)
)
SELECT jsonb_build_object(
  'database', current_database(), 'server_port', inet_server_port(),
  'server_version_num', current_setting('server_version_num')::int,
  'server_encoding', current_setting('server_encoding'), 'in_recovery', pg_is_in_recovery(),
  'session_user', session_user, 'current_user', current_user,
  'transaction_read_only', current_setting('transaction_read_only'),
  'db_session_ssl', (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
  'role_flags', (SELECT to_jsonb(actor) - 'oid' - 'rolname' FROM actor),
  'database_create', has_database_privilege(current_database(), 'CREATE'),
  'auth_schema_usage', has_schema_privilege(to_regnamespace('auth')::oid, 'USAGE'),
  'auth_users_references', has_table_privilege(to_regclass('auth.users')::oid, 'REFERENCES'),
  'auth_users_id', (SELECT to_jsonb(auth_id) FROM auth_id),
  'auth_uid', (SELECT jsonb_build_object('uuid', p.prorettype = 'uuid'::regtype,
                   'returns_set', p.proretset, 'volatility', p.provolatile,
                   'authenticated_can_execute', has_function_privilege((SELECT oid FROM gateway WHERE name = 'authenticated'), p.oid, 'EXECUTE'))
               FROM pg_proc p WHERE p.oid = to_regprocedure('auth.uid()')),
  'gateway_roles', (SELECT jsonb_object_agg(g.name, CASE WHEN r.oid IS NULL THEN NULL ELSE
                       jsonb_build_object('login', r.rolcanlogin, 'superuser', r.rolsuper,
                         'bypass_rls', r.rolbypassrls, 'create_role', r.rolcreaterole,
                         'gateway_can_set', pg_has_role((SELECT oid FROM gateway WHERE name = 'authenticator'), r.oid, 'SET')) END)
                   FROM gateway g LEFT JOIN pg_roles r USING (oid)),
  'reserved_schema_presence', (SELECT jsonb_object_agg(name, present) FROM reserved),
  'history_present', to_regclass('dream_migrations.history') IS NOT NULL,
  'reserved_roles', (SELECT coalesce(jsonb_agg(rolname ORDER BY rolname), '[]'::jsonb) FROM pg_roles
    WHERE rolname IN ('dream_api','dream_worker','dream_api_login','dream_worker_login')),
  'nonowner_default_grants', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema', n.nspname,
      'object_type', d.defaclobjtype, 'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege', a.privilege_type, 'regrant', a.is_grantable)), '[]'::jsonb)
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = (SELECT oid FROM actor) AND a.grantee <> d.defaclrole
      AND (d.defaclnamespace = 0 OR n.nspname IN ('dream','dream_migrations','project_read','project_read_private')))
) AS activation_preflight;

ROLLBACK;
