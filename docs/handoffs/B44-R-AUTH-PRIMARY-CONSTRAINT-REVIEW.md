# B44-R — Independent exact Auth PK identity review

**Verdict: PASS for fixed code/unit and bounded Auth-only native scope.** The strict external PK observation/fact/index/column/owner/dependency contract and approved descriptor3 boundary withstand independent checks. No mandatory defect found. Full schema5 native normalization, later endpoints, Golden/reference/state/provenance/runtime remain unverified. Master retains final authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_d31488d09c50`; receipt `msg_476331de3fef`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen identity and approved contract delta

Reviewed complete four-path change at **0d0aaed1acd53a9e5d24d8ba6e01b0daf71c2f45**, including141-line small harness,75-line handoff, full module delta and unit additions. Independently matched current fixed LF SHA256 before/after:

| Artifact | SHA256 |
| --- | --- |
| migration-catalog-v3.ts |87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0|
| b44-auth-prerequisite-native-owned.ts |dfe21e1fb19e2e5548c8c450e709ac627b841851860b6060f7d532e231daba2f|
| schema5-catalog.test.ts |6dd21007c8fc9938f4101c907db86edf25618bb5cbd571869f60697abf02c690|
| B44 handoff |bc1598aac8219840f937023e11cca43cb45e25b9a9033b7fe991ef95b0916e45|

Master's prior decision explicitly approves14 categories with discriminated owned/external-prerequisite constraints and incompatible descriptor3, limited to Auth relation/index owner=M. The module does not add general external Principal tags or a fictional constraint owner. Both public and canonical envelopes declare3; old version2 histories/artifacts are preserved, not reinterpreted. The observation domain remains catalog-observation:v3 and output remains unvalidated/approval=false/expectedCatalog=false.

## Code and query boundary assessment

Exactly one explicit Auth relation/id-column/index/constraint fact is required, each with its native class/sub-ID and strict auth.users/ordinal1/id semantic shape. A constraint fact alone cannot replace an observed row: one external PK observation and one external index observation are independently required. Existing duplicate native/semantic identities and unknown principal/reference rejection remain.

External observation must be p on auth.users, with native identity matching the fact and exact parent/index references. Proof includes actual relation/index owners equal M, ordinary/nonpartitioned relation, UUID/id/ordinal1/not-null/non-dropped/typmod-1/dimensions0, and exactly one matching index-owning constraint reference. PK/conkey/index key[1], btree/uuid_ops/options[0]/no collation/include/predicate/expression, primary/unique/valid/ready/live/immediate and nondeferred/enforced/validated/local metadata are checked. Index use by an actually observed owned FK remains necessary. The exact zero-sub-ID internal index→constraint edge must occur once. Missing, duplicate, foreign or aliased evidence fails closed; constraint.owner is not invented or accepted.

The fixed constraints predicate retains owned rows and adds only bound relation+index matches. It deliberately does not hide wrong kinds with a p-only SQL filter; the strict variant rejects them. The dependency root adds only that same bound prerequisite constraint while preserving both directions and native endpoints. Index/column/type/ownership proof comes from actual fixed catalog joins, not a matching-name assumption. Unsupported Auth/index owners fail instead of expanding the principal model or implying Supabase support.

New private proof helpers consume generated aliases, mechanically changing suffixes elsewhere. Independent query comparison maps only known generated alias tokens consistently, preserving their distinct identities: after this mapping the only substantive projection changes are constraints and dependencies. This is diagnostic text comparison, not a general SQL parser or runtime normalizer. The original ACL helper bytes are exactly unchanged; default expansion, raw ACL NULL, F38 semantic arguments, TOAST proof, rolegraph and reader snapshot behavior remain protected.

## One bounded native replay

```powershell
node --conditions=react-server --import tsx tests/b44-auth-prerequisite-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

One unchanged final-harness invocation, **exit0/completedtrue/stoppedtrue**, no extra native cases (count0). Existing postgres/initdb/pg_ctl signed EnterpriseDB/actual18.7, new UTF8/C SCRAM loopback/template0 dream_test_B44 only. Own root `tmp/b44-native-c48bc63a-f5e7-4448-b044-2f4c92d99dd2`, port62704. Actual M=b44_migration16389 is restricted nonsuperuser CREATEROLE/NOINHERIT/non-BYPASSRLS. It creates only auth.users(id uuid PRIMARY KEY); no P/body migration, business/runtime roles, full reader or B43 retry.

Fixed fact discovery and exported constraints/indexes SELECTs run under RR READ ONLY/pg_catalog and return **one row each**. Independent offline evidence checks establish:

| Actual collected prerequisite | Native fact |
| --- | --- |
|auth.users|relation16392, ordinary/nonpartitioned, owner16389=M|
|id|ordinal1/id, UUID2950, not-null/non-dropped/typmod-1/dimensions0|
|constraint|16397, actual users_pkey, p, conkey[1], PRIMARY KEY (id)|
|index|16396, actual users_pkey, parent16392, owner16389=M, exact primary/unique/valid/ready/live/immediate/btree/uuid_ops/key[1] metadata|
|index-owning constraint proof|Exactly the same16397 parent/index identity|
|native dependency|pg_class16396/sub0→pg_constraint16397/sub0, deptype i, exactly one|

Own and author constraint batch SHA256 both **46599f73b52546d4b31ac33b7e1cbc22e8e98ac988396f7cea6d76c5270421c9**; index batch both **98cc0b4a0ab046c2c7f72e8e12d21b9425ce6a56c18a2f2b83c243544abcd40c**. Full inline capturedB44Primary constraint/index/edge exactly equals the retained new author captures and the independently replayed facts. These newly collected native values are not retroactive facts about B43's unobserved target. No B43 inputs were patched, and no full cross-category observation was constructed from that old run.

## Independent regressions and declared synthetic rekey

The capture integration explicitly maps only named nativeOid/principalOid fields M16389→11, relation16392→900, index16396→301, constraint16397→902 and UUID2950→9000, with explicit conversion of raw dependency fields. Definition/name/key/type/flags remain unchanged. Other graph inputs/bindings are synthetic. Independent reapplication at offsets0 and+20000 produces equal canonical JSON/hash. This is a mixed synthetic graph test, not native distinct-OID/full-schema5 equivalence or Golden construction.

Independent **26 cases passed**: both profiles; fact-only/observation-only; duplicate fact/row; foreign object/domain/wrong key/UUID alias; root/API owner and fictional owner/generic Principal; missing or unused supporting index; missing/duplicate/nonzero dependency; wrong singleton/index key/nullable column; capture rekey; deferred binding snapshot; ACL/PUBLIC/F38 preservation; and query-change isolation. Initial scratch alias-comparison result was25 passed/1 failed because the analysis matcher omitted constraintSql's known kN aliases. The first log and diagnostic diff are preserved; adding only that generator prefix fixed the utility and the same expected substantive-query assertion passed. No product/original test was edited and no product failure was hidden by that analysis correction.

With DREAM_PG_INTEGRATION and DREAM_PG_B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST explicitly0:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts tests/b44-auth-prerequisite-native-owned.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run --config tmp/b44r-review-0d0aaed/vitest.config.ts --reporter=verbose
```

Actual baseline **395 passed /100 native-disabled skipped**, including224 catalog cases; full type0; three-file lint0/zero warnings. Shared fixture adds explicit scope/proof/fact/edge rather than defaulting evidence; the TOAST positive now selects its original exact dependency rather than a changed last-array position. The old TOAST endpoint/type-a expectation remains intact. Historical version2 source/reports/inputs stay frozen.

## Cleanup, preservation and limits

Own postmaster **65940**, port **62704**, clients **25888 /77948**. Owner rollback/end and PID-file identity checks precede owned fast stop; completedtrue/all shutdown flags recorded. Independent post-exit OS confirms **all three PIDs absent, listener62704 absent, postmaster.pid absent**. No secret/DSN/auth contents printed; retained log has no generated password/PASSWORD/SCRAM credential material or server ERROR. Per-client end-ACK ledger is not separately emitted.

Author root3e334fc5 cleanup contrasted: postmaster68148/port49231/clients70608,47072, completedtrue/all shutdown flags true and PID file absent; no author process operation. Its retained artifacts and old B43 seventeen-file input-hash manifest remain unchanged. Own review root `tmp/b44r-review-0d0aaed` retains preflight, source snapshots, matched capture, independent tests/config/logs, alias diagnostic, offline inspector/summary, OS cleanup and postrun checks. Protected58 source/harness/package/config files match fixed commit; product diff empty; unrelated T122/T137 files preserved. Report-only whitespace/selective commit checks pass.

PASS covers only this approved M-owned exact Auth PK contract and bounded projections. The minimal DB has no owned FK/full14-category graph; native fact collection does not itself test full normalization. Full P/schema5 reader, remaining unknown dependencies, provider-owned Auth, managed Supabase, capacity/drift/pair/native cross-cluster/reference/Golden/state/runner/provenance/runtime remain unsupported/unverified. No P application, full-reader retry, extra native probe, original evidence backfill, env/package/build/deploy/install/provider/browser or new agent/window/worktree action occurred. Master decides the next bounded native gate.
