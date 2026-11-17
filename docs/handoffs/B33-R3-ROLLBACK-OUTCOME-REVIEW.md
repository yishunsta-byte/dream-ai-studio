# B33-R3 — Sole ROLLBACK acknowledgement fix review

**Verdict: PASS for the assigned code/unit/fault scope.** Fixed5f97f00 closes the reproduced late original ROLLBACK information loss, preserves the original two lifecycle fixes and passes unchanged independent assertions plus regression. No new mandatory gap found in this minimal delta. This is not adapter-native, actual server lost-COMMIT, socket-shutdown or runtime activation evidence. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_f837ba22c8f2`, acceptance receipt `msg_67fd52bbf3f3`. Date:2026-11-18 Asia/Seoul. Only this tracked review report is edited.

## Fixed inputs and preservation

| Artifact | Independent evidence |
| --- | --- |
| Fixed commit | `5f97f007abd2272dff265f19d229e14ab609c7c3` |
| Attempt LF SHA256 | `72a3118bd21c0e6edfb5cc2b44eaaba988273c7733e594193c1be05479af550e` |
| Attempt-test LF SHA256 | `60c13143340686f1343343adec1f15fec74703119c7582fcf8b55dcf7f7d6a57` |
| Author handoff | `docs/handoffs/B33-FIX2-ROLLBACK-OUTCOME.md`, read in full |
| Prior source/review |0e04ecb81b51afbe856f5278aae4400ffdfb5e79 /eb02cba86682ae2c08452e81709ce03c3b3939ab |
| Earlier basis |B33 source75f6fb8, reviewa94e8e1, B32 accepted5f01b76/R2d6bd91b |

Reviewed actual three-path delta: guarded original-ROLLBACK observation added, await-dependent assignment removed, eight author interaction cases added and new FIX2 handoff. The other five modules/two tests and original B33 handoff are unchanged from75f6fb8. Original review documents are unchanged from their creation commits a94e8e1/eb02cba. Before and after execution, current code/protected postgres/model/package/tsconfig inputs matched5f97f00; source hashes independently recalculated. Installed dependency identity rechecked against prior manifest; nothing installed.

Review scratch: `D:/starwork/b33r3-review-5f97f00`; ignored fixtures/config: `D:/starwork/dream-ai-studio/tmp/b33r3-review-5f97f00`. Preflight JSON SHA256 `0a666b5f3666272f9f7771630cdfacc176323c1e2182e747c9e665333f638c0a`. Only diagnostic destinations were changed when copying prior independent fixtures; their assertions/timing/order requirements remain unchanged. Original failure evidence was not overwritten.

## Actual independent validation

| Layer | Result |
| --- | --- |
| Seven related Vitest files | **316 passed /12 skipped /0 failed** |
| Focused subset, included above | **144 passed**: attempt79/client30/replies35 |
| Original independent six-case fixture | **6 passed /0 failed** |
| Previous six finalization interactions | **6 passed /0 failed**, including the unchanged former ACK-before-end/public-return failure; prior five passing interactions preserved |
| Full project tsc | `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0 |
| Changed-file lint | Existing eslint attempt module/test, max-warnings0: exit0 |

The independent fixtures run together as12 tests; their successful report SHA256 is `9c497b9a176776cd8da6ed4ced903f0e81b383338f50a7db676d11911f684828`. Native switches DREAM_PG_INTEGRATION/DREAM_PG_B25_SCHEMA_TEST are explicitly0. Twelve skipped native codec cases are not validation of a database. Fake-driver tests use the existing connection-factory mock, deferred original promises and controlled timers/performance, without sleeps. The throwing unmocked-pg constructor sentinel remains in the scratch config to prevent native fallback.

Commands from repository root:

```powershell
$env:DREAM_PG_INTEGRATION='0'
$env:DREAM_PG_B25_SCHEMA_TEST='0'
node node_modules/vitest/vitest.mjs run tests/postgres/reservation-client.test.ts tests/postgres/reservation-replies.test.ts tests/postgres/reservation-attempt.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts tests/postgres/upload-reservation-codec.test.ts tests/storage-upload-protocol.test.ts --reporter=json --outputFile=D:/starwork/b33r3-review-5f97f00/baseline-tests.json
node node_modules/vitest/vitest.mjs run --config tmp/b33r3-review-5f97f00/vitest.config.mjs --reporter=json --outputFile=D:/starwork/b33r3-review-5f97f00/independent-twelve.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/reservation-attempt.ts tests/postgres/reservation-attempt.test.ts --max-warnings 0
```

## Closure of the exact failed ordering

The original independent sequence is unchanged: reserve returns INPUT; one sole ROLLBACK is dispatched; its wrapper expires at10ms; at15ms the original promise fulfils with exact command ROLLBACK; handlers flush with public result still pending and client end withheld; positive end is then emitted. No COMMIT is sent.

**Actual fixed result at15ms: failure/commit:not-applied/cleanup:ok/reason:ADMISSION_REJECTED**, with one ROLLBACK, zero COMMIT, release1 and poolEnd1. This replaces the prior original-source unknown/ok outcome under identical expectations. Diagnostic record `late-rollback-evidence.json` SHA256 `c9e258b2ecee7f9c96b5040866d309e37a4c47d8540743019419a93e11d32ffa` retains value/order/call list.

Source conclusion: the original-query continuation now records rolledBack only for **query text ROLLBACK + reply command ROLLBACK + no dispatched COMMIT + no confirmed record**. The bounded catch awaits rollback without assigning durability from its wrapper. Thus a wrapper timeout no longer erases an original acknowledgement observed before final outcome selection. It adds no rollback dispatch. Final result construction still prioritizes committed record, then unknown dispatch state, then not-applied, and returns frozen data once.

## Negative and interaction controls

| Condition | Verified behavior |
| --- | --- |
| Exact ACK before/after positive end but before public result | Author controls pass; exact ACK determines not-applied, with cleanup determined separately. Only the before-end order is used as the principal independent reproduction. These are mock orderings, not a claim real pg can deliver every ordering. |
| ACK but missing end witness | not-applied with cleanup:failed at the cleanup budget; acknowledgement does not invent socket closure. |
| No ACK /original promise remains pending | Conservative unknown/cleanup:failed after reserve. Original F33-2 independent case still passes. |
| Wrong reply command or rejection for original ROLLBACK | No rollback confirmation; unknown retained. Exact query/command pairing prevents treating a mismatched COMMIT tag as either confirmed command. |
| ROLLBACK ACK only after public result | Already-returned unknown/failed stays immutable; no new SQL/retry/retirement call. |
| COMMIT dispatched, late COMMIT ACK | Confirmed record retained when observed before outcome selection. A ROLLBACK tag received for dispatched COMMIT stays unknown; no rollback is issued to establish noncommit. |
| Deadline/dispatch | Original synchronous-preparation expiry and independent pre-COMMIT expiry send no ineligible reserve/COMMIT; healthy rollback has finite separate grace. Dispatch flags remain at the eligible dispatch boundary. |
| Original query settlement/cleanup | Original producer remains counted independently of wrapper race; end/pool witnesses alone cannot conceal never-settled query. Settlement within grace is consumed without more SQL; once-only retirement and late handlers preserved. |
| Post-ACK cancellation/hygiene | Previous controls for ACK99/hygiene104 and abort during post-ACK hygiene pass; confirmed state/record is not downgraded. |

No additional independent fixture was needed beyond the exact original12 assertions and the eight new author controls in the79-case attempt suite. This is not exhaustive fault coverage. It does not establish real transaction persistence, network/driver shutdown ordering, primary reconciliation or actual COMMIT response loss.

## Preserved boundaries and next gate

Original F33-1/F33-2 remain closed and new F33-R2-1 is closed in this assigned unit scope. Other five modules/two tests, original B33/R/R2 reports and accepted design remain immutable. approved-runtime stays DISABLED; app/route/environment composition remains absent. Actor/request/target/reply contracts are not widened, no retry or issuance capability added, and B3's private ALS still does not enforce cross-boundary nesting.

Only this report is staged/committed with selected whitespace validation. T122/T137 WIP preserved. No SQL1–5/fuse/B3/model/harness/package/config/env/UI/route/managed/provider change, DB parser/native connection/cluster/PID/port, browser/build/deploy/install or new agent/window/worktree. All actual execution here is code/unit/type/lint validation.

Master acceptance is still required. Any real adapter-native test must be separately assigned, with owned synthetic target/provenance, original source/fuse derivation constraints, real role/catalog/transaction/cleanup evidence and shutdown proof. Evolved lifecycle, Auth/B3 integration, actual lost COMMIT/primary reconciliation, complete v5 descriptor/provisioning/budgets and production activation remain unverified separate gates.

Copyable return:

> B33-R3 fixed5f97f00 PASS for assigned code/unit/fault scope: original independent12 assertions now12pass, including exact10→15ms soleROLLBACK ACK-before-end/public case returning not-applied/ADMISSION_REJECTED/cleanupok with zeroCOMMIT/one release/end. Baseline316pass/12skip includes focused144; tsc/lint0. Wrong/no/rejected/after-return ACK remains conservative/immutable and COMMIT precedence preserved. Original2fault closures/protected sources/runtimeOFF remain intact. No native/parser/cluster or actual lost-COMMIT evidence; Master acceptance and separate native assignment required.
