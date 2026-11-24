import "server-only";
import Database from "better-sqlite3";
import { z } from "zod";
import type { DatabaseHandle } from "../db/connection";
import { isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { timelineService } from "../services/timeline";
import {
  evaluateReferenceApplyLifecycle, referenceApplyAuthoritySchema, referenceApplyConfirmationSchema,
  referenceApplyPendingSchema, referenceApplyPermissionGeneration, referenceApplyReceiptGenerationsSchema, sameReferenceApplyScope,
} from "./apply-lifecycle";
import { planReferenceSceneMove, referenceTimelineFailure } from "./project-apply";

type Pending = z.infer<typeof referenceApplyPendingSchema>;
type Stored = z.infer<typeof referenceApplyConfirmationSchema>;
type Row = { status: string; state_json: string | null; plan_json: string | null };

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const planSchema = z.strictObject({
  selectionId: z.string().regex(/^video-cut-[1-9][0-9]{0,2}$/),
  moveSceneId: z.uuid(), afterSceneId: z.uuid(),
});
const transition = { type: "cut", durationFrames: 0 } as const;
const unavailable = { status: "unavailable" } as const;
const preparationRejected = Symbol("rea-preparation-rejected");

type Options = {
  /** Recompute authorized scope and analysis on the supplied connection from trusted server inputs. */
  resolveAuthority: (handle: DatabaseHandle, actor: VerifiedActor, scope: Pending["scope"]) => unknown;
  nowMs: () => number;
  receiptRetentionMs: number;
};

/**
 * Uses a table provisioned exclusively by the isolated synthetic fixture. No product migration or request entry.
 * Callers own real authentication, registered-file/snapshot hashing and restore-generation verification.
 */
export function syntheticReferenceApplyStore(handle: DatabaseHandle, options: Options) {
  const { sqlite } = handle;
  const timelines = timelineService(handle);
  const retention = options.receiptRetentionMs;
  if (!Number.isSafeInteger(retention) || retention < 1) throw new Error("REA_RECEIPT_RETENTION_INVALID");
  const read = sqlite.prepare<[string], Row>("SELECT status, state_json, plan_json FROM rea_synthetic_apply WHERE id = ?");
  const insert = sqlite.prepare(`INSERT INTO rea_synthetic_apply (id, status, state_json, plan_json)
    VALUES (?, 'pending', ?, ?) ON CONFLICT(id) DO NOTHING`);
  const consume = sqlite.prepare("UPDATE rea_synthetic_apply SET status = 'consuming' WHERE id = ? AND status = 'pending'");
  const finish = sqlite.prepare(`UPDATE rea_synthetic_apply SET status = 'completed', state_json = ?, plan_json = NULL
    WHERE id = ? AND status = 'consuming'`);
  const terminate = sqlite.prepare(`UPDATE rea_synthetic_apply SET status = ?, state_json = NULL, plan_json = NULL
    WHERE id = ? AND status = 'pending'`);

  function retire(confirmationId: string, status: "cancelled" | "expired" | "stale" | "conflict") {
    if (terminate.run(status, confirmationId).changes !== 1) throw new Error("REA_CONFIRMATION_RETIRE_FAILED");
    return { status };
  }

  function lookup(actor: VerifiedActor, confirmationId: string) {
    const row = read.get(confirmationId);
    if (!row?.state_json || (row.status !== "pending" && row.status !== "completed")) return;
    const parsed = referenceApplyConfirmationSchema.safeParse(JSON.parse(row.state_json));
    if (!parsed.success || parsed.data.status !== row.status || parsed.data.confirmationId !== confirmationId ||
      parsed.data.scope.ownerId !== actor.id) return;
    const state = parsed.data;
    const authority = options.resolveAuthority(handle, actor, state.scope);
    return { row, state, authority };
  }

  function receiptGenerationsFor(authority: unknown, state: Pending) {
    const current = referenceApplyAuthoritySchema.safeParse(authority);
    if (!current.success || !sameReferenceApplyScope(current.data.scope, state.scope)) return;
    const generations = referenceApplyReceiptGenerationsSchema.safeParse(current.data.receiptGenerations);
    if (generations.success && generations.data.linkGeneration === state.basis.linkGeneration &&
      referenceApplyPermissionGeneration(generations.data) === state.basis.permissionGeneration) return generations.data;
  }

  function planFor(state: Pending, mapping: z.infer<typeof planSchema>) {
    try {
      return planReferenceSceneMove(timelines, {
        projectId: state.scope.projectId, expectedRevision: state.basis.contentRevision,
        expectedTimelineId: state.basis.timelineId, moveSceneId: mapping.moveSceneId, afterSceneId: mapping.afterSceneId,
      }, transition);
    } catch (error) { return referenceTimelineFailure(error); }
  }

  function prepare(
    actor: VerifiedActor, input: unknown, verifiedPlan: unknown,
    publishAnalysis?: (db: DatabaseHandle) => boolean,
  ) {
    if (!isVerifiedActor(actor) || sqlite.inTransaction) return unavailable;
    const parsed = referenceApplyPendingSchema.safeParse(input);
    const mapping = planSchema.safeParse(verifiedPlan);
    if (!parsed.success || !mapping.success || parsed.data.scope.ownerId !== actor.id) return unavailable;
    const state = parsed.data;
    try {
      return sqlite.transaction(() => {
        // Trusted fixture publication shares this transaction and is rolled back on any rejected preparation.
        if (publishAnalysis && !publishAnalysis(handle)) throw preparationRejected;
        const authority = options.resolveAuthority(handle, actor, state.scope);
        const decision = evaluateReferenceApplyLifecycle({ confirmationId: state.confirmationId, action: "confirm" },
          authority, state, options.nowMs());
        if (decision.status !== "eligible" || !receiptGenerationsFor(authority, state)) throw preparationRejected;
        const plan = planFor(state, mapping.data);
        if (plan.status !== "ready" && plan.status !== "no_change") throw preparationRejected;
        if (insert.run(state.confirmationId, JSON.stringify(state), JSON.stringify(mapping.data)).changes !== 1) {
          throw preparationRejected;
        }
        return { status: "prepared", confirmationId: state.confirmationId } as const;
      }).immediate();
    } catch (error) {
      if (error === preparationRejected) return unavailable;
      throw error;
    }
  }

  function readReceipt(actor: VerifiedActor, confirmationId: string) {
    if (!isVerifiedActor(actor) || !idSchema.safeParse(confirmationId).success || sqlite.inTransaction) return unavailable;
    return sqlite.transaction(() => {
      const found = lookup(actor, confirmationId);
      if (found?.state.status !== "completed") return unavailable;
      return evaluateReferenceApplyLifecycle({ confirmationId, action: "read_receipt" }, found.authority, found.state, options.nowMs());
    }).deferred();
  }

  function cancel(actor: VerifiedActor, confirmationId: string) {
    if (!isVerifiedActor(actor) || !idSchema.safeParse(confirmationId).success || sqlite.inTransaction) return unavailable;
    return sqlite.transaction(() => {
      const found = lookup(actor, confirmationId);
      if (found?.state.status !== "pending") return unavailable;
      if (!receiptGenerationsFor(found.authority, found.state)) return unavailable;
      return retire(confirmationId, "cancelled");
    }).immediate();
  }

  function apply(actor: VerifiedActor, confirmationId: string, confirmed: boolean) {
    if (!isVerifiedActor(actor) || !idSchema.safeParse(confirmationId).success || confirmed !== true || sqlite.inTransaction) {
      return unavailable;
    }
    let entered = false;
    try {
      return sqlite.transaction(() => {
        entered = true;
        const found = lookup(actor, confirmationId);
        if (!found) return unavailable;
        const { state, authority, row } = found;
        const startedAtMs = options.nowMs();
        const decision = evaluateReferenceApplyLifecycle({ confirmationId, action: "confirm" }, authority, state, startedAtMs);
        if (state.status === "completed") return decision;
        const receiptGenerations = receiptGenerationsFor(authority, state);
        if (!receiptGenerations) return unavailable;
        if (decision.status === "expired" || decision.status === "stale" || decision.status === "conflict") {
          return retire(confirmationId, decision.status);
        }
        if (decision.status !== "eligible" || !row.plan_json) return unavailable;

        const mapping = planSchema.safeParse(JSON.parse(row.plan_json));
        if (!mapping.success) return unavailable;
        const plan = planFor(state, mapping.data);
        if (plan.status === "conflict") {
          return retire(confirmationId, "conflict");
        }
        if (plan.status !== "ready" && plan.status !== "no_change") return unavailable;
        if (consume.run(confirmationId).changes !== 1) throw new Error("REA_CONFIRMATION_CONSUME_FAILED");

        const { projectId } = state.scope;
        let outcome: "applied" | "no_change";
        let appliedTimeline: { timelineId: string; timelineRevision: number; contentRevision: number };
        if (plan.status === "ready") {
          const saved = timelines.save(projectId, state.basis.contentRevision, state.basis.timelineId, plan.timeline);
          outcome = saved.created ? "applied" : "no_change";
          appliedTimeline = { timelineId: saved.timelineId, timelineRevision: saved.timelineRevision, contentRevision: saved.revision };
        } else {
          const current = timelines.state(projectId).current;
          if (!current || current.id !== state.basis.timelineId) throw new Error("REA_CURRENT_TIMELINE_MISSING");
          outcome = "no_change";
          appliedTimeline = { timelineId: current.id, timelineRevision: current.revision, contentRevision: state.basis.contentRevision };
        }
        const completedAtMs = options.nowMs();
        const retainUntilMs = completedAtMs + retention;
        if (!Number.isSafeInteger(completedAtMs) || completedAtMs < startedAtMs || !Number.isSafeInteger(retainUntilMs)) {
          throw new Error("REA_RECEIPT_COMPLETION_TIME_INVALID");
        }
        const completed: Stored = {
          schemaVersion: 2, confirmationId, scope: state.scope, status: "completed", retainUntilMs, receiptGenerations,
          receipt: { outcome, ...appliedTimeline, completedAtMs },
        };
        if (finish.run(JSON.stringify(completed), confirmationId).changes !== 1) throw new Error("REA_CONFIRMATION_FINISH_FAILED");
        return { status: outcome };
      }).immediate();
    } catch (error) {
      if (!entered && !sqlite.inTransaction && error instanceof Database.SqliteError && error.code === "SQLITE_BUSY") {
        return { status: "busy", retryable: true } as const;
      }
      throw error;
    }
  }

  return { prepare, apply, readReceipt, cancel };
}
