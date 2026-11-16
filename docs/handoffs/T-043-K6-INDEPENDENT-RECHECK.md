# T-043 · K6 independent re-review — FAIL

- Reviewer: CX-REVIEW-05, implementation-independent; coordinator CX-MASTER-01. Task `task_6b7604c1d014`, dispatch `ctx_c24d11ef5996`. No subagents/helpers.
- Initial/actual HEAD: `f1c9eb1060dc71342c9bac330f462b501134577b`, branch `k6-fix-independent-recheck`; initial `git status --short` empty. Target `f8e4e283d410f325d68698d4f7a21b0b59698637` and T041 `9c56033` both ancestors (exit 0). Target→HEAD changes only docs/TEAM.md (10 lines), so product code tested is exactly the requested target.
- Read AGENTS, AI_TEAM_RULES, CLAUDE, role guides, current TEAM/REVIEW, PLAN14 K6, T017 §3, T034, T035 implementation, T039 independent FAIL, T041 and T042 reports. Their results were reference material, not this review's execution evidence.
- Authorized repository write: **this report only**. No code, tests, fixtures, planner/shared docs, original runtime data, commit or push changed. npm install/build generated ignored dependencies/build outputs. All DB writes were to reviewer-created fake OS-temp roots. Existing servers and root coordinator runtime were not used.
- Verdict: **scoped FAIL**. F039-1 passes the exercised correction/replay cases; F039-4 passes. F039-2/F039-3 have the mandatory defects F043-1/2/3 below. K6 acceptance / product 0005 entry remains blocked pending correction and re-review; this report does not override user flow/design gates.

## Independent commands and results

Executed in this child checkout on Windows, Node v26.13.0:

| Command/check | Result |
|---|---|
| `npm.cmd ci` | Exit 0; 265 packages; npm reported existing 7 moderate advisories; no dependency changes |
| Unset DREAM_DATA_ROOT; set FFMPEG_PATH=`D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, FFPROBE_PATH=`D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`; `npm.cmd test` | **29 files, 280 passed / 1 skipped**, duration 7.42s. Skip is S4_WRITE fixture generation; generation mode was not invoked |
| `npm.cmd run lint` | Passed, max-warnings 0 |
| `npm.cmd run typecheck` | Passed, Next typegen and tsc |
| `npm.cmd run build` | Exit 0, compiled and trace check passed: no local data/secrets traced |
| `git diff ebd0dff^ HEAD -- lib/db/migrations` | Empty: original product 0001–0004 SQL unchanged; no product 0005 |
| `Get-FileHash tests/fixtures/backups/s4.zip` | SHA256 unchanged at checkpoints and final: `6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392` |
| `node --conditions=react-server --import tsx <temp>/review.mts` | Independent live/direct malformed-journal, application_id, unknown-data, CLI/startup and corrupt-snapshot probes; JSON evidence listed below |
| Same invocation for `s3.mts` and `finalcheck.mts` | Product s3→s4, authenticated replay/source hash, startup byte diff, actual browser ticket statuses |

The full test count above is this reviewer's execution, separate from Master's 280-pass evidence. Suite log: `%TEMP%/t043-test.log`. Initial probe bootstrapping used invalid Windows dynamic import paths, corrected to file URLs before successful execution; these loader errors are not product failures. Initial s3 custom attempt placed its ZIP in the destination's parent, correctly failed restore boundary validation, and was rebuilt in a new temp directory with an archive subdirectory; only the final isolated execution is counted as the s3 success.

## Mandatory defects

### F043-1 · P1 · empty-journal exception accepts schemas outside the exact allowed schema

Locations: `lib/db/migrate.ts:24–32`, particularly `table_info(...).map(column=>column.name)` at line 31; live guard `lib/db/live-migrate.ts`, direct transaction guard `migrate.ts:57`.

The new provenance guard compares only the four visible column **names**. It does not compare types, PK/nullability, STRICT, defaults, constraints or hidden/generated columns. `PRAGMA table_info` hides generated columns. The stated exception is an exact empty product journal; these are not that schema.

Independent reproduction, for **both** migrateLiveDatabase and migrateDatabase on separate fake WAL databases:

```sql
CREATE TABLE __schema_migrations (
 version INTEGER PRIMARY KEY,
 name TEXT NOT NULL DEFAULT 'spoof',
 sha256 TEXT NOT NULL,
 applied_at TEXT NOT NULL
) STRICT;
```

Observed `databaseOrigin='fresh'`; live result `{applied:4,from:0,to:4,snapshot:null}`, direct result `4`. Original hash changed, product objects and journal entries added, no snapshot directory. Independently repeated with:

- Product journal plus `CHECK(version>0)`: same successful initialization without snapshot.
- Product journal plus `hidden TEXT GENERATED ALWAYS AS (name) VIRTUAL`: same successful initialization without snapshot; the hidden fifth column remains.
- Four TEXT columns: classified fresh too, but later journal verification failed and transaction rolled back; original hash preserved. This does not rescue the successful malformed cases above.

No unknown business rows were lost in these empty-journal probes. The defect is broader-than-authorized origin acceptance and modification of an unknown schema without a copy, not evidence of observed business-row loss.

Required correction: recognize only the canonical permitted empty journal, including hidden columns and relevant schema properties/constraints, and reject all other journal schemas as unrecorded before attempting SQL. Retain true-empty/canonical-empty success, direct/live parity, no-snapshot fail-closed checks, and original bytes/semantics on rejection. A matching list of names alone is insufficient.

### F043-2 · P1 · startup read and rejected CLI rewrite an unknown DELETE-mode database

Locations: `lib/db/server.ts:25` opens with `{fileMustExist:true}` but no readonly; `lib/db/connection.ts:15` executes `PRAGMA journal_mode = WAL`. `runMigrateCommand` also opens writable before the provenance check.

Independent input created with raw better-sqlite3 default DELETE mode:

```sql
CREATE TABLE survivor(id TEXT);
INSERT INTO survivor VALUES('keep');
```

Close raw connection; hash original; call only `checkDatabase(root)`; hash again. It returns the unrecorded refusal and “지금 데이터는 그대로예요”, but changes the database bytes:

- Before SHA256 `d8c7c2be1a2ee4f6bcb9949417e0033d77ce1bb69bdd24db2dbcfe709fe3fd39`.
- After SHA256 `609d3780886f99454c091b802e684b476c4685125aa4f130988722ba13d93b18`.
- Byte offsets 18/19 change 1→2 (WAL format); 27/95 change 2→3 (counters).
- `survivor('keep')` remains, and journal mode is now WAL. This is an observed byte/header mutation, not a claim of row loss.

A separately created same input through runMigrateCommand returns exit 1 yet produces exactly the same before/after hashes and WAL change before refusing it; no migration snapshot is created. Already-WAL failed fake DB remains byte-identical across checkDatabase, which explains why committed T042 tests pass: their build helper explicitly converts every unknown input to WAL before taking the reference hash.

Required correction: startup checks must open read-only; provenance/rejection must happen before any persistent journal-mode change in CLI. Revalidate unknown DELETE and WAL input, malformed journal, application_id/user_version cases, both byte and semantic preservation, and successful normal migrations. This task explicitly requires startup reads not to change the user DB; no actual user DB was accessed to reproduce it.

### F043-3 · P2 · corrupt SQLite-header file is reported as a retained pre-migration copy

Locations: `lib/db/migration-record.ts:61–65`, `keptSnapshot`; `lib/db/server.ts:30–32` uses this boolean for the safety copy claim.

Independent **real CLI** failure: construct a fake product s3 DB, pre-create the actual first 0004 trigger name to cause a migration collision, run `node --conditions=react-server --import tsx scripts/db.ts migrate` with external fake DREAM_DATA_ROOT. Exit 1, actual pre-migration snapshot and failed record created, MIGRATION_FAILED startup message/copy path initially correct.

Replace **only that temp snapshot** with 512 bytes: first 16 bytes `SQLite format 3\0`, remaining bytes zero. SQLite `integrity_check` raises `file is not a database`. `keptSnapshot` nevertheless returns its relative path; `checkDatabase` still says:

> 데이터 구조를 바꾸지 못했어요. 바꾸기 전 데이터는 그대로이고, 따로 복사본도 남겨 두었어요.

and includes that invalid copy's path. Neither metadata count nor header magic proves usable backup contents. A later actual CLI retry created a separate valid snapshot for the startup UI screenshots; this does not invalidate the corrupt-file reproduction in results.json.

Required correction: independently validate the retained snapshot as a readable/integral SQLite copy, and validate its relationship to the expected pre-migration DB/journal as appropriate; do so without altering it. Corrupt, truncated, or unrelated replacement files must not cause the confirmed-copy wording. Keep “unconfirmed/no copy” guidance and preserve source DB/exit semantics when validation fails. Same-privilege race prevention is a separate OS limitation, not needed to reproduce this static invalid-file defect.

## F039-1 correction: scoped PASS

Actual production server on own `127.0.0.1:31943`, new ego taskSpace 33, healthy fake runtime only. Registered a read-only-source s4 fixture **copy** as a verified backup. At 1280×900 and 390×844:

1. Select backup, fill own temp destination, focus Inspect then keyboard Enter; actual server inspection succeeds with structure 4/app 0.1.0.
2. Append one zero byte to the temp ZIP copy, focus Finish then keyboard Enter.
3. Real BACKUP_SOURCE_CHANGED response; actual source tickets independently read as `failed` (`01a1e2af-d60a-7607-97f8-e3c83f9f2f42`, `01a1e2af-dd30-7438-bb68-66985137a002`).
4. `restore-pending=null`, Inspect returns and receives focus (`document.activeElement.id='restore-inspect'`), backup selection and original entered destination preserved, inputs enabled. Guidance requests a new inspection; no contradictory same-ticket action.
5. Reload leaves no saved/dead ticket, Inspect present and Finish absent. Reload resets unsaved ordinary selection/input; preservation checked immediately after terminal response, as required. Source ZIP copy restored from fixture after each case.
6. Widths: document scrollWidth/innerWidth = 1265/1280 and 375/390. Opened screenshots to visually confirm focus and layout.

UI response simulations were separate from actual server-state evidence. At 390, intercepted **only finish responses in that owned Page**:

| Simulated response | Observed UI |
|---|---|
| RESTORE_FAILED + failed, EXPIRED + failed, INVALID + missing, UPGRADE_FAILED + failed | Saved ticket removed, Inspect/focus returned |
| RESTORE_FAILED + prepared, CONFLICT + finishing | Saved ticket kept, “같은 검사로 복원 다시 확인”, focus Finish |
| Fetch throws TypeError (unknown network result) | Saved ticket kept and same Finish/focus |

Each retained case survives reload with backup/destination recovered, then an unmocked real finish succeeds and clears storage. Because those simulated responses did not execute the finish service, their underlying actual tickets were ready, not prepared/finishing: they prove UI branching/recovery only, not those server states.

Real server/service behavior is covered by this review's full-suite run of restore.test.ts: source change/failed, upgrade failure/failed, expired/failed, missing/invalid, actual rename failure→prepared→same-ticket completion once, finishing claim conflict, normalized tamper rejection, and rename-published/source-log-failure→prepared authenticated recovery. The latter test advances beyond expiry, then authenticates published data and completes with unchanged destination bytes and exactly one completion log. Thus published prepared state is not discarded because of ordinary expiry. RESTORE_FAILED+failed/unknown route combinations are **mocked route tests** in maintenance-routes.test.ts; they are not additional filesystem failure injections.

Route review: strict `{ticketId:uuidv7}` body rejects extra destination/options; options for migration/failure hooks remain service-factory-only. On error, route rereads state, reports retryable false only failed/missing, unknown remains true; bad body skips ticket lookup. Existing statuses are preserved (test coverage includes 400 invalid body, 409 expiry/conflict, 503 RESTORE_FAILED). UI's unconditional EXPIRED reset is safe for the exercised real service ordering: authenticated published recovery precedes expiry and a real expiry marks failed. No evidence found that current server emits EXPIRED for a recoverable published ticket. Network English “Failed to fetch” remains the documented pre-existing limitation.

## F039-2/3 successful coverage and boundaries

- Full independently executed guard suite rejects missing journal + unknown table/row, empty journal + unknown table, unrecorded product tables, view, trigger, explicit index, missing/extra journal columns, user_version. Each direct/live rejection preserves preconditioned WAL DB bytes and creates no snapshot. Own extra probes independently reject nonzero application_id and unknown table/row direct/live. Truly empty and exact empty product journal initialize; valid product upgrade snapshots/no-op pass. **These successes exclude the malformed-schema and DELETE-mode gaps above.**
- Sidecar strict zod object, 4096-byte limit, bounded versions/hashes/relative snapshot shape, unknown code/key/JSON/oversize/traversal/absolute path rejection pass in executed tests. Directory/symlink checks are present; actual junction test passes. Fingerprints include full journal/applied times + ordered user-object definitions and ordered app version/name/hash list, not just counts. Same-count/different journal times or app SQL, success/no-op and old concurrent failure after success are ignored by executed tests.
- Fingerprint is schema+journal identity, not a full hash of business rows; it must not be described as cryptographic proof of every business value or a tamper-proof record. Snapshot link checks cover backups, pre-migrate and final file; same-privilege check/use races remain unproved. No newly claimed filesystem privilege guarantees.
- Failure-record write exception tests keep DB state and exit 1 on failure/0 on success, with fallback copy. External DREAM_DATA_ROOT works. Matching known failure guides include code and copy path only when keptSnapshot returns it; this policy's invalid-header weakness is F043-3.
- Real CLI product s3 collision and real unrecorded CLI roots served on owned ports 31944/31945, /setup at both 1280/390: bold correct headline, relative copy path for migration failure, next command/action, codes MIGRATION_FAILED and SCHEMA_MISMATCH, no drive/UNC absolute path in rendered text, no horizontal overflow (1265/1280 and 375/390). Failure cards' screenshots opened at both sizes for migration failure and mobile unrecorded. Default no-record old exact-prefix DB correctly receives upgrade-needed guidance in tests; fresh/missing DB receives prepare-needed, unknown DB receives provenance refusal. No claim that all failure types got their own browser run.
- Startup reads of the already-WAL fake failure root preserve its DB hash (independent finalcheck); DELETE input does not, F043-2. Storage startup intentionally probes fake directories; this review does not claim zero directory writes.

## F039-4 / migration data: scoped PASS

`expectRestoreRows` now compares protectedRoots exactly against runtime root/data/storage/backups (data is also DB parent), validates restoredAt against injected clock, and validates newly inserted activity created_at against measured wall-clock finish range. This distinguishes jobsRepository.log system time from injected restore time. It is a real execution clock interval, not an arbitrary ISO assertion. A2/A3 and A4/A5 callers supply their own measured ranges. Existing rows, PK/count sets, D_R changed and unchanged columns, deleted settings and new data assertions remain in place; no whole business table is excluded. Test-only fifth-step index rows have independent expected-value checks, so excluding new tables from old-schema equality does not mean ignoring their contents.

Full suite passed exact-prefix/mismatch/gap/duplicate/future tests, manifest↔DB mismatch, original ZIP pre/final hash, staging-only upgrades, SQL/verify rollback, integrity/FK/files/edit checks, cleanup, WAL/snapshot concurrency, no overwrite, snapshot retention, normalization and replay. No code/tests were mutated for this review.

Additional independent actual product s3→s4 probe: created product first-three SQL DB with settings sentinel `s3 한글\r\n keep`, generated a fake manifest/ZIP, registered in an independent s4 source, inspect returned upgrade 3→4, finish succeeded with exact product four-row journal and sentinel preserved; readonly destination inspection followed by authenticated same-ticket replay succeeded. Source ZIP SHA256 before/after both `ce8fc672bcb1a67a193c102b86f6c11341ffe664f292800c358741af6278b512`. This is minimal synthetic s3 (0 projects/assets), not an archived real release backup; richer data is the fixed s4 suite. Test-only future SQL upgrade executed through existing tests; product 0005 was not added.

Future code-data-migration source hashing is still an explicit prerequisite before the first applicable migration/0005. Migration.verify is a verifier, not hashed source for a code data transformation. This absence alone is not a present SQL compatibility failure, and this report does not mark it implemented.

## Evidence, cleanup and limits

Evidence retained in OS temp (not repository):

- `%TEMP%/dream-t043-review/`: review.mts, results.json, setup.mts/browser-data.json, s3.mts/s3-results.json, finalcheck.mts/final-results.json, b1–b5.mjs/finish.mjs, terminal-1280.png/terminal-390.png, setup/setup-detail screenshots for 31944/31945 at 1280/390, and owned fake runtimes/restored output.
- Extra fake roots from review.mts: `C:/Users/ADMINI~1/AppData/Local/Temp/dream-t043-data-UxUDPR`. results.json records every probe result, paths and failed CLI output. Re-running scripts that use fixed output names requires a new temp namespace; do not point them at original data or overwrite fixtures.
- No recursive deletion attempted; temp evidence intentionally preserved for coordinator reproduction. No policy bypass. No user data DB opened/read/written.
- ego taskSpace 33 finished keep=[] successfully. Owned Next sessions 38249/51736/90945 received Ctrl-C, each exit 1 confirmed; final Get-NetTCPConnection for owned ports 31943/31944/31945 returned no listeners. No worker process was started. Existing servers were untouched.
- Big data, ACL enforcement, disk full/power loss, network volume, platform portability, screen readers/touch devices, Windows same-privilege adversarial junction/symlink/hardlink/check-use races remain untested. Static junction safety in a test is not adversarial-race proof. No claim of those tests or universal data preservation.

Only this report is intended for integration; no commit/push. Master should assign F043-1/2/3 to implementation, then independently recheck the specific failures and relevant regressions before K6 acceptance. Report writing and worker_done delivery are separate; worker_done receipt confirms delivery, not Master acceptance/integration.

플래너/총괄에게 복사할 메시지:

> Claude design / Codex Master: T043 독립 재검수는 FAIL입니다. clean f1c9eb1(f8e4e28·9c56033 포함)에서 직접 29파일280통과/생성1skip 및 lint/typecheck/build, 실제1280/390 원본변경실패 뒤 재검사·포커스·저장값 해제, 실제s3→s4·인증재요청과 시작안내를 확인했습니다. F039-1/4는 검증 범위에서 통과하나, 정확하지 않은 빈 journal(default/CHECK/숨은열) 무사본 초기화(F043-1), 시작 점검/거부 CLI의 DELETE→WAL 원본 바이트 변경(F043-2), SQLite 머리글만 맞는 손상 사본을 확인된 복사본으로 안내(F043-3)를 독립 재현했습니다. 이 보고서만 작성했고 실사용 DB 접근·코드/fixture/공용문서 수정·커밋/푸시는 없으며 세 필수 수정 뒤 독립 재검수가 필요합니다.