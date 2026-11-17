# B19-FIX4 — Retained causal counter prefixes and reclaim order

- Owner: Codex(Backend); Master `msg_babab32a0bcc` / `msg_193d1e207fda`.
- Full final B19-R4 `f28e8e9a` read, fixed original `803bbab`; original two failed expectations retained.
- Status: **ready_review — author regression complete, same-reviewer recheck pending**.
- Last actual check: **2026-11-17 23:32:48 KST (14:32:48 UTC)**.
- Changes only `state.ts`, appended focused tests and this handoff. No schema/new fields/full event log, original test expectations or other protocol modules changed.

## R4-N1 — Completion counter's own causal prefix

The earlier aggregate lower bound did not constrain a historical completedRevision sufficiently. Each operation now checks its own retained prefix:

```text
B = predecessor completedRevision, or0 for the initial operation
R = one reservation event;0 when predecessor canceled by this same supersession event
C = fence claim events; for canceled operation fence−1 because cancel also increments fence
P = one retained publication event for this operation, otherwise0
T = one terminal event, or0 while pending
I = initial intent's retained issue reservation+dispatch events;0 for reverify
minimum = B + R + C + P + T + I
target = completedRevision if terminal, current aggregate revision if pending
require target >= minimum
```

For the reproduced initial success, retained reservation1+claim1+publication1+finalize1 derive4; no literal `minimum4` policy was added. Reclaim requires another claim event. Reverify starts after the predecessor's retained completion; supersession shares its cancellation/reservation event instead of double-counting it.

This is a **conservative retained prefix**, not exact whole-history reconstruction. Renewals/policy changes/unretained replaced publication records can make true counters larger. A test explicitly accepts the retained minimum5 for a two-claim completion whose actual trace also had a replaced earlier publication (actual6); that removed event is not fabricated as retained proof. Larger aggregate counters, including MAX_SAFE_INTEGER for an unchanged completed snapshot, remain valid; a subsequent overflowing proposal rejects.

Initial issue reservations/dispatches necessarily preceded initial closure, but bound reconciliation can occur **after** failure/success. It is excluded from past completion/closure minima. For GC's own claimedRevision, all known horizons/reconciliation facts necessarily predate the claim, so its separate lower bound includes them and handles a shared first-GC cancellation once. Post-claim observations and later policy changes are excluded. Tests prove that adding later reconciliation/policy/observations does not move old completion/claim minima retroactively.

## R4-N2 — Older publication lease before a newer claim

The contemporaneous publication claim is now compared to a newer retained current claim or canceledClaim: when newer fence>publication fence, old publication leaseUntil≤newer claimedAt. Reclaim can only occur after expiry, and lease renewals cannot shrink, so this necessary order still holds when intermediate fences are not retained. No full claim log or new field is required.

Old fence1 lease5/publication2 and new different-worker fence2 claimedAt6 remain valid, both live and after cancel21. Altering only old leaseUntil to7 now rejects INPUT; equality6 is permitted. Same-fence renewal remains a different relationship: publication's old lease5 may be≤later retained lease8 with claimedAt1, and cancel9 remains valid. Old worker/historical allowlist is not replaced by today's worker/set. Stale publication still cannot issue new IO; re-reservation captures the authorized current claim as before.

## Adjacent retained-causality audit

- Pending progress uses the same reservation/claim/publication lower bound against current aggregate, without requiring terminal evidence.
- Terminal generations derive from the preceding retained completion; canceled predecessor reservation sharing is explicitly tested with both claimed/unclaimed supersession.
- Initial cancel's fence includes its cancel event; it is not incorrectly counted as another claim.
- Empty intent closure/GC and initial terminal/GC shared-versus-separate events are distinguished; prior closure remains unchanged.
- Capability reconciliation after a failure does not increase that past failure's minimum; it does increase GC's later prefix when its horizon had to be known before deletion eligibility.
- First closure, same-fence claim/window, receipt issuer/time, policy, current state, terminal replay, fingerprint V2, retired IDs and descriptor/getter checks remain unchanged. No arbitrary model-now ceiling, new TTL, exact upload transition-count equality or extra authority is introduced.

## Exact tests, commands and preserved originals

```text
# repository root
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads/state.ts tests/storage-upload-protocol.test.ts --max-warnings 0
git diff --check -- lib/storage/uploads/state.ts tests/storage-upload-protocol.test.ts docs/handoffs/B19-FIX4-UPLOAD-PROTOCOL.md

# cwd D:/starwork/b19-fix-regression-20261117-2237
node D:/starwork/dream-ai-studio/node_modules/vitest/vitest.mjs run --root D:/starwork/b19-fix-regression-20261117-2237 --config D:/starwork/dream-ai-studio/vitest.config.ts tests/b19-r-independent.test.ts tests/b19-r2-additional.test.ts tests/b19-r3-additional.test.ts tests/b19-r4-additional.test.ts
```

- Focused **56 PASS**,0skip: original52 retained as LF-normalized source prefix,4 appended causal-prefix/reclaim tests. Existing21-state matrix and seeded assertions retained without weakening.
- Unchanged independent **27 PASS /17 PASS /12 PASS /9 PASS**,0skip, including R4's original two failed INPUT expectations. CLI combined displays65; overlapping suites are not presented as65 additional unique coverage or added to focused56.
- Original bounded audit still **1,536=660 accepted+876 rejected**. No exhaustive history, actual IO or distributed CAS proof.
- Root tsc/targeted ESLint exit0; diff check clean. No Next typegen/build/shared.next mutation. These are author reruns, not independent reviewer acceptance.

R4 harness original/copy SHA256 both `8D1D4F829FA30B833A00C9C2403A0353CD31C03CA20895D3FC3F0C24588DC345`. Prior byte-unchanged copies retain previously recorded27/17/12 hashes. Copies execute current-source aliases from the existing repo config while root/cwd remain in the owned regression directory. Original review archives/config/expectations/count artifacts are untouched. No skipped or reversed rejection.

## B20 safe checkpoint and remaining scope

Before FIX4, conditional B20 synthetic runner finished/stopped its owned cluster `tmp/b20-postgres-1f6ee4cf-6415-4e9d-94d4-9d8aabba2636`, PID62852/loopback57466. `cleanup-safe.json` confirms postmasterPidAbsent=true/listenerAbsent=true; no live owned DB transaction/process remains. Preliminary10PASS/2FAIL are **not schema completion**: a PL/pgSQL record named `r` conflicted with SQL alias `r` in a deferred guard, rolling back the R1 transaction; following empty-fixture rejection assertion then failed dependently. The prior unsafe identifier whitelist bug was corrected without weakening identifier checks; the new SQL error is separate. No draft repair occurred after the FIX4 priority switch.

B20's original three untracked draft/schema-test/local-runner paths remain unfinished, unstaged and excluded. Existing columns can represent FIX4 relations without new protocol fields, but a future SQL guard/executor must implement the same causal-prefix and lease ordering rules and preserve shared versus distinct events. Pure checkedModel arithmetic is not real lock/atomic CAS/provider proof; no schema acceptance or published SQL/history/manifest/runner change follows from this fix.

No actual IO/SQL/provider/Storage/Auth/API/worker/package/config/paid/3013/shared.next/operational deployment action during FIX4. Trusted injected snapshots/principal/clock/confirmed knowledge/quiescence are not authenticated by these consistency checks; coherent whole-history authority forgery remains outside the pure model boundary.

Master transfer: **B19-FIX4 ready_review. Historical completedRevision/pending progress now obey field-derived causal prefix (reservation, claim fences, retained publication, terminal, predecessor/shared supersession and preclosure issuance), not magic4/exact full-log count; post-completion reconciliation/policy/observations excluded. Older publication lease must end by later retained reclaim claimedAt, preserving same-fence renew and old workers. No new fields. Focused56PASS, original52prefix; unchanged27/17/12/9PASS including original2 failures; tsc/lint/diffcheck clean,1536=660/876 unchanged. B20 cluster stopped with evidence, unfinished draft/SQL alias error preserved; no operational change. Last check23:32:48KST, same-reviewer recheck requested.**
