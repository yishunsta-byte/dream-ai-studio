# B20-FIX — required JSON evidence rejects missing/type/NULL bypasses

Status: ready_review, independent reacceptance pending. Confirmed 2026-11-18 00:10 KST. Baseline B20 `ef38db7965ad1794f00925251e5dcf019646b17f` failed independent review; its earlier 17-pass result was insufficient. This fix supersedes that draft's evidence checks and candidate hash, not its publication status. SQL4 remains unpublished and outside every current manifest.

## Review and exact reproduction

Read `docs/handoffs/B20-R-STORAGE-SCHEMA-REVIEW.md` (reviewer CX-REVIEW-01, fixed baseline above) and the reviewer's `D:/starwork/b20-r-ef38db7/tests/postgres/b20-r-independent.test.ts`, added section at lines 324–395. The report names three missing protections:

1. Closure JSON without both `reason` and `at` passed deferred checks: missing fields produced SQL NULL, which did not enter the rejection branches.
2. Cleanup observation without `at` passed both monotonic and claim-time checks through SQL NULL comparisons.
3. JSON strings `"yes"` for `absent` and `writerQuiescent` were accepted by PostgreSQL text-to-boolean casts as true.

Copied all eight independent tests into the existing owned fixture without changing their expectations or the original 17 tests. Against the unchanged baseline SQL, a fresh owned PG run reproduced **22 pass / 3 fail out of 25**, exit1. Each failure reached `SET CONSTRAINTS ALL IMMEDIATE` and then the review marker error, rather than the required SQLSTATE23514. The marker intentionally rolled back accepted invalid evidence; it was not counted as successful rejection.

## Fix

Only the draft SQL, its existing test file and this unique handoff changed. The local runner is unchanged. Original SQL1–3, v1 manifest/runner/history contract and B19 model are unchanged. No reviewer's report or reproduction copy was edited.

- The existing BEFORE `storage_guard` validates closure and observation JSON before extraction/casts or update-time comparisons. Required keys must exist; JSON null, wrong kinds, unknown keys and malformed identifiers/digests reject explicitly with23514. Shape checks use `IS NOT TRUE`, so missing/NULL predicates cannot silently pass.
- Closure requires six fields: revision, at, principalId, authorizers, reason, operationId. Reason is one of the three existing causes; operationId must be explicit null or UUIDv7. Principal/authority members must be UUID strings; authority array length is1–100. Revision is a positive safe integer; time is a nonnegative safe integer, at most9007199254740991. Nullable operation remains valid. Existing owner cancellation/first closure linkage checks remain.
- Observation requires exactly at/absent/writerQuiescent/identityDigest. Both flags must be actual JSON booleans; identity is a64-character lowercase hex digest. Time is an integer in the same safe range. Null observation remains permitted for a claim that has not yet been observed.
- GC closure linkage and observation target/time checks now express required positive conjunctions with `IS NOT TRUE`, rejecting unknown results. Tombstone comparison uses JSON true equality instead of coercive text-to-boolean casts. Before-row shape checks protect the existing deferred relational checks; this is intentionally earlier rejection, not a change in the negative tests' required outcome.
- After integer/range validation, numeric→bigint conversion accepts integer-valued JSON decimal syntax such as1893456000002.0 without a text-to-bigint error. Raw JSON text is retained, not normalized or rewritten.

No new tables, functions, roles, policies, grants or transition executors were added. Existing B20 limitations remain: selected DDL guarantees are not full model equivalence, current-clock/worker authority, ordered runtime locks/CAS, causal-prefix reconstruction, byte attestation, provider quiescence or operational Storage readiness.

## Actual tests and cleanup

Exact command for each owned synthetic run:

```text
node tests/postgres/run-storage-verification-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

| Owned evidence suffix under tmp/b20-postgres- | Result |
| --- | --- |
| `cf401f68-6484-4da2-a7a8-a42bf1a2efed` | Baseline unchanged SQL + original17 + independent8:22PASS/3FAIL, exit1, 00:06:59 KST. |
| `5ef0abe1-e2bd-431d-b868-b294221191a0` | Fixed SQL + same25:25PASS, exit0, 00:08:35 KST. |
| `c0887bc1-ff8c-47da-b4c1-5dd06de4a92e` | Final original17 + independent8 + new55 boundary cases: **80PASS /0skip**, exit0, 00:09:27 KST,3.55s. |

The runs reuse cases; do not add the three run totals as independent coverage. New55 comprise closure missing/null/wrong-kind17, closure bad-value12 and valid nullable-operation1; observation missing/null/wrong-kind12, bad-value8, all four genuine boolean combinations4 and integer-valued decimal time1. Negative cases include enum, fractional/negative/unsafe numbers, empty or malformed authority, malformed IDs/digest, wrong target and extra fields. Positive cases explicitly reach deferred validation before the rollback marker; they prove genuine true/false values and valid closure still work. The original17 and independent8 expectations were retained.

The independent eight-test block is preserved verbatim apart from its surrounding attribution comment. No trigger disable/replacement, skip, expectation inversion or weakened rejection was introduced. Existing middle-DDL rollback, owner/FK/history/role/catalog/RLS checks still run. Catalog remains30 tables,43 policies,18 original guards,12 new guards,18 original Auth owner FKs and zero storage SECURITY DEFINER functions.

All three owned runs have `cleanup-safe.json` with **postmasterPidAbsent=true / listenerAbsent=true**. Final `run.json`: PID70584, loopback port51338, database `dream_test_b3`. No owned process/listener/transaction remains. Evidence retained; no recursive deletion or shared service/.next mutation. Only signed local EnterpriseDB PG18.7/synthetic Auth data was used; no managed DSN/provider/API/config/paid/deploy action.

Final static checks, exit0:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/postgres/storage-verification-schema.test.ts tests/postgres/run-storage-verification-local.mjs --max-warnings 0
git diff --check
```

## Source lock and next gate

Canonical LF UTF-8 SHA256 of changed draft: **`7568cf313b3fb203bda8a8d810b62d8345c0d158931902bef06dffa6703566d4`**.
Previous rejected candidate: `0385c666162f0c2dcb98c48e38f7cc4a6289c8f826b936d04ad8c3a434efdee8`.

Published hashes remain exactly:

- SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`
- SQL2 `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`
- SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`

Request independent B20 re-review of this fixed commit/hash with the original negative expectations. B21 remains ready_review as a design document only; its old SQL4 candidate hash is historical and must be revised after B20 acceptance under a separate document assignment. Versioned runner implementation and SQL4 publication remain on hold. Passing80 local tests does not constitute independent acceptance or authorization for managed/Storage/SSL/API/deployment work.
