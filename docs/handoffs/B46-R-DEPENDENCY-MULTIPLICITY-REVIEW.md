# B46-R dependency multiplicity independent review

2026-11-18 · Codex(Tester) · fixed **9612348c37d0540039b1ee0cf3df47f83c8c2d18** · Master assignment msg_331a7a0ee8fc.

**PASS — code/unit/independent adversarial cases and one final-harness bounded native replay.** Physical policy multiplicity and exact quantity preservation reproduce. No full P/schema5/native reader/accepted descriptor4 observation was attempted. B45's product FAIL and all historical evidence remain unchanged. Only this new tracked report changes.

## Fixed source and contract

Independent preflight before/after execution verifies actual files equal fixed git objects (LF): product **97ccf4f241dcbf5c572a314d61d10f488891977929cadc71e55c216374354e14**, catalog tests **c17839bc29dd97c618d2bfadf45b3ac2c401aafb21bf0f81c9f602529e38dd85**, final harness **e1209834016ad684c1e5773ba0132a59e583aba9fe38216f29c8d3da78ba2e2d**. Frozen archive `tmp/b46r-review-9612348/app` supplies clean whole-project checks, with existing node_modules junction and no shared `.next`.

Product diff changes dependencies representation only: raw strict individual rows → exact native-key groups → same semantic registry resolution → existing canonical sort/uniqueness. Key includes **dependent class/OID/subId + referenced class/OID/subId + dependencyType**, all seven fields. Counts are safe positive integers1..10000, explicit1 included, and sum equals raw length. Existing strict plain-data/shape/node/text/depth/raw10000 limits run before grouping. Counts cannot expand those limits or allow preaggregated raw input. Different native keys are not merged after name/OID normalization; semantic-alias registration still rejects them. Unknown endpoints still reject.

Auth PK proof now checks exactly one **distinct** internal index→constraint owner edge with positive physical count, per the explicit Master contract. Exact bound/observed constraint, singleton indexConstraints, actual M relation/index owner, id/UUID/key/type/flags/proof remain. Repeated identical owner-edge rows retain their count/hash effect; another known or unknown constraint owner is rejected. This is not permission to attach a second owner.

All other13 category duplicate checks, ACL/principal strictness, owners/type/F38/defaults and observer trust boundaries are unchanged. DescriptorVersion is explicitly **4**, incompatible with old shape; V3 public API names/hash-domain prefix `catalog-observation:v3\n` and trigger structuralVersion1 remain. Descriptor4/count1 appear in canonical JSON and intentionally change hashes; approval/expectedCatalog remain false. No old result is relabeled or rehashed as a new expected artifact.

The superseded single dependency-duplicate rejection parameter is removed from the generic array; other13 cases remain, with quantity tests replacing it. Existing224 catalog cases minus that1 plus17 additions =240. Old v3 behavior is preserved historically, not claimed as the current output contract. Independent historical module calls below use only fresh synthetic fixtures, never B45 data.

## Source/unit checks and new adversarial cases

Fixed archive command with all five process-local native switches0:

`node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts`

Actual **411 PASS/100 native-disabled SKIP**, six files PASS, including the catalog240 suite. Fixed archive **whole-project** `tsc --noEmit --incremental false` exit0; product/test/harness three-file eslint `--max-warnings 0` exit0. These broaden the author's isolated source type evidence without touching shared stale Next validators/build/typegen.

`tmp/b46r-review-9612348/independent-probes.ts` adds **34/34 PASS** using an exactly extracted fixed existing synthetic fixture setup and separately written expectations. Extraction metadata/source-function hash preserved; no existing test/fixture/expected value edited. Checks include:

- all-count1 descriptor4 vs historical descriptor3 envelopes/hash; same edge count3 changes hash, conserves rows and historical strict decoder rejects that new repeated bag;
- reversing category/dependency/binding order and shifting native IDs33333 preserves canonical multiset;
- each of seven key fields varied independently with known typed registry endpoints:17 raw rows/16 groups/one count2, no accidental collapse across class/OID/subId/deptype;
- repeated exact Auth owner count4 remains one owner and changes hash; second known constraint500/503 or unknown999999 cannot hide behind repeated approved owner rows;
- either unknown endpoint repeated17 times, native→semantic alias bindings, all other13 category duplicates, ACL duplicates, raw multiplicity values1/2/0/-1/1.1/string/null, oversized one-key bags, and endpoint getters reject; getter reads remain0.

Whole module's generated14 SQL projections compare byte-identical to original v3 **87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0** through independent module imports (historical copy changes only its relative utility import). Dependency SQL **425c37731ce1444d0398adf6808f788fd6a5d40c8dd8138d7829e94d08d5e9ff**. No DISTINCT/filter/UNION/query change hides rows. CTIDs are absent from product keys/DTO/canonical semantics.

## One final replay, distinct from original author experiment

Author actually ran original harness **4f8148b2ba2dbd70688905f2132c8ce3677050ae0c64e42430f13c2be2fb7653** with product87c2a8fd. It was not the final new-pin replay. Independent comparison proves original/final harness prefixes/suffixes identical outside the source-verification block; that block changes pin/scope labels and adds the explicit unchanged dependency-query SHA check. Key arrow expression in final native candidate and product is byte-equal; complete algorithms/scopes are not asserted identical.

Tester actually executed **unchanged final e120983** once:

`node --conditions=react-server --import tsx tests/b46-policy-dependency-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin`

**exit0/completedtrue/stoppedtrue**, root **tmp/b46-native-06c19037-a2da-4a57-a1de-aaca6ba19ce4**. Existing portable postgres/initdb/pg_ctl signatures Valid EnterpriseDB, version18.7; new UTF8/C/template0 loopback dream_test_B46. Synthetic B and distinct nonsuperuser/no-bypass/no-createDB/no-createRole/no-inherit/no-replication owner; only one table, two stable NULL-returning UUID actor functions and four explicit policies. No P/Auth/schema5 installation or row-policy data query. Fact reads RR READ ONLY/pg_catalog. New source.json pins product97ccf4f and unchanged query425c377; no old-source fallback. Secrets stay in ignored owned evidence; inherited PG defaults are removed in that process and no DSN/env/PATH/service/install changes occur.

| Observed policy | USING/CHECK actor quantities in physical pg_depend |
| --- | --- |
| using_only | actor_id1, CHECK absent |
| check_only | actor_id1, USING absent |
| both_same | actor_id2, same expression both sides |
| both_different | actor_id1/other_actor_id1, distinct columns/functions |

The full small-fixture dependency SELECT returns25 raw rows; **the exact observed four-policy subset has16**, equal to the independently queried physical base16 as full native endpoint/deptype multisets. That subset has **14 distinct keys/two count2 groups/summed quantity16**. Original uniqueness predicate is false. The standalone candidate preserves16 through explicit counts. It does not run the complete product semantic decoder or approve a full observation.

Actual both_same policy16399→actor function16395/type n is stored twice at separate diagnostic CTIDs **(3,36)/(3,43)**; same table16392/column1 dependency also occurs twice. Single-expression and different-expression controls corroborate the bounded physical cause; collector itself does not duplicate this subset. CTIDs are physical evidence only, never stable identity. This does not establish physical provenance for every old B45 dependency or assign a particular captured row to USING versus CHECK.

Own and author **physical-pg-depend.json**, **projection-dependencies.json**, **observed-policy-function-matrix.json** are independently byte-identical. SHAs respectively **f4cd6ed100c9ad28602bf77cdc31193218c19a595ca3ba4df07f949cf0a228b5**, **eb93a53873c33b3c4e1fc8be5b48cc96f9cefa56018b155156bbc31fd751442b**, **c2d26d8ec424779be6ddb672a42f88cc144c04d3ef61e192af1a3e54820b59b9**. Equal integer OIDs/CTIDs across clean clusters are not reused native provenance; each own capture follows the fresh run. The new unit's five inline both_same rows match own native subset exactly before their declared OID readdressing into a synthetic graph. Other graph semantics remain synthetic.

Evidence script `artifact-review.mjs` initially did not match a CRLF inline-array terminator and stopped before summary output; normalizing LF corrected that parser, without product/input changes or native rerun. Final `artifact-review.json` records the independent multiset, control matrix, original/final source boundary, arrow comparison and hashes. All18 historical author B45 input-file hashes and all18 independent B45 input-file hashes still match their original manifest. Those bags were not decoded by the new product, patched, deduplicated or used to hunt a later failure.

## Cleanup and limits

Original finally awaits own client rollback/end attempts, validates PID-file directory/port/PID and stops only its own cluster. cleanup-safe completedtrue/postmasterPidAbsent/listenerAbsent/processAbsenttrue. Independent Windows reads confirm **postmaster65892, bootstrap35708, owner63468 absent; listener58972 absent; cluster/postmaster.pid absent**. No cleanup-failure/new retry. Harness has no per-client end-ACK ledger; OS absence is separate evidence.

Native candidate verifies exact native-key counts and physical cause; product registry/semantic typed normalization is established by units/adversarial synthetic cases. Neither proves full descriptor4 native P observation, Golden/reference/state/runtime, drift equivalence or managed provider readiness. Final source pins were rechecked after analysis, other WIP/original SQL/loader/P/harness/report artifacts were not changed. Review tools are confined to owned ignored scratch. Only this report is selectively committed.

Master copyable return: B46-R fixed9612348 **PASS code/unit/34 independent cases/final e120983 small native once**.411PASS100skip/catalog240,cleanarchive whole type0/three lint0. Actual physical16=collector policy subset16/14exact keys/2double groups/countsum16,CTID pair corroborated; final newpin boundary distinct from author old experiment,all14SQL unchanged. Semantic count contract tested synthetically; no fullP/fullreader/newB45decode/dedup/next-failure hunt. Own65892/35708/63468/58972/pidfile absent; originalB45 hashes unchanged.
