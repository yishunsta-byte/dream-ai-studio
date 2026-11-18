# B40 — exact physical TOAST not-null metadata correction

Status: author source/offline unit checks complete; independent code review pending. Master assignment `msg_97305b441687`; receipt `msg_298731c9ae47`. B39 `afd7972` and independent B39-R `ff65260` are accepted for failure evidence/reproduction only; actual complete native observation remains FAIL/unobtained. Exactly three allowed paths: migration-catalog-v3.ts, schema5-catalog.test.ts and this new handoff. No native run, DB, SQL parser or reference generation occurred in B40.

## Actual correction and preserved boundary

Only product change is catalog module line59, private `relations.toast.columns[].notNull`, **z.literal(true)→z.literal(false)**. This pins the independently observed physical pg_attribute metadata for the assigned PG18.7 UTF8/C reference scope. It does not infer whether physical TOAST values can contain SQL NULL. General boolean acceptance, input coercion, SQL projection changes or catalog mutations were not introduced.

All exact-parent/owner/namespace/kind/unique index/column count/ordinal/name/native type/typmod/dimensions/dropped/index-key proofs, duplicate/alias/unknown dependency handling and the14-category boundary are unchanged. Logical business-column notNull still uses its existing explicit boolean representation and preserves true/false in canonical metadata; no logical table constraint was weakened. A new test confirms changing that business metadata changes the observation hash. F38 semantic argument references, ordinal ordering, overload/duplicate signature checks, descriptorVersion2 and unvalidated/approvalfalse/expectedCatalogfalse are unchanged. All fixed SELECT strings and external binding recipe are unchanged.

This correction narrows the physical metadata value to the actual false literal rather than allowing both booleans. Raw private TOAST metadata remains excluded from canonical business rows, as before; accepted/rejected raw-input domain changes but output shape/version does not. No descriptorVersion3, expected catalog or consumer migration is allocated. The prior true-shaped synthetic input is now rejected intentionally.

## Native evidence sources and offline-derived input

The retained evidence was read offline, never modified:

| Producer | Frozen execution/review basis | Raw relations input |
| --- | --- | --- |
| Backend |B39 afd7972; run a6c48bc1|tmp/b39-native-a6c48bc1-6cac-4afa-9f70-ed48b196a32a/projection-relations.json|
| Independent Tester |B39-R ff65260; frozen harness replay f25ab90b|tmp/b39-native-f25ab90b-f03f-4395-b9a5-e632a79aa25e/projection-relations.json|

Both whole captured batch files independently hash SHA256 **4aa31bbc9be7d35875795dc9212a3a702c647bcdb8defe80f78b872e97971dc1**. Each has33 raw relations,32 TOAST auxiliaries/96 physical attribute rows with notNull=false. Their same OID assignments/identical bytes are not claimed as shifted-OID equivalence. Both prior runs stopped after context/schemas/relations with CATALOG_OBSERVATION_INVALID and no failing SQLSTATE; twelve later projections were not executed. Those original reports, failures, scratch fixtures and harness remain unchanged.

New inline `capturedB39HistoryRelation` is an unchanged data copy of the actual dream_migrations.history wrapper/row independently matched between those two captures. Native relation16399/owner16389/rowtype16401, TOAST16409 with parent16399, unique index16410/parent16409/key[1,2]/key and total counts2. Its actual three column records are1 chunk_id/oid26,2 chunk_seq/int423,3 chunk_data/bytea17; all notNull=false/dropped=false/typmod-1/dimensions0. Native parent, type and index facts were copied explicitly, not inferred from ordinals or substituted from synthetic values. The test source records both provenance labels and the whole-batch hash. It performs no scratch-file I/O at test runtime.

The new reader-stage regression feeds this one real captured relation through the product's actual strict raw relations parser. Context and schemas/bindings are deliberately synthetic. Its port deliberately rejects the next columns call; every run must reject overall. **Calls4 means only the raw relations shape passed**, not a full decoder/catalog/normalization/native PASS. Calls3 means the relations row itself was rejected. The test is named/commented accordingly. This does not validate all33 captured relations, cross-category native links, business definitions or complete native catalog state. Existing synthetic normalized-graph tests independently retain exact-parent/type/index/alias/dependency checks.

## Red-to-green and changed negative meaning

Before the product edit, added the captured input regression and ran catalog tests: **169 passed /1 failed**. The native false row stopped at call3 instead of the deliberately expected call4, reproducing B39's raw parser mismatch offline. After the one-line literal correction and explicit synthetic fixture update, it reaches call4 and still rejects at the deliberate next-category stop. True mutations in each of the three captured physical attributes reject at call3; missing/null/number/string/object notNull values also reject without coercion.

The existing synthetic positive fixture's three TOAST column flags change true→false to match the corroborated physical contract. The old malformed-proof case named nullable previously changed true→false; that expected failure embodied the now-disproven physical true assumption. It is explicitly renamed unexpected-not-null and now changes false→true. This reversal is authorized by the native evidence and Master allocation, not an unexplained expectation change to obtain green. Original B38/B38-FIX source/report/old fixture at39ae6af/ee0f691 and independent original red remain historical and unedited. No evidence claims that the old physical true contract was native-correct.

Existing160 catalog cases remain with that documented proof fixture correction;10 new cases cover raw captured-stage success, each physical column true rejection, five missing/nonboolean forms and logical business nullability preservation. All prior malformed physical proof, missing/foreign parent, type/OID/ordinal/index aliases, internal trigger/dependency, none/pair and F38 semantic cases still run.

## Commands and actual checks

All five native-integration switches set0 for the related suite:

```powershell
$env:DREAM_PG_INTEGRATION='0'
$env:DREAM_PG_B22_SCHEMA_TEST='0'
$env:DREAM_PG_B23_SCHEMA_TEST='0'
$env:DREAM_PG_B24_SCHEMA_TEST='0'
$env:DREAM_PG_B25_SCHEMA_TEST='0'
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts --max-warnings 0
git diff --check
```

Actual final related six-file result **341 passed /100 native-disabled skipped**, including **170 catalog cases** (160 previous+10 new). Whole-project TypeScript exit0, two-file eslint exit0/zero warnings, whitespace checks0. No actual native rerun or post-failure SQL query was performed in this allocation. No source SQL1–5/D/P, loader/manifests, B39 harness, old reports, state/runner/provenance/runtime, env/package/config, provider/managed/browser, build/deploy/install or agent/window/worktree change occurred.

Independent source/unit review is next. Only after Master accepts and separately allocates a native retry may a new owned cluster run continue to the next first mismatch. Remaining projections, native bindings/type/function/dependency/internal-trigger inventories, capacity and complete reference equivalence remain unverified. This one literal correction supplies no Golden/reference artifact, complete5 classification, migration/target authorization or runtime activation.

Copyable return: B40 product diff is exactly private physical TOAST notNull literaltrue→literalfalse, based on author+independent B39 native capture96false values each. New inline actual history-row input verifies the raw relations-stage correction only; original positive fails before correction and passes that stage afterward, with deliberate next-stage overall rejection. True/missing/nonboolean negatives, exact-parent/type/index/dependency and F38 semantic checks remain; old nullable negative reversal is explicitly documented.170 catalog cases/341 related PASS100native-disabled skips/type-lint-whitespace0. Exact three-path source/unit return for independent review, no native rerun/full catalog/Golden/state/runtime acceptance.
