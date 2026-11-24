# B46 — physical dependency multiplicity and counted descriptor4 rows

Status: author bounded cause experiment, conditional product correction and isolated source/unit checks complete; independent review/replay pending. Assignment msg_93483f26ce6b; receipt msg_b6ec2a5125c9. Physical cause return msg_b3658d68a24a. Master msg_b5865364470f conditionally approves the exact-distinct Auth ownership interpretation after cause confirmation. Exactly four assigned paths changed. Original B45 failure/captures/harness/review ee8ce8e remain unchanged; no P/full-reader retry or old-capture patched decode occurred.

## Actual original-source cause experiment

One new owned signed portable EnterpriseDB PG18.7 UTF8/C/template0 loopback database dream_test_B46. Root `tmp/b46-native-20b5dfe5-de11-4c88-aa44-e9fba4e91635`. Actual product during execution was original descriptor3 SHA **87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0**. Original executed harness LF SHA **4f8148b2ba2dbd70688905f2132c8ce3677050ae0c64e42430f13c2be2fb7653**, preserved as executed-before-product-fix-harness.ts. One native invocation exit0/completed/stoppedtrue. No product edit happened during this run.

Only synthetic owner, table dream.policy_probe(owner_id uuid,other_id uuid), two zero-argument SQL UUID actor functions and four explicit RLS policies were created. No P/schema5 installation, Auth prerequisite, runtime profile or actual policy data request was executed. Stable NULL-returning actor functions and SQL subselect expressions reproduce the policy metadata dependency pattern. After setup, all fact reads are in RR READ ONLY/pg_catalog. Policies and observed function identities:

| Case | Native policy | USING | CHECK | Actor function normal-dependency quantities |
| --- | --- | --- | --- | --- |
|using_only|16397|owner_id/actor_id|NULL|actor_id1|
|check_only|16398|NULL|owner_id/actor_id|actor_id1|
|both_same|16399|owner_id/actor_id|same expression|actor_id2|
|both_different|16400|owner_id/actor_id|other_id/other_actor_id|actor_id1,other_actor_id1|

Observed actor_id native16395, other_actor_id16396, parent relation16392. Base pg_depend SELECT records ctid only as diagnostic evidence, scoped to those four observed policy IDs. The unchanged fixed product dependency SELECT is executed and restricted offline to the same exact policy-ID subset. **Base physical16 rows and projected16 rows match as complete native endpoint/deptype multisets,14 distinct edges.** This small fixture's collector does not create the duplicated rows.

For both_same, the exact pg_policy16399/sub0→pg_proc16395/sub0/type n row physically exists twice with distinct diagnostic ctids **(3,36)** and **(3,43)**. Its reference to parent column/sub1 likewise occurs twice. The single-expression controls have one such function dependency; different expressions retain different native function/column endpoints. This directly establishes native physical multiplicity in the bounded reproduction. It is not a new physical audit of every B45 row or an adoption of its entire graph. B45 data were not edited or retried.

The historical uniqueness predicate, new Set(exactNativeKeys).size===rawRowCount, is false on this16-row policy subset. A counted native-key candidate represents14 rows, including two multiplicity2 edges, whose summed quantity is16. This is the bounded old-condition red/candidate-quantity green evidence, not execution of a complete original or corrected public decoder on a native schema5 graph. All original SQL dispatches in the cause experiment succeeded; the red condition is the old uniqueness rule, not a PostgreSQL SQLSTATE.

physical-pg-depend.json, projection-dependencies.json, observed-policy-function-matrix.json, source.json and final.json retain this evidence. Projection SHA256 **eb93a53873c33b3c4e1fc8be5b48cc96f9cefa56018b155156bbc31fd751442b**. CTIDs are absent from the projected raw DTO, grouping keys, normalized rows and canonical hashes; they remain diagnostic logs only.

## Conditional native-count contract and product delta

Only dependencies change representation. Raw input stays a strict array of individual native rows; caller-supplied multiplicity or other extra fields remain invalid. Before semantic/OID normalization, a private helper groups **only this exact seven-field tuple**:

```text
dependent.class, dependent.nativeOid, dependent.subId,
referenced.class, referenced.nativeOid, referenced.subId, dependencyType
```

No SQL DISTINCT/UNION change or row filter is introduced. Every input row increments its exact group's quantity; helper checks safe integer multiplicity1..10000 and sum(multiplicity)===raw length. Existing raw-category10000-row/plain-data node/text/depth limits still apply before grouping; a group cannot bypass them. Effective node limits can reject before the nominal row ceiling and are not increased. Each grouped endpoint must still resolve through the same native registry; different native-to-same-semantic aliases remain rejected rather than combined after names/OIDs are removed. Unknown endpoints still fail. The final sortedUnique check remains on normalized rows as an additional collision guard.

Exported CatalogDependencyObservationV3 now has dependent/referenced canonical typed-key strings, the exact dependencyType enum and an explicit positive bounded integer multiplicity. Count1 is present even for unique edges. Changing1→2 changes canonical JSON/hash while keeping the edge count; input order and numerically shifted OIDs preserve the same multiset observation. No quantity is hidden as set deduplication. All other13 category duplicate checks and ACL/principal set strictness remain unchanged.

Per Master decision, Auth index→PK proof now requires **exactly one distinct native internal ownership edge with positive physical quantity**, not one physical row. The observed indexConstraints singleton, parent/key/type/index flags, actual M relation/index ownership and exact observed/bound PK are unchanged. A repeated copy of the same ownership edge is counted and changes the hash; an additional distinct internal index→constraint owner, including a known owned constraint, is rejected. Different catalog/OID/sub-ID/deptype keys are never merged. This preserves one owner rather than allowing a second owner or an unknown endpoint.

Normalized shape is incompatible **descriptorVersion3→4**, explicitly authorized by the assignment. Public API/file suffixV3, catalog-observation:v3 hash domain, internal trigger structuralVersion1,14 categories and approval:false/expectedCatalog:false remain. No old v3 report/input/output is relabeled as v4; no frozen expected artifact was generated. The new envelope/count1 intentionally changes prior canonical hashes. Binding recipe/Auth PK/F38/type/owner/default/ACL rules are otherwise unchanged. **All SQL projection text is unchanged**, including dependency SQL SHA **425c37731ce1444d0398adf6808f788fd6a5d40c8dd8138d7829e94d08d5e9ff** verified after integration.

## Old failure, unit quantities and newly captured subset

Before editing the product, a new focused complete-synthetic fixture test adds one exact repeated dependency and asks for preserved explicit quantity. Original module rejects CATALOG_OBSERVATION_INVALID: **1 failed/224 unrelated skipped**. After correction it passes. The generic duplicate-category parameter list excludes only dependencies because that old expected rejection is deliberately superseded by the approved counted contract; historical v3 tests/reports remain unchanged. All other category duplicates still run.

New coverage: count1;1→2 JSON/hash difference; same multiset/order/shifted OIDs; distinct dependent/reference catalog classes despite equal numeric OIDs; distinct OID/sub-ID/deptype; safe positive quantities/summed raw length; strict rejection of preaggregated input counts; unknown endpoints/semantic aliases; raw oversize despite one repeated key; distinct versus repeated Auth owner edges; ACL duplicates still rejected. Current total **240 catalog tests** equals prior224 minus one superseded dependency-duplicate case plus17 new cases.

The new small-native both_same five-row dependency bag is inlined with its own capture provenance, never read from B45. Its native policy16399/table16392/function16395 endpoints are explicitly readdressed to synthetic fixture550/100/6003 (and a second version shifted20000). Other object names/expressions/bindings are synthetic. Added to the fixture,13 raw rows become11 counted rows with total13 and exactly two multiplicity2 groups; shifted canonical JSON is equal. This is declared mixed synthetic normalization/quantity evidence, not a native full-schema accepted observation. No CTID is copied or used as semantic identity.

## Actual executed harness versus final replay source

The final committed replay harness LF SHA **e1209834016ad684c1e5773ba0132a59e583aba9fe38216f29c8d3da78ba2e2d** was **not natively executed by Backend** after integration. It differs from the preserved actual4f8148b2 source only in corrected module pin/phase labels and an explicit unchanged dependency-query SHA assertion. Same native policy matrix/base-versus-projection multiset checks/candidate quantities remain. executed-to-final-harness.diff and final-source-link.json record that boundary. Final product pin is **97ccf4f241dcbf5c572a314d61d10f488891977929cadc71e55c216374354e14**; no old-source/hash fallback bypass is provided.

The original native candidate groups native-key rows without registry semantic resolution. Final product uses the same exact native key expression (arrow body byte-equal after its type/name binding) and corresponding Map increment/positive bound/quantity conservation, then additionally applies the existing registry mapping/collision checks. These are different scopes and are not called byte-identical complete algorithms. Product semantic resolution/typed canonical rows were tested by units, not through a full native decoder. Independent final replay, if separately authorized, still proves only the bounded native cause/count path.

## Isolated checks, cleanup and preserved work

All five DREAM_PG integration/B22/B23/B24/B25 switches set0 for the related suite:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tmp/b46-checks/tsconfig.json
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts tests/b46-policy-dependency-native-owned.ts --max-warnings 0
git diff --check -- lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts tests/b46-policy-dependency-native-owned.ts docs/handoffs/B46-DEPENDENCY-MULTIPLICITY-CONTRACT.md
```

Final actual **411 related passed/100 native-disabled skipped,240 catalog cases**. Isolated strict type0, three-file lint0/zero warnings, selective whitespace0. Own ignored tmp/b46-checks/tsconfig.json extends unchanged repo options, disables incremental/plugin state and includes only the three assigned TypeScript sources plus their actual imports, excluding shared .next and unrelated in-flight FrontAuth routes. This is isolated source type evidence, not a new whole-app type/build claim. Final replay pin update also passes that isolated type/lint check.

Owned postmaster77056/port64370, actual clients51692 bootstrap and79100 owner. Original client rollback/end and PID-file directory/port/PID check preceded own pg_ctl fast stop. cleanup-safe.json completedtrue/postmasterPidAbsent/listenerAbsent/processAbsenttrue; independent OS read confirms **all3 PIDs absent, listener64370 absent and postmaster.pid absent**. Existing signed bins reused without install/PATH/service change; statement/connection/error parameter logging suppressed. No DSN/.env/auth secret printed or shared process operated on.

FrontAuth WIP/staged rename/shared .next/3013 and old SQL/P/loader/harness/failure evidence remain untouched. No full P/catalog retry, new expected/reference/Golden artifact, state/runner/provenance/runtime, managed/provider/build/deploy/install or new agent/window/worktree action occurred. No old B45 capture was passed through the corrected decoder to search for a later failure. Independent code/unit/bounded-final replay is next; full descriptor4 native observation remains a separately assigned gate.

Copyable return: B46 original-source small PG18.7 matrix confirms physical16-row policy bag/14exact edges, both_same actor edge stored at two distinct CTIDs; unchanged collector preserves exact base multiset. Candidate explicit counts total16; old uniqueness rejects. Conditionally approved dependencies-only exact native key grouping emits bounded positive multiplicity including1, preserves all quantities, descriptor4; other duplicates/aliases/unknowns/limits/owner-type/AuthPK/F38/ACL strictness retained. Auth proof uses exactly1 distinct owner edge with positive count and rejects second owner.240 catalog/411 related PASS100native skips/isolatedtype-lint-whitespace0. Original native harness4f8148... preserved; final newpin replay e120983... not Backend-executed; product97ccf4... SQL unchanged. Own PG77056/clients51692,79100/listener64370/PID-file all absent. Four-path fixed source/contract/limits return for independent review, not full native/Golden/state/runtime acceptance.
