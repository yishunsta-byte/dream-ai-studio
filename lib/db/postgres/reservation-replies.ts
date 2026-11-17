import "server-only";
import { z } from "zod";
import { assertPlainData, counter as protocolCounter, digestSchema, frozen, id, recordId } from "../../storage/uploads/schema";
import { canonicalJson } from "../../storage/uploads/receipt";
import { reserveUpload } from "../../storage/uploads/state";
import type { ReservationRequestSnapshot } from "../../storage/uploads/reservation-client";
import { encodeUploadReservation } from "./upload-reservation-codec";
import type { ClosedReason, ReservationRecord } from "./reservation-outcome";

export class ReservationReplyError extends Error { constructor() { super("REPLY_INVALID"); } }
const uuid = id.refine(s => s.length === 36), uuid7 = recordId.refine(s => s.length === 36);
const counter = protocolCounter.refine(n => !Object.is(n, -0));
const positive = counter.min(1);
export const reservationPolicySchema = z.strictObject({ bodyVersion: z.literal(1), collectors: z.array(uuid).min(1).max(100), incomingBucket: z.string().refine(s => /^[a-z][a-z0-9-]{0,62}$/.exec(s)?.[0] === s), intentTtlMs: positive, issueEnvelopeMs: positive, keyRule: z.literal("owner/incoming/object/intent:v1"), maxBytes: positive.max(2147483648), maxIssues: positive.max(1000), maxPreparationAgeMs: positive, policyManagers: z.array(uuid).min(1).max(100), providerMaxBytes: positive.max(2147483648), verifiers: z.array(uuid).min(1).max(100) }).refine(v => v.issueEnvelopeMs <= v.intentTtlMs);
const seedSchema = z.strictObject({ tag: z.literal("seed"), ownerId: uuid, requestId: uuid7, policyId: z.literal("asset-upload"), policyEpoch: counter, policyDigest: digestSchema, policy: reservationPolicySchema, now: counter, issuanceAuthorized: z.literal(false) });
export type ReservationSeed = z.infer<typeof seedSchema>;
const dto = z.strictObject({ requestId: uuid7, objectId: uuid7, assetId: uuid7, intentId: uuid7, reservedAt: counter, authorizationUntil: counter, issueEnvelopeUntil: counter, maxBytes: positive.max(2147483648), policyEpoch: counter, policyDigest: digestSchema });
const current = z.strictObject({ lifecycle: z.enum(["reserved", "publication_reserved", "registered", "cleanup_claimed", "tombstoned"]), revision: counter, intentStatus: z.enum(["open", "completion_requested", "succeeded", "canceled", "expired", "failed"]), intentRevision: counter, initialClosed: z.boolean() });
const fields = { reservation: dto, originalEnvelope: z.string().min(1).max(65536), current, issuanceAuthorized: z.literal(false) };
const historySchema = z.discriminatedUnion("tag", [z.strictObject({ tag: z.literal("replay"), ...fields }), z.strictObject({ tag: z.literal("staged"), ...fields, commitConfirmed: z.literal(false) })]);
const failureTags = ["CONFLICT", "ISOLATION", "ACTOR_REQUIRED", "INPUT", "POLICY_LOCK", "POLICY", "UNAVAILABLE", "STALE_SEED", "IDENTITY_CONFLICT"] as const;
export type ReservationFailureTag = typeof failureTags[number];
export type ReservationReply = Readonly<{ tag: "seed"; seed: ReservationSeed }> | Readonly<{ tag: "replay" | "staged"; record: ReservationRecord }> | Readonly<{ tag: ReservationFailureTag }>;
const readTags = new Set<string>(["seed", "replay", "CONFLICT", "ISOLATION", "ACTOR_REQUIRED", "INPUT", "POLICY_LOCK", "POLICY", "UNAVAILABLE"]);
const writeTags = new Set<string>(["staged", "replay", "CONFLICT", "ISOLATION", "ACTOR_REQUIRED", "INPUT", "POLICY_LOCK", "STALE_SEED", "IDENTITY_CONFLICT", "UNAVAILABLE"]);
export function decodeReservationReply(rows: unknown, phase: "read" | "reserve", actorId: string, request: ReservationRequestSnapshot, preparedRaw?: string): ReservationReply {
  try {
    assertPlainData(rows);
    const row = z.array(z.strictObject({ reservation_reply: z.unknown() })).length(1).parse(rows)[0].reservation_reply;
    const tag = z.object({ tag: z.string() }).parse(row).tag;
    if (!(phase === "read" ? readTags : writeTags).has(tag)) throw new ReservationReplyError();
    if (tag === "seed") {
      const seed = seedSchema.parse(row);
      if (seed.ownerId !== actorId || seed.requestId !== request.requestId) throw new ReservationReplyError();
      return frozen({ tag: "seed", seed });
    }
    if (tag !== "replay" && tag !== "staged") return frozen(z.strictObject({ tag: z.enum(failureTags) }).parse(row));
    const h = historySchema.parse(row), raw = h.originalEnvelope;
    if (tag === "staged" && canonicalJson(h.current) !== canonicalJson({ lifecycle: "reserved", revision: 0, intentStatus: "open", intentRevision: 0, initialClosed: false })) throw new ReservationReplyError();
    if (Buffer.byteLength(raw, "utf8") > 65536 || tag === "staged" && raw !== preparedRaw) throw new ReservationReplyError();
    // This preliminary parse constructs only ORIGINAL data. B25 subsequently scans
    // the unchanged raw wire independently, rejecting duplicates/numeric loss.
    const data = JSON.parse(raw);
    assertPlainData(data);
    if (data?.reservation?.ownerId !== actorId) throw new ReservationReplyError();
    const model = reserveUpload(data.reservation, { principalId: actorId, now: data.reservedAt, expectedRevision: 0 });
    const encoded = encodeUploadReservation({ model, requestJson: raw });
    const wire = JSON.parse(encoded.requestJson);
    // Frozen SQL5 subset, not generic B25 Unicode/provider-version compatibility.
    const ascii = (value: unknown): boolean => typeof value === "string" ? !/[^ -~]/.test(value) : value !== null && typeof value === "object" ? Object.entries(value).every(([k, v]) => !/[^ -~]/.test(k) && ascii(v)) : true;
    if (!ascii(wire) || model.incoming.providerVersion !== null || model.incoming.key !== `${actorId}/incoming/${model.objectId}/${model.intentId}` || encoded.requestId !== request.requestId || encoded.maxBytes > request.client.requestedMaxBytes) throw new ReservationReplyError();
    const expected = { requestId: encoded.requestId, objectId: model.objectId, assetId: model.assetId, intentId: model.intentId, reservedAt: model.reservedAt, authorizationUntil: model.intentExpiresAt, issueEnvelopeUntil: model.issueEnvelopeUntil, maxBytes: encoded.maxBytes, policyEpoch: model.policyEpoch, policyDigest: model.policyDigest };
    if (canonicalJson(expected) !== canonicalJson(h.reservation)) throw new ReservationReplyError();
    return frozen({ tag, record: { origin: tag === "staged" ? "created" : "replayed", reservation: expected, current: h.current, fingerprint: encoded.fingerprint, rawSha: encoded.rawSha, issuanceAuthorized: false } });
  } catch { throw new ReservationReplyError(); }
}
export function reservationFailureReason(tag: ReservationFailureTag): ClosedReason {
  switch (tag) {
    case "CONFLICT": return "CLIENT_CONFLICT";
    case "STALE_SEED": return "ADMISSION_STALE";
    case "IDENTITY_CONFLICT": return "IDENTITY_CONFLICT";
    case "INPUT": return "ADMISSION_REJECTED";
    case "UNAVAILABLE": return "SERVICE_UNAVAILABLE";
    default: return "CONFIGURATION_REJECTED";
  }
}
