import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createPostgresPool, type PostgresConnectionOptions } from "./connection";
import { canonicalJson } from "../../storage/uploads/receipt";
import { reserveUpload } from "../../storage/uploads/state";
import { encodeUploadReservation } from "./upload-reservation-codec";
import { assertPlainData, recordId } from "../../storage/uploads/schema";
import type { ReservationRequestSnapshot } from "../../storage/uploads/reservation-client";
import { reservationEntries } from "../../repo/postgres/upload-reservations";
import { decodeReservationReply, reservationFailureReason, ReservationReplyError } from "./reservation-replies";
import { reservationCommitted, reservationNotApplied, reservationUnknown, type ClosedReason, type ReservationAttemptResult, type ReservationRecord } from "./reservation-outcome";

export type ReservationTarget = Readonly<{ schemaVersion: 5; sql5Sha256: string; serverMajor: 18; loginOid: number; apiRoleOid: number; apiMembershipGrantorOid: number; issuerRoleOid: number; migrationOwnerOid: number; bootstrapOid: number; readSeedFunctionOid: number; reserveUploadFunctionOid: number; provenanceId: string; scope: "owned-synthetic" | "approved-runtime" }>;
export type ReservationLimits = Readonly<{ statementTimeoutMs: number; lockTimeoutMs: number; idleTimeoutMs: number; attemptDeadlineMs: number; cleanupDeadlineMs: number }>;
export type ReservationConfiguration = Readonly<{ connection: Readonly<Omit<PostgresConnectionOptions, "max">>; target: ReservationTarget; limits: ReservationLimits; nextRecordId: () => string }>;
const scope = new AsyncLocalStorage<boolean>(), usedPools = new WeakSet<object>();
class Fault extends Error { constructor(readonly reason: ClosedReason) { super(reason); } }

// Static metadata queries are private. They expose no caller-chosen SQL or role.
const identitySql = `/* reservation.identity */ WITH RECURSIVE chain(oid,path) AS (
 SELECT session_user::regrole::oid,ARRAY[session_user::regrole::oid]
 UNION ALL SELECT m.roleid,c.path||m.roleid FROM pg_catalog.pg_auth_members m JOIN chain c ON m.member=c.oid WHERE NOT m.roleid=ANY(c.path)
) SELECT json_build_object('loginOid',session_user::regrole::oid::text,'currentOid',current_user::regrole::oid::text,
 'serverMajor',current_setting('server_version_num')::integer/10000,'actorGuc',current_setting('dream.actor_id',true),
 'login',(SELECT row_to_json(r) FROM (SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolinherit FROM pg_catalog.pg_roles WHERE oid=session_user::regrole) r),
 'api',(SELECT row_to_json(r) FROM (SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolinherit FROM pg_catalog.pg_roles WHERE oid=$1::oid) r),
 'issuer',(SELECT row_to_json(r) FROM (SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolinherit FROM pg_catalog.pg_roles WHERE oid=$2::oid) r),
 'ownsObjects',EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=session_user::regrole) OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=session_user::regrole),
 'ancestors',(SELECT json_agg(DISTINCT oid::text) FROM chain),
 'memberships',(SELECT coalesce(json_agg(json_build_object('roleid',m.roleid::text,'member',m.member::text,'grantor',m.grantor::text,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option)),'[]') FROM pg_catalog.pg_auth_members m WHERE m.member IN(SELECT oid FROM chain) OR m.roleid=session_user::regrole),
 'forbiddenPath',pg_catalog.pg_has_role(session_user::regrole,$2::oid,'MEMBER') OR pg_catalog.pg_has_role(session_user::regrole,$3::oid,'MEMBER') OR pg_catalog.pg_has_role(session_user::regrole,'dream_worker','MEMBER')) AS identity`;
const localSql = "/* reservation.local */ SELECT current_user::regrole::oid::text AS role_oid,session_user::regrole::oid::text AS login_oid,dream.actor_id()::text AS actor_id,current_setting('transaction_isolation') AS isolation";
const functionsSql = `/* reservation.functions */ WITH wanted AS (
 SELECT 'read' AS slot,pg_catalog.to_regprocedure('dream_reservation.read_upload_seed_v1(uuid,text)') AS oid
 UNION ALL SELECT 'reserve',pg_catalog.to_regprocedure('dream_reservation.reserve_upload_v1(uuid,text,text)')
) SELECT w.slot,p.oid::text AS oid,p.proowner::text AS owner_oid,n.nspowner::text AS namespace_owner_oid,p.prosecdef,p.provolatile,p.proconfig,
 pg_catalog.has_function_privilege($1::oid,p.oid,'EXECUTE') AS api_execute,
 EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee NOT IN($1::oid,$2::oid) OR a.grantor<>$2::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable AND a.grantee<>$2::oid) AS unexpected_acl,
 ((SELECT count(*) FROM pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))))<>4 OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE a.grantor<>$3::oid OR a.is_grantable OR NOT(a.grantee=$3::oid AND a.privilege_type IN('CREATE','USAGE') OR a.grantee IN($1::oid,$2::oid) AND a.privilege_type='USAGE'))) AS unexpected_namespace_acl
 FROM wanted w LEFT JOIN pg_catalog.pg_proc p ON p.oid=w.oid LEFT JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace ORDER BY w.slot`;
const hygieneSql = "/* reservation.hygiene */ SELECT current_user::regrole::oid::text AS current_oid,session_user::regrole::oid::text AS login_oid,current_setting('dream.actor_id',true) AS actor_guc";
const oid = (v: unknown) => typeof v === "string" && /^[1-9][0-9]{0,9}$/.test(v) && Number(v) <= 4294967295 ? Number(v) : 0;
function requireFact(ok: unknown) { if (!ok) throw new Fault("CONFIGURATION_REJECTED"); }
function checkIdentity(result: QueryResult, t: ReservationTarget) {
  try { assertPlainData(result.rows); } catch { throw new Fault("CONFIGURATION_REJECTED"); }
  requireFact(result.rows.length === 1 && Object.keys(result.rows[0]).length === 1);
  const r = result.rows[0].identity;
  requireFact(r && oid(r.loginOid) === t.loginOid && oid(r.currentOid) === t.loginOid && r.serverMajor === t.serverMajor && (r.actorGuc === null || r.actorGuc === "") && r.ownsObjects === false && r.forbiddenPath === false);
  for (const [name, login] of [["login", true], ["api", false], ["issuer", false]] as const) {
    const flags = r[name];
    requireFact(flags && flags.rolcanlogin === login && ["rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb", "rolreplication", "rolinherit"].every(k => flags[k] === false));
  }
  requireFact(Array.isArray(r.ancestors) && r.ancestors.length === 2 && r.ancestors.map(oid).sort().join() === [t.loginOid, t.apiRoleOid].sort().join());
  requireFact(Array.isArray(r.memberships) && r.memberships.length === 1);
  const m = r.memberships[0];
  requireFact(oid(m.roleid) === t.apiRoleOid && oid(m.member) === t.loginOid && oid(m.grantor) === t.apiMembershipGrantorOid && m.admin === false && m.inherit === false && m.set === true);
}
function checkFunctions(result: QueryResult, t: ReservationTarget) {
  try { assertPlainData(result.rows); } catch { throw new Fault("CONFIGURATION_REJECTED"); }
  requireFact(result.rows.length === 2 && new Set(result.rows.map(r => r.slot)).size === 2);
  for (const r of result.rows) requireFact((r.slot === "read" || r.slot === "reserve") && oid(r.oid) === (r.slot === "read" ? t.readSeedFunctionOid : t.reserveUploadFunctionOid) && oid(r.owner_oid) === t.issuerRoleOid && oid(r.namespace_owner_oid) === t.migrationOwnerOid && r.prosecdef === true && r.provolatile === "v" && Array.isArray(r.proconfig) && canonicalJson(r.proconfig) === '["search_path=pg_catalog, pg_temp","row_security=on"]' && r.api_execute === true && r.unexpected_acl === false && r.unexpected_namespace_acl === false);
}

/** One retained owner, including after the bounded public result. */
class Lease {
  client?: PoolClient;
  settled = false; abandoned = false; adopted = false; broken = false;
  ended = false; cleanupError = false; private released = false; private fallback = false;
  private poolEndStarted = false; private poolEndSettled = false;
  private wakes = new Set<() => void>();
  readonly checkout: Promise<PoolClient>;
  constructor(readonly pool: Pool, skipConnect = false) {
    pool.on("error", () => { this.cleanupError = true; this.broken = true; this.notify(); });
    let original: Promise<PoolClient>;
    try { original = skipConnect ? Promise.reject(new Fault("CANCELLED")) : pool.connect(); } catch { original = Promise.reject(new Fault("SERVICE_UNAVAILABLE")); }
    this.checkout = original.then(c => {
      this.client = c; this.settled = true;
      c.on("error", () => { this.broken = true; this.cleanupError = true; this.notify(); });
      c.once("end", () => { this.ended = true; this.notify(); });
      if (this.abandoned) this.retire();
      this.notify(); return c;
    }, () => { this.settled = true; this.notify(); throw new Fault("SERVICE_UNAVAILABLE"); });
    void this.checkout.catch(() => {}); // Original settlement remains supervised after a race returns.
  }
  private notify() { for (const wake of this.wakes) wake(); }
  retire() {
    const c = this.client;
    if (!c || this.released) return;
    this.released = true;
    try { c.release(true); } catch {
      this.cleanupError = true;
      if (!this.ended && !this.fallback) {
        this.fallback = true;
        try { void c.end().then(() => this.notify(), () => { this.cleanupError = true; this.notify(); }); }
        catch { this.cleanupError = true; }
      }
    }
    this.notify();
  }
  private endPool() {
    if (this.poolEndStarted) return;
    this.poolEndStarted = true;
    try { void this.pool.end().then(() => { this.poolEndSettled = true; this.notify(); }, () => { this.poolEndSettled = true; this.cleanupError = true; this.notify(); }); }
    catch { this.poolEndSettled = true; this.cleanupError = true; this.notify(); }
  }
  async cleanup(ms: number): Promise<"ok" | "failed"> {
    this.abandoned = true; this.retire(); this.endPool();
    const done = () => this.settled && (!this.client || this.ended) && this.poolEndSettled;
    if (!done()) await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.wakes.delete(wake); resolve(); };
      const wake = () => { if (done()) finish(); };
      const timer = setTimeout(finish, ms); this.wakes.add(wake); wake();
    });
    return done() && !this.cleanupError ? "ok" : "failed";
  }
}
function bounded<T>(original: Promise<T>, deadline: number, signal: AbortSignal | undefined, abandon: () => void): Promise<T> {
  // Caller has already installed persistent settlement/error ownership.
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (callback: () => void) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); callback(); };
    const abort = () => finish(() => { abandon(); reject(new Fault("CANCELLED")); });
    const timer = setTimeout(() => finish(() => { abandon(); reject(new Fault("SERVICE_UNAVAILABLE")); }), Math.max(0, deadline - performance.now()));
    original.then(v => finish(() => resolve(v)), () => finish(() => reject(new Fault("SERVICE_UNAVAILABLE"))));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else if (performance.now() >= deadline) finish(() => { abandon(); reject(new Fault("SERVICE_UNAVAILABLE")); });
  });
}

/** @internal Whole workflow only. No callback/tx/query escapes to its caller. */
export async function runReservationAttempt(actorId: string, request: ReservationRequestSnapshot, config: ReservationConfiguration, signal?: AbortSignal): Promise<ReservationAttemptResult> {
  const identity = Object.freeze({ requestId: request.requestId, clientVersion: 1 as const, clientDigest: request.client.clientDigest });
  if (scope.getStore()) return reservationNotApplied("CONFIGURATION_REJECTED", identity);
  return scope.run(true, async () => {
    const deadline = performance.now() + config.limits.attemptDeadlineMs;
    let pool: Pool;
    try { pool = createPostgresPool({ ...config.connection, max: 1 }); } catch { return reservationNotApplied("CONFIGURATION_REJECTED", identity); }
    if (usedPools.has(pool)) return reservationNotApplied("CONFIGURATION_REJECTED", identity);
    usedPools.add(pool);
    const lease = new Lease(pool, signal?.aborted || performance.now() >= deadline);
    let begun = false, mayReserve = false, commitSent = false, rolledBack = false;
    let candidate: ReservationRecord | undefined, committed: ReservationRecord | undefined;
    let reason: ClosedReason = "SERVICE_UNAVAILABLE";
    const query = async (text: string, values: readonly unknown[] = []): Promise<QueryResult> => {
      if (!lease.adopted || lease.abandoned || lease.broken || !lease.client) throw new Fault("SERVICE_UNAVAILABLE");
      if (signal?.aborted && !commitSent && text !== "ROLLBACK") throw new Fault("CANCELLED");
      let original: Promise<QueryResult>;
      try { original = lease.client.query(text, [...values]); } catch { lease.broken = true; throw new Fault("SERVICE_UNAVAILABLE"); }
      const tracked = original.then(r => {
        if (text === "COMMIT" && r.command === "COMMIT" && candidate) committed = candidate;
        return r;
      }, () => { lease.broken = true; throw new Fault("SERVICE_UNAVAILABLE"); });
      void tracked.catch(() => {});
      return bounded(tracked, deadline, commitSent || text === "ROLLBACK" ? undefined : signal, () => { lease.abandoned = true; lease.broken = true; });
    };
    try {
      await bounded(lease.checkout, deadline, signal, () => { lease.abandoned = true; });
      if (signal?.aborted) throw new Fault("CANCELLED");
      if (lease.abandoned || performance.now() >= deadline) throw new Fault("SERVICE_UNAVAILABLE");
      lease.adopted = true;
      const t = config.target;
      checkIdentity(await query(identitySql, [t.apiRoleOid, t.issuerRoleOid, t.migrationOwnerOid]), t);
      requireFact((await query("BEGIN ISOLATION LEVEL READ COMMITTED")).command === "BEGIN"); begun = true;
      await query("SET LOCAL ROLE dream_api"); await query("SET LOCAL row_security=on"); await query("SET LOCAL search_path=pg_catalog");
      await query("SELECT set_config('dream.actor_id',$1,true),set_config('statement_timeout',$2,true),set_config('lock_timeout',$3,true),set_config('idle_in_transaction_session_timeout',$4,true)", [actorId, String(config.limits.statementTimeoutMs), String(config.limits.lockTimeoutMs), String(config.limits.idleTimeoutMs)]);
      const local = await query(localSql);
      requireFact(local.rows.length === 1 && oid(local.rows[0].role_oid) === t.apiRoleOid && oid(local.rows[0].login_oid) === t.loginOid && local.rows[0].actor_id === actorId && local.rows[0].isolation === "read committed");
      checkFunctions(await query(functionsSql, [t.apiRoleOid, t.issuerRoleOid, t.migrationOwnerOid]), t);
      const repo = reservationEntries({ query });
      let reply = decodeReservationReply((await repo.readSeed(request.requestId, request.client.canonicalJson)).rows, "read", actorId, request);
      if (reply.tag === "seed") {
        const s = reply.seed, p = s.policy;
        const ids = [config.nextRecordId(), config.nextRecordId(), config.nextRecordId()];
        if (new Set(ids).size !== 3 || ids.some(v => typeof v !== "string" || v.length !== 36 || !recordId.safeParse(v).success)) throw new Fault("CONFIGURATION_REJECTED");
        const add = (n: number) => { const sum = BigInt(s.now) + BigInt(n); if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Fault("ADMISSION_STALE"); return Number(sum); };
        const reservation = { ownerId: actorId, objectId: ids[0], assetId: ids[1], intentId: ids[2], intentExpiresAt: add(p.intentTtlMs), issueEnvelopeUntil: add(p.issueEnvelopeMs), maxIssues: p.maxIssues, verifiers: p.verifiers, collectors: p.collectors, policyManagers: p.policyManagers, policyEpoch: s.policyEpoch, policyDigest: s.policyDigest, incoming: { bucket: p.incomingBucket, key: `${actorId}/incoming/${ids[0]}/${ids[2]}`, providerVersion: null } };
        const model = reserveUpload(reservation, { principalId: actorId, now: s.now, expectedRevision: 0 });
        const raw = canonicalJson({ codecVersion: 1, requestId: request.requestId, maxBytes: Math.min(request.client.requestedMaxBytes, p.maxBytes, p.providerMaxBytes), reservedAt: s.now, reservation });
        const prepared = encodeUploadReservation({ model, requestJson: raw }); // Never execute its INSERT specs.
        mayReserve = true;
        reply = decodeReservationReply((await repo.reserve(request.requestId, request.client.canonicalJson, prepared.requestJson)).rows, "reserve", actorId, request, prepared.requestJson);
      }
      if (reply.tag !== "replay" && reply.tag !== "staged") {
        if (reply.tag === "seed") throw new Fault("REPLY_INVALID");
        throw new Fault(reservationFailureReason(reply.tag));
      }
      candidate = reply.record;
      if (signal?.aborted) throw new Fault("CANCELLED");
      commitSent = true;
      const ack = await query("COMMIT");
      if (ack.command !== "COMMIT" || !committed) throw new Fault("SERVICE_UNAVAILABLE");
      begun = false;
      const clean = await query(hygieneSql);
      requireFact(clean.rows.length === 1 && oid(clean.rows[0].current_oid) === t.loginOid && oid(clean.rows[0].login_oid) === t.loginOid && (clean.rows[0].actor_guc === null || clean.rows[0].actor_guc === ""));
    } catch (error) {
      reason = error instanceof Fault ? error.reason : error instanceof ReservationReplyError ? "REPLY_INVALID" : "SERVICE_UNAVAILABLE";
      if (committed) lease.cleanupError = true;
      else if (!commitSent && begun && !lease.broken && !lease.abandoned) {
        try { rolledBack = (await query("ROLLBACK")).command === "ROLLBACK"; } catch { lease.broken = true; }
      }
    }
    const cleanup = await lease.cleanup(config.limits.cleanupDeadlineMs);
    if (committed) return reservationCommitted(committed, identity, cleanup);
    if (commitSent || mayReserve && !rolledBack) return reservationUnknown(identity, cleanup);
    return reservationNotApplied(reason, identity, cleanup);
  });
}
