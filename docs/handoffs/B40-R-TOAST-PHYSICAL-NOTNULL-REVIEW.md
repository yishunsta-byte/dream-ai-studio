# B40-R — Independent exact physical TOAST metadata correction review

**Verdict: PASS for fixed source/code/offline-unit scope.** The single private literal correction is supported by both retained B39 captures; the captured row now advances through raw relations parsing while strict negative boundaries remain. No new mandatory defect found. This is not a full decoder/native/catalog/reference PASS. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_dc7c924974b4`; receipt `msg_b3983ea5a82e`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen delta and evidence identity

Reviewed fixed **883fa8a52ef289adb78fef98962649fbdc2cc444**, exactly three assigned paths, against ee0f691/afd7972 and independent B39-R ff65260. Independently matched current fixed LF SHA256:

| Artifact | SHA256 |
| --- | --- |
| migration-catalog-v3.ts |2b0b9df2d6e30039cb90d708789a0a28415e6c7503f623ff1a33989f93d3a000|
| schema5-catalog.test.ts |cdcc9bea28d5000b17dc82e83475795f2829cb7bd6712e95a88b163b43baad5f|
| B40-TOAST-PHYSICAL-NOTNULL-CORRECTION.md |d2eac2295751e31608b563d3b0e549dd1b4a753c03fe2ebf595d316eef4342a3|

A complete byte comparison to frozen ee0f691 proves the only product change is module59's private `relations.toast.columns[].notNull`, z.literal(true)→z.literal(false). Every other module byte is unchanged, including logical column bool, exact parent/type/ordinal/index proofs, dependencies, F38 semantic arguments, descriptor2 and SQL construction. Independent import comparison also found all14 generated fixed SELECT strings byte-identical between old and corrected modules.

Independently rehashed both actual B39 projection-relations.json files: author a6c48bc1 and reviewer f25ab90b each have whole-file SHA256 **4aa31bbc9be7d35875795dc9212a3a702c647bcdb8defe80f78b872e97971dc1**. Parsed the new inline capturedB39HistoryRelation JSON and compared the entire wrapper/row, all fields and compact serialized row bytes to the first row of both captures: exact equality. No inferred synthetic replacement or omitted metadata was used for this comparison.

This copied real row is dream_migrations.history16399/owner16389/rowtype16401, TOAST16409/parent16399 and unique index16410/parent16409/key[1,2]/counts2. All three actual attributes have notNull=false, dropped=false, typmod-1/dimensions0; types/names/ordinals are chunk_id/oid26/1, chunk_seq/int423/2, chunk_data/bytea17/3. The two whole batches have33 relations/96 false physical TOAST flags, as established by B39's offline inspection. Identical bytes/native OIDs do not establish distinct-OID native equivalence.

## Independent causal replay and strictness

Created a separate exact ee0f691 module copy in owned ignored scratch, with its unchanged helper copied under the original relative layout. Its LF hash remains **27be5af15d0d5111c7f7a1c74506a4ce74e91c8c22e57353ca86e05a662c3faa**; neither production source nor original expectations were edited. The same actual captured row is fed to both readers, with deliberately synthetic context/schema/bindings and a port that throws on the next columns request.

Old reader: **3 calls**, raw relations rejected before the deliberate stop. Corrected reader: **4 calls**, relations raw shape passes and the columns request hits the explicit deliberate stop. Both overall promises reject CATALOG_OBSERVATION_INVALID; no observation is returned. This is the permitted equivalent independent replay of the author's169-pass/1-fail intermediate regression, not a claim to reconstruct its uncommitted intermediate test state or a full normalized native catalog.

Independent20-case suite passed. Each captured physical attribute changed to true rejects at call3. Missing/undefined/null/number/string/object/NaN flags reject without defaults/coercion; an accessor flag executes zero getters. Full synthetic normalized-graph negatives still reject foreign parent, type alias, wrong ordinal, reversed index keys and missing proof. Logical business-column true/false remain explicit canonical values with different observation hashes. F38's unreferenced uuid/text semantic reference distinction remains visible and changes the hash. Descriptor2/approval=false/expectedCatalog=false remain unchanged.

The tracked synthetic fixture's physical true→false update and old nullable negative's rename/reversal to unexpected-not-null are justified by corroborated native metadata and the explicit Master correction allocation. The old negative embodied the disproved physical-true assumption; it is not silently weakened to boolean acceptance. Logical business nullability is untouched. Original B38/B39 source commits, fixture/red artifacts and reports remain historical and unmodified. No new output shape/version or expected artifact is introduced by narrowing this private accepted-input literal.

## Reproduced commands and preservation

Set DREAM_PG_INTEGRATION and DREAM_PG_B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST explicitly0 in test processes. From repository root:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run --config tmp/b40r-review-883fa8a/vitest.config.ts --reporter=verbose
```

Results: **341 passed /100 native-disabled skipped**, exit0, including170 catalog cases; full TypeScript exit0; two-file lint exit0/zero warnings; independent **20 passed**, exit0. Whitespace/selective report checks pass. No DB/native/parser/reference execution occurred.

Owned ignored root tmp/b40r-review-883fa8a retains preflight, exact old module/helper copies, independently matched captured-history.json, separate synthetic fixture copies, tests/config/log and preservation-check.json. Both native batch files and all pre-existing B38-R/B38-R2/B39-R scratch files remain byte-identical to preflight; original05f33b1/a72d1e5/ff65260 reports match their frozen commits. Protected SQL/D/P/loader/old tools/B39 harness/adapter/model/package/config and tracked product bytes match fixed883fa8a after review. Unrelated T122/T137 files were preserved.

## Limits and return

PASS covers the exact one-line physical expectation correction, evidence fidelity and raw parser/offline regression. Four calls are **not four native successes**: the fourth is a deliberately failed mock port call, before cross-category normalization. Only one captured real relation wrapper is exercised by that regression; other inputs are synthetic. No claim is made that all33 rows, remaining12 native projections, full decoder links/inventory/capacity, native binding/deparser behavior or complete reference now pass.

The physical metadata flag does not determine whether TOAST values can contain SQL NULL. No logical DDL, catalog data, source SQL, allowlist, historical harness pin or query changed. Full native observation remains unverified/previously FAIL. Another native attempt requires separate allocation; no Golden/state/runner/provision/provenance/runtime authorization follows. No env/package/config/build/deploy/install/provider/browser or new agent/window/worktree action occurred. Return fixed883fa8a **source/code/offline-unit PASS**, no mandatory findings; Master decides the next bounded gate.
