# T-110 — focused render guards independent recheck

- Target: `8e2da3100bff9602c1b583c60a3af0fd722a9db5` (T109). Reviewer: dispatched Codex, independent of implementation, no helpers.
- Verdict: **F107-1/2/3 PASS; overall requested gate FAIL on F110-1 diagnostic cause loss.** Review execution and report are complete. Do not infer whole renderer acceptance.
- Only repository write: this file. No product, tests, fixtures, shared documents, commit or push. Read AGENTS/common rules, team roles/current assignment, CLAUDE/PLAN/REVIEW, T105/T107/T109. The explicit report-only assignment overrides routine shared progress-document updates.

## Environment and reproducible evidence

Owned evidence root: `C:\Users\Administrator\AppData\Local\Temp\dream-t110-d5cd8e775f00486d8b6ca87f3986c9be`.

Copied all tracked files byte-for-byte into its `app/`; copied dependencies from the existing toolchain with robocopy. Target package.json/lockfile were used: root T108 uncommitted package changes are not included. No dependencies were installed. Every tracked source compared after checks: **zero byte mismatches** (`source-bytes.log`). Original CRLF retained; no newline repair or silent journal rehash. All CLI/restore data were fresh fake roots; no real userdata/data/storage/backups opened. Media executables were read-only existing ffmpeg/ffprobe under `D:/starwork/dream-ai-studio/.tools/ffmpeg`.

Commands from temp app: `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`. Results: **42 files, 496 passed / 4 skipped**, 24.38s; lint/type/build exit 0. These are independent runs; author-reported 496+4 is separate evidence. Build verifier reports no local data/secrets traced. Logs: `test.log`, `lint.log`, `typecheck.log`, `build.log`.

Additional probes: `node --conditions=react-server --import tsx t110-direct.mts` with T110_ROOT set to evidence root; `npm.cmd test -- tests/t110-recheck.test.ts`; `node --conditions=react-server --import tsx t110-snapshot.mts`. All definitive runs passed their assertions (`direct5.log`, `direct-results.json`, `restore-extra.log`, `snapshots.log`, `snapshots.json`). Probe scripts exist only in temp app. The supplemental restore file derives from s7 tests with extra semantic forgeries, retained roots, upgraded MP4 digest checks and active-job normalization checks: **7 passed / 1 generation skip**. This supplemental count is not added to the original full-suite count.

Earlier `direct.log`/`direct2.log`/`direct4.log` preserve harness failures (precreated extraction directory, Windows loader URL, and future-fixture assertion expecting no already-installed guards). Corrected definitive `direct5.log` uses a file URL for tsx loader and an actual contiguous eight-entry future journal. These are not product failures. Initial trace enumeration used wildcard-sensitive paths; corrected `traces-final.log` reads LiteralPath across all 33 NFT files.

## F107 focused results

| Contract | Independent result |
|---|---|
| F107-1 linked job identity | PASS: product openDatabase, recursive triggers enabled, four fields kind/ref_type/ref_id/project_id blocked for terminal and active linked jobs (8 explicit statements); no-op identity UPDATE allowed. Full-suite tests additionally allow progress/status/lease/cancel and unlinked job changes. Real restore normalization succeeds. |
| F107-2 file tuple | PASS: running→succeeded and running→canceled-late reject NULL path/SHA/size/verify, uppercase SHA, zero size, fractional and BLOB sizes, BLOB SHA/path (20 explicit supplemental rejection cases). Valid success and canceled-late tuples accepted and host check passes inside rolled-back savepoints. Full suite covers other partial tuple permutations and insert guard. |
| F107-3 host semantic binding | PASS: host validates input schema/metadata and exact input-text SHA, saved timeline existence, same project/id/revision/content revision and saved timeline hash, and linked job identity. Full suite exercises matching-hash revision-999 forgery through actual inspect/finish for s7 same and s6 upgrade. Supplemental repacks add contentRevision=999 (row+input agree), false timelineSha256, schemaVersion=2 and projectId changes on both s7 and s6. All refused, destination absent, repacked source ZIP bytes unchanged. |

The projectId supplemental forgery also violates the saved row/input/file-path relationship, so its restore refusal alone is not isolated evidence of which first predicate rejected it. Direct host implementation and focused DB tests separately establish the binding predicates. A forged archive is made only in disposable copies by temporarily dropping saved triggers/ignoring CHECKs, restoring the identical SQL, then recomputing archive database/inventory hashes; this models stored data that insertion triggers never authenticated.

Normal actual service paths pass: direct 7→7, upgrade 6→7 and 5→7 use inspect followed by finish. Terminal succeeded/canceled-late/verify-failed/plain-canceled records remain; running render becomes failed/RESTORE_INTERRUPTED and its job canceled/RESTORED_NOT_RESUMED. Supplemental upgraded checks find zero active render jobs/renders. Both terminal MP4 digests match fixture input bytes in direct and 6→7 restore; 5→7 has zero renders. Source ZIP bytes remain unchanged. Restored 0007 job guard rejects identity changes.

## Registration, immutability, migration and packaging

`git diff --exit-code 94c5647 HEAD --` explicitly enumerated SQL1–4, both code5 CJS sources, SQL6, s4/s5/s6 ZIP+JSON and s4/s6 input directories: **exit 0**. New guards are introduced in 0007, not rewritten into issued 0006. SQL6 normalized digest remains `0bedf2afb9db707b255917707a364ed6a30f35b8d97dfb660485e2e7aea0d19e`; certified code5 remains `6a012009fd045439d6d3af8ad2021043fec475aadf10fd942b6585c9e88f0061`.

Full suite checks exact ordered product registration 1..7, s5/s6 exact prefixes, 0007 normalized-source hash and attached read-only checkRenderRows verifier. migrateDatabase applies SQL/journal and data verification within one immediate transaction; failed verification rolls back all new journal/trigger changes, without transforming invalid rows.

Actual CLI child process uses product scripts/db.ts with react-server condition, tsx loader file URL and TSX_TSCONFIG_PATH. Fresh s6→7 exit 0 applies one step, preserving all six old journal rows including timestamps; subsequent noop exit 0 leaves DB file SHA unchanged. Pre-migration copy exists with six-entry journal, integrity ok and no FK violations. Invalid-data prebackup has exact all-table snapshot/schema equality to the rolled-back original (`snapshots.json`).

Invalid s6 data was created through legal SQL6 running→succeeded with NULL SHA, without dropping guards. Actual CLI 6→7 exits 1: original DB file SHA before/after identical; six journal entries retained, zero 0007 journal rows and zero of the three new triggers. The prebackup remains. Internal migrateDatabase separately reports the exact offending render ID and reason, while CLI loses that cause (F110-1 below).

Actual CLI source-unavailable (cwd outside app, loader/config resolved), contiguous future 1..8, and changed SQL6 recorded digest all exit 1 with unchanged DB file bytes. Noop/refused current/future/mismatch open paths retain the read-only probe boundary; sidecar result writes are distinct from DB writes. Source failure prints app-folder/reinstallation/migration guidance before opening DB. A current 7-stage app refuses mismatched source journals; no silent rehash occurs.

All **33 server NFT manifests** inspected. Their union includes all eight migration source files: SQL1–4, code5 entry/shared CJS, SQL6 and SQL7 (`traces-final.log`). Production packaging therefore traces the new SQL7 alongside the exact certified CJS sources.

## F110-1 — actual CLI discards the invalid-row failure cause (required for requested clear-cause gate)

Locations: `lib/db/live-migrate.ts` final catch and `lib/db/migrate-command.ts` LiveMigrationError handling.

Reproduction: extract fixed s6 into owned `invalid-v5`; use product connection to update its running render to succeeded with correct path/finished_at/size/verify but sha256 NULL; close; run real scripts/db.ts migrate with DREAM_DATA_ROOT pointing at this fake root.

Internal check emits:

`RenderRowError: Render row 019b8b82-be00-76c9-928d-d67503eacebb: file fields are incomplete`

Actual CLI stderr/stdout (`invalid-v5-cli.log`) contains only generic migration-failed/preserved-data/retry guidance and prebackup filename. It contains neither render ID nor file-fields cause. The live migration catch replaces RenderRowError with `new LiveMigrationError("MIGRATION_FAILED",path)` without preserving/logging it; command prints only shared copy. The sidecar `data/migration-last.json` correctly retains public `code: "MIGRATION_FAILED", reason: null, from: 6, to: 7` and snapshot fingerprint, but it also does not carry the cause. This is **not merely a sidecar/public-code limitation**: actual CLI diagnostic output loses the cause too. T109's lower-level error/test evidence must not be described as actual CLI cause logging.

Required correction: preserve generic public code/copy as appropriate, while making the offending render ID and validation reason available in actual migration diagnostic output or an explicitly identified diagnostic log; retain atomic failure and prebackup guarantees. Independently rerun invalid fake s6→7 and confirm diagnostic cause plus unchanged DB/no partial 0007. No actual user data migration is needed for this correction.

## Fixed s7 scope, gaps and next gate

Fixed s7 ZIP digest/record, seven-entry journal, five render rows matching s6, logical content/schema, deterministic regenerated logical content/schema and s6→s7 preservation all passed in the independent suite. Regeneration uses P_REGEN's documented migration-timestamp exclusion; it does not prove generated ZIP byte identity. Fixed ZIP byte identity is separately checked against its recorded digest, including at suite end. s7 ZIP: 555424 bytes, SHA256 `b861d214187bbade08136be9a36a4a8f6909ac900e52bd113ed12e46ec5e503b`.

MP4s remain authentic fixed small H.264 fixture files: succeeded 73037 bytes / `93025ddd96faa0d0b7253e3a9c156617221426d804b18f2bc4c409525a79fb33`; canceled-late 73026 bytes / `5d80beeda0a9496544c6869628f86bb77b1a346fc5f6ce42d51165bf775d1417`. They are pre-generated fixed-color clips, with placeholder composition digest and an incomplete timeline slot; fixture authenticity and backup preservation do not authenticate actual composition rendering. Renderer/browser/app worker/UI absence is outside foundation and not a failure. No real user-data migration, actual composition render, UI/browser flow, device or network/lifecycle behavior is claimed.

For integration, fake sessions still on schema5/6 must be migrated from the app folder with their explicit fake DREAM_DATA_ROOT; startup migration guidance remains necessary. This report authorizes no actual-user migration. Foundation gate remains held only for F110-1 within this requested review; F107-1/2/3 are resolved on this target.

Evidence and owned fake roots are intentionally retained. All invoked processes exited; no server/worker/watch launched, no cleanup of others' files. No recursive deletion was issued by reviewer probes; standard suite cleanup removes only its own checked OS-temp test roots. Repository status before report was clean; no product edits were made.

Copyable message for Claude design / planner (draft; actual worker completion is sent to coordinator via Orca):

> T110 independently rechecked 8e2da31: F107-1/2/3 PASS, independent 496 passed/4 skipped plus lint/type/build PASS, actual s7/s6/s5 restore and terminal MP4 preservation PASS. Overall requested gate remains FAIL on F110-1: invalid s6→7 safely rolls back but actual CLI discards the render ID and validation cause, beyond the known generic sidecar code limitation. Please retain the foundation gate until diagnostic cause preservation is corrected and focused fake-root rechecked; actual renderer/browser/worker/UI remain later scope.
