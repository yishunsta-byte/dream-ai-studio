import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, protocolDigest } from "../../storage/uploads/receipt";
import { checkedModel, reserveUpload } from "../../storage/uploads/state";
import { counter, frozen, parse, recordId, uploadModelSchema } from "../../storage/uploads/schema";

export class UploadReservationCodecError extends Error {
  readonly code = "UPLOAD_RESERVATION_CODEC";
  constructor() { super("UPLOAD_RESERVATION_CODEC"); }
}
const reservationSchema = uploadModelSchema.pick({ ownerId: true, objectId: true, assetId: true, intentId: true,
  intentExpiresAt: true, issueEnvelopeUntil: true, maxIssues: true, verifiers: true, collectors: true,
  policyManagers: true, policyEpoch: true, policyDigest: true, incoming: true });
const requestSchema = z.strictObject({ codecVersion: z.literal(1), requestId: recordId,
  maxBytes: z.number().int().positive().max(2147483648), reservedAt: counter, reservation: reservationSchema });
const encodeSchema = z.strictObject({ model: uploadModelSchema, requestJson: z.string().min(1).max(65536) });
const sha = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
function need(value: unknown): asserts value { if (!value) throw new UploadReservationCodecError(); }
function exact(pattern: RegExp, value: string) { return pattern.exec(value)?.[0] === value; }
function utf8(value: string) { need(!value.includes("\0") && Buffer.from(value, "utf8").toString("utf8") === value); }

// JSON.parse alone silently rounds number lexemes and discards duplicate keys.
// Wire v1 allows whitespace/key order changes, but only unsigned base10 integer
// numeric tokens. Scan the bounded raw input before parsing, without rewriting it.
function strictJson(raw: string): unknown {
  utf8(raw); let at = 0, nodes = 0;
  const space = () => { while (/[ \t\r\n]/.test(raw[at] ?? "") && at < raw.length) at++; };
  function string() {
    need(raw[at] === '"'); const start = at++;
    while (at < raw.length) {
      const character = raw[at++];
      if (character === "\\") { need(at < raw.length); at++; }
      else if (character === '"') { const text: unknown = JSON.parse(raw.slice(start, at)); need(typeof text === "string"); utf8(text); return text; }
    }
    throw new UploadReservationCodecError();
  }
  function value(depth: number): void {
    need(++nodes <= 4096 && depth <= 16); space(); const character = raw[at];
    if (character === "{") {
      at++; space(); const keys = new Set<string>();
      if (raw[at] === "}") { at++; return; }
      for (;;) {
        space(); const key = string(); need(!keys.has(key) && keys.size < 128); keys.add(key);
        space(); need(raw[at++] === ":"); value(depth + 1); space(); const separator = raw[at++];
        if (separator === "}") return; need(separator === ",");
      }
    }
    if (character === "[") {
      at++; space(); if (raw[at] === "]") { at++; return; }
      for (;;) { value(depth + 1); space(); const separator = raw[at++]; if (separator === "]") return; need(separator === ","); }
    }
    if (character === '"') { string(); return; }
    for (const literal of ["true", "false", "null"]) if (raw.startsWith(literal, at)) { at += literal.length; return; }
    const integer = /^(?:0|[1-9][0-9]*)/.exec(raw.slice(at))?.[0];
    need(integer && integer.length <= 16 && Number.isSafeInteger(Number(integer))); at += integer.length;
  }
  value(0); space(); need(at === raw.length); return JSON.parse(raw) as unknown;
}
function noNegativeZero(value: unknown): void {
  if (typeof value === "number") need(!Object.is(value, -0));
  else if (value && typeof value === "object") Object.values(value).forEach(noNegativeZero);
}
function request(raw: string) {
  const data = parse(requestSchema, strictJson(raw)), v = data.reservation;
  need(data.requestId.length === 36 && [v.ownerId, v.objectId, v.assetId, v.intentId, ...v.verifiers, ...v.collectors, ...v.policyManagers].every(id => id.length === 36));
  need(v.policyDigest.length === 64 && exact(/^[a-f0-9]{64}$/, v.policyDigest));
  need(exact(/^[a-z][a-z0-9-]{0,62}$/, v.incoming.bucket) && exact(/^[a-zA-Z0-9/_.-]+$/, v.incoming.key));
  // Reconstruction context is persisted data, NOT an authenticated actor. The
  // caller must separately authorize the real owner and trusted policy snapshot.
  const model = reserveUpload(v, { principalId: v.ownerId, now: data.reservedAt, expectedRevision: 0 });
  return { data, model, fingerprint: protocolDigest("upload-reservation-request", data), rawSha: sha(raw) };
}

// Millisecond counters can reach MAX_SAFE_INTEGER, beyond JavaScript Date's
// range. Split exact integer days and a small remainder; never convert epoch to
// double precision seconds. The intermediate calendar timestamp is UTC, so a
// caller's session timezone/DST cannot change the instant.
const epoch = (parameter: number) => `(TIMESTAMP '1970-01-01 00:00:00' + pg_catalog.make_interval(days => ($${parameter}::bigint / 86400000)::integer) + (($${parameter}::bigint % 86400000) * INTERVAL '1 millisecond')) AT TIME ZONE 'UTC'`;
export const uploadReservationObjectInsertSql = `INSERT INTO dream.storage_objects(owner_id,id,reserved_asset_id,registered_asset_id,lifecycle,revision,barrier_fence,initial_closed,closure_json,publication_json,active_generation,cleanup_id,bucket,object_key,provider_version,kind,mime,sha256,size_bytes,identity_json,identity_digest,created_at)
VALUES($1,$2,$3,NULL,'reserved',0,0,false,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,${epoch(4)})`;
export const uploadReservationIntentInsertSql = `INSERT INTO dream.upload_intents(owner_id,id,object_id,request_id,request_fingerprint,request_json,request_raw_sha,incoming_bucket,incoming_key,max_bytes,authorization_until,issue_envelope_until,max_issues,issue_count,status,revision,created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${epoch(11)},${epoch(12)},$13,0,'open',0,${epoch(14)})`;
export const uploadReservationObjectSelectSql = `SELECT owner_id::text,id::text,reserved_asset_id::text,registered_asset_id::text,lifecycle,revision::text,barrier_fence::text,initial_closed,closure_json,publication_json,active_generation::text,cleanup_id::text,bucket,object_key,provider_version,kind,mime,sha256::text,size_bytes::text,identity_json,identity_digest::text,(extract(epoch FROM created_at)*1000)::text AS created_at_ms FROM dream.storage_objects WHERE owner_id=$1 AND id=$2`;
export const uploadReservationIntentSelectSql = `SELECT owner_id::text,id::text,object_id::text,request_id::text,request_fingerprint::text,request_json,request_raw_sha::text,incoming_bucket,incoming_key,max_bytes::text,(extract(epoch FROM authorization_until)*1000)::text AS authorization_until_ms,(extract(epoch FROM issue_envelope_until)*1000)::text AS issue_envelope_until_ms,max_issues::text,issue_count::text,status,revision::text,(extract(epoch FROM created_at)*1000)::text AS created_at_ms FROM dream.upload_intents WHERE owner_id=$1 AND id=$2`;
type Statement = Readonly<{ text: string; values: readonly (string | number | boolean | null)[] }>;
export function encodeUploadReservation(input: unknown) {
  try {
    const value = parse(encodeSchema, input), checked = checkedModel(value.model); noNegativeZero(checked);
    const binding = request(value.requestJson), model = binding.model, data = binding.data;
    need(checked.lifecycle === "reserved" && canonicalJson(checked) === canonicalJson(model));
    const object: Statement = { text: uploadReservationObjectInsertSql, values: [model.ownerId, model.objectId, model.assetId, String(model.reservedAt)] };
    const intent: Statement = { text: uploadReservationIntentInsertSql, values: [model.ownerId, model.intentId, model.objectId, data.requestId,
      binding.fingerprint, value.requestJson, binding.rawSha, model.incoming.bucket, model.incoming.key, String(data.maxBytes),
      String(model.intentExpiresAt), String(model.issueEnvelopeUntil), String(model.maxIssues), String(model.reservedAt)] };
    return frozen({ model, requestId: data.requestId, maxBytes: data.maxBytes, requestJson: value.requestJson, fingerprint: binding.fingerprint, rawSha: binding.rawSha,
      object, intent, selectObject: { text: uploadReservationObjectSelectSql, values: [model.ownerId, model.objectId] } as Statement,
      selectIntent: { text: uploadReservationIntentSelectSql, values: [model.ownerId, model.intentId] } as Statement });
  } catch { throw new UploadReservationCodecError(); }
}

const text = z.string().max(65536), nullable = z.null(), uuid = z.string().length(36), digest = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const objectRow = z.strictObject({ owner_id: uuid, id: uuid, reserved_asset_id: uuid, registered_asset_id: nullable,
  lifecycle: z.literal("reserved"), revision: z.literal("0"), barrier_fence: z.literal("0"), initial_closed: z.literal(false),
  closure_json: nullable, publication_json: nullable, active_generation: z.literal("0"), cleanup_id: nullable, bucket: nullable,
  object_key: nullable, provider_version: nullable, kind: nullable, mime: nullable, sha256: nullable, size_bytes: nullable,
  identity_json: nullable, identity_digest: nullable, created_at_ms: text });
const intentRow = z.strictObject({ owner_id: uuid, id: uuid, object_id: uuid, request_id: uuid, request_fingerprint: digest, request_json: text,
  request_raw_sha: digest, incoming_bucket: text, incoming_key: text, max_bytes: text, authorization_until_ms: text,
  issue_envelope_until_ms: text, max_issues: text, issue_count: z.literal("0"), status: z.literal("open"), revision: z.literal("0"), created_at_ms: text });
function integerText(value: string, fractionalZeros = false): number {
  need(value.length <= 64 && exact(fractionalZeros ? /^(?:0|[1-9][0-9]*)(?:\.0+)?$/ : /^(?:0|[1-9][0-9]*)$/, value));
  const integer = BigInt(value.split(".")[0]); need(integer <= BigInt(Number.MAX_SAFE_INTEGER)); return Number(integer);
}
// Inputs must use the fixed text projections above. This checks representation
// and cross-row consistency, not Auth, active policy or provider attestation.
export function decodeUploadReservation(input: unknown) {
  try {
    const rows = parse(z.strictObject({ object: objectRow, intent: intentRow }), input), o = rows.object, i = rows.intent;
    const binding = request(i.request_json), model = binding.model, data = binding.data;
    need(o.owner_id === model.ownerId && o.id === model.objectId && o.reserved_asset_id === model.assetId && integerText(o.created_at_ms, true) === model.reservedAt);
    need(i.owner_id === model.ownerId && i.id === model.intentId && i.object_id === model.objectId && i.request_id === data.requestId &&
      i.request_fingerprint === binding.fingerprint && i.request_raw_sha === binding.rawSha && i.incoming_bucket === model.incoming.bucket && i.incoming_key === model.incoming.key &&
      integerText(i.max_bytes) === data.maxBytes && integerText(i.max_issues) === model.maxIssues && integerText(i.authorization_until_ms, true) === model.intentExpiresAt &&
      integerText(i.issue_envelope_until_ms, true) === model.issueEnvelopeUntil && integerText(i.created_at_ms, true) === model.reservedAt);
    return frozen({ model, requestId: data.requestId, maxBytes: data.maxBytes, requestJson: i.request_json, fingerprint: binding.fingerprint, rawSha: binding.rawSha });
  } catch { throw new UploadReservationCodecError(); }
}
