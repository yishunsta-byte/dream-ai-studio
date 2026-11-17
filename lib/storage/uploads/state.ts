import { z } from "zod";
import { checkedReceipt, makeReceipt, protocolDigest } from "./receipt";
import { commandSchema, contextSchema, frozen, parse, requireProtocol as need, uploadModelSchema, type UploadModel, type UploadCommand, type Context } from "./schema";

const same = (a: unknown, b: unknown) => protocolDigest("tuple", a) === protocolDigest("tuple", b);
const closed = (s: UploadModel) => s.lifecycle === "cleanup_claimed" || s.lifecycle === "tombstoned";
export function checkedModel(input: unknown): UploadModel {
  const s = parse(uploadModelSchema, input);
  const unique = (values: string[]) => need(new Set(values).size === values.length, "INPUT");
  unique(s.operations.map(v => v.id)); unique(s.operations.map(v => String(v.generation)));
  unique(s.receipts.map(v => v.body.id)); unique(s.receipts.map(v => v.body.operationId)); unique(s.issues.map(v => v.id));
  unique(s.revocations.map(v => String(v.revision)));
  need(s.issueEnvelopeUntil <= s.intentExpiresAt && s.issues.length <= s.maxIssues, "INPUT");
  for (const issue of s.issues) need(issue.issueUntil <= s.issueEnvelopeUntil && (issue.horizon === null || issue.horizon >= issue.issueUntil), "INPUT");
  if (s.identity) need(s.identity.ownerId === s.ownerId && s.identity.assetId === s.assetId, "INPUT");
  need(s.incoming.key.startsWith(`${s.ownerId}/`), "INPUT");
  need((s.lifecycle === "reserved") === (s.identity === null) || closed(s), "INPUT");
  need(closed(s) === (s.cleanup !== null), "INPUT");
  need(s.lifecycle !== "registered" || !s.closed, "INPUT");
  need(s.identity === null ? s.publication === null : s.publication !== null, "INPUT");
  need(s.lifecycle === "registered" || (s.receipts.length === 0 && s.currentReceiptId === null && s.media === null && !s.revoked && s.revocations.length === 0 && s.stateRevision === 0), "INPUT");
  if (s.cleanup) need(s.closed && s.cleanup.barrierFence === s.barrierFence && !s.currentReceiptId && !s.receipts.length &&
    s.issues.every(i => i.horizon !== null && i.horizon <= s.cleanup!.claimedAt), "INPUT");
  need(s.activeGeneration === Math.max(0, ...s.operations.map(o => o.generation)), "INPUT");
  need(s.operations.filter(o => o.kind === "initial").length <= 1 &&
    s.operations.every(o => o.kind !== "initial" || o.generation === 1), "INPUT");
  for (const o of s.operations) {
    need((o.leaseUntil === null) === (o.workerId === null), "INPUT");
    need((o.leaseUntil === null) === (o.claimedAt === null), "INPUT");
    if (o.leaseUntil !== null) need(o.leaseUntil <= o.authorizationUntil && o.claimedAt! < o.leaseUntil && o.fence > 0 && o.claimVerifiers.includes(o.workerId!), "INPUT");
    else need(o.claimVerifiers.length === 0, "INPUT");
    need(o.kind !== "initial" || o.authorizationUntil <= s.intentExpiresAt, "INPUT");
    need(o.kind !== "reverify" || s.lifecycle === "registered", "INPUT");
    need(o.status !== "pending" || o.generation === s.activeGeneration, "INPUT");
    need((o.status === "succeeded") === (o.receiptId !== null && o.terminalPayloadDigest !== null), "INPUT");
    need(o.status === "failed" ? o.failureCode !== null && o.terminalPayloadDigest !== null && o.receiptId === null : o.failureCode === null, "INPUT");
    if (o.status === "failed") need(o.terminalPayloadDigest === protocolDigest("verification-failure", {
      type: "rejectVerification", operationId: o.id, fingerprint: o.fingerprint, expectedFence: o.fence, failureCode: o.failureCode }), "INPUT");
    if (o.status === "pending" || o.status === "canceled") need(o.receiptId === null && o.terminalPayloadDigest === null, "INPUT");
    if (o.status === "pending") need(o.completedAt === null && o.completedStateRevision === null, "INPUT");
    else need(o.completedAt !== null && o.completedStateRevision !== null, "INPUT");
    if (o.status === "succeeded" || o.status === "failed") need(o.workerId && o.claimedAt !== null && o.leaseUntil !== null &&
      o.completedAt! >= o.claimedAt && o.completedAt! < o.leaseUntil && o.completedAt! < o.authorizationUntil, "INPUT");
    if (o.kind === "initial" && (o.status === "failed" || o.status === "canceled")) need(s.closed, "INPUT");
    if (o.status === "succeeded") need(s.lifecycle === "registered" && o.completedStateRevision === o.expectedStateRevision + 1, "INPUT");
    if (o.receiptId) need(s.receipts.some(r => r.body.id === o.receiptId && r.body.operationId === o.id), "INPUT");
  }
  for (const value of s.receipts) {
    const r = checkedReceipt(value).body, o = s.operations.find(o => o.id === r.operationId);
    need(s.identity && same(r.identity, s.identity) && r.objectId === s.objectId && o?.status === "succeeded" &&
      o.receiptId === r.id && o.generation === r.generation && o.fence === r.fence && o.policyEpoch === r.policyEpoch && o.policyDigest === r.policyDigest && same(r.media, s.media), "INPUT");
    need(r.verifierId === o.workerId && r.verifiedAt === o.completedAt && o.claimVerifiers.includes(r.verifierId), "INPUT");
    const expectedSource = o.kind === "initial" ? s.incoming : { bucket: s.identity.bucket, key: s.identity.key, providerVersion: s.identity.providerVersion };
    need(same(r.source, expectedSource) && o.terminalPayloadDigest === finalizeDigest({ type: "finalize", operationId: o.id,
      fingerprint: o.fingerprint, expectedFence: r.fence, receiptId: r.id, identity: r.identity, source: r.source, media: r.media,
      notAfter: r.notAfter, verifierVersion: r.verifierVersion, toolVersion: r.toolVersion }), "INPUT");
  }
  if (s.currentReceiptId) need(s.lifecycle === "registered" && s.receipts.some(r => r.body.id === s.currentReceiptId), "INPUT");
  if (s.lifecycle === "registered") need(!!s.currentReceiptId && s.receipts.length > 0 && s.media, "INPUT");
  if (s.receipts.length) need(s.receipts.find(r => r.body.id === s.currentReceiptId)?.body.generation === Math.max(...s.receipts.map(r => r.body.generation)), "INPUT");
  if (s.publication) {
    const p = s.publication, initial = s.operations.find(o => o.id === p.operationId && o.kind === "initial");
    need(s.identity && p.identityDigest === protocolDigest("object-identity", s.identity) && initial && p.fence <= initial.fence && p.barrierFence <= s.barrierFence, "INPUT");
    if (!closed(s)) need(p.barrierFence === s.barrierFence, "INPUT");
  }
  const points = s.operations.filter(o => o.status === "succeeded").map(o => o.completedStateRevision!);
  for (const event of s.revocations) {
    need(event.authorizers.includes(event.principalId), "INPUT");
    if (event.kind === "verification_failure") {
      const o = s.operations.find(o => o.id === event.operationId);
      need(o?.kind === "reverify" && o.status === "failed" && o.completedAt === event.at && o.workerId === event.principalId &&
        o.completedStateRevision === event.revision && same(o.claimVerifiers, event.authorizers), "INPUT");
    } else need(event.operationId === null, "INPUT");
    points.push(event.revision);
  }
  for (const o of s.operations.filter(o => o.kind === "reverify" && o.status === "failed")) need(s.revocations.some(e => e.operationId === o.id), "INPUT");
  for (const o of s.operations) need(s.operations.filter(previous => previous.generation < o.generation)
    .every(previous => previous.completedStateRevision !== null && previous.completedStateRevision <= o.expectedStateRevision), "INPUT");
  points.sort((a, b) => a - b);
  need(points.length === s.stateRevision && points.every((p, index) => p === index + 1), "INPUT");
  if (s.lifecycle === "registered") {
    const current = s.operations.find(o => o.receiptId === s.currentReceiptId)!;
    need(s.revoked === s.revocations.some(e => e.revision > current.completedStateRevision!), "INPUT");
    need(s.operations.some(o => o.kind === "initial" && o.status === "succeeded"), "INPUT");
  }
  return s;
}

const reserveSchema = uploadModelSchema.pick({ ownerId: true, objectId: true, assetId: true, intentId: true,
  intentExpiresAt: true, issueEnvelopeUntil: true, maxIssues: true, verifiers: true, collectors: true, policyManagers: true, policyEpoch: true, policyDigest: true, incoming: true });
export function reserveUpload(input: unknown, context: unknown): UploadModel {
  const v = parse(reserveSchema, input), c = parse(contextSchema, context);
  need(c.principalId === v.ownerId, "OWNER");
  need(c.expectedRevision === 0 && c.now < v.issueEnvelopeUntil && v.issueEnvelopeUntil <= v.intentExpiresAt, "EXPIRED");
  return frozen(checkedModel({ ...v, revision: 0, barrierFence: 0, stateRevision: 0, activeGeneration: 0, lifecycle: "reserved",
    closed: false, identity: null, media: null, currentReceiptId: null, revoked: false, revocations: [], operations: [], receipts: [], issues: [], publication: null, cleanup: null }));
}

// Pure proposal over a caller-supplied authoritative snapshot. A future executor
// must atomically persist CAS+outbox under B16 lock order; returning is NOT COMMIT.
export function transition(input: unknown, command: unknown, context: unknown): UploadModel {
  const s = checkedModel(input), a = parse(commandSchema, command), c = parse(contextSchema, context);
  const owner = () => need(c.principalId === s.ownerId, "OWNER");
  const verifier = () => need(s.verifiers.includes(c.principalId), "AUTHORITY");
  const collector = () => need(s.collectors.includes(c.principalId), "AUTHORITY");
  const manager = () => need(s.policyManagers.includes(c.principalId), "AUTHORITY");
  const op = (id: string, fingerprint: string) => {
    const o = s.operations.find(o => o.id === id); need(o, "STATE"); need(o.fingerprint === fingerprint, "CONFLICT"); return o;
  };
  // Exact terminal replay is intentionally BEFORE CAS, lease, policy, expiry.
  // It never modifies current availability or grants a new IO instruction.
  if (a.type === "complete") {
    if (a.kind === "initial") owner(); else need(c.principalId === s.ownerId || s.policyManagers.includes(c.principalId), "AUTHORITY");
    const old = s.operations.find(o => o.id === a.operationId);
    if (old) {
      need(old.fingerprint === a.fingerprint && old.kind === a.kind && old.authorizationUntil === a.authorizationUntil, "CONFLICT");
      return frozen(s);
    }
  }
  if (a.type === "finalize") {
    verifier(); const o = op(a.operationId, a.fingerprint);
    if (o.status === "succeeded") { need(o.terminalPayloadDigest === finalizeDigest(a), "CONFLICT"); return frozen(s); }
  }
  if (a.type === "rejectVerification") {
    verifier(); const o = op(a.operationId, a.fingerprint);
    if (o.status === "failed") { need(o.terminalPayloadDigest === protocolDigest("verification-failure", a), "CONFLICT"); return frozen(s); }
  }
  if (a.type === "claimCleanup") {
    collector(); if (s.cleanup) { need(s.cleanup.id === a.cleanupId, "CONFLICT"); return frozen(s); }
  }
  need(c.expectedRevision === s.revision, "CONFLICT");
  const live = (id: string, fingerprint: string) => {
    const o = op(id, fingerprint);
    need(!closed(s) && o.status === "pending" && o.generation === s.activeGeneration && o.policyEpoch === s.policyEpoch && o.policyDigest === s.policyDigest, "STATE");
    need(c.now < o.authorizationUntil, "EXPIRED");
    if (o.kind === "initial") need(!s.closed && c.now < s.intentExpiresAt, "EXPIRED");
    return o;
  };
  const leased = (id: string, fingerprint: string, expectedFence: number) => {
    verifier(); const o = live(id, fingerprint);
    need(o.fence === expectedFence && o.workerId === c.principalId, "FENCE");
    need(o.leaseUntil !== null && o.claimedAt !== null && c.now >= o.claimedAt && c.now < o.leaseUntil, "EXPIRED"); return o;
  };
  switch (a.type) {
    case "complete": {
      need(!closed(s), "STATE");
      need(a.authorizationUntil > c.now, "EXPIRED");
      if (a.kind === "initial") {
        need(s.lifecycle === "reserved" && !s.closed && s.operations.length === 0, "STATE");
        need(c.now < s.intentExpiresAt && a.authorizationUntil <= s.intentExpiresAt, "EXPIRED");
      } else need(s.lifecycle === "registered", "STATE");
      for (const o of s.operations) if (o.status === "pending") { cancel(o, c.now, s.stateRevision); }
      s.activeGeneration++;
      s.operations.push({ id: a.operationId, kind: a.kind, generation: s.activeGeneration, fingerprint: a.fingerprint,
        authorizationUntil: a.authorizationUntil, policyEpoch: s.policyEpoch, policyDigest: s.policyDigest, expectedStateRevision: s.stateRevision,
        fence: 0, workerId: null, leaseUntil: null, claimedAt: null, claimVerifiers: [], completedAt: null, completedStateRevision: null,
        status: "pending", receiptId: null, terminalPayloadDigest: null, failureCode: null });
      break;
    }
    case "claim": {
      verifier(); const o = live(a.operationId, a.fingerprint);
      need(o.fence === a.expectedFence && (o.leaseUntil === null || c.now >= o.leaseUntil), "FENCE");
      need(a.leaseUntil > c.now && a.leaseUntil <= o.authorizationUntil, "EXPIRED");
      o.fence++; o.workerId = c.principalId; o.leaseUntil = a.leaseUntil; o.claimedAt = c.now; o.claimVerifiers = [...s.verifiers]; break;
    }
    case "renew": {
      const o = leased(a.operationId, a.fingerprint, a.expectedFence);
      need(a.leaseUntil > o.leaseUntil! && a.leaseUntil <= o.authorizationUntil, "EXPIRED"); o.leaseUntil = a.leaseUntil; break;
    }
    case "reservePublication": {
      const o = leased(a.operationId, a.fingerprint, a.expectedFence);
      need(o.kind === "initial" && (s.lifecycle === "reserved" || s.lifecycle === "publication_reserved"), "STATE");
      need(a.identity.ownerId === s.ownerId && a.identity.assetId === s.assetId, "OWNER");
      need(!s.identity || same(a.identity, s.identity), "CONFLICT");
      s.identity = a.identity; s.lifecycle = "publication_reserved";
      s.publication = { operationId: o.id, fence: o.fence, barrierFence: s.barrierFence, identityDigest: protocolDigest("object-identity", a.identity) }; break;
    }
    case "finalize": {
      const o = leased(a.operationId, a.fingerprint, a.expectedFence);
      need(s.identity && same(s.identity, a.identity), "CONFLICT");
      const expectedSource = o.kind === "initial" ? s.incoming : { bucket: s.identity.bucket, key: s.identity.key, providerVersion: s.identity.providerVersion };
      need(same(a.source, expectedSource) && (!s.media || same(s.media, a.media)), "CONFLICT");
      need(s.stateRevision === o.expectedStateRevision && a.notAfter > c.now, "STATE");
      need(!s.receipts.some(r => r.body.id === a.receiptId), "CONFLICT");
      if (o.kind === "initial") need(s.lifecycle === "publication_reserved" && s.publication?.operationId === o.id &&
        s.publication.fence === o.fence && s.publication.barrierFence === s.barrierFence, "FENCE");
      else need(s.lifecycle === "registered", "STATE");
      // Supplied observations are trusted-executor claims, not byte/native proof.
      const r = makeReceipt({ id: a.receiptId, objectId: s.objectId, identity: s.identity, operationId: o.id,
        generation: o.generation, fence: o.fence, policyEpoch: o.policyEpoch, policyDigest: o.policyDigest, source: a.source, media: a.media, verifiedAt: c.now, notAfter: a.notAfter,
        verifierId: c.principalId, verifierVersion: a.verifierVersion, toolVersion: a.toolVersion });
      s.receipts.push(r); s.media = a.media; s.currentReceiptId = r.body.id; s.lifecycle = "registered"; s.revoked = false; s.stateRevision++;
      o.status = "succeeded"; o.receiptId = r.body.id; o.terminalPayloadDigest = finalizeDigest(a); o.completedAt = c.now; o.completedStateRevision = s.stateRevision; break;
    }
    case "rejectVerification": {
      const o = leased(a.operationId, a.fingerprint, a.expectedFence);
      o.status = "failed"; o.failureCode = a.failureCode; o.terminalPayloadDigest = protocolDigest("verification-failure", a);
      o.completedAt = c.now;
      if (o.kind === "initial") s.closed = true;
      else { s.revoked = true; s.stateRevision++; s.revocations.push({ revision: s.stateRevision, at: c.now, principalId: c.principalId,
        authorizers: [...o.claimVerifiers], operationId: o.id, kind: "verification_failure" }); }
      o.completedStateRevision = s.stateRevision;
      break;
    }
    case "cancel":
      owner(); need(s.lifecycle !== "registered" && !closed(s), "STATE"); s.closed = true;
      for (const o of s.operations) if (o.status === "pending") { cancel(o, c.now, s.stateRevision); }
      break;
    case "claimCleanup":
      collector(); need(s.lifecycle !== "registered" && (s.closed || c.now >= s.intentExpiresAt), "STATE");
      need(s.issues.every(i => i.horizon !== null && c.now >= i.horizon), "RECONCILE");
      s.closed = true; s.barrierFence++;
      for (const o of s.operations) if (o.status === "pending") { cancel(o, c.now, s.stateRevision); }
      s.cleanup = { id: a.cleanupId, barrierFence: s.barrierFence, claimedAt: c.now }; s.lifecycle = "cleanup_claimed"; break;
    case "observeCleanup":
      collector(); need(s.cleanup?.id === a.cleanupId && s.barrierFence === a.expectedBarrierFence && closed(s), "FENCE");
      need(a.identityDigest === protocolDigest("object-identity", s.identity), "CONFLICT");
      s.lifecycle = a.absent && a.writerQuiescent ? "tombstoned" : "cleanup_claimed"; break;
    case "reserveCapability": {
      owner(); need(!s.closed && s.lifecycle === "reserved" && c.now < s.intentExpiresAt, "STATE");
      need(c.now < a.issueUntil && a.issueUntil <= s.issueEnvelopeUntil && (a.horizon === null || a.horizon >= a.issueUntil), "EXPIRED");
      need(s.issues.every(i => i.horizon !== null), "RECONCILE");
      need(s.issues.length < s.maxIssues && !s.issues.some(i => i.id === a.issueId), "CONFLICT");
      s.issues.push({ id: a.issueId, issueUntil: a.issueUntil, horizon: a.horizon, boundEvidence: null, dispatched: false }); break;
    }
    case "dispatchCapability": {
      owner(); need(a.reservationCommit === "confirmed", "RECONCILE");
      const i = s.issues.find(i => i.id === a.issueId);
      need(i && !i.dispatched && !s.closed && s.lifecycle === "reserved", "STATE");
      need(c.now < i.issueUntil && c.now < s.intentExpiresAt, "EXPIRED");
      // At most one dispatch claim per reservation in the pure model. The future
      // executor must commit this CAS before one signer call; unknown call results
      // cannot be retried under this reservation. A new attempt consumes a new ID.
      i.dispatched = true; break;
    }
    case "reconcileCapability": {
      owner(); const i = s.issues.find(i => i.id === a.issueId); need(i && i.horizon === null && a.horizon >= i.issueUntil, "STATE");
      i.horizon = a.horizon; i.boundEvidence = a.boundEvidence; break;
    }
    case "advancePolicy": manager(); need(a.epoch === s.policyEpoch + 1, "CONFLICT"); s.policyEpoch = a.epoch; s.policyDigest = a.policyDigest; break;
    case "revoke":
      need(c.principalId === s.ownerId || s.policyManagers.includes(c.principalId), "AUTHORITY");
      need(s.lifecycle === "registered", "STATE"); s.revoked = true; s.stateRevision++;
      s.revocations.push({ revision: s.stateRevision, at: c.now, principalId: c.principalId,
        authorizers: [s.ownerId, ...s.policyManagers], operationId: null, kind: "manual" }); break;
  }
  s.revision++;
  return frozen(checkedModel(s));
}
function finalizeDigest(a: Extract<UploadCommand, { type: "finalize" }>) { return protocolDigest("finalize-request", a); }
function cancel(o: UploadModel["operations"][number], at: number, stateRevision: number) {
  o.status = "canceled"; o.fence++; o.leaseUntil = null; o.workerId = null; o.claimedAt = null; o.claimVerifiers = [];
  o.completedAt = at; o.completedStateRevision = stateRevision;
}

// This knowledge MUST come from the future persistence executor, never a browser.
const knowledge = z.enum(["confirmed", "unknown", "rolled-back"]);
export function capabilityHorizon(input: unknown): number | null {
  const n = z.number().int().nonnegative().safe();
  const v = parse(z.strictObject({ latestAcceptanceAt: n.nullable(), tokenLifetime: n, resourceLifetime: n, grace: n }), input);
  if (v.latestAcceptanceAt === null) return null;
  const horizon = v.latestAcceptanceAt + v.tokenLifetime + v.resourceLifetime + v.grace;
  need(Number.isSafeInteger(horizon), "INPUT"); return horizon;
}
export function publicationInstruction(input: unknown, context: unknown, commitKnowledge: unknown) {
  need(parse(knowledge, commitKnowledge) === "confirmed", "RECONCILE");
  const s = checkedModel(input), c = parse(contextSchema, context), p = s.publication;
  need(c.expectedRevision === s.revision, "CONFLICT");
  need(p && s.identity && s.lifecycle === "publication_reserved" && !s.closed && c.now < s.intentExpiresAt, "STATE");
  const o = s.operations.find(o => o.id === p.operationId);
  need(o && s.verifiers.includes(c.principalId) && o.workerId === c.principalId, "AUTHORITY");
  need(o.status === "pending" && o.policyEpoch === s.policyEpoch && o.policyDigest === s.policyDigest && o.generation === s.activeGeneration &&
    o.fence === p.fence && p.barrierFence === s.barrierFence, "FENCE");
  need(c.now < o.authorizationUntil && o.leaseUntil !== null && o.claimedAt !== null && c.now >= o.claimedAt && c.now < o.leaseUntil, "EXPIRED");
  return frozen({ objectId: s.objectId, identity: s.identity, operationId: o.id, fence: o.fence, barrierFence: s.barrierFence, overwrite: false as const });
}
export function cleanupInstruction(input: unknown, context: unknown, commitKnowledge: unknown) {
  need(parse(knowledge, commitKnowledge) === "confirmed", "RECONCILE");
  const s = checkedModel(input), c = parse(contextSchema, context);
  need(s.collectors.includes(c.principalId), "AUTHORITY"); need(c.expectedRevision === s.revision, "CONFLICT");
  need(s.cleanup && closed(s), "STATE");
  return frozen({ objectId: s.objectId, identity: s.identity, cleanup: s.cleanup });
}
export function admission(input: unknown, context: unknown) {
  const s = checkedModel(input), c = parse(contextSchema, context);
  need(c.principalId === s.ownerId, "OWNER"); need(c.expectedRevision === s.revision, "CONFLICT");
  const r = s.receipts.find(r => r.body.id === s.currentReceiptId);
  need(s.lifecycle === "registered" && !s.revoked && r && r.body.policyEpoch === s.policyEpoch && r.body.policyDigest === s.policyDigest &&
    r.body.verifiedAt <= c.now && r.body.notAfter > c.now, "STATE");
  return frozen({ objectId: s.objectId, identity: s.identity!, receipt: r, policyEpoch: s.policyEpoch, stateRevision: s.stateRevision });
}
export function operationResult(input: unknown, operationId: unknown, fingerprint: unknown, context: unknown) {
  const s = checkedModel(input), c: Context = parse(contextSchema, context);
  need(c.principalId === s.ownerId || s.verifiers.includes(c.principalId), "AUTHORITY");
  const o = s.operations.find(o => o.id === operationId); need(o && o.fingerprint === fingerprint, "CONFLICT");
  return frozen({ status: o.status, failureCode: o.failureCode, receipt: s.receipts.find(r => r.body.id === o.receiptId) ?? null });
}
