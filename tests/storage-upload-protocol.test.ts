import { describe, expect, it, vi } from "vitest";
import { identitySchema, ProtocolError, type Observation, type UploadModel, type UploadCommand } from "@/lib/storage/uploads/schema";
import { observationFailure } from "@/lib/storage/uploads/observation";
import { admission, capabilityHorizon, checkedModel, cleanupInstruction, operationResult, publicationInstruction, reserveUpload, transition, verificationLease } from "@/lib/storage/uploads/state";
import { canonicalJson, checkedReceipt, makeReceipt, protocolDigest } from "@/lib/storage/uploads/receipt";
import { beginCreation, creationFingerprint, creationResult, reserveCreationLedger, retireCreation, settleCreation } from "@/lib/storage/uploads/operation";
import { reverifyCommand, type ReverifyDecision } from "@/lib/storage/uploads/reverify";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { StorageReadError } from "@/lib/storage/supabase/errors";
import type { RegisteredSourceObserver } from "@/lib/storage/supabase/reader";
import { prepareReverifyRead } from "@/lib/storage/supabase/reverify-read";
import { attemptReverify, type ReverifyAttemptResult } from "@/lib/storage/supabase/reverify-attempt";

vi.mock("server-only", () => ({}));

const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const owner = uid(1), worker = uid(2), gc = uid(3), policy = uid(4), stranger = uid(5), objectId = uid(6), assetId = uid(7);
const op1 = uid(10), op2 = uid(11), r1 = uid(12), r2 = uid(13), cleanupId = uid(14), fp = protocolDigest("operation", { input: "sample" });
const identity = { ownerId: owner, assetId, bucket: "unit-final", sha256: "a".repeat(64), sizeBytes: 123, mime: "image/png" as const,
  kind: "image" as const, key: `${owner}/assets/${assetId}/${"a".repeat(64)}.png`, providerVersion: null };
const incoming = { bucket: "unit-incoming", key: `${owner}/incoming/${uid(8)}/nonce`, providerVersion: null };
const media = { width: 2, height: 2, durationMs: null };
const pd = "c".repeat(64);
const ctx = (s: { revision: number }, principalId = worker, now = 1) => ({ principalId, now, expectedRevision: s.revision });
const fresh = () => reserveUpload({ ownerId: owner, objectId, assetId, intentId: uid(8), intentExpiresAt: 100, issueEnvelopeUntil: 10,
  maxIssues: 2, verifiers: [worker], collectors: [gc], policyManagers: [policy], policyEpoch: 1, policyDigest: pd, incoming }, { principalId: owner, now: 0, expectedRevision: 0 });
const apply = (s: UploadModel, a: UploadCommand, principalId = worker, now = 1) => transition(s, a, ctx(s, principalId, now));
const complete = (operationId = op1, kind: "initial" | "reverify" = "initial", authorizationUntil = 90): Extract<UploadCommand, { type: "complete" }> => ({ type: "complete", operationId, kind, authorizationUntil, fingerprint: fp });
const finalSource = { bucket: identity.bucket, key: identity.key, providerVersion: null };
// Observation v1 of the standard synthetic bytes: op1 is the initial read of incoming, every other operation a reverify of the final key.
const observed = (kind: "initial" | "reverify" = "initial", source: typeof incoming = kind === "initial" ? incoming : finalSource): Observation => ({
  v: 1, kind, source, bytes: { sha256: identity.sha256, sizeBytes: identity.sizeBytes }, format: { mime: identity.mime, kind: identity.kind }, media,
  published: kind === "initial" ? { sha256: identity.sha256, sizeBytes: identity.sizeBytes } : null, tools: { verifierVersion: "verifier-v1", toolVersion: "probe-v1" } });
const legacyFinalize = (operationId = op1, receiptId = r1, notAfter = 20): Extract<UploadCommand, { type: "finalize" }> => ({ type: "finalize", operationId, fingerprint: fp,
  expectedFence: 1, receiptId, identity, source: operationId === op1 ? incoming : finalSource, media,
  notAfter, verifierVersion: "verifier-v1", toolVersion: "probe-v1" });
const finalize = (operationId = op1, receiptId = r1, notAfter = 20): Extract<UploadCommand, { type: "finalize" }> =>
  ({ ...legacyFinalize(operationId, receiptId, notAfter), observation: observed(operationId === op1 ? "initial" : "reverify") });
function prepared() {
  let s = apply(fresh(), complete(), owner);
  s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 80 });
  return apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity });
}
const registered = () => apply(prepared(), finalize());
function fails(code: ProtocolError["code"], run: () => unknown) {
  try { run(); throw new Error(`Expected ${code}`); } catch (e) { expect(e).toBeInstanceOf(ProtocolError); expect((e as ProtocolError).code).toBe(code); }
}

describe("B19 canonical bounded input and digest", () => {
  it("uses sorted object keys, preserves array order and separates digest domains", () => {
    expect(canonicalJson({ z: 1, a: { b: false, a: null } })).toBe('{"a":{"a":null,"b":false},"z":1}');
    expect(protocolDigest("x", { b: 2, a: 1 })).toBe(protocolDigest("x", { a: 1, b: 2 }));
    expect(protocolDigest("x", [1, 2])).not.toBe(protocolDigest("x", [2, 1]));
    expect(protocolDigest("x", null)).not.toBe(protocolDigest("y", null));
  });
  it.each([undefined, NaN, Infinity, new Date(0), 1n, () => 1, [undefined], { a: undefined }, new Array(2)])("rejects lossy/non-JSON input %s", value => {
    fails("INPUT", () => canonicalJson(value));
  });
  it("rejects cycles, accessors, symbols, excessive nodes/depth/string and noncanonical keys", () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    for (const value of [cycle, { get a() { throw new Error("must not execute"); } }, { [Symbol("x")]: 1 }, Array(4100).fill(0), "x".repeat(8193)]) fails("INPUT", () => canonicalJson(value));
    let deep: unknown = 1; for (let i = 0; i < 18; i++) deep = [deep]; fails("INPUT", () => canonicalJson(deep));
    const sparse = Object.assign(new Array(1), { other: 1 }); fails("INPUT", () => canonicalJson(sparse));
    expect(identitySchema.safeParse({ ...identity, key: "../bad" }).success).toBe(false);
    expect(identitySchema.safeParse({ ...identity, sizeBytes: 2 * 1024 ** 3 }).success).toBe(true);
    expect(identitySchema.safeParse({ ...identity, sizeBytes: 2 * 1024 ** 3 + 1 }).success).toBe(false);
  });
  it("checks receipt tampering but digest alone is publicly reproducible, not worker attestation", () => {
    const receipt = registered().receipts[0];
    fails("INPUT", () => checkedReceipt({ ...receipt, body: { ...receipt.body, notAfter: 99 } }));
    const recomputed = makeReceipt({ ...receipt.body, notAfter: 99 });
    expect(checkedReceipt(recomputed).body.notAfter).toBe(99); // no signature/authentication claim
    fails("AUTHORITY", () => apply(prepared(), finalize(), stranger));
  });
});

describe("B19 explicit authority, CAS, generations and immutable identity", () => {
  it("does not mutate caller state and freezes detached results", () => {
    const s = fresh(), old = canonicalJson(s), next = apply(s, complete(), owner);
    expect(canonicalJson(s)).toBe(old); expect(next.operations).toHaveLength(1); expect(Object.isFrozen(next.operations[0])).toBe(true);
    fails("INPUT", () => transition(s, { ...complete(), extra: true }, ctx(s, owner)));
    fails("OWNER", () => apply(s, complete(), stranger));
    fails("CONFLICT", () => transition(next, { type: "cancel" }, ctx(s, owner)));
  });
  it("requires confirmed prepublication reservation and rejects forged owner/MIME/tuple/fence", () => {
    const s = prepared();
    fails("RECONCILE", () => publicationInstruction(s, ctx(s), "unknown"));
    fails("RECONCILE", () => publicationInstruction(s, ctx(s), "rolled-back"));
    expect(publicationInstruction(s, ctx(s), "confirmed")).toMatchObject({ overwrite: false, identity });
    fails("STATE", () => publicationInstruction(fresh(), ctx(fresh()), "confirmed"));
    fails("CONFLICT", () => apply(s, { ...finalize(), identity: { ...identity, sizeBytes: 124 } }));
    fails("CONFLICT", () => apply(s, { ...finalize(), source: { ...incoming, key: `${owner}/other/nonce` } }));
    fails("INPUT", () => apply(s, { ...finalize(), media: { ...media, durationMs: 1 } }));
    fails("FENCE", () => apply(s, { ...finalize(), expectedFence: 0 }));
    const bad = structuredClone(s); bad.identity!.ownerId = stranger; fails("INPUT", () => checkedModel(bad));
  });
  it("R1 expiry -> independent reverify -> R2, with terminal-first replay and references unchanged", () => {
    const first = registered(); fails("STATE", () => admission(first, ctx(first, owner, 25)));
    fails("STATE", () => admission(first, ctx(first, owner, 0)));
    let s = apply(first, complete(op2, "reverify", 200), owner, 101); // original intent expired
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 180 }, worker, 101);
    s = apply(s, finalize(op2, r2, 190), worker, 102);
    expect(s.receipts.map(r => r.body.id)).toEqual([r1, r2]); expect(s.currentReceiptId).toBe(r2); expect(s.identity).toEqual(identity);
    expect(admission(s, ctx(s, owner, 103)).receipt.body.id).toBe(r2);
    expect(transition(s, finalize(op2, r2, 190), { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(s);
    expect(transition(s, finalize(), { principalId: worker, now: 999, expectedRevision: 0 }).currentReceiptId).toBe(r2);
    expect(operationResult(s, op1, fp, ctx(s, owner, 999)).receipt?.body.id).toBe(r1);
    fails("CONFLICT", () => apply(s, { ...finalize(op2, r2, 190), notAfter: 191 }, worker, 999));
    fails("CONFLICT", () => apply(s, { ...complete(op2, "reverify", 200), fingerprint: "b".repeat(64) }, owner, 999));
    // References live outside this model: no transition returns any ref mutation.
    expect(s.assetId).toBe(first.assetId); expect(s.objectId).toBe(first.objectId);
  });
  it("reclaim fences an earlier publication; no hard-deadline or lease resurrection", () => {
    let s = prepared();
    fails("FENCE", () => apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 89 }, worker, 2));
    s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 89 }, worker, 81);
    fails("FENCE", () => apply(s, finalize(), worker, 82));
    fails("FENCE", () => publicationInstruction(s, ctx(s, worker, 82), "confirmed"));
    fails("EXPIRED", () => apply(s, { type: "renew", operationId: op1, fingerprint: fp, expectedFence: 2, leaseUntil: 95 }, worker, 90));
    s = apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 2, identity }, worker, 82);
    expect(publicationInstruction(s, ctx(s, worker, 82), "confirmed").fence).toBe(2);
  });
  it("policy-first rejects old finalize/admission, create-first preserves historical result", () => {
    let s = apply(prepared(), { type: "advancePolicy", epoch: 2, policyDigest: pd }, policy);
    fails("STATE", () => apply(s, finalize()));
    const ready = registered(); expect(admission(ready, ctx(ready, owner))).toBeDefined();
    s = apply(ready, { type: "advancePolicy", epoch: 2, policyDigest: pd }, policy);
    fails("STATE", () => admission(s, ctx(s, owner)));
    expect(operationResult(s, op1, fp, ctx(s, owner, 999)).receipt?.body.id).toBe(r1);
    fails("AUTHORITY", () => apply(s, { type: "advancePolicy", epoch: 3, policyDigest: pd }, owner));
  });
  it("new generation and revocation CAS reject stale incomplete reverify", () => {
    let s = apply(registered(), complete(op2, "reverify", 200), owner, 25);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 180 }, worker, 25);
    const revoked = apply(s, { type: "revoke" }, owner, 26);
    fails("STATE", () => apply(revoked, finalize(op2, r2, 190), worker, 27));
    const superseded = apply(s, complete(uid(99), "reverify", 210), policy, 26);
    fails("STATE", () => apply(superseded, finalize(op2, r2, 190), worker, 27));
    fails("EXPIRED", () => apply(s, finalize(op2, r2, 250), worker, 201));
  });
  it("deterministic invalid bytes are terminal, never a receipt or reusable initial intent", () => {
    const rejected = { type: "rejectVerification" as const, operationId: op1, fingerprint: fp, expectedFence: 1, failureCode: "HASH_MISMATCH" as const };
    const failed = apply(prepared(), rejected);
    expect(failed.receipts).toHaveLength(0); expect(failed.closed).toBe(true);
    expect(transition(failed, rejected, { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(failed);
    expect(operationResult(failed, op1, fp, ctx(failed, owner)).failureCode).toBe("HASH_MISMATCH");
    fails("STATE", () => apply(failed, finalize()));
    fails("CONFLICT", () => apply(failed, { ...rejected, failureCode: "MEDIA_INVALID" }, worker, 999));
    fails("STATE", () => apply(failed, complete(uid(88)), owner));
  });
  it("failed reverify revokes new admission while preserving registered original and R1", () => {
    let s = apply(registered(), complete(op2, "reverify", 200), owner, 25);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 180 }, worker, 25);
    s = apply(s, { type: "rejectVerification", operationId: op2, fingerprint: fp, expectedFence: 1, failureCode: "MEDIA_INVALID" }, worker, 26);
    expect(s.identity).toEqual(identity); expect(s.receipts[0].body.id).toBe(r1); expect(s.lifecycle).toBe("registered");
    fails("STATE", () => admission(s, ctx(s, owner, 26)));
    fails("STATE", () => apply(s, { type: "claimCleanup", cleanupId }, gc, 999));
  });
});

describe("B19 publication / orphan GC ordering", () => {
  const cleanup = { type: "claimCleanup" as const, cleanupId };
  it("crash after publish retains identity; GC-first fences finalize and unknown claims forbid delete", () => {
    const durable = prepared(); expect(durable.publication).not.toBeNull();
    let s = apply(durable, { type: "cancel" }, owner);
    s = apply(s, cleanup, gc);
    fails("STATE", () => apply(s, finalize()));
    fails("RECONCILE", () => cleanupInstruction(s, ctx(s, gc), "unknown"));
    expect(cleanupInstruction(s, ctx(s, gc), "confirmed").identity).toEqual(identity);
    const observed = { type: "observeCleanup" as const, cleanupId, expectedBarrierFence: s.barrierFence,
      absent: true, writerQuiescent: false, identityDigest: protocolDigest("object-identity", identity) };
    s = apply(s, observed, gc); expect(s.lifecycle).toBe("cleanup_claimed"); // one404 insufficient
    s = apply(s, { ...observed, writerQuiescent: true }, gc); expect(s.lifecycle).toBe("tombstoned");
    s = apply(s, { ...observed, absent: false, writerQuiescent: false }, gc); // late external publish
    expect(s.lifecycle).toBe("cleanup_claimed"); fails("STATE", () => apply(s, finalize()));
    fails("STATE", () => apply(s, complete(uid(50), "reverify", 200), owner));
    fails("STATE", () => publicationInstruction(s, ctx(s), "confirmed"));
  });
  it("finalize-first/lost response excludes GC forever, even when receipts expire", () => {
    const s = registered();
    expect(transition(s, finalize(), { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(s);
    fails("STATE", () => apply(s, cleanup, gc, 999));
    fails("STATE", () => apply(s, { type: "cancel" }, owner));
    expect(s.receipts).toHaveLength(1);
  });
  it("two GC claim proposals share CAS; committed retry returns same ticket after response loss", () => {
    const s = apply(prepared(), { type: "cancel" }, owner), c = ctx(s, gc);
    const winner = transition(s, cleanup, c);
    fails("CONFLICT", () => transition(winner, { ...cleanup, cleanupId: uid(80) }, c));
    expect(transition(winner, cleanup, c)).toEqual(winner);
    const observe = { type: "observeCleanup" as const, cleanupId, expectedBarrierFence: winner.barrierFence, absent: true,
      writerQuiescent: true, identityDigest: protocolDigest("object-identity", identity) };
    const deleted = apply(winner, observe, gc); expect(apply(deleted, observe, gc).lifecycle).toBe("tombstoned");
    fails("FENCE", () => apply(deleted, { ...observe, expectedBarrierFence: 0 }, gc));
  });
  it("stale snapshot competing finalize and expired-intent cleanup proposals cannot both commit", () => {
    const s = prepared(), finalContext = ctx(s, worker, 2), gcContext = ctx(s, gc, 101);
    const finalized = transition(s, finalize(), finalContext);
    fails("CONFLICT", () => transition(finalized, cleanup, gcContext));
    const collected = transition(s, cleanup, gcContext);
    fails("CONFLICT", () => transition(collected, finalize(), finalContext));
    fails("STATE", () => apply(collected, finalize(), worker, 2));
    expect(finalized.lifecycle).toBe("registered"); expect(collected.lifecycle).toBe("cleanup_claimed");
  });
  it("checks bounded fixed-seed serialized interleavings: never ready after GC claim", () => {
    let accepted = 0, rejected = 0;
    for (let seed = 1; seed <= 64; seed++) {
      let s = prepared(), rng = seed, everClaimed = false;
      for (let n = 0; n < 24; n++) {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        const action = rng % 6, now = n + 2;
        const command: UploadCommand = action === 0 ? finalize() : action === 1 ? { type: "cancel" } : action === 2 ? cleanup :
          action === 3 ? { type: "observeCleanup", cleanupId, expectedBarrierFence: s.barrierFence, absent: !!(rng & 64), writerQuiescent: !!(rng & 128), identityDigest: protocolDigest("object-identity", identity) } :
          action === 4 ? { type: "advancePolicy", epoch: s.policyEpoch + 1, policyDigest: pd } : { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 79 };
        try { s = apply(s, command, action === 1 ? owner : action === 2 || action === 3 ? gc : action === 4 ? policy : worker, now); accepted++; }
        catch (e) { expect(e).toBeInstanceOf(ProtocolError); rejected++; }
        everClaimed ||= s.cleanup !== null;
        if (everClaimed) { expect(s.currentReceiptId).toBeNull(); expect(s.receipts).toHaveLength(0); expect(s.lifecycle).not.toBe("registered"); }
        checkedModel(s);
      }
    }
    expect(accepted).toBeGreaterThan(100); expect(rejected).toBeGreaterThan(100);
  });
});

describe("B19 capability reservations and conservative remint horizon", () => {
  it("derives conservative horizon only from injected acceptance/lifetime/resource/grace bounds", () => {
    expect(capabilityHorizon({ latestAcceptanceAt: 5, tokenLifetime: 20, resourceLifetime: 40, grace: 3 })).toBe(68);
    expect(capabilityHorizon({ latestAcceptanceAt: null, tokenLifetime: 20, resourceLifetime: 40, grace: 3 })).toBeNull();
    fails("INPUT", () => capabilityHorizon({ latestAcceptanceAt: Number.MAX_SAFE_INTEGER, tokenLifetime: 1, resourceLifetime: 0, grace: 0 }));
  });
  it("dispatch requires known reservation commit and one CAS claim per provider invocation", () => {
    const s = apply(fresh(), { type: "reserveCapability", issueId: uid(20), issueUntil: 5, horizon: 40 }, owner);
    fails("RECONCILE", () => apply(s, { type: "dispatchCapability", issueId: uid(20), reservationCommit: "unknown" }, owner));
    const dispatched = apply(s, { type: "dispatchCapability", issueId: uid(20), reservationCommit: "confirmed" }, owner);
    expect(dispatched.issues[0].dispatched).toBe(true);
    fails("STATE", () => apply(dispatched, { type: "dispatchCapability", issueId: uid(20), reservationCommit: "confirmed" }, owner));
    fails("EXPIRED", () => apply(s, { type: "dispatchCapability", issueId: uid(20), reservationCommit: "confirmed" }, owner, 5));
  });
  it("unknown signer response consumes reservation, blocks remint and cleanup until bounded", () => {
    let s = apply(fresh(), { type: "reserveCapability", issueId: uid(20), issueUntil: 5, horizon: null }, owner);
    s = apply(s, { type: "cancel" }, owner);
    fails("RECONCILE", () => apply(s, { type: "claimCleanup", cleanupId }, gc, 999));
    s = apply(s, { type: "reconcileCapability", issueId: uid(20), horizon: 1200, boundEvidence: "b".repeat(64) }, owner, 999);
    fails("RECONCILE", () => apply(s, { type: "claimCleanup", cleanupId }, gc, 1199));
    expect(apply(s, { type: "claimCleanup", cleanupId }, gc, 1200).cleanup).not.toBeNull();
  });
  it("bounds count/envelope and never extends an existing issue ID", () => {
    let s = apply(fresh(), { type: "reserveCapability", issueId: uid(20), issueUntil: 5, horizon: 40 }, owner);
    fails("CONFLICT", () => apply(s, { type: "reserveCapability", issueId: uid(20), issueUntil: 6, horizon: 90 }, owner));
    fails("EXPIRED", () => apply(s, { type: "reserveCapability", issueId: uid(21), issueUntil: 11, horizon: 90 }, owner));
    s = apply(s, { type: "reserveCapability", issueId: uid(21), issueUntil: 6, horizon: 50 }, owner);
    fails("CONFLICT", () => apply(s, { type: "reserveCapability", issueId: uid(22), issueUntil: 6, horizon: 50 }, owner));
    const unknown = apply(fresh(), { type: "reserveCapability", issueId: uid(20), issueUntil: 5, horizon: null }, owner);
    fails("RECONCILE", () => apply(unknown, { type: "reserveCapability", issueId: uid(21), issueUntil: 6, horizon: 50 }, owner));
  });
});

describe("B19 separate creation ledger / original snapshot / retired ID", () => {
  const payload = { menuId: " sample ", title: " title ", inputs: { b: 2, a: 1 }, referenceIds: [assetId] };
  const snapshot = { menu: { version: 1 }, config: {}, policyEpoch: 1 };
  const request = { requestId: uid(40), payload, snapshot, authorizationUntil: 10 };
  const begun = () => beginCreation(reserveCreationLedger(owner, [worker]), request, { principalId: owner, now: 1, expectedRevision: 0 });
  const result = { status: "succeeded" as const, projectId: uid(41) };
  it("canonicalizes only declared trim fields, preserves snapshot/ordered refs and detaches input", () => {
    const original = structuredClone(snapshot), f = creationFingerprint(payload, original);
    expect(f.client.title).toBe("title"); expect(Object.isFrozen(original.menu)).toBe(false);
    expect(creationFingerprint({ ...payload, inputs: { a: 1, b: 2 } }, snapshot).fingerprint).toBe(f.fingerprint);
    expect(creationFingerprint(payload, { ...snapshot, policyEpoch: 2 }).fingerprint).not.toBe(f.fingerprint);
  });
  it("lost COMMIT response resolves same result after expiry/menu/policy changes, different payload conflicts", () => {
    let s = begun(); const fingerprint = s.entries[0].fingerprint;
    s = settleCreation(s, { requestId: request.requestId, fingerprint, result }, ctx(s, worker, 2));
    const retry = beginCreation(s, { ...request, snapshot: { ...snapshot, policyEpoch: 99 }, authorizationUntil: 999 }, { principalId: owner, now: 999, expectedRevision: 0 });
    expect(retry).toEqual(s); expect(retry.entries[0].snapshot?.policyEpoch).toBe(1);
    expect(creationResult(s, request.requestId, payload, ctx(s, owner, 999)).result).toEqual(result);
    expect(settleCreation(s, { requestId: request.requestId, fingerprint, result }, { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(s);
    fails("CONFLICT", () => beginCreation(s, { ...request, payload: { ...payload, title: "changed" } }, ctx(s, owner, 999)));
    fails("CONFLICT", () => settleCreation(s, { requestId: request.requestId, fingerprint, result: { ...result, projectId: uid(42) } }, ctx(s, worker, 999)));
  });
  it("retains retired ID/fingerprint permanently; never interprets TTL as permission to create twice", () => {
    const initial = begun(); fails("EXPIRED", () => retireCreation(initial, request.requestId, ctx(initial, worker, 2)));
    const retired = retireCreation(initial, request.requestId, ctx(initial, worker, 10));
    expect(beginCreation(retired, request, ctx(retired, owner, 999))).toEqual(retired);
    expect(creationResult(retired, request.requestId, payload, ctx(retired, owner, 999)).result).toEqual({ status: "retired" });
    fails("CONFLICT", () => settleCreation(retired, { requestId: request.requestId, fingerprint: retired.entries[0].fingerprint, result }, ctx(retired, worker, 999)));
    fails("AUTHORITY", () => creationResult(retired, request.requestId, payload, ctx(retired, stranger)));
    fails("EXPIRED", () => settleCreation(initial, { requestId: request.requestId, fingerprint: initial.entries[0].fingerprint, result }, ctx(initial, worker, 10)));
  });
});

describe("B19-FIX internally consistent snapshot boundaries", () => {
  it("rejects revocation-boolean damage against failed and manual revocation history", () => {
    let s = apply(registered(), complete(op2, "reverify", 90), owner, 2);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 2);
    s = apply(s, { type: "rejectVerification", operationId: op2, fingerprint: fp, expectedFence: 1, failureCode: "MEDIA_INVALID" }, worker, 3);
    const bad = structuredClone(s); bad.revoked = false;
    fails("INPUT", () => admission(bad, ctx(bad, owner, 4)));
    const manual = structuredClone(apply(registered(), { type: "revoke" }, owner, 2)); manual.revoked = false;
    fails("INPUT", () => checkedModel(manual));
  });
  it("binds historical issuer to committed claimant, not today's verifier allowlist", () => {
    const s = structuredClone(registered()); s.verifiers = [stranger];
    expect(admission(s, ctx(s, owner, 2)).receipt.body.verifierId).toBe(worker);
    const bad = structuredClone(s); bad.receipts[0] = makeReceipt({ ...bad.receipts[0].body, verifierId: stranger });
    fails("INPUT", () => checkedModel(bad));
    const lostClaim = structuredClone(s); lostClaim.operations[0].claimVerifiers = [stranger];
    fails("INPUT", () => checkedModel(lostClaim));
  });
  it("binds verifiedAt/completedAt to the recorded claim time and authority/lease", () => {
    const bad = structuredClone(registered());
    bad.receipts[0] = makeReceipt({ ...bad.receipts[0].body, verifiedAt: 19 });
    bad.operations[0].completedAt = 19; bad.operations[0].authorizationUntil = 10; bad.operations[0].leaseUntil = 9;
    fails("INPUT", () => admission(bad, ctx(bad, owner, 19)));
    const early = structuredClone(registered()); early.operations[0].claimedAt = 2;
    fails("INPUT", () => checkedModel(early));
    const pending = prepared(); fails("EXPIRED", () => publicationInstruction(pending, ctx(pending, worker, 0), "confirmed"));
  });
  it("rejects absent reservation, overlong lease, registered+closed and revision-history holes", () => {
    const missing = structuredClone(prepared()); missing.publication = null; fails("INPUT", () => checkedModel(missing));
    const lease = structuredClone(prepared()); lease.operations[0].leaseUntil = 999; fails("INPUT", () => checkedModel(lease));
    const closed = structuredClone(registered()); closed.closed = true; fails("INPUT", () => checkedModel(closed));
    const hole = structuredClone(registered()); hole.stateRevision = 2; fails("INPUT", () => checkedModel(hole));
  });
  it("successful R2 clears earlier revocation using a new committed state revision and keeps history", () => {
    let s = apply(registered(), { type: "revoke" }, owner, 2);
    s = apply(s, complete(op2, "reverify", 90), owner, 3);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 3);
    s = apply(s, finalize(op2, r2, 99), worker, 4);
    expect(s.revocations).toHaveLength(1); expect(s.receipts).toHaveLength(2); expect(s.revoked).toBe(false);
    expect(admission(s, ctx(s, owner, 5)).receipt.body.id).toBe(r2);
  });
  const payload = { menuId: "sample", title: "title", inputs: { a: 1 }, referenceIds: [assetId] };
  const request = { requestId: uid(140), payload, snapshot: { menu: { version: 1 }, config: {}, policyEpoch: 1 }, authorizationUntil: 10 };
  const begin = () => beginCreation(reserveCreationLedger(owner, [worker]), request, { principalId: owner, now: 1, expectedRevision: 0 });
  it("revalidates original snapshot/composed fingerprints in pending, terminal and retired ledgers", () => {
    const pending = begin(), result = { status: "succeeded" as const, projectId: uid(141) };
    const done = settleCreation(pending, { requestId: request.requestId, fingerprint: pending.entries[0].fingerprint, result }, ctx(pending, worker, 2));
    for (const original of [pending, done]) {
      const bad = structuredClone(original); bad.entries[0].snapshot!.policyEpoch = 2;
      fails("INPUT", () => creationResult(bad, request.requestId, payload, ctx(bad, owner, 3)));
      const digest = structuredClone(original); digest.entries[0].snapshotDigest = "f".repeat(64);
      fails("INPUT", () => creationResult(digest, request.requestId, payload, ctx(digest, owner, 3)));
    }
    const retired = retireCreation(done, request.requestId, ctx(done, worker, 20));
    expect(creationResult(retired, request.requestId, payload, ctx(retired, owner, 99)).result?.status).toBe("retired");
    const noProof = structuredClone(retired); noProof.entries[0].terminal = null;
    fails("INPUT", () => creationResult(noProof, request.requestId, payload, ctx(noProof, owner, 99)));
    const changedClientDigest = structuredClone(retired); changedClientDigest.entries[0].clientDigest = "f".repeat(64);
    fails("INPUT", () => beginCreation(changedClientDigest, request, ctx(changedClientDigest, owner, 99)));
  });
  it("rejects terminal result damage and version downgrade, retaining original snapshots on exact retry", () => {
    const pending = begin(), result = { status: "succeeded" as const, projectId: uid(141) };
    const done = settleCreation(pending, { requestId: request.requestId, fingerprint: pending.entries[0].fingerprint, result }, ctx(pending, worker, 2));
    const bad = structuredClone(done); bad.entries[0].result = { ...result, projectId: uid(142) };
    fails("INPUT", () => creationResult(bad, request.requestId, payload, ctx(bad, owner)));
    const version = { ...done, entries: done.entries.map(e => ({ ...e, fingerprintVersion: 1 })) };
    fails("INPUT", () => creationResult(version, request.requestId, payload, ctx(done, owner)));
    expect(beginCreation(done, { ...request, snapshot: { ...request.snapshot, policyEpoch: 99 } }, ctx(done, owner, 99))).toEqual(done);
  });
  it("preflights descriptors on model, nested receipt, context and creation input before any getter read", () => {
    let reads = 0;
    const getter = { get() { reads++; throw new Error("private-getter-detail"); }, enumerable: true };
    const bad = structuredClone(fresh()); Object.defineProperty(bad, "ownerId", getter);
    fails("INPUT", () => checkedModel(bad));
    const receipt = structuredClone(registered().receipts[0]); Object.defineProperty(receipt.body.identity, "key", getter);
    fails("INPUT", () => checkedReceipt(receipt));
    const context = { ...ctx(fresh(), owner) }; Object.defineProperty(context, "principalId", getter);
    fails("INPUT", () => transition(fresh(), complete(), context));
    const badRequest = structuredClone(request); Object.defineProperty(badRequest.snapshot.menu, "version", getter);
    fails("INPUT", () => beginCreation(reserveCreationLedger(owner, [worker]), badRequest, ctx({ revision: 0 }, owner)));
    expect(reads).toBe(0);
  });
  it("sanitizes foreign inspection errors; does not claim Proxy traps cannot run", () => {
    let traps = 0;
    const proxy = new Proxy({}, { getPrototypeOf() { traps++; throw new Error("private-proxy-detail"); } });
    for (const read of [() => checkedModel(proxy), () => canonicalJson(proxy)]) {
      try { read(); throw new Error("Expected INPUT"); } catch (e) { expect(e).toBeInstanceOf(ProtocolError); expect((e as Error).message).toBe("INPUT"); }
    }
    expect(traps).toBe(2);
  });
});

function reachableMatrix() {
  const pending = apply(fresh(), complete(), owner, 1);
  const leased = apply(pending, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 2);
  const publication = apply(leased, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity }, worker, 3);
  const failed = apply(publication, { type: "rejectVerification", operationId: op1, fingerprint: fp, expectedFence: 1, failureCode: "MEDIA_INVALID" }, worker, 4);
  const canceled = apply(publication, { type: "cancel" }, owner, 4);
  const emptyCanceled = apply(fresh(), { type: "cancel" }, owner, 1);
  const cleanup = apply(canceled, { type: "claimCleanup", cleanupId }, gc, 5);
  const unboundCleanup = apply(emptyCanceled, { type: "claimCleanup", cleanupId }, gc, 2);
  const observation = { type: "observeCleanup" as const, cleanupId, expectedBarrierFence: 1, absent: true, writerQuiescent: true, identityDigest: protocolDigest("object-identity", identity) };
  const tombstone = apply(cleanup, observation, gc, 6);
  const late = apply(tombstone, { ...observation, absent: false, writerQuiescent: false }, gc, 7);
  const ready = registered(), revoked = apply(ready, { type: "revoke" }, owner, 2);
  const reverify = apply(ready, complete(op2, "reverify", 90), owner, 2);
  const reverifyLease = apply(reverify, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 3);
  const reverifyFailure = apply(reverifyLease, { type: "rejectVerification", operationId: op2, fingerprint: fp, expectedFence: 1, failureCode: "HASH_MISMATCH" }, worker, 4);
  const reverifySuccess = apply(reverifyLease, finalize(op2, r2, 90), worker, 4);
  const supersede = (s: UploadModel) => apply(s, complete(uid(210), "reverify", 90), owner, 5);
  const reclaim = apply(publication, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 89 }, worker, 81);
  return [
    ["fresh", fresh()], ["initial unclaimed", pending], ["initial leased", leased], ["publication", publication], ["initial failed", failed],
    ["initial canceled unclaimed", apply(pending, { type: "cancel" }, owner, 2)], ["initial canceled claimed", canceled], ["empty canceled", emptyCanceled],
    ["cleanup bound", cleanup], ["cleanup unbound", unboundCleanup], ["tombstone", tombstone], ["late write", late], ["registered", ready], ["revoked", revoked],
    ["reverify unclaimed", reverify], ["reverify leased", reverifyLease], ["reverify failed", reverifyFailure], ["reverify succeeded", reverifySuccess],
    ["superseded unclaimed", supersede(reverify)], ["superseded claimed", supersede(reverifyLease)], ["reclaimed old publication", reclaim],
  ] as const;
}

describe("B19-FIX2 reachable-state and mutation matrix", () => {
  it("keeps every actual reachable lifecycle/status positive control and accepts higher unrecorded CAS counters", () => {
    const states = reachableMatrix(); expect(states).toHaveLength(21);
    for (const [, s] of states) {
      expect(checkedModel(s)).toEqual(s);
      const higher = structuredClone(s); higher.revision++;
      expect(checkedModel(higher).revision).toBe(higher.revision); // lower bound, not invented exact full-history count
      const changedPolicy = structuredClone(s); changedPolicy.verifiers = [stranger];
      expect(checkedModel(changedPolicy).verifiers).toEqual([stranger]); // current set != historical authority
    }
  });
  it("rejects single-field lifecycle/closed/state/generation/current corruption across reachable snapshots", () => {
    let attempts = 0;
    for (const [, s] of reachableMatrix()) {
      const changes: Array<(v: UploadModel) => void> = [v => { v.closed = !v.closed; }, v => { v.stateRevision++; }, v => { v.activeGeneration++; },
        v => { v.currentReceiptId = uid(999); }, v => { v.lifecycle = v.lifecycle === "registered" ? "reserved" : "tombstoned"; }];
      if (s.lifecycle === "tombstoned") changes[4] = v => { v.lifecycle = "cleanup_claimed"; };
      if (s.revision > 0) changes.push(v => { v.revision = 0; });
      if (s.identity) changes.push(v => { v.publication = null; });
      if (s.revocations.length) changes.push(v => { v.revocations = []; });
      for (const change of changes) { const bad = structuredClone(s); change(bad); fails("INPUT", () => checkedModel(bad)); attempts++; }
    }
    expect(attempts).toBe(142);
  });
  it("checks all status substitutions and claim/completion/revision boundaries for every retained operation", () => {
    let rejected = 0, unchanged = 0;
    for (const [, s] of reachableMatrix()) for (let index = 0; index < s.operations.length; index++) {
      const o = s.operations[index];
      for (const status of ["pending", "succeeded", "failed", "canceled"] as const) {
        const bad = structuredClone(s); bad.operations[index].status = status;
        if (status === o.status) { checkedModel(bad); unchanged++; } else { fails("INPUT", () => checkedModel(bad)); rejected++; }
      }
      const changes: Array<(v: UploadModel["operations"][number]) => void> = [v => { v.expectedStateRevision = s.stateRevision + 1; },
        v => { v.completedStateRevision = s.stateRevision + 1; }, v => { v.createdAt = v.authorizationUntil; }, v => { v.fence = Number.MAX_SAFE_INTEGER; }];
      if (o.leaseUntil !== null) changes.push(v => { v.workerId = null; }, v => { v.leaseUntil = v.authorizationUntil + 1; });
      if (o.completedAt !== null) changes.push(v => { v.completedAt = v.createdAt - 1; });
      if (o.status === "canceled" && o.canceledClaim) changes.push(v => { v.canceledClaim = null; }, v => {
        const h = v.canceledClaim!; v.workerId = h.workerId; v.leaseUntil = h.leaseUntil; v.claimedAt = h.claimedAt; v.claimVerifiers = [...h.claimVerifiers];
      });
      for (const change of changes) { const bad = structuredClone(s); change(bad.operations[index]); fails("INPUT", () => checkedModel(bad)); rejected++; }
    }
    expect(rejected).toBe(240); expect(unchanged).toBe(26);
  });
  it("preserves canceled historical claim with no live slot and forbids reopening an empty canceled intent", () => {
    const before = prepared(), canceled = apply(before, { type: "cancel" }, owner, 2), o = canceled.operations[0];
    expect(o.workerId).toBeNull(); expect(o.claimedAt).toBeNull(); expect(o.leaseUntil).toBeNull(); expect(o.claimVerifiers).toEqual([]);
    expect(o.canceledClaim).toMatchObject({ workerId: worker, fence: 1, claimedAt: 1, leaseUntil: 80 });
    expect(o.fence).toBe(o.canceledClaim!.fence + 1);
    expect(operationResult(canceled, op1, fp, ctx(canceled, owner, 999)).status).toBe("canceled");
    const empty = structuredClone(apply(fresh(), { type: "cancel" }, owner)); empty.closed = false;
    fails("INPUT", () => checkedModel(empty));
    const futureRevision = structuredClone(canceled); futureRevision.operations[0].completedStateRevision = 999;
    fails("INPUT", () => checkedModel(futureRevision));
  });
  it("requires recorded cleanup observation for completion and monotonically ordered observation time", () => {
    let s = apply(apply(prepared(), { type: "cancel" }, owner, 2), { type: "claimCleanup", cleanupId }, gc, 3);
    const noObservation = structuredClone(s); noObservation.lifecycle = "tombstoned"; fails("INPUT", () => checkedModel(noObservation));
    const action = { type: "observeCleanup" as const, cleanupId, expectedBarrierFence: 1, absent: true, writerQuiescent: true, identityDigest: protocolDigest("object-identity", identity) };
    fails("EXPIRED", () => apply(s, action, gc, 2));
    s = apply(s, action, gc, 4); expect(s.cleanup!.observation?.at).toBe(4);
    const detached = structuredClone(s); detached.cleanup!.observation = null; fails("INPUT", () => checkedModel(detached));
    fails("EXPIRED", () => apply(s, { ...action, absent: false }, gc, 3));
  });
  it("retains exact creation revision counts for its fully represented begin/settle/retire history", () => {
    const request = { requestId: uid(230), payload: { menuId: "unit", title: "title", inputs: {}, referenceIds: [] }, snapshot: { menu: {}, config: {}, policyEpoch: 1 }, authorizationUntil: 10 };
    let s = beginCreation(reserveCreationLedger(owner, [worker]), request, ctx({ revision: 0 }, owner));
    const bad = structuredClone(s); bad.revision = 0; fails("INPUT", () => creationResult(bad, request.requestId, request.payload, ctx(bad, owner)));
    s = settleCreation(s, { requestId: request.requestId, fingerprint: s.entries[0].fingerprint, result: { status: "canceled" } }, ctx(s, worker, 2));
    s = retireCreation(s, request.requestId, ctx(s, worker, 3)); expect(s.revision).toBe(3);
    expect(beginCreation(s, request, ctx(s, owner, 999))).toEqual(s);
  });
});

describe("B19-FIX3 same-event and historical publication time binding", () => {
  function shortLease() {
    let s = apply(fresh(), complete(), owner, 1);
    s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 5 }, worker, 1);
    return apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity }, worker, 2);
  }
  it("binds first initial cancel closure time/revision/principal; repeat cancel and later GC preserve it", () => {
    const canceled = apply(prepared(), { type: "cancel" }, owner, 2);
    for (const change of [(s: UploadModel) => { s.closure!.at = 9; }, (s: UploadModel) => { s.closure!.revision--; },
      (s: UploadModel) => { s.closure!.principalId = stranger; }]) {
      const bad = structuredClone(canceled); change(bad); fails("INPUT", () => checkedModel(bad));
    }
    const repeated = apply(canceled, { type: "cancel" }, owner, 10);
    expect(repeated.closure).toEqual(canceled.closure); expect(repeated.operations[0].completedAt).toBe(2);
    const collected = apply(repeated, { type: "claimCleanup", cleanupId }, gc, 11);
    expect(collected.closure).toEqual(canceled.closure); expect(collected.cleanup!.claimedAt).toBe(11);
    expect(collected.operations[0].completedRevision).toBe(canceled.closure!.revision);
    expect(collected.cleanup!.claimedRevision).toBeGreaterThan(canceled.closure!.revision);
    const early = apply(fresh(), { type: "cancel" }, owner, 9); expect(early.operations).toEqual([]); expect(checkedModel(early).closure!.at).toBe(9);
  });
  it("binds failure/direct-GC first closure to the same completion while preserving prior closures", () => {
    const failed = apply(prepared(), { type: "rejectVerification", operationId: op1, fingerprint: fp, expectedFence: 1, failureCode: "INVALID_BYTES" }, worker, 2);
    for (const field of ["at", "revision"] as const) {
      const bad = structuredClone(failed); bad.closure![field]++; fails("INPUT", () => checkedModel(bad));
    }
    const gcFirst = apply(prepared(), { type: "claimCleanup", cleanupId }, gc, 100);
    expect(gcFirst.closure!.reason).toBe("cleanup"); expect(gcFirst.operations[0].completedAt).toBe(100);
    expect(gcFirst.operations[0].completedRevision).toBe(gcFirst.cleanup!.claimedRevision);
    const bad = structuredClone(gcFirst); bad.closure!.at = 99; fails("INPUT", () => checkedModel(bad));
    const old = apply(failed, { type: "claimCleanup", cleanupId }, gc, 3); expect(old.closure).toEqual(failed.closure);
    const forged = structuredClone(old); forged.cleanup!.claimedRevision = old.closure!.revision; fails("INPUT", () => checkedModel(forged));
  });
  it("allows cancel after lease expiry9 but rejects same-fence publication reservation6 outside historical lease5", () => {
    const canceled = apply(shortLease(), { type: "cancel" }, owner, 9);
    expect(checkedModel(canceled).operations[0].completedAt).toBe(9);
    expect(canceled.publication!.claim.leaseUntil).toBe(5);
    const bad = structuredClone(canceled); bad.publication!.reservedAt = 6; fails("INPUT", () => checkedModel(bad));
    expect(operationResult(canceled, op1, fp, ctx(canceled, owner, 999)).status).toBe("canceled");
  });
  it("preserves old-fence publication across different-worker reclaim and same-fence renewals", () => {
    const original = shortLease(), changed = structuredClone(original); changed.verifiers = [stranger];
    let reclaimed = apply(changed, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 20 }, stranger, 6);
    reclaimed = apply(reclaimed, { type: "cancel" }, owner, 21);
    expect(reclaimed.publication!.claim.workerId).toBe(worker); expect(reclaimed.operations[0].canceledClaim!.workerId).toBe(stranger);
    expect(checkedModel(reclaimed).publication!.reservedAt).toBe(2);
    const bad = structuredClone(reclaimed); bad.publication!.reservedAt = 6; fails("INPUT", () => checkedModel(bad));
    let renewed = apply(original, { type: "renew", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 8 }, worker, 3);
    const oldReservation = apply(renewed, { type: "cancel" }, owner, 9);
    expect(oldReservation.publication!.claim.leaseUntil).toBe(5); expect(oldReservation.operations[0].canceledClaim!.leaseUntil).toBe(8);
    checkedModel(oldReservation);
    renewed = apply(renewed, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity }, worker, 6);
    expect(checkedModel(apply(renewed, { type: "cancel" }, owner, 9)).publication!.reservedAt).toBe(6);
  });
  it("checks duplicated publication claim fence/worker/policy/window fields without today's allowlist", () => {
    const original = apply(shortLease(), { type: "cancel" }, owner, 9);
    const changes: Array<(s: UploadModel) => void> = [s => { s.publication!.claim.fence++; }, s => { s.publication!.claim.workerId = stranger; },
      s => { s.publication!.claim.policyDigest = "f".repeat(64); }, s => { s.publication!.claim.authorizationUntil++; },
      s => { s.publication!.claim.claimedAt = 3; }, s => { s.publication!.claim.leaseUntil = 6; }];
    for (const change of changes) { const bad = structuredClone(original); change(bad); fails("INPUT", () => checkedModel(bad)); }
    const removed = structuredClone(original); removed.verifiers = [stranger];
    expect(checkedModel(removed).publication!.claim.claimVerifiers).toEqual([worker]);
    expect(Object.isFrozen(original.publication!.claim.claimVerifiers)).toBe(true);
    let r = apply(registered(), complete(op2, "reverify", 90), owner, 2);
    r = apply(r, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 2);
    r = apply(r, finalize(op2, r2, 90), worker, 3);
    const sameCommit = structuredClone(r); sameCommit.operations[1].completedRevision = sameCommit.operations[0].completedRevision;
    fails("INPUT", () => checkedModel(sameCommit));
  });
});

describe("B19-FIX4 retained causal prefixes and reclaim ordering", () => {
  it("derives completion lower bounds from actual reserve/claim/publish/terminal events, including shared supersession", () => {
    const initial = registered(), bad = structuredClone(initial); bad.operations[0].completedRevision = 1;
    fails("INPUT", () => checkedModel(bad));
    const larger = structuredClone(initial); larger.revision = Number.MAX_SAFE_INTEGER; checkedModel(larger);
    for (const withClaim of [false, true]) {
      let s = apply(initial, complete(op2, "reverify", 90), owner, 2);
      if (withClaim) s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 2);
      s = apply(s, complete(uid(310), "reverify", 90), owner, 3);
      const predecessor = s.operations.find(o => o.id === op2)!;
      s = apply(s, { type: "claim", operationId: uid(310), fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 3);
      s = apply(s, { ...finalize(uid(310), uid(311), 90) }, worker, 4);
      expect(s.operations[2].completedRevision).toBe(predecessor.completedRevision! + 2); // reservation shared with predecessor cancel
      checkedModel(s);
      const early = structuredClone(s); early.operations[2].completedRevision!--;
      fails("INPUT", () => checkedModel(early));
    }
  });
  function oldPublication() {
    let s = apply(fresh(), complete(), owner, 1);
    s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 5 }, worker, 1);
    return apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity }, worker, 2);
  }
  it("requires older lease end before later retained current or canceled claim while allowing equality/different workers", () => {
    const before = structuredClone(oldPublication()); before.verifiers = [stranger];
    const newer = apply(before, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 20 }, stranger, 6);
    for (const s of [newer, apply(newer, { type: "cancel" }, owner, 21)]) {
      checkedModel(s);
      const overlap = structuredClone(s); overlap.publication!.claim.leaseUntil = 7;
      fails("INPUT", () => checkedModel(overlap));
      const boundary = structuredClone(s); boundary.publication!.claim.leaseUntil = 6;
      expect(checkedModel(boundary).publication!.claim.workerId).toBe(worker); // expiry==reclaim is allowed
    }
    let renewed = apply(oldPublication(), { type: "renew", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 8 }, worker, 3);
    renewed = apply(renewed, { type: "cancel" }, owner, 9);
    expect(checkedModel(renewed).publication!.claim.leaseUntil).toBe(5); // same fence renewal is not a new claim
  });
  it("counts repeated claims before completion but excludes later policy and reconciliation from past completion prefixes", () => {
    let s = apply(oldPublication(), { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 1, leaseUntil: 20 }, worker, 6);
    s = apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 2, identity }, worker, 7);
    s = apply(s, { ...finalize(), expectedFence: 2 }, worker, 8);
    const early = structuredClone(s); early.operations[0].completedRevision = 4;
    fails("INPUT", () => checkedModel(early));
    const retainedMinimum = structuredClone(s); retainedMinimum.operations[0].completedRevision = 5;
    checkedModel(retainedMinimum); // old replaced publication is not a retained extra event; no exact full-log count claim
    const completion = s.operations[0].completedRevision;
    s = apply(s, { type: "advancePolicy", epoch: 2, policyDigest: pd }, policy, 9);
    s = apply(s, { type: "advancePolicy", epoch: 3, policyDigest: pd }, policy, 10);
    expect(checkedModel(s).operations[0].completedRevision).toBe(completion);
    let unknown = apply(fresh(), { type: "reserveCapability", issueId: uid(320), issueUntil: 5, horizon: null }, owner, 1);
    unknown = apply(unknown, complete(), owner, 1);
    unknown = apply(unknown, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 80 }, worker, 1);
    unknown = apply(unknown, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity }, worker, 1);
    unknown = apply(unknown, { type: "rejectVerification", operationId: op1, fingerprint: fp, expectedFence: 1, failureCode: "INVALID_BYTES" }, worker, 2);
    const failureRevision = unknown.operations[0].completedRevision;
    unknown = apply(unknown, { type: "reconcileCapability", issueId: uid(320), horizon: 100, boundEvidence: identity.sha256 }, owner, 3);
    expect(checkedModel(unknown).operations[0].completedRevision).toBe(failureRevision); // reconciliation occurred after this failure
  });
  it("bounds cleanup claim by pre-GC facts, excluding post-claim observations and keeping old closure", () => {
    let s = apply(fresh(), { type: "reserveCapability", issueId: uid(321), issueUntil: 5, horizon: null }, owner, 1);
    s = apply(s, { type: "cancel" }, owner, 2);
    const first = s.closure;
    s = apply(s, { type: "reconcileCapability", issueId: uid(321), horizon: 100, boundEvidence: identity.sha256 }, owner, 3);
    s = apply(s, { type: "claimCleanup", cleanupId }, gc, 100);
    expect(s.cleanup!.claimedRevision).toBe(4);
    const tooEarly = structuredClone(s); tooEarly.cleanup!.claimedRevision = 3;
    fails("INPUT", () => checkedModel(tooEarly));
    const action = { type: "observeCleanup" as const, cleanupId, expectedBarrierFence: 1, absent: true, writerQuiescent: true, identityDigest: protocolDigest("object-identity", null) };
    s = apply(s, action, gc, 101); s = apply(s, action, gc, 102);
    expect(checkedModel(s).cleanup!.claimedRevision).toBe(4); expect(s.closure).toEqual(first);
  });
});

describe("P2 verifier observation v1 before receipt issuance", () => {
  const reverifyLeased = () => {
    const s = apply(registered(), complete(op2, "reverify", 200), owner, 2);
    return apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 150 }, worker, 2);
  };
  const reject = (operationId: string, failureCode: Extract<UploadCommand, { type: "rejectVerification" }>["failureCode"], observation?: Observation) =>
    ({ type: "rejectVerification" as const, operationId, fingerprint: fp, expectedFence: 1, failureCode, ...(observation ? { observation } : {}) });
  const change = (base: Observation, patch: Partial<Observation>): Observation => ({ ...base, ...patch });

  it("issues initial and reverify receipts only from a matching observation; receipt body and digest contract are unchanged", () => {
    const s = registered();
    expect(s.receipts).toHaveLength(1);
    const receipt = s.receipts[0];
    expect(Object.keys(receipt.body).sort()).toEqual(["fence", "generation", "id", "identity", "media", "notAfter", "objectId", "operationId", "policyDigest",
      "policyEpoch", "source", "toolVersion", "verifiedAt", "verifierId", "verifierVersion"]);
    expect(checkedReceipt(receipt)).toEqual(makeReceipt(receipt.body));
    const again = apply(reverifyLeased(), finalize(op2, r2, 190), worker, 3);
    expect(again.receipts.map(r => r.body.generation)).toEqual([1, 2]);
    expect(again.receipts[1].body.source).toEqual(finalSource);
    expect(again.currentReceiptId).toBe(r2);
    expect(again.receipts[0]).toEqual(receipt);
  });

  it("refuses a new receipt without an observation, before any state change", () => {
    fails("OBSERVATION", () => apply(prepared(), legacyFinalize()));
    fails("OBSERVATION", () => apply(reverifyLeased(), legacyFinalize(op2, r2, 190), worker, 3));
  });

  const initialMismatches: [string, Observation, ReturnType<typeof observationFailure>][] = [
    ["format undetected", change(observed(), { format: null }), "INVALID_BYTES"],
    ["size", change(observed(), { bytes: { sha256: identity.sha256, sizeBytes: 124 } }), "SIZE_MISMATCH"],
    ["hash", change(observed(), { bytes: { sha256: "d".repeat(64), sizeBytes: 123 } }), "HASH_MISMATCH"],
    ["mime", change(observed(), { format: { mime: "image/jpeg", kind: "image" } }), "MIME_MISMATCH"],
    ["kind", change(observed(), { format: { mime: "image/png", kind: "video" } }), "MIME_MISMATCH"],
    ["undecodable", change(observed(), { media: null }), "MEDIA_INVALID"],
    ["image with duration", change(observed(), { media: { ...media, durationMs: 5 } }), "MEDIA_INVALID"],
    ["published size", change(observed(), { published: { sha256: identity.sha256, sizeBytes: 122 } }), "SIZE_MISMATCH"],
    ["published hash", change(observed(), { published: { sha256: "e".repeat(64), sizeBytes: 123 } }), "HASH_MISMATCH"],
  ];
  it.each(initialMismatches)("refuses initial issuance on %s mismatch and names the failure code", (_name, observation, code) => {
    expect(observationFailure(identity, null, observation)).toBe(code);
    fails("OBSERVATION", () => apply(prepared(), { ...finalize(), observation }));
  });

  it("refuses issuance when the observation does not describe this read or this receipt", () => {
    const base = observed();
    for (const observation of [
      change(base, { kind: "reverify" }), change(base, { source: finalSource }), change(base, { published: null }),
      change(base, { tools: { verifierVersion: "verifier-v2", toolVersion: "probe-v1" } }), change(base, { media: { width: 3, height: 2, durationMs: null } }),
    ]) fails("OBSERVATION", () => apply(prepared(), { ...finalize(), observation }));
    const reverify = reverifyLeased();
    for (const observation of [observed("initial", finalSource), change(observed("reverify"), { source: incoming }),
      change(observed("reverify"), { published: { sha256: identity.sha256, sizeBytes: 123 } }), change(observed("reverify"), { bytes: { sha256: "d".repeat(64), sizeBytes: 123 } }),
      change(observed("reverify"), { media: { width: 2, height: 3, durationMs: null } })])
      fails("OBSERVATION", () => apply(reverify, { ...finalize(op2, r2, 190), observation }, worker, 3));
    expect(observationFailure(identity, media, change(observed("reverify"), { media: { width: 2, height: 3, durationMs: null } }))).toBe("MEDIA_INVALID");
  });

  it("keeps the fixed failure precedence", () => {
    const all = change(observed(), { bytes: { sha256: "d".repeat(64), sizeBytes: 9 }, format: { mime: "image/jpeg", kind: "image" }, media: null,
      published: { sha256: "e".repeat(64), sizeBytes: 8 } });
    expect(observationFailure(identity, null, change(all, { format: null }))).toBe("INVALID_BYTES");
    expect(observationFailure(identity, null, all)).toBe("SIZE_MISMATCH");
    expect(observationFailure(identity, null, change(all, { bytes: { sha256: "d".repeat(64), sizeBytes: 123 } }))).toBe("HASH_MISMATCH");
    expect(observationFailure(identity, null, change(all, { bytes: { sha256: identity.sha256, sizeBytes: 123 } }))).toBe("MIME_MISMATCH");
    expect(observationFailure(identity, null, observed())).toBeNull();
    expect(observationFailure(null, null, change(observed(), { format: { mime: "image/gif", kind: "image" } }))).toBe("MIME_MISMATCH");
    expect(observationFailure(null, null, change(observed(), { format: { mime: "image/png", kind: "other" } }))).toBe("MIME_MISMATCH");
    expect(observationFailure(null, null, observed())).toBeNull();
  });

  it("preserves exact replay and reading of a terminal finalized before observations existed", () => {
    // The terminal digest is still the pre-observation formula over the persisted receipt fields, byte for byte.
    const legacy = registered();
    expect(legacy.operations[0].terminalPayloadDigest).toBe(protocolDigest("finalize-request", legacyFinalize()));
    checkedModel(structuredClone(legacy));
    expect(transition(legacy, legacyFinalize(), { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(legacy);
    expect(transition(legacy, finalize(), { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(legacy);
    fails("CONFLICT", () => transition(legacy, { ...legacyFinalize(), notAfter: 21 }, { principalId: worker, now: 999, expectedRevision: 0 }));
    expect(checkedReceipt(legacy.receipts[0]).body.id).toBe(r1);
    expect(admission(legacy, { principalId: owner, now: 10, expectedRevision: legacy.revision }).receipt.body.id).toBe(r1);
    // Replay never issues: a replay carrying a different observation still returns only the stored terminal.
    const replay = transition(legacy, { ...finalize(), observation: change(observed(), { bytes: { sha256: "d".repeat(64), sizeBytes: 1 } }) },
      { principalId: worker, now: 999, expectedRevision: 0 });
    expect(replay).toEqual(legacy);
    expect(replay.receipts).toHaveLength(1);
    // A legacy terminal can still be the base of a new observed reverify.
    let s = apply(legacy, complete(op2, "reverify", 200), owner, 2);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 150 }, worker, 2);
    expect(apply(s, finalize(op2, r2, 190), worker, 3).receipts.map(r => r.body.generation)).toEqual([1, 2]);
  });

  it("accepts a rejection whose observation names exactly the first mismatch, and never issues a receipt", () => {
    const hash = change(observed("reverify"), { bytes: { sha256: "d".repeat(64), sizeBytes: 123 } });
    fails("OBSERVATION", () => apply(reverifyLeased(), reject(op2, "SIZE_MISMATCH", hash), worker, 3));
    fails("OBSERVATION", () => apply(reverifyLeased(), reject(op2, "HASH_MISMATCH", observed("reverify")), worker, 3));
    fails("OBSERVATION", () => apply(reverifyLeased(), reject(op2, "HASH_MISMATCH", change(hash, { source: incoming })), worker, 3));
    const revoked = apply(reverifyLeased(), reject(op2, "HASH_MISMATCH", hash), worker, 3);
    expect(revoked.receipts).toHaveLength(1);
    expect(revoked.currentReceiptId).toBe(r1);
    expect(revoked.revoked).toBe(true);
    fails("STATE", () => admission(revoked, { principalId: owner, now: 4, expectedRevision: revoked.revision }));
    // The failure digest keeps the pre-observation formula; replay returns the stored failure, a different code conflicts.
    expect(revoked.operations[1].terminalPayloadDigest).toBe(protocolDigest("verification-failure", reject(op2, "HASH_MISMATCH")));
    expect(transition(revoked, reject(op2, "HASH_MISMATCH", hash), { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(revoked);
    expect(transition(revoked, reject(op2, "HASH_MISMATCH"), { principalId: worker, now: 999, expectedRevision: 0 })).toEqual(revoked);
    fails("CONFLICT", () => transition(revoked, reject(op2, "SIZE_MISMATCH"), { principalId: worker, now: 999, expectedRevision: 0 }));
    // Initial rejection before an identity exists: only identity-free causes can be named.
    let s = apply(fresh(), complete(), owner);
    s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 80 });
    fails("OBSERVATION", () => apply(s, reject(op1, "HASH_MISMATCH", change(observed(), { published: null }))));
    const closedModel = apply(s, reject(op1, "INVALID_BYTES", change(observed(), { format: null, published: null })));
    expect(closedModel.receipts).toHaveLength(0);
    expect(closedModel.closure?.reason).toBe("verification_failure");
    // Rejections without an observation keep the pre-observation contract.
    expect(apply(reverifyLeased(), reject(op2, "MEDIA_INVALID"), worker, 3).revoked).toBe(true);
  });
});
describe("P2 registered-object reverify command preparation", () => {
  const leased = () => {
    const s = apply(registered(), complete(op2, "reverify", 200), owner, 2);
    return apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 150 }, worker, 2);
  };
  type Read = { status: "observed"; source: { bucket: string; key: string; providerVersion: string | null }; bytes: { sha256: string; sizeBytes: number };
    format: { mime: string; kind: string } | null; media: typeof media | { width: number; height: number; durationMs: number | null } | null } | { status: "unavailable" };
  const good: Read = { status: "observed", source: finalSource, bytes: { sha256: identity.sha256, sizeBytes: identity.sizeBytes }, format: { mime: identity.mime, kind: identity.kind }, media };
  const request = (read: Read = good, patch: Record<string, unknown> = {}) => ({ operationId: op2, fingerprint: fp, expectedFence: 1, receiptId: r2, notAfter: 190,
    verifierVersion: "verifier-v1", toolVersion: "probe-v1", read, ...patch });
  const decide = (s: UploadModel, read?: Read, patch?: Record<string, unknown>, principalId = worker, now = 3) => reverifyCommand(s, request(read, patch), ctx(s, principalId, now));
  const observedRead = (patch: Partial<Extract<Read, { status: "observed" }>>): Read => ({ ...(good as Extract<Read, { status: "observed" }>), ...patch });

  it("prepares exactly the existing finalize for a matching observation, and the transition issues the receipt", () => {
    const s = leased(), before = structuredClone(s), decision = decide(s);
    expect(decision).toEqual({ action: "finalize", command: finalize(op2, r2, 190) });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(s).toEqual(before);
    const issued = apply(s, (decision as Extract<ReverifyDecision, { action: "finalize" }>).command, worker, 3);
    expect(issued.currentReceiptId).toBe(r2);expect(issued.receipts.at(-1)?.body.source).toEqual(finalSource);expect(issued.revoked).toBe(false);
  });
  it.each([
    ["size and hash both differ -> size first", { bytes: { sha256: "d".repeat(64), sizeBytes: 124 } }, "SIZE_MISMATCH"],
    ["hash differs", { bytes: { sha256: "d".repeat(64), sizeBytes: identity.sizeBytes } }, "HASH_MISMATCH"],
    ["other format", { format: { mime: "image/jpeg", kind: "image" } }, "MIME_MISMATCH"],
    ["other media", { media: { width: 3, height: 2, durationMs: null } }, "MEDIA_INVALID"],
    ["undecodable media", { media: null }, "MEDIA_INVALID"],
    ["undetectable bytes", { format: null, media: null }, "INVALID_BYTES"],
  ] as const)("prepares the existing failure code for a confirmed mismatch (%s)", (_label, patch, code) => {
    const s = leased(), decision = decide(s, observedRead(patch as Partial<Extract<Read, { status: "observed" }>>));
    expect(decision.action).toBe("rejectVerification");
    const command = (decision as Extract<ReverifyDecision, { action: "rejectVerification" }>).command;
    expect(command).toMatchObject({ type: "rejectVerification", operationId: op2, fingerprint: fp, expectedFence: 1, failureCode: code });
    expect(command.observation).toMatchObject({ v: 1, kind: "reverify", source: finalSource, published: null, tools: { verifierVersion: "verifier-v1", toolVersion: "probe-v1" } });
    const after = apply(s, command, worker, 3);
    expect(after.revoked).toBe(true);expect(after.currentReceiptId).toBe(r1);expect(after.receipts).toHaveLength(1);
    expect(after.operations.find(o => o.id === op2)?.failureCode).toBe(code);
  });
  it("returns no receipt and no permanent failure for a transient read failure", () => {
    const s = leased();
    expect(decide(s, { status: "unavailable" })).toEqual({ action: "none", reason: "TRANSIENT_READ" });
    expect(s.operations.find(o => o.id === op2)?.status).toBe("pending");
  });
  it.each([
    ["other key", { source: { ...finalSource, key: `${owner}/assets/${uid(99)}/${"a".repeat(64)}.png` } }],
    ["other bucket", { source: { ...finalSource, bucket: "unit-other" } }],
    ["incoming original", { source: incoming }],
    ["claimed provider version", { source: { ...finalSource, providerVersion: "v1" } }],
  ] as const)("refuses an observation whose source is not exactly the registered one (%s)", (_label, patch) => {
    fails("OBSERVATION", () => decide(leased(), observedRead(patch as Partial<Extract<Read, { status: "observed" }>>)));
  });
  it("never binds a read to a registered source whose provider version it cannot prove", () => {
    const versioned = { ...identity, providerVersion: "v1" };
    let s = apply(fresh(), complete(), owner);
    s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 80 });
    s = apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity: versioned });
    s = apply(s, { ...finalize(), identity: versioned });
    s = apply(s, complete(op2, "reverify", 200), owner, 2);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 150 }, worker, 2);
    fails("OBSERVATION", () => decide(s));
    fails("OBSERVATION", () => decide(s, observedRead({ source: { ...finalSource, providerVersion: "v1" } })));
    expect(decide(s, { status: "unavailable" }).action).toBe("none");
  });
  it("uses the existing transition checks for worker, lease window, fence, policy and operation binding", () => {
    fails("AUTHORITY", () => decide(leased(), good, {}, stranger));
    fails("EXPIRED", () => decide(leased(), good, {}, worker, 150));
    fails("FENCE", () => decide(leased(), good, { expectedFence: 2 }));
    const unclaimed = apply(registered(), complete(op2, "reverify", 200), owner, 2);
    fails("FENCE", () => decide(unclaimed));
    const advanced = apply(leased(), { type: "advancePolicy", epoch: 2, policyDigest: "e".repeat(64) }, policy, 3);
    fails("STATE", () => decide(advanced, good, {}, worker, 4));
    fails("CONFLICT", () => decide(leased(), good, { fingerprint: "b".repeat(64) }));
    fails("CONFLICT", () => decide(leased(), good, { receiptId: r1 }));
    fails("STATE", () => decide(leased(), good, { notAfter: 3 }));
    fails("STATE", () => decide(registered(), good, { operationId: op1 }));
    fails("INPUT", () => decide(leased(), good, { extra: true }));
    fails("INPUT", () => decide(leased(), { status: "observed" } as unknown as Read));
  });
  it("answers an already-ended operation from its stored terminal result without a new command", () => {
    const s = leased();
    const issued = apply(s, (decide(s) as Extract<ReverifyDecision, { action: "finalize" }>).command, worker, 3);
    const replay = decide(issued, good, {}, worker, 4);
    expect(replay).toMatchObject({ action: "terminal", result: { status: "succeeded", failureCode: null, receipt: { body: { id: r2 } } } });
    expect(decide(issued, { status: "unavailable" }, {}, worker, 4).action).toBe("terminal");
    const failed = apply(s, (decide(s, observedRead({ format: null, media: null })) as Extract<ReverifyDecision, { action: "rejectVerification" }>).command, worker, 3);
    expect(decide(failed, good, {}, worker, 4)).toEqual({ action: "terminal", result: { status: "failed", failureCode: "INVALID_BYTES", receipt: null } });
    const canceled = apply(s, complete(uid(15), "reverify", 200), owner, 3);
    expect(decide(canceled, good, {}, worker, 4)).toEqual({ action: "terminal", result: { status: "canceled", failureCode: null, receipt: null } });
  });
});
describe("P2 registered-object reverify read preparation (synthetic reader)", () => {
  const leased = () => {
    const s = apply(registered(), complete(op2, "reverify", 200), owner, 2);
    return apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 150 }, worker, 2);
  };
  const reader = (result: () => unknown) => {
    const calls: unknown[][] = [];
    return { calls, observer: { observeRegisteredSource: async (...args: unknown[]) => { calls.push(args); return result(); } } as unknown as RegisteredSourceObserver };
  };
  const actor = actorFromVerifiedUserId(owner);
  const measured = { source: finalSource, bytes: { sha256: identity.sha256, sizeBytes: identity.sizeBytes }, format: { mime: identity.mime, kind: identity.kind }, media };
  const command = (s: UploadModel, read: unknown, now = 3) => reverifyCommand(s, { operationId: op2, fingerprint: fp, expectedFence: 1, receiptId: r2, notAfter: 190,
    verifierVersion: "verifier-v1", toolVersion: "probe-v1", read }, ctx(s, worker, now));

  it("asks the reader for the registered identity at its exact registered source and feeds that one result to the command", async () => {
    const s = leased(), r = reader(() => Object.freeze({ ...measured })), signal = new AbortController().signal;
    const prepared = await prepareReverifyRead(r.observer, actor, s, op2, signal);
    expect(r.calls).toEqual([[actor, { asset: { ownerId: owner, id: assetId, kind: "image", mime: "image/png", objectKey: identity.key, sha256: identity.sha256,
      sizeBytes: identity.sizeBytes }, source: finalSource }, signal]]);
    expect(prepared).toEqual({ read: { status: "observed", ...measured }, transientCode: null });
    expect(Object.isFrozen(prepared) && Object.isFrozen(prepared.read)).toBe(true);
    expect(command(s, prepared.read)).toEqual({ action: "finalize", command: finalize(op2, r2, 190) });
  });
  it("carries a measured mismatch to the existing failure code", async () => {
    const r = reader(() => ({ ...measured, bytes: { sha256: "d".repeat(64), sizeBytes: identity.sizeBytes } }));
    const prepared = await prepareReverifyRead(r.observer, actor, leased(), op2);
    expect(command(leased(), prepared.read)).toMatchObject({ action: "rejectVerification", command: { failureCode: "HASH_MISMATCH" } });
  });
  it.each(["STORAGE_NOT_FOUND", "STORAGE_UNAVAILABLE", "STORAGE_TIMEOUT", "STORAGE_INTEGRITY", "STORAGE_TEMP"] as const)(
    "turns %s into a retry: no receipt and no permanent failure command", async code => {
      const s = leased(), prepared = await prepareReverifyRead(reader(() => { throw new StorageReadError(code); }).observer, actor, s, op2);
      expect(prepared).toEqual({ read: { status: "unavailable" }, transientCode: code });
      expect(command(s, prepared.read)).toEqual({ action: "none", reason: "TRANSIENT_READ" });
    });
  it.each(["STORAGE_CONFIG", "STORAGE_INPUT", "STORAGE_OWNER", "STORAGE_PRIVATE", "STORAGE_AUTH", "STORAGE_TYPE", "STORAGE_LIMIT", "STORAGE_ABORTED"] as const)(
    "rethrows %s unchanged instead of retrying it", async code => {
      await expect(prepareReverifyRead(reader(() => { throw new StorageReadError(code); }).observer, actor, leased(), op2)).rejects.toMatchObject({ code });
    });
  it("rethrows a non-storage error unchanged", async () => {
    const failure = new Error("unexpected");
    await expect(prepareReverifyRead(reader(() => { throw failure; }).observer, actor, leased(), op2)).rejects.toBe(failure);
  });
  it("refuses before any read when the operation is not a pending reverify of a registered object", async () => {
    const r = reader(() => measured), s = leased();
    const ended = apply(s, finalize(op2, r2, 190), worker, 3);
    for (const [model, operationId] of [[ended, op2], [s, op1], [s, uid(99)], [prepared(), op1], [s, 42]] as const)
      await expect(prepareReverifyRead(r.observer, actor, model, operationId)).rejects.toMatchObject({ code: "STATE" });
    await expect(prepareReverifyRead(r.observer, actor, { ...s, revision: -1 }, op2)).rejects.toBeInstanceOf(ProtocolError);
    expect(r.calls).toEqual([]);
  });
  it("hands a version-carrying registered source to the reader unchanged, so the reader refuses it before any request", async () => {
    const versioned = { ...identity, providerVersion: "v1" };
    let s = apply(fresh(), complete(), owner);
    s = apply(s, { type: "claim", operationId: op1, fingerprint: fp, expectedFence: 0, leaseUntil: 80 });
    s = apply(s, { type: "reservePublication", operationId: op1, fingerprint: fp, expectedFence: 1, identity: versioned });
    s = apply(s, { ...finalize(), identity: versioned });
    s = apply(s, complete(op2, "reverify", 200), owner, 2);
    s = apply(s, { type: "claim", operationId: op2, fingerprint: fp, expectedFence: 0, leaseUntil: 150 }, worker, 2);
    const r = reader(() => measured);
    await prepareReverifyRead(r.observer, actor, s, op2);
    expect((r.calls[0][1] as { source: unknown }).source).toEqual({ ...finalSource, providerVersion: "v1" });
  });
  describe("one synthetic worker attempt", () => {
    type Retry = { attempt: number; maxAttempts: number; retryUntil: number };
    const attempt = (states: UploadModel[], times: number[], observer: RegisteredSourceObserver, retry: Retry = { attempt: 1, maxAttempts: 3, retryUntil: 100 },
      patch: Record<string, unknown> = {}) => {
      const loads: number[] = [];
      let i = 0, j = 0;
      const promise = attemptReverify({ reader: observer, actor,
        load: async () => { loads.push(i); return states[Math.min(i++, states.length - 1)]; },
        now: () => times[Math.min(j++, times.length - 1)],
        request: { principalId: worker, operationId: op2, fingerprint: fp, expectedFence: 1, receiptId: r2, notAfter: 190, verifierVersion: "verifier-v1",
          toolVersion: "probe-v1", retry, ...patch } });
      return { promise, loads };
    };
    const throwing = (code: ConstructorParameters<typeof StorageReadError>[0]) => reader(() => { throw new StorageReadError(code); });
    const advance = (s: UploadModel, now: number) => apply(s, { type: "advancePolicy", epoch: 2, policyDigest: "e".repeat(64) }, policy, now);

    it("verificationLease reports the held lease and changes nothing", () => {
      const s = leased(), before = structuredClone(s), query = { operationId: op2, fingerprint: fp, expectedFence: 1 };
      expect(verificationLease(s, query, ctx(s, worker, 3))).toEqual({ operationId: op2, kind: "reverify", fence: 1, leaseUntil: 150, authorizationUntil: 200, revision: s.revision });
      expect(s).toEqual(before);
      fails("CONFLICT", () => verificationLease(s, query, { ...ctx(s, worker, 3), expectedRevision: s.revision - 1 }));
      fails("AUTHORITY", () => verificationLease(s, query, ctx(s, stranger, 3)));
      fails("EXPIRED", () => verificationLease(s, query, ctx(s, worker, 150)));
      fails("FENCE", () => verificationLease(s, { ...query, expectedFence: 2 }, ctx(s, worker, 3)));
      fails("INPUT", () => verificationLease(s, { ...query, expectedFence: 0 }, ctx(s, worker, 3)));
      fails("INPUT", () => verificationLease(s, { ...query, extra: 1 }, ctx(s, worker, 3)));
    });
    it("prepares the existing command from the state loaded after one read", async () => {
      const s = leased(), r = reader(() => measured), run = attempt([s, s], [3, 4], r.observer);
      expect(await run.promise).toEqual({ outcome: "command", expectedRevision: s.revision, decision: { action: "finalize", command: finalize(op2, r2, 190) } });
      expect(r.calls).toHaveLength(1);expect(run.loads).toHaveLength(2);
    });
    it("carries a confirmed mismatch to the existing rejection", async () => {
      const s = leased(), r = reader(() => ({ ...measured, format: null, media: null }));
      expect(await attempt([s, s], [3, 3], r.observer).promise).toMatchObject({ outcome: "command", decision: { action: "rejectVerification", command: { failureCode: "INVALID_BYTES" } } });
    });
    it.each([
      ["an expired lease", () => leased(), 150, {}, "EXPIRED"],
      ["another fence", () => leased(), 3, { expectedFence: 2 }, "FENCE"],
      ["a non-verifier", () => leased(), 3, { principalId: stranger }, "AUTHORITY"],
      ["an unclaimed operation", () => apply(registered(), complete(op2, "reverify", 200), owner, 2), 3, {}, "FENCE"],
      ["an advanced policy", () => advance(leased(), 3), 4, {}, "STATE"],
      ["an unknown operation", () => leased(), 3, { operationId: uid(99) }, "STATE"],
      ["another fingerprint", () => leased(), 3, { fingerprint: "b".repeat(64) }, "CONFLICT"],
    ] as const)("stops before any read on %s", async (_label, make, now, patch, code) => {
      const r = reader(() => measured), run = attempt([make()], [now], r.observer, undefined, patch);
      await expect(run.promise).rejects.toMatchObject({ code });expect(r.calls).toEqual([]);expect(run.loads).toHaveLength(1);
    });
    it("answers an ended operation from its stored result without reading, even after the lease window", async () => {
      const s = leased(), r = reader(() => measured), done = apply(s, finalize(op2, r2, 190), worker, 3);
      expect(await attempt([done], [999], r.observer).promise).toMatchObject({ outcome: "terminal", result: { status: "succeeded", failureCode: null, receipt: { body: { id: r2 } } } });
      const canceled = apply(s, complete(uid(15), "reverify", 200), owner, 3);
      expect(await attempt([canceled], [4], r.observer).promise).toEqual({ outcome: "terminal", result: { status: "canceled", failureCode: null, receipt: null } });
      expect(r.calls).toEqual([]);
    });
    it("ends with no command and no read when the budget is already spent", async () => {
      const r = reader(() => measured);
      expect(await attempt([leased()], [3], r.observer, { attempt: 4, maxAttempts: 3, retryUntil: 100 }).promise).toEqual({ outcome: "exhausted", transientCode: null });
      expect(await attempt([leased()], [100], r.observer, { attempt: 1, maxAttempts: 3, retryUntil: 100 }).promise).toEqual({ outcome: "exhausted", transientCode: null });
      expect(r.calls).toEqual([]);
    });
    it("recommends a retry for 404 or transient damage only within the budget and time, otherwise ends without a command", async () => {
      const s = leased(), notFound = throwing("STORAGE_NOT_FOUND").observer, damaged = throwing("STORAGE_INTEGRITY").observer;
      expect(await attempt([s, s], [3, 4], notFound).promise).toEqual({ outcome: "retry", transientCode: "STORAGE_NOT_FOUND", nextAttempt: 2, retryUntil: 100 });
      // The recommendation is limited to the currently held lease.
      expect(await attempt([s, s], [3, 4], damaged, { attempt: 2, maxAttempts: 3, retryUntil: 999 }).promise).toEqual({ outcome: "retry", transientCode: "STORAGE_INTEGRITY", nextAttempt: 3, retryUntil: 150 });
      expect(await attempt([s, s], [3, 4], notFound, { attempt: 3, maxAttempts: 3, retryUntil: 100 }).promise).toEqual({ outcome: "exhausted", transientCode: "STORAGE_NOT_FOUND" });
      expect(await attempt([s, s], [3, 100], damaged).promise).toEqual({ outcome: "exhausted", transientCode: "STORAGE_INTEGRITY" });
    });
    it("decides only on the state loaded after the read", async () => {
      const s = leased(), r = reader(() => measured);
      // Renewed by the same worker during the read: the command targets the newer revision and still applies.
      const renewed = apply(s, { type: "renew", operationId: op2, fingerprint: fp, expectedFence: 1, leaseUntil: 180 }, worker, 3);
      const later = await attempt([s, renewed], [3, 160], r.observer).promise;
      expect(later).toMatchObject({ outcome: "command", expectedRevision: renewed.revision });
      const { decision: { command }, expectedRevision } = later as Extract<ReverifyAttemptResult, { outcome: "command" }>;
      const commandContext = { principalId: worker, now: 160, expectedRevision };
      expect(transition(renewed, command, commandContext).currentReceiptId).toBe(r2);
      const renewedAgain = apply(renewed, { type: "renew", operationId: op2, fingerprint: fp, expectedFence: 1, leaseUntil: 190 }, worker, 160);
      fails("CONFLICT", () => transition(renewedAgain, command, commandContext));
      // Ended during the read: the stored result, no command.
      expect(await attempt([s, apply(s, complete(uid(15), "reverify", 200), owner, 3)], [3, 4], r.observer).promise).toMatchObject({ outcome: "terminal", result: { status: "canceled" } });
      expect(await attempt([s, apply(s, finalize(op2, r2, 190), worker, 3)], [3, 4], r.observer).promise).toMatchObject({ outcome: "terminal", result: { status: "succeeded" } });
      // Lease lost or policy moved during the read: the existing code and no command (a transient read is not retried either).
      await expect(attempt([s, s], [3, 150], r.observer).promise).rejects.toMatchObject({ code: "EXPIRED" });
      await expect(attempt([s, s], [3, 150], throwing("STORAGE_NOT_FOUND").observer).promise).rejects.toMatchObject({ code: "EXPIRED" });
      await expect(attempt([s, advance(s, 3)], [3, 4], r.observer).promise).rejects.toMatchObject({ code: "STATE" });
      // A clock that moves backwards is refused.
      await expect(attempt([s, s], [4, 3], r.observer).promise).rejects.toMatchObject({ code: "INPUT" });
    });
    it.each(["STORAGE_AUTH", "STORAGE_CONFIG", "STORAGE_PRIVATE", "STORAGE_LIMIT", "STORAGE_ABORTED"] as const)("propagates %s from the read", async code => {
      const s = leased(), run = attempt([s, s], [3, 4], throwing(code).observer);
      await expect(run.promise).rejects.toMatchObject({ code });expect(run.loads).toHaveLength(1);
    });
    it("refuses a malformed request, retry budget or clock before or without reading", async () => {
      const r = reader(() => measured);
      for (const patch of [{ extra: 1 }, { expectedFence: 0 }, { retry: { attempt: 0, maxAttempts: 3, retryUntil: 100 } }, { retry: { attempt: 1, maxAttempts: 17, retryUntil: 100 } },
        { retry: { attempt: 1, maxAttempts: 3 } }, { retry: { attempt: 1.5, maxAttempts: 3, retryUntil: 100 } }]) {
        const run = attempt([leased()], [3], r.observer, undefined, patch);
        await expect(run.promise).rejects.toMatchObject({ code: "INPUT" });expect(run.loads).toEqual([]);
      }
      for (const bad of [Number.NaN, -1, 1.5]) await expect(attempt([leased()], [bad], r.observer).promise).rejects.toMatchObject({ code: "INPUT" });
      expect(r.calls).toEqual([]);
    });
  });
});
