# T-045 · K6 independent recheck — scoped FAIL

- Reviewer: **CX-REVIEW-06**, implementation-independent; coordinator CX-MASTER-01. Task `task_4a97ab2b8e31`, dispatch `ctx_554493d1a416`. No subagents/helper workers.
- Initial and tested HEAD: `bed203614d1b9b0733565f6730f48fd1dcac157b`, branch/worktree `k6-db-protection-recheck`; initial `git status --short` empty. Requested target `83b58f7` is an ancestor (`git merge-base --is-ancestor 83b58f7 HEAD`, exit 0). Target→HEAD changes only `docs/TEAM.md`, so tested product code equals the requested target.
- Read AGENTS, AI_TEAM_RULES, CLAUDE, both role guides, current TEAM/REVIEW, PLAN 14 K6, T017/T034/T035 implementation and design/T039/T041/T042/T043/T044 reports. Prior results are reference material, separate from the executions below.
- **Verdict: scoped FAIL.** Original F043-1 reproductions pass; original F043-2 stationary-input cases pass; original F043-3 corrupt-header case passes. Two mandatory residual defects remain: **F045-1** absent-path `afterProbe` rejection changes an unknown DB to WAL, and **F045-2** legacy/no-digest fallback confirms a different integral business-data state as the pre-migration copy. K6 acceptance/0005 entry needs correction and independent recheck.
- Only repository write: **this report**. No code/test/fixture/planner/shared-document edits, commit, push, real user DB, existing server, paid API, or publication. All DB mutations and extra scripts are in newly created fake OS-temp namespaces. Root ffmpeg executables used read-only.

## Baseline and independent command results

Windows / Node `v26.13.0`. Main evidence directory (`E` below):

`C:/Users/Administrator/AppData/Local/Temp/dream-t045-257aa9000d1d4d8eaa7b905f72c449f9`

| Command | Result |
|---|---|
| `npm.cmd ci` | Exit 0; 265 packages, existing 7 moderate advisories reported; `E/ci.log` |
| Remove `Env:DREAM_DATA_ROOT`; set `FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`; `npm.cmd test` | **30 files, 305 passed / 1 skipped**, 7.67s; `E/test.log`. Skip is fixture-generation mode, never invoked. This is the reviewer's run, separate from Master's 305-pass run. |
| `npm.cmd run lint` | Exit 0, max-warnings 0; `E/lint.log` |
| `npm.cmd run typecheck` | Exit 0, Next typegen + tsc; `E/typecheck.log` |
| `npm.cmd run build` | Exit 0, build trace confirms no local data/secrets; `E/build.log` |
| `git diff ebd0dff^ HEAD -- lib/db/migrations` | Empty; product SQL 0001–0004 unchanged, no product 0005 |
| `Get-FileHash tests/fixtures/backups/s4.zip` | Before/after SHA256 `6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392` |
| `node --conditions=react-server --import tsx E/independent.mts E` | 41 independently recorded case results: rejection matrix, actual CLI/seed, app wrapper, races, normal upgrade/no-op, snapshot substitutions; `independent-results.json`, `independent.log` |
| Same invocation with `E/t043-replay.mts` | Original T043 exact DEFAULT/CHECK/generated/type/application_id/unknown reproductions, 6 inputs × direct/live, stationary DELETE startup/CLI, actual collision CLI and 512-byte fake copy; `t043-replay.json/.log` |
| Same invocation with `E/final.mts` | Exact race hashes, legacy same-fingerprint/different-data comparison, post-browser source preservation, actual completed-ticket/log counts; `final-results.json` |

`t043-replay.mts` was copied read-only from accessible `%TEMP%/dream-t043-review/review.mts`. Only its new temp namespace/output path and changed `keptSnapshot(root,record)` signature were adapted. Existing T043 evidence was never overwritten. Its extra fake roots are named `dream-t045-original-repro-*`; exact path is in `t043-replay.json`.

## Mandatory F045-1 · P1 · a newly appeared refused DB is changed to WAL

Location: `lib/db/migrate-command.ts`, `const existed=existsSync(file)` and subsequent `openDatabase(file,{},{wal:!existed})`; `lib/db/connection.ts` default WAL pragma.

Independent deterministic reproduction using the provided `afterProbe` seam:

1. Start with an owned temp root containing `data/` but **no app.db**.
2. Invoke `runMigrateCommand({root,afterProbe})`.
3. In `afterProbe`, create and close a raw default-DELETE SQLite DB at that path:

   ```sql
   CREATE TABLE survivor(id TEXT);
   INSERT INTO survivor VALUES('keep');
   ```

4. The command opens it with `wal:true`, because `existed` still reflects the earlier missing path. The live origin guard then rejects it with exit 1 / SCHEMA_MISMATCH / unrecorded, without a snapshot.

Exact independently repeated values (`final-results.json`, `race-exact/`):

| State | SHA256 | Header bytes 18/19 |
|---|---|---|
| Closed unknown DB created in afterProbe | `d8c7c2be1a2ee4f6bcb9949417e0033d77ce1bb69bdd24db2dbcfe709fe3fd39` | 1 / 1 |
| After rejected command | `609d3780886f99454c091b802e684b476c4685125aa4f130988722ba13d93b18` | 2 / 2 |

The earlier `independent.mts` reproduction independently records semantic equality and no snapshot. Survivor row remains; this is observed persistent mode/header/byte mutation, **not observed row loss**. The refusal still says “지금 데이터는 그대로예요.”

Existing-path afterProbe regression **passes**: begin with product s3 in DELETE mode; after probe delete its journal rows; the writable connection uses `wal:false`, rejects unrecorded, preserves the post-hook bytes/semantics and makes no snapshot. Thus the existing-file fix is effective but the original absence decision is stale.

Required correction: no persistent mode change before validating the actual writable connection's input, including a file that appeared at a formerly nonexistent path. Opening without WAL until provenance succeeds is one approach. Add absent-path→nonempty DELETE regression alongside existing-path regression and retain true-fresh/canonical initialization and normal upgrade success. This is a concrete reproducible sequencing defect in the supplied seam; no claim about arbitrary adversarial OS scheduling, race frequency, or comprehensive race prevention.

## Mandatory F045-2 · P2 · legacy fallback proves schema/journal, not the pre-migration business data

Location: `lib/db/migration-record.ts` `keptSnapshot` optional `snapshotSha256` branch and `databaseFingerprint`; `lib/db/server.ts` passes its truthy return into confirmed-copy wording.

Independent actual CLI setup: raw DELETE product migrations 1–3, settings sentinel `review.sentinel="original-business"`, and a preexisting `activity_update_guard` trigger colliding with 0004. Real `scripts/db.ts migrate` exits 1, preserves source bytes, writes a failure sidecar and retains a real consistent snapshot. Its new digest matches the snapshot.

Static substitution, no race or source alteration:

1. Make an ordinary copy of that real snapshot. Update only its sentinel business row to `"REPLACEMENT"`; close it. Schema, all journal rows including applied times, and integrity remain unchanged.
2. Put that alternate integral SQLite file at the recorded snapshot path.
3. With the new record's digest present, `keptSnapshot` correctly rejects it.
4. Remove only `snapshotSha256` to represent the explicitly supported legacy format. `readMigrationRecord` accepts it; `keptSnapshot` returns the relative path and `checkDatabase` says **“따로 복사본도 남겨 두었어요.”**

Exact retained comparison (`final-results.json`, browser-copy files):

| File | SHA256 | Sentinel |
|---|---|---|
| Genuine pre-migration copy | `0e2d9a8eb37c439595d85e2dff3d3bccad03b7d90e740f670e4e360f39ee24ac` | `"original-business"` |
| Alternate same-schema/journal copy | `d3509d328ac9267620844f3cc4e81d58e2b13054b6e2d25371d1b717ae80ee2f` | `"REPLACEMENT"` |

Both `databaseFingerprint` values are `27d7eaeb8da91d974746f63833c6f6e453be3ec3e6cbee2536fad6139f5595fc`; alternate `integrity_check` is `ok`. `independent-results.json` contains an additional independently created same-schema/business substitution (`"DIFFERENT-BUSINESS"`) with the same accepted legacy outcome. Source DB bytes and snapshot candidate bytes remain unchanged by validation.

**Actual production /setup also reproduces this misleading confirmation at 1280 and 390**, including its relative copy path and MIGRATION_FAILED code (`detail-legacy-business-*.png`, `browser-setup-results.json`). This is not a mocked browser response.

Required correction: a digest-free legacy candidate cannot be called the confirmed pre-migration copy based only on schema/journal equality. Fail closed to unconfirmed wording, or add an independently justified full-data relationship check appropriate to failure records. Keep legacy record parsing/other useful failure guidance if desired, but do not upgrade weak evidence into confirmed-copy wording. New digest records correctly cover static content replacement; their local sidecar is not a tamper-proof external authority. No same-privilege OS race or universal cryptographic provenance claim is needed for this finding.

## F043 reproduction and preservation coverage that passes

### Canonical journal and stationary refused inputs

- The copied **exact original T043** cases all classify unrecorded, direct/live throw, retain original WAL DB SHA256, and create no snapshot: wrong types, DEFAULT, CHECK, hidden generated column, application_id, unknown table/row. Original raw-DELETE checkDatabase and command now retain bytes and DELETE mode. Exact 512-byte original fake header now returns `kept:null` and unconfirmed guidance.
- Additional own 11 variants × raw DELETE/WAL: DEFAULT, CHECK, generated hidden column, four TEXT columns, no STRICT, WITHOUT ROWID, noncanonical spacing, unknown survivor table/row, application_id, user_version, and unreadable one-column populated journal. For each: startup refusal; direct/live parity using `wal:false`; **actual child-process migrate exit 1**; `withDatabase` callback refused; **actual child-process seed exit 1**. Final original SHA256, header and full logical state all equal, and snapshot directory absent.
- Logical comparison reads every user table's rows, all sqlite_master definitions, user_version and application_id read-only. Raw DELETE inputs are not preconditioned to WAL. Already-WAL reads can create empty SQLite sidefiles; DB-main byte preservation is checked separately and no zero-sidefile guarantee for WAL is claimed.
- Canonical exact product-created empty journal and a truly empty raw DELETE DB both succeed through actual CLI, apply 4 steps, and pass startup. Full suite also covers direct/live genuine-empty/canonical success and unknown table/view/trigger/index/extra-column rejection.
- `openDatabase` intentionally retains its default WAL behavior. Direct/live calls on refused DELETE inputs must use the new `wal:false` option; those lower-level functions cannot undo a mode switch already performed by a caller. The actual public startup/CLI/seed/withDatabase paths were checked as above; F045-1 identifies the remaining public CLI sequencing leak.

### Successful s3 upgrade and same-version behavior

- Own raw DELETE product s3 + sentinel, actual CLI: exit 0, product s4 passes startup, new retained `_s3-s4.db` and sidecar digest. Read-only snapshot's **all-table/schema/journal logical state equals the pre-upgrade source state**, including sentinel; therefore the retained copy is before changes in this execution. No original backup/fixture overwritten.
- Own raw DELETE product s4: startup pass and actual CLI no-op exit 0, source SHA unchanged, header 1/1; result record reports success 4→4. A no-op can update its sidecar; DB no-op is what was checked.
- Executed full-suite E1–E4: committed WAL values included in snapshot; exclusive existing file preserved; snapshot-directory failure prevents migration; competing commit after snapshot returns DATABASE_BUSY and retains snapshot; held write lock blocks safely; transaction failure rolls back source and retains copy. These are meaningful concurrency checks, not proof of all OS interleavings.

### Snapshot integrity, digest, sidecar and fallback

- Actual CLI failed s3→s4 retains a valid read-only-checkable copy; source hash unchanged and DELETE header 1/1. Validation leaves snapshot hash unchanged with no snapshot `-wal/-shm/-journal` files.
- Independently replace snapshot with 512-byte magic/header candidate, half-truncated file, middle corruption, or unrelated integral DB: rejected with both new digest record and digest-free legacy record. Restoring the actual copy makes it accepted again. Invalid candidates never alter the source. The new digest rejects same-schema/different-business copy; the legacy acceptance is F045-2.
- Full suite's strict sidecar schema rejects unknown fields/codes, malformed JSON, oversized (>4096-byte) content, traversal/absolute paths, directory records; validates current DB and app-list fingerprints, ignores mismatched/stale/success records, and checks no-op clears stale failure. New optional digest does not silently allow unknown legacy fields. Explicit wrong-digest regression passes.
- Full suite executes real junction substitution rejection, snapshot name/path containment and file-kind checks, failure record-write exception (exit 1 and unchanged source, default startup guidance), successful DB work despite failed record write (exit 0), SNAPSHOT_FAILED/SNAPSHOT_EXISTS and external root cases. This report does not treat sidecar fingerprints as full business-row identity or sidecar integrity as privileged authenticity.
- Corrupt-copy startup checks preserve source DB and use unconfirmed-copy guidance; failure CLI exit semantics remain 1. Kept copy failures are caught without opening source writable. ACL denial/disk full/power loss were not physically injected.

## Actual browser and restore recovery: scoped PASS apart from F045-2

Own production servers only, `127.0.0.1:31951` (failed migration), `:31952` (healthy fixture-copy runtime), `:31953` (unknown DELETE DB); ports checked unused before start. New ego taskSpace **35**. Screens at 1280×900 and 390×844, with device metrics explicitly set for each viewport. Snapshots, DOM state and screenshots are actual production UI.

- /setup real valid snapshot: confirmed-copy sentence, relative `backups/pre-migrate/...` path, command/next action and MIGRATION_FAILED. Real invalid 512-header copy: “바꾸기 전 데이터는 그대로예요” + “바꾸기 전 복사본은 확인하지 못했어요”, no confirmed copy path. Legacy alternate business rows incorrectly confirm, F045-2.
- Unknown DELETE /setup: unrecorded guidance and SCHEMA_MISMATCH code. `/`, `/settings` return 200 setup-gated content; `/api/backups`, `/api/jobs` return 503. Final DB SHA remains `d8c7c2be...3fd39`, header 1/1 after all startup/app/API requests. Failed migration source hash remains `ccb07909...69195`, header 1/1.
- All four setup variants have scrollWidth/innerWidth **1265/1280 and 375/390**; relative paths/command/code wrap, no horizontal overflow. Opened screenshots including scrolled failure-card details to inspect actual wording and layout. Setup body exposes no drive/UNC absolute runtime path; ordinary settings path inputs intentionally show the entered local path.
- F039-1 actual terminal failure at **both widths**: select fixture-copy backup, enter own empty destination, focus Inspect + keyboard Enter; real inspection succeeds s4/s4. Append a zero byte only to own temp ZIP copy, focus Finish + keyboard Enter. Actual BACKUP_SOURCE_CHANGED clears sessionStorage, re-enables preserved backup/destination inputs, displays Inspect and focuses `restore-inspect`. Reload has no dead saved ticket/Finish button. Each copy restored from fixed fixture afterwards. Widths again 1265/1280 and 375/390. Actual source tickets read as failed. Selection/input preservation is measured immediately after failure; ordinary unsaved inputs can reset on reload.
- Additional **real prepared/published recovery**, not fetch mocking: add a fake-root-only SQLite trigger rejecting source `restore.completed` activity insertion. Inspect/keyboard Finish publishes restored copy but source completion transaction fails. Actual source ticket remains **prepared** with persisted normalized DB hash. Second real keyboard Finish while trigger remains yields retry guidance and `restore-finish` focus; saved ticket survives reload with backup/destination. Remove injected trigger and set that fake source ticket's expiresAt to 2020 (explicit expiry injection, not elapsed wall time). Same-ticket keyboard Finish authenticates the published copy, completes, clears storage. Actual completed replay HTTP **200**, source and destination have exactly **one** restore.completed row each. Destination SHA before published recovery, after completion, and replay stays `2969ca33977976ee162f56e7125af5ec4773e8fcd4e37a6332f4756b49694de6`; ZIP remains fixed-fixture hash.
- Prepared browser run was desktop; both-width terminal failure is separate. Full-suite restore tests independently execute rename failure→prepared→retry, real service expiry/missing/source-change/upgrade-failure, finishing leases, forged marker/tamper rejection and published recovery after advancing the injected clock beyond expiry. Maintenance-route response combinations are mocked route tests; no claim those mocks are filesystem injections. No browser fetch interception was used in this review.

Browser harness corrections: the first browser2 script disconnected when importing native better-sqlite3 into the browser CLI's separate Node runtime; existing taskSpace was reinspected, native fixture preparation moved into ordinary shell Node, and the complete browser check was rerun in browser3/9. First prepared observation used an already-existing empty role=alert and observed a pending request; it is **not counted as final UI evidence**. Browser6 waits for retry text and source status verifies prepared. Browser7's wait for Inspect timed out because success renders a completion card instead; reinspection showed completion and browser8 recorded the actual 200 replay/hash/storage result. These harness errors are retained, not reported as product failures.

## F039-4, old compatibility and future conditions

Executed full-suite `k6-compat` assertions compare exact protectedRoots against this execution's runtime/data/storage/backups, restoredAt against injected restore time, and added activity created_at against the measured wall-clock finish interval. A2–A5 use these independent checks; rows/PK/counts and D_R changed/unchanged columns, deleted runtime settings, new migration data and files remain checked. No whole business table is silently excluded. The activity clock remains system time rather than injected restore time and is tested accordingly.

Full suite passes exact-prefix/hash/name/gap/duplicate/future refusal, missing/manifest↔DB journal mismatch, original ZIP pre/final hash, staging-only upgrades, direct-migrate/restored equivalence, SQL/data-verifier rollback, FK/integrity/files/edit checks, staging cleanup, no overwrite, normalization and authenticated replay. Product SQL remains 0001–0004; test-only fifth SQL steps do not mean product 0005 exists. This review's extra product s3 test is a synthetic small live-CLI upgrade; the richer fixed-s4 business data is exercised by the suite, not claimed as a historical s3 release archive.

**Code-data-migration execution/source hash is still unimplemented.** Before the first applicable migration/0005, bind numbered/name/hash identity to code transformation source, prove deterministic output and direct/restore equivalence. `Migration.verify` is a verifier, not that contract. This future condition alone is not a current SQL-scope failure; the two concrete residual defects above cause this scoped FAIL. Existing user flow/design gates are preserved and this report authorizes no next milestone/product 0005.

## Evidence, cleanup, handoff

Main files in E: independent.mts/results/log; t043-replay.mts/json/log; setup.mts/browser-data.json; browserprep.mts/browser-copy-data.json; browser1–9.mjs (including documented failed attempts); browser-setup-results.json; browser-restore-results.json; prepared-browser*.json; prepared-recovered.json; ticket.mts/tickets-*.json; final.mts/final-results.json; terminal-*.png, verified-setup-*.png, detail-*.png and prepared-retry.png; fake runtime/DB/copy roots. Temporary evidence intentionally retained; no recursive cleanup attempted and no old evidence modified.

TaskSpace 35 `finish({keep:[]})` completed. Owned Next sessions **77113/75152/56014** received Ctrl-C, each confirmed exit 1; final owned-port listener query returned none. No workers or other sessions/processes were controlled. Final fixture SHA unchanged. Dependencies/.next are ignored generated outputs; final intended git change is this report only.

Limits: Windows only; no production data, large-DB performance, disk exhaustion/power loss, physical ACL enforcement, network-volume behavior, all assistive devices, or adversarial OS link/hardlink/check-use races. Static junction checks and deterministic afterProbe tests do not establish comprehensive race resistance. New digest check proves equality to the locally recorded digest at inspection time, not tamper-proof historical ownership.

Master next: assign F045-1/F045-2 correction, preserve successful F043/F039 regressions, request independent focused recheck before accepting K6. No source fix was attempted because this assignment authorizes only this report. Report creation, worker_done delivery, and Master integration/acceptance are distinct.

플래너/총괄에게 복사할 메시지:

> Claude design / Codex Master: T045 독립 재검수는 scoped FAIL입니다. clean bed2036(83b58f7 포함·제품코드 동일)에서 직접 305통과/생성1skip와 lint/typecheck/build, T043 원문 재현 및 실제1280/390 시작안내·terminal복원실패 재검사·실제 prepared 인증복구/200 replay를 확인했습니다. 기존 비정규 journal/정지상태 DELETE 변경/손상머리글 결함은 수정됐지만, 처음 없던 경로가 afterProbe에서 nonempty DB가 되면 거부 전에 DELETE→WAL 바이트가 바뀌는 F045-1과 digest 없는 옛 기록이 업무행만 다른 정상 DB를 확인된 사본으로 안내하는 F045-2가 남습니다. 고유 보고서만 작성했고 원본/fixture/제품/공용문서·커밋/푸시는 건드리지 않았으며 두 필수수정 뒤 독립 재검수와 미래 코드이관 해시 선행조건을 유지해 주세요.
