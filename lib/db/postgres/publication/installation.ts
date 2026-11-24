import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Client } from "pg";

const version = 1;
const sourceSha = "0d675b8f5f2b523da02a004fbe410d640ff6fb468ed7fb092e79904ad0a2b26f";
const schemas = ["t253_showcase", "t293", "t295", "t_publication_install"];
const roles = ["t253_publish", "t253_write_owner", "t293_app", "t293_gateway", "t293_binding_owner", "t295_writer",
  "t295_list_owner", "t295_file_owner", "t295_list", "t295_file", "t_publication_authority"];

type Target = Readonly<{ database: string; systemIdentifier: string; port: number; installer: string }>;
type Session = Pick<Client, "query" | "getTransactionStatus">;
type Code = "PUBLICATION_SOURCE" | "PUBLICATION_TARGET" | "PUBLICATION_SCHEMA" | "PUBLICATION_INSTALL";
const busySessions = new WeakSet<Session>();

export class PublicationInstallationError extends Error {
  constructor(readonly code: Code, readonly outcome: "not-applied" | "unknown" = "not-applied") {
    super(code);
  }
}

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function source() {
  try {
    const text = (await readFile(new URL("0001_publication.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    if (sha(text) === sourceSha) return text;
  } catch { /* Source errors never expose filesystem details. */ }
  throw new PublicationInstallationError("PUBLICATION_SOURCE");
}

const catalogSql = `WITH ns AS (SELECT * FROM pg_namespace WHERE nspname=ANY($1::text[])),
  relations AS (SELECT c.*,n.nspname FROM pg_class c JOIN ns n ON n.oid=c.relnamespace),
  routines AS (SELECT p.*,n.nspname FROM pg_proc p JOIN ns n ON n.oid=p.pronamespace),
  groups AS (SELECT * FROM pg_roles WHERE rolname=ANY($2::text[])),
  acl AS (
    SELECT nspowner AS owner, entry.grantee AS grantee FROM ns CROSS JOIN LATERAL aclexplode(nspacl) entry
    UNION ALL SELECT relowner, entry.grantee FROM relations CROSS JOIN LATERAL aclexplode(relacl) entry
    UNION ALL SELECT p.proowner, entry.grantee FROM routines p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) entry
    UNION ALL SELECT r.relowner, entry.grantee FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid CROSS JOIN LATERAL aclexplode(a.attacl) entry
  ), snapshot(kind, identity, detail) AS (
    SELECT 'schema', nspname::text, jsonb_build_array(pg_get_userbyid(nspowner), nspacl) FROM ns
    UNION ALL SELECT CASE WHEN relkind='r' THEN 'table' ELSE 'relation' END, nspname||'.'||relname,
      jsonb_build_array(relkind, pg_get_userbyid(relowner), relacl, relrowsecurity, relforcerowsecurity,
        CASE WHEN relkind IN ('i','I') THEN pg_get_indexdef(oid) END) FROM relations
    UNION ALL SELECT 'column', r.nspname||'.'||r.relname||'.'||a.attnum::text,
      jsonb_build_array(a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull, a.attacl, a.attcollation::regcollation::text,
        pg_get_expr(d.adbin,d.adrelid)) FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT 'constraint', r.nspname||'.'||r.relname||'.'||c.conname,
      jsonb_build_array(c.convalidated, pg_get_constraintdef(c.oid)) FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid
    UNION ALL SELECT 'policy', r.nspname||'.'||r.relname||'.'||p.polname,
      jsonb_build_array(p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
      FROM relations r JOIN pg_policy p ON p.polrelid=r.oid
    UNION ALL SELECT 'trigger', r.nspname||'.'||r.relname||'.'||t.tgname,
      jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid)) FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
    UNION ALL SELECT 'function', nspname||'.'||proname||'('||oidvectortypes(proargtypes)||')',
      jsonb_build_array(pg_get_userbyid(proowner),proacl,pg_get_functiondef(oid)) FROM routines
    UNION ALL SELECT 'role', rolname::text,
      jsonb_build_array(rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit) FROM groups
    UNION ALL SELECT 'membership', pg_get_userbyid(m.member)||'/'||pg_get_userbyid(m.roleid)||'/'||pg_get_userbyid(m.grantor),
      jsonb_build_array(m.admin_option,m.inherit_option,m.set_option) FROM pg_auth_members m JOIN groups g ON g.oid=m.member
  ) SELECT kind, identity, detail,
      EXISTS(SELECT 1 FROM acl WHERE grantee <> owner AND grantee NOT IN (SELECT oid FROM groups)) AS unapproved_acl
    FROM snapshot ORDER BY kind COLLATE "C", identity COLLATE "C"`;

async function catalogHash(client: Session) {
  const result = await client.query<{ kind: string; identity: string; detail: unknown; unapproved_acl: boolean }>(catalogSql, [schemas, roles]);
  const count = (kind: string) => result.rows.filter(row => row.kind === kind).length;
  if (count("schema") !== schemas.length || count("role") !== roles.length || count("table") !== 15 || count("function") !== 11 ||
      count("membership") !== 2 || result.rows.some(row => row.unapproved_acl ||
        (row.kind === "role" && JSON.stringify(row.detail) !== "[false,false,false,false,false,false,true]"))) {
    throw new PublicationInstallationError("PUBLICATION_SCHEMA");
  }
  const { rows: [access] } = await client.query<{ safe: boolean }>(`SELECT
    has_function_privilege('t293_app', 't295.apply(uuid,text,text,bigint,bigint,text)', 'EXECUTE')
    AND has_function_privilege('t295_writer', 't293.apply_t253(uuid,text,text,bigint,bigint,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('t293_app', 't293.apply_t253(uuid,text,text,bigint,bigint,jsonb)', 'EXECUTE')
    AND has_function_privilege('t293_app', 't295.rights_state(text,bigint)', 'EXECUTE')
    AND NOT has_table_privilege('t293_app', 't293.actor_bindings', 'SELECT,INSERT,UPDATE,DELETE')
    AND has_function_privilege('t295_list','t295.list_approved()','EXECUTE')
    AND has_function_privilege('t295_file','t295.find_cover(text,bigint)','EXECUTE')
    AND NOT has_function_privilege('t295_file','t295.list_approved()','EXECUTE')
    AND NOT has_function_privilege('t295_list','t295.find_cover(text,bigint)','EXECUTE')
    AND NOT has_function_privilege('t295_list','t295.apply(uuid,text,text,bigint,bigint,text)','EXECUTE')
    AND NOT has_function_privilege('t295_file','t295.apply(uuid,text,text,bigint,bigint,text)','EXECUTE')
    AND NOT has_function_privilege('t295_list','t295.rights_state(text,bigint)','EXECUTE')
    AND NOT has_function_privilege('t295_file','t295.rights_state(text,bigint)','EXECUTE') AS safe`);
  if (access?.safe !== true) throw new PublicationInstallationError("PUBLICATION_SCHEMA");
  return sha(JSON.stringify(result.rows));
}

async function assertTarget(client: Session, target: Target) {
  const { rows: [actual] } = await client.query<{ database: string; identifier: string; port: number; login: string; safe: boolean }>(`SELECT
    current_database() AS database, (SELECT system_identifier::text FROM pg_control_system()) AS identifier,
    inet_server_port() AS port, session_user AS login,
    current_user=session_user AND current_setting('server_version_num')::int / 10000=17 AND NOT pg_is_in_recovery()
    AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS safe`);
  if (!actual?.safe || actual.database !== target.database || actual.identifier !== target.systemIdentifier ||
      actual.port !== target.port || actual.login !== target.installer) throw new PublicationInstallationError("PUBLICATION_TARGET");
}

async function inspect(client: Session) {
  const { rows: [inventory] } = await client.query<{ objects: boolean; history: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=ANY($1::text[])) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=ANY($2::text[])) AS objects,
    to_regclass('t_publication_install.history') IS NOT NULL AS history`, [schemas, roles]);
  if (!inventory.objects) return { mode: "absent" as const };
  if (!inventory.history) throw new PublicationInstallationError("PUBLICATION_SCHEMA");
  const { rows } = await client.query<{ version: number; source_sha256: string; catalog_sha256: string; installed_at: string }>(`
    SELECT version,source_sha256,catalog_sha256,installed_at::text FROM t_publication_install.history`);
  if (rows.length !== 1 || rows[0].version !== version || rows[0].source_sha256 !== sourceSha ||
      rows[0].catalog_sha256 !== await catalogHash(client)) throw new PublicationInstallationError("PUBLICATION_SCHEMA");
  return { mode: "installed" as const, sourceSha, catalogSha: rows[0].catalog_sha256, installedAt: rows[0].installed_at };
}

/** The caller supplies an approved, dedicated idle TLS connection. This module never reads a DSN or connects. */
export async function publicationInstallation(client: Session, approvedTarget: Target, mode: "verify" | "install") {
  if (busySessions.has(client) || client.getTransactionStatus() !== "I" || (mode !== "verify" && mode !== "install")) {
    throw new PublicationInstallationError("PUBLICATION_TARGET");
  }
  const target = { ...approvedTarget };
  busySessions.add(client);
  let started = false;
  let committing = false;
  try {
    const sql = await source();
    started = true;
    await client.query(mode === "install" ? "BEGIN ISOLATION LEVEL READ COMMITTED" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=pg_catalog");
    await assertTarget(client, target);
    if (mode === "install") await client.query("SELECT pg_advisory_xact_lock(338,1)");
    let result = await inspect(client);
    let applied = false;
    if (mode === "install" && result.mode === "absent") {
      await client.query(sql);
      await client.query("INSERT INTO t_publication_install.history(version,source_sha256,catalog_sha256) VALUES ($1,$2,$3)",
        [version, sourceSha, await catalogHash(client)]);
      result = await inspect(client);
      if (result.mode !== "installed") throw new PublicationInstallationError("PUBLICATION_SCHEMA");
      applied = true;
    }
    committing = applied;
    await client.query("COMMIT");
    return Object.freeze({ ...result, applied });
  } catch (error) {
    if (started) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof PublicationInstallationError) throw error;
    throw new PublicationInstallationError("PUBLICATION_INSTALL", committing ? "unknown" : "not-applied");
  } finally { busySessions.delete(client); }
}
