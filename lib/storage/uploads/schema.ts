import { z } from "zod";

export const id = z.uuid().refine(v => v === v.toLowerCase());
export const recordId = z.uuidv7().refine(v => v === v.toLowerCase());
export const counter = z.number().int().nonnegative().safe();
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const contextSchema = z.strictObject({ principalId: id, now: counter, expectedRevision: counter });
export type Context = z.infer<typeof contextSchema>;
export class ProtocolError extends Error {
  constructor(public readonly code: "INPUT" | "OWNER" | "AUTHORITY" | "CONFLICT" | "EXPIRED" | "FENCE" | "STATE" | "RECONCILE") { super(code); }
}
export function requireProtocol(condition: unknown, code: ProtocolError["code"]): asserts condition {
  if (!condition) throw new ProtocolError(code);
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ProtocolError("INPUT");
  return result.data;
}
// Return detached immutable snapshots. No caller-owned object is frozen or mutated.
export function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
const formats = {
  "image/png": ["image", "png"], "image/jpeg": ["image", "jpg"], "image/webp": ["image", "webp"],
  "video/mp4": ["video", "mp4"], "video/quicktime": ["video", "mov"], "video/webm": ["video", "webm"],
} as const;
export const identitySchema = z.strictObject({
  ownerId: id, assetId: recordId, bucket: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  key: z.string().max(256), sha256: digestSchema, sizeBytes: z.number().int().positive().max(2 * 1024 ** 3),
  kind: z.enum(["image", "video"]), mime: z.enum(Object.keys(formats) as [keyof typeof formats, ...Array<keyof typeof formats>]),
  providerVersion: z.string().min(1).max(256).nullable(),
}).superRefine((v, ctx) => {
  const [kind, extension] = formats[v.mime];
  if (v.kind !== kind || v.key !== `${v.ownerId}/assets/${v.assetId}/${v.sha256}.${extension}`)
    ctx.addIssue({ code: "custom", message: "Noncanonical identity" });
});
export type ObjectIdentity = z.infer<typeof identitySchema>;
export const sourceSchema = z.strictObject({ bucket: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  key: z.string().min(1).max(512).regex(/^[a-zA-Z0-9/_.-]+$/).refine(v => v.split("/").every(p => p !== "" && p !== "." && p !== "..")),
  providerVersion: z.string().min(1).max(256).nullable() });
export const mediaSchema = z.strictObject({ width: counter.min(1), height: counter.min(1), durationMs: counter.min(1).nullable() });
export const receiptBodySchema = z.strictObject({
  id: recordId, objectId: recordId, identity: identitySchema, operationId: recordId,
  generation: counter.min(1), fence: counter.min(1), policyEpoch: counter, policyDigest: digestSchema, source: sourceSchema, media: mediaSchema,
  verifiedAt: counter, notAfter: counter, verifierId: id,
  verifierVersion: z.string().min(1).max(128), toolVersion: z.string().min(1).max(128),
}).refine(v => v.notAfter > v.verifiedAt && (v.identity.kind === "image" ? v.media.durationMs === null : v.media.durationMs !== null));
export const receiptSchema = z.strictObject({ body: receiptBodySchema, digest: digestSchema });
export type Receipt = z.infer<typeof receiptSchema>;
export const verificationFailureSchema = z.enum(["INVALID_BYTES", "MIME_MISMATCH", "SIZE_MISMATCH", "HASH_MISMATCH", "MEDIA_INVALID"]);
export const verificationSchema = z.strictObject({
  id: recordId, kind: z.enum(["initial", "reverify"]), generation: counter.min(1), fingerprint: digestSchema,
  policyEpoch: counter, policyDigest: digestSchema, authorizationUntil: counter, fence: counter, leaseUntil: counter.nullable(), workerId: id.nullable(),
  expectedStateRevision: counter, status: z.enum(["pending", "succeeded", "failed", "canceled"]),
  receiptId: recordId.nullable(), terminalPayloadDigest: digestSchema.nullable(), failureCode: verificationFailureSchema.nullable(),
});
export const uploadModelSchema = z.strictObject({
  ownerId: id, objectId: recordId, assetId: recordId, intentId: recordId,
  revision: counter, policyEpoch: counter, policyDigest: digestSchema, barrierFence: counter, stateRevision: counter, activeGeneration: counter,
  lifecycle: z.enum(["reserved", "publication_reserved", "registered", "cleanup_claimed", "tombstoned"]),
  intentExpiresAt: counter, issueEnvelopeUntil: counter, maxIssues: counter.min(1).max(1000), closed: z.boolean(),
  verifiers: z.array(id).min(1).max(100), collectors: z.array(id).min(1).max(100), policyManagers: z.array(id).min(1).max(100),
  identity: identitySchema.nullable(), incoming: sourceSchema, media: mediaSchema.nullable(), currentReceiptId: recordId.nullable(), revoked: z.boolean(),
  operations: z.array(verificationSchema).max(1000), receipts: z.array(receiptSchema).max(1000),
  issues: z.array(z.strictObject({ id: recordId, issueUntil: counter, horizon: counter.nullable(), boundEvidence: digestSchema.nullable(), dispatched: z.boolean() })).max(1000),
  publication: z.strictObject({ operationId: recordId, fence: counter.min(1), barrierFence: counter, identityDigest: digestSchema }).nullable(),
  cleanup: z.strictObject({ id: recordId, barrierFence: counter.min(1) }).nullable(),
});
export type UploadModel = z.infer<typeof uploadModelSchema>;
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("complete"), operationId: recordId, kind: z.enum(["initial", "reverify"]), fingerprint: digestSchema, authorizationUntil: counter }),
  z.strictObject({ type: z.literal("claim"), operationId: recordId, fingerprint: digestSchema, expectedFence: counter, leaseUntil: counter }),
  z.strictObject({ type: z.literal("renew"), operationId: recordId, fingerprint: digestSchema, expectedFence: counter, leaseUntil: counter }),
  z.strictObject({ type: z.literal("reservePublication"), operationId: recordId, fingerprint: digestSchema, expectedFence: counter, identity: identitySchema }),
  z.strictObject({ type: z.literal("finalize"), operationId: recordId, fingerprint: digestSchema, expectedFence: counter,
    receiptId: recordId, identity: identitySchema, source: sourceSchema, media: mediaSchema, notAfter: counter, verifierVersion: z.string().min(1).max(128), toolVersion: z.string().min(1).max(128) }),
  z.strictObject({ type: z.literal("rejectVerification"), operationId: recordId, fingerprint: digestSchema, expectedFence: counter, failureCode: verificationFailureSchema }),
  z.strictObject({ type: z.literal("cancel") }),
  z.strictObject({ type: z.literal("claimCleanup"), cleanupId: recordId }),
  z.strictObject({ type: z.literal("observeCleanup"), cleanupId: recordId, expectedBarrierFence: counter, absent: z.boolean(), writerQuiescent: z.boolean(), identityDigest: digestSchema }),
  z.strictObject({ type: z.literal("reserveCapability"), issueId: recordId, issueUntil: counter, horizon: counter.nullable() }),
  z.strictObject({ type: z.literal("dispatchCapability"), issueId: recordId, reservationCommit: z.enum(["confirmed", "unknown", "rolled-back"]) }),
  z.strictObject({ type: z.literal("reconcileCapability"), issueId: recordId, horizon: counter, boundEvidence: digestSchema }),
  z.strictObject({ type: z.literal("advancePolicy"), epoch: counter, policyDigest: digestSchema }),
  z.strictObject({ type: z.literal("revoke") }),
]);
export type UploadCommand = z.infer<typeof commandSchema>;
