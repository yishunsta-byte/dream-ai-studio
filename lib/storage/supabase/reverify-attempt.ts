import "server-only";
import { z } from "zod";
import type { VerifiedActor } from "@/lib/db/postgres/types";
import { reverifyCommand, type ReverifyDecision } from "@/lib/storage/uploads/reverify";
import { counter, digestSchema, id, parse, recordId, requireProtocol as need } from "@/lib/storage/uploads/schema";
import { checkedModel, operationResult, verificationLease } from "@/lib/storage/uploads/state";
import type { StorageReadCode } from "./errors";
import type { RegisteredSourceObserver } from "./reader";
import { prepareReverifyRead } from "./reverify-read";

// One synthetic worker attempt at a registered-object reverify (no scheduler, storage operations or DB writes here).
// 1. Load the current model. An ended operation is answered from its stored result with no read.
// 2. Before any read: the worker's current lease (authority, revision, fence, lease window, generation, policy,
//    authorization, unchanged state revision) and the caller's finite retry budget. Expiry or contention means no IO.
// 3. One bounded, source-bound read. Authorization, configuration, input, size-bound and caller-abort errors propagate.
// 4. Load the model again and decide only on that latest state: an ended operation returns its stored result, a lost or
//    changed lease throws its existing code, so a command is never prepared from the state the read started on.
// 5. A measurement becomes the existing finalize / rejectVerification command; a 404 or transient read failure is a
//    retry recommendation only while the budget and time allow, and otherwise ends with no command.
export type ReverifyAttemptResult =
  | Readonly<{ outcome: "terminal"; result: ReturnType<typeof operationResult> }>
  | Readonly<{ outcome: "command"; expectedRevision: number; decision: Extract<ReverifyDecision, { action: "finalize" | "rejectVerification" }> }>
  | Readonly<{ outcome: "retry"; transientCode: StorageReadCode; nextAttempt: number; retryUntil: number }>
  | Readonly<{ outcome: "exhausted"; transientCode: StorageReadCode | null }>;
export type ReverifyAttemptInput = Readonly<{
  reader: RegisteredSourceObserver;
  // Storage owner actor for the owner-checked canonical key.
  actor: VerifiedActor;
  // Latest upload model and protocol time, read by the caller's trusted store and clock.
  load: () => Promise<unknown>;
  now: () => number;
  request: unknown;
  signal?: AbortSignal;
}>;
const MAX_ATTEMPTS = 16;
const requestSchema = z.strictObject({ principalId: id, operationId: recordId, fingerprint: digestSchema, expectedFence: counter.min(1), receiptId: recordId,
  notAfter: counter, verifierVersion: z.string().min(1).max(128), toolVersion: z.string().min(1).max(128),
  // attempt is 1-based; retryUntil is the caller's protocol-time limit for recommending another attempt.
  retry: z.strictObject({ attempt: z.number().int().min(1).max(MAX_ATTEMPTS), maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS), retryUntil: counter }) });

async function current(load: ReverifyAttemptInput["load"], now: ReverifyAttemptInput["now"], principalId: string) {
  const model = checkedModel(await load()), at = now();
  need(Number.isSafeInteger(at) && at >= 0, "INPUT");
  return { model, context: { principalId, now: at, expectedRevision: model.revision } };
}
const ended = (model: ReturnType<typeof checkedModel>, operationId: string) => {
  const o = model.operations.find(x => x.id === operationId);
  return o !== undefined && o.status !== "pending";
};

export async function attemptReverify(input: ReverifyAttemptInput): Promise<ReverifyAttemptResult> {
  const r = parse(requestSchema, input.request), lease = { operationId: r.operationId, fingerprint: r.fingerprint, expectedFence: r.expectedFence };
  const terminal = (s: ReturnType<typeof checkedModel>, context: object) =>
    Object.freeze({ outcome: "terminal" as const, result: operationResult(s, r.operationId, r.fingerprint, context) });
  const before = await current(input.load, input.now, r.principalId);
  if (ended(before.model, r.operationId)) return terminal(before.model, before.context);
  verificationLease(before.model, lease, before.context);
  if (r.retry.attempt > r.retry.maxAttempts || before.context.now >= r.retry.retryUntil) return Object.freeze({ outcome: "exhausted" as const, transientCode: null });

  const prepared = await prepareReverifyRead(input.reader, input.actor, before.model, r.operationId, input.signal);

  const after = await current(input.load, input.now, r.principalId);
  need(after.context.now >= before.context.now, "INPUT");
  if (ended(after.model, r.operationId)) return terminal(after.model, after.context);
  const held = verificationLease(after.model, lease, after.context);
  if (prepared.read.status === "unavailable") {
    const code = prepared.transientCode!, until = Math.min(r.retry.retryUntil, held.leaseUntil, held.authorizationUntil);
    return r.retry.attempt < r.retry.maxAttempts && after.context.now < until
      ? Object.freeze({ outcome: "retry" as const, transientCode: code, nextAttempt: r.retry.attempt + 1, retryUntil: until })
      : Object.freeze({ outcome: "exhausted" as const, transientCode: code });
  }
  const decision = reverifyCommand(after.model, { operationId: r.operationId, fingerprint: r.fingerprint, expectedFence: r.expectedFence, receiptId: r.receiptId,
    notAfter: r.notAfter, verifierVersion: r.verifierVersion, toolVersion: r.toolVersion, read: prepared.read }, after.context);
  need(decision.action === "finalize" || decision.action === "rejectVerification", "STATE");
  // The persisted update must compare against the revision used to prepare this command.
  return Object.freeze({ outcome: "command" as const, expectedRevision: after.context.expectedRevision, decision });
}
