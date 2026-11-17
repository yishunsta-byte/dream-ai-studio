import "server-only";
import type { Pool, PoolClient } from "pg";
import { loadPostgresMigrations, postgresMigrationManifest, PostgresMigrationError } from "./migration-manifest";
import { createPostgresPool } from "./connection";
import { inspectMigrationTarget, isSessionMigrationProfile, type MigrationTarget } from "./migration-target";

const tables = ["activity_log", "assets", "backups", "characters", "exports", "generations", "jobs", "plans", "project_assets", "project_characters", "projects", "renders", "review_items", "scene_versions", "scenes", "settings", "stage_states", "timeline_revisions"];
// Constant shared by the provision template. Transaction lock automatically
// releases on COMMIT/ROLLBACK/disconnect and never escapes this client.
export const migrationLock = Object.freeze([1725031001, 5] as const);
// Membership arrows are member -> parent. The only runtime paths allowed are
// api_login -> api and worker_login -> worker, with no parents of either runtime
// role. Include all reachable edges (not only SET edges) and unknown inbound
// grants to reserved principals. The migration owner is the trusted admin root.
export const restrictedRoleGraphViolationsSql = `WITH RECURSIVE reserved AS (
 SELECT oid FROM pg_roles WHERE rolname IN ('dream_api','dream_worker','dream_api_login','dream_worker_login')
), reachable(oid) AS (
 SELECT oid FROM reserved UNION SELECT m.roleid FROM pg_auth_members m JOIN reachable r ON r.oid=m.member
)
SELECT 1 AS violation FROM pg_auth_members m
JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
WHERE (m.member IN (SELECT oid FROM reachable) OR m.roleid IN (SELECT oid FROM reserved))
AND NOT (
 (child.rolname=session_user AND parent.oid IN (SELECT oid FROM reserved)) OR
 (child.rolname='dream_api_login' AND parent.rolname='dream_api' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) OR
 (child.rolname='dream_worker_login' AND parent.rolname='dream_worker' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
)`;
async function inspectState(client: PoolClient, database: string, username: string, port: number) {
  const identity = (await client.query("SELECT current_database() AS database,inet_server_port() AS port,current_setting('server_version_num')::int AS version,session_user AS username,current_user AS active,r.rolsuper,r.rolcreaterole,has_database_privilege(current_database(),'CREATE') AS can_create FROM pg_roles r WHERE rolname=session_user")).rows[0];
  if (identity?.database !== database || identity?.username !== username || identity?.active !== username || identity?.port !== port) throw new PostgresMigrationError("MIGRATION_TARGET");
  if ((!identity.rolsuper && !identity.rolcreaterole) || !identity.can_create || ["dream_api", "dream_worker", "dream_api_login", "dream_worker_login"].includes(username)) throw new PostgresMigrationError("MIGRATION_PRIVILEGE");
  if (identity.version < 160000) throw new PostgresMigrationError("MIGRATION_STATE");
  const auth = (await client.query("SELECT a.attnotnull,(a.atttypid='uuid'::regtype) AS uuid,EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=a.attrelid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) AS unique_id FROM pg_attribute a WHERE a.attrelid=to_regclass('auth.users') AND a.attname='id' AND NOT a.attisdropped")).rows[0];
  if (!auth?.attnotnull || !auth.uuid || !auth.unique_id) throw new PostgresMigrationError("MIGRATION_STATE");
  const privilege = (await client.query("SELECT has_schema_privilege('auth','USAGE') AND has_table_privilege('auth.users','REFERENCES') AS ok")).rows[0];
  if (!privilege.ok) throw new PostgresMigrationError("MIGRATION_PRIVILEGE");
  const state = (await client.query("SELECT to_regnamespace('dream')::text AS dream,to_regnamespace('dream_migrations')::text AS journal,to_regclass('dream_migrations.history')::text AS history")).rows[0];
  const roles = (await client.query("SELECT rolname,rolsuper,rolbypassrls,rolcanlogin,rolinherit,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname IN ('dream_api','dream_worker','dream_api_login','dream_worker_login') ORDER BY rolname")).rows;
  if (!state.journal) {
    if (state.dream || roles.length) throw new PostgresMigrationError("MIGRATION_STATE");
    return false;
  }
  if (!state.history || !state.dream) throw new PostgresMigrationError("MIGRATION_HISTORY");
  const owners = (await client.query("SELECT nspname,pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('dream','dream_migrations')")).rows;
  if (owners.length !== 2 || owners.some(row => row.owner !== username)) throw new PostgresMigrationError("MIGRATION_STATE");
  const historyOwner = (await client.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='dream_migrations.history'::regclass")).rows[0];
  if (historyOwner?.owner !== username) throw new PostgresMigrationError("MIGRATION_HISTORY");
  const history = (await client.query("SELECT ordinal,id,checksum FROM dream_migrations.history ORDER BY ordinal")).rows;
  if (history.length !== postgresMigrationManifest.length || history.some((row, index) => row.ordinal !== index + 1 || row.id !== postgresMigrationManifest[index].id || row.checksum !== postgresMigrationManifest[index].checksum)) throw new PostgresMigrationError("MIGRATION_HISTORY");
  const runtimeRoles = roles.filter(row => !row.rolname.endsWith('_login'));
  const logins = roles.filter(row => row.rolname.endsWith('_login'));
  if (runtimeRoles.length !== 2 || runtimeRoles.some(row => row.rolsuper || row.rolbypassrls || row.rolcanlogin || row.rolinherit || row.rolcreatedb || row.rolcreaterole || row.rolreplication)) throw new PostgresMigrationError("MIGRATION_STATE");
  if (logins.length && (logins.length !== 2 || logins.some(row => !row.rolcanlogin || row.rolsuper || row.rolbypassrls || row.rolinherit || row.rolcreatedb || row.rolcreaterole || row.rolreplication))) throw new PostgresMigrationError("MIGRATION_STATE");
  if (logins.length) {
    const memberships = (await client.query("SELECT member.rolname AS login,parent.rolname AS role,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE member.rolname IN ('dream_api_login','dream_worker_login')")).rows;
    if (memberships.length !== 2 || logins.some(login => memberships.filter(row => row.login === login.rolname && row.role === login.rolname.replace('_login','') && !row.admin_option && !row.inherit_option && row.set_option).length !== 1)) throw new PostgresMigrationError("MIGRATION_STATE");
  }
  if ((await client.query(restrictedRoleGraphViolationsSql)).rows.length) throw new PostgresMigrationError("MIGRATION_STATE");
  const actual = (await client.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relkind IN ('r','p') ORDER BY c.relname")).rows;
  if (actual.length !== tables.length || actual.some((row, index) => row.relname !== tables[index] || !row.relrowsecurity || !row.relforcerowsecurity || row.owner !== username)) throw new PostgresMigrationError("MIGRATION_STATE");
  const counts = (await client.query("SELECT (SELECT count(*)::int FROM pg_policies WHERE schemaname='dream') AS policies,(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND t.tgname='guard_row' AND NOT t.tgisinternal) AS guards")).rows[0];
  if (counts.policies !== 36 || counts.guards !== 18) throw new PostgresMigrationError("MIGRATION_STATE");
  return true;
}

export async function runPostgresMigrations(options: {
  target: MigrationTarget; expectedTargetHash: string;
  mode: "dry-run" | "apply"; sourceRoot?: URL; ca?: string;
}) {
  // Old independently injectable pools are rejected, not silently ignored.
  if ("pool" in options) throw new PostgresMigrationError("MIGRATION_TARGET");
  const approvedTarget = Object.freeze({ ...options.target });
  const source = await loadPostgresMigrations(options.sourceRoot);
  const target = inspectMigrationTarget(approvedTarget);
  if (isSessionMigrationProfile(approvedTarget.profile) && !options.ca?.trim()) throw new PostgresMigrationError("MIGRATION_TARGET");
  if (!/^[a-f0-9]{64}$/.test(options.expectedTargetHash) || options.expectedTargetHash !== target.targetHash || !["dry-run", "apply"].includes(options.mode)) throw new PostgresMigrationError("MIGRATION_TARGET");
  // Hash and connection use this same immutable input. Managed TLS/DNS hostname
  // validation stays with pg/TLS; no IP equality is presented as DNS assurance.
  let pool: Pool;
  try { pool = createPostgresPool({ connectionString: approvedTarget.connectionString, max: 1, ...(options.ca ? { ca: options.ca } : {}), ...(approvedTarget.profile === "synthetic" ? { localTestWithoutTls: true } : {}) }); }
  catch { throw new PostgresMigrationError("MIGRATION_TARGET"); }
  let client: PoolClient;
  try { client = await pool.connect(); } catch { await pool.end().catch(() => {}); throw new PostgresMigrationError("MIGRATION_FAILED"); }
  let begun = false, destroy = false, committing = false;
  const broken = () => { destroy = true; };
  client.on("error", broken);
  try {
    await client.query(options.mode === "dry-run" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"); begun = true;
    if (options.mode === "apply") await client.query("SELECT pg_advisory_xact_lock($1,$2)", [...migrationLock]);
    const complete = await inspectState(client, target.database, target.username, target.port);
    let applied = 0;
    if (options.mode === "apply" && !complete) {
      await client.query("CREATE SCHEMA dream_migrations; REVOKE ALL ON SCHEMA dream_migrations FROM PUBLIC; CREATE TABLE dream_migrations.history(ordinal integer PRIMARY KEY CHECK(ordinal>0),id text NOT NULL UNIQUE,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()); REVOKE ALL ON TABLE dream_migrations.history FROM PUBLIC");
      for (const [index, entry] of source.entries()) {
        await client.query(entry.sql);
        await client.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES($1,$2,$3)", [index + 1, entry.id, entry.checksum]);
        applied++;
      }
      await inspectState(client, target.database, target.username, target.port);
    }
    committing = true;
    const result = await client.query("COMMIT");
    if (result.command !== "COMMIT") throw new PostgresMigrationError("MIGRATION_FAILED");
    begun = false;
    return Object.freeze({ targetHash: target.targetHash, mode: options.mode, applied, pending: complete || applied ? 0 : source.length, manifest: postgresMigrationManifest.map(({ id, checksum }) => ({ id, checksum })) });
  } catch (error) {
    if (!begun || committing) destroy = true;
    if (begun) { try { await client.query("ROLLBACK"); } catch { destroy = true; } }
    if (error instanceof PostgresMigrationError) throw error;
    throw new PostgresMigrationError("MIGRATION_FAILED");
  } finally {
    client.release(destroy); client.removeListener("error", broken);
    await pool.end().catch(() => {});
  }
}
