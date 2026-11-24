import "server-only";
import { Pool } from "pg";
import { authMode, supabasePublicConfig } from "@/lib/auth/config";
import type { ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { PostgresAccessError } from "@/lib/db/postgres/types";

// P2 managed scene version selection (candidate). A dedicated LOGIN (lib/db/postgres/managed-scene-select/0001_install.sql)
// that can only EXECUTE dream_scene_select.select_version(), selected only by DREAM_SCENE_SELECT_BACKEND; the same
// Supabase project and host rules as the managed project core.
type Env = Readonly<Record<string, string | undefined>>;
export const sceneSelectRole = "dream_scene_select_app";
const backend = "supabase-postgres";

function boundPublicKey(key: string, ref: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) return true;
  if (key.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const value = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return value?.role === "anon" && value.ref === ref;
  } catch { return false; }
}

export function managedSceneSelectConfig(env: Env) {
  if (env.DREAM_SCENE_SELECT_BACKEND !== backend || authMode(env) !== "supabase") return null;
  const auth = supabasePublicConfig(env);
  const ref = auth?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  const raw = env.DREAM_SCENE_SELECT_DB_URL;
  if (!auth || !ref || !raw || !boundPublicKey(auth.anonKey, ref)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname, user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const direct = host === "db." + ref + ".supabase.co" && user === sceneSelectRole;
    const session = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === sceneSelectRole + "." + ref;
    if ((!direct && !session) || !["postgresql:", "postgres:"].includes(url.protocol) || url.port !== "5432" ||
      url.pathname !== "/postgres" || !password || url.search || url.hash) return null;
    const ca = env.DREAM_SCENE_SELECT_DB_CA?.trim();
    return { ref, host, port: 5432, user, password, database: "postgres",
      ssl: { rejectUnauthorized: true, servername: host, ...(ca && { ca }) } };
  } catch { return null; }
}

// Every request re-checks the installation and that the login can do nothing but run the selection function, and the
// writer-role guard the installer checked (role-guard block: same text as managed-scene-select/0001_install.sql), so a
// later SET/INHERIT membership on the writer or the app role, or a wider writer grant, fails closed before any write.
const installation = `SELECT EXISTS (SELECT FROM dream_scene_select.installation WHERE version=1 AND project_ref=$1)
  AND current_user::text=$2 AND current_user=session_user AND current_database()='postgres'
  AND current_setting('server_version_num')::int/10000=17 AND current_setting('server_encoding')='UTF8'
  AND EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND EXISTS (SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.set_option OR m.inherit_option))))
  AND (
  -- role-guard:begin (identical in lib/cloud/managed-scene-select.ts and managed-scene-select/0001_install.sql)
  EXISTS (SELECT FROM pg_roles w WHERE w.rolname='dream_scene_select_writer'
    AND NOT (w.rolcanlogin OR w.rolinherit OR w.rolsuper OR w.rolbypassrls OR w.rolcreaterole OR w.rolcreatedb OR w.rolreplication))
  AND NOT EXISTS (SELECT FROM pg_auth_members m
    WHERE m.member IN (to_regrole('dream_scene_select_writer'), to_regrole('dream_scene_select_app'))
      OR (m.roleid IN (to_regrole('dream_scene_select_writer'), to_regrole('dream_scene_select_app'))
        AND NOT (m.admin_option AND NOT m.set_option AND NOT m.inherit_option
          AND m.member = (SELECT i.relowner FROM pg_class i WHERE i.oid = to_regclass('dream_scene_select.installation')))))
  AND EXISTS (SELECT FROM pg_proc f WHERE f.oid = to_regprocedure('dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)')
    AND f.prosecdef AND f.proowner = to_regrole('dream_scene_select_writer'))
  AND NOT has_schema_privilege('dream_scene_select_writer', 'dream_scene_select', 'CREATE')
  AND NOT has_column_privilege('dream_scene_select_writer', (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dream' AND c.relname='scene_versions'), 'input_snapshot_json', 'SELECT')
  AND NOT has_column_privilege('dream_scene_select_writer', (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dream' AND c.relname='assets'), 'file_path', 'SELECT')
  AND NOT has_any_column_privilege('dream_scene_select_writer', (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dream' AND c.relname='assets'), 'INSERT')
  -- role-guard:end
  ) IS TRUE
  AND EXISTS (SELECT FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace JOIN pg_roles o ON o.oid=f.proowner
    WHERE n.nspname='dream_scene_select' AND f.proname='select_version' AND f.prosecdef
      AND f.oid='dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure
      AND o.rolname='dream_scene_select_writer' AND NOT o.rolcanlogin AND NOT o.rolinherit AND NOT (o.rolsuper OR o.rolbypassrls)
      AND has_function_privilege(f.oid,'EXECUTE') AND NOT has_function_privilege('public',f.oid,'EXECUTE'))
  -- One known install state for the function's project lookup and the writer's two project policies together:
  -- 0001 (shopping-shorts) or 0001+0002 (both menus). Without 0002 a topic-shorts project is NOT_FOUND; a mix fails closed.
  AND ((EXISTS (SELECT FROM pg_proc f WHERE f.oid='dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure
        AND f.prosrc LIKE '%p.menu_id IN (''shopping-shorts'',''topic-shorts'')%' AND f.prosrc NOT LIKE '%p.menu_id=''shopping-shorts''%')
      AND 2=(SELECT count(*) FROM pg_policy p WHERE p.polrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname='projects')
        AND p.polname IN ('scene_select_read','scene_select_write') AND p.polroles=ARRAY[to_regrole('dream_scene_select_writer')::oid]
        AND pg_get_expr(p.polqual,p.polrelid) LIKE '%menu_id = ANY (ARRAY[''shopping-shorts''::text, ''topic-shorts''::text])%' AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%(menu_id = ''shopping-shorts''::text)%'))
    OR (EXISTS (SELECT FROM pg_proc f WHERE f.oid='dream_scene_select.select_version(uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure
        AND f.prosrc LIKE '%p.menu_id=''shopping-shorts''%' AND f.prosrc NOT LIKE '%topic-shorts%')
      AND 2=(SELECT count(*) FROM pg_policy p WHERE p.polrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname='projects')
        AND p.polname IN ('scene_select_read','scene_select_write') AND p.polroles=ARRAY[to_regrole('dream_scene_select_writer')::oid]
        AND pg_get_expr(p.polqual,p.polrelid) LIKE '%(menu_id = ''shopping-shorts''::text)%' AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%topic-shorts%')))
  AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('dream','dream_scene_select','dream_project_core','managed_project_plan','local_plan_materials')
      AND c.relkind IN ('r','v','m','p','f','S') AND c.oid<>'dream_scene_select.installation'::regclass
      AND (has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  AND NOT EXISTS (SELECT FROM pg_policy p WHERE current_user::regrole::oid=ANY(p.polroles))
  AND NOT has_schema_privilege('dream','USAGE') AND NOT has_schema_privilege('dream_scene_select','CREATE') AS ready`;

export function sceneSelectSession(ref: string): NonNullable<ActorTransactionOptions["prepareSession"]> {
  return async client => {
    await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='6s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const { rows: [state] } = await client.query<{ ready: boolean }>(installation, [ref, sceneSelectRole]);
    if (!state?.ready) throw new PostgresAccessError("PG_CONFIG");
  };
}

export type ManagedSceneSelectConnection = { pool: Pick<Pool, "connect">; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> };
let runtime: { signature: string; connection: ManagedSceneSelectConnection } | undefined;
export function openManagedSceneSelect(env: Env = process.env): ManagedSceneSelectConnection | null {
  const config = managedSceneSelectConfig(env);
  if (!config) return null;
  const signature = JSON.stringify(config);
  if (runtime) return runtime.signature === signature ? runtime.connection : null;
  const { ref, ...credentials } = config;
  const pool = new Pool({ ...credentials, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Idle connection failures are private. */ });
  runtime = { signature, connection: { pool, prepareSession: sceneSelectSession(ref) } };
  return runtime.connection;
}
