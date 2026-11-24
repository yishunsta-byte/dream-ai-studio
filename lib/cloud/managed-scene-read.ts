import "server-only";
import { Pool } from "pg";
import { authMode, supabasePublicConfig } from "@/lib/auth/config";
import type { ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { PostgresAccessError } from "@/lib/db/postgres/types";

// P2 managed scene read (candidate). A dedicated read-only LOGIN (lib/db/postgres/managed-scene-read/0001_install.sql)
// selected only by DREAM_SCENE_READ_BACKEND; the same Supabase project and host rules as the managed project core.
type Env = Readonly<Record<string, string | undefined>>;
export const sceneReadRole = "dream_scene_read_app";
const backend = "supabase-postgres";

function boundPublicKey(key: string, ref: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) return true;
  if (key.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const value = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return value?.role === "anon" && value.ref === ref;
  } catch { return false; }
}

export function managedSceneReadConfig(env: Env) {
  if (env.DREAM_SCENE_READ_BACKEND !== backend || authMode(env) !== "supabase") return null;
  const auth = supabasePublicConfig(env);
  const ref = auth?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  const raw = env.DREAM_SCENE_READ_DB_URL;
  if (!auth || !ref || !raw || !boundPublicKey(auth.anonKey, ref)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname, user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const direct = host === "db." + ref + ".supabase.co" && user === sceneReadRole;
    const session = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === sceneReadRole + "." + ref;
    if ((!direct && !session) || !["postgresql:", "postgres:"].includes(url.protocol) || url.port !== "5432" ||
      url.pathname !== "/postgres" || !password || url.search || url.hash) return null;
    const ca = env.DREAM_SCENE_READ_DB_CA?.trim();
    return { ref, host, port: 5432, user, password, database: "postgres",
      ssl: { rejectUnauthorized: true, servername: host, ...(ca && { ca }) } };
  } catch { return null; }
}

// Every request re-checks the installation and that the login can only read the listed columns.
const installation = `SELECT EXISTS (SELECT FROM dream_scene_read.installation WHERE version=1 AND project_ref=$1)
  AND current_user::text=$2 AND current_user=session_user AND current_database()='postgres'
  AND current_setting('server_version_num')::int/10000=17 AND current_setting('server_encoding')='UTF8'
  AND EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND EXISTS (SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.set_option OR m.inherit_option))))
  AND 5=(SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.stage_states'::regclass,
    'dream.plans'::regclass,'dream.scenes'::regclass,'dream.scene_versions'::regclass)
    AND c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(c.relowner,'USAGE'))
  AND 5=(SELECT count(*) FROM pg_policy p WHERE p.polpermissive AND current_user::regrole::oid=ANY(p.polroles) AND p.polcmd='r'
    AND (p.polrelid,p.polname) IN (('dream.projects'::regclass,'scene_read'),('dream.stage_states'::regclass,'scene_read'),
      ('dream.plans'::regclass,'scene_read'),('dream.scenes'::regclass,'scene_read'),('dream.scene_versions'::regclass,'scene_read')))
  AND NOT EXISTS (SELECT FROM pg_policy p WHERE current_user::regrole::oid=ANY(p.polroles) AND p.polcmd<>'r')
  AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('dream','dream_scene_read','dream_project_core','managed_project_plan','local_plan_materials') AND c.relkind IN ('r','v','m','p','f','S')
      AND (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES')))
  AND NOT has_column_privilege('dream.scene_versions','input_snapshot_json','SELECT')
  AND NOT has_any_column_privilege('dream.assets','SELECT')
  AND NOT has_schema_privilege('dream','CREATE') AND NOT has_schema_privilege('dream_scene_read','CREATE') AS ready`;

export function sceneReadSession(ref: string): NonNullable<ActorTransactionOptions["prepareSession"]> {
  return async client => {
    await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='6s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const { rows: [state] } = await client.query<{ ready: boolean }>(installation, [ref, sceneReadRole]);
    if (!state?.ready) throw new PostgresAccessError("PG_CONFIG");
  };
}

export type ManagedSceneReadConnection = { pool: Pick<Pool, "connect">; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> };
let runtime: { signature: string; connection: ManagedSceneReadConnection } | undefined;
export function openManagedSceneRead(env: Env = process.env): ManagedSceneReadConnection | null {
  const config = managedSceneReadConfig(env);
  if (!config) return null;
  const signature = JSON.stringify(config);
  if (runtime) return runtime.signature === signature ? runtime.connection : null;
  const { ref, ...credentials } = config;
  const pool = new Pool({ ...credentials, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Idle connection failures are private. */ });
  runtime = { signature, connection: { pool, prepareSession: sceneReadSession(ref) } };
  return runtime.connection;
}
