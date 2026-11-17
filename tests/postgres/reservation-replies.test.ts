import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decodeReservationReply, reservationFailureReason } from "@/lib/db/postgres/reservation-replies";
import { snapshotReservationRequest } from "@/lib/storage/uploads/reservation-client";
import { reserveUpload } from "@/lib/storage/uploads/state";
import { encodeUploadReservation } from "@/lib/db/postgres/upload-reservation-codec";
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const request = snapshotReservationRequest({ requestId: uid(4), clientJson: '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}' });
function history(tag: "replay" | "staged" = "replay") {
  const reservation = { ownerId: A, objectId: uid(1), assetId: uid(2), intentId: uid(3), intentExpiresAt: 3000, issueEnvelopeUntil: 2000, maxIssues: 3, verifiers: [B], collectors: [B], policyManagers: [B], policyEpoch: 1, policyDigest: "b".repeat(64), incoming: { bucket: "synthetic-incoming", key: `${A}/incoming/${uid(1)}/${uid(3)}`, providerVersion: null } };
  const raw = ` \n${JSON.stringify({ codecVersion: 1, requestId: uid(4), maxBytes: 1024, reservedAt: 1000, reservation }, null, 2)}\t `;
  const model = reserveUpload(reservation, { principalId: A, now: 1000, expectedRevision: 0 }), codec = encodeUploadReservation({ model, requestJson: raw });
  const reply = { tag, reservation: { requestId: uid(4), objectId: uid(1), assetId: uid(2), intentId: uid(3), reservedAt: 1000, authorizationUntil: 3000, issueEnvelopeUntil: 2000, maxBytes: 1024, policyEpoch: 1, policyDigest: "b".repeat(64) }, originalEnvelope: raw, current: tag === "staged" ? { lifecycle: "reserved", revision: 0, intentStatus: "open", intentRevision: 0, initialClosed: false } : { lifecycle: "registered", revision: 10, intentStatus: "succeeded", intentRevision: 4, initialClosed: false }, issuanceAuthorized: false, ...(tag === "staged" ? { commitConfirmed: false } : {}) };
  return { reply, codec };
}
const rows = (value: unknown) => [{ reservation_reply: value }];
function seed() { return { tag: "seed", ownerId: A, requestId: uid(4), policyId: "asset-upload", policyEpoch: 1, policyDigest: "b".repeat(64), now: 1000, issuanceAuthorized: false,
  policy: { bodyVersion: 1, collectors: [B], incomingBucket: "synthetic-incoming", intentTtlMs: 2000, issueEnvelopeMs: 1000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3, maxPreparationAgeMs: 1000, policyManagers: [B], providerMaxBytes: 1048576, verifiers: [B] } }; }
describe("B33 exact SQL reply and original history", () => {
  it("detaches a strict seed and never accepts it in reserve phase", () => {
    const value = seed(), decoded = decodeReservationReply(rows(value), "read", A, request);
    expect(decoded.tag).toBe("seed"); if (decoded.tag !== "seed") throw new Error();
    value.policy.verifiers[0] = A; expect(decoded.seed.policy.verifiers).toEqual([B]); expect(Object.isFrozen(decoded.seed.policy.verifiers)).toBe(true);
    expect(() => decodeReservationReply(rows(seed()), "reserve", A, request)).toThrow();
  });
  it.each([{ now: -0 }, { now: "1000" }, { ownerId: B }, { requestId: uid(8) }, { policyId: "other" }, { issuanceAuthorized: true }, { body_digest: "invented" }])("rejects malformed/misbound seed", change => expect(() => decodeReservationReply(rows({ ...seed(), ...change }), "read", A, request)).toThrow());
  it.each([{ incomingBucket: "bucket\n" }, { verifiers: [] }, { collectors: ["11111111-1111-9111-8111-111111111111"] }, { maxIssues: 1001 }, { issueEnvelopeMs: 3000 }, { intentTtlMs: "2000" }, { providerMaxBytes: 2147483649 }])("rejects unsupported policy shape/bounds", change => expect(() => decodeReservationReply(rows({ ...seed(), policy: { ...seed().policy, ...change } }), "read", A, request)).toThrow());
  it("validates ORIGINAL snapshot separately from evolved current fragment", () => {
    const { reply, codec } = history(); const decoded = decodeReservationReply(rows(reply), "read", A, request);
    expect(decoded.tag).toBe("replay"); if (decoded.tag !== "replay") throw new Error();
    expect(decoded.record.current.lifecycle).toBe("registered"); expect(decoded.record.fingerprint).toBe(codec.fingerprint);
    expect(decoded.record.rawSha).toBe(codec.rawSha); expect(decoded.record.issuanceAuthorized).toBe(false);
    expect(Object.isFrozen(decoded.record.current)).toBe(true); expect("originalEnvelope" in decoded.record).toBe(false);
  });
  it("requires exact prepared raw for staged, but permits original raw for racing replay", () => {
    const { reply } = history("staged"); expect(() => decodeReservationReply(rows(reply), "reserve", A, request, "different")).toThrow("REPLY_INVALID");
    expect(decodeReservationReply(rows(reply), "reserve", A, request, reply.originalEnvelope).tag).toBe("staged");
    expect(decodeReservationReply(rows(history().reply), "reserve", A, request, "different").tag).toBe("replay");
  });
  it.each([[], [{ reservation_reply: null }], [{ reservation_reply: [] }], [{ reservation_reply: { tag: "replay" }, extra: 1 }], rows({ tag: "unknown" }), rows({ tag: "POLICY", detail: "secret" })].map(input => ({ input })))("rejects malformed row/phase/extra fields", ({ input }) => expect(() => decodeReservationReply(input, "read", A, request)).toThrow("REPLY_INVALID"));
  it.each(["CONFLICT", "ISOLATION", "ACTOR_REQUIRED", "INPUT", "POLICY_LOCK", "POLICY", "UNAVAILABLE"] as const)("preserves exact read failure %s", tag => {
    expect(decodeReservationReply(rows({ tag }), "read", A, request)).toEqual({ tag }); expect(reservationFailureReason(tag)).toBeTruthy();
  });
  it.each(["STALE_SEED", "IDENTITY_CONFLICT"] as const)("permits write-only failure %s", tag => {
    expect(decodeReservationReply(rows({ tag }), "reserve", A, request)).toEqual({ tag });
    expect(() => decodeReservationReply(rows({ tag }), "read", A, request)).toThrow();
  });
  it("rejects wrong phase, actor, identity, unsafe/coerced values and raw duplicate/numeric loss", () => {
    const { reply } = history("staged"); expect(() => decodeReservationReply(rows(reply), "read", A, request)).toThrow();
    expect(() => decodeReservationReply(rows(history().reply), "read", B, request)).toThrow();
    for (const change of [{ objectId: uid(9) }, { maxBytes: "1024" }, { reservedAt: NaN }, { policyEpoch: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => decodeReservationReply(rows({ ...history().reply, reservation: { ...reply.reservation, ...change } }), "read", A, request)).toThrow();
    for (const raw of [history().reply.originalEnvelope.replace('"codecVersion": 1', '"codecVersion":1,"codecVersion":1'), history().reply.originalEnvelope.replace('"reservedAt": 1000', '"reservedAt": 1e3')]) expect(() => decodeReservationReply(rows({ ...history().reply, originalEnvelope: raw }), "read", A, request)).toThrow();
  });
  it("rejects wrong staged current/counters, forged capability and extra COMMIT claim", () => {
    const { reply } = history("staged");
    for (const current of [{ ...reply.current, revision: 1 }, { ...reply.current, lifecycle: "registered" }]) expect(() => decodeReservationReply(rows({ ...reply, current }), "reserve", A, request, reply.originalEnvelope)).toThrow();
    expect(() => decodeReservationReply(rows({ ...history().reply, commitConfirmed: true }), "read", A, request)).toThrow();
    expect(() => decodeReservationReply(rows({ ...history().reply, capability: "secret-url" }), "read", A, request)).toThrow();
    expect(() => decodeReservationReply(rows({ ...history().reply, current: { ...reply.current, revision: -0 } }), "read", A, request)).toThrow();
  });
  it("business reply getters are rejected before evaluation", () => {
    let touched = 0; const value = { get tag() { touched++; return "seed"; } };
    expect(() => decodeReservationReply(rows(value), "read", A, request)).toThrow(); expect(touched).toBe(0);
  });
});
