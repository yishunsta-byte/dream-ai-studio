# B19-FIX2 — Reachable status matrix and cancellation/revision consistency

- Owner: Codex(Backend); Master `msg_f7ec32dc84b5`, final review acknowledgment `msg_7680cae387f9`.
- Addresses B19-R2 `ae671aec` against `7bfd139`: N1 cancellation/closed/completion bounds and N2 aggregate/state revision bounds. Full final report and unchanged new17 harness read.
- Status: **ready_review — author regression complete; same-reviewer acceptance pending**.
- Last actual verification: **2026-11-17 23:04:17 KST (14:04:17 UTC)**. No provider/SQL/worker execution in this fix.
- Changed `schema.ts`, `state.ts`, `operation.ts`, existing focused test and this unique report only. `receipt.ts`/original B19/FIX/review/design unchanged. B20 untracked partial work preserved and excluded.

## State matrix derived from supported transitions

The checker now enforces the joint matrix below, rather than adding only four isolated rejection conditions. `closed` means an initial-upload authority closure; a separate immutable-in-model first `closure` record retains revision/time/principal/historical authorizers/cause. `closed` must equal its presence. No new transition reopens it.

| Lifecycle | Permitted operation/history and fields |
| --- | --- |
| reserved, open | identity/publication/current/media absent, stateRevision0; no operation or generation1 initial pending (unclaimed or leased). No receipts/revocations/cleanup/closure. |
| reserved, closed | Same unbound file state, but first closure retained and no pending operation. May have no operation (cancel before completion), initial canceled, or initial failed before publication. Failed claim fields are historical; canceled active claim fields are empty. |
| publication_reserved, open | Bound immutable identity and matching publication reservation, initial pending operation; stale publication after reclaim may remain historical but cannot issue IO until matching fence is re-reserved. No receipt/current/media/state points. |
| publication_reserved, closed | Bound target and historical publication retained, closure and terminal initial operation, no pending claim. This is the supported cancel/failure waiting-for-GC state; it is **not** an active prepared claim coexisting with closure. |
| registered | closed=false/closure=null/cleanup=null; retained initial success, identity/publication/media, append-only receipts and current highest successful generation. Reverify pending/success/failed permitted; historical canceled reverify must be older than current active generation. Current availability additionally depends on policy/validity/revocation. Registered originals never enter orphan GC. |
| cleanup_claimed | Permanently closed, cleanup identity/fence/time retained, no pending operation or receipts/current/state points. All capability horizons bounded/elapsed at claim. Identity/publication either both absent or historical bound target. Latest cleanup observation absent, or not both absent+quiescent. |
| tombstoned | Same permanent closure, plus latest explicit observation absent=true and writerQuiescent=true, at/after claim. A late observed write returns to cleanup_claimed without reopening authority/key. One404 or an invented lifecycle value alone cannot establish cleanup completion. |

| Operation status | Claim, completion and revision requirements |
| --- | --- |
| pending, unclaimed | Current active generation; fence0; worker/lease/claimedAt=null and claimVerifiers empty; no completion/receipt/failure/terminal payload/canceledClaim. |
| pending, leased | Current active generation; complete claimant/lease/claimedAt/historical verifier-set tuple, positive fence, createdAt≤claimedAt<leaseUntil≤authorizationUntil. No completion or terminal evidence. Expired stored lease is historical data; new work still needs injected current time inside authority. |
| succeeded | Committing worker/lease/claim fields retained as **historical evidence**, not active authority. completedAt inside claim/lease/authorization, exact receipt issuer/time/fence/policy/source/payload binding; completedStateRevision=expectedStateRevision+1, and matching receipt/state point. No canceledClaim. |
| failed | Historical committing claim retained, enumerated failure/fingerprint/time, no receipt. Initial failure closes at stateRevision0. Reverify failure contributes immutable revocation/state point strictly after its expected prior state. It cannot be made ready by changing one boolean. |
| canceled | Active worker/lease/claimedAt=null, claimVerifiers empty, no receipt/failure payload. Optional `canceledClaim` preserves the prior claimant/fence/time/authorization/policy/set; canceled fence=prior fence+1. If never claimed, history=null and fence1. Completion references an existing prior/current state revision, **does not create a new point**. Initial canceled is closed; registered reverify cancellation exists only through supersession by a newer generation. |

Generations are contiguous1..N, initial only generation1, reverify only later generations. Every later reservation includes prior generations' completed state revisions/time. Operation createdAt is explicit; claim and completion cannot predate it. Completed state revisions lie in `[expectedStateRevision,current stateRevision]` and cannot exceed aggregate CAS revision. Receipt/revocation point times are nondecreasing in their state-revision order. Old authority sets and old committing claimants remain separate from today's allowlist.

Publication now records reservedAt and binds it to the appropriate operation/time range, matching successful fence or retained canceled claim. IO projection requires current context at/after the reservation and claim; cleanup projection/observation require time at/after claim/latest observation. These are supplied clock/observation consistency checks, not real provider or DB guarantees.

## Revision semantics and preserved policy

Upload revision must be at least stateRevision and all retained completion revisions, and obey a conservative lower bound derived from retained reservations, minimum claims/terminal inspections, publication, state events, capability issue/dispatch/bound reconciliation and cleanup/observation facts. This is **not an invented exact full execution count**: renewals, repeated observations and policy actions may have advanced the aggregate counter further. Positive controls deliberately accept a larger aggregate counter when it remains internally consistent. Counter overflow still rejects a proposed mutation.

Creation ledger has only fully retained begin/settle/retire mutations, so its own aggregate revision can be checked exactly as entry count+terminal proof count+retirement count. Fingerprint V2, original snapshot/digest recomputation, terminal-first replay, retired-ID nonreuse and descriptor/getter boundaries remain unchanged. Upload canceled result replay is historical read-only and never restores a claim. Success replay still precedes old lease/expiry/CAS checks and cannot change current R2.

## Regression evidence and exact quantities

```text
# repository root
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
git diff --check -- lib/storage/uploads tests/storage-upload-protocol.test.ts docs/handoffs/B19-FIX2-UPLOAD-PROTOCOL.md

# cwd D:/starwork/b19-fix-regression-20261117-2237
node D:/starwork/dream-ai-studio/node_modules/vitest/vitest.mjs run --root D:/starwork/b19-fix-regression-20261117-2237 --config D:/starwork/dream-ai-studio/vitest.config.ts tests/b19-r-independent.test.ts tests/b19-r2-additional.test.ts
```

- Focused **47 PASS**,0skip: original41 source retained as a byte-equivalent LF-normalized prefix;6 appended tests expand the matrix. No original expectation removed/weakened.
- New matrix constructs **21 reachable snapshots by actual transitions**: fresh, initial pending/leased/publication, initial failure/cancel variants, bound/unbound GC, tombstone/late write, registered/revoked, reverify pending/leased/failure/success, claimed/unclaimed supersession, reclaim with old publication. All validate, including historical current-allowlist replacement.
- Inside those6 tests: **142 lifecycle/counter/current-pointer corruption rejection attempts**, **240 operation status/claim/time/revision rejection attempts**, **26 unchanged-status controls**, plus21 original snapshots/21 higher-counter/21 current-verifier replacement controls. Counts are asserted. These are bounded cases inside tests, not382 new independent tests or exhaustive mutation/interleaving proof. Coupled restoration of a canceled live claim is included, not misdescribed as a single-bit mutation.
- Unchanged original independent harness **27 PASS**, and unchanged R2 additional harness **17 PASS**,0skip. Combined runner displays44, but the suites are reported separately and overlap focused traces; no summed coverage claim. All original8 and new4 rejection expectations preserved.
- Same old seeded loop **1,536 attempts=660 accepted+876 rejected**. No new exhaustive-search claim or additional coverage by rerunning its duplicate count audit.
- Root tsc and targeted ESLint exit0, diff check clean. No Next typegen/build/shared.next mutation. These are author reruns, not independent acceptance by the reviewer.

Original fixtures are untouched. Copies under the owned regression directory have the same SHA256 as their originals: original27 `A414F57D14924F2C8601F9C46BD312A20276B532AA9B1642A5805A782B45E3DA`; R2 additional17 `616705768232776B4BC0C775278BABAD6AC5A3E809DB3FF6882EF063F594EE0E`. Existing repository config supplies the current-source alias; root/cwd point to the new directory, so the original review count artifact/config/source remain unchanged. No harness patch, skip or expectation reversal.

## B20 checkpoint and field impact, not schema acceptance

Conditional B20 edits stopped immediately on FIX2 priority. **No new PG cluster/transaction was started during that conditional resume.** Only the original three untracked draft/schema-test/local-runner paths contain incomplete work; none is staged or submitted here. Prior owned PID45528/port65086 had already stopped, with postmasterPidAbsent/listenerAbsent=true evidence recorded in FIX1. No pending owned DB process requires termination now.

Draft impact beyond FIX1: canceled active-slot emptiness must be distinguished from retained canceled-claim history; explicit aggregate/operation reservation times, first closure proof, publication reservation time, cleanup observation/time and completion-revision bounds require a deliberate schema/executor mapping. Upload aggregate revision is a lower-bound-consistent CAS counter, not stateRevision; creation full-owner ledger revision is not automatically a single request row's revision. Future SQL must choose an owner-ledger counter or reviewed projection/locking adapter before claiming that mapping. The partially adjusted draft does not yet embody these rules and is **unfinished/unpublished/unregistered/unaccepted**. B20 is not completed by this protocol fix; no SQL history/manifest/runner expectation is relaxed.

## Trust boundary and handoff

This checks internal data consistency of injected authoritative snapshots, current principal/config/clock and historical observations. It cannot authenticate a coherently fabricated entire authority/history, enforce real transaction locks/CAS/global uniqueness, inspect media/bytes, prove provider immutability/quiescence or implement persistence/external IO. Descriptor preflight still gives ordinary getter reads0/sanitized INPUT and does not sandbox Proxy traps. No numeric TTL/operational policy, signature or new external capability is introduced.

Only the five correction/report paths changed. Original SQL1~3/manifest/history, B20 partial artifacts, reviewer fixtures, product/API/Auth/Storage/worker/runtime/package/config/paid/deployment/3013/shared.next remain unchanged by this fix. No automatic polling or resident service.

Master transfer: **B19-FIX2 ready_review. N1/N2 and broader supported-state matrix implemented: closed↔retained closure/no pending; canceled empty active slot plus historical prior claim; created/claimed/completed time and completion-state/aggregate revision bounds; contiguous generations, valid publication/current/evidence, derived availability and cleanup observation. Original41 prefix preserved, focused47PASS; original27PASS and unchanged new17PASS, original1536=660/876 unchanged.21 reachable snapshots with142+240 bounded rejection attempts and legitimate positive controls; not exhaustive/independent acceptance. Tsc/lint/diffcheck clean. B20 no new execution, unfinished drafts preserved with mapping impacts; last check23:04:17KST. Same-reviewer recheck requested before further schema work.**
