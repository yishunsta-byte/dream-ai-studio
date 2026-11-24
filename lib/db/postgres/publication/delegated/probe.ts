import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { Client } from "pg";
import { delegatedCatalogSha, delegatedSchemas, readDelegatedCatalogSha } from "./catalog";

const sourceSha = "66a966e09207709288226544e2e6a7f20a95f8a4ba1d59246a533e9609f03375";
const playbackSourceSha = "260f0f067ff7839b80649984c135242a57ecdb339390ca7dcc851d23cd77b762";
const playbackCatalogSha = "cfdaae8b404a5f1af1ef5919e883a0c5985de3f65e004e5cdaafb62ee347f42f";
const owners = ["t253_write_owner", "t293_gateway", "t293_binding_owner", "t295_writer", "t295_list_owner", "t295_file_owner",
  "t341_schema_owner", "t341_history_owner"] as const;
const groups = [...owners, "t253_publish", "t293_app", "t295_list", "t295_file", "t_publication_authority", "t341_verify"] as const;
const runtimeGroups = ["t293_app", "t295_list", "t295_file"] as const;
type Session = Pick<Client, "query" | "getTransactionStatus">;
type Identity = { name: string; oid: string };
type Principal = Identity & { login: boolean; inherit: boolean };
type Edge = { member: string; parent: string; grantor: string; admin: boolean; inherit: boolean; set: boolean };
type Target = { database: string; databaseOid: string; cluster: string; port: number };
export type DelegatedPlan = Readonly<{ target: Target; installer: Identity; verifier: Identity; principals: readonly Principal[];
  permanent: readonly Edge[]; temporary: readonly Edge[] }>;
type Work = Readonly<{ pid: number; manager: Identity; controlOid: string; target: Readonly<Target> }>;
type Observed = Identity & { pid: number; database: string; databaseOid: string; cluster: string; port: number; safe: boolean };
const coordinated = new WeakSet<Session>();
const activeTransactions = new WeakSet<Session>();

export class DelegatedInstallationError extends Error {
  constructor(readonly code: "BUSY" | "BLOCKED" | "UNKNOWN") { super(`PUBLICATION_DELEGATED_${code}`); }
}
function requireState(value: unknown): asserts value {
  if (!value) throw new DelegatedInstallationError("BLOCKED");
}

async function identity(client: Session) {
  const { rows: [row] } = await client.query<Observed>(`SELECT session_user AS name,r.oid::text,pg_backend_pid() AS pid,
    current_database() AS database,d.oid::text AS "databaseOid", (SELECT system_identifier::text FROM pg_control_system()) AS cluster,
    inet_server_port() AS port,current_user=session_user AND current_setting('server_version_num')::int/10000=17
      AND NOT pg_is_in_recovery() AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS safe
    FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=session_user`);
  requireState(row?.safe === true);
  return row;
}

/** Keep the same lock in the designated control database across all databases in this cluster. */
export async function withDelegatedPublicationWork<T>(coordinator: Session, approval: Readonly<{ manager: Identity; target: Target }>,
  operation: (work: Work) => Promise<T>) {
  if (coordinated.has(coordinator)) throw new DelegatedInstallationError("BUSY");
  requireState(coordinator.getTransactionStatus() === "I");
  coordinated.add(coordinator);
  let acquired = false;
  try {
    const here = await identity(coordinator);
    requireState(here.database === "postgres" && here.cluster === approval.target.cluster && here.port === approval.target.port &&
      here.name === approval.manager.name && here.oid === approval.manager.oid);
    acquired = (await coordinator.query("SELECT pg_try_advisory_lock(341,1) AS locked")).rows[0]?.locked === true;
    if (!acquired) throw new DelegatedInstallationError("BUSY");
    const work = Object.freeze({ pid: here.pid, manager: Object.freeze({ name: here.name, oid: here.oid }), controlOid: here.databaseOid,
      target: Object.freeze({ ...approval.target }) });
    const result = await operation(work);
    const released = coordinator.getTransactionStatus() === "I" &&
      await coordinator.query("SELECT pg_advisory_unlock(341,1) AS released")
        .then(({ rows }) => rows[0]?.released === true, () => false);
    if (!released) throw new DelegatedInstallationError("UNKNOWN");
    acquired = false;
    return result;
  } finally {
    try { if (acquired) await coordinator.query("SELECT pg_advisory_unlock(341,1)").catch(() => undefined); }
    finally { coordinated.delete(coordinator); }
  }
}

async function assertWork(client: Session, work: Work) {
  const { rows } = await client.query<{ locked: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity activity ON activity.pid=l.pid
    JOIN pg_database control ON control.oid=l.database WHERE l.locktype='advisory' AND l.mode='ExclusiveLock' AND l.granted
    AND l.classid=341 AND l.objid=1 AND l.objsubid=2 AND l.pid=$1 AND control.oid=$2::oid AND control.datname='postgres'
    AND activity.usesysid=$3::oid) AS locked`, [work.pid, work.controlOid, work.manager.oid]);
  requireState(rows[0]?.locked === true);
}

async function assertIdentity(client: Session, target: Target, expected: Identity) {
  const here = await identity(client);
  requireState(here.database === target.database && here.databaseOid === target.databaseOid &&
    here.cluster === target.cluster && here.port === target.port && here.name === expected.name && here.oid === expected.oid);
}

async function assertTarget(client: Session, target: Target, expected: Identity, work: Work) {
  requireState(isDeepStrictEqual(target, work.target));
  await assertIdentity(client, target, expected);
  await assertWork(client, work);
}

async function transaction<T>(client: Session, mode: "write" | "verify", task: () => Promise<T>) {
  requireState(!activeTransactions.has(client) && client.getTransactionStatus() === "I");
  activeTransactions.add(client);
  let committing = false;
  try {
    await client.query(mode === "write" ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=pg_catalog");
    if (mode === "write") await client.query("SELECT pg_advisory_xact_lock(341,2)");
    const result = await task();
    committing = mode === "write";
    requireState((await client.query("COMMIT")).command === "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (committing) throw new DelegatedInstallationError("UNKNOWN");
    if (error instanceof DelegatedInstallationError) throw error;
    throw new DelegatedInstallationError("BLOCKED");
  } finally { activeTransactions.delete(client); }
}

/** Management supplies the separately approved bootstrap/revocation operations. */
export function withDelegatedPublicationManagement<T>(client: Session, target: Target, work: Work, operation: () => Promise<T>) {
  return transaction(client, "write", async () => {
    await assertTarget(client, target, work.manager, work);
    const result = await operation();
    await assertWork(client, work);
    return result;
  });
}

const canonical = (entries: readonly object[]) => entries.map(entry => JSON.stringify(Object.fromEntries(Object.entries(entry).sort()))).sort();
const digest = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");
function planHash(plan: DelegatedPlan, managerOid: string) {
  return digest(JSON.stringify([plan.target.database, plan.target.databaseOid, plan.target.cluster, plan.target.port,
    plan.installer.oid, plan.verifier.oid, managerOid, canonical(plan.principals), canonical(plan.permanent), canonical(plan.temporary)]));
}

function validatePlanEdges(plan: DelegatedPlan, managerOid: string) {
  const ids = new Map(plan.principals.map(role => [role.name, role.oid]));
  const logins = plan.principals.filter(role => role.login && role.oid !== plan.installer.oid && role.oid !== plan.verifier.oid);
  requireState(logins.length === runtimeGroups.length);
  const permanent: Edge[] = [...[
    [ids.get("t293_gateway"), ids.get("t253_publish")], [ids.get("t295_writer"), ids.get("t293_app")],
    [plan.verifier.oid, ids.get("t341_verify")],
  ], ...runtimeGroups.map(group => {
    const parent = ids.get(group);
    const matches = plan.permanent.filter(edge => edge.parent === parent && logins.some(role => role.oid === edge.member));
    requireState(matches.length === 1);
    return [matches[0].member, parent];
  })].map(([member, parent]) => {
    requireState(member && parent);
    return { member, parent, grantor: managerOid, admin: false, inherit: true, set: false };
  });
  requireState(new Set(permanent.slice(3).map(edge => edge.member)).size === logins.length);
  const groupIds = new Set(groups.map(group => ids.get(group)));
  const pinnedIds = new Set(ids.values());
  const autoAdmin = plan.permanent.filter(edge => edge.admin && !edge.inherit && !edge.set && !pinnedIds.has(edge.member) &&
    edge.member !== managerOid && groupIds.has(edge.parent) && edge.grantor === managerOid);
  requireState(isDeepStrictEqual(canonical(plan.permanent), canonical([...permanent, ...autoAdmin])) &&
    isDeepStrictEqual(canonical(plan.temporary), canonical(owners.map(owner => ({
      member: plan.installer.oid, parent: ids.get(owner), grantor: managerOid, admin: false, inherit: false, set: true,
    })))));
  return permanent;
}

async function topology(client: Session, plan: DelegatedPlan, managerOid: string, prepared: boolean) {
  const names = plan.principals.map(role => role.name);
  const ids = plan.principals.map(role => role.oid);
  requireState(new Set(names).size === names.length && new Set(ids).size === ids.length &&
    groups.every(name => plan.principals.some(role => role.name === name && role.login === false)) &&
    plan.principals.some(role => isDeepStrictEqual([role.name, role.oid, role.login], [plan.installer.name, plan.installer.oid, true])) &&
    plan.principals.some(role => isDeepStrictEqual([role.name, role.oid, role.login], [plan.verifier.name, plan.verifier.oid, true])) &&
    plan.installer.oid !== plan.verifier.oid && !ids.includes(managerOid));
  const inherited = validatePlanEdges(plan, managerOid);
  const create = prepared ? [plan.installer.name, "t341_schema_owner", "t341_history_owner"].sort() : [];
  const { rows } = await client.query<Principal & { limited: boolean; db_create: boolean }>(`SELECT rolname AS name,oid::text,rolcanlogin AS login,
    rolinherit AS inherit, NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AS limited,
    has_database_privilege(oid,current_database(),'CREATE') AS db_create FROM pg_roles WHERE rolname=ANY($1::text[])`, [names]);
  const observed = rows.map(({ name, oid, login, inherit }) => ({ name, oid, login, inherit }));
  const expected = plan.principals.map(role => ({ ...role, login: role.oid === plan.installer.oid ? prepared : role.login }));
  requireState(rows.every(role => role.limited) && isDeepStrictEqual(canonical(observed), canonical(expected)) &&
    isDeepStrictEqual(rows.filter(role => role.db_create).map(role => role.name).sort(), create));

  const { rows: edges } = await client.query<Edge>(`SELECT member::text, roleid::text AS parent, grantor::text, admin_option AS admin,
    inherit_option AS inherit,set_option AS set FROM pg_auth_members WHERE member=ANY($1::oid[]) OR roleid=ANY($1::oid[])`, [ids]);
  requireState(isDeepStrictEqual(canonical(edges), canonical([...plan.permanent, ...(prepared ? plan.temporary : [])])));
  const { rows: grants } = await client.query<{ name: string; grantor: string; grantable: boolean }>(`SELECT r.rolname AS name,a.grantor::text,a.is_grantable AS grantable
    FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE d.datname=current_database() AND a.privilege_type='CREATE' AND a.grantee=ANY($1::oid[])`, [ids]);
  requireState(grants.every(grant => grant.grantor === managerOid && !grant.grantable) &&
    isDeepStrictEqual(grants.map(grant => grant.name).sort(), create));

  const { rows: setPaths } = await client.query<{ role: string; owner: string }>(`SELECT actor.rolname AS role,owner.rolname AS owner
    FROM pg_roles actor CROSS JOIN pg_roles owner WHERE actor.rolname=ANY($1::text[]) AND owner.rolname=ANY($2::text[])
    AND pg_has_role(actor.oid,owner.oid,'SET')`, [plan.principals.filter(role => role.login).map(role => role.name), owners]);
  requireState(isDeepStrictEqual(canonical(setPaths), canonical(prepared ? owners.map(owner => ({ role: plan.installer.name, owner })) : [])));
  const { rows: usagePaths } = await client.query<{ member: string; parent: string }>(`SELECT actor.oid::text AS member,group_role.oid::text AS parent
    FROM pg_roles actor CROSS JOIN pg_roles group_role WHERE actor.oid=ANY($1::oid[]) AND group_role.rolname=ANY($2::text[])
    AND actor.oid<>group_role.oid AND pg_has_role(actor.oid,group_role.oid,'USAGE')`, [ids, groups]);
  requireState(isDeepStrictEqual(canonical(usagePaths), canonical(inherited.map(({ member, parent }) => ({ member, parent })))));
}

type HistoryRow = { version: number; source_sha256: string; plan_sha256: string; catalog_sha256: string; installed_at: string };

async function history(client: Session, plan: DelegatedPlan, managerOid: string) {
  const { rows } = await client.query<HistoryRow>(`
    SELECT version,source_sha256,plan_sha256,catalog_sha256,installed_at::text FROM t_publication_install.history ORDER BY version`);
  const hash = planHash(plan, managerOid);
  requireState((rows.length === 1 || rows.length === 2) && rows[0].version === 2 && rows[0].source_sha256 === sourceSha &&
    rows[0].catalog_sha256 === delegatedCatalogSha && rows.every(row => row.plan_sha256 === hash));
  if (rows.length === 2) requireState(rows[1].version === 3 && rows[1].source_sha256 === playbackSourceSha && rows[1].catalog_sha256 === playbackCatalogSha);
  const latest = rows[rows.length - 1];
  requireState(await readDelegatedCatalogSha(client) === latest.catalog_sha256);
  return latest;
}

export async function installDelegatedPublication(client: Session, approved: DelegatedPlan, work: Work, version: 2 | 3 = 2) {
  const plan = structuredClone(approved);
  const sql = (await readFile(new URL("0001_delegated.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const mediaSql = version === 3 ? (await readFile(new URL("0002_playback.sql", import.meta.url), "utf8")).replaceAll("\r\n", "\n") : undefined;
  requireState(digest(sql) === sourceSha && (version === 2 || (version === 3 && mediaSql && digest(mediaSql) === playbackSourceSha)));
  return transaction(client, "write", async () => {
    await assertTarget(client, plan.target, plan.installer, work);
    await topology(client, plan, work.manager.oid, true);
    async function record(revision: number, source: string, catalog: string) {
      requireState(await readDelegatedCatalogSha(client) === catalog);
      await client.query("SET LOCAL ROLE t341_history_owner");
      await client.query(`INSERT INTO t_publication_install.history(version,source_sha256,plan_sha256,catalog_sha256) VALUES ($1,$2,$3,$4)`,
        [revision, source, planHash(plan, work.manager.oid), catalog]);
      await client.query("RESET ROLE");
    }
    const { rows } = await client.query("SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])", [delegatedSchemas]);
    if (!rows.length) {
      await client.query(sql);
      await record(2, sourceSha, delegatedCatalogSha);
    } else {
      requireState(mediaSql && rows.length === delegatedSchemas.length);
      await client.query("SET LOCAL ROLE t341_history_owner");
      const installed = await history(client, plan, work.manager.oid);
      requireState(installed.version === 2);
      await client.query("RESET ROLE");
    }
    if (mediaSql) {
      await client.query(mediaSql);
      await record(3, playbackSourceSha, playbackCatalogSha);
    }
    await assertWork(client, work);
    return { mode: "pending-seal" as const };
  });
}

async function readInstallation(client: Session, plan: DelegatedPlan, managerOid: string) {
  const { rows: namespaces } = await client.query("SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])", [delegatedSchemas]);
  if (!namespaces.length) {
    await topology(client, plan, managerOid, true);
    return { mode: "prepared" as const };
  }
  requireState(namespaces.length === delegatedSchemas.length);
  const row = await history(client, plan, managerOid);
  const { rows: [installer] } = await client.query<{ rolcanlogin: boolean }>("SELECT rolcanlogin FROM pg_roles WHERE oid=$1::oid", [plan.installer.oid]);
  requireState(installer);
  await topology(client, plan, managerOid, installer.rolcanlogin);
  const { rows: [connection] } = await client.query<{ present: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid=$1::oid) AS present`,
    [plan.installer.oid]);
  return installer.rolcanlogin || connection.present ? { mode: "pending-seal" as const, installedAt: row.installed_at }
    : { mode: "sealed" as const, installedAt: row.installed_at };
}

export async function verifyDelegatedPublication(client: Session, approved: DelegatedPlan, work: Work) {
  const plan = structuredClone(approved);
  return transaction(client, "verify", async () => {
    await assertTarget(client, plan.target, plan.verifier, work);
    const observed = await readInstallation(client, plan, work.manager.oid);
    await assertWork(client, work);
    return observed;
  });
}

/** Read the approved identity after startup, independently of the released installation lock. */
export async function revalidateDelegatedPublication(client: Session, approved: DelegatedPlan, work: Work, installedAt: string) {
  const plan = structuredClone(approved);
  await transaction(client, "verify", async () => {
    requireState(isDeepStrictEqual(plan.target, work.target));
    await assertIdentity(client, plan.target, plan.verifier);
    const observed = await readInstallation(client, plan, work.manager.oid);
    requireState(observed.mode === "sealed" && observed.installedAt === installedAt);
  });
}
