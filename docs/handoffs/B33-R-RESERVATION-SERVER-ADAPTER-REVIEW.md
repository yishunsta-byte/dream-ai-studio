# B33-R — Independent adapter code and fault review

**Verdict: CHANGES REQUIRED — two reproduced lifecycle faults in fixed75f6fb8.** Author tests, regression, typecheck and lint pass, but independent controllable-promise/deadline tests fail in the dispatch and cleanup branches below. No native database, actual server lost-COMMIT or runtime activation is claimed. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_771a989a5549`, acceptance receipt `msg_711fb3226327`. Date:2026-11-18 Asia/Seoul. Only this report is edited in tracked repository files.

## Fixed basis and validation layers

| Input/check | Actual independent evidence |
| --- | --- |
| Implementation | `75f6fb8444d492417e0ad5fdaa8349443b69c8c8`: six modules, three tests, B33 handoff read in full |
| Accepted design | B32 contract5f01b766991f38da4d1a1e1811c87024f5157d2c, R2d6bd91b; T239 baseline223bd6bc9f7b7854442c586cab0fd500f513d3bf |
| Identity | Before execution, all ten assigned paths plus protected postgres/model/package/tsconfig inputs matched75f6fb8; each file's LF SHA256 retained in review-scratch preflight.json |
| Focused/regression Vitest | **299 passed /12 skipped /0 failed**, seven files; focused subset is **127** (client30/replies35/attempt62), not an additional299+127 independent tests |
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0, full project, no build/typegen |
| Lint | Existing eslint over the nine new TS modules/tests with max-warnings0: exit0 |
| Independent adversarial cases | **4 passed /2 failed**, original modules imported unchanged through existing connection-factory mock; fake timers/performance/deferred original promises, no sleeps/native I/O |

Both native switches were explicitly0 in test subprocesses: DREAM_PG_INTEGRATION and DREAM_PG_B25_SCHEMA_TEST. Twelve skipped codec integration cases are not PostgreSQL verification. The seven-file run includes connection20, B4 project-read22, B25 pure74, storage protocol56 and focused127. No broader suite/build/native run was made.

Review scratch: `D:/starwork/b33r-review-75f6fb8`; actual adversarial fixture/config in owned ignored `D:/starwork/dream-ai-studio/tmp/b33r-review-75f6fb8`. Existing installed pg8.23.1/pg-pool3.14.0/tsx4.23.15/Zod4.6.7/uuid14.0.3/Vitest5.1.0/TS6.0.3/eslint10.15.0 only. Package/lock and dependency versions/primary-source hashes are retained. preflight.json SHA256 `3552a87151df87a3ab074bae556321a8a02aac38141a6c17bcfd045593f8b86f`; installed-dependencies.json SHA256 `daa87956e717ca312ec5c86e0d542bb3030ddf899fa86a2c96441f589d8ee958`.

## F33-1 — Deadline is checked after the next SQL dispatch

**P1, required fix.** Fixed `lib/db/postgres/reservation-attempt.ts:145–155`, with preparation at169–180 and mayReserve flag at181. query() validates lease/signal, then **calls client.query at149**, and only afterward enters bounded() at155. bounded's immediate elapsed-deadline check at127 is too late to prevent that dispatch. No elapsed-time check occurs between synchronous model/ID preparation and the reserve call.

Independent reproduction:

1. Use unchanged fixed service and the existing FakePool/FakeClient fixture definitions/factory mock.
2. Set attemptDeadlineMs100 as the fixture normally does. Trusted synchronous nextRecordId advances fake timers/performance by101ms on its first call, returning three distinct valid UUIDv7 IDs normally.
3. Seed/setup queries have finished and their timers are cleared. Preparation completes at elapsed101ms.
4. Expected: no new reserve statement after the expired budget; no dispatched reservation mutation, so a closed not-applied failure is possible without inventing unknown history.
5. Actual: **reserve_upload_v1 is recorded in client.calls at101ms**, then bounded rejects. Returned result is failure/unknown/cleanup:ok/OUTCOME_UNKNOWN. It emits no COMMIT in this fixture; no actual database mutation or committed late write is claimed.

The same query helper fronts COMMIT/setup/hygiene. If synchronous work consumes the remaining budget, the current helper can dispatch new SQL before recognizing expiry. It also records mayReserve before a dispatch eligibility check, which can manufacture unnecessary unknown state when preparation should have stopped first. This does not bypass SQL5 owner/policy/time guards; it violates the adapter's own stop-new-work deadline boundary and can dispatch admission work the caller's deadline should have prevented.

Minimum correction: check elapsed deadline **immediately before every client.query dispatch**, before side effects/dispatch flags, and handle finalization under the contract's explicit rules. Mark reserve/COMMIT as dispatched only at their actual eligible dispatch boundary. Preserve a confirmed COMMIT irreversibly; do not enqueue rollback/hygiene to fake idle if an older operation is unresolved. Add the controlled synchronous-preparation expiry test and a pre-COMMIT expiry test without extending timing values or relaxing expected behavior.

Evidence: `F33-1-evidence.json` in review scratch contains elapsed101, exact call sequence and returned typed outcome. Failing test name: `F33-1: deadline reached during synchronous preparation must prevent new reserve dispatch`.

## F33-2 — Original query remains pending while cleanup is reported ok

**P2, required cleanup/outcome fix.** Fixed attempt module `Lease.cleanup:107–115`, especially done() at109; original query tracking at148–155 and final outcome at203–206. Lease.done checks only checkout settlement, client end and pool-end settlement. It has **no original-query settlement state**. Timeout marks broken/abandoned but not a persistent unresolved-query cleanup condition.

Independent reproduction holds the original reserve promise forever. After fake attempt deadline100ms, FakeClient release emits positive public end and FakePool.end fulfils. Those witnesses are deliberately distinct from the controlled query producer, which is still unsettled. At elapsed110ms, expected under B32-R2's original-query ownership/unresolved-cleanup requirement: unknown/cleanup:**failed**. Actual: **unknown/cleanup:ok**, with originalSettled=false, releases1, poolEnds1. A later controlled rejection is consumed and cannot change the frozen returned value.

This is a failure of the typed cleanup claim under an injected never-settling driver producer, **not an observed real-pg socket leak**. Real pg normally rejects pending operations when ending a connection; that native behavior and real shutdown are unverified here. The accepted contract nevertheless requires retaining original query ownership until settlement or explicitly failed unresolved cleanup. The existing author test for a never-settling original query checks unknown but omits the cleanup expectation, allowing this branch through its62 attempt cases.

Minimum correction: retain original query settlement in the lifecycle owner, with error/late-settlement sinks installed before racing. Include unresolved original operations in cleanup readiness; after cleanup budget, return failed if a tracked producer remains pending, even when end/pool-end witnesses arrived. A late settlement must not mutate returned cleanup/durability or start more SQL/retries. Keep once-only lease retirement and confirmed-COMMIT record precedence; do not turn a known COMMIT into unknown to repair cleanup reporting.

Evidence: review-scratch `F33-2-evidence.json` records the returned unknown/ok outcome, originalSettled=false and one release/pool end. Failing test name: `F33-2: unresolved original reserve promise cannot be reported as cleanup ok`.

Both were actually sent to Master in `msg_d94d8f08f4a8`. Master confirmed source comparison and assigned a separate minimal B33-FIX in `msg_0aeb707a50cd`; later `msg_f1e1f80344a8` requested final original-source evidence while that FIX remained unaccepted. This review is pinned to75f6fb8 and does not accept moving corrections.

## Independent reproduction and tooling boundary

The fixture copies only original test helper definitions into owned scratch and imports the **unchanged six modules**, mocking the existing connection factory exactly as the original tests do. It adds six independent assertions; successful controls confirm normal factory-mocked success, immutable returned unknown after late COMMIT ACK, valid seed decoding and rejection of a trailing-newline digest. The digest hypothesis was rejected by the control and is **not a third finding**.

The first external-scratch invocation ran zero tests due to server-only/module-resolution setup; its report is retained as adversarial-results.json and is not a product failure. Moved the fixture into owned ignored repo/tmp so it uses normal repository dependency/mock resolution; no original file or expectation changed. The final scratch config also blocks any unmocked pg Pool construction with a throwing sentinel, preventing accidental native I/O if mocking fails. The normal-success control confirms the intended factory mock is active.

The resolved invocation reproduces4 pass/2 fail. A diagnostic repeat, with identical assertions and additional evidence capture only, again gives4 pass/2 fail. Both completed before the assigned moving FIX was reviewed; no FIX acceptance is inferred. Original result artifacts and diagnostic JSON remain separate. Diagnostic result SHA256 `7744e450fdcb7010e8b346d02eb72bfd5f1fc238057f1c396d329bf5e7c77c9d`.

Reproduction command for the frozen-source fixture (current source must first match75f6fb8; later FIX must be reviewed separately):

```powershell
$env:DREAM_PG_INTEGRATION='0'
$env:DREAM_PG_B25_SCHEMA_TEST='0'
node node_modules/vitest/vitest.mjs run --config tmp/b33r-review-75f6fb8/vitest.config.mjs --reporter=json --outputFile=D:/starwork/b33r-review-75f6fb8/adversarial-diagnostic-results.json
```

Expected original-source exit is1 for the two asserted faults, not a native SQL error. No product/test expectation was weakened to obtain this result. While Backend now edits its assigned attempt module/test, further executions would be a different source identity and are not included in this original verdict.

## Other assigned areas reviewed

No additional mandatory fault was established in these examined branches. This is limited source/unit evidence, not an exhaustive proof:

| Area | Evidence/remaining boundary |
| --- | --- |
| Public API/actor/request/config | Service checks genuine B3 actor before request access; additional shared UUID grammar/length; descriptor/plain-data checks and detached config/request snapshots. Invalid actor getter0 and mutation tests pass. Target13 keys/two function OIDs and limits are strict; approved-runtime returns DISABLED before pool creation. |
| Role/function metadata | Private static catalog SQL and checks cover separate restricted login, forbidden ancestors/ownership, exact API edge options/grantor, local role/actor/RC, two fixed function signatures/OIDs/owner/definer/settings/access and namespace facts. No request interpolation. These metadata rows/booleans are mocked: actual query execution/permissions/catalog behavior remain native gates. |
| Surface/SQL boundaries | Repository exposes only two fixed parameterized entries through the private boundary port. B25 INSERT specs are never executed. Fixed git grep finds no app/route imports; only the service imports internal runReservationAttempt. No environment selector/provider/signing/client SQL callback is exposed by the service. |
| Original history/replies | Exact phase/key/row DTO checks, raw strict B25 scan and original B19 reconstruction bind owner/request/IDs/time/hash; original model remains separate from informational evolved-current fragment. Staged requires exact prepared raw/pristine current state. Simulated evolved fragment acceptance is not native evolved-row validation. |
| Numbers/phase/secrets | Client lexical grammar, safe bounds, BigInt time addition, MIME/range minimums, read POLICY/write tag differences and getter rejection are exercised. Closed outcomes do not return raw envelope/policy/driver cause/secret. No confirmed finding from the added malformed-digest negative control. |
| Retained checkout/retirement | Existing tests/control prove mock late success/rejection/never-checkout handling, no SQL on abandoned clients, one release/private fallback/pool end, end witness and late handlers. F33-2 distinguishes missing query ownership from the largely covered checkout ownership. |
| COMMIT/cancellation/retry | Known ACK sets committed record in the tracked operation; cleanup failures retain it. Lost/late ACK simulations preserve unknown/immutability, no automatic retry, explicit same-key mocked reconciliation. Unexpected command tags are not rollback proof. Actual persisted lost reply is not tested. |
| Poison/reentry | Early driver rejection/timeout prevents fake-idle rollback/hygiene/COMMIT; own ALS reentry and pool reuse are rejected. B3 private ALS remains separate; top-level composition prerequisite is not globally enforced by this module. |

## Preserved scope and return

Only this report is staged/committed, with selected whitespace validation. Protected originals matched before tests; subsequent Backend WIP in attempt module/test belongs to its separately assigned FIX and is preserved, not staged or claimed unchanged. T122/T137 WIP preserved. No SQL1–5/fuse/B3/model/harness/package/config/UI/route/env/DSN/managed/provider edit, cluster/parser/native/browser/build/deploy/install or new agent/window/worktree. Test fixtures/artifacts are owned scratch only.

After minimal fixes return a new frozen SHA for assigned re-review and adversarial regression. Native adapter role/ACL/execution, real COMMIT loss and primary reconciliation, socket/late-driver shutdown, evolved lifecycle/Auth/B3 integration, full v5 descriptor/provisioning, budgets and runtime activation remain separate gates. Production remains disabled; prior B28–B31 passes are not adapter proof.

Copyable return:

> B33-R original75f6fb8 CHANGES REQUIRED: baseline299pass/12skip (focused127), tsc/lint0, but independent fake-driver6 cases give4pass/2fail. F33-1 expired deadline during synchronous preparation still dispatches reserve SQL before bounded check. F33-2 never-settled original query returns unknown/cleanup:ok after end/pool witnesses instead of unresolved cleanup:failed. Exact source, controllable reproductions, observed outcomes and minimal fixes above. No additional mandatory gap established; no actual SQL/native/lost-COMMIT proof. Only review report committed, moving FIX preserved; new fixed SHA and separate review required.
