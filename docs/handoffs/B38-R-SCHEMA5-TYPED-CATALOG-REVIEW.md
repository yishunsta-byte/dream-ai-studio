# B38-R — Independent typed catalog code/unit review

**Verdict: CHANGES REQUIRED — two P2 findings, F38-1/F38-2.** Frozen author unit/type/lint checks reproduce successfully, but independent counterexamples expose an auxiliary dependency representation gap and a native argument-identity canonicalization collision. These are source/unit findings. No native query, syntax/permission/completeness validation, reference or database acceptance was performed. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_f2dd978cc17f`; receipt `msg_fcee5b825b0a`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed; counterexamples remain in owned ignored scratch.

## Frozen source and verification

Reviewed all521 lines of `lib/db/postgres/migration-catalog-v3.ts`,268 lines of its tests and the handoff at **39ae6affd87e6a4dae57594e18be24ab6b3a2a6d**, against corrected B36 contract5cefa0d/R2 and accepted B37 source6011284/9ebf012. The commit adds exactly three paths. Independently matched current bytes and LF SHA256:

| Artifact | SHA256 |
| --- | --- |
| migration-catalog-v3.ts |bf2ab025e9074c7378367b61dc4a3d1679dd6d9ee511a3cd42907a08da0b172a|
| schema5-catalog.test.ts |dfb1764231a0d9f0ce480a46835b398c224785ef7e75c32bd3cd49552cd345bd|
| B38-SCHEMA5-TYPED-CATALOG.md |799aace62502d534dec633ffd06390b98a0159d67f8f727dcd7e32066db49d94|

From repository root, explicitly set DREAM_PG_INTEGRATION and DREAM_PG_B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST to0 in test processes:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run --config tmp/b38r-review-39ae6af/vitest.config.ts --reporter=verbose
node --conditions=react-server --import tsx tmp/b38r-review-39ae6af/diagnose.mjs
```

| Check | Actual independent result |
| --- | --- |
| Author six-file suite |310 passed /100 native-disabled skipped, exit0;139 new catalog tests included|
| Full project TypeScript |exit0|
| Changed two-file lint |exit0 /zero warnings|
| Independent scratch suite |8 passed /2 failed, exit1; failing expectations preserved|
| Diagnostic artifact extraction |exit0; records both counterexamples, not a passing acceptance test|

Scratch `tmp/b38r-review-39ae6af` retains preflight.json, independent.test.ts, its isolated config, independent-run.log, diagnose.mjs and counterexample-details.json. Fixture.ts is a verbatim extracted copy of the frozen author's synthetic fixture/helpers; mutations/assertions are independently authored. Neither original product nor original test expectations were patched. No real catalog fixture is claimed.

## F38-1 — Collected TOAST column endpoints have no resolvable identity

**P2, source/representation gap; fail-closed compatibility failure.** Fixed dependency projection476–490 includes the exact TOAST relations and their indexes in its object set, collects both directions of pg_depend and projects d.refobjsubid unchanged. The native registry at207–208 registers only pg_class:toastOid:0 and pg_class:toastIndexOid:0. Column registration222–226 covers raw.columns, whose fixed query459–460 only reads owned namespaces and excludes relation kind t. External facts113–121 allow auth.users columns, not pg_toast columns. Thus a nonzero TOAST column endpoint selected through that object set has no representation and always fails at342; no permitted exact-parent auxiliary fact can resolve it.

Minimal unit reproduction: accept the unchanged synthetic fixture, retaining its verified owning relation100, TOAST400 and TOAST index401. Add one dependency `{dependent:{class:'pg_class',nativeOid:'401',subId:0}, referenced:{class:'pg_class',nativeOid:'400',subId:1}, dependencyType:'a'}`. The exact-parent fixture still passes all existing auxiliary checks, but decode throws CATALOG_OBSERVATION_INVALID. Independent test14 preserves the failed positive representation assertion. counterexample-details.json records baseline acceptance, endpoint pair and all three relevant fixed-query selections.

The performed result is **not** a claim that this native query was run or that every real PG18 cluster necessarily returned that row. It proves the fixed collector's admitted TOAST subcolumn endpoint domain and the decoder's available identities are inconsistent; source/native completeness remains unverified. The present fixture only models index→TOAST whole-object subId0 and therefore misses this boundary. Silently filtering nonzero endpoints to obtain a pass would weaken the declared dependency inventory.

**One minimal remedy:** extend the existing private exact-parent TOAST auxiliary with strictly collected/validated column identities needed by its dependency graph, and register stable parent-qualified subcolumn keys. Validate actual relation/column ownership, ordinals/names/types and index linkage under that already approved TOAST parent; reject absent, aliased, foreign or unproved subcolumns. Synchronize fixed projection, decoder, canonical endpoint mapping and positive/negative regressions. Do not add a generic auxiliary/ordinal escape hatch, drop dependency rows or change the14-category business inventory. Later authorized native verification must establish the actual PG18 rows/layout and coverage.

## F38-2 — Valid native argument references can disappear from canonical identity

**P2, malformed raw-input acceptance and canonical collision.** Function registration217 uses actual argumentTypeRefs to create the native semantic signature. Checks264–267 verify only equal arity and that each reference resolves; they do not bind the corresponding argumentTypes display string to that signature. Normalize's type97 and walk254 then explicitly remove argumentTypeRefs from output. For an unreferenced invoker function, no surviving dependency/trigger reference necessarily carries that signature. Two different resolved native signatures can therefore produce identical canonicalJson and observationSha256.

Minimal preserved unit case: copy the existing owner-owned invoker fixture row to new OID6010/name unreferenced_probe, with one displayed argument uuid and actual type reference pg_catalog.uuid/OID9000. Decode succeeds. Change only that actual reference to the separately trusted pg_catalog.text/OID9001, retaining displayed/declaration fields. Decode succeeds again, rather than rejecting inconsistent metadata, and the whole canonical JSON is identical. Both observation hashes are **f83095618dce242ccc622d8a4a7fecec75129394c3084f6889546dddea0052fe**. Native OIDs alone are supposed to normalize away; uuid versus text semantic identity is not. Independent test15–20 fails its reject-or-distinguish expectation; the diagnostic JSON retains both actual references and the surviving normalized function row.

This intentionally models inconsistent raw metadata. It does **not** claim the unexecuted native SELECT actually returns inconsistent format_type/reference fields, a production exploit or a successful Golden comparison. The pure decoder's advertised semantic/native validation and canonical identity boundary should nevertheless reject the mismatch or retain the distinct semantic fact; approval=false does not make an erased distinction recoverable by a later reference comparison.

**One minimal remedy:** retain the already validated normalized argumentTypeRefs (qualified semantic identities, without native OIDs) in the canonical FunctionRow rather than discarding them, with an explicit named field/type. Bind or reject any conflicting display/declaration metadata as appropriate to the fixed projection contract. Include that field in strict typed output/reference-normalizer versioning and regressions for an unreferenced invoker and overloaded signatures. No arbitrary SQL parser, new query executor or target-learned expected signature is needed.

## Other inspected boundaries

The module has14 strict top-level categories and explicit typed raw wrappers. Ordinary getter checks precede Zod reads; canonical OIDs/hash/hex shapes, duplicate native/semantic identities and unknown principal/endpoint rejection are present. Schema names are closed; extra unsupported class/type/function kinds are surfaced and rejected rather than adopted. ACL grantors and principal slots are resolved by native OID, with PUBLIC0 only in allowed positions. none/pair flags and membership tuples, M/B separation, exact automatic ADMIN-only edges and restricted definer ownership/signatures are checked.

Class/type/domain-array reciprocal links are checked separately from forbidden ancestry cycles. Constraints include t/FK/native parent/index/operator/action metadata. Named definitions/digits remain literal; internal triggers use complete structural parent/function/side/typeBits/related-index properties, with separate named/internal counts. Four FK check/action sides and outside Auth action-trigger/index inclusion are statically represented. Column-default native identities are registered by exact relation/ordinal/name, with presence tied to the expression. TOAST parent/owner/kind/index checks reject generic foreign auxiliaries, subject to F38-1's missing subcolumn domain. No actual native equivalence is established by these static observations.

The reader snapshots bindings, nested parameter arrays and the port method before await; then validates the qualified initial context and dispatches the14 fixed SELECTs sequentially. Prior batches are strictly parsed, detached/frozen before subsequent awaits. The independent controls passed duplicate ACL and semantic-index alias rejection, preservation of ACL-null/internal metadata changes, deferred rejection redaction/no later query, context drift stopping, immutable parameter dispatch and unapproved output. No callback/URL/env/SQL override or pool construction is added; the caller still owns the trusted port/inspection transaction/deadlines/cleanup. Import-no-I/O and SELECT-only source boundaries remain intact.

Observation output explicitly remains unvalidated/approval=false/expectedCatalog=false. It does not create expected rows, compare complete5, classify fresh/known4, repair catalog state, sign provenance or enable runtime. Fixed query text alone proves no SQL syntax, privileges, deparser behavior, real catalog capacity/completeness or isolation properties; those remain later separately authorized native gates.

## Preservation and return

Independently matched52 protected originals to39ae6af, including SQL1–4/D/P, old manifests/state/runner/CLI/target/template, adapter D pin, model/B3 sources, historical native harnesses and package/config. B37→B38 protected code/test delta contains only the new catalog module/test. Final tracked product diff is empty; unrelated T122/T137 files remain untouched. Report whitespace/selective commit are the only tracked mutation checks.

Return39ae6af **CHANGES REQUIRED**, two P2 fixes above with preserved failing unit evidence. Request a fixed source/unit correction and independent re-review before native projection/reference allocation. No DB/parser/native/reference/Golden/state/runner/provision/runtime, environment/package/config, build/deploy/install or new agent/window/worktree action occurred. This report supplies no source P execution or target authorization.
