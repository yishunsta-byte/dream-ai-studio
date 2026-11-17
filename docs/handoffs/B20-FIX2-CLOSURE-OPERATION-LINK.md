# B20-FIX2 — bind first failure closure to its initial operation

Status: ready_review; independent reacceptance pending. Confirmed 2026-11-18 00:19 KST (2026-11-17 15:19 UTC). Baseline B20-FIX `eeca88d0fa71639f3fd99bce184f2f727f62523a` is not accepted: B20-R2 found a missing selected relational guarantee despite the original80 local cases passing. SQL4 remains unpublished and excluded from the current manifest.

## Source and reproduction

Master `msg_f808100f32a8` assigned this fix; reviewer `msg_708beea60c35` provided the exact minimal reproduction. Read the eight added tests in `D:/starwork/b20-r2-eeca88d/tests/postgres/b20-r2-independent.test.ts`, beginning near line439, and the subsequently delivered `docs/handoffs/B20-R2-STORAGE-JSON-REVIEW.md`. The report confirms earlier three failures are fixed, accepts earlier BEFORE rejection as valid, and identifies the remaining failure-operation linkage defect. No reviewer file was edited or staged.

Copied all eight R2 tests into the existing owned schema fixture with their expectations intact. Against unchanged baseline SQL, a fresh owned synthetic run reproduced **87PASS /1FAIL of88**, exit1. The failing test's valid initial operation/worker/time/revision branch reached deferred validation as expected. Its invalid branch changed only `closure.operationId` to another syntactically valid UUIDv7 and also reached the acceptance marker instead of SQLSTATE23514. The marker rolls back the transaction; reaching it is evidence of acceptance, not database rejection.

Accepted B19 `lib/storage/uploads/state.ts:25`–34 defines the meaning:

- `verification_failure` must identify an operation in this object's model; that operation must be initial, failed, and match completion time, aggregate completion revision, worker and historical authorizers.
- `cancel` has the owner as sole authorizer and an explicit null operationId. If an initial operation exists, it must have matching canceled completion evidence.
- `cleanup` has an explicit null operationId and an actual cleanup claim with matching claim time/revision. Cleanup can also preserve an earlier cancel/failure closure rather than replacing it.

B20's existing checks already compared the same-object initial operation's status/time/revision/worker, but did not compare the closure's operationId with that row, and skipped those comparisons entirely when no initial operation existed. Cancel/cleanup had only a nullable UUID shape check. This fix closes those specific relational gaps; B19 source is unchanged.

## Minimum change

The existing deferred `storage_consistency_guard` now requires:

1. Failure closure has a same-owner, same-object initial operation, and its id equals closure.operationId. Missing operation, null id and mismatch reject with23514 before the existing completion evidence checks. Lookup remains explicitly scoped by owner/object/kind; a valid UUID or a different existing operation is insufficient.
2. Cancellation requires explicit JSON null operationId alongside the existing exact owner/authorizer requirement.
3. Cleanup requires explicit JSON null operationId and a non-null cleanup claim reference. Existing deferred claim FK/link and time/revision checks still validate that claim.

No schema object, function, role, membership, policy or grant was added. Counts remain30 dream tables,43 policies,18 original guards,12 storage guards,6 deferred triggers,6 storage helpers and zero new SECURITY DEFINER. The local runner is unchanged. Only the draft SQL, existing schema test and this unique report change; SQL1–3/v1 runner/manifest/history contract/B19/reviewer files and unrelated WIP remain untouched.

## Actual validation

Command for both owned synthetic runs:

```text
node tests/postgres/run-storage-verification-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

| Owned evidence suffix under tmp/b20-postgres- | Actual result |
| --- | --- |
| `c57d899b-1981-41a4-bcf6-d178b51d338b` | Baseline SQL + original80 + independent R2 eight:87PASS/1FAIL,0skip, exit1, start00:17:37 KST. |
| `1aaa49f5-4346-4771-9885-d83de3697d70` | Fixed SQL: **104PASS /0skip**, exit0, start00:19:11 KST, duration4.10s. |

Final104 = original80 (including first review's eight) + R2 independent8 + new16 boundary cases. Do not add repeated run totals as new coverage. New16 cover failure operationId omitted/null/nonexistent/different existing initial object/different owner/reverify, correct initial failure, absent same-object initial operation; cancellation with existing/nonexistent non-null ids and valid explicit null; cleanup omitted/existing/nonexistent ids, actual claim with explicit null, and missing cleanup claim. Cross-owner case creates a real second-owner operation inside the rollback transaction, rather than using an arbitrary UUID. Positive cases must reach `SET CONSTRAINTS ALL IMMEDIATE` before the intentional rollback marker. Original80 and R2 eight expectations were not weakened, skipped or inverted; triggers were not disabled/replaced.

R2's remaining seven tests also retain JSON-null rejection vs nullable unobserved claim, exact decimal/exponent/raw time preservation, safe maximum and tiny fractional rejection, non-JSON boolean spellings, deferred lifecycle/target/time checks and owner/revision checks. The original fixture continues asserting immutable published source hashes/history3/old catalog/role graph, atomic DDL rollback and old runner's expected SQL4 rejection.

Static commands both exit0:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/postgres/storage-verification-schema.test.ts tests/postgres/run-storage-verification-local.mjs --max-warnings 0
```

Both owned PG18.7 runs stopped; their `cleanup-safe.json` flags are **postmasterPidAbsent=true / listenerAbsent=true**. Final `run.json`: PID61944, loopback port51275, database `dream_test_b3`; all logs/evidence are retained. No owned process/listener/transaction remains, and no directory was recursively deleted. Only explicit signed portable EnterpriseDB binaries and owned loopback synthetic Auth data were used. No shared service, .next, managed DSN, provider, SSL, Storage, runtime API, paid or deployment operation occurred.

## Source hash and gate

Changed SQL canonical LF UTF-8 SHA256: **`61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`**.
Rejected baseline candidate hash: `7568cf313b3fb203bda8a8d810b62d8345c0d158931902bef06dffa6703566d4`.

Request independent re-review of this fixed commit/hash. B21 candidate-reference update remains a separate assignment after this fix is fixed; no B21 edit was made here. SQL4 publication and v2 runner implementation remain on hold. This is selected recorded-evidence linkage, not complete B19 causal-prefix validation or a worker authorization/current-clock/CAS/ordered-lock/byte-attestation/provider executor. Local104PASS does not establish independent acceptance, managed compatibility or Storage readiness.
