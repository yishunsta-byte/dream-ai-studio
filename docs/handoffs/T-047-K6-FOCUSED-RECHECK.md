# T-047 · Focused independent final K6 SQL-scope recheck — PASS

- Reviewer **CX-REVIEW-07**, implementation-independent; coordinator CX-MASTER-01. Task task_746652d7daad / dispatch ctx_7d04d5a8942c. No helpers or subagents.
- Tested HEAD **790f9d180289a780bef027b8eba8961c20bfc7d0**, initially clean, isolated k6-residual-focused-recheck worktree. Requested target **b586d66** and T045 tested **bed2036** are ancestors (both merge-base checks exit 0). b586d66→HEAD changes only docs/TEAM.md; tested product equals target.
- Read AGENTS, AI_TEAM_RULES, CLAUDE, both docs/team role guides, current PLAN 14 K6, TEAM/REVIEW and T045 independent/T046 implementation handoffs. Applied orchestration worker and ego-browser skills.
- **Verdict: current SQL compatibility scope PASS, combining this focused independent closure with T045's explicitly inherited independent coverage. F045-1 and F045-2 are closed. No mandatory defect found in this scope.** This does not implement the future code-data-migration source/hash contract or authorize product 0005/new milestone.
- Only final repository write: this report. No product/test/fixture/shared-document changes, commit or push. All extra DB/script mutations use newly owned fake OS-temp namespaces. No original user DB or old evidence was mutated.

## Baseline, commands and scope

Evidence directory **E = C:/Users/ADMINI~1/AppData/Local/Temp/dream-t047-21a6bfa0849a4df2905038ac048b4c59**; successful direct/UI evidence under **E/verified**. Windows, Node v26.13.0.

| Exact command / inspection | Observed result |
|---|---|
| npm.cmd ci | Exit 0; E/ci.log |
| git merge-base --is-ancestor b586d66 HEAD; same with bed2036 | Both exit 0 |
| git diff b586d66 HEAD --stat | Only TEAM report/allocation, no product delta |
| git diff b586d66^ b586d66 --stat | Exactly lib/db/migrate-command.ts, lib/db/migration-record.ts, tests/k6-t044-guard.test.ts, docs/handoffs/T-046-CC-DATA-01.md |
| git diff b586d66^ b586d66 -- lib/db/migrate-command.ts lib/db/migration-record.ts | Inspected two functional changes: always wal:false and require nonempty matching snapshotSha256; accompanying comments only |
| Remove Env:DREAM_DATA_ROOT; FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe; FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe; npm.cmd test -- tests/k6-t044-guard.test.ts tests/k6-migration-guard.test.ts tests/k6-compat.test.ts tests/restore.test.ts | **4 files / 98 passed**, 4.62s, exit 0; E/focused-tests.log. This is this worker's independent run, separate from Master's 98. |
| node --conditions=react-server --import tsx E/verified/direct.mts E/verified | Exit 0, deterministic races, actual child-process CLI safe cases/failure, five candidate cases; direct.log/direct-results.json |
| DREAM_DATA_ROOT=E/verified/failed; node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 31971 | Owned actual app, Ready; all ten setup requests HTTP 200 |
| ego-browser nodejs -e "await import('file:///.../verified/browser.mjs')" and browser-details.mjs | Six actual setup observations plus four detail screenshots; assertions passed |
| node E/verified/preserve.mjs E/verified | Exit 0; final-preservation.json verifies source, record and snapshot |
| git diff ebd0dff^ HEAD -- lib/db/migrations | Empty; original product 0001–0004 unchanged, no product 0005 |
| Get-FileHash tests/fixtures/backups/s4.zip | Before/after SHA256 **6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392** |

No new gap required the whole suite/build/lint/typecheck to be repeated. **T045's independent full 305 passed / 1 fixture-generation skip, lint/typecheck/build are inherited evidence**, not executions by T047. T046 author's 307 passed / 1 skip plus lint/typecheck/build remain author evidence. This worker's test count is 98.

## F045-1 · PASS, absent-path writable-open mode sequencing

Independent direct.mts creates a brand-new root/data with no app.db, then invokes actual runMigrateCommand with afterProbe. The hook creates/closes a raw default-DELETE DB with exactly:

    CREATE TABLE survivor(id TEXT);
    INSERT INTO survivor VALUES('keep');

Actual result: **exit 1**, unrecorded-origin refusal, unchanged survivor/keep semantic state and all object definitions/rows/application_id/user_version. Before and after main SHA256 both **d8c7c2be1a2ee4f6bcb9949417e0033d77ce1bb69bdd24db2dbcfe709fe3fd39**; header bytes 18/19 remain **1/1**. No -wal and no pre-migrate snapshot directory. No WAL preconditioning was used.

Existing-path seam independently replayed: raw DELETE product s3, then afterProbe deletes journal rows. Refusal exit 1 preserves the complete post-hook hash, header 1/1 and logical state, with no WAL/snapshot. Both repros compare full captured states, not just a sentinel.

Actual child-process scripts/db.ts migrate executions also passed:

- Truly absent-path fresh initialization, exact canonical-empty-journal initialization: exit 0, startup ok, four product steps.
- Raw DELETE product s3 upgrade: exit 0; retained s3→s4 snapshot's every table/row/schema/journal/application_id/user_version equals the complete pre-upgrade state; resulting startup ok.
- Raw DELETE product s4 no-op: exit 0, startup ok, source bytes unchanged.

Code inspection confirms the earlier existence result no longer chooses WAL behavior: every writable CLI connection uses wal:false, before live provenance checking/snapshotting. This closes the supplied seam's sequencing defect; it is not comprehensive adversarial OS race protection.

## F045-2 · PASS, legacy evidence cannot confirm a pre-upgrade copy

Created an independent raw DELETE product s3 DB with review.sentinel="original-business" and a real trigger-name collision against migration 0004. Spawned the **actual scripts/db.ts migrate CLI**, not a stub: exit **1**, genuine consistent retained copy and new digest record, useful MIGRATION_FAILED guidance, unchanged source hash/header/logical data.

Made an ordinary independent copy of the genuine snapshot and changed only review.sentinel to "REPLACEMENT". Both candidates have integrity_check=ok and identical schema/journal fingerprint **f255ecca6919eefc288c121f44b2c5c3844ed434061c54bc50c3c4cb414fa2a8**, but different business rows and file hashes:

| Candidate | SHA256 |
|---|---|
| Genuine | 00078785c32c2435249f6cdb0144b2269b41dd69dbee314b52f92fa3e15a88b2 |
| Replacement | 3a0ebe0be926d249b5de884b5ba0ac69a5ba510ddcd4f8d48b03415a67f90c21 |

Five independently asserted cases:

| Record/candidate | keptSnapshot / startup result |
|---|---|
| Original new digest + genuine | Relative path returned; confirmed-copy headline/detail |
| Original new digest + replacement | null; unconfirmed guidance |
| Explicit invalid all-zero digest + genuine | null; unconfirmed guidance |
| Legacy record, digest field omitted + genuine | Parsed successfully; null; unconfirmed guidance |
| Legacy record, digest field omitted + replacement | Parsed successfully; null; unconfirmed guidance |

Every case retains **MIGRATION_FAILED** and useful failure headline/next action. Each validation leaves the candidate bytes and sidecar bytes unchanged, with source hash/logical state unchanged. The legacy records are deliberately constructed only in the owned temp root; the application never backfills a digest or rewrites those records/copies during validation.

Final source SHA256 after all direct and actual UI requests: **deb84f6dd2c873c7bdbd073f48d740c6292362901aeecb7acb2028292936c986**, header **1/1**, same as before the failed CLI. Final genuine snapshot hash remains as above; no snapshot -wal/-shm/-journal; final record equals the original new record.

## Actual browser /setup · PASS

Owned loopback **31971**, checked unused before launch; new ego taskSpace **37**. This worktree had no production build; used **actual Next development app**, not HTTP mocking or fetch interception. T045's production UI evidence remains separate inherited coverage.

At **1280×900 and 390×844**, directly observed three states: legacy replacement, legacy genuine, new-digest genuine. Both legacy states show “바꾸기 전 데이터는 그대로예요” and “바꾸기 전 복사본은 확인하지 못했어요”, MIGRATION_FAILED and retry action; neither claims a copy nor exposes a copy path. New-digest genuine shows “따로 복사본도 남겨 두었어요” and exactly **backups/pre-migrate/20261116T052125Z_s3-s4.db**. No absolute drive path is exposed.

All six observations: scrollWidth/innerWidth **1265/1280** or **375/390**, no horizontal overflow. Captured full body/DOM text and screenshots, then captured scrolled failure-card details and opened all four legacy/digest desktop/mobile detail images for visual inspection. Long relative path and command wrap correctly; code remains visible. Next dev-tools indicator is present because this is development mode.

Evidence: browser-input.json, browser-results.json, browser.mjs/browser-details.mjs, setup-*.png and detail-*.png. These are this worker's actual UI tests. **F039-1/F039-4/F043 broader passes and restore terminal/prepared recovery UI belong to T045 inherited evidence**, not fresh UI executions claimed here; relevant restore/compat/guard tests were freshly run within the 98.

## Inherited coverage, future conditions and limitations

T045 independently executed full suite, exact original F043 input matrix/DELETE preservation, integrity/substitution checks, actual startup gating, both-width terminal restore failure/reinspect, real prepared published-copy authenticated recovery and HTTP 200 replay. Its full F039-4 runtime/time comparisons and fixed-s4 compatibility coverage are inherited explicitly. Today's focused replay closes the only two mandatory residuals against the narrowly inspected delta; together they support **current SQL K6 scope PASS**.

**Still unimplemented prerequisite:** execution/source hash identity for code-data migrations, deterministic transformation and direct/restore equivalence before the first applicable product migration/0005. A SQL hash or Migration.verify callback is not that contract. Do not call this future condition implemented or infer permission to add 0005. Existing user-flow/design approval gates remain intact; Master owns acceptance/shared status updates.

Limits remain: same-privilege adversarial OS/check-use/link races, sidecar authenticity, large-DB behavior, physical ACL/disk-full/power-loss/network-volume tests and all assistive devices. Digest equality proves equality to the locally recorded digest at inspection time, not externally authenticated history.

## Harness notes, cleanup and handoff

Read prior T045 OS-temp final/setup/browser scripts **read-only** as reference; created new scripts/new fake inputs rather than executing against old evidence. First direct attempt failed a harness equality because it included snapshot-directory absence in the source-state comparison after an intentional failed upgrade. Corrected only the temp harness comparison to exclude that intended new directory, reran all cases in fresh **E/verified**, and all passed. Original attempt remains in E; not a product defect and not counted as successful evidence.

Owned taskSpace 37 finished with keep:[] in a separate final browser invocation. Owned server session **89266** received Ctrl-C and confirmed exit 1; final Get-NetTCPConnection -State Listen -LocalPort 31971 returned no listener. No other server/process/browser was stopped. Evidence intentionally retained. No recursive deletion performed.

Next dev automatically changed next-env.d.ts imports to dev type paths; after stopping it, restored this worker-generated change to initial HEAD content/CRLF. Final pre-report git status was clean. Dependencies/.next are ignored outputs. Final intended diff is only this report.

Master: integrate report and close F045-1/F045-2/current SQL-scope review; keep future code-data hash condition explicit. Report drafting, worker_done delivery and Master integration are separate events.

플래너/총괄에게 그대로 복사할 메시지:

> Claude design / Codex Master: CX-REVIEW-07의 T047 집중 독립 재검수는 현재 SQL K6 범위 PASS입니다. 790f9d1(b586d66 제품 동일)에서 독립 98검사, 실제 absent/existing afterProbe DELETE bytes·1/1·논리·무WAL/무사본, 실제 CLI fresh/canonical/s3 upgrade/no-op와 실패사본의 새 digest/legacy 5조건, 실제 /setup 1280/390 안내·상대경로·넘침없음·원본보존을 확인해 F045-1/2를 닫습니다. T045 독립305+skip1/lint/typecheck/build와 기존F039/F043/UI 통과는 명시적으로 계승한 근거이며 이번 전체307/복원UI 재실행은 아닙니다. 미래 코드데이터 이관 source/hash 계약은 적용되는0005 전 별도 미구현 선행조건으로 유지하고 기존 사용자흐름/디자인 게이트를 지켜 주세요; 고유보고서만 작성했고 자체 서버/브라우저 종료·고정s4 SHA/원본/이전증거 불변을 확인했습니다.
