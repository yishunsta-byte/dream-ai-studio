# B38-R2 — Independent typed catalog correction review

**Verdict: PASS for fixed source/code/unit scope. F38-1 and F38-2 are closed at this boundary.** No additional mandatory P2 finding was identified. Actual projection syntax, privileges, physical PG18 layout, complete inventory/capacity and native/reference equivalence remain unverified. Master retains final acceptance and allocation authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_29e5c42405d7`; receipt `msg_6348ea956ffb`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Fixed identity and preservation

Reviewed exact correction **ee0f6914292e100e3f64f580996b8b01773c7f38**, its complete three-path delta against39ae6af and new B38-FIX handoff, with original review05f33b1 and its original red evidence. The correction changes only catalog module/tests and adds the FIX handoff, +162/-10. Independently matched current fixed LF SHA256:

| Path | SHA256 |
| --- | --- |
| lib/db/postgres/migration-catalog-v3.ts |27be5af15d0d5111c7f7a1c74506a4ce74e91c8c22e57353ca86e05a662c3faa|
| tests/postgres/schema5-catalog.test.ts |4e483fc36677848b5420f10fa315b25117d640d912bd6b87a1dc2725f7ae357d|
| docs/handoffs/B38-FIX-SCHEMA5-TYPED-CATALOG.md |cd3d1b474b92a572223c5a19361a6a00a4c2a0db3f3da6a966cf023d14f2823f|

The original39ae6af source identity,05f33b1 report and original8-pass/2-fail result are historical, not rewritten as green. The original ignored scratch's seven files (fixture, expectations, log and diagnostics included) were hashed before this re-review and remained byte-identical afterward; original report still matches05f33b1. A new scratch copy of the fixture was independently matched to the original frozen test's fixture text.

Master's compatibility decision permits mandatory new TOAST proof and descriptorVersion2. Therefore the old proofless fixture is expected to reject; forcing it green would weaken the correction. The new independent fixture is explicitly derived in a different directory, adding only collected-proof-shaped fields and trusted synthetic type mappings, rather than replacing old evidence.

## F38-1 closure — exact-parent subcolumn evidence

The private TOAST raw shape now requires observed columns plus indexColumns/indexKeyCount/indexAttributeCount. Fixed relation SELECT467/472 reads all positive native pg_attribute rows under `ta.attrelid=tc.oid`, preserving dropped metadata, ordered by attnum, and projects native index indkey/indnkeyatts/indnatts. Existing exact TOAST pointer/namespace/kind/owners/unique index/internal parent/index-parent checks remain.

Decoder57 and214–220 require exactly three proved columns: ordinal1 chunk_id/pg_catalog.oid,2 chunk_seq/pg_catalog.int4,3 chunk_data/pg_catalog.bytea; each exact-parent, not-null/not-dropped, typmod-1/dimensions0. Index proof is exactly two key/total attributes and ordered[1,2]. Every native type reference resolves through the semantic registry at280. Wrong names/types/OIDs, missing or duplicate ordinals, foreign parent, absent proof or index mismatch reject. No generic auxiliary/ordinal default was added.

The native registry now maps proved pg_class:TOAST:subId to stable table-toast-column keys containing the owning business relation, ordinal/name and qualified type. Original dependency collection directions and refobjsubid are retained. The exact original **index401→TOAST400/subId1, dependencyType a** resolves in both none/pair derived fixtures, and remains explicitly present in canonical dependencies. It does not become a business column/table or fifteenth category. In the independent assertions, dependent key is table-toast-index under dream.projects; referenced key is table-toast-column under that same parent, ordinal1/chunk_id/type pg_catalog.oid.

The untouched old fixture, both alone and with the same dependency, rejects for missing mandatory proof. Separately derived proof uses independent synthetic type OIDs9100–9102, not guessed fallback values inside the decoder. Eighteen independent negative cases pass: missing proof, foreign parent, native alias/unproved type, wrong/duplicate ordinal, wrong type/name, dropped/nullable, wrong typmod/dimensions, wrong index key/count/attribute count/parent, extra column and uncollected dependency subcolumn. This closes the original representability hole at code/unit level without claiming that a real server returned this layout or endpoint.

## F38-2 closure — retained semantic arguments and version boundary

CatalogFunctionObservationV3 at108 explicitly retains ordered normalized argumentTypeRefs. Normalize's type/walk no longer discard them; native catalog/OID fields disappear while qualified schema/name identity survives. Existing native reference resolution, arity checks and duplicate semantic-signature rejection remain. The fixed display projection449 and structured projection484 both derive from p.proargtypes with explicit ordinal ordering; allArgumentTypes display ordering is also explicit.

Independent reapplication of the unreferenced uuid→text mutation now yields distinct canonical JSON/hash and visible semantic reference arrays. Same-name overloads with different actual semantic arguments survive as separate rows; duplicate actual signatures under another OID reject. Reversing ordered semantic arguments changes the observation. Two full extended fixtures with all native OIDs shifted27000 but identical semantic signatures/TOAST column identities produce identical canonical JSON/hash. These are synthetic unit observations, not native cross-cluster results.

Opaque displayed/declaration strings remain raw captured text, not parsed/authenticated declarations. The pure decoder may retain contradictory opaque text as an explicitly unvalidated observation; the tested semantic fact no longer disappears, so later comparison can distinguish it. This acceptance does not approve inconsistent actual projection output. Native display/reference/deparser consistency remains a separate verification gate.

Both the public result134/408 and canonical envelope407 now declare **descriptorVersion2**. The observation domain remains catalog-observation:v3, with version2 inside its hashed envelope. Old descriptor1 observations/hashes are incompatible and cannot serve as version2 expected artifacts; historical records are unchanged. Internal trigger structuralVersion1/domain is unchanged because that structure did not change. approval=false/expectedCatalog=false and the fourteen-category boundary remain intact.

## Reproduced verification

Set DREAM_PG_INTEGRATION and DREAM_PG_B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST explicitly0 for test commands. Actual commands from repository root:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run --config tmp/b38r2-review-ee0f691/vitest.config.ts --reporter=verbose
```

Results: **331 passed /100 native-disabled skipped**, exit0, including160 catalog cases; full project TypeScript exit0; changed-file lint exit0/zero warnings. Independent scratch **27 passed**, exit0: historical missing-evidence rejection, both-profile original endpoint positives,18 negative proof cases, semantic difference/overload/duplicate/order/shifted-OID cases, detached batch snapshot and static projection mapping/order checks. No original failing expectation or product source was edited by Tester.

New owned ignored root `tmp/b38r2-review-ee0f691` retains original fixture copy, explicit separate fixture-v2.ts extension, independent tests/config/log, preflight.json and preservation-check.json. A later port call mutating the original extended relation proof does not change the already parsed/frozen batch; the fifteen fixed SELECT dispatches complete against the detached snapshot. No actual database port or native SQL was used.

Independently matched52 protected original files to the fixed commit, including SQL1–4/D/P, existing migration/source/target/template tools, reservation/model/B3 sources, historical native harnesses and package/config. Final tracked product diff is empty; original report and seven old scratch files unchanged; unrelated T122/T137 documents preserved. Report whitespace/selective commit checks pass.

## Limits and return

Both fixes satisfy the requested source/unit closure with separately identified stronger evidence and the approved incompatible version. No new mandatory defect found in the corrected delta or retained boundaries. This acceptance creates no Golden rows, expected reference, complete5/state classification, apply/runner/provision authority, provenance handle or runtime activation.

Real PG18 TOAST attributes/index layout, all fifteen SELECT syntax/privileges, deparser and external fact collection, catalog completeness/capacity, distinct-native-OID equivalence and drift mutations still require a separately allocated owned native/reference review. No DB/parser/native cluster, SQL execution, reference generation, Golden/state/runner/provenance/runtime, env/package/config, build/deploy/install or new agent/window/worktree action occurred. Return fixedee0f691 **code/unit PASS; F38-1/F38-2 closed at that scope**, with Master deciding the next bounded task.
