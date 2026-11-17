# B33-R2 — Fixed attempt lifecycle re-review

**Verdict: original F33-1/F33-2 CLOSED; overall CHANGES REQUIRED for one new reproduced late-ROLLBACK information-loss gap.** Fixed0e04ecb passes its308 tests and all six original independent assertions, but a separate finalization interaction still returns unknown after the exact sole ROLLBACK has been acknowledged before end/public return. No native database or real server failure evidence is claimed. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_dc3d4d83b1d6`, acceptance receipt `msg_8def11fb80f2`. Date:2026-11-18 Asia/Seoul. Only this tracked review report is edited.

## Fixed scope and identity

| Artifact | Independent evidence |
| --- | --- |
| Fixed implementation | `0e04ecb81b51afbe856f5278aae4400ffdfb5e79` |
| Attempt LF SHA256 | `3a2c6972749744a7b0588586e3de6dff1f61a6352e1e25a14e5cfa69450886d5` |
| Attempt test LF SHA256 | `93ff5cd91f350af55e6a7886c06d35700ad10ffdfe381f990acc547592d81e70` |
| Author handoff | `docs/handoffs/B33-FIX-RESERVATION-ATTEMPT.md`, read in full |
| Original implementation/review |75f6fb8444d492417e0ad5fdaa8349443b69c8c8 /a94e8e1f5d5357797de054cef57d2d1b63281dc3 |
| Design |5f01b76 and accepted R2d6bd91b; original B33/T239 baseline retained |

Reviewed the actual three-path delta: attempt module, its test, new FIX report. Verified other five modules/two tests/original B33 handoff unchanged against75f6fb8 and original B33-R unchanged against its creation commit a94e8e1. Before tests, current implementation/protected/package/tsconfig inputs matched the fixed source; hashes were independently recalculated. No original SQL1–5/fuse/B3/model/harness/config/route/runtime changes are part of this correction.

Review scratch `D:/starwork/b33r2-review-0e04ecb`; ignored fixture/config directory `D:/starwork/dream-ai-studio/tmp/b33r2-review-0e04ecb`. Existing installed dependencies were read-only verified against original review metadata; no installation. Preflight JSON SHA256 `a9f559a020db43e0c0dffeb3250c442244be55f6b63148b5cf4be4910c3482ba`.

## Actual verification

| Layer | Result |
| --- | --- |
| Related seven Vitest files | **308 passed /12 native-disabled skips /0 failed** |
| Focused subset | **136 passed**: attempt71/client30/replies35, included in308 |
| Full project TypeScript | `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0 |
| Changed-file lint | Existing eslint on attempt module/test with max-warnings0: exit0 |
| Original independent six-case fixture | **6 passed /0 failed**, original assertions unchanged; only evidence-output paths relocated |
| Added independent interaction fixture | **5 passed /1 failed**, plus a repeat strengthening ACK-before-end/public-return ordering: same5/1 |

Native switches DREAM_PG_INTEGRATION and DREAM_PG_B25_SCHEMA_TEST were explicitly0 in all Vitest subprocesses. Fixtures import unchanged product modules through the existing connection-factory mock; a throwing unmocked-pg constructor sentinel prevents accidental native I/O. No SQL parser, cluster, native flags, browser/build/deploy or real credentials used.

The initial review setup erroneously compared the original B33-R document to75f6fb8, before that report existed, so its preservation assertion stopped fixture creation. It was corrected to compare that immutable report with a94e8e1, its creation commit. The resulting config-not-found attempt ran no independent test. This was review bookkeeping, not a product failure or expectation change. Implementation hashes/current fixed identity were confirmed and baseline/type/lint results correspond to0e04ecb.

## Original fault closure and interactions

| Case | Expected /actual fixed result |
| --- | --- |
| F33-1 synchronous preparation at101ms against100ms budget | No reserve/COMMIT dispatch; actual not-applied/cleanup:ok with healthy ROLLBACK. Original independent failing assertion now passes. query155–172 checks budget before dispatch and records dispatch flags afterward. |
| F33-2 original reserve never settles | End/pool-end do not conceal pending producer. Actual unknown/cleanup:failed at cleanup budget; original assertion now passes. Lease.trackQuery88–95 counts original settlement and cleanup118 requires zero pending queries. |
| Pre-COMMIT expiry after actual reserve success | Controlled successful reserve promise at clock0 then clock-read101 without firing timeout/abort. Actual zero COMMIT, one healthy ROLLBACK, not-applied/cleanup:ok. Confirms the guard rather than only poisoned-work handling. |
| COMMIT ACK99, hygiene completes104 | Confirmed record retained; healthy hygiene uses its finite grace beyond normal deadline100; success/cleanup:ok. |
| Abort after COMMIT ACK while hygiene pending | Confirmation/record retained, no ROLLBACK; successful hygiene/cleanup still succeeds. |
| Original COMMIT ACK within cleanup grace | Confirmation/record observed before result is preserved, one retirement/pool end. |
| Original reserve rejects within cleanup grace | Settlement consumed; unknown/cleanup:ok when all closure witnesses arrive, no new SQL. |
| Other original controls | Normal success, valid/invalid seed controls and immutable returned unknown after later COMMIT ACK remain passing. |

Normal deadlines and healthy rollback/confirmed-hygiene grace are distinct in the fixed helper. Poisoned/abandoned work is not reopened to send rollback/hygiene/COMMIT. Finalization grace and resource retirement each have finite budgets; this review does not assert an unconditional combined wall-clock bound or JS preemption during synchronous code. None of these mock assertions proves native close or actual server COMMIT loss.

## New mandatory F33-R2-1 — Late original ROLLBACK ACK is discarded

**P2 outcome-information loss.** Fixed attempt lines167–170 preserve a late exact COMMIT acknowledgement in the original promise's continuation, but only count settlement for other commands. rolledBack is assigned solely by the bounded await at216. Once that wrapper rejects, a later successful original ROLLBACK cannot update it; final branch221 returns unknown when mayReserve is true. This conflicts with the accepted contract's confirmed-ROLLBACK→not-applied classification.

Exact controlled sequence, with attempt budget100ms and cleanup/finalization grace10ms:

1. Fixed service dispatches reserve, whose closed reply is INPUT. No COMMIT is dispatched.
2. Healthy error path dispatches **one sole ROLLBACK**. Hold that exact original promise pending and withhold client end.
3. At10ms its bounded finalization wrapper expires; cleanup starts. At15ms, still before the20ms cleanup cutoff and before any public return, fulfil the **original** promise with exact command **ROLLBACK**.
4. Flush the promise handlers and assert the public result has **not** returned. Only then emit the positive client end event. Private pool.end is already fulfilled; all original query producers are now settled.
5. At15ms, actual result is **failure/commit:unknown/cleanup:ok/OUTCOME_UNKNOWN**. Expected: **commit:not-applied/cleanup:ok** with a closed appropriate reason, because the original sole rollback was acknowledged before outcome selection. One release/one pool end; no COMMIT or second rollback call.

The ACK-before-client-end variant rules out the weaker interpretation that the mock delivered an acknowledgement only after a completed transport end. Its ordering assertions remained unchanged after the failure was captured. The pending query count is correctly cleared and cleanup completes; the lost information is the command acknowledgement itself. This is not a false successful reservation or proof of a real server leak; it loses known noncommit information and forces unnecessary uncertain-outcome reconciliation.

Minimum correction: preserve the exact sole original ROLLBACK acknowledgement in its tracked continuation, before the wrapper/outcome decision, similarly to the existing COMMIT path. Require that no COMMIT was dispatched and command is exactly ROLLBACK; unexpected/rejected/no ACK must stay conservative. Preserve confirmed-COMMIT priority. If the public frozen outcome already returned before a later ACK, do not mutate it or start SQL/retry. Add ACK-inside-cleanup, ACK-after-public-return, wrong-command and rejection controls so only actual acknowledgement can establish not-applied.

Evidence: review-scratch late-rollback-evidence.json records unknown/ok, elapsed15, ACK-before-end/public-return booleans, full statement call list ending in one ROLLBACK, releases1/poolEnds1. interactions-ack-before-end.json is the failed assertion report, SHA256 `efa26319d3d70a31cb58df1806d4248eefbd553ac1e8d3a7781c431e1e34ed26`. Original-six success report SHA256 `25d9fd918d590573429a3dd98a5188bf0785ae4ad719f58ab4eb50d66738a8d0`.

Actually notified Master in `msg_afa649715e92` and confirmed strengthened ordering in `msg_a266c40b1d5b`. Master compared source and assigned separate B33-FIX2 in `msg_2195c546c415`. That moving work is not part of this verdict or accepted here. No additional mandatory gap was established in the assigned correction.

## Reproduction and limits

Original-six expectations are copied unchanged from the original owned fixture; diagnostic file destinations differ to preserve original failure evidence. Added six interactions use the same mock helper definitions and controlled original promises/performance. Run from repository root, with native switches0:

```powershell
node node_modules/vitest/vitest.mjs run --config tmp/b33r2-review-0e04ecb/vitest.config.mjs --reporter=json --outputFile=D:/starwork/b33r2-review-0e04ecb/independent-original-six.json
node node_modules/vitest/vitest.mjs run --config tmp/b33r2-review-0e04ecb/vitest-interactions.config.mjs --reporter=json --outputFile=D:/starwork/b33r2-review-0e04ecb/interactions-ack-before-end.json
```

Fixed0e04ecb gives exit0/six pass for the first and exit1/five pass+one late-ROLLBACK failure for the second. Future executions against moving FIX2 are different evidence and require new fixed identity; do not overwrite original results as if they were0e04ecb. No product source/test or expectation was edited by Tester.

Only assigned report is staged/committed with selected whitespace validation. Preserve Backend moving FIX2 and T122/T137 WIP. No SQL/B3/model/harness/package/config/UI/route/env/DSN/managed/provider edits, DB parser/native cluster/PID/port, build/deploy/install or new agent/window/worktree. Original B33 and R reports remain unchanged.

Adapter-native role/ACL/query execution, actual lost/late COMMIT response and primary reconciliation, real process/socket shutdown, evolved rows/Auth/B3 integration, v5 descriptor/provisioning, budgets and runtime activation remain separate gates. approved-runtime stays disabled; previous direct native harness results do not supply adapter proof.

Copyable return:

> B33-R2 fixed0e04ecb: originalF33-1/F33-2 closed, baseline308pass/12skip with focused136, type/lint0 and original independent6pass. Overall CHANGES REQUIRED for new F33-R2-1: exact sole original ROLLBACK ACK at15ms inside cleanup grace, before client end/public return and with zero COMMIT, still returns unknown/cleanupok. Other5 added interactions pass. Preserve original rollback ACK before outcome selection without changing frozen already-returned results or confirmed-COMMIT priority. No native proof/runtime activation; new fixed SHA/re-review required.
