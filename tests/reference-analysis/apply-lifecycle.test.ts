import { describe, expect, it, vi } from "vitest";
import { evaluateReferenceApplyLifecycle } from "../../lib/reference-analysis/apply-lifecycle";

vi.mock("server-only", () => ({}));

const scope = { storeId: "sqlite-one", restoreGeneration: "generation-2", ownerId: "owner-a", projectId: "project-a", assetId: "asset-a" };
const confirmationId = "confirmation-a";
const request = { confirmationId, action: "confirm" };
const readReceipt = { confirmationId, action: "read_receipt" };
const snapshotSha256 = "a".repeat(64);
const basis = {
  linkGeneration: "link-3", permissionGeneration: "grant-5", sourceRevision: "source-7",
  analysisId: "analysis-a", analysisRevision: "analysis-rev-1", snapshotSha256,
  timelineId: "timeline-base", contentRevision: 7,
};
const execution = {
  kind: "verified",
  linkGeneration: basis.linkGeneration, permissionGeneration: basis.permissionGeneration, sourceRevision: basis.sourceRevision,
  registeredSha256: snapshotSha256,
  analysis: { status: "active", linkGeneration: basis.linkGeneration, permissionGeneration: basis.permissionGeneration,
    sourceRevision: basis.sourceRevision, analysisId: basis.analysisId, analysisRevision: basis.analysisRevision,
    snapshotSha256, completedAtMs: 70, validUntilMs: 185 },
  timeline: { timelineId: basis.timelineId, contentRevision: basis.contentRevision },
};
const receiptGenerations = { linkGeneration: basis.linkGeneration, scopePermissionGeneration: "scope-5", ownerPermissionGeneration: "owner-7" };
const auth = { kind: "verified", scope, receiptAccess: "granted", receiptGenerations, execution };
const pending = { schemaVersion: 1, confirmationId, scope, status: "pending", issuedAtMs: 100, executionExpiresAtMs: 180, basis };
const receipt = { outcome: "applied", timelineId: "timeline-saved", timelineRevision: 3, contentRevision: 8, completedAtMs: 140 };
const completed = { schemaVersion: 2, confirmationId, scope, status: "completed", retainUntilMs: 300, receiptGenerations, receipt };
const run = (record: unknown, authority: unknown = auth, now = 150, intent: unknown = request) =>
  evaluateReferenceApplyLifecycle(intent, authority, record, now);

describe("REA confirmation and receipt lifecycle", () => {
  it("allows an explicitly confirmed, authorized pending snapshot within its execution window", () => {
    expect(run(pending, { ...auth, receiptAccess: "denied" }, 100)).toEqual({ status: "eligible" });
    expect(run(pending, auth, 179)).toEqual({ status: "eligible" });
    expect(run(pending, auth, 180)).toEqual({ status: "expired" });
    expect(run(pending, auth, 99)).toEqual({ status: "unavailable" });
    expect(run(pending, auth, 150, readReceipt)).toEqual({ status: "unavailable" });
  });

  it("returns the committed receipt after the old execution window, analysis and timeline have changed", () => {
    const current = { ...auth, execution: { ...execution, timeline: { timelineId: "later", contentRevision: 10 },
      analysis: { status: "cancelled" } } };
    const expected = { status: "receipt", receipt };
    expect(run(completed, current, 220)).toEqual(expected);
    expect(run(completed, { kind: "verified", scope, receiptAccess: "granted", receiptGenerations }, 299, readReceipt)).toEqual(expected);
    expect(run(completed, auth, 300, readReceipt)).toEqual({ status: "unavailable" });
    expect(run(completed, auth, 139, readReceipt)).toEqual({ status: "unavailable" });
    expect(run(completed, auth, 140, readReceipt)).toEqual(expected);
    expect(JSON.stringify(run(completed, current, 220))).not.toMatch(/storeId|Generation|ownerId|scope|assetId|analysis|confirmationId|sha256/);
  });

  it("rejects each previous or unverified generation and legacy completed records for both terminal paths", () => {
    const legacy = { schemaVersion: 1, confirmationId, scope, status: "completed", retainUntilMs: 300, receipt };
    const missing = { ...auth, receiptGenerations: undefined };
    const refreshed = [
      { ...auth, receiptGenerations: { ...receiptGenerations, linkGeneration: "new-link" } },
      { ...auth, receiptGenerations: { ...receiptGenerations, scopePermissionGeneration: "new-scope" } },
      { ...auth, receiptGenerations: { ...receiptGenerations, ownerPermissionGeneration: "new-owner" } },
      { ...auth, scope: { ...scope, restoreGeneration: "new-restore" } },
    ];
    for (const intent of [request, readReceipt]) {
      for (const current of [missing, ...refreshed, { ...auth, receiptAccess: "denied" }, { ...auth, receiptAccess: "unverified" }]) {
        expect(run(completed, current, 220, intent)).toEqual({ status: "unavailable" });
      }
      expect(run(legacy, auth, 220, intent)).toEqual({ status: "unavailable" });
      expect(run({ ...completed, receiptGenerations: undefined }, auth, 220, intent)).toEqual({ status: "unavailable" });
    }
  });

  it("returns a saved no-change result as a terminal receipt", () => {
    const unchanged = { ...receipt, outcome: "no_change", contentRevision: 7, timelineId: basis.timelineId };
    expect(run({ ...completed, receipt: unchanged }, auth, 220)).toEqual({ status: "receipt", receipt: unchanged });
  });

  it("binds pending and completed state to the exact store, restore generation, owner, project, asset and lookup key", () => {
    for (const mismatch of [
      { storeId: "sqlite-clone" }, { restoreGeneration: "generation-3" }, { ownerId: "owner-b" },
      { projectId: "project-b" }, { assetId: "asset-b" },
    ]) {
      for (const record of [pending, completed]) {
        expect(run(record, { ...auth, scope: { ...scope, ...mismatch } })).toEqual({ status: "unavailable" });
      }
    }
    expect(run(completed, auth, 150, { ...request, confirmationId: "other-confirmation" })).toEqual({ status: "unavailable" });
  });

  it("unifies absent records, denied access, cancellation, deletion, unresolved state and invalid authority", () => {
    const unavailable = { status: "unavailable" };
    for (const missing of [undefined, null, { ...pending, status: "cancelled" }, { ...pending, status: "deleted" },
      { ...pending, status: "revoked" }, { ...pending, status: "commit_unknown" }, { ...pending, schemaVersion: 2 }]) {
      expect(run(missing)).toEqual(unavailable);
    }
    expect(evaluateReferenceApplyLifecycle(readReceipt, undefined, completed, 150)).toEqual(unavailable);
    for (const authority of [{ kind: "local", scope }, { ...auth, kind: "denied" },
      { ...auth, receiptAccess: "denied" }, { ...auth, receiptAccess: "unverified" }]) {
      expect(run(completed, authority, 150, readReceipt)).toEqual(unavailable);
    }
    expect(run(pending, { ...auth, execution: { kind: "unverified" } })).toEqual(unavailable);
    expect(run(pending, { ...auth, execution: { ...execution, analysis: { ...execution.analysis, status: "cancelled" } } })).toEqual(unavailable);
    expect(run(completed, auth, Number.NaN)).toEqual(unavailable);
    expect(run(completed, auth, 150, { ...request, ownerId: scope.ownerId })).toEqual(unavailable);
  });

  it("denies previous link and permission generations even with the same asset hash", () => {
    for (const changed of [{ linkGeneration: "after-relink" }, { permissionGeneration: "after-regrant" }]) {
      expect(run(pending, { ...auth, execution: { ...execution, ...changed } })).toEqual({ status: "unavailable" });
    }
  });

  it("requires matching registered and analyzed bytes, active analysis identity, revision and lifetime", () => {
    const otherSha = "b".repeat(64);
    for (const changed of [
      { sourceRevision: "source-replaced" },
      { registeredSha256: otherSha },
      { analysis: { ...execution.analysis, snapshotSha256: otherSha } },
      { analysis: { ...execution.analysis, linkGeneration: "old-link" } },
      { analysis: { ...execution.analysis, permissionGeneration: "old-permission" } },
      { analysis: { ...execution.analysis, sourceRevision: "old-source" } },
      { analysis: { ...execution.analysis, analysisId: "different-analysis" } },
      { analysis: { ...execution.analysis, analysisRevision: "new-revision" } },
      { analysis: { ...execution.analysis, validUntilMs: 150 } },
      { analysis: { ...execution.analysis, completedAtMs: 101 } },
    ]) expect(run(pending, { ...auth, execution: { ...execution, ...changed } })).toEqual({ status: "stale" });

    const badHash = { ...auth, execution: { ...execution, registeredSha256: "unverified" } };
    expect(run(pending, badHash)).toEqual({ status: "unavailable" });
  });

  it("uses both the timeline pointer and content revision as pending CAS and only exposes safe receipts", () => {
    for (const changed of [{ timelineId: "other-timeline" }, { contentRevision: 8 }]) {
      expect(run(pending, { ...auth, execution: { ...execution, timeline: { ...execution.timeline, ...changed } } }))
        .toEqual({ status: "conflict" });
    }
    expect(run({ ...completed, receipt: { ...receipt, sourceUrl: "https://private.invalid/raw" } }))
      .toEqual({ status: "unavailable" });
    expect(run({ ...completed, retainUntilMs: 139 }, auth, 140)).toEqual({ status: "unavailable" });
  });
});
