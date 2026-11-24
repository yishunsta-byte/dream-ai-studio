import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const millis = z.number().int().nonnegative();
const revision = z.number().int().positive();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const scope = z.strictObject({
  storeId: key, restoreGeneration: key, ownerId: key, projectId: key, assetId: key,
});
const source = {
  linkGeneration: key, permissionGeneration: key, sourceRevision: key,
};
const analysis = {
  analysisId: key, analysisRevision: key, snapshotSha256: sha256,
};
const timeline = {
  timelineId: key, contentRevision: revision,
};
const record = { schemaVersion: z.literal(1), confirmationId: key, scope };
export const referenceApplyPendingSchema = z.strictObject({
  ...record, status: z.literal("pending"), issuedAtMs: millis, executionExpiresAtMs: millis,
  basis: z.strictObject({ ...source, ...analysis, ...timeline }),
});
const receipt = z.strictObject({
  outcome: z.enum(["applied", "no_change"]), timelineId: key, timelineRevision: revision,
  contentRevision: revision, completedAtMs: millis,
});
export const referenceApplyReceiptGenerationsSchema = z.strictObject({
  linkGeneration: key, scopePermissionGeneration: key, ownerPermissionGeneration: key,
});
type ReceiptGenerations = z.infer<typeof referenceApplyReceiptGenerationsSchema>;

const completed = z.strictObject({
  ...record, schemaVersion: z.literal(2), status: z.literal("completed"), retainUntilMs: millis,
  receiptGenerations: referenceApplyReceiptGenerationsSchema, receipt,
});
export const referenceApplyConfirmationSchema = z.discriminatedUnion("status", [referenceApplyPendingSchema, completed]);

export const referenceApplyAuthoritySchema = z.strictObject({
  kind: z.literal("verified"), scope,
  receiptAccess: z.enum(["granted", "denied", "unverified"]),
  receiptGenerations: z.unknown().optional(),
  execution: z.unknown().optional(),
});
const currentExecution = z.strictObject({
  kind: z.literal("verified"), ...source, registeredSha256: sha256,
  analysis: z.strictObject({
    status: z.literal("active"), ...source, ...analysis, completedAtMs: millis, validUntilMs: millis,
  }),
  timeline: z.strictObject(timeline),
});
const requestSchema = z.strictObject({
  confirmationId: key, action: z.enum(["read_receipt", "confirm"]),
});

type Scope = z.infer<typeof scope>;
type LifecycleDecision =
  | { status: "receipt"; receipt: z.infer<typeof receipt> }
  | { status: "unavailable" | "expired" | "stale" | "conflict" | "eligible" };

/** Compose the two permission scopes into the pending execution contract's single generation. */
export function referenceApplyPermissionGeneration(generations: Omit<ReceiptGenerations, "linkGeneration">) {
  return createHash("sha256").update(JSON.stringify([
    "rea-permission-generation-v1", generations.ownerPermissionGeneration, generations.scopePermissionGeneration,
  ])).digest("hex");
}

export function sameReferenceApplyScope(current: Scope, recorded: Scope) {
  return current.storeId === recorded.storeId && current.restoreGeneration === recorded.restoreGeneration &&
    current.ownerId === recorded.ownerId && current.projectId === recorded.projectId && current.assetId === recorded.assetId;
}

/**
 * Pure policy evaluated against one authoritative state snapshot. Authorization, lookup and hashing are
 * server responsibilities. For a write, take the snapshot and consume the confirmation in the same transaction.
 */
export function evaluateReferenceApplyLifecycle(
  request: unknown, authority: unknown, confirmation: unknown, nowMs: number,
): LifecycleDecision {
  const intent = requestSchema.safeParse(request);
  const current = referenceApplyAuthoritySchema.safeParse(authority);
  if (!intent.success || !current.success || !Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "unavailable" };

  const stored = referenceApplyConfirmationSchema.safeParse(confirmation);
  if (!stored.success || stored.data.confirmationId !== intent.data.confirmationId ||
    !sameReferenceApplyScope(current.data.scope, stored.data.scope)) return { status: "unavailable" };

  const state = stored.data;
  if (state.status === "completed") {
    const currentGenerations = referenceApplyReceiptGenerationsSchema.safeParse(current.data.receiptGenerations);
    const recorded = state.receiptGenerations;
    if (current.data.receiptAccess !== "granted" || !currentGenerations.success ||
      currentGenerations.data.linkGeneration !== recorded.linkGeneration ||
      currentGenerations.data.scopePermissionGeneration !== recorded.scopePermissionGeneration ||
      currentGenerations.data.ownerPermissionGeneration !== recorded.ownerPermissionGeneration ||
      nowMs < state.receipt.completedAtMs || nowMs >= state.retainUntilMs) return { status: "unavailable" };
    return { status: "receipt", receipt: state.receipt };
  }

  if (intent.data.action !== "confirm") return { status: "unavailable" };
  const execution = currentExecution.safeParse(current.data.execution);
  if (!execution.success) return { status: "unavailable" };
  const { basis } = state;
  const active = execution.data;
  if (active.linkGeneration !== basis.linkGeneration || active.permissionGeneration !== basis.permissionGeneration) {
    return { status: "unavailable" };
  }
  if (state.issuedAtMs > nowMs || state.executionExpiresAtMs <= state.issuedAtMs) return { status: "unavailable" };
  if (nowMs >= state.executionExpiresAtMs) return { status: "expired" };

  if (active.sourceRevision !== basis.sourceRevision ||
    active.analysis.linkGeneration !== basis.linkGeneration ||
    active.analysis.permissionGeneration !== basis.permissionGeneration ||
    active.analysis.sourceRevision !== basis.sourceRevision ||
    active.analysis.analysisId !== basis.analysisId || active.analysis.analysisRevision !== basis.analysisRevision ||
    active.analysis.completedAtMs > state.issuedAtMs || nowMs >= active.analysis.validUntilMs ||
    active.analysis.snapshotSha256 !== basis.snapshotSha256 ||
    active.registeredSha256 !== basis.snapshotSha256) return { status: "stale" };

  if (active.timeline.timelineId !== basis.timelineId || active.timeline.contentRevision !== basis.contentRevision) {
    return { status: "conflict" };
  }
  return { status: "eligible" };
}
