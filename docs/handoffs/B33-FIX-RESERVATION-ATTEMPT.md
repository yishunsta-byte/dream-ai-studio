# B33-FIX — dispatch deadline and original-query settlement

Status: author implementation/validation and final original-review reconciliation complete; ready for separate fixed-source re-review. Independent acceptance of this fix is pending.

## Scope and basis

Original B33 is `75f6fb8444d492417e0ad5fdaa8349443b69c8c8`; its handoff remains unchanged. Final B33-R is `a94e8e1f5d5357797de054cef57d2d1b63281dc3`, received from Tester in msg_788a2132dbaf and confirmed by Master in msg_afdb1eae124b. The final report was compared with the previously read draft: exactly F33-1/F33-2 remain mandatory, including the explicit pre-COMMIT expiry regression; no additional mandatory gap is established. This fix changes only `lib/db/postgres/reservation-attempt.ts`, `tests/postgres/reservation-attempt.test.ts` and this new handoff. B32's frozen contract and all production-disabled boundaries remain applicable. The other five modules, other two tests, B3, SQL1–5/fuse, old harnesses, config/package/env, HTTP/UI, registry and runtime wiring remain outside this diff.

## Reproduction and corrections

### F33-1: normal SQL was dispatched before checking the deadline

Original attempt lines 144–153 invoked client.query before bounded checked the current clock. A trusted synchronous nextRecordId callback could consume the 100 ms attempt deadline during preparation and still send reserve SQL. The new deterministic test advances the fake performance clock inside that callback. Against the original module it returned unknown/cleanup ok instead of not-applied and actually dispatched reserve. No real clock sleep or source imitation is used.

The query boundary (fixed attempt lines 155–172) now checks adopted/abandoned/broken state, cancellation and the current finite deadline before every normal client.query call, including COMMIT. Reserve may-run and COMMIT-sent flags are set only immediately before actual dispatch, after this check. Expired preparation sends zero reserve/COMMIT calls and permits one confirmed healthy rollback, returning not-applied/SERVICE_UNAVAILABLE. The explicit pre-COMMIT test dispatches/wraps a deferred reserve at clock 0, resolves the actual successful original reply and sets the clock read to 101 before its consumer resumes. No timeout or abort fires: the healthy client sends zero COMMIT, one ROLLBACK and returns not-applied/cleanup ok. This exercises the dispatch guard independently of poisoned-work handling.

Healthy rollback and confirmed-COMMIT hygiene use a separate finite finalization deadline, shared within the attempt and capped by cleanupDeadlineMs. This permits a usable idle transaction to roll back after synchronous preparation exhaustion and bounds hygiene independently of an exhausted normal-work deadline. It does not reopen abandoned or poisoned clients. COMMIT already dispatched is still observed without abort-based rollback; its original acknowledgement remains irreversible.

### F33-2: end observations incorrectly concealed a pending native query

Original Lease.cleanup required checkout settlement, positive client end and pool.end settlement, but did not require the original native query to settle. With a controllable reserve promise held pending and both close observations delivered, the original returned cleanup ok at the attempt deadline. The new test requires the result to remain pending during the 10 ms cleanup budget and then return unknown/cleanup failed.

Lease now retains settlement handlers for every original client.query promise separately from bounded wrapper races (fixed attempt lines 88–95). A pending-query count is increased at dispatch observation and decreased only on actual original fulfillment/rejection; settlement wakes the cleanup waiter. Cleanup's success predicate at line 118 also requires zero unresolved native queries. An end event or fulfilled pool.end cannot satisfy that condition. Query rejection still poisons the client and never establishes server-idle permission for rollback, hygiene or COMMIT. Original handlers and error consumption remain attached after the public result; late events cannot mutate frozen outcomes or cause a second release/end owner.

## Validation

The original implementation failed three observed assertions before the source fix: the two new regressions and the strengthened existing never-settling-query cleanup assertion. After the fix these pass. Added interactions cover reserve fulfillment/rejection inside cleanup grace without further SQL, pending read with no reserve, pending healthy rollback after deadline, cancellation of a pending reserve, unresolved confirmed-COMMIT hygiene with finite finalization grace, and immutable late COMMIT results.

Final author validation (2026-11-18 06:25 KST): related seven Vitest files **308 passed / 12 native-disabled skips**, including **71 attempt fault tests** and **136 focused tests** in total (the focused subset is included in 308, not additional). Full project TypeScript and changed-file lint both exit 0. Nine attempt tests were added; existing pending-query and late-COMMIT cleanup expectations were strengthened. Original B33-R independently reported 299 passed / 12 skipped with focused 127 included, and its separate six adversarial cases yielded 4 pass / 2 fail. Those original-source failures are not acceptance evidence for this moving fix.

Commands executed from the repository root:

```powershell
$env:DREAM_PG_INTEGRATION='0'
$env:DREAM_PG_B25_SCHEMA_TEST='0'
node node_modules/vitest/vitest.mjs run tests/postgres/reservation-client.test.ts tests/postgres/reservation-replies.test.ts tests/postgres/reservation-attempt.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts tests/postgres/upload-reservation-codec.test.ts tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/reservation-attempt.ts tests/postgres/reservation-attempt.test.ts --max-warnings 0
```

Selected diff whitespace validation also passes. The final original B33-R report is unchanged by this fix. Validation is author unit/fake-driver evidence; separate review of the new fixed SHA remains required.

## Limits retained

No native DB/parser/cluster, provider, build or deployment ran. The tests import the real service/attempt and mock only the existing createPostgresPool boundary; controllable promises/events and fake timers/performance model driver behavior. Actual adapter/native close guarantees remain a separately assigned verification scope. approved-runtime remains DISABLED; owned-synthetic target POJOs do not authenticate provenance. No retry, new request identity, issuance capability or runtime activation was added.
