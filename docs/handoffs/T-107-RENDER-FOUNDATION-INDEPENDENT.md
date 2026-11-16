# T-107 · P2-4a render foundation independent review

- Reviewer: dispatched Codex worker, independent of T-105 implementation; no helper agents.
- Target: `94c564757d8c3d1a9368a1210a2775d29920138e`; historical comparison base `15eaaa0`.
- Verdict: **FAIL — F107-1, F107-2, F107-3 require correction and independent recheck before foundation acceptance.** Review work itself is complete.
- Only repository write: this report. No product/test/fixture/shared-document edits, commit, push, real-user DB reads/migration, renderer installation or worker launch.

## Environment, evidence and exact reproduction boundary

Read AGENTS, AI_TEAM_RULES, CLAUDE, PLAN, REVIEW, TEAM, docs/team role rules, T101, T105 and T106. D7 includes verified success and canceled-late MP4s in backups. Renderer/worker/API/UI are explicitly outside T105; their absence is not a failure.

Evidence retained at:
`C:\Users\Administrator\AppData\Local\Temp\dream-t107-739a7e8aa7994b129de32817a4f315db`

The child worktree had no node_modules. Execution used `app/` under that OS-temp folder: every tracked file copied from this worktree, without newline conversion. After execution, every tracked file hash was compared with the original worktree: **zero mismatches**. Thus original CRLF bytes were retained, including fixtures and migration sources. Dependencies were initially junctioned to `D:\starwork\dream-ai-studio\node_modules`; tests/lint/typecheck passed there. Next rejected that external junction for its hermetic build, so the junction itself was removed and dependencies copied into the temp app with robocopy (exit 1 = copied files). A second unchanged-source `npm.cmd run build` passed. No production code/config was changed to obtain the pass.

All DB operations used freshly extracted fixed fake backups under this owned OS-temp evidence folder. `DREAM_DATA_ROOT` was unset for test/lint/type/build; CLI and restore probes explicitly set fake roots. Media tests used read-only executables `D:\starwork\dream-ai-studio\.tools\ffmpeg\ffmpeg.exe` and `ffprobe.exe` via `FFMPEG_PATH` / `FFPROBE_PATH`. No real data/storage/backups root was opened. No server/worker/watch process remains; all launched commands exited. Evidence, scripts, extracted copies and generated archives are retained, not cleaned away.

Evidence files: `test.log`, `lint.log`, `typecheck.log`, `build.log` (initial junction failure), `build-local.log` (success), `probe4.log`, `probe4/results.json`, `direct.log`, `source-final.log`, `final-check.log`, `traces-final.json`; scripts `app/t107-probe.mts`, `app/t107-direct.mts`, `app/t107-final.mts`. Earlier probe/probe2/probe3 logs preserve investigation history; the definitive full probe is probe4. The temp script's CLI source-error branch initially failed in loader/alias resolution; only the separately corrected source-final command counts as a product source-error check.

## F107-1 — linked jobs can silently invalidate existing renders (required)

**Location:** `lib/db/migrations/0006_renders.sql` render_job_guard; `lib/db/render-data.ts` checkRenderRows; jobs update contracts.

On a freshly extracted s6 DB opened with product `openDatabase` (`foreign_keys=ON`, `recursive_triggers=ON`), execute each statement separately in a savepoint against the succeeded render's job:

```sql
UPDATE jobs SET kind='export' WHERE id=:jobPassed;
UPDATE jobs SET ref_type='export' WHERE id=:jobPassed;
UPDATE jobs SET ref_id=:differentRenderId WHERE id=:jobPassed;
UPDATE jobs SET project_id=:otherExistingProject WHERE id=:jobPassed;
```

**Actual:** all four updates succeed, without dropping any triggers. The linked terminal render remains unchanged but no longer satisfies its job-kind/reference/same-project contract. Calling checkRenderRows afterwards throws `Render job differs` in every case. That later detector is useful for restore but does not protect ordinary runtime mutation; the insertion-only trigger is insufficient. Existing tests actually demonstrate the ref_id mutation and call the detector afterwards rather than expecting update rejection.

**Expected/recheck:** guard contract-breaking job updates once referenced by renders; retain normal progress/cancel/restore status updates. Independently verify all four identity fields, new/terminal renders, actual product connections, and normal restoration normalization. Do not describe the existing insertion guard as maintaining the contract for the row's lifetime.

## F107-2 — SQL file tuple accepts a success with NULL sha256 (required)

**Location:** `lib/db/migrations/0006_renders.sql`, file-fields CHECK around lines 36–42.

On untouched s6's running render, using product openDatabase and without dropping any trigger:

```sql
UPDATE renders
SET status='succeeded', finished_at='2026-11-16T00:00:00Z',
    file_path='projects/'||project_id||'/renders/'||id||'.mp4',
    sha256=NULL, size_bytes=1, verify_json='{}'
WHERE id=:runningRenderId;
```

**Actual:** accepted; row is succeeded with a non-null file_path and null sha256. `final-check.log` confirms recursive_triggers=1. SQLite accepts a CHECK whose result is NULL; `length(sha256)=64 AND sha256 NOT GLOB ...` does not require non-null sha256. The non-null file branch needs explicit null/type predicates. This is a normal legal state transition, not a corruption-only setup. It allows success metadata that backup/restore subsequently refuses as an invalid file reference. `{}` is currently an allowed verify object; this probe does not claim an actual media verification was performed.

**Expected/recheck:** the three file fields must be present together or absent together, with no UNKNOWN/NULL loophole. Reject this ordinary running→succeeded transition and analogous partial tuples; retain valid success and canceled-late paths.

## F107-3 — direct restore accepts semantically false timeline binding (required)

**Location:** `lib/db/render-data.ts` checkRenderRows; `lib/backup/archive.ts` verifyRestoredDatabase.

Create a disposable s6 copy, save and temporarily drop render_input_immutable, change succeeded render timeline_revision to 999, set `input_json.timelineRevision=999`, recompute exact-text input_sha256, then recreate the identical saved trigger SQL. Preserve timeline_rev_id pointing to its actual revision-1 row. Repack with matching database and inventory hashes; all schema definitions are unchanged. Use the real restore service with the archive in a separate `archives/` folder so the destination does not overlap the backup directory.

**Actual:** direct `verifyRestoredDatabase` accepts; real inspect and finish also accept and publish the destination. `probe4.log` records all six observation points and the restored succeeded render still has timeline_revision 999. Input JSON agrees with its own render row and its SHA, but the referenced saved timeline row is revision 1. Integrity/FK checks do not replay INSERT triggers. checkRenderRows checks only the input-text digest and linked job, not the saved timeline binding.

**Expected/recheck:** read back semantic render constraints during direct restore, including same-project saved timeline identity, timeline_revision and content_revision. Reject a matching-hash/repacked false binding before publication and preserve the original ZIP. Expand checks of stored rows beyond assuming insertion triggers have already authenticated them. This is distinct from claiming fixture outputs authenticate actual timeline rendering.

## Independent checks that passed

| Check | Actual result |
|---|---|
| Full original-byte suite | **41 files, 485 passed / 3 skipped**, exit 0, 23.87 s. Independent run; author's reported 485/3 is separate evidence. |
| Lint | `npm.cmd run lint`, exit 0, max warnings 0 |
| Typecheck | `npm.cmd run typecheck`, exit 0 |
| Production build | `npm.cmd run build`, exit 0 after local dependency copy; verify-build reports no local data/secrets traced |
| Trace audit | 33 server NFT manifests; union contains SQL 0001–0004, both code-0005 sources, SQL 0006. SQL6 is actually packaged/traced. |
| Historical bytes | `git diff --exit-code 15eaaa0 94c5647 --` SQL1–4, both code5 sources, s4/s5 ZIP+JSON and s4-inputs: exit 0 |
| Registration | Exact `[1,2,3,4,5,6]`, SQL1–4→certified code5→SQL6; s5 journal is exact prefix; future/mismatch cases refused |
| CLI 5→6 | Actual `node --conditions=react-server --import <tsx loader> scripts/db.ts migrate`: exit 0, applies 1, reports s5-s6 prebackup |
| CLI noop | Exit 0, applies 0; DB file SHA256 unchanged |
| Prebackup consistency | Full journal including timestamps, all-table logical snapshot and schema equal before migration |
| CLI future/hash refusal | Exit 1 for seventh recorded step / altered code5 hash; DB bytes unchanged |
| CLI source refusal | Corrected loader + TSX_TSCONFIG_PATH, cwd with no migration sources: exit 1 with product migration-source guidance; DB bytes unchanged |
| Product REPLACE guard | With product recursive_triggers=1, terminal INSERT OR REPLACE rejects `renders are never deleted`, old succeeded row retained |
| Required render-file omission | Repacked backup omitting the succeeded MP4 from archive/inventory: RESTORE_INVALID, no destination, ZIP unchanged |

The normalized SQL6 migration digest is `0bedf2afb9db707b255917707a364ed6a30f35b8d97dfb660485e2e7aea0d19e`; certified code5 digest remains `6a012009fd045439d6d3af8ad2021043fec475aadf10fd942b6585c9e88f0061`. These are product normalized-source hashes, not raw CRLF file hashes. File trace contains seven migration source files for six migration stages (code5 has two files).

Existing foundation tests executed independently cover insert job kind/ref/project rejection, saved timeline mismatch, input object/row identity, invalid digest syntax, initial queued/empty state, active unique index, name_seq uniqueness and repository nextNameSeq, normal status transitions/requeue, success fixed path and verify presence, late canceled file policy, failed/canceled no-file states, input immutability, terminal cleanup-only updates, deletion rejection and hash/job validation. Those passing tests do not cover the three gaps above. The REPLACE probe on a raw SQLite connection with recursive_triggers=0 bypassed deletion guards; it was rechecked on product openDatabase and correctly rejected, so this is **not** a reported product failure.

## Actual restore and file evidence

Both straight s6→6 and s5→6 ran the real inspect/finish functions, observing `inspect → extracted → upgraded → normalized → before-publish → finished`. Both completed with original ZIP digest unchanged. s5 restored with exact six-stage migration journal and empty renders. s6 restored all five renders: succeeded, canceled-late, verify-failed and plain canceled retained; running became failed/RESTORE_INTERRUPTED, with its job canceled/RESTORED_NOT_RESUMED. Existing succeeded job remained succeeded. The suite also checks retained cleanup_left_json and absent files for failed/plain-canceled/interrupted rows.

Restored MP4 bytes were digested directly:

| State | Bytes | SHA256 |
|---|---:|---|
| succeeded | 73037 | `93025ddd96faa0d0b7253e3a9c156617221426d804b18f2bc4c409525a79fb33` |
| canceled-late | 73026 | `5d80beeda0a9496544c6869628f86bb77b1a346fc5f6ce42d51165bf775d1417` |

Both match the row metadata and fixture input bytes. Full s6 tests also regenerated semantic fixture content, rejected swapped success-video bytes even with a matching manifest, rejected changed input hash, rejected 5-stage apps with BACKUP_TOO_NEW and changed SQL6 apps with BACKUP_SCHEMA_MISMATCH. Rejected cases leave no destination and preserve ZIP bytes. The added missing-success probe verifies file omission is an error. Code uses the same mandatory fileReferences check for canceled-late; a separate omitted-late archive was not executed. Fileless plain canceled/verify-failed rows restore normally and are not mislabeled missing-file errors.

The original fixture has a saved timeline pointer and exact migration history, but its MP4s are fixed-color, pre-generated H.264 clips. The generator includes an empty timeline slot and a placeholder composition-source digest: **s6 authenticates backup bytes/row preservation, not real renderer correctness or frame-to-timeline authenticity**. No claim about real MP4 rendering, UI playback, no-network rendering, cancellation child-process lifecycle or actual-user migration is made.

Historical comparison profiles: P_REGEN excludes only migration applied_at for deterministic regeneration; it does not exclude user values or other timestamps. Upgrade preservation checks compare existing tables, and old migration rows/timestamps remain exact; new migration timestamps are only excluded where the relevant migration comparison profile explicitly allows them. s4/s5 source bytes remain unchanged. Actual source semantics, not merely ZIP digest, were exercised by the full fixture suite.

## Setup guidance and handoff

A real existing schema-5 installation will need `npm.cmd run db:migrate` from the app folder after integration, with its configured data root; startup should show migration/setup guidance first. This review migrated only fake copies. Pre-migration backup is retained automatically; do not run against the user's actual data as part of this review. No approval to install renderer/browser or launch real rendering is implied.

Next entry condition: fix F107-1/2/3 in the assigned implementation task, retain old SQL1–5 and s4/s5 bytes, decide compatible handling of any already-issued SQL6 digest, then independently recheck targeted failures plus full checks/restore. Do not silently rehash a DB that already records the old SQL6. No next milestone acceptance is issued here.

Copyable message for Claude design / planner (this report text is a draft; actual completion delivery is to the coordinator through Orca):

> T107 independently reviewed 94c5647 and reports FAIL on F107-1 linked-job update guards, F107-2 nullable success-file SHA, and F107-3 restore timeline binding. Independent full suite passed 485/3 skips, lint/type/build passed, fake CLI migration and normal s5/s6 restores passed with both MP4 byte hashes preserved. Please keep P2-4a acceptance blocked until these three foundation contracts are fixed and independently rechecked; real renderer/worker/UI remain later scope, not review failures.
