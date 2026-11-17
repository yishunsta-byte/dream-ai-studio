import { describe, expect, it } from "vitest";
import { identitySchema, ProtocolError, type UploadModel, type UploadCommand } from "@/lib/storage/uploads/schema";
import { admission, capabilityHorizon, checkedModel, cleanupInstruction, operationResult, publicationInstruction, reserveUpload, transition } from "@/lib/storage/uploads/state";
import { canonicalJson, checkedReceipt, makeReceipt, protocolDigest } from "@/lib/storage/uploads/receipt";
import { beginCreation, creationFingerprint, creationResult, reserveCreationLedger, retireCreation, settleCreation } from "@/lib/storage/uploads/operation";

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
const finalize = (operationId = op1, receiptId = r1, notAfter = 20): Extract<UploadCommand, { type: "finalize" }> => ({ type: "finalize", operationId, fingerprint: fp,
  expectedFence: 1, receiptId, identity, source: operationId === op1 ? incoming : { bucket: identity.bucket, key: identity.key, providerVersion: null }, media,
  notAfter, verifierVersion: "verifier-v1", toolVersion: "probe-v1" });
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
