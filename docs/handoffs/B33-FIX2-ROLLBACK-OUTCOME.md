# B33-FIX2 — preserve observed original ROLLBACK acknowledgement

Status: author implementation, local validation and final B33-R2 reconciliation complete; ready for separate fixed-source re-review. Independent acceptance is pending.

## Basis and authorized diff

Original adapter: `75f6fb8444d492417e0ad5fdaa8349443b69c8c8`. First fix: `0e04ecb81b51afbe856f5278aae4400ffdfb5e79`. The original B33/B33-FIX handoffs and existing B33-R report are preserved. Only the attempt module, its existing test file and this new handoff are changed. The other five modules/two tests, B3, SQL1–5/fuse, harnesses, package/config/env, HTTP/UI/registry and runtime activation are outside this diff.

Tester R2's intermediate report says the original independent six tests now pass, but a new interaction loses observed rollback information. Master assigned FIX2 in msg_fc201e42672c and supplied the precise ACK-before-end evidence in msg_5322961440e3. Original evidence is `D:/starwork/b33r2-review-0e04ecb/late-rollback-evidence.json` and `interactions-ack-before-end.json`. These are reviewer evidence references; this handoff does not relabel them as author's independent tests or native database proof.

Final B33-R2 `eb02cba86682ae2c08452e81709ce03c3b3939ab` was received in msg_6227a0c0141c and confirmed by Master in msg_bde9e9f8b15d. Its final tracked report matches the previously read draft; exact sole original ACK, no COMMIT, ACK-before-end/public-return, wrong/rejected/missing ACK, confirmed-COMMIT priority and immutable returned outcomes were compared with this correction and tests. No additional mandatory gap was established. R2's six new independent interactions were 5 pass / 1 fail on the first-fix source; this FIX2 is not accepted by that prior verdict.

## Observed defect and minimal change

On the first-fix source, query's original-promise handler retained exact COMMIT acknowledgement, while rollback confirmation was assigned only after `await query("ROLLBACK")`. If its bounded wrapper expired first, that await rejected permanently. A real original ROLLBACK acknowledgement observed later, before client end and public return, could settle pending cleanup but never update rolledBack. After reserve had possibly run, the result therefore remained unknown/cleanup ok despite observed rollback confirmation.

The retained original-query handler at attempt line 169 now also sets rolledBack for an exact `text === "ROLLBACK"` / `command === "ROLLBACK"` acknowledgement, only while COMMIT has neither been dispatched nor confirmed. The catch path at line 217 awaits the bounded rollback without assigning durability from its wrapper. This is a two-line source change: add the guarded observation next to COMMIT's observation and remove the await-dependent flag assignment.

No rollback is added. Only the already-dispatched sole rollback can establish this fact. An absent ACK, rejection or wrong command remains unknown when reserve may have run. Dispatching COMMIT remains an unknown boundary until actual COMMIT acknowledgement, and confirmed COMMIT retains precedence over rollback state and cleanup failures. The final result is still constructed once and frozen: later original settlements update private ownership state only.

## Controlled reproduction and regression

Eight new author interaction cases import the actual service/attempt and mock only the existing pool factory. No sleeps or native I/O are used. Before the source fix, three cases failed on first-fix source: an exact late rollback ACK before public return with end arriving after ACK, end preceding ACK, and no end witness. Actual durability was unknown; expected not-applied. The other five controls passed.

The principal reproduction matches Tester's clarified sequence: reserve returns INPUT; one ROLLBACK is dispatched; its 10 ms wrapper deadline expires; at fake clock 15 its original promise resolves with exact ROLLBACK; handlers flush while publicreturned remains false and no client end has occurred; then a positive end event is delivered and the public result returns. COMMIT count stays 0, release count 1 and pool.end count 1. Expected fixed result is not-applied/ADMISSION_REJECTED/cleanup ok. ACK without an end witness still confirms not-applied but cleanup fails at its finite budget. These are distinct driver-fixture observations, not a native socket-close guarantee.

Additional controls check ACK after public return preserves immutable unknown/failed, wrong-tag and rejected rollback provide no confirmation, and a late COMMIT response preserves confirmed-record priority while a ROLLBACK tag received in response to dispatched COMMIT remains unknown. No second SQL or retirement attempt is triggered by late settlement.

## Validation and pending gate

Final author code validation (2026-11-18 06:34 KST), including the precise clock-15 ordering assertion: seven regression files **316 passed / 12 native-disabled skips**, including **79 attempt cases** and a **144-test focused subset** (included in 316). Full project TypeScript and changed-file lint both exit 0; selected diff whitespace validation passes. No code/test changed after these checks. Final R2 report reconciliation subsequently completed; this is author fake-driver validation pending independent FIX2 re-review, not prior-report acceptance or native evidence.

Commands from repository root:

```powershell
$env:DREAM_PG_INTEGRATION='0'
$env:DREAM_PG_B25_SCHEMA_TEST='0'
node node_modules/vitest/vitest.mjs run tests/postgres/reservation-client.test.ts tests/postgres/reservation-replies.test.ts tests/postgres/reservation-attempt.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts tests/postgres/upload-reservation-codec.test.ts tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/reservation-attempt.ts tests/postgres/reservation-attempt.test.ts --max-warnings 0
```

No native DB/parser/cluster, real lost-COMMIT, provider, build, deployment or activation occurred. approved-runtime stays DISABLED, the service remains unwired, and owned-synthetic POJOs still do not authenticate provenance. Actual native adapter execution/shutdown, Auth/B3 integration, full v5 provisioning and operating budgets remain separate gates. A new fixed SHA requires independent re-review.
