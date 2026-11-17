# B37-R — Independent schema5 local source publication review

**Verdict: PASS for the assigned local SQL/source manifest boundary.** Exact D/E/P derivation, fixed-source loader and immutable metadata passed independent inspection and reproduction. No mandatory defect found. This is not parser/database/reference acceptance, migration execution, target/provenance authorization or runtime activation. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_6b2306ac3b68`; receipt `msg_16dca7b821e8`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen identity and exact source difference

Reviewed fixed **6011284e098d378356df1435c3ed9d6dbee96f42**, exactly four new assigned paths. Current bytes matched that commit; independently recorded LF SHA256:

| Artifact | SHA256 |
| --- | --- |
| P / lib/db/postgres/0005_upload_reservation.sql |f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339|
| migration-manifest-v3.ts |0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698|
| tests/postgres/schema5-source.test.ts |21797dc3a0ea2fb36b8f2443a21a98dfb8ecce7e8d7a5059a0b6de67286abd65|
| B37-SCHEMA5-SOURCE-PUBLICATION.md |47527af4b9645b611cbfa9c98ff27cc510abd090a6a9d2f9e2acfb64475c01e0|

Original D was read from frozen fbfc48c95264eaf37826f943b5e35e9fe67fa616 and matched the still-fused repository draft. Independently verified D full hash `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`, exact fuse length87/offset252/occurrences1. Historical E was compared in memory only, with full hash `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e`.

P differs from D only in the exact three header comment replacements and deletion of that one known fuse statement, preserving its newline/blank line. All543 lines remain. No other statement, function body, grant, guard, inventory or transaction content changes. Independently reconstructed expected P from D and compared complete bytes; retained exact diff in owned scratch. CRLF→LF is the only normalization; no trim/BOM rewrite or SQL parser was used.

Known outer-transaction extraction gives D body hash `d08c609c0a9dfa069c71e19a6cffae5b4eb490c855d7f819cb97518c7baac368`; **E/P bodies are byte-identical**, hash **15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9**, length38252 UTF8 bytes/characters. P full length38498/bodyStart237/bodyEnd38489; prefix hash `b72476f166adaa1375571dffd614c2f3a7a73a692b42087e0cdc01595ef44905`; exact suffix `\nCOMMIT;\n` hash `d60cb359d759c17289fc7230cd43b8ec21dda61db61f3d041e01824f0f0b5aa1`. Leading body newlines and inner PL/pgSQL BEGIN blocks remain intact.

## Loader and isolation assessment

Manifest-v3 has only key5, ordinals1–5, fixed canonical id/file strings and nonplaceholder literal full/body/prefix/suffix hashes. Entries1–4 retain their accepted full hashes. D/E/P metadata are separate frozen records; published row5 is the actual fixed P, with independent historical E body pin equality. P is not stored under D or derived from D at load time.

`loadPostgresMigrationsV3` rejects missing/extra arguments and anything other than primitive5 before reads/coercion. There is no sourceRoot/manifest/catalog/target/executor/callback override. Before the first await it copies/freezes all primitive metadata and internal file-URL strings. These strings are private; filesystem paths come only from the fixed module location. All exported nested metadata is frozen, and returned rows/array are detached/frozen. Promise.all preserves manifest ordering and retains rejection handlers for every concurrent read.

Read order is UTF8 string check, CRLF-only normalization, complete character-length/full-SHA validation, fixed-offset extraction, exact known wrapper positions/suffix and prefix/body/suffix SHA checks. A failed file yields only existing MIGRATION_SOURCE with no partial source array, raw path/error/cause. The fixed full-source pins prevent malformed-wrapper/body substitution before extraction. This is fixed-source verification, not SQL parsing or equivalence inference from arbitrary input.

Import has no I/O or executor operation. Its imported v1 error module also performs no import-time reads. No pg/pool/client/target/environment or DB runner is introduced. Search of lib/scripts found no consumer/import connecting this v3 module to an existing runtime/registry graph. Existing v1/v2 closed3/4 behavior, target/template, adapter D pin and approved-runtime DISABLED remain unchanged.

## Reproduced checks and independent counterexamples

From repository root, with `DREAM_PG_INTEGRATION`, `DREAM_PG_B22_SCHEMA_TEST`, `DREAM_PG_B23_SCHEMA_TEST`, `DREAM_PG_B24_SCHEMA_TEST`, `DREAM_PG_B25_SCHEMA_TEST` explicitly0 in the invoked test processes:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-source.test.ts tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-manifest-v3.ts tests/postgres/schema5-source.test.ts --max-warnings 0
node --conditions=react-server --import tsx tmp/b37r-review-6011284/real-loader.mjs
node node_modules/vitest/vitest.mjs run --config tmp/b37r-review-6011284/vitest.config.ts
```

| Check | Independent result |
| --- | --- |
| Frozen five-file unit suite |171 passed /100 skipped, exit0; includes45 original source tests and126 related regressions|
| Full project TypeScript |exit0|
| Changed-file lint |exit0 /zero warnings|
| Actual filesystem loader |exit0; all five real fixed files loaded with official server-only react-server export, all full/prefix/body/suffix bindings and detached frozen outputs verified|
| Owned scratch counterexamples |8 passed, exit0; no unhandled rejection reported|

Independent scratch cases: accept mixed LF/CRLF while preserving exact canonical bodies; reject replacement-character corruption, same-length lone CR, leading NUL and wrapper-case drift; reject proxy version/extra override arguments without evaluating get/ownKeys/prototype traps; retain all five concurrent rejection paths after an initial read failure with no partial result/secret cause; and recover on a fresh call after synchronous filesystem failure while keeping exported/returned metadata frozen and detached. The eight count includes four parameterized malformed-source cases. Production source/tests/expectations were not patched.

Owned ignored evidence root: `tmp/b37r-review-6011284`. It retains independent test/config, real-loader script/result, source-preflight.json and D-to-P.diff. The real-loader command reads source files only; it never parses or executes their SQL. Filesystem mocks affect only the scratch fault tests; actual file-loader verification used no filesystem mock. All checks used existing dependencies; no installation.

Independently compared protected original sources to the fixed commit:50 files including SQL1–4/D, v1/v2 tools/target/provision, reservation/model sources, historical native harnesses and package/config. The B36→B37 lib/scripts/tests/package/config delta contains only the authorized new P/manifest/source test. Final tracked product diff against6011284 is empty. Unrelated T122/T137 documents were preserved. Staged report whitespace check passes.

## Limits and return

PASS establishes exact local source identity and the read-only API behavior above. It does not establish SQL P execution, schema5 history/state,14-category expected reference/normalizer, native cross-cluster compatibility, runner/CLI atomicity/unknown handling, bootstrap provisioning, trusted target/action/signature/private handle, policy/Auth/provider/B3/evolved readiness or activation. Historical E native evidence remains historical E; body equality does not relabel those runs as P.

No DB/parser/native/reference cluster, SQL execution, registry/runner/CLI/provision implementation, adapter transition, managed/provider/browser request, env/package/config edit, build/deploy or new agent/window/worktree occurred. Any next typed reference/state or native task requires a separate Master allocation. Return fixed6011284 **source PASS**, no mandatory findings; this review supplies no target execution permission.
