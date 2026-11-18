# B42-R — Independent ACL correction and final small-native replay

**Verdict: PASS for fixed code/unit and the bounded final native ACL experiment.** The final generated columns expression was actually executed for native NULL and nonempty grants; this adds evidence beyond Backend's original candidate-only run. No mandatory defect found. No full P/catalog/reference/state/provenance/runtime acceptance follows. Master retains final authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_052eca05c97e`; receipt `msg_ca05ffb0f541`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen source and historical execution distinction

Reviewed all four assigned paths at **1fcbf8375238f9d71165d9ac36e5f029d34b2956**, the complete189-line final small harness and93-line handoff, product delta and unit additions. Independently matched fixed LF SHA256 before/after:

| Artifact | SHA256 |
| --- | --- |
| migration-catalog-v3.ts |aea12e9f90970637d22421904fa0b861f1dfda28c871c5bfffeca5f712640b1a|
| final b42-column-acl-native-owned.ts |f1a759e3f5a8aa839e66379de3da4cd10a95fdbd667d004e33f36f9378b7a9d2|
| schema5-catalog.test.ts |a00617f507899bdd75d3a56d8cdbf19f8a2d4d1d89cf145a67db0996724ac9c5|
| B42 handoff |5b0f8540feb5e2782ddfe443b74e1c5cc119d0b61ff1e352e0daec6c597266e3|

Backend's retained executed-before-product-fix-harness.ts independently hashes **d9b0a54b0d3f35d18f4fa308216215c76316ebf0f7317990c4e5f43430b7f777**. Its original experiment-source/final/checks record old product2b0b9df2,25 probes/21 successful results/4 expected22023, candidateExpressionOnly=true and no corrected-generated execution flag. Those artifacts and executed-to-final diff were inspected and remained byte-identical after review. The final f1a759e harness is a different, explicitly disclosed replay source; Backend did not execute it. This independent review did.

## Minimal correction and source integration

Only product helper aclSql's two lines change: retain the same alias increment, name existing coalesce(expr,fallback) as effective, then return JSON[] if coalesce(cardinality(effective),0)=0; otherwise execute the original complete aggregate/aclexplode tuple expansion. No nonempty tuple filtering, grantor substitution, role aliasing, deduplication, decoder or protocol change occurs.

Exactly seven generated projection strings change: schemas/relations/columns/functions/domains/types/defaultAcls. The other seven are byte-identical to an independent frozen883fa8a module copy. NULL fallback semantics remain acldefault n/r/f/T where previously specified; raw explicit empty remains empty and does not select a nonempty NULL default. Domains/types retain raw aclIsNull separately. Descriptor2, fourteen categories, exact native/principal/parent/TOAST/F38 identity checks and unvalidated output remain unchanged.

Independently removed only the one fixed columns guard and its matching final END: restored entire SQL equals old generated query, SHA **4d6ff67037656bdd98f2bc896bb13ec99949a75aa20379c6d84d2c3096bb6383**, also matching original experiment-source.json. Final columns SHA is **be1d15f4a2884b938fb855861c1c92b6af78059d1d21d95f63201f7c3adb3e3b**. Complete final ACL value equals the actually recorded pre-edit candidate after only the declared alias, effective-operand parameterization and grantor/grantee cast-parenthesis substitutions. This is a bounded string/source comparison, not a general SQL parser; actual generated execution is separately proven below.

## One final-harness native execution

```powershell
node --conditions=react-server --import tsx tests/b42-column-acl-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

One unchanged invocation, **exit0**,27 probes: **23 successful results +4 expected SQLSTATE22023/check_acl controls**. Expected errors continue only through the authorized SAVEPOINT/ROLLBACK TO SAVEPOINT recipe. No unexpected failure artifact. No extra independent native probes were added (count0). Existing signed EnterpriseDB PG18.7 binaries, new UTF8/C SCRAM loopback cluster/database dream_test_B42 only; own root `tmp/b42-native-c7af7eee-a52f-4996-b0e0-fdb392503758`. No P/SQL1–5 migration or full reader/catalog retry occurred.

Actual owner16389/reader16390 and minimal dream.acl_probe/c were independently checked from returned metadata. Initial native attacl is SQL NULL, ndims/cardinality NULL. Direct aclexplode(NULL) returns zero tuples; direct explicit empty has ndims NULL/cardinality0 and raises22023. Original generated columns and old NULL→empty/explicit-empty expressions also raise22023. These four exact controls, driver routine/message and four matching server-log errors establish the formerly inferred bounded cause rather than relying on a fabricated B41 row.

| Actual replay coverage | Independent evidence |
| --- | --- |
| Corrected generated columns on native NULL |One actual returned column row with ACL[]; recorded SQL SHA equals final be1d15f4…|
| Candidate native NULL/explicit empty |Both JSON[]|
| Actual SELECT(c) WITH GRANT OPTION to reader + UPDATE(c) to PUBLIC |Native ACL ndims1/cardinality2; owner16389 grantor, reader16390 SELECT/grantabletrue and PUBLIC0 UPDATE/grantablefalse|
| Corrected generated columns on nonempty grants |Actual returned complete two tuples equal old generated query, old expression and candidate; same final query SHA|
| Revoke grant option |Both tuples remain, grantablefalse|
| Revoke all column grants |Raw attacl returns SQL NULL; candidate[]; table relacl still raw NULL|
| Native acldefault n/r/f/T with raw NULL |Old and candidate complete tuple sets equal/nonempty:2/8/2/2 rows respectively; PUBLIC EXECUTE for f and USAGE for T preserved|
| Explicit empty against each nonempty default |All four return[], never owner/PUBLIC fallback|

The independent final27 labels are precisely the original25 plus fixed-generated NULL and fixed-generated nonempty. final.json correctly records correctedGeneratedColumnsExecuted=true, candidateExpressionOnly=false, productEditedDuringExperiment=false/noPOrFullCatalogRun=true. Thus final generated execution is now verified for this minimal database; original25 evidence remains historical25/candidate-only. This does not retroactively claim the corrected B41 full catalog reader ran.

## Unit checks, independent counterexamples and cleanup

With DREAM_PG_INTEGRATION and DREAM_PG_B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST explicitly0:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts tests/b42-column-acl-native-owned.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run --config tmp/b42r-review-1fcbf83/vitest.config.ts --reporter=verbose
```

Actual results: **361 passed /100 native-disabled skipped**, including190 catalog cases; full type exit0; three-file lint exit0/zero warnings; independent **9 passed**, exit0. Independent cases cover whole old-query recovery/seven affected projections/complete candidate equality, tuple-set permutation and grant-option hash distinction, missing grantee/unknown or PUBLIC grantor/nonboolean/duplicate rejection, and raw NULL versus explicit equal/empty type ACLs under descriptor2 unapproved output. No source/test expectation was edited by Tester.

Own postmaster **72012**, port **58649**, client backends **7760 /6840**. Harness recorded completed/stoppedtrue and all shutdown flags; independently queried OS after exit: **all three PIDs absent, listener58649 absent, postmaster.pid absent**. Auth/statement/parameter secrecy inspected offline; retained server log has four expected ACL errors only and no generated secret/PASSWORD/SCRAM credential material. Existing per-client rollback/end is awaited; a separate end-ACK ledger is not produced.

Author cleanup artifact independently contrasted: root42e39bff, postmaster45544/port60510/backends56796/63696,25 probes/completedtrue and all shutdown flags true; PID file absent. No author process was operated on. Own review root `tmp/b42r-review-1fcbf83` retains preflight, original-source snapshot, independent tests/config/log, offline inspector/summary, OS cleanup and postrun checks. Original executed harness/source/checks/final/cleanup/diff artifacts remained unchanged. Protected originals and all current fixed hashes/product bytes match1fcbf83 after review; unrelated T122/T137 files preserved; report-only whitespace/selective commit checks pass.

## Scope of acceptance

PASS establishes this helper correction, preserved ACL/default semantics and actual final generated columns behavior in the minimal ACL fixture. Other six affected generated projections were source/unit checked, not each executed against a complete schema5 database. Parameterized default/candidate native checks do not replace that later integration proof. B39/B41 full catalog observations remain historically FAIL; subsequent categories, inventory/capacity, native cross-cluster/drift/pair/reference/Golden/state/runner/provenance/runtime remain unverified/unallocated.

No product/original harness/test/SQL/allowlist edit, P application/full catalog retry, env/package/config/build/deploy/install/provider/browser or new agent/window/worktree action occurred. Return fixed1fcbf83 **code/unit + bounded final small-native PASS**, with final-generated actual execution explicitly distinguished from original candidate-only history. Master decides the next bounded catalog gate.
