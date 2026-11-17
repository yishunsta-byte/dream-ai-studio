# B37 — local schema5 source P and isolated read-only v3 manifest

Status: implementation/local unit validation complete; independent SQL/source review pending. Only the new P file, isolated v3 manifest module, focused source test and this handoff change. **Local source publication is not database execution, target approval, a catalog5 descriptor, provenance or runtime activation.**

Basis: corrected B36 contract5cefa0d83e7ffbe5772346130bc24e24e7c463f4 / independent design review13c2ba9; Master source-only assignment msg_54ae61408ff3. Existing SQL1–4, fused D, v1/v2 manifest/state/runner/CLI/target/template, B3, adapter D literal, B33–35 harnesses, package/config/env and runtime/registry connections remain unchanged. B36's P-unset design statement is preserved as historical design; B37 fixes the actual new P identity below without editing that accepted document.

## D / E / P and exact authorized difference

All hashes are UTF8 after **only CRLF→LF** normalization:

| Identity | Full source SHA256 | Extracted body SHA256 |
| --- | --- | --- |
| D, immutable fused draft fbfc48c | `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` | `d08c609c0a9dfa069c71e19a6cffae5b4eb490c855d7f819cb97518c7baac368` |
| E, historical exact fuse-only experiment | `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` | `15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9` |
| P, new lib/db/postgres/0005_upload_reservation.sql | `f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339` | `15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9` |

D→P exact diff, independently recreated by the unit test from unchanged D:

```diff
--- drafts/0005_upload_reservation.sql
+++ 0005_upload_reservation.sql
@@ -1,3 +1,3 @@
--- B27 UNPUBLISHED OFFLINE DRAFT. NOT REGISTERED. DO NOT APPLY TO ANY DATABASE.
--- No migration history/manifest/runner/CLI support is supplied. SQL1-4 unchanged.
--- Intentional execution fuse: removal requires a separately reviewed assignment.
+-- Schema5 local source publication: B37. Isolated v3 source validation only.
+-- No runner, descriptor, target authorization or runtime activation is supplied.
+-- Execution requires a separately approved schema5 migration action.
@@ -5 +5 @@ BEGIN;
-DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;
+
```

The removed statement is exactly87 characters at D offset252 and occurs once. D still contains it; P does not. E exists only as an in-memory comparison in B37, not a replaced source or runtime loader derivative. The three header comments are the only other changes. P/E extracted bodies compare byte-for-byte equal; their body length is38252 characters/UTF8 bytes. No executable SQL, function body, grant, guard, inventory statement or transaction content was edited. No SQL parser/database was used to claim semantic equivalence: the stronger performed check is exact text/byte equality for the entire known executable body.

## Source-only API and binding

New module `lib/db/postgres/migration-manifest-v3.ts` exports only `PostgresSchemaVersionV3=5` (type), `requirePostgresSchemaVersionV3`, `postgresMigrationManifestsV3`, `postgresSchema5SourcePublicationV3`, verified-source type and `loadPostgresMigrationsV3(version)`. The manifest has only key5 and exactly ordinals1–5, canonical id/file mapping and immutable literal checksums. Draft/experimental/published metadata are disjoint and frozen. The loader reads only the five internal fixed files, never D/E/directory scans/environment or a caller URL. It has no sourceRoot, manifest/catalog override, callback, executor, target, pool or CLI. Missing/extra arguments and nonnumeric/nonexact5 reject before file reads; no getter or coercion is needed.

Before the first await it detaches/freezes primitive row metadata and internal file-URL strings; verifies length/unique ids/files/ordinal-to-id prefix/file mapping and nonplaceholder hash syntax. Fixed paths are reconstructed internally from those snapshots. Output is a frozen ordered array of fresh frozen `{...metadata, sql}` rows; private location strings are omitted. Exported metadata cannot be mutated while reads are pending. Promise.all preserves manifest ordering even if the five reads finish in reverse order. Import performs no I/O or execution.

Extraction order is mandatory: read UTF8 text → normalize CRLF only → check exact canonical character length and **full source hash** → split at fixed literal bodyStart/bodyEnd offsets → verify known outer prefix ends `\nBEGIN;\n`, first BEGIN marker is exactly at bodyStart−8, final COMMIT marker exactly bodyEnd, suffix exactly `\nCOMMIT;\n` → verify complete prefix/body/suffix SHA256. No trim/BOM removal, SQL splitting, dynamic fuse removal or source repair. Offsets are JavaScript character offsets; these fixed sources are ASCII and hashes always cover UTF8 bytes. Inner PL/pgSQL blocks remain untouched. On any source/read failure return only the existing closed MIGRATION_SOURCE error, with no raw file/error/cause/partial result.

P length38498, bodyStart237/bodyEnd38489, prefix hash `b72476f166adaa1375571dffd614c2f3a7a73a692b42087e0cdc01595ef44905`, suffix hash `d60cb359d759c17289fc7230cd43b8ec21dda61db61f3d041e01824f0f0b5aa1`. E length38513/start252/end38504; D length38600/start252/end38591. The five-entry literal manifest pins the corresponding wrapper metadata for every file. Historical E body hash is an independent literal and must equal published row5's body hash; it is not overwritten by whatever a target/file returns.

| Ordinal / id | Existing full source hash (unchanged1–4) | Body hash |
| --- | --- | --- |
| 1 / 0001_schema | `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19` | `2f12e9c5425a11c82263c883050d8404fccc04a8949f1c980e67352fcab3247e` |
| 2 / 0002_invariants | `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100` | `c4b6758633dc7e94ccf8e936cdfb0686368af41a3d491c08b2daa8dd11fc9c0a` |
| 3 / 0003_rls | `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` | `3a61af71d7db76e6937e5d542ecd26d056c9c4820f28b169fa2d61cc8ad58505` |
| 4 / 0004_storage_verification | `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c` | `21466ec97209bc8e6aaffcbba5657370762536f9c2cf220a7c137a0022acff8c` |
| 5 / 0005_upload_reservation | P=`f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339` | `15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9` |

## Validation actually performed

Final 2026-11-18 07:59 KST checks:

```powershell
$env:DREAM_PG_INTEGRATION='0'
$env:DREAM_PG_B22_SCHEMA_TEST='0'
$env:DREAM_PG_B23_SCHEMA_TEST='0'
$env:DREAM_PG_B24_SCHEMA_TEST='0'
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-source.test.ts tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-manifest-v3.ts tests/postgres/schema5-source.test.ts --max-warnings 0
git diff --no-index --unified=0 -- lib/db/postgres/drafts/0005_upload_reservation.sql lib/db/postgres/0005_upload_reservation.sql
```

Vitest: **171 passed /100 skipped**, five files, exit0; new source tests **45 passed**, included in171. The100 native cases were explicitly disabled, not verified. Full project TypeScript exit0 and changed-file eslint exit0. The diff command exit1 means the displayed intentional difference exists, not an execution/test failure. Selected staged whitespace and four-path checks pass. Initial focused44 tests passed but full tsc found a test's attempted reverse on a readonly array; the test uses explicit Reflect mutation to verify runtime freezing and the final checks pass. No product expectation was weakened.

New unit cases read actual fixed source fixtures and mock only filesystem faults (plus a throwing pg-construction sentinel). They verify exact D/E/P/hash/body mapping, preserved inner blocks/leading newlines, full wrapper/source metadata, CRLF-only acceptance, unsupported schemas before reads, import-no-I/O, immutable/detached snapshots, fixed paths, reversed completion ordering, and rejection of override/extra arguments without evaluating getters. BOM/trailing whitespace/SQL, missing/duplicate wrapper, CR-only/trim/header/body drift, D/E/zero/unset substitution, swapped/duplicated source contents, filesystem errors and nontext/coercion getters reject. Existing source/catalog/runner/CLI unit regressions preserve explicit3/4 manifests and continued schema5 rejection by v2 despite P now being present locally. No native/parser/cluster or actual migration command was run.

## Unverified boundaries and return

This module supplies source identities/read-only verification only. It does not supply a fourteen-category expected5 reference, strict catalog reader/state machine, migration runner/CLI, journal5 mutation, bootstrap login provisioning, signed target/action/provenance, operating policy/budgets, Auth/B3/evolved executors or production permission. Current reservation service still pins D and keeps approved-runtime DISABLED. B34/B35 historical E/native results remain frozen; they are not evidence that P or a schema5 migration runner ran. No existing manifest/registry/runtime import graph is connected to this new module.

Next gate: Tester's independent exact D→P SQL/source and v3 source-API/unit review. Only after acceptance may Master assign the separately scoped typed reference/state work from B36; reference generation/native execution/runner integration requires another allocation. No .env/real DSN, managed/provider/browser, installation/key/config/package, app build/deploy, new agent/window/worktree or shared .next action occurred.

Copyable return: B37 locally fixes P=f37dc54d… with exact E-equivalent body15a2bb3c…, unchanged D/E and SQL1–4. Isolated schema5-only v3 literal manifest/read-only loader has fixed paths/full-prefix-body-suffix pins, immutable pre-await metadata and no executor/target/runtime hook. New45 source tests included in171 pass/100 native skips, fulltype/lint0, exact diff/selected whitespace checked. Four assigned paths only; request independent SQL/source review. No DB/reference/migration/adapter-pin/provenance/activation implemented or executed.
