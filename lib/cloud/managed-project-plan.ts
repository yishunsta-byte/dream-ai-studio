import "server-only";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { authMode, supabasePublicConfig } from "../auth/config";

type Env = Record<string, string | undefined>;
const role = "dream_plan_app";
const guard = "dream_plan_guard";
const approvalRole = "dream_plan_approver";
export const managedPlanMaxBytes = 4 * 1024 * 1024;
export const managedPlanBackend = "supabase-postgres";

export function managedPlanUnavailable() {
  return Response.json({ code: "MANAGED_PLAN_UNAVAILABLE", error: "기획 저장소 연결을 확인해 주세요." },
    { status: 503, headers: { "cache-control": "private, no-store" } });
}

function managedPlanApprovalUnavailable() {
  return Response.json({ code: "MANAGED_PLAN_APPROVAL_UNAVAILABLE", error: "기획 승인 연결을 확인해 주세요." },
    { status: 503, headers: { "cache-control": "private, no-store" } });
}

function boundPublicKey(key: string, ref: string) {
  if (/^sb_publishable_[a-zA-Z0-9_-]{16,256}$/.test(key)) return true;
  if (key.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const value = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    return value?.role === "anon" && value.ref === ref;
  } catch { return false; }
}

function planConfiguration(env: Env, role: string, dsn?: string, certificate?: string) {
  if (env.DREAM_PROJECT_PLAN_BACKEND !== managedPlanBackend || authMode(env) !== "supabase") return null;
  const auth = supabasePublicConfig(env);
  const ref = auth?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!auth || !ref || !boundPublicKey(auth.anonKey, ref) || !dsn) return null;
  try {
    const url = new URL(dsn);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const host = url.hostname;
    const direct = host === `db.${ref}.supabase.co` && url.port === "5432" && user === role;
    const pooling = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) &&
      ["5432", "6543"].includes(url.port) && user === `${role}.${ref}`;
    if ((!direct && !pooling) || !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.pathname !== "/postgres" || !password || url.search || url.hash) return null;
    const ca = certificate?.trim();
    return { ref, host, port: Number(url.port), user, password, ssl: { rejectUnauthorized: true, servername: host, ...(ca && { ca }) } };
  } catch { return null; }
}

export function managedPlanConfiguration(env: Env = process.env) {
  return planConfiguration(env, role, env.DREAM_PROJECT_PLAN_DB_URL, env.DREAM_PROJECT_PLAN_DB_CA);
}

export function managedPlanApprovalConfiguration(env: Env = process.env) {
  if (env.DREAM_PROJECT_PLAN_APPROVAL_BACKEND !== managedPlanBackend) return null;
  return planConfiguration(env, approvalRole, env.DREAM_PROJECT_PLAN_APPROVAL_DB_URL, env.DREAM_PROJECT_PLAN_APPROVAL_DB_CA);
}

// PG17 can grant the role creator ADMIN with both SET and INHERIT disabled.
const installedSql = `SELECT EXISTS (
  SELECT FROM managed_project_plan.installation WHERE version=1 AND project_ref=$1
) AND $2=current_user AND current_user=session_user AND current_database()=$3
AND current_setting('server_version_num')::int / 10000=17 AND current_setting('server_encoding')='UTF8'
AND EXISTS (
  SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
    AND NOT EXISTS (SELECT FROM pg_auth_members m
      WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.inherit_option OR m.set_option)))
) AND 5=(
  SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.plans'::regclass,
    'dream.stage_states'::regclass,'dream.activity_log'::regclass,'local_plan_materials.drafts'::regclass)
    AND c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(c.relowner,'USAGE')
) AND 2=(
  SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_roles r ON r.oid=p.proowner
  WHERE NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND p.oid='managed_project_plan.protect_materials()'::regprocedure
    AND p.prosecdef AND p.proconfig@>ARRAY['search_path=pg_catalog'] AND r.rolname=$4
    AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
    AND NOT EXISTS (SELECT FROM pg_auth_members m
      WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.inherit_option OR m.set_option)))
    AND (t.tgrelid,t.tgname,t.tgtype) IN
      (('dream.plans'::regclass,'managed_plan_materials_guard',23),('local_plan_materials.drafts'::regclass,'managed_plan_materials_attach',7))
) AND 8=(
  SELECT count(*) FROM pg_policy p WHERE p.polpermissive AND current_user::regrole=ANY(p.polroles)
    AND (p.polrelid,p.polname,p.polcmd) IN (
      ('dream.projects'::regclass,'managed_plan_read','r'),('dream.projects'::regclass,'managed_plan_lock','w'),
      ('dream.stage_states'::regclass,'managed_plan_stage','r'),('dream.plans'::regclass,'managed_plan_read','r'),
      ('dream.plans'::regclass,'managed_plan_insert','a'),('local_plan_materials.drafts'::regclass,'managed_plan_read','r'),
      ('local_plan_materials.drafts'::regclass,'managed_plan_insert','a'),('dream.activity_log'::regclass,'managed_plan_log','a'))
) AND 2=(
  SELECT count(*) FROM pg_policy p WHERE p.polpermissive AND $4::regrole=ANY(p.polroles)
    AND p.polname='managed_plan_guard_read' AND p.polcmd='r'
    AND p.polrelid IN ('dream.plans'::regclass,'local_plan_materials.drafts'::regclass)
) AND EXISTS (
  SELECT FROM pg_constraint c WHERE c.conrelid='local_plan_materials.drafts'::regclass AND c.contype='f'
    AND c.confrelid='dream.plans'::regclass AND c.condeferrable AND c.condeferred AND c.convalidated AND c.confdeltype='r'
) AND has_column_privilege('dream.projects','id','UPDATE')
AND has_column_privilege('dream.plans','version','SELECT') AND has_column_privilege('dream.plans','script','INSERT')
AND has_column_privilege('local_plan_materials.drafts','payload','SELECT') AND has_column_privilege('local_plan_materials.drafts','payload','INSERT')
AND has_column_privilege('dream.activity_log','detail_json','INSERT')
AND NOT has_any_column_privilege('dream.plans','UPDATE') AND NOT has_table_privilege('dream.plans','DELETE')
AND NOT has_any_column_privilege('local_plan_materials.drafts','UPDATE') AND NOT has_table_privilege('local_plan_materials.drafts','DELETE')
AND NOT has_any_column_privilege('dream.stage_states','UPDATE,INSERT')
AND NOT has_any_column_privilege('dream.scenes','UPDATE,INSERT') AND NOT has_column_privilege('dream.projects','approved_plan_id','UPDATE')
AND NOT has_table_privilege('managed_project_plan.installation','INSERT,UPDATE,DELETE')
AND NOT has_schema_privilege('managed_project_plan','CREATE') AND NOT has_schema_privilege('dream','CREATE')
AS ready`;

const approvalInstalledSql = `SELECT EXISTS (
  SELECT FROM managed_project_plan.approval_installation a JOIN managed_project_plan.installation i USING (version,project_ref)
  WHERE a.version=1 AND a.project_ref=$1
) AND $2=current_user AND current_user=session_user AND current_database()=$3
AND current_setting('server_version_num')::int / 10000=17 AND current_setting('server_encoding')='UTF8'
AND EXISTS (
  SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
    AND NOT EXISTS (SELECT FROM pg_auth_members m
      WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.inherit_option OR m.set_option)))
) AND 8=(
  SELECT count(*) FROM pg_class c WHERE c.oid IN ('dream.projects'::regclass,'dream.plans'::regclass,
    'dream.stage_states'::regclass,'dream.activity_log'::regclass,'dream.scenes'::regclass,'dream.renders'::regclass,
    'dream.timeline_revisions'::regclass,'local_plan_materials.drafts'::regclass)
    AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(c.relowner,'USAGE')
) AND 2=(
  SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_roles r ON r.oid=p.proowner
  WHERE NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND p.oid='managed_project_plan.protect_materials()'::regprocedure
    AND p.prosecdef AND p.proconfig@>ARRAY['search_path=pg_catalog'] AND r.rolname=$4
    AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
    AND NOT EXISTS (SELECT FROM pg_auth_members m
      WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.inherit_option OR m.set_option)))
    AND (t.tgrelid,t.tgname,t.tgtype) IN
      (('dream.plans'::regclass,'managed_plan_materials_guard',23),('local_plan_materials.drafts'::regclass,'managed_plan_materials_attach',7))
) AND 11=(
  SELECT count(*) FROM pg_policy p WHERE p.polpermissive AND current_user::regrole=ANY(p.polroles)
    AND (p.polrelid,p.polname,p.polcmd) IN (
      ('dream.projects'::regclass,'managed_approval_project_read','r'),('dream.projects'::regclass,'managed_approval_project_lock','w'),
      ('dream.projects'::regclass,'managed_approval_project_link','w'),('dream.stage_states'::regclass,'managed_approval_stages_read','r'),
      ('dream.stage_states'::regclass,'managed_approval_stages_update','w'),('dream.plans'::regclass,'managed_approval_plan_read','r'),
      ('dream.plans'::regclass,'managed_approval_plan_update','w'),('local_plan_materials.drafts'::regclass,'managed_approval_materials_read','r'),
      ('dream.scenes'::regclass,'managed_approval_scenes_read','r'),('dream.scenes'::regclass,'managed_approval_scenes_insert','a'),
      ('dream.activity_log'::regclass,'managed_approval_log','a'))
) AND 2=(
  SELECT count(*) FROM pg_policy p WHERE p.polpermissive AND $4::regrole=ANY(p.polroles)
    AND p.polname='managed_plan_guard_read' AND p.polcmd='r'
    AND p.polrelid IN ('dream.plans'::regclass,'local_plan_materials.drafts'::regclass)
) AND 2=(
  SELECT count(*) FROM pg_policy p WHERE (p.polrelid,p.polname) IN (
    ('dream.renders'::regclass,'managed_approval_render_denied'),
    ('dream.timeline_revisions'::regclass,'managed_approval_timeline_denied'))
    AND NOT p.polpermissive AND p.polcmd='r' AND current_user::regrole=ANY(p.polroles)
    AND pg_get_expr(p.polqual,p.polrelid)='false'
) AND NOT EXISTS (
  SELECT FROM (VALUES ('dream.renders'::regclass,ARRAY['owner_id','job_id']::text[]),
    ('dream.timeline_revisions'::regclass,ARRAY['owner_id','id','project_id']::text[])) AS probe(relation, columns)
  WHERE has_table_privilege(probe.relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    OR has_any_column_privilege(probe.relation,'INSERT,UPDATE,REFERENCES')
    OR EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid=probe.relation AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(a.attrelid,a.attnum,'SELECT') IS DISTINCT FROM (a.attname::text=ANY(probe.columns)))
) AND has_column_privilege('dream.projects','approved_plan_id','UPDATE')
AND has_column_privilege('dream.plans','status','UPDATE')
AND has_column_privilege('dream.plans','approved_scene_snapshot_json','UPDATE')
AND has_column_privilege('local_plan_materials.drafts','payload','SELECT')
AND has_column_privilege('dream.stage_states','status','UPDATE')
AND has_column_privilege('dream.scenes','id','INSERT') AND has_column_privilege('dream.activity_log','detail_json','INSERT')
AND NOT has_any_column_privilege('dream.plans','INSERT') AND NOT has_table_privilege('dream.plans','DELETE')
AND NOT has_column_privilege('dream.plans','steps_json','UPDATE') AND NOT has_column_privilege('dream.plans','script','UPDATE')
AND NOT has_any_column_privilege('local_plan_materials.drafts','INSERT,UPDATE')
AND NOT has_table_privilege('local_plan_materials.drafts','DELETE')
AND NOT has_any_column_privilege('dream.projects','INSERT') AND NOT has_column_privilege('dream.projects','content_revision','UPDATE')
AND NOT has_any_column_privilege('dream.stage_states','INSERT')
AND NOT has_any_column_privilege('dream.scenes','UPDATE') AND NOT has_table_privilege('dream.scenes','DELETE')
AND NOT has_table_privilege('managed_project_plan.approval_installation','INSERT,UPDATE,DELETE')
AND NOT has_schema_privilege('managed_project_plan','CREATE') AND NOT has_schema_privilege('dream','CREATE')
AS ready`;

function createPlanTransaction(pool: Pick<Pool, "connect">, target: { ref: string; database: string },
  connection: { role: string; installedSql: string; unavailable: () => Response }) {
  const { unavailable } = connection;
  return async function transact<T>(owner: string, write: boolean, operation: (client: PoolClient) => Promise<T>): Promise<T | Response> {
    let client: PoolClient | undefined;
    let broken = false;
    let committing = false;
    const onError = () => { broken = true; };
    try {
      if (!z.guid().safeParse(owner).success) return unavailable();
      client = await pool.connect();
      client.on("error", onError);
      await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
      const { rows: [installation] } = await client.query<{ ready: boolean }>(connection.installedSql, [target.ref, connection.role, target.database, guard]);
      if (!installation?.ready) throw new Error("Managed plan installation differs");
      await client.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
      const result = await operation(client);
      committing = true;
      const committed = await client.query("COMMIT");
      if (committed.command !== "COMMIT" || broken) throw new Error("Managed plan commit was unconfirmed");
      return result;
    } catch {
      broken ||= committing;
      try { await client?.query("ROLLBACK"); } catch { broken = true; }
      return unavailable();
    } finally {
      client?.release(broken);
      client?.removeListener("error", onError);
    }
  };
}

export function createManagedPlanTransaction(pool: Pick<Pool, "connect">, target: { ref: string; database: string }) {
  return createPlanTransaction(pool, target, { role, installedSql, unavailable: managedPlanUnavailable });
}

type PlanConfiguration = NonNullable<ReturnType<typeof managedPlanConfiguration>>;
const approvalConnection = { role: approvalRole, installedSql: approvalInstalledSql, unavailable: managedPlanApprovalUnavailable };
function planPool(config: PlanConfiguration) {
  const { ref, ...connection } = config;
  const pool = new Pool({ ...connection, database: "postgres", max: 1, connectionTimeoutMillis: 4_000,
    idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  pool.on("error", () => { /* Keep idle connection failures private. */ });
  return { pool, target: { ref, database: "postgres" } };
}

let transaction: ReturnType<typeof createManagedPlanTransaction> | undefined;
let approveTransaction: ReturnType<typeof createPlanTransaction> | undefined;
export function openManagedPlanTransaction(config: PlanConfiguration) {
  if (transaction) return transaction;
  const { pool, target } = planPool(config);
  return transaction = createManagedPlanTransaction(pool, target);
}

export function openManagedPlanApprovalTransaction(config: PlanConfiguration) {
  if (approveTransaction) return approveTransaction;
  const { pool, target } = planPool(config);
  return approveTransaction = createPlanTransaction(pool, target, approvalConnection);
}

export { managedPlanApprovalUnavailable };
