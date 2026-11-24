import "server-only";
import { Pool } from "pg";
import { authMode, supabasePublicConfig } from "@/lib/auth/config";
import type { ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { PostgresAccessError } from "@/lib/db/postgres/types";

type Env = Readonly<Record<string, string | undefined>>;
const role = "dream_project_core_app";
const backend = "supabase-postgres";

function boundPublicKey(key: string, ref: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) return true;
  if (key.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const value = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return value?.role === "anon" && value.ref === ref;
  } catch { return false; }
}

export function managedProjectCoreConfig(env: Env) {
  if (env.DREAM_PROJECT_CORE_BACKEND !== backend || authMode(env) !== "supabase") return null;
  const auth = supabasePublicConfig(env);
  const ref = auth?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  const raw = env.DREAM_PROJECT_CORE_DB_URL;
  if (!auth || !ref || !raw || !boundPublicKey(auth.anonKey,ref)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname, user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const direct = host === "db." + ref + ".supabase.co" && user === role;
    const session = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === role + "." + ref;
    if ((!direct && !session) || !["postgresql:", "postgres:"].includes(url.protocol) || url.port !== "5432" ||
      url.pathname !== "/postgres" || !password || url.search || url.hash) return null;
    const ca = env.DREAM_PROJECT_CORE_DB_CA?.trim();
    return { ref, host, port: 5432, user, password, database: "postgres",
      ssl: { rejectUnauthorized: true, servername: host, ...(ca && {ca}) } };
  } catch { return null; }
}

const installation = `SELECT EXISTS (
    SELECT FROM dream_project_core.installation WHERE version=1 AND project_ref=$1
  ) AND current_user::text=$2 AND current_user=session_user AND current_database()='postgres'
  AND current_setting('server_version_num')::int/10000=17 AND current_setting('server_encoding')='UTF8'
  AND EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND EXISTS (
    SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
      AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.set_option OR m.inherit_option)))
  ) AND 17=(
    SELECT count(*) FROM pg_class c WHERE c.oid IN (
      'dream.projects'::regclass,'dream.stage_states'::regclass,'dream.jobs'::regclass,'dream.renders'::regclass,
      'dream.plans'::regclass,'dream.timeline_revisions'::regclass,'dream.assets'::regclass,
      'dream.characters'::regclass,'dream.project_assets'::regclass,'dream.project_characters'::regclass,'dream.activity_log'::regclass,
      'dream.storage_objects'::regclass,'dream.storage_verification_operations'::regclass,'dream.storage_verification_receipts'::regclass,
      'dream.asset_receipt_state'::regclass,'dream.storage_policies'::regclass,'dream_project_core.requests'::regclass
    ) AND c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(c.relowner,'USAGE')
  )
  AND EXISTS (SELECT FROM pg_policy WHERE polrelid='dream.stage_states'::regclass AND polname='core_brief'
    AND polcmd='w' AND polroles=ARRAY[current_user::regrole::oid])
  AND EXISTS (SELECT FROM pg_policy WHERE polrelid='dream_project_core.requests'::regclass AND polname='core_insert'
    AND polcmd='a' AND polroles=ARRAY[current_user::regrole::oid])
  AND has_table_privilege('dream_project_core.requests','SELECT') AND has_table_privilege('dream_project_core.requests','INSERT')
  AND NOT has_any_column_privilege('dream_project_core.requests','UPDATE')
  AND NOT has_table_privilege('dream_project_core.requests','DELETE,TRUNCATE')
  AND NOT has_table_privilege('dream_project_core.installation','INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_column_privilege('dream.projects','owner_id','UPDATE')
  AND NOT has_column_privilege('dream.projects','content_revision','UPDATE')
  AND NOT has_column_privilege('dream.projects','approved_plan_id','UPDATE')
  AND NOT has_column_privilege('dream.stage_states','approved_plan_id','UPDATE')
  AND NOT has_any_column_privilege('dream.plans','INSERT,UPDATE')
  AND NOT has_any_column_privilege('dream.scenes','SELECT,INSERT,UPDATE')
  AND NOT EXISTS (SELECT FROM pg_policy WHERE polrelid IN ('dream.renders'::regclass,'dream.plans'::regclass,'dream.timeline_revisions'::regclass)
    AND polroles && ARRAY[0::oid,current_user::regrole::oid])
  AND NOT has_any_column_privilege('dream.renders','INSERT,UPDATE')
  AND NOT has_any_column_privilege('dream.timeline_revisions','INSERT,UPDATE')
  AND NOT has_schema_privilege('dream','CREATE') AND NOT has_schema_privilege('dream_project_core','CREATE')
  AS ready`;

type ManagedConnection = { pool: Pool; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> };
let runtime: { signature: string; connection: ManagedConnection } | undefined;
export function openManagedProjectCore(env: Env = process.env): ManagedConnection | null {
  const config = managedProjectCoreConfig(env);
  if (!config) return null;
  const signature = JSON.stringify(config);
  if (runtime) return runtime.signature === signature ? runtime.connection : null;
  const { ref, ...credentials } = config;
  const pool = new Pool({ ...credentials, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Idle connection failures are private. */ });
  const prepareSession: ManagedConnection["prepareSession"] = async client => {
    await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='6s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const { rows: [state] } = await client.query<{ready: boolean}>(installation, [ref,role]);
    if (!state?.ready) throw new PostgresAccessError("PG_CONFIG");
  };
  runtime = { signature, connection:{pool,prepareSession} };
  return runtime.connection;
}
