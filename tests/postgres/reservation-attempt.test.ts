import { EventEmitter } from "node:events";
import type { Pool, PoolClient, QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/postgres/connection", () => ({ createPostgresPool: mocked.pool }));
import { postgresUploadReservations, type ServerReservationDependencies } from "@/lib/services/postgres/upload-reservations";
import { actorFromVerifiedUserId, type VerifiedActor } from "@/lib/db/postgres/types";

const A = "00000000-0000-4000-8000-000000000001", W = "00000000-0000-4000-8000-000000000002";
const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const actor = actorFromVerifiedUserId(A), client = '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}';
const request = () => ({ requestId: uid(4), clientJson: client });
const flags = (login = false) => ({ rolcanlogin: login, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: false });
function config(): ServerReservationDependencies {
  let n = 100;
  return { connection: { connectionString: "postgresql://synthetic:synthetic@127.0.0.1:5432/dream_test_adapter", localTestWithoutTls: true },
    target: { schemaVersion: 5, sql5Sha256: "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb", serverMajor: 18, loginOid: 11, apiRoleOid: 12, apiMembershipGrantorOid: 10, issuerRoleOid: 13, migrationOwnerOid: 14, bootstrapOid: 10, readSeedFunctionOid: 21, reserveUploadFunctionOid: 22, provenanceId: "owned-unit-fixture-not-attestation", scope: "owned-synthetic" },
    limits: { statementTimeoutMs: 50, lockTimeoutMs: 25, idleTimeoutMs: 100, attemptDeadlineMs: 100, cleanupDeadlineMs: 10 },
    nextRecordId: () => uid(++n) };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const result = (rows: unknown[] = [], command = "SELECT") => ({ rows, command, rowCount: rows.length, fields: [], oid: 0 }) as QueryResult;
function history(raw: string, tag: "staged" | "replay" = "staged") {
  const d = JSON.parse(raw), r = d.reservation;
  return { tag, reservation: { requestId: d.requestId, objectId: r.objectId, assetId: r.assetId, intentId: r.intentId, reservedAt: d.reservedAt, authorizationUntil: r.intentExpiresAt, issueEnvelopeUntil: r.issueEnvelopeUntil, maxBytes: d.maxBytes, policyEpoch: r.policyEpoch, policyDigest: r.policyDigest }, originalEnvelope: raw,
    current: { lifecycle: "reserved", revision: 0, intentStatus: "open", intentRevision: 0, initialClosed: false }, issuanceAuthorized: false, ...(tag === "staged" ? { commitConfirmed: false } : {}) };
}
class FakeClient extends EventEmitter {
  calls: { text: string; values: readonly unknown[] }[] = [];
  releases = 0; fallbackEnds = 0; endAutomatically = true;
  releaseMode: "ok" | "throw-before" | "throw-after" = "ok";
  fallbackThrows = false; fallbackRejects = false; actor = ""; lastRaw = ""; persistedRaw = "";
  readRaw?: string; readTag?: string; reserveTag?: string;
  identity = { loginOid: "11", currentOid: "11", serverMajor: 18, actorGuc: null, login: flags(true), api: flags(), issuer: flags(), ownsObjects: false, forbiddenPath: false, ancestors: ["11", "12"], memberships: [{ roleid: "12", member: "11", grantor: "10", admin: false, inherit: false, set: true }] };
  functions = ["read", "reserve"].map((slot, i) => ({ slot, oid: String(21 + i), owner_oid: "13", namespace_owner_oid: "14", prosecdef: true, provolatile: "v", proconfig: ["search_path=pg_catalog, pg_temp", "row_security=on"], api_execute: true, unexpected_acl: false, unexpected_namespace_acl: false }));
  hook?: (text: string, values: readonly unknown[]) => Promise<QueryResult> | QueryResult | undefined;
  query(text: string, values: readonly unknown[] = []): Promise<QueryResult> {
    this.calls.push({ text, values });
    try {
      const special = this.hook?.(text, values); if (special) return Promise.resolve(special);
      if (text.includes("reservation.identity")) return Promise.resolve(result([{ identity: this.identity }]));
      if (text.includes("reservation.local")) return Promise.resolve(result([{ role_oid: "12", login_oid: "11", actor_id: this.actor, isolation: "read committed" }]));
      if (text.includes("reservation.functions")) return Promise.resolve(result(this.functions));
      if (text.includes("reservation.hygiene")) return Promise.resolve(result([{ current_oid: "11", login_oid: "11", actor_guc: "" }]));
      if (text.startsWith("SELECT set_config('dream.actor_id'")) this.actor = String(values[0]);
      if (text.includes("read_upload_seed_v1($1")) return Promise.resolve(result([{ reservation_reply: this.readTag ? { tag: this.readTag } : this.readRaw ? history(this.readRaw, "replay") : { tag: "seed", ownerId: this.actor, requestId: values[0], policyId: "asset-upload", policyEpoch: 1, policyDigest: "b".repeat(64), now: 1000, issuanceAuthorized: false, policy: { bodyVersion: 1, collectors: [W], incomingBucket: "synthetic-incoming", intentTtlMs: 2000, issueEnvelopeMs: 1000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3, maxPreparationAgeMs: 1000, policyManagers: [W], providerMaxBytes: 1048576, verifiers: [W] } } }]));
      if (text.includes("reserve_upload_v1($1")) { this.lastRaw = String(values[2]); return Promise.resolve(result([{ reservation_reply: this.reserveTag ? { tag: this.reserveTag } : history(this.lastRaw) }])); }
      if (text === "COMMIT") this.persistedRaw = this.lastRaw;
      return Promise.resolve(result([], text.startsWith("BEGIN") ? "BEGIN" : text.startsWith("SET") ? "SET" : text === "COMMIT" || text === "ROLLBACK" ? text : "SELECT"));
    } catch (e) { return Promise.reject(e); }
  }
  release(destroy: boolean) {
    expect(destroy).toBe(true); this.releases++;
    if (this.releaseMode === "throw-before") throw new Error("secret release cause");
    if (this.endAutomatically) this.emit("end");
    if (this.releaseMode === "throw-after") throw new Error("secret release cause");
  }
  end(): Promise<void> { this.fallbackEnds++; if (this.fallbackThrows) throw new Error("secret end"); if (this.fallbackRejects) return Promise.reject(new Error("secret async end")); if (this.endAutomatically) this.emit("end"); return Promise.resolve(); }
}
class FakePool extends EventEmitter {
  connects = 0; ends = 0;
  checkout?: ReturnType<typeof deferred<PoolClient>>;
  ending?: ReturnType<typeof deferred<void>>;
  endThrows = false; connectThrows = false; onConnect?: () => void;
  client = new FakeClient();
  connect(): Promise<PoolClient> { this.connects++; this.onConnect?.(); if (this.connectThrows) throw new Error("postgres://secret"); return this.checkout?.promise ?? Promise.resolve(this.client as unknown as PoolClient); }
  end(): Promise<void> { this.ends++; if (this.endThrows) throw new Error("secret pool end"); return this.ending?.promise ?? Promise.resolve(); }
}
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); mocked.pool.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
function setup(pool = new FakePool(), cfg = config()) { mocked.pool.mockReturnValue(pool as unknown as Pool); return { pool, cfg, service: postgresUploadReservations(cfg) }; }
const hasWrite = (c: FakeClient) => c.calls.some(q => q.text.includes("reserve_upload_v1($1"));
describe("B33 closed adapter with controllable fake driver; NOT native DB proof", () => {
  it("creates only through two entries and returns after observed COMMIT+client end+pool end", async () => {
    const { pool, service } = setup(); const value = await service.reserve(actor, request());
    expect(value).toMatchObject({ kind: "success", commit: "confirmed", cleanup: "ok", record: { origin: "created", issuanceAuthorized: false } });
    expect(pool.connects).toBe(1); expect(pool.ends).toBe(1); expect(pool.client.releases).toBe(1);
    expect(pool.client.calls.filter(q => /read_upload_seed_v1\(\$1|reserve_upload_v1\(\$1/.test(q.text))).toHaveLength(2);
    expect(pool.client.calls.some(q => /INSERT|Storage|signed/.test(q.text))).toBe(false);
    expect(mocked.pool.mock.calls[0][0].max).toBe(1); expect(Object.isFrozen(value)).toBe(true);
  });
  it("invalid actor never reads body getters or opens a pool", async () => {
    const { service } = setup(); let reads = 0;
    const body = { get requestId() { reads++; return uid(4); } };
    expect(await service.reserve({ id: A } as VerifiedActor, body)).toMatchObject({ reason: "AUTH_REQUIRED" });
    expect(reads).toBe(0); expect(mocked.pool).not.toHaveBeenCalled();
  });
  it("valid actor rejects body getters without evaluating them", async () => {
    const { service } = setup(); let reads = 0;
    expect(await service.reserve(actor, { get requestId() { reads++; return uid(4); }, clientJson: client })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(reads).toBe(0); expect(mocked.pool).not.toHaveBeenCalled();
  });
  it("approved runtime is disabled even with a complete target", async () => {
    const cfg = config(); cfg.target.scope = "approved-runtime";
    const { service } = setup(undefined, cfg); expect(await service.reserve(actor, request())).toMatchObject({ reason: "DISABLED" }); expect(mocked.pool).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 4294967296, undefined])("rejects invalid/missing configured function OID %s preconnect", async value => {
    const cfg = config(); Object.assign(cfg.target, { readSeedFunctionOid: value });
    const { service } = setup(undefined, cfg); expect(await service.reserve(actor, request())).toMatchObject({ reason: "CONFIGURATION_REJECTED" }); expect(mocked.pool).not.toHaveBeenCalled();
  });
  it("rejects unknown config fields and genuine branded but B25-invalid actor", async () => {
    const cfg = config(); Object.assign(cfg.target, { mystery: true });
    const { service } = setup(undefined, cfg); expect(await service.reserve(actor, request())).toMatchObject({ reason: "CONFIGURATION_REJECTED" });
    expect(await postgresUploadReservations(config()).reserve(actorFromVerifiedUserId("11111111-1111-9111-8111-111111111111"), request())).toMatchObject({ reason: "AUTH_REQUIRED" }); expect(mocked.pool).not.toHaveBeenCalled();
  });
  it("snapshots mutable request/config before deferred connect", async () => {
    const pool = new FakePool(); pool.checkout = deferred<PoolClient>(); const cfg = config(), input = request();
    const { service } = setup(pool, cfg); const pending = service.reserve(actor, input); await flush();
    input.requestId = uid(999); input.clientJson = "evil"; cfg.target.readSeedFunctionOid = 999; cfg.connection.connectionString = "postgres://evil"; cfg.limits.attemptDeadlineMs = 1;
    pool.checkout.resolve(pool.client as unknown as PoolClient); const result = await pending;
    expect(result.kind).toBe("success"); expect(pool.client.calls.find(q => q.text.includes("read_upload_seed_v1($1"))?.values).toEqual([uid(4), client]);
    expect(mocked.pool.mock.calls[0][0].connectionString).toContain("synthetic");
  });
  it("abort before checkout makes zero pools/connects", async () => {
    const { service } = setup(); const abort = new AbortController(); abort.abort();
    expect(await service.reserve(actor, request(), { signal: abort.signal })).toMatchObject({ commit: "not-applied", reason: "CANCELLED" }); expect(mocked.pool).not.toHaveBeenCalled();
  });
  it.each(["abort", "deadline"])("pending checkout %s retains late zero-SQL retirement and immutable failed cleanup", async mode => {
    const pool = new FakePool(); pool.checkout = deferred<PoolClient>(); const { service } = setup(pool); const abort = new AbortController();
    const pending = service.reserve(actor, request(), { signal: abort.signal }); await flush();
    if (mode === "abort") abort.abort(); else await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(10); const value = await pending, before = JSON.stringify(value);
    expect(value).toMatchObject({ commit: "not-applied", cleanup: "failed", reason: mode === "abort" ? "CANCELLED" : "SERVICE_UNAVAILABLE" });
    pool.checkout.resolve(pool.client as unknown as PoolClient); await flush();
    expect(pool.client.calls).toHaveLength(0); expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1);
    expect(() => pool.client.emit("error", new Error("secret late"))).not.toThrow(); expect(JSON.stringify(value)).toBe(before);
  });
  it("pending checkout late rejection is consumed after bounded result", async () => {
    const pool = new FakePool(); pool.checkout = deferred<PoolClient>(); const { service } = setup(pool);
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(110);
    const value = await pending; pool.checkout.reject(new Error("postgres://late-secret")); await flush();
    expect(value).toMatchObject({ commit: "not-applied", cleanup: "failed" }); expect(pool.ends).toBe(1); expect(pool.client.calls).toHaveLength(0);
  });
  it("late checkout within cleanup grace can retire cleanly without SQL", async () => {
    const pool = new FakePool(); pool.checkout = deferred<PoolClient>(); const { service } = setup(pool); const abort = new AbortController();
    const pending = service.reserve(actor, request(), { signal: abort.signal }); await flush(); abort.abort(); await flush();
    pool.checkout.resolve(pool.client as unknown as PoolClient); expect(await pending).toMatchObject({ commit: "not-applied", cleanup: "ok", reason: "CANCELLED" }); expect(pool.client.calls).toHaveLength(0);
  });
  it.each(["identity", "function", "namespace"])("rejects actual %s metadata mismatch before entries", async kind => {
    const { pool, service } = setup();
    if (kind === "identity") pool.client.identity.login.rolsuper = true;
    if (kind === "function") pool.client.functions.reverse().forEach((r, i) => { r.oid = String(21 + i); });
    if (kind === "namespace") pool.client.functions[0].unexpected_namespace_acl = true;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" }); expect(hasWrite(pool.client)).toBe(false);
    expect(pool.client.calls.some(q => q.text.includes("read_upload_seed_v1($1"))).toBe(false);
  });
  it.each(["INPUT", "CONFLICT", "STALE_SEED", "IDENTITY_CONFLICT", "UNAVAILABLE"])("closed reserve tag %s gets confirmed rollback without retry", async tag => {
    const { pool, service } = setup(); pool.client.reserveTag = tag;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied" });
    expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(1); expect(pool.connects).toBe(1);
  });
  it("failed rollback after may-reserve remains unknown", async () => {
    const { pool, service } = setup(); pool.client.reserveTag = "INPUT"; pool.client.hook = text => text === "ROLLBACK" ? result([], "not-ROLLBACK") : undefined;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "unknown", reason: "OUTCOME_UNKNOWN" });
  });
  it.each(["before-end", "after-end", "missing-end"])("late original ROLLBACK ACK before public return is preserved (%s)", async order => {
    const { pool, service } = setup(), wire = deferred<QueryResult>();
    pool.client.reserveTag = "INPUT"; pool.client.endAutomatically = false;
    pool.client.hook = text => text === "ROLLBACK" ? wire.promise : undefined;
    let returned = false;
    const pending = service.reserve(actor, request()).then(value => { returned = true; return value; });
    await flush(); await vi.advanceTimersByTimeAsync(10);
    expect(pool.client.releases).toBe(1); expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(5); expect(performance.now()).toBe(15);
    if (order === "after-end") pool.client.emit("end");
    wire.resolve(result([], "ROLLBACK")); await flush();
    if (order === "before-end") { expect(returned).toBe(false); pool.client.emit("end"); }
    if (order === "missing-end") await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ commit: "not-applied", reason: "ADMISSION_REJECTED", cleanup: order === "missing-end" ? "failed" : "ok" });
    expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(1);
    expect(pool.client.calls.some(q => q.text === "COMMIT" || q.text.includes("reservation.hygiene"))).toBe(false);
    expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1);
  });
  it("ROLLBACK ACK after public return cannot mutate the unknown result", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>(); pool.client.reserveTag = "INPUT";
    pool.client.hook = text => text === "ROLLBACK" ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(20);
    const value = await pending, before = JSON.stringify(value);
    expect(value).toMatchObject({ commit: "unknown", cleanup: "failed" });
    wire.resolve(result([], "ROLLBACK")); await flush();
    expect(JSON.stringify(value)).toBe(before); expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1);
  });
  it.each(["wrong-tag", "reject"])("late ROLLBACK %s provides no rollback confirmation", async mode => {
    const { pool, service } = setup(), wire = deferred<QueryResult>();
    pool.client.reserveTag = "INPUT"; pool.client.endAutomatically = false;
    pool.client.hook = text => text === "ROLLBACK" ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(10);
    if (mode === "wrong-tag") wire.resolve(result([], "COMMIT")); else wire.reject(new Error("late rollback secret"));
    await flush(); pool.client.emit("end");
    expect(await pending).toMatchObject({ commit: "unknown", cleanup: "ok", reason: "OUTCOME_UNKNOWN" });
    expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(1);
  });
  it.each(["COMMIT", "ROLLBACK"])("late %s response to dispatched COMMIT preserves commit precedence", async command => {
    const { pool, service } = setup(), wire = deferred<QueryResult>(); pool.client.endAutomatically = false;
    pool.client.hook = text => text === "COMMIT" ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(100);
    wire.resolve(result([], command)); await flush(); pool.client.emit("end");
    const value = await pending;
    if (command === "COMMIT") expect(value).toMatchObject({ commit: "confirmed", record: { origin: "created" } });
    else expect(value).toMatchObject({ commit: "unknown", reason: "OUTCOME_UNKNOWN" });
    expect(pool.client.calls.some(q => q.text === "ROLLBACK")).toBe(false); expect(pool.client.releases).toBe(1);
  });
  it("server-work may remain after early query rejection; never queues rollback/hygiene/COMMIT", async () => {
    const { pool, service } = setup(); let serverWork = false;
    pool.client.hook = text => { if (text.includes("reserve_upload_v1($1")) { serverWork = true; return Promise.reject(new Error("secret query read timeout while server active")); } };
    const value = await service.reserve(actor, request());
    expect(serverWork).toBe(true); expect(value).toMatchObject({ commit: "unknown" });
    expect(pool.client.calls.some(q => q.text === "ROLLBACK" || q.text === "COMMIT" || q.text.includes("reservation.hygiene"))).toBe(false);
    expect(JSON.stringify(value)).not.toContain("secret");
  });
  it("external deadline while original query never settles poisons instead of fake idle", async () => {
    const { pool, service } = setup(); const wire = deferred<QueryResult>(); pool.client.hook = text => text.includes("reserve_upload_v1($1") ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); expect(hasWrite(pool.client)).toBe(true); await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(10);
    const value = await pending; expect(value).toMatchObject({ commit: "unknown", cleanup: "failed" }); expect(pool.client.calls.some(q => q.text === "ROLLBACK" || q.text === "COMMIT")).toBe(false);
    wire.reject(new Error("late secret")); await flush(); expect(Object.isFrozen(value)).toBe(true);
  });
  it("F33-1 synchronous ID preparation exceeding the deadline sends no reserve or COMMIT", async () => {
    const cfg = config(); let n = 100;
    Object.assign(cfg, { nextRecordId: () => { vi.advanceTimersByTime(101); return uid(++n); } });
    const { pool, service } = setup(undefined, cfg);
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", cleanup: "ok", reason: "SERVICE_UNAVAILABLE" });
    expect(hasWrite(pool.client)).toBe(false); expect(pool.client.calls.some(q => q.text === "COMMIT")).toBe(false);
    expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(1);
  });
  it("F33-2 positive client/pool end cannot settle a pending original reserve promise", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>();
    pool.client.hook = text => text.includes("reserve_upload_v1($1") ? wire.promise : undefined;
    let returned = false;
    const pending = service.reserve(actor, request()).then(value => { returned = true; return value; });
    await flush(); await vi.advanceTimersByTimeAsync(100);
    expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1); expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    const value = await pending, before = JSON.stringify(value);
    expect(value).toMatchObject({ commit: "unknown", cleanup: "failed", reason: "OUTCOME_UNKNOWN" });
    wire.reject(new Error("late native secret")); await flush();
    expect(JSON.stringify(value)).toBe(before); expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1);
  });
  it("F33-1 expiry after a successful reserve reply prevents COMMIT and permits healthy rollback", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>(); let raw = "";
    pool.client.hook = (text, values) => {
      if (text.includes("reserve_upload_v1($1")) { raw = String(values[2]); return wire.promise; }
    };
    const pending = service.reserve(actor, request()); await flush(); expect(hasWrite(pool.client)).toBe(true);
    // The original query has already been dispatched and wrapped at clock 0.
    // Release its real success, then move only the controllable clock read before
    // its consumer resumes; no timeout/abort is fired to fake a poisoned client.
    wire.resolve(result([{ reservation_reply: history(raw) }]));
    const clock = vi.spyOn(performance, "now").mockReturnValue(101);
    try {
      expect(await pending).toMatchObject({ commit: "not-applied", cleanup: "ok", reason: "SERVICE_UNAVAILABLE" });
      expect(pool.client.calls.some(q => q.text === "COMMIT")).toBe(false);
      expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(1);
    } finally { clock.mockRestore(); }
  });
  it.each(["resolve", "reject"])("native reserve %s within cleanup grace is observed without further SQL", async settlement => {
    const { pool, service } = setup(), wire = deferred<QueryResult>();
    pool.client.hook = text => text.includes("reserve_upload_v1($1") ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(100);
    const calls = pool.client.calls.length;
    if (settlement === "resolve") wire.resolve(result([{ reservation_reply: { tag: "INPUT" } }])); else wire.reject(new Error("late native secret"));
    expect(await pending).toMatchObject({ commit: "unknown", cleanup: "ok" });
    expect(pool.client.calls).toHaveLength(calls); expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1);
  });
  it("pending native read requires failed cleanup even when no reserve was sent", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>();
    pool.client.hook = text => text.includes("read_upload_seed_v1($1") ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(110);
    const value = await pending;
    expect(value).toMatchObject({ commit: "not-applied", cleanup: "failed" }); expect(hasWrite(pool.client)).toBe(false);
    wire.resolve(result([])); await flush(); expect(pool.client.calls.some(q => q.text === "ROLLBACK" || q.text === "COMMIT")).toBe(false);
  });
  it("expired preparation allows only bounded healthy rollback, retaining its unresolved promise", async () => {
    const cfg = config(); let n = 100;
    Object.assign(cfg, { nextRecordId: () => { vi.advanceTimersByTime(101); return uid(++n); } });
    const { pool, service } = setup(undefined, cfg), wire = deferred<QueryResult>();
    pool.client.hook = text => text === "ROLLBACK" ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush();
    expect(hasWrite(pool.client)).toBe(false); expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ commit: "not-applied", cleanup: "failed" });
    wire.reject(new Error("late rollback secret")); await flush(); expect(pool.client.releases).toBe(1);
  });
  it("abort of pending reserve retains original settlement and sends no rollback", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>(), abort = new AbortController();
    pool.client.hook = text => text.includes("reserve_upload_v1($1") ? wire.promise : undefined;
    const pending = service.reserve(actor, request(), { signal: abort.signal }); await flush(); abort.abort();
    await flush(); await vi.advanceTimersByTimeAsync(10);
    const value = await pending, before = JSON.stringify(value);
    expect(value).toMatchObject({ commit: "unknown", cleanup: "failed" });
    expect(pool.client.calls.some(q => q.text === "ROLLBACK" || q.text === "COMMIT" || q.text.includes("reservation.hygiene"))).toBe(false);
    wire.resolve(result([])); await flush(); expect(JSON.stringify(value)).toBe(before);
  });
  it("abort before reserve dispatch can confirm rollback", async () => {
    const cfg = config(), abort = new AbortController(); let n = 100; Object.assign(cfg, { nextRecordId: () => { abort.abort(); return uid(++n); } });
    const { pool, service } = setup(undefined, cfg); const value = await service.reserve(actor, request(), { signal: abort.signal });
    expect(value).toMatchObject({ commit: "not-applied", reason: "CANCELLED" }); expect(hasWrite(pool.client)).toBe(false); expect(pool.client.calls.some(q => q.text === "ROLLBACK")).toBe(true);
  });
  it("lost COMMIT acknowledgement stays unknown; explicit same-key reconcile reuses original without new IDs", async () => {
    const first = new FakePool(), second = new FakePool(), cfg = config(); const generate = vi.fn(cfg.nextRecordId); Object.assign(cfg, { nextRecordId: generate });
    first.client.hook = text => { if (text === "COMMIT") { first.client.persistedRaw = first.client.lastRaw; return Promise.reject(new Error("simulated commit happened but reply lost")); } };
    mocked.pool.mockReturnValueOnce(first).mockReturnValueOnce(second); const service = postgresUploadReservations(cfg);
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "unknown" });
    second.client.readRaw = first.client.persistedRaw;
    expect(await service.reserve(actor, request())).toMatchObject({ kind: "success", record: { origin: "replayed" } });
    expect(generate).toHaveBeenCalledTimes(3); expect(mocked.pool).toHaveBeenCalledTimes(2); expect(hasWrite(second.client)).toBe(false);
  });
  it("unexpected COMMIT command never becomes rollback proof", async () => {
    const { pool, service } = setup(); pool.client.hook = text => text === "COMMIT" ? result([], "ROLLBACK") : undefined;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "unknown" }); expect(pool.client.calls.filter(q => q.text === "ROLLBACK")).toHaveLength(0);
  });
  it("abort during COMMIT does not erase an acknowledged record", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>(), abort = new AbortController();
    pool.client.hook = text => text === "COMMIT" ? wire.promise : undefined;
    const pending = service.reserve(actor, request(), { signal: abort.signal }); await flush(); expect(pool.client.calls.some(q => q.text === "COMMIT")).toBe(true);
    abort.abort(); await flush(); expect(pool.client.releases).toBe(0); wire.resolve(result([], "COMMIT"));
    expect(await pending).toMatchObject({ kind: "success", commit: "confirmed" });
  });
  it.each(["throw-before", "throw-after"] as const)("release %s preserves confirmed record and uses one retirement owner", async mode => {
    const { pool, service } = setup(); pool.client.releaseMode = mode;
    const value = await service.reserve(actor, request()); expect(value).toMatchObject({ kind: "failure", commit: "confirmed", cleanup: "failed", reason: "CLEANUP_FAILED", record: { origin: "created" } });
    expect(pool.client.releases).toBe(1); expect(pool.ends).toBe(1); expect(pool.client.fallbackEnds).toBe(mode === "throw-before" ? 1 : 0); expect(JSON.stringify(value)).not.toContain("secret");
  });
  it("pool end fulfilment before client end is not socket proof", async () => {
    const { pool, service } = setup(); pool.client.endAutomatically = false;
    const pending = service.reserve(actor, request()); await flush(); expect(pool.ends).toBe(1); await vi.advanceTimersByTimeAsync(10);
    const value = await pending, frozen = JSON.stringify(value); expect(value).toMatchObject({ commit: "confirmed", cleanup: "failed" });
    pool.client.emit("end"); pool.client.emit("error", new Error("late secret")); await flush(); expect(JSON.stringify(value)).toBe(frozen); expect(pool.client.releases).toBe(1);
  });
  it("pool-end and fallback-end throws cannot hide confirmed COMMIT", async () => {
    const { pool, service } = setup(); pool.endThrows = true; pool.client.releaseMode = "throw-before"; pool.client.fallbackThrows = true;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ commit: "confirmed", cleanup: "failed", reason: "CLEANUP_FAILED" }); expect(pool.ends).toBe(1); expect(pool.client.fallbackEnds).toBe(1);
  });
  it("confirmed COMMIT survives a concurrent client error but cleanup fails", async () => {
    const { pool, service } = setup(); pool.client.hook = text => { if (text === "COMMIT") { queueMicrotask(() => pool.client.emit("error", new Error("secret late error"))); return result([], "COMMIT"); } };
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "confirmed", cleanup: "failed", record: { origin: "created" } });
  });
  it("pool factory/connect synchronous failures never leak driver causes", async () => {
    const cfg = config(); mocked.pool.mockImplementationOnce(() => { throw new Error("postgres://factory-secret"); });
    const service = postgresUploadReservations(cfg); expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" });
    const pool = new FakePool(); pool.connectThrows = true; mocked.pool.mockReturnValueOnce(pool);
    const value = await service.reserve(actor, request()); expect(value).toMatchObject({ commit: "not-applied", reason: "SERVICE_UNAVAILABLE" }); expect(JSON.stringify(value)).not.toContain("secret"); expect(pool.ends).toBe(1);
  });
  it("abort fired synchronously inside connect is not lost before listener registration", async () => {
    const { pool, service } = setup(), abort = new AbortController(); pool.onConnect = () => abort.abort();
    expect(await service.reserve(actor, request(), { signal: abort.signal })).toMatchObject({ commit: "not-applied", reason: "CANCELLED" }); expect(pool.client.calls).toHaveLength(0); expect(pool.client.releases).toBe(1);
  });
  it("abort during pool creation prevents even connect", async () => {
    const pool = new FakePool(), abort = new AbortController(); mocked.pool.mockImplementation(() => { abort.abort(); return pool; });
    expect(await postgresUploadReservations(config()).reserve(actor, request(), { signal: abort.signal })).toMatchObject({ commit: "not-applied", reason: "CANCELLED" }); expect(pool.connects).toBe(0); expect(pool.ends).toBe(1);
  });
  it("never-settling checkout and pool end remain failed cleanup after bounded return", async () => {
    const pool = new FakePool(); pool.checkout = deferred<PoolClient>(); pool.ending = deferred<void>(); const { service } = setup(pool);
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(110); const value = await pending;
    expect(value).toMatchObject({ commit: "not-applied", cleanup: "failed" }); expect(pool.connects).toBe(1); expect(pool.ends).toBe(1); expect(pool.client.calls).toHaveLength(0);
    expect(() => pool.emit("error", new Error("secret post-return pool"))).not.toThrow(); expect(Object.isFrozen(value)).toBe(true);
  });
  it("abandoned late release/end failures keep one owner and immutable result", async () => {
    const pool = new FakePool(); pool.checkout = deferred<PoolClient>(); pool.client.releaseMode = "throw-before"; pool.client.fallbackRejects = true;
    const { service } = setup(pool); const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(110); const value = await pending, before = JSON.stringify(value);
    pool.checkout.resolve(pool.client as unknown as PoolClient); await flush(); pool.client.emit("error", new Error("secret late"));
    expect(pool.client.calls).toHaveLength(0); expect(pool.client.releases).toBe(1); expect(pool.client.fallbackEnds).toBe(1); expect(pool.ends).toBe(1); expect(JSON.stringify(value)).toBe(before);
  });
  it("rejected pool.end is consumed and preserves the acknowledged record", async () => {
    const { pool, service } = setup(); pool.ending = deferred<void>(); const pending = service.reserve(actor, request()); await flush(); pool.ending.reject(new Error("secret pool promise"));
    expect(await pending).toMatchObject({ commit: "confirmed", cleanup: "failed", record: { origin: "created" } }); expect(pool.ends).toBe(1);
  });
  it("late COMMIT reply cannot mutate a previously returned unknown outcome", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>(); pool.client.hook = text => text === "COMMIT" ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(110); const value = await pending, before = JSON.stringify(value);
    expect(value).toMatchObject({ commit: "unknown", cleanup: "failed" }); wire.resolve(result([], "COMMIT")); await flush(); expect(JSON.stringify(value)).toBe(before); expect(mocked.pool).toHaveBeenCalledTimes(1);
  });
  it.each(["POLICY", "POLICY_LOCK", "ACTOR_REQUIRED", "ISOLATION"])("maps read-side configuration tag %s without generating IDs", async tag => {
    const cfg = config(), generate = vi.fn(cfg.nextRecordId); Object.assign(cfg, { nextRecordId: generate }); const { pool, service } = setup(undefined, cfg); pool.client.readTag = tag;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" }); expect(generate).not.toHaveBeenCalled(); expect(hasWrite(pool.client)).toBe(false);
  });
  it("malformed successful entry row is rolled back before COMMIT", async () => {
    const { pool, service } = setup(); pool.client.hook = text => text.includes("reserve_upload_v1($1") ? result([{ reservation_reply: { tag: "staged", secret: true } }]) : undefined;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "REPLY_INVALID" }); expect(pool.client.calls.some(q => q.text === "COMMIT")).toBe(false);
  });
  it.each(["null-OID", "owner", "definer", "volatility", "settings", "access", "duplicate-slot"])("rejects function %s metadata before either entry", async fault => {
    const { pool, service } = setup(); const f = pool.client.functions[0];
    if (fault === "null-OID") f.oid = "";
    if (fault === "owner") f.owner_oid = "14";
    if (fault === "definer") f.prosecdef = false;
    if (fault === "volatility") f.provolatile = "s";
    if (fault === "settings") f.proconfig = ["search_path=public"];
    if (fault === "access") f.api_execute = false;
    if (fault === "duplicate-slot") pool.client.functions[1].slot = "read";
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" }); expect(pool.client.calls.some(q => q.text.includes("read_upload_seed_v1($1"))).toBe(false);
  });
  it("healthy callback cancellation before reserve cannot turn into COMMIT", async () => {
    const cfg = config(); Object.assign(cfg, { nextRecordId: () => "not-v7" }); const { pool, service } = setup(undefined, cfg);
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" }); expect(hasWrite(pool.client)).toBe(false); expect(pool.client.calls.some(q => q.text === "COMMIT")).toBe(false);
  });
  it("own reentry guard rejects a nested adapter call without another pool", async () => {
    const cfg = config(); let nested: ReturnType<ReturnType<typeof postgresUploadReservations>["reserve"]> | undefined;
    let n = 100;
    Object.assign(cfg, { nextRecordId: () => { nested ??= service.reserve(actor, request()); return uid(++n); } });
    const { service } = setup(undefined, cfg);
    expect((await service.reserve(actor, request())).kind).toBe("success"); expect(await nested).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" }); expect(mocked.pool).toHaveBeenCalledTimes(1);
  });
  it("post-COMMIT role/GUC hygiene failure preserves record and never rolls back", async () => {
    const { pool, service } = setup(); pool.client.hook = text => text.includes("reservation.hygiene") ? result([{ current_oid: "11", login_oid: "11", actor_guc: A }]) : undefined;
    expect(await service.reserve(actor, request())).toMatchObject({ commit: "confirmed", cleanup: "failed", record: { origin: "created" } }); expect(pool.client.calls.some(q => q.text === "ROLLBACK")).toBe(false);
  });
  it("confirmed hygiene has finite finalization grace and retains unresolved native work", async () => {
    const { pool, service } = setup(), wire = deferred<QueryResult>();
    pool.client.hook = text => text.includes("reservation.hygiene") ? wire.promise : undefined;
    const pending = service.reserve(actor, request()); await flush(); await vi.advanceTimersByTimeAsync(20);
    const value = await pending, before = JSON.stringify(value);
    expect(value).toMatchObject({ commit: "confirmed", cleanup: "failed", reason: "CLEANUP_FAILED", record: { origin: "created" } });
    wire.resolve(result([{ current_oid: "11", login_oid: "11", actor_guc: "" }])); await flush();
    expect(JSON.stringify(value)).toBe(before); expect(pool.client.calls.some(q => q.text === "ROLLBACK")).toBe(false); expect(pool.client.releases).toBe(1);
  });
  it.each(["duplicate", "thenable"])("rejects %s ID source without write dispatch", async kind => {
    const cfg = config(); Object.assign(cfg, { nextRecordId: () => kind === "duplicate" ? uid(1) : Promise.resolve(uid(1)) });
    const { pool, service } = setup(undefined, cfg); expect(await service.reserve(actor, request())).toMatchObject({ commit: "not-applied", reason: "CONFIGURATION_REJECTED" }); expect(hasWrite(pool.client)).toBe(false);
  });
  it("caps requested bytes by the actual seed, with no client authority override", async () => {
    const { service } = setup(); const value = await service.reserve(actor, { requestId: uid(4), clientJson: '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":2147483648}' });
    expect(value).toMatchObject({ kind: "success", record: { reservation: { maxBytes: 1048576 } } });
  });
  it("rejects configurable driver timeout/pipeline hooks and options getters", async () => {
    const cfg = config(); Object.assign(cfg.connection, { query_timeout: 1 }); const { service } = setup(undefined, cfg);
    expect(await service.reserve(actor, request())).toMatchObject({ reason: "CONFIGURATION_REJECTED" }); expect(mocked.pool).not.toHaveBeenCalled();
    const valid = postgresUploadReservations(config()); let reads = 0;
    expect(await valid.reserve(actor, request(), { get signal() { reads++; return new AbortController().signal; } })).toMatchObject({ reason: "INVALID_REQUEST" }); expect(reads).toBe(0);
    expect(await valid.reserve(actor, request(), { signal: Object.create(AbortSignal.prototype) })).toMatchObject({ reason: "INVALID_REQUEST" });
  });
});
