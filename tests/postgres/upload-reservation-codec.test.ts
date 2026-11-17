import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson, protocolDigest } from "@/lib/storage/uploads/receipt";
import { reserveUpload, transition } from "@/lib/storage/uploads/state";
import { encodeUploadReservation, decodeUploadReservation, uploadReservationObjectInsertSql, uploadReservationIntentInsertSql,
  uploadReservationObjectSelectSql, uploadReservationIntentSelectSql } from "@/lib/db/postgres/upload-reservation-codec";
import { inspectMigrationTarget } from "@/lib/db/postgres/migration-target";
import { postgresMigrationApprovalHashV2, runPostgresMigrationsV2 } from "@/lib/db/postgres/migration-runner-v2";
vi.mock("server-only", () => ({}));
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", W = "00000000-0000-4000-8000-000000000003";
const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const encode = (value: { model: unknown; requestJson: string }) => encodeUploadReservation({ model: value.model, requestJson: value.requestJson });
function fixture(serial = 1, reservedAt = 1000, issueEnvelopeUntil = 2000, intentExpiresAt = 3000, providerVersion: string | null = "opaque incoming version") {
  const reservation = { ownerId: A, objectId: uid(serial * 10), assetId: uid(serial * 10 + 1), intentId: uid(serial * 10 + 2),
    intentExpiresAt, issueEnvelopeUntil, maxIssues: 3, verifiers: [W, A], collectors: [W], policyManagers: [A, W], policyEpoch: 7, policyDigest: "b".repeat(64),
    incoming: { bucket: "synthetic-incoming", key: `${A}/incoming/${uid(serial * 10 + 2)}/nonce`, providerVersion } };
  const model = reserveUpload(reservation, { principalId: A, now: reservedAt, expectedRevision: 0 });
  const request = { codecVersion: 1, requestId: uid(serial * 10 + 3), maxBytes: 2147483648, reservedAt, reservation };
  const requestJson = ` \n${JSON.stringify(request, null, 2)}\t `;
  return { model, request, requestJson };
}
function projectedRows(value = fixture()) {
  const m = value.model, raw = value.requestJson;
  return {
    object: { owner_id: A, id: m.objectId, reserved_asset_id: m.assetId, registered_asset_id: null, lifecycle: "reserved", revision: "0", barrier_fence: "0", initial_closed: false,
      closure_json: null, publication_json: null, active_generation: "0", cleanup_id: null, bucket: null, object_key: null, provider_version: null, kind: null, mime: null, sha256: null, size_bytes: null,
      identity_json: null, identity_digest: null, created_at_ms: `${m.reservedAt}.000000` },
    intent: { owner_id: A, id: m.intentId, object_id: m.objectId, request_id: value.request.requestId, request_fingerprint: protocolDigest("upload-reservation-request", value.request), request_json: raw,
      request_raw_sha: sha(raw), incoming_bucket: m.incoming.bucket, incoming_key: m.incoming.key, max_bytes: "2147483648", authorization_until_ms: `${m.intentExpiresAt}.000000`,
      issue_envelope_until_ms: `${m.issueEnvelopeUntil}.000000`, max_issues: "3", issue_count: "0", status: "open", revision: "0", created_at_ms: `${m.reservedAt}.000000` },
  };
}
const rejected = { code: "UPLOAD_RESERVATION_CODEC", message: "UPLOAD_RESERVATION_CODEC" };
describe("B25 pure pristine upload reservation codec", () => {
  it("preserves original raw JSON and every model/policy/incoming field without mutating inputs", () => {
    const value = fixture(), snapshot = JSON.stringify(value), encoded = encode(value);
    const decoded = decodeUploadReservation(projectedRows(value));
    expect(decoded.model).toEqual(value.model); expect(decoded.requestJson).toBe(value.requestJson); expect(decoded.fingerprint).toBe(encoded.fingerprint);
    expect(encoded.rawSha).toBe(sha(value.requestJson)); expect(encoded.intent.values[5]).toBe(value.requestJson);
    expect(encoded.fingerprint).toBe(sha(`upload-reservation-request:v1\n${canonicalJson(value.request)}`));
    expect(JSON.stringify(value)).toBe(snapshot); expect(Object.isFrozen(decoded.model.verifiers)).toBe(true); expect(Object.isFrozen(encoded.object.values)).toBe(true);
  });
  it("whitespace/key-order variants keep semantic fingerprint but exact distinct raw hashes", () => {
    const value = fixture(), compact = { ...value, requestJson: JSON.stringify(value.request) };
    const a = encode(value), b = encode(compact);
    expect(a.fingerprint).toBe(b.fingerprint); expect(a.rawSha).not.toBe(b.rawSha); expect(b.requestJson).toBe(compact.requestJson);
  });
  it("authorizer order/duplicates and opaque nullable provider version are preserved", () => {
    const value = fixture(2, 1000, 2000, 3000, null);
    value.request.reservation.verifiers = [A, W, A];
    const model = reserveUpload(value.request.reservation, { principalId: A, now: 1000, expectedRevision: 0 });
    const encoded = encodeUploadReservation({ model, requestJson: JSON.stringify(value.request) });
    expect(encoded.model.verifiers).toEqual([A, W, A]); expect(encoded.model.incoming.providerVersion).toBeNull();
  });
  it("returns fixed parameterized specifications, never embeds hostile strings in SQL", () => {
    const hostile = "v'); DROP TABLE dream.assets;--\n한글", value = fixture(3, 1000, 2000, 3000, hostile), encoded = encode(value);
    expect(encoded.object.text).toBe(uploadReservationObjectInsertSql); expect(encoded.intent.text).toBe(uploadReservationIntentInsertSql);
    for (const statement of [encoded.object, encoded.intent, encoded.selectObject, encoded.selectIntent]) expect(statement.text).not.toContain(hostile);
    expect(encoded.intent.values[5]).toContain("DROP TABLE"); expect(encoded.selectObject.text).toBe(uploadReservationObjectSelectSql); expect(encoded.selectIntent.text).toBe(uploadReservationIntentSelectSql);
  });
  it("supports maximum safe integer times without Date or float epoch conversion", () => {
    const value = fixture(4, Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER);
    const encoded = encode(value), decoded = decodeUploadReservation(projectedRows(value));
    expect(decoded.model).toEqual(value.model); expect(encoded.object.values[3]).toBe(String(Number.MAX_SAFE_INTEGER - 2));
    expect(encoded.intent.text).not.toContain("to_timestamp");
  });
  it.each([
    { codecVersion: 2 }, { requestId: A }, { maxBytes: 0 }, { maxBytes: 2147483649 }, { reservedAt: null },
  ])("rejects invalid reservation wire metadata %s", change => {
    const value = fixture(); expect(() => encodeUploadReservation({ model: value.model, requestJson: JSON.stringify({ ...value.request, ...change }) })).toThrowError(expect.objectContaining(rejected));
  });
  it.each(["verifiers", "collectors", "policyManagers", "policyEpoch", "policyDigest", "incoming"])("rejects incomplete server snapshot missing %s", field => {
    const value = fixture(), data = JSON.parse(JSON.stringify(value.request)); delete data.reservation[field];
    expect(() => encodeUploadReservation({ model: value.model, requestJson: JSON.stringify(data) })).toThrowError(expect.objectContaining(rejected));
  });
  it("rejects oversized raw input and rejects row getters without executing them", () => {
    expect(() => encodeUploadReservation({ model: fixture().model, requestJson: " ".repeat(65537) })).toThrowError(expect.objectContaining(rejected));
    const rows = projectedRows(), getter = vi.fn(() => rows.intent.request_json); Object.defineProperty(rows.intent, "request_json", { enumerable: true, get: getter });
    expect(() => decodeUploadReservation(rows)).toThrowError(expect.objectContaining(rejected)); expect(getter).not.toHaveBeenCalled();
  });
  it.each(["ownerId", "objectId", "assetId", "intentId", "policyEpoch", "policyDigest", "intentExpiresAt"])("rejects raw/model %s mismatch", field => {
    const value = fixture(); const altered = JSON.parse(JSON.stringify(value.request));
    altered.reservation[field] = field.endsWith("Id") ? (field === "ownerId" ? B : uid(99)) : field.endsWith("At") ? 3001 : field === "policyEpoch" ? 8 : "c".repeat(64);
    expect(() => encodeUploadReservation({ model: value.model, requestJson: JSON.stringify(altered) })).toThrowError(expect.objectContaining(rejected));
  });
  it.each(["verifiers", "collectors", "policyManagers"])("rejects differing trusted snapshot %s", field => {
    const value = fixture(), altered = JSON.parse(JSON.stringify(value.request)); altered.reservation[field] = [B];
    expect(() => encodeUploadReservation({ model: value.model, requestJson: JSON.stringify(altered) })).toThrowError(expect.objectContaining(rejected));
  });
  it("rejects a valid evolved reserved model with issued capability instead of treating it as pristine", () => {
    const value = fixture(), model = transition(value.model, { type: "reserveCapability", issueId: uid(98), issueUntil: 1500, horizon: null }, { principalId: A, now: 1001, expectedRevision: 0 });
    expect(model.lifecycle).toBe("reserved"); expect(() => encodeUploadReservation({ model, requestJson: value.requestJson })).toThrowError(expect.objectContaining(rejected));
  });
  it.each(["{}", "null", "[]", '{"codecVersion":2}', '{"codecVersion":1,"codecVersion":1}', "{", " ", '{"codecVersion":1.0000000000000000001}', '{"codecVersion":1e0}'])("rejects malformed/partial/ambiguous raw JSON %s", raw => {
    expect(() => encodeUploadReservation({ model: fixture().model, requestJson: raw })).toThrowError(expect.objectContaining(rejected));
  });
  it.each(["-0", "1.0", "1e3", "9007199254740992", "1000.0000000000000000000001"])("rejects noncanonical/unsafe integer token %s before JSON rounding", token => {
    const value = fixture(), raw = value.requestJson.replace('"reservedAt": 1000', `"reservedAt": ${token}`);
    expect(() => encodeUploadReservation({ model: value.model, requestJson: raw })).toThrowError(expect.objectContaining(rejected));
  });
  it("rejects duplicate decoded keys, NUL and unpaired surrogate JSON", () => {
    const value = fixture();
    for (const raw of [value.requestJson.replace('"codecVersion": 1,', '"codecVersion": 1,"codec\\u0056ersion":1,'),
      value.requestJson.replace('"opaque incoming version"', '"\\u0000"'), value.requestJson.replace('"opaque incoming version"', '"\\ud800"')]) {
      expect(() => encodeUploadReservation({ model: value.model, requestJson: raw })).toThrowError(expect.objectContaining(rejected));
    }
  });
  it("rejects negative-zero model and getters without executing them", () => {
    const value = fixture(), model = { ...value.model, revision: -0 };
    expect(() => encodeUploadReservation({ model, requestJson: value.requestJson })).toThrowError(expect.objectContaining(rejected));
    const getter = vi.fn(() => value.requestJson), input = { model: value.model }; Object.defineProperty(input, "requestJson", { enumerable: true, get: getter });
    expect(() => encodeUploadReservation(input)).toThrowError(expect.objectContaining(rejected)); expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    ["object", "owner_id", B], ["object", "id", uid(99)], ["object", "reserved_asset_id", uid(99)], ["object", "created_at_ms", "1001.000000"],
    ["object", "created_at_ms", "1000.000001"], ["object", "created_at_ms", "9007199254740992"], ["object", "created_at_ms", "-1"], ["object", "created_at_ms", "Infinity"], ["object", "created_at_ms", "1000\n"],
    ["object", "lifecycle", "registered"], ["object", "revision", "1"], ["object", "registered_asset_id", uid(11)], ["object", "publication_json", "{}"],
    ["intent", "owner_id", B], ["intent", "object_id", uid(99)], ["intent", "id", uid(99)], ["intent", "request_id", uid(99)],
    ["intent", "request_fingerprint", "a".repeat(64)], ["intent", "request_raw_sha", "a".repeat(64)], ["intent", "incoming_key", `${A}/wrong`],
    ["intent", "max_bytes", "1"], ["intent", "max_issues", "4"], ["intent", "authorization_until_ms", "3001"], ["intent", "issue_envelope_until_ms", "2001"],
    ["intent", "created_at_ms", "1001"], ["intent", "issue_count", "1"], ["intent", "status", "completion_requested"], ["intent", "revision", "1"], ["intent", "request_json", null],
  ])("rejects mismatched or evolved DB %s.%s", (row, field, next) => {
    const rows = projectedRows() as unknown as Record<string, Record<string, unknown>>; rows[row as string][field as string] = next;
    expect(() => decodeUploadReservation(rows)).toThrowError(expect.objectContaining(rejected));
  });
  it("rejects partial projections, Date/coerced counters and unknown fields", () => {
    for (const mutation of [(rows: ReturnType<typeof projectedRows>) => { delete (rows.object as Partial<typeof rows.object>).created_at_ms; },
      (rows: ReturnType<typeof projectedRows>) => Object.assign(rows.object, { created_at_ms: new Date(1000) }),
      (rows: ReturnType<typeof projectedRows>) => Object.assign(rows.intent, { max_bytes: 2147483648 }),
      (rows: ReturnType<typeof projectedRows>) => Object.assign(rows.intent, { unrecognized: true })]) {
      const rows = projectedRows(); mutation(rows); expect(() => decodeUploadReservation(rows)).toThrowError(expect.objectContaining(rejected));
    }
  });
});

describe.skipIf(process.env.DREAM_PG_B25_SCHEMA_TEST !== "1")("B25 owned actual PG18.7 reservation roundtrip", () => {
  let admin: Pool;
  beforeAll(async () => {
    const uri = process.env.DREAM_PG_TEST_ADMIN_URL ?? "", u = new URL(uri);
    if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || !u.port || u.username !== "dream_test_admin" || !/^\/dream_test_[a-z0-9_]+$/.test(u.pathname) || u.search || u.hash) throw Error("Fresh owned synthetic target required");
    admin = new Pool({ connectionString: uri, max: 2 }); expect((await admin.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('auth') AS auth")).rows[0]).toEqual({ dream: null, auth: null });
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)"); await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
    const target = { connectionString: uri, profile: "synthetic" as const }, hash = inspectMigrationTarget(target).targetHash;
    expect(await runPostgresMigrationsV2({ version: 4, mode: "apply", target, expectedTargetHash: hash, expectedApprovalHash: postgresMigrationApprovalHashV2(4, hash, "apply") })).toMatchObject({ applied: 4 });
  }, 30000);
  afterAll(async () => { await admin?.end(); });
  async function tx(run: (c: PoolClient) => Promise<void>) {
    const c = await admin.connect(); try { await c.query("BEGIN; SET LOCAL search_path=pg_catalog"); await run(c); await c.query("COMMIT"); }
    catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  async function insert(c: PoolClient, value: ReturnType<typeof fixture>) {
    const encoded = encode(value);
    await c.query(encoded.object.text, [...encoded.object.values]); await c.query(encoded.intent.text, [...encoded.intent.values]); return encoded;
  }
  async function select(c: PoolClient, encoded: ReturnType<typeof encodeUploadReservation>) {
    const object = (await c.query(encoded.selectObject.text, [...encoded.selectObject.values])).rows[0], intent = (await c.query(encoded.selectIntent.text, [...encoded.selectIntent.values])).rows[0];
    return { object, intent };
  }
  it("commits explicit parameterized rows then decodes all policy/raw/incoming facts losslessly", async () => {
    const value = fixture(100), original = JSON.stringify(value);
    await tx(async c => {
      const encoded = await insert(c, value), rows = await select(c, encoded), decoded = decodeUploadReservation(rows);
      expect(decoded.model).toEqual(value.model); expect(decoded.requestJson).toBe(value.requestJson);
      expect(encode(decoded).intent.values).toEqual(encoded.intent.values);
      expect((await c.query("SELECT encode(sha256(convert_to(request_json,'UTF8')),'hex') AS hash FROM dream.upload_intents WHERE id=$1", [value.model.intentId])).rows[0].hash).toBe(decoded.rawSha);
    }); expect(JSON.stringify(value)).toBe(original);
  });
  it.each(["UTC", "America/New_York", "Pacific/Auckland"])("MAX_SAFE millisecond times survive timezone %s without JS Date", async zone => {
    const serial = zone === "UTC" ? 101 : zone === "America/New_York" ? 102 : 103, value = fixture(serial, Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER);
    await tx(async c => {
      await c.query("SELECT set_config('TimeZone',$1,true)", [zone]); const encoded = await insert(c, value), rows = await select(c, encoded);
      expect(decodeUploadReservation(rows).model).toEqual(value.model); expect(rows.intent.authorization_until_ms).toMatch(/^9007199254740991\.0+$/);
    });
  });
  it("epoch zero and whole millisecond UTC boundary survive DST session", async () => {
    const value = fixture(104, 0, 1, 2); await tx(async c => { await c.query("SET LOCAL TimeZone='America/New_York'"); const encoded = await insert(c, value); expect(decodeUploadReservation(await select(c, encoded)).model).toEqual(value.model); });
  });
  it("opaque hostile provider text and raw whitespace remain data, never SQL", async () => {
    const value = fixture(105, 1000, 2000, 3000, "v'); DROP TABLE dream.assets;--\n한글");
    await tx(async c => { const encoded = await insert(c, value); expect(decodeUploadReservation(await select(c, encoded)).requestJson).toBe(value.requestJson); expect((await c.query("SELECT to_regclass('dream.assets') AS table")).rows[0].table).toBe("dream.assets"); });
  });
  it("second insert owner FK failure rolls object reservation back atomically", async () => {
    const value = fixture(106), encoded = encode(value);
    await expect(tx(async c => { await c.query(encoded.object.text, [...encoded.object.values]); const wrong = [...encoded.intent.values]; wrong[0] = B; wrong[8] = value.model.incoming.key.replace(A, B); await c.query(encoded.intent.text, wrong); })).rejects.toMatchObject({ code: "23503" });
    expect((await admin.query("SELECT count(*)::int AS n FROM dream.storage_objects WHERE id=$1", [value.model.objectId])).rows[0].n).toBe(0);
  });
  it("actual Auth FK and raw SHA/size DB checks reject before durable rows", async () => {
    const value = fixture(107), encoded = encode(value);
    await expect(tx(async c => { const fields = [...encoded.object.values]; fields[0] = "00000000-0000-4000-8000-000000000099"; await c.query(encoded.object.text, fields); })).rejects.toMatchObject({ code: "23503" });
    for (const [index, replacement] of [[6, "a".repeat(64)], [9, "2147483649"]] as const) await expect(tx(async c => { await c.query(encoded.object.text, [...encoded.object.values]); const fields = [...encoded.intent.values]; fields[index] = replacement; await c.query(encoded.intent.text, fields); })).rejects.toMatchObject({ code: "23514" });
  });
  it("microsecond DB timestamps are rejected rather than rounded to model milliseconds", async () => {
    // A fresh separate row can start with sub-ms time because the SQL column is
    // microsecond precision; bypassing codec params must not round on decode.
    const extra = fixture(109), modified = encode(extra);
    await tx(async c => {
      await c.query(modified.object.text.replace("TIMESTAMP '1970-01-01 00:00:00'", "TIMESTAMP '1970-01-01 00:00:00.000001'"), [...modified.object.values]);
      await c.query(modified.intent.text, [...modified.intent.values]);
      const rows = await select(c, modified); expect(() => decodeUploadReservation(rows)).toThrowError(expect.objectContaining(rejected));
    });
  });
  it("data-only codec does not grant API role permission to execute either insert", async () => {
    const value = fixture(110), encoded = encode(value);
    await expect(tx(async c => { await c.query("SET LOCAL ROLE dream_api"); await c.query(encoded.object.text, [...encoded.object.values]); })).rejects.toMatchObject({ code: "42501" });
    expect((await admin.query("SELECT count(*)::int AS n FROM dream.storage_objects WHERE id=$1", [value.model.objectId])).rows[0].n).toBe(0);
  });
  it("maximum policy epoch/authorizer arrays and minimum byte ceiling remain exact raw data", async () => {
    const value = fixture(111); value.request.reservation.policyEpoch = Number.MAX_SAFE_INTEGER;
    value.request.reservation.verifiers = Array.from({ length: 100 }, () => W);
    value.request.reservation.collectors = Array.from({ length: 100 }, () => A);
    value.request.reservation.policyManagers = Array.from({ length: 100 }, () => W); value.request.maxBytes = 1;
    const model = reserveUpload(value.request.reservation, { principalId: A, now: value.request.reservedAt, expectedRevision: 0 });
    const requestJson = ` \n${JSON.stringify(value.request)}\t `, encoded = encode({ model, requestJson });
    await tx(async c => {
      await c.query(encoded.object.text, [...encoded.object.values]); await c.query(encoded.intent.text, [...encoded.intent.values]);
      const decoded = decodeUploadReservation(await select(c, encoded)); expect(decoded.model).toEqual(model); expect(decoded.requestJson).toBe(requestJson); expect(decoded.maxBytes).toBe(1);
    });
  });
  it("permanent owner/request uniqueness rejects reuse and rolls the second object back", async () => {
    const value = fixture(112); value.request.requestId = fixture(100).request.requestId; const encoded = encode({ model: value.model, requestJson: JSON.stringify(value.request) });
    await expect(tx(async c => { await c.query(encoded.object.text, [...encoded.object.values]); await c.query(encoded.intent.text, [...encoded.intent.values]); })).rejects.toMatchObject({ code: "23505" });
    expect((await admin.query("SELECT count(*)::int AS n FROM dream.storage_objects WHERE id=$1", [value.model.objectId])).rows[0].n).toBe(0);
    expect((await admin.query("SELECT request_json FROM dream.upload_intents WHERE id=$1", [fixture(100).model.intentId])).rows[0].request_json).toBe(fixture(100).requestJson);
  });
});
