# B38-FIX — exact TOAST column evidence and semantic function arguments

Status: author fixes and source/unit checks complete; independent re-review pending. Basis: B38 `39ae6affd87e6a4dae57594e18be24ab6b3a2a6d`, independent B38-R `05f33b1` CHANGES REQUIRED (F38-1/F38-2), Master assignment `msg_e6fcaca9a4e4` and compatibility decision `msg_b86d801d0c4b`. Original B38 and independent reports remain historical and unchanged. Exactly three assigned paths: catalog module, its unit tests, this new handoff.

## Original red and fixture compatibility

Before editing, ran the unchanged independent command:

```powershell
node node_modules/vitest/vitest.mjs run --config tmp/b38r-review-39ae6af/vitest.config.ts --reporter=verbose
```

Result: **8 passed /2 failed**, exit1. The original TOAST subcolumn positive assertion threw CATALOG_OBSERVATION_INVALID; the native uuid/text signature mutation retained the same `f83095618dce242ccc622d8a4a7fecec75129394c3084f6889546dddea0052fe` observation hash. Original independent fixture, expectations, logs and diagnostics were not edited. That red finding is preserved rather than relabeled as passing.

The old fixture lacks the newly mandatory collected TOAST attribute/index-key evidence. Master explicitly approved rejecting that old shape, retaining its original red evidence, and using an explicitly extended synthetic fixture for the corrected positive. No inferred/default column identities are supplied. The tracked fixture adds exactly the four new TOAST proof fields below plus explicit external pg_catalog oid/int4/bytea type bindings. These are synthetic representations of the new fixed projection, not native collected facts. A negative test removes all four fields to prove that the historical shape fails closed. Tester must independently repeat the same semantic counterexamples using the new required evidence; the unchanged historical scratch suite is not claimed green on the incompatible new decoder.

## F38-1 correction

The existing private relation.toast auxiliary now requires:

- `columns`: exactly three native pg_attribute records, each containing relationNativeOid, ordinal, name, structured native type reference, notNull, dropped, typeModifier and dimensions. Fixed SELECT reads every positive attnum under `ta.attrelid=tc.oid`, ordered by attnum; dropped attributes are surfaced and rejected, not hidden.
- `indexColumns`: observed pg_index.indkey, requiring `[1,2]`; `indexKeyCount` and `indexAttributeCount`: observed indnkeyatts/indnatts, both requiring2. Existing native index parent, uniqueness, namespace, relation/index kinds, both management owners and single internal owning relation proof remain mandatory.

The closed PG18 physical layout accepted by this decoder is ordinal1 chunk_id/pg_catalog.oid,2 chunk_seq/pg_catalog.int4,3 chunk_data/pg_catalog.bytea; each not-null, not dropped, typmod -1 and dimensions0. These values are checked against supplied collected metadata, never fabricated when absent. Every native type reference must resolve to its exact approved qualified identity. Real PG18 layout/projection/permissions compatibility remains unverified until a separately authorized native task.

Only after exact parent/layout checks does the native registry map pg_class:toastOid:ordinal to a stable `{kind:table-toast-column, relation:<owning qualified relation>, ordinal, name, type:<qualified type>}` identity. The owning business relation determines the stable parent. No TOAST generated name or OID enters the canonical key. Unknown ordinal/type/OID, duplicate ordinal, foreign relation parent, missing column/proof, mismatched name, alias, nullable/dropped metadata or wrong index key/count/link rejects. Existing multiple/orphan parent and owner/type/index-collision negatives remain in force.

The same originally failing index401→TOAST400/subId1 dependency now resolves with complete explicit proof, remains in the canonical dependency inventory and is asserted by the new positive test. Neither pg_depend collection direction nor refobjsubid was filtered or rewritten. There is no general ordinal fallback, foreign auxiliary registration or fifteenth category; private physical columns do not become business columns/tables. The original14-category boundary remains intact.

## F38-2 correction and versioning

Exported `CatalogFunctionObservationV3` explicitly retains ordered `argumentTypeRefs: readonly {schema,name}[]`. Each raw reference still must match the native semantic registry. The normalizer strips native OIDs/catalog markers from these references but no longer removes their qualified semantic identities. Therefore an unreferenced function cannot lose uuid-versus-text identity, and same-name overloads retain distinct canonical rows even when opaque display/declaration strings match. Duplicate actual semantic signatures under different OIDs still reject.

The fixed function projection binds displayed argumentTypes and structured argumentTypeRefs to the same p.proargtypes array, explicitly ordered WITH ORDINALITY; the decoder requires equal arity. Input signature ordering remains significant. allArgumentTypes now also explicitly orders its display projection. identityArgs/declaredArgs/result and displayed format_type strings remain opaque deparser text included verbatim, not a parsed/authenticated SQL declaration. Pure decoding can retain contradictory display strings as unvalidated observations; the semantic difference is always recoverable in argumentTypeRefs/hash. No arbitrary SQL parser or heuristic type-name rewrite was introduced. Native projection/deparser consistency is a later gate.

Master approved the incompatible **descriptorVersion1→2** change: both public result and canonical envelope now declare2. Old version1 descriptors/hashes must not be reused as version2 expected artifacts; no frozen expected consumer exists in this allocation. Module/API v3, observation hash domain `catalog-observation:v3`, internal trigger structuralVersion1/domain and approval:false/expectedCatalog:false remain unchanged. Normalized signatures and changed envelope deliberately change prior observation digests. Historical version1 report is unchanged.

## Validation and limits

Final validation uses all five native integration flags set0:

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

Final recorded result: **160 catalog tests**, comprising original139 plus21 focused cases; six-file total **331 passed /100 native-disabled skipped**. Whole-project TypeScript, two-file lint and whitespace checks exit0. The earlier checkpoint before adding two final coverage cases was329 passed/100 skipped with type/lint0. The TOAST positive uses the original exact endpoint pair and dependencyType a.

New coverage: exact original dependency endpoint with new explicit proof; historical missing-evidence rejection;15 malformed TOAST evidence variants; uncollected ordinal rejection; unreferenced uuid/text canonical distinction; same-name overload distinction and duplicate signature rejection; argument order preservation; same semantic unreferenced signature under shifted native OIDs yields identical canonical JSON/hash. Existing139 cases remain, with the shared positive fixture explicitly updated to the new required collector shape.

This correction is source/unit only. No native SQL execution, parser, actual DB/reference cluster, Golden artifact, state comparison, migration runner, provenance/approval issuance, runtime activation, target/env/package/config change, provider/browser, build/deploy/install or new window/agent/worktree was performed. Fixed SELECT syntax/permissions/full inventory/capacity, physical PG18 TOAST evidence and native distinct-OID equivalence remain unverified. Output remains an unvalidated observation. Independent re-review is required before Master acceptance and any separately assigned native gate.

Copyable return: B38-FIX addresses F38-1 exact-parent collected TOAST subcolumns/index-key proof and F38-2 canonical typed semantic function argument refs. Original independent8pass2fail and historical fixture/expectations remain unchanged; evidence-extended synthetic fixture turns the same dependency positive green, while missing evidence rejects. descriptorVersion2 incompatible change approved by Master. Submit exact three-path commit with160 catalog cases/331 related pass/100 native skips/type-lint-whitespace0 for independent re-review; no native/reference/state/runtime acceptance is claimed.
