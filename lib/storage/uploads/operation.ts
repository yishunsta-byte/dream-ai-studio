import { z } from "zod";
import { canonicalJson, protocolDigest } from "./receipt";
import { contextSchema, counter, digestSchema, frozen, id, parse, recordId, requireProtocol as need } from "./schema";

const json = z.unknown().superRefine((value, ctx) => {
  try { canonicalJson(value); } catch { ctx.addIssue({ code: "custom", message: "Bounded JSON required" }); }
}).transform(value => JSON.parse(canonicalJson(value)) as unknown);
export const creationPayloadSchema = z.strictObject({ menuId: z.string().trim().min(1).max(128), title: z.string().trim().min(1).max(120),
  inputs: z.record(z.string().max(128), json), referenceIds: z.array(recordId).max(100) }).refine(v => new Set(v.referenceIds).size === v.referenceIds.length);
const snapshotSchema = z.strictObject({ menu: json, config: json, policyEpoch: counter });
const resultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("succeeded"), projectId: recordId }),
  z.strictObject({ status: z.literal("failed"), code: z.string().regex(/^[A-Z_]{1,64}$/) }),
  z.strictObject({ status: z.literal("canceled") }),
  z.strictObject({ status: z.literal("retired") }),
]);
const executionResultSchema = resultSchema.refine(r => r.status !== "retired");
const entrySchema = z.strictObject({ requestId: recordId, clientDigest: digestSchema, fingerprint: digestSchema,
  fingerprintVersion: z.literal(2), snapshotDigest: digestSchema,
  snapshot: snapshotSchema.nullable(), authorizationUntil: counter, result: resultSchema.nullable(),
  terminal: z.strictObject({ result: executionResultSchema, digest: digestSchema, at: counter, principalId: id, registrars: z.array(id).min(1).max(100) }).nullable(),
  retirement: z.strictObject({ at: counter, principalId: id, registrars: z.array(id).min(1).max(100), from: z.enum(["pending", "terminal"]) }).nullable() });
const ledgerSchema = z.strictObject({ ownerId: id, registrars: z.array(id).min(1).max(100), revision: counter, entries: z.array(entrySchema).max(1000) });
export type CreationLedger = z.infer<typeof ledgerSchema>;
function ledger(input: unknown) {
  const s = parse(ledgerSchema, input);
  need(new Set(s.entries.map(v => v.requestId)).size === s.entries.length, "INPUT");
  for (const e of s.entries) {
    need(e.fingerprint === composedFingerprint(e.clientDigest, e.snapshotDigest), "INPUT");
    if (e.snapshot) need(e.snapshotDigest === protocolDigest("creation-snapshot", e.snapshot), "INPUT");
    if (e.result?.status === "retired") {
      need(e.snapshot === null && e.retirement && e.retirement.registrars.includes(e.retirement.principalId), "INPUT");
      need((e.retirement.from === "terminal") === (e.terminal !== null), "INPUT");
      need(e.terminal ? e.retirement.at >= e.terminal.at : e.retirement.at >= e.authorizationUntil, "INPUT");
    } else {
      need(e.snapshot !== null && e.retirement === null && (e.result === null) === (e.terminal === null), "INPUT");
      if (e.result) need(canonicalJson(e.result) === canonicalJson(e.terminal!.result), "INPUT");
    }
    if (e.terminal) need(e.terminal.digest === protocolDigest("creation-result", e.terminal.result) &&
      e.terminal.at < e.authorizationUntil && e.terminal.registrars.includes(e.terminal.principalId), "INPUT");
  }
  return s;
}
function composedFingerprint(clientDigest: string, snapshotDigest: string) {
  return protocolDigest("creation-request-v2", { fingerprintVersion: 2, clientDigest, snapshotDigest });
}
export function creationFingerprint(payload: unknown, snapshot: unknown) {
  // Validate raw bounded JSON before Zod can clone away unusual prototypes.
  canonicalJson(payload); canonicalJson(snapshot);
  const client = parse(creationPayloadSchema, payload), original = parse(snapshotSchema, snapshot);
  const clientDigest = protocolDigest("creation-client", client), snapshotDigest = protocolDigest("creation-snapshot", original);
  return frozen({ client, snapshot: original, clientDigest, snapshotDigest, fingerprintVersion: 2 as const,
    fingerprint: composedFingerprint(clientDigest, snapshotDigest) });
}
export function reserveCreationLedger(ownerId: unknown, registrars: unknown) {
  return frozen(ledger({ ownerId, registrars, revision: 0, entries: [] }));
}
const beginSchema = z.strictObject({ requestId: recordId, payload: creationPayloadSchema, snapshot: snapshotSchema, authorizationUntil: counter });
export function beginCreation(input: unknown, request: unknown, context: unknown): CreationLedger {
  canonicalJson(request);
  const s = ledger(input), a = parse(beginSchema, request), c = parse(contextSchema, context);
  need(c.principalId === s.ownerId, "OWNER");
  const old = s.entries.find(e => e.requestId === a.requestId);
  const clientDigest = protocolDigest("creation-client", a.payload);
  if (old) {
    need(old.clientDigest === clientDigest, "CONFLICT");
    // Keep ORIGINAL stored server snapshot. A current policy/menu change cannot
    // reinterpret an exact retry. Retired IDs stay retired; never recycled.
    return frozen(s);
  }
  need(c.expectedRevision === s.revision, "CONFLICT"); need(a.authorizationUntil > c.now, "EXPIRED");
  const f = creationFingerprint(a.payload, a.snapshot);
  s.entries.push({ requestId: a.requestId, clientDigest: f.clientDigest, fingerprint: f.fingerprint,
    fingerprintVersion: f.fingerprintVersion, snapshotDigest: f.snapshotDigest,
    snapshot: f.snapshot, authorizationUntil: a.authorizationUntil, result: null, terminal: null, retirement: null }); s.revision++;
  return frozen(ledger(s));
}
const settleSchema = z.strictObject({ requestId: recordId, fingerprint: digestSchema,
  result: executionResultSchema });
export function settleCreation(input: unknown, request: unknown, context: unknown): CreationLedger {
  const s = ledger(input), a = parse(settleSchema, request), c = parse(contextSchema, context);
  need(s.registrars.includes(c.principalId), "AUTHORITY");
  const e = s.entries.find(e => e.requestId === a.requestId); need(e && e.fingerprint === a.fingerprint, "CONFLICT");
  if (e.result) { need(protocolDigest("creation-result", e.result) === protocolDigest("creation-result", a.result), "CONFLICT"); return frozen(s); }
  need(c.expectedRevision === s.revision, "CONFLICT"); need(c.now < e.authorizationUntil, "EXPIRED");
  // Proposal only: future executor MUST atomically commit successful project,
  // seven stages, refs, audit and this result, under policy/object/state locks.
  e.result = a.result; e.terminal = { result: a.result, digest: protocolDigest("creation-result", a.result), at: c.now,
    principalId: c.principalId, registrars: [...s.registrars] }; s.revision++; return frozen(ledger(s));
}
export function retireCreation(input: unknown, requestId: unknown, context: unknown): CreationLedger {
  const s = ledger(input), c = parse(contextSchema, context);
  need(s.registrars.includes(c.principalId), "AUTHORITY");
  const e = s.entries.find(e => e.requestId === requestId); need(e, "STATE");
  if (e.result?.status === "retired") return frozen(s);
  need(c.expectedRevision === s.revision, "CONFLICT");
  need(e.result !== null || c.now >= e.authorizationUntil, "EXPIRED");
  // Preserve owner/request/fingerprints forever in this model; no delete/reset API.
  e.snapshot = null; e.result = { status: "retired" }; e.retirement = { at: c.now, principalId: c.principalId, registrars: [...s.registrars], from: e.terminal ? "terminal" : "pending" };
  s.revision++; return frozen(ledger(s));
}
export function creationResult(input: unknown, requestId: unknown, payload: unknown, context: unknown) {
  const s = ledger(input), c = parse(contextSchema, context);
  need(c.principalId === s.ownerId || s.registrars.includes(c.principalId), "AUTHORITY");
  const e = s.entries.find(e => e.requestId === requestId); need(e, "STATE");
  canonicalJson(payload); need(e.clientDigest === protocolDigest("creation-client", parse(creationPayloadSchema, payload)), "CONFLICT");
  return frozen({ fingerprint: e.fingerprint, result: e.result });
}
