import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runPostgresMigrations } from "@/lib/db/postgres/migration-runner";
import { inspectMigrationTarget, type MigrationTarget } from "@/lib/db/postgres/migration-target";
import { loadPostgresMigrations, postgresMigrationManifest } from "@/lib/db/postgres/migration-manifest";
vi.mock("server-only", () => ({}));

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const O = uid(1), ASSET = uid(2), INTENT = uid(3), OP1 = uid(4), OP2 = uid(5), R1 = uid(6), R2 = uid(7), WORKER = uid(8);
const sha = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const dh = (domain: string, raw: string) => sha(`${domain}:v1\n${raw}`);
const time = (ms = 0) => new Date(Date.UTC(2030, 0, 1) + ms).toISOString();
const H = "a".repeat(64), PD = "b".repeat(64), FP = "c".repeat(64);
const identity = { ownerId: A, assetId: ASSET, bucket: "unit-final", key: `${A}/assets/${ASSET}/${H}.png`,
  sha256: H, sizeBytes: 123, kind: "image", mime: "image/png", providerVersion: null };
const identityRaw = canonical(identity), identityDigest = dh("object-identity", identityRaw);
const incoming = `${A}/incoming/${INTENT}/nonce`;
const tables = ["storage_policy_versions", "storage_policies", "storage_objects", "upload_intents", "storage_verification_operations", "storage_verification_runs",
  "storage_verification_receipts", "asset_receipt_state", "storage_cleanup_claims", "storage_outbox", "storage_capability_issues", "creation_operations"];
type DB = Pool | PoolClient;
async function insert(db: DB, table: string, fields: Record<string, unknown>) {
  if (![...tables, "assets", "projects"].includes(table) || Object.keys(fields).some(k => !/^[a-z_][a-z0-9_]*$/.test(k))) throw new Error("Fixed synthetic identifiers required");
  const keys = Object.keys(fields);
  return db.query(`INSERT INTO dream.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(fields));
}
describe.skipIf(process.env.DREAM_PG_STORAGE_SCHEMA_TEST !== "1")("B20 actual offline SQL4 draft constraints", () => {
  let admin: Pool, target: MigrationTarget, targetHash: string, draft: string, baseline: unknown, graph: unknown;
  async function tx(run: (c: PoolClient) => Promise<void>) {
    const c = await admin.connect();
    try { await c.query("BEGIN"); await run(c); await c.query("COMMIT"); }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  const reject = async (sql: string, values: unknown[] = [], code = "23514") => expect(admin.query(sql, values)).rejects.toMatchObject({ code });
  async function oldCatalog() {
    return (await admin.query("SELECT c.relname,c.oid::text,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,(SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relkind='r' AND c.relname<>ALL($1) ORDER BY c.relname", [tables])).rows;
  }
  async function roleGraph() {
    return (await admin.query("SELECT parent.rolname AS parent,member.rolname AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member ORDER BY parent.rolname,member.rolname")).rows;
  }
  beforeAll(async () => {
    const uri = process.env.DREAM_PG_TEST_ADMIN_URL ?? "", u = new URL(uri);
    if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || !u.port || u.username !== "dream_test_admin" || !/^\/dream_test_[a-z0-9_]+$/.test(u.pathname) || u.search || u.hash) throw new Error("Explicit owned synthetic target required");
    target = { connectionString: uri, profile: "synthetic" }; targetHash = inspectMigrationTarget(target).targetHash;
    admin = new Pool({ connectionString: uri, max: 4 });
    const existing = (await admin.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('auth') AS auth")).rows[0];
    if (existing.dream || existing.auth) throw new Error("Fresh database required; no existing data adopted");
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)"); await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
    expect(await runPostgresMigrations({ target, expectedTargetHash: targetHash, mode: "apply" })).toMatchObject({ applied: 3 });
    baseline = await oldCatalog(); graph = await roleGraph();
    draft = await readFile(new URL("../../lib/db/postgres/drafts/0004_storage_verification.sql", import.meta.url), "utf8");
  }, 30000);
  afterAll(async () => { await admin?.end(); });

  it("published3 hashes/manifest/history stay exact; draft is outside loader", async () => {
    const source = await loadPostgresMigrations(); expect(source.map(v => v.id)).toEqual(postgresMigrationManifest.map(v => v.id)); expect(source).toHaveLength(3);
    expect((await admin.query("SELECT id,checksum FROM dream_migrations.history ORDER BY ordinal")).rows).toEqual(postgresMigrationManifest.map(v => ({ id: v.id, checksum: v.checksum })));
    expect(await runPostgresMigrations({ target, expectedTargetHash: targetHash, mode: "dry-run" })).toMatchObject({ applied: 0, pending: 0 });
  });
  it("a real middle-DDL failure rolls back all draft tables/functions while SQL3 remains acceptable", async () => {
    await admin.query("CREATE FUNCTION public.b20_fail() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF to_regclass('dream.storage_verification_runs') IS NOT NULL THEN RAISE EXCEPTION 'synthetic middle draft failure'; END IF; END $$; CREATE EVENT TRIGGER b20_fail ON ddl_command_start WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.b20_fail()");
    const c = await admin.connect();
    try { await expect(c.query(draft)).rejects.toMatchObject({ code: "P0001" }); await c.query("ROLLBACK"); }
    finally { c.release(); await admin.query("DROP EVENT TRIGGER b20_fail; DROP FUNCTION public.b20_fail()"); }
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname=ANY($1)", [tables])).rows[0].n).toBe(0);
    expect((await admin.query("SELECT to_regprocedure('dream.storage_guard()')::text AS f")).rows[0].f).toBeNull();
    expect(await oldCatalog()).toEqual(baseline); expect(await roleGraph()).toEqual(graph);
    expect(await runPostgresMigrations({ target, expectedTargetHash: targetHash, mode: "dry-run" })).toMatchObject({ applied: 0 });
  });
  it("applies draft atomically, retains original18/FKs/history/role graph and exposes runner incompatibility", async () => {
    await admin.query(draft);
    expect(await oldCatalog()).toEqual(baseline); expect(await roleGraph()).toEqual(graph);
    expect((await admin.query("SELECT count(*)::int AS n FROM dream_migrations.history")).rows[0].n).toBe(3);
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname=ANY($1) AND c.relrowsecurity AND c.relforcerowsecurity", [tables])).rows[0].n).toBe(12);
    await expect(runPostgresMigrations({ target, expectedTargetHash: targetHash, mode: "dry-run" })).rejects.toMatchObject({ code: "MIGRATION_STATE" });
    expect((await admin.query("SELECT count(*)::int AS n FROM dream_migrations.history")).rows[0].n).toBe(3);
  });

  const object = (owner = A, id = O, asset = ASSET) => ({ owner_id: owner, id, reserved_asset_id: asset, lifecycle: "reserved", revision: 0, barrier_fence: 0, active_generation: 0, created_at: time() });
  const intent = (owner = A, id = INTENT, obj = O) => ({ owner_id: owner, id, object_id: obj, request_id: uid(30), request_fingerprint: FP,
    request_json: "{}", request_raw_sha: sha("{}"), incoming_bucket: "unit-incoming", incoming_key: `${owner}/incoming/${id}/nonce`, max_bytes: 2147483648,
    authorization_until: time(100), issue_envelope_until: time(10), max_issues: 2, issue_count: 0, status: "open", revision: 0, created_at: time() });
  const operation = (id = OP1, kind = "initial", generation = 1) => ({ owner_id: A, id, object_id: O, intent_id: kind === "initial" ? INTENT : null, kind, generation,
    request_fingerprint: FP, request_json: "{}", request_raw_sha: sha("{}"), policy_id: "unit", policy_epoch: 1, policy_digest: PD,
    authorization_until: time(kind === "initial" ? 90 : 200), expected_state_revision: generation - 1,
    fence: 0, status: "pending", revision: 0, created_at: time() });
  async function bind(c: DB, obj = O, asset = ASSET) {
    const value = { ...identity, assetId: asset, key: `${A}/assets/${asset}/${H}.png` }, raw = canonical(value);
    const operation = (await c.query("SELECT id,fence::int,policy_epoch::int,policy_digest FROM dream.storage_verification_operations WHERE object_id=$1 AND kind='initial'", [obj])).rows[0];
    const claim = { workerId: WORKER, fence: operation.fence, claimedAt: Date.parse(time()), leaseUntil: Date.parse(time(90)), authorizationUntil: Date.parse(time(90)), policyEpoch: operation.policy_epoch, policyDigest: operation.policy_digest, claimVerifiers: [WORKER] };
    const publication = canonical({ operationId: operation.id, fence: operation.fence, barrierFence: 0, reservedAt: Date.parse(time()), claim, identityDigest: dh("object-identity", raw) });
    await c.query("UPDATE dream.storage_objects SET lifecycle='publication_reserved',bucket=$2,object_key=$3,kind='image',mime='image/png',sha256=$4,size_bytes=123,identity_json=$5,identity_digest=$6,publication_json=$7,revision=revision+1 WHERE id=$1", [obj, value.bucket, value.key, H, raw, dh("object-identity", raw), publication]);
  }
  async function claim(c: DB, op: string, leaseUntil?: string, claimedAt = time()) { await c.query("UPDATE dream.storage_verification_operations SET status='running',fence=1,worker_id=$2,claimed_at=$3,claim_verifiers=ARRAY[$2::uuid],lease_until=coalesce($4::timestamptz,authorization_until),revision=revision+1 WHERE id=$1", [op, WORKER, claimedAt, leaseUntil ?? null]); }
  async function receipt(c: DB, op: string, receiptId: string, generation: number, options: { verifier?: string; verified?: number } = {}) {
    const source = generation === 1 ? { bucket: "unit-incoming", key: incoming, providerVersion: null } : { bucket: identity.bucket, key: identity.key, providerVersion: null };
    const verified = options.verified ?? (generation === 1 ? 1 : 30), notAfter = generation === 1 ? 20 : 190;
    const body = { id: receiptId, objectId: O, identity, operationId: op, generation, fence: 1, policyEpoch: 1, policyDigest: PD, source,
      media: { width: 2, height: 2, durationMs: null }, verifiedAt: Date.parse(time(verified)), notAfter: Date.parse(time(notAfter)), verifierId: options.verifier ?? WORKER, verifierVersion: "unit-v1", toolVersion: "probe-unit" };
    const raw = ` ${canonical(body)} `;
    await insert(c, "storage_verification_runs", { owner_id: A, id: uid(100 + generation), object_id: O, operation_id: op, generation, fence: 1, worker_id: WORKER,
      outcome: "succeeded", observed_json: "{}", observed_sha: sha("{}"), recorded_at: time(verified) });
    await insert(c, "storage_verification_receipts", { owner_id: A, id: receiptId, object_id: O, asset_id: ASSET, operation_id: op, run_id: uid(100 + generation), generation, fence: 1,
      identity_digest: identityDigest, policy_id: "unit", policy_epoch: 1, policy_digest: PD, source_bucket: source.bucket, source_key: source.key,
      width: 2, height: 2, verifier_id: options.verifier ?? WORKER, verifier_version: "unit-v1", tool_version: "probe-unit", verified_at: time(verified), not_after: time(notAfter), receipt_json: raw, receipt_digest: dh("verification-receipt", raw) });
    const terminal = canonical({ status: "succeeded", receiptId });
    await c.query("UPDATE dream.storage_verification_operations SET status='succeeded',terminal_receipt_id=$2,terminal_json=$3,terminal_digest=$4,completed_at=$5,completed_state_revision=$6,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$7),revision=revision+1 WHERE id=$1", [op, receiptId, terminal, dh("verification-terminal", terminal), time(verified), generation, O]);
    return raw;
  }
  it("reserves durable objects/intents and rejects cross-owner composite references and false raw hashes", async () => {
    await insert(admin, "storage_policy_versions", { policy_id: "unit", epoch: 1, digest: PD, created_at: time() });
    await insert(admin, "storage_policies", { policy_id: "unit", epoch: 1, digest: PD, revision: 0, updated_at: time() });
    await insert(admin, "storage_objects", object()); await insert(admin, "storage_objects", object(B, uid(20), uid(21)));
    await insert(admin, "upload_intents", intent());
    await expect(insert(admin, "upload_intents", intent(B, uid(31), O))).rejects.toMatchObject({ code: "23503" });
    await expect(insert(admin, "upload_intents", { ...intent(A, uid(32), O), request_raw_sha: H })).rejects.toMatchObject({ code: "23514" });
    await tx(async c => { await insert(c, "storage_verification_operations", operation()); await c.query("UPDATE dream.storage_objects SET active_generation=1,revision=revision+1 WHERE id=$1", [O]); });
    await expect(insert(admin, "storage_verification_operations", { ...operation(uid(33)), owner_id: B })).rejects.toMatchObject({ code: "23503" });
    await expect(insert(admin, "storage_verification_operations", operation(uid(34)))).rejects.toMatchObject({ code: "23505" });
    await expect(insert(admin, "storage_verification_operations", { ...operation(uid(88)), completed_at: time(1) })).rejects.toMatchObject({ code: "23514" });
    await expect(insert(admin, "storage_verification_operations", { ...operation(uid(89)), terminal_json: "{}" })).rejects.toMatchObject({ code: "23514" });
    await reject("UPDATE dream.upload_intents SET request_fingerprint=$2,revision=revision+1 WHERE id=$1", [INTENT, H]);
  });
  it("canonical identity/key uniqueness and write-once target survive publication reservation", async () => {
    await tx(async c => { await claim(c, OP1); await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]); });
    await bind(admin);
    await reject("UPDATE dream.storage_objects SET object_key='../bad',revision=revision+1 WHERE id=$1", [O]);
    await reject("UPDATE dream.storage_objects SET size_bytes=2147483649,revision=revision+1 WHERE id=$1", [O]);
    await reject("DELETE FROM dream.storage_objects WHERE id=$1", [O]);
    await expect(insert(admin, "storage_objects", object(A, uid(35), ASSET))).rejects.toMatchObject({ code: "23505" });
    await expect(admin.query("INSERT INTO dream.storage_objects SELECT * FROM dream.storage_objects WHERE id=$1", [O])).rejects.toMatchObject({ code: "23514" });
    expect((await admin.query("SELECT identity_json FROM dream.storage_objects WHERE id=$1", [O])).rows[0].identity_json).toBe(identityRaw);
  });
  it("one registration issues R1 and later independent R2; raw receipts/history/asset tuple remain immutable", async () => {
    await insert(admin, "assets", { owner_id: A, id: ASSET, kind: "image", title: "Synthetic original", role: "original", file_path: identity.key,
      mime: identity.mime, sha256: H, size_bytes: 123, width: 2, height: 2, origin: "upload", created_at: time() });
    let raw1 = "";
    await tx(async c => {
      raw1 = await receipt(c, OP1, R1, 1);
      await c.query("UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=reserved_asset_id,revision=revision+1 WHERE id=$1", [O]);
      await insert(c, "asset_receipt_state", { owner_id: A, asset_id: ASSET, object_id: O, current_receipt_id: R1, status: "ready", revision: 1, updated_at: time(1) });
    });
    await tx(async c => { await insert(c, "storage_verification_operations", operation(OP2, "reverify", 2)); await c.query("UPDATE dream.storage_objects SET active_generation=2,revision=revision+1 WHERE id=$1", [O]); });
    await tx(async c => { await claim(c, OP2); await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]); });
    await tx(async c => { await receipt(c, OP2, R2, 2); await c.query("UPDATE dream.asset_receipt_state SET current_receipt_id=$2,revision=revision+1,updated_at=$3 WHERE object_id=$1", [O, R2, time(30)]); await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]); });
    expect((await admin.query("SELECT id FROM dream.storage_verification_receipts ORDER BY generation")).rows).toEqual([{ id: R1 }, { id: R2 }]);
    expect((await admin.query("SELECT receipt_json FROM dream.storage_verification_receipts WHERE id=$1", [R1])).rows[0].receipt_json).toBe(raw1);
    expect((await admin.query("SELECT current_receipt_id FROM dream.asset_receipt_state")).rows[0].current_receipt_id).toBe(R2);
    expect((await admin.query("SELECT file_path,sha256 FROM dream.assets WHERE id=$1", [ASSET])).rows[0]).toEqual({ file_path: identity.key, sha256: H });
    await reject("UPDATE dream.asset_receipt_state SET current_receipt_id=$2,revision=revision+1 WHERE object_id=$1", [O, R1]);
    await reject("UPDATE dream.storage_verification_receipts SET not_after=$2 WHERE id=$1", [R1, time(500)]);
    await reject("DELETE FROM dream.storage_verification_receipts WHERE id=$1", [R1]);
    await reject("UPDATE dream.storage_verification_runs SET observed_json='{}' WHERE operation_id=$1", [OP1]);
    await reject("UPDATE dream.storage_verification_operations SET fence=2,revision=revision+1 WHERE id=$1", [OP1]);
  });
  it("raw receipt forgery and mismatched operation/generation cannot be appended", async () => {
    await reject("INSERT INTO dream.storage_verification_receipts SELECT * FROM dream.storage_verification_receipts WHERE id=$1", [R1], "23505");
    const r = (await admin.query("SELECT * FROM dream.storage_verification_receipts WHERE id=$1", [R1])).rows[0];
    await expect(insert(admin, "storage_verification_receipts", { ...r, id: uid(36), receipt_json: "{}", receipt_digest: dh("verification-receipt", "{}") })).rejects.toMatchObject({ code: "23514" });
    await reject("UPDATE dream.storage_objects SET lifecycle='cleanup_claimed',cleanup_id=$2,barrier_fence=barrier_fence+1,revision=revision+1 WHERE id=$1", [O, uid(37)]);
  });
  it("checks valid finalization before rejecting forged issuer and completion outside the recorded claim lease", async () => {
    const exercise = (options: { verifier?: string; verified?: number; lease?: string } = {}, rollbackControl = false) => tx(async c => {
      await insert(c, "storage_verification_operations", operation(uid(70), "reverify", 3));
      await c.query("UPDATE dream.storage_objects SET active_generation=3,revision=revision+1 WHERE id=$1", [O]);
      await claim(c, uid(70), options.lease);
      await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]);
      await receipt(c, uid(70), uid(71), 3, options);
      await c.query("UPDATE dream.asset_receipt_state SET current_receipt_id=$2,revision=revision+1 WHERE object_id=$1", [O, uid(71)]);
      await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]);
      if (rollbackControl) { await c.query("SET CONSTRAINTS ALL IMMEDIATE"); throw new Error("CONTROL_VALIDATED_AND_ROLLED_BACK"); }
    });
    await expect(exercise({}, true)).rejects.toThrow("CONTROL_VALIDATED_AND_ROLLED_BACK");
    await expect(exercise({ verifier: uid(72) })).rejects.toMatchObject({ code: "23514", message: "receipt issuer/time/committed operation differs" });
    await expect(exercise({ verified: 10, lease: time(5) })).rejects.toMatchObject({ code: "23514" });
    expect((await admin.query("SELECT count(*)::int AS n FROM dream.storage_verification_receipts")).rows[0].n).toBe(2);
  });
  it("binds exact outbox targets while denying retarget/delete and cross-owner copies", async () => {
    const record = { owner_id: A, id: uid(73), object_id: O, kind: "publish", target_kind: "final", operation_id: OP1, generation: 1,
      fence: 1, barrier_fence: 0, bucket: identity.bucket, object_key: identity.key, identity_digest: identityDigest,
      payload_json: "{}", payload_sha: sha("{}"), status: "pending", attempts: 0, revision: 0, created_at: time() };
    await insert(admin, "storage_outbox", record);
    await expect(insert(admin, "storage_outbox", { ...record, id: uid(74), owner_id: B })).rejects.toMatchObject({ code: "23503" });
    await expect(insert(admin, "storage_outbox", { ...record, id: uid(75), object_key: `${A}/other/key` })).rejects.toMatchObject({ code: "23503" });
    await expect(insert(admin, "storage_outbox", { ...record, id: uid(76), kind: "reconcile", generation: null })).rejects.toMatchObject({ code: "23514" });
    await reject("UPDATE dream.storage_outbox SET object_key=$2,revision=revision+1 WHERE id=$1", [uid(73), `${A}/other/key`]);
    await reject("DELETE FROM dream.storage_outbox WHERE id=$1", [uid(73)]);
  });
  it("retains append-only revocation events and refuses a ready boolean without matching event history", async () => {
    const event = { revision: 3, at: Date.parse(time(31)), principalId: A, authorizers: [A], operationId: null, kind: "manual" };
    await expect(admin.query("UPDATE dream.asset_receipt_state SET revocation_history_json=$2,revision=3 WHERE object_id=$1", [O, canonical([event])])).rejects.toMatchObject({ code: "23514", message: "availability conflicts with revocation history" });
    await tx(async c => { await c.query("UPDATE dream.asset_receipt_state SET status='revoked',revocation_history_json=$2,revision=3 WHERE object_id=$1", [O, canonical([event])]); await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]); });
    await reject("UPDATE dream.asset_receipt_state SET revocation_history_json='[]',revision=revision+1 WHERE object_id=$1", [O]);
    await reject("UPDATE dream.asset_receipt_state SET status='ready',revision=revision+1 WHERE object_id=$1", [O]);
    await reject("DELETE FROM dream.asset_receipt_state WHERE object_id=$1", [O]);
    expect((await admin.query("SELECT revocation_history_json FROM dream.asset_receipt_state WHERE object_id=$1", [O])).rows[0].revocation_history_json).toBe(canonical([event]));
  });
  it("default-deny/FORCE-RLS owner reads do not grant API/worker registration/receipt/GC writes", async () => {
    const c = await admin.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE dream_api"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [A]);
      expect((await c.query("SELECT count(*)::int AS n FROM dream.storage_objects")).rows[0].n).toBe(1);
      await c.query("SELECT set_config('dream.actor_id',$1,true)", [B]);
      expect((await c.query("SELECT count(*)::int AS n FROM dream.storage_objects")).rows[0].n).toBe(1);
      expect((await c.query("SELECT count(*)::int AS n FROM dream.storage_verification_receipts")).rows[0].n).toBe(0);
      await c.query("SAVEPOINT forbidden"); await expect(c.query("DELETE FROM dream.storage_objects")).rejects.toMatchObject({ code: "42501" }); await c.query("ROLLBACK TO forbidden");
      await c.query("SAVEPOINT forbidden"); await expect(c.query("INSERT INTO dream.storage_objects(owner_id,id) VALUES($1,$2)", [A, uid(38)])).rejects.toMatchObject({ code: "42501" }); await c.query("ROLLBACK TO forbidden");
      await c.query("SAVEPOINT forbidden"); await expect(c.query("SELECT * FROM dream.storage_outbox")).rejects.toMatchObject({ code: "42501" }); await c.query("ROLLBACK TO forbidden");
      await c.query("RESET ROLE; SET LOCAL ROLE dream_worker"); await expect(c.query("SELECT * FROM dream.storage_verification_receipts")).rejects.toMatchObject({ code: "42501" }); await c.query("ROLLBACK");
    } finally { await c.query("ROLLBACK"); c.release(); }
    const privileges = (await admin.query("SELECT has_table_privilege('dream_api','dream.storage_verification_receipts','INSERT') AS insert,has_table_privilege('dream_api','dream.storage_objects','UPDATE') AS update,has_table_privilege('dream_worker','dream.storage_outbox','DELETE') AS delete,has_function_privilege('dream_api','dream.storage_guard()','EXECUTE') AS execute")).rows[0];
    expect(privileges).toEqual({ insert: false, update: false, delete: false, execute: false });
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dream' AND p.proname LIKE 'storage_%' AND p.prosecdef")).rows[0].n).toBe(0);
    expect(await roleGraph()).toEqual(graph);
  });
  it("cleanup claim must commit with same closed barrier; tombstone/key cannot be reused", async () => {
    const obj = uid(40), asset = uid(41), claimId = uid(42), intentId = uid(43), opId = uid(44);
    await insert(admin, "storage_objects", object(A, obj, asset));
    await insert(admin, "upload_intents", { ...intent(A, intentId, obj), request_id: uid(45) });
    await tx(async c => { await insert(c, "storage_verification_operations", { ...operation(opId), object_id: obj, intent_id: intentId }); await c.query("UPDATE dream.storage_objects SET active_generation=1,revision=revision+1 WHERE id=$1", [obj]); });
    await tx(async c => { await claim(c, opId); await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [obj]); });
    await bind(admin, obj, asset);
    const claimed = { owner_id: A, id: claimId, object_id: obj, barrier_fence: 1, claimed_at: time(), claimed_aggregate_revision: 4 };
    await expect(insert(admin, "storage_cleanup_claims", claimed)).rejects.toMatchObject({ code: "23514" });
    const closure = canonical({ revision: 4, at: Date.parse(time()), principalId: WORKER, authorizers: [WORKER], reason: "cleanup", operationId: null });
    await tx(async c => {
      await insert(c, "storage_cleanup_claims", claimed);
      const prior = canonical({ workerId: WORKER, fence: 1, claimedAt: Date.parse(time()), leaseUntil: Date.parse(time(90)), authorizationUntil: Date.parse(time(90)), policyEpoch: 1, policyDigest: PD, claimVerifiers: [WORKER] });
      const result = '{"status":"canceled"}';
      await c.query("UPDATE dream.storage_verification_operations SET status='canceled',fence=2,worker_id=NULL,lease_until=NULL,claimed_at=NULL,claim_verifiers='{}',canceled_claim_json=$2,completed_at=$3,completed_state_revision=0,completed_aggregate_revision=4,terminal_json=$4,terminal_digest=$5,revision=revision+1 WHERE id=$1", [opId, prior, time(), result, dh("verification-terminal", result)]);
      await c.query("UPDATE dream.storage_objects SET lifecycle='cleanup_claimed',initial_closed=true,closure_json=$3,cleanup_id=$2,barrier_fence=1,revision=revision+1 WHERE id=$1", [obj, claimId, closure]);
    });
    const target = (await admin.query("SELECT identity_digest FROM dream.storage_objects WHERE id=$1", [obj])).rows[0].identity_digest;
    await tx(async c => { await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=revision+1 WHERE id=$1", [claimId, canonical({ at: Date.parse(time(1)), absent: true, writerQuiescent: true, identityDigest: target })]); await c.query("UPDATE dream.storage_objects SET lifecycle='tombstoned',revision=revision+1 WHERE id=$1", [obj]); });
    await reject("UPDATE dream.storage_objects SET lifecycle='publication_reserved',cleanup_id=NULL,revision=revision+1 WHERE id=$1", [obj]);
    await reject("UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=reserved_asset_id,cleanup_id=NULL,revision=revision+1 WHERE id=$1", [obj]);
    await reject("DELETE FROM dream.storage_cleanup_claims WHERE id=$1", [claimId]);
    await reject("DELETE FROM dream.storage_objects WHERE id=$1", [obj]);
    await tx(async c => { await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=revision+1 WHERE id=$1", [claimId, canonical({ at: Date.parse(time(2)), absent: false, writerQuiescent: false, identityDigest: target })]); await c.query("UPDATE dream.storage_objects SET lifecycle='cleanup_claimed',revision=revision+1 WHERE id=$1", [obj]); }); // late orphan remains permanently closed
    expect((await admin.query("SELECT cleanup_id FROM dream.storage_objects WHERE id=$1", [obj])).rows[0].cleanup_id).toBe(claimId);
  });
  it("common object row supports real contending finalizer/GC locks and stale CAS rejection", async () => {
    const gate = await admin.connect(), contender = await admin.connect();
    try {
      await gate.query("BEGIN"); await gate.query("SELECT id FROM dream.storage_objects WHERE id=$1 FOR UPDATE", [O]);
      await contender.query("BEGIN; SET LOCAL lock_timeout='100ms'");
      await expect(contender.query("SELECT id FROM dream.storage_objects WHERE id=$1 FOR UPDATE", [O])).rejects.toMatchObject({ code: "55P03" }); await contender.query("ROLLBACK");
      const revision = (await gate.query("SELECT revision FROM dream.storage_objects WHERE id=$1", [O])).rows[0].revision;
      await gate.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1 AND revision=$2", [O, revision]); await gate.query("COMMIT");
      expect((await contender.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1 AND revision=$2", [O, revision])).rowCount).toBe(0);
    } finally { await gate.query("ROLLBACK"); await contender.query("ROLLBACK"); gate.release(); contender.release(); }
  });
  it("capability unknown horizon is explicit, raw reservations cannot be shortened/reissued", async () => {
    const issue = uid(50);
    await insert(admin, "storage_capability_issues", { owner_id: A, id: issue, object_id: O, intent_id: INTENT, ordinal: 1, issue_until_ms: 10,
      token_lifetime_ms: 20, resource_lifetime_ms: 40, grace_ms: 3, dispatched: false, outcome: "reserved", revision: 0, created_at: time() });
    expect((await admin.query("SELECT horizon_ms FROM dream.storage_capability_issues WHERE id=$1", [issue])).rows[0].horizon_ms).toBeNull();
    await admin.query("UPDATE dream.storage_capability_issues SET dispatched=true,outcome='uncertain',revision=revision+1 WHERE id=$1", [issue]);
    await reject("UPDATE dream.storage_capability_issues SET latest_acceptance_ms=10,revision=revision+1 WHERE id=$1", [issue]);
    await admin.query("UPDATE dream.storage_capability_issues SET latest_acceptance_ms=10,bound_evidence=$2,revision=revision+1 WHERE id=$1", [issue, H]);
    expect((await admin.query("SELECT horizon_ms::text AS horizon FROM dream.storage_capability_issues WHERE id=$1", [issue])).rows[0].horizon).toBe("73");
    await reject("UPDATE dream.storage_capability_issues SET latest_acceptance_ms=NULL,revision=revision+1 WHERE id=$1", [issue]);
    await reject("UPDATE dream.storage_capability_issues SET token_lifetime_ms=1,revision=revision+1 WHERE id=$1", [issue]);
    await reject("UPDATE dream.storage_capability_issues SET dispatched=false,revision=revision+1 WHERE id=$1", [issue]);
    await reject("UPDATE dream.storage_capability_issues SET bound_evidence=$2,revision=revision+1 WHERE id=$1", [issue, PD]);
    await reject("DELETE FROM dream.storage_capability_issues WHERE id=$1", [issue]);
  });
  it("creation raw snapshot/fingerprint and permanent owner/request tombstone retain dedup identity", async () => {
    const requestId = uid(60), client = canonical({ menuId: "unit", title: "Synthetic", inputs: {}, referenceIds: [ASSET] }), snapshot = canonical({ menu: {}, config: {}, policyEpoch: 1 });
    const request = canonical({ client: JSON.parse(client), snapshot: JSON.parse(snapshot) });
    const requestFingerprint = dh("creation-request-v2", canonical({ fingerprintVersion: 2, clientDigest: dh("creation-client", client), snapshotDigest: dh("creation-snapshot", snapshot) }));
    await insert(admin, "creation_operations", { owner_id: A, request_id: requestId, client_digest: dh("creation-client", client), request_fingerprint: requestFingerprint,
      snapshot_digest: dh("creation-snapshot", snapshot), fingerprint_version: 2,
      client_json: client, original_snapshot_json: snapshot, request_json: request, authorization_until: time(100), status: "pending", revision: 0, created_at: time() });
    await reject("UPDATE dream.creation_operations SET original_snapshot_json='{}',revision=revision+1 WHERE request_id=$1", [requestId]);
    const result = '{"status":"canceled"}';
    await admin.query("UPDATE dream.creation_operations SET status='canceled',result_json=$2,result_digest=$3,settled_at=$4,settled_by=$5,settled_registrars=ARRAY[$5::uuid],revision=revision+1 WHERE request_id=$1", [requestId, result, dh("creation-result", result), time(1), WORKER]);
    await reject("UPDATE dream.creation_operations SET status='pending',result_json=NULL,result_digest=NULL,revision=revision+1 WHERE request_id=$1", [requestId]);
    await admin.query("UPDATE dream.creation_operations SET status='retired',client_json=NULL,original_snapshot_json=NULL,request_json=NULL,retired_at=$2,retired_by=$3,retired_registrars=ARRAY[$3::uuid],retired_from='terminal',revision=revision+1 WHERE request_id=$1", [requestId, time(2), WORKER]);
    await reject("DELETE FROM dream.creation_operations WHERE request_id=$1", [requestId]);
    await reject("UPDATE dream.creation_operations SET status='pending',revision=revision+1 WHERE request_id=$1", [requestId]);
    expect((await admin.query("SELECT client_digest,request_fingerprint FROM dream.creation_operations WHERE request_id=$1", [requestId])).rows[0]).toEqual({ client_digest: dh("creation-client", client), request_fingerprint: requestFingerprint });
  });
  it("failed reverify commits with its owner-bound append-only event, never a new receipt or false ready", async () => {
    const history = JSON.parse((await admin.query("SELECT revocation_history_json FROM dream.asset_receipt_state WHERE object_id=$1", [O])).rows[0].revocation_history_json);
    const event = { revision: 4, at: Date.parse(time(33)), principalId: WORKER, authorizers: [WORKER], operationId: uid(80), kind: "verification_failure" };
    const exercise = (includeEvent: boolean) => tx(async c => {
      await insert(c, "storage_verification_operations", { ...operation(uid(80), "reverify", 3), expected_state_revision: 3, created_at: time(32) });
      await c.query("UPDATE dream.storage_objects SET active_generation=3,revision=revision+1 WHERE id=$1", [O]);
      await claim(c, uid(80), undefined, time(32)); await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]);
      const result = canonical({ status: "failed", code: "HASH_MISMATCH" });
      await c.query("UPDATE dream.storage_verification_operations SET status='failed',failure_code='HASH_MISMATCH',terminal_json=$2,terminal_digest=$3,completed_at=$4,completed_state_revision=4,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$5),revision=revision+1 WHERE id=$1", [uid(80), result, dh("verification-terminal", result), time(33), O]);
      await c.query("UPDATE dream.asset_receipt_state SET status='unavailable',revocation_history_json=$2,revision=4 WHERE object_id=$1", [O, canonical(includeEvent ? [...history, event] : history)]);
      await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [O]);
    });
    await expect(exercise(false)).rejects.toMatchObject({ code: "23514", message: "state revision history has holes/duplicates" });
    await exercise(true);
    expect((await admin.query("SELECT count(*)::int AS n FROM dream.storage_verification_receipts")).rows[0].n).toBe(2);
    expect((await admin.query("SELECT current_receipt_id,status FROM dream.asset_receipt_state WHERE object_id=$1", [O])).rows[0]).toEqual({ current_receipt_id: R2, status: "unavailable" });
    await reject("UPDATE dream.asset_receipt_state SET revocation_history_json=$2,revision=revision+1 WHERE object_id=$1", [O, canonical([...history, { ...event, principalId: B }])]);
  });
  it("tombstones a canceled unbound reservation using the model's explicit null-identity digest", async () => {
    const obj = uid(20), claimId = uid(90);
    const closure = canonical({ revision: 1, at: Date.parse(time()), principalId: WORKER, authorizers: [WORKER], reason: "cleanup", operationId: null });
    await tx(async c => {
      await insert(c, "storage_cleanup_claims", { owner_id: B, id: claimId, object_id: obj, barrier_fence: 1, claimed_at: time(), claimed_aggregate_revision: 1 });
      await c.query("UPDATE dream.storage_objects SET initial_closed=true,closure_json=$2,lifecycle='cleanup_claimed',cleanup_id=$3,barrier_fence=1,revision=1 WHERE id=$1", [obj, closure, claimId]);
    });
    await tx(async c => {
      await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=1 WHERE id=$1", [claimId, canonical({ at: Date.parse(time(1)), absent: true, writerQuiescent: true, identityDigest: dh("object-identity", "null") })]);
      await c.query("UPDATE dream.storage_objects SET lifecycle='tombstoned',revision=2 WHERE id=$1", [obj]);
    });
    expect((await admin.query("SELECT lifecycle,identity_json FROM dream.storage_objects WHERE id=$1", [obj])).rows[0]).toEqual({ lifecycle: "tombstoned", identity_json: null });
  });
  // Independent B20-R eight cases below are copied with their expectations intact.
  const accepted = "INDEPENDENT_CONSTRAINTS_ACCEPTED_ROLLED_BACK";
  it("R independent missing closure reason/time must reject at deferred validation", async () => {
    await expect(tx(async c => {
      const obj=uid(2000); await insert(c,"storage_objects",object(A,obj,uid(2001)));
      const bad=canonical({revision:1,principalId:A,authorizers:[A],operationId:null});
      await c.query("UPDATE dream.storage_objects SET initial_closed=true,closure_json=$2,revision=1 WHERE id=$1",[obj,bad]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE"); throw Error(accepted);
    })).rejects.toMatchObject({code:"23514"});
  });
  it("R independent cleanup observation without at must fail closed", async () => {
    await expect(tx(async c => {
      const bad=canonical({absent:true,writerQuiescent:true,identityDigest:dh("object-identity","null")});
      await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=revision+1 WHERE id=$1",[uid(90),bad]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE"); throw Error(accepted);
    })).rejects.toMatchObject({code:"23514"});
  });
  it("R independent cleanup absence/quiescence must be JSON booleans", async () => {
    await expect(tx(async c => {
      const bad=canonical({at:Date.parse(time(2)),absent:"yes",writerQuiescent:"yes",identityDigest:dh("object-identity","null")});
      await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=revision+1 WHERE id=$1",[uid(90),bad]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE"); throw Error(accepted);
    })).rejects.toMatchObject({code:"23514"});
  });
  it("R independent semantic revocation prefix may reserialize while exact new raw text is retained", async () => {
    await expect(tx(async c => {
      const prior=JSON.parse((await c.query("SELECT revocation_history_json FROM dream.asset_receipt_state WHERE object_id=$1",[O])).rows[0].revocation_history_json);
      const event={revision:5,at:Date.parse(time(34)),principalId:A,authorizers:[A],operationId:null,kind:"manual"};
      const raw=` \n${JSON.stringify([...prior,event],null,2)}\n `;
      await c.query("UPDATE dream.asset_receipt_state SET status='revoked',revision=5,revocation_history_json=$2 WHERE object_id=$1",[O,raw]);
      await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1",[O]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await c.query("SELECT revocation_history_json FROM dream.asset_receipt_state WHERE object_id=$1",[O])).rows[0].revocation_history_json).toBe(raw);
      throw Error(accepted);
    })).rejects.toThrow(accepted);
  });
  it("R independent creation raw hash binding rejects NULL groups and semantic-equivalent changed raw bytes", async () => {
    const req=uid(2010),client=' {"title":"unit","menuId":"unit","referenceIds":[],"inputs":{}} ',snap=' {"policyEpoch":1,"config":{},"menu":{}} ',raw=canonical({client:JSON.parse(client),snapshot:JSON.parse(snap)});
    await tx(async c=>{await insert(c,"creation_operations",{owner_id:A,request_id:req,client_digest:dh("creation-client",client),snapshot_digest:dh("creation-snapshot",snap),fingerprint_version:2,request_fingerprint:dh("creation-request-v2",canonical({fingerprintVersion:2,clientDigest:dh("creation-client",client),snapshotDigest:dh("creation-snapshot",snap)})),client_json:client,original_snapshot_json:snap,request_json:raw,authorization_until:time(100),status:"pending",revision:0,created_at:time()});});
    await reject("UPDATE dream.creation_operations SET client_json=$2,revision=revision+1 WHERE request_id=$1",[req,canonical(JSON.parse(client))]);
    await reject("UPDATE dream.creation_operations SET status='canceled',settled_at=$2,settled_by=NULL,settled_registrars='{}',result_json='{}',result_digest=$3,revision=revision+1 WHERE request_id=$1",[req,time(1),dh("creation-result","{}")]);
    expect((await admin.query("SELECT client_json FROM dream.creation_operations WHERE request_id=$1",[req])).rows[0].client_json).toBe(client);
  });
  it("R independent outbox final NULL and cross-owner or wrong-key targets reject", async () => {
    const record={owner_id:A,id:uid(2020),object_id:O,kind:"reconcile",target_kind:"final",operation_id:null,generation:null,fence:0,barrier_fence:0,bucket:identity.bucket,object_key:identity.key,identity_digest:identityDigest,payload_json:"{}",payload_sha:sha("{}"),status:"pending",attempts:0,revision:0,created_at:time()};
    for(const change of [{identity_digest:null},{owner_id:B},{object_key:`${A}/wrong/key`}])await expect(insert(admin,"storage_outbox",{...record,...change})).rejects.toMatchObject({code:change.identity_digest===null?"23514":"23503"});
    await insert(admin,"storage_outbox",record);
    await reject("UPDATE dream.storage_outbox SET bucket='retargeted',revision=revision+1 WHERE id=$1",[record.id]);
  });
  it("R independent all12 grants and7 owner SELECT policies keep API writes and worker tables denied", async () => {
    const rows=(await admin.query("SELECT c.relname,has_table_privilege('dream_api',c.oid,'SELECT') AS aselect,has_table_privilege('dream_api',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS awrite,has_table_privilege('dream_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS wany,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname=ANY($1) AND c.relkind='r'",[tables])).rows;
    expect(rows).toHaveLength(12);expect(rows.filter(r=>r.aselect)).toHaveLength(7);expect(rows.every(r=>!r.awrite&&!r.wany&&r.relrowsecurity&&r.relforcerowsecurity)).toBe(true);
    const catalog=(await admin.query("SELECT (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relkind='r') AS tables,(SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream') AS policies,(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND t.tgname='guard_row') AS original_guards,(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND t.tgname='storage_guard') AS new_guards,(SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname<>ALL($1) AND k.contype='f' AND k.confrelid='auth.users'::regclass) AS original_auth_fks",[tables])).rows[0];
    expect(catalog).toEqual({tables:30,policies:43,original_guards:18,new_guards:12,original_auth_fks:18});
    expect((await admin.query("SELECT count(*)::int n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname=ANY($1) AND p.polcmd='r'",[tables])).rows[0].n).toBe(7);
    expect((await admin.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dream' AND p.proname LIKE 'storage_%' AND p.prosecdef")).rows[0].n).toBe(0);
  });
  it("R independent canceled prior claim validates exact old worker while normal cancellation survives", async () => {
    const exercise=(worker:string)=>tx(async c=>{
      const obj=uid(2030),asset=uid(2031),intentId=uid(2032),opId=uid(2033);await insert(c,"storage_objects",object(A,obj,asset));await insert(c,"upload_intents",{...intent(A,intentId,obj),request_id:uid(2034)});await insert(c,"storage_verification_operations",{...operation(opId),object_id:obj,intent_id:intentId});await c.query("UPDATE dream.storage_objects SET active_generation=1,revision=1 WHERE id=$1",[obj]);await claim(c,opId);await c.query("UPDATE dream.storage_objects SET revision=2 WHERE id=$1",[obj]);
      const prior=canonical({workerId:worker,fence:1,claimedAt:Date.parse(time()),leaseUntil:Date.parse(time(90)),authorizationUntil:Date.parse(time(90)),policyEpoch:1,policyDigest:PD,claimVerifiers:[WORKER]}),terminal='{"status":"canceled"}';
      await c.query("UPDATE dream.storage_verification_operations SET status='canceled',fence=2,worker_id=NULL,lease_until=NULL,claimed_at=NULL,claim_verifiers='{}',canceled_claim_json=$2,completed_at=$3,completed_state_revision=0,completed_aggregate_revision=3,terminal_json=$4,terminal_digest=$5,revision=revision+1 WHERE id=$1",[opId,prior,time(1),terminal,dh("verification-terminal",terminal)]);
      await c.query("UPDATE dream.storage_objects SET initial_closed=true,closure_json=$2,revision=3 WHERE id=$1",[obj,canonical({revision:3,at:Date.parse(time(1)),principalId:A,authorizers:[A],reason:"cancel",operationId:null})]);await c.query("SET CONSTRAINTS ALL IMMEDIATE");throw Error(accepted);
    });await expect(exercise(B)).rejects.toMatchObject({code:"23514"});await expect(exercise(WORKER)).rejects.toThrow(accepted);
  });
  const closureBase = { revision: 1, at: Date.parse(time()), principalId: A, authorizers: [A], reason: "cancel", operationId: null };
  async function closureBoundary(value: unknown) {
    return tx(async c => {
      const obj = uid(2100); await insert(c, "storage_objects", object(A, obj, uid(2101)));
      await c.query("UPDATE dream.storage_objects SET initial_closed=true,closure_json=$2,revision=1 WHERE id=$1", [obj, canonical(value)]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE"); throw Error(accepted);
    });
  }
  const missingNullWrong = (base: Record<string, unknown>, wrong: Record<string, unknown>) => Object.keys(base).flatMap(key => {
    const omitted = { ...base }; delete omitted[key];
    return [[`${key} omitted`, omitted], ...(base[key] === null ? [] : [[`${key} null`, { ...base, [key]: null }]]), [`${key} wrong kind`, { ...base, [key]: wrong[key] }]] as [string, Record<string, unknown>][];
  });
  it.each(missingNullWrong(closureBase, { revision: "1", at: `${Date.parse(time())}`, principalId: 1, authorizers: A, reason: true, operationId: 1 }))("FIX closure rejects %s", async (_name, value) => {
    await expect(closureBoundary(value)).rejects.toMatchObject({ code: "23514" });
  });
  it.each([
    ["unknown reason", { reason: "other" }], ["zero revision", { revision: 0 }], ["fractional revision", { revision: 1.5 }],
    ["negative time", { at: -1 }], ["fractional time", { at: 1.5 }], ["unsafe time", { at: 9007199254740992 }],
    ["empty authority", { authorizers: [] }], ["nonstring authority", { authorizers: [1] }], ["null authority member", { authorizers: [null] }],
    ["malformed principal", { principalId: "invalid" }], ["malformed operation", { operationId: "invalid" }], ["unknown field", { extra: true }],
  ])("FIX closure rejects %s value", async (_name, change) => {
    await expect(closureBoundary({ ...closureBase, ...(change as object) })).rejects.toMatchObject({ code: "23514" });
  });
  it("FIX valid owner closure, including nullable operation, reaches deferred validation", async () => {
    await expect(closureBoundary(closureBase)).rejects.toThrow(accepted);
  });
  const observationBase = { at: Date.parse(time(2)), absent: true, writerQuiescent: true, identityDigest: dh("object-identity", "null") };
  async function observationBoundary(value: Record<string, unknown>, raw = canonical(value)) {
    return tx(async c => {
      await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=revision+1 WHERE id=$1", [uid(90), raw]);
      await c.query("UPDATE dream.storage_objects SET lifecycle=$2,revision=revision+1 WHERE id=$1", [uid(20), value.absent === true && value.writerQuiescent === true ? "tombstoned" : "cleanup_claimed"]);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE"); throw Error(accepted);
    });
  }
  it.each(missingNullWrong(observationBase, { at: `${Date.parse(time(2))}`, absent: "yes", writerQuiescent: "true", identityDigest: 1 }))("FIX observation rejects %s", async (_name, value) => {
    await expect(observationBoundary(value)).rejects.toMatchObject({ code: "23514" });
  });
  it.each([
    ["fractional time", { at: 1.5 }], ["negative time", { at: -1 }], ["unsafe time", { at: 9007199254740992 }],
    ["false string", { absent: "false" }], ["numeric boolean", { writerQuiescent: 1 }], ["wrong digest", { identityDigest: H }],
    ["malformed digest", { identityDigest: "invalid" }], ["unknown field", { extra: true }],
  ])("FIX observation rejects %s value", async (_name, change) => {
    await expect(observationBoundary({ ...observationBase, ...(change as object) })).rejects.toMatchObject({ code: "23514" });
  });
  it.each([[true, true], [true, false], [false, true], [false, false]])("FIX genuine JSON booleans absent=%s quiescent=%s survive", async (absent, writerQuiescent) => {
    await expect(observationBoundary({ ...observationBase, absent, writerQuiescent })).rejects.toThrow(accepted);
  });
  it("FIX JSON integer-valued decimal time survives without text-to-bigint cast failure", async () => {
    const raw = canonical(observationBase).replace(`"at":${observationBase.at}`, `"at":${observationBase.at}.0`);
    await expect(observationBoundary(observationBase, raw)).rejects.toThrow(accepted);
  });
});
