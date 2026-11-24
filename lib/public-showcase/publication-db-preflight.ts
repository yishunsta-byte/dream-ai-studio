import "server-only";

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { createPostgresPool } from "../db/postgres/connection";

const roles = { admin: "t293_app", list: "t295_list", cover: "t295_file" } as const;
type Role = keyof typeof roles;
type Login = Readonly<{ name: string; connectionString: string }>;
type Options = Readonly<{
  target: Readonly<{ host: string; port: number; database: string; systemIdentifier: string }>;
  logins: Readonly<Record<Role, Login>>;
  approvedDatabaseOid?: string;
  ca?: string;
}>;

const inactive = Object.freeze({ mode: "inactive" as const });
const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
const roleKeys = Object.keys(roles) as Role[];

type ScopedQuery = <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<QueryResult<Row>>;
type Operation<T> = (query: ScopedQuery) => Promise<T>;

export class PublicationDatabaseUnavailable extends Error {
  constructor() { super("Publication database unavailable"); }
}

// PostgreSQL 17 function privileges are checked without invoking publication commands.
const probe = `WITH required(capability, schema_name, function_name, arg_types) AS (VALUES
  ('publisher', 't293', 'can_publish', ''),
  ('internal_write', 't293', 'apply_t253', 'uuid, text, text, bigint, bigint, jsonb'),
  ('write', 't295', 'apply', 'uuid, text, text, bigint, bigint, text'),
  ('list', 't295', 'list_approved', ''),
  ('cover', 't295', 'find_cover', 'text, bigint')
), capabilities AS (
  SELECT capability, p.oid, p.proowner, p.prosecdef, has_function_privilege(p.oid, 'EXECUTE') AS allowed
  FROM required
  LEFT JOIN pg_namespace n ON n.nspname = schema_name
  LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = function_name
    AND oidvectortypes(p.proargtypes) = arg_types AND p.prokind = 'f'
)
SELECT session_user AS login, current_user AS role, current_database() AS database,
  (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
  inet_server_port() AS port, current_setting('server_version_num')::int / 10000 AS major,
  (SELECT system_identifier::text FROM pg_control_system()) AS cluster,
  (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
  pg_is_in_recovery() AS replica, current_setting('transaction_read_only') AS read_only,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcanlogin
    AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) AS limited_login,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1 AND NOT rolcanlogin
    AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
    AND pg_has_role(oid, 'USAGE')) AS approved_role,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname NOT IN (current_user, $1) AND pg_has_role(oid, 'MEMBER')) AS extra_role,
  EXISTS (SELECT 1 FROM pg_auth_members WHERE member = current_user::regrole AND admin_option) AS grant_role,
  has_database_privilege(current_database(), 'CREATE') OR EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname IN ('t293', 't295', 't253_showcase') AND has_schema_privilege(oid, 'CREATE')
  ) AS ddl,
  has_schema_privilege('t295', 'USAGE') AND ($2 <> 'admin' OR has_schema_privilege('t293', 'USAGE')) AS schema_access,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname IN ('t253_showcase', 't295') OR (n.nspname = 't293' AND $2 <> 'admin'))
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (has_table_privilege(c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  ) AS direct_access,
  (SELECT allowed FROM capabilities WHERE capability = 'publisher') AS publisher,
  (SELECT allowed FROM capabilities WHERE capability = 'write') AS write,
  (SELECT allowed FROM capabilities WHERE capability = 'list') AS list,
  (SELECT allowed FROM capabilities WHERE capability = 'cover') AS cover,
  (SELECT w.prosecdef AND owner.rolname = 't295_writer' AND NOT owner.rolcanlogin
      AND NOT (owner.rolsuper OR owner.rolcreaterole OR owner.rolcreatedb OR owner.rolreplication OR owner.rolbypassrls)
      AND has_schema_privilege(w.proowner, 't293', 'USAGE') AND has_function_privilege(w.proowner, legacy.oid, 'EXECUTE')
    FROM capabilities w JOIN pg_roles owner ON owner.oid = w.proowner CROSS JOIN capabilities legacy
    WHERE w.capability = 'write' AND legacy.capability = 'internal_write') AS internal_write,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE ((n.nspname = 't253_showcase' AND p.proname IN ('apply_command','list_approved','find_cover'))
      OR (n.nspname = 't293' AND p.proname = 'apply_t253'))
    AND has_function_privilege(p.oid, 'EXECUTE')) AS legacy`;

function readOptions(options: Options) {
  const target = { ...options.target };
  const { host, port, database, systemIdentifier } = target;
  const { ca, approvedDatabaseOid } = options;
  if (typeof host !== "string" || !host || typeof database !== "string" || !identifier.test(database) ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof systemIdentifier !== "string" || !/^[1-9][0-9]{0,19}$/.test(systemIdentifier) ||
      (approvedDatabaseOid !== undefined && (typeof approvedDatabaseOid !== "string" ||
        !/^[1-9][0-9]{0,9}$/.test(approvedDatabaseOid) || Number(approvedDatabaseOid) > 0xffff_ffff)) ||
      (ca !== undefined && (typeof ca !== "string" || !ca.trim()))) throw new PublicationDatabaseUnavailable();

  const profiles = roleKeys.map(role => {
    const { name, connectionString } = options.logins[role];
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== host || url.port !== String(port) ||
        url.pathname !== `/${database}` || url.search || url.hash || typeof name !== "string" || !identifier.test(name) ||
        decodeURIComponent(url.username) !== name || !url.password) throw new PublicationDatabaseUnavailable();
    return { role, name, connectionString, password: decodeURIComponent(url.password) };
  });
  if (new Set(profiles.map(profile => profile.name)).size !== roleKeys.length ||
      new Set(profiles.map(profile => profile.password)).size !== roleKeys.length) throw new PublicationDatabaseUnavailable();
  return { target, ca, approvedDatabaseOid, profiles: profiles.map(({ role, name, connectionString }) => ({ role, name, connectionString })),
    targetId: JSON.stringify([host, port, database, systemIdentifier]) };
}

async function verifyLease(client: PoolClient, target: Options["target"], role: Role, name: string) {
  const query = { text: probe, values: [roles[role], role], query_timeout: 5000 };
  const result = await client.query<Record<string, unknown>>(query);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row.login !== name || row.role !== name || typeof row.database_oid !== "string" ||
      row.database !== target.database || row.port !== target.port || row.cluster !== target.systemIdentifier ||
      row.major !== 17 || row.tls !== true || row.replica !== false || (role === "admin" && row.read_only !== "off") ||
      row.limited_login !== true || row.approved_role !== true || row.extra_role !== false || row.grant_role !== false ||
      row.ddl !== false || row.direct_access !== false || row.legacy !== false || row.schema_access !== true ||
      row.publisher !== (role === "admin") || row.write !== (role === "admin") || row.internal_write !== true ||
      row.list !== (role === "list") || row.cover !== (role === "cover")) throw new PublicationDatabaseUnavailable();
  return row.database_oid;
}

/** Opens a group of direct PostgreSQL connections for trusted server adapters. */
export async function openVerifiedPublicationDatabase(options?: Options) {
  if (!options) return inactive;
  const sources = new Map<Role, { name: string; pool: Pool }>();
  let accepting = true;
  let closing: Promise<void> | undefined;
  function close() {
    accepting = false;
    return closing ??= Promise.allSettled(Array.from(sources.values(), async ({ pool }) => pool.end())).then(results => {
      if (results.some(result => result.status === "rejected")) throw new PublicationDatabaseUnavailable();
    });
  }
  function invalidate() { void close().catch(() => undefined); }

  try {
    const { target, ca, approvedDatabaseOid, profiles, targetId } = readOptions(options);
    for (const { role, name, connectionString } of profiles) {
      sources.set(role, { name, pool: createPostgresPool({ connectionString, ca, max: 1 }) });
    }
    // A sealed configuration supplies the OID in advance. Other callers pin the first verified connection.
    let databaseOid = approvedDatabaseOid;

    async function withRole<T>(role: Role, operation: Operation<T>) {
      if (!accepting) throw new PublicationDatabaseUnavailable();
      const { name, pool } = sources.get(role)!;
      let client: PoolClient | undefined;
      let ended: Promise<void> | undefined;
      let leased = false;
      let releasing = false;
      try {
        try {
          client = await pool.connect();
          client.on("error", invalidate);
          const end = Promise.withResolvers<void>();
          ended = end.promise;
          client.once("end", () => {
            if (!releasing) invalidate();
            end.resolve();
          });
          if (!accepting) throw new PublicationDatabaseUnavailable();
          const oid = await verifyLease(client, target, role, name);
          databaseOid ??= oid;
          if (databaseOid !== oid) throw new PublicationDatabaseUnavailable();
        } catch {
          invalidate();
          throw new PublicationDatabaseUnavailable();
        }
        if (!accepting) throw new PublicationDatabaseUnavailable();
        leased = true;
        const session = client;
        return await operation(async (text, values) => {
          if (!leased || !accepting) throw new PublicationDatabaseUnavailable();
          return session.query(text, values === undefined ? undefined : [...values]);
        });
      } finally {
        leased = false;
        releasing = true;
        // A new operation always gets a fresh TLS session, including after errors or a dirty transaction.
        client?.release(true);
        await ended;
        client?.off("error", invalidate);
      }
    }

    const checked = await Promise.allSettled(roleKeys.map(role => withRole(role, async () => {})));
    if (checked.some(result => result.status === "rejected") || !accepting) {
      await close().catch(() => undefined);
      return inactive;
    }
    return Object.freeze({
      mode: "verified" as const,
      targetId,
      get active() { return accepting; },
      withAdmin: <T>(operation: Operation<T>) => withRole("admin", operation),
      withList: <T>(operation: Operation<T>) => withRole("list", operation),
      withCover: <T>(operation: Operation<T>) => withRole("cover", operation),
      close,
    });
  } catch {
    await close().catch(() => undefined);
    return inactive;
  }
}

/** Startup observation only. All verification resources are closed before it returns. */
export async function verifyPublicationDatabase(options?: Options) {
  const connections = await openVerifiedPublicationDatabase(options);
  if (connections.mode === "inactive") return inactive;
  try {
    await connections.close();
    return Object.freeze({ mode: "verified" as const, targetId: connections.targetId });
  } catch { return inactive; }
}
