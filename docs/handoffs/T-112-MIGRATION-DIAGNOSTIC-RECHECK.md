# T-112 — migration diagnostic independent focused recheck

- Target: `10b8aa16a1c75e37a6b6075ffd0c6649ca0ecede` (T111). Independent dispatched Codex review; no implementation participation or helper workers.
- Verdict: **PASS — F110-1 resolved within the requested CLI diagnostic scope.** No new required product correction found. This is not acceptance of an actual renderer, deployment, or actual-user migration.
- Only repository write: this report. No product/tests/fixture/shared-document changes, commit or push. Read AGENTS, common rules, team roles/current assignments, CLAUDE/PLAN/REVIEW, T110 and T111. Report-only assignment overrides routine shared progress updates.

## Environment and evidence

Owned OS-temp evidence root: `C:/Users/Administrator/AppData/Local/Temp/dream-t112-a8d6614691a646e28302ea961a1ff3e3` (Windows short-name alias used during creation refers to this same root). Tracked files copied byte-for-byte into `app`; dependencies copied from existing `D:/starwork/dream-ai-studio/node_modules`, with no install. Every tracked source compared after verification: **zero mismatches**, `source-bytes.log`. Original CRLF retained. All runtime roots were newly extracted fixed synthetic s6 copies under this evidence directory; no actual userdata/data/storage/backups were opened.

The child uses committed package.json/lockfile; root T108 uncommitted dependencies were excluded. Existing installed dependencies are a toolchain supply, not evidence of a fresh reproducible install. Exact-package expectation in `tests/p2-2-preview.test.ts` passes with the committed pair remotion/player 4.0.543; T111's reported failure against separate root T108 package WIP does not reproduce here. No expectation was weakened.

Commands in temp app:

- `npm.cmd test -- tests/p2-4a-migrate-diagnostic.test.ts tests/k6-migration-guard.test.ts tests/k6-t044-guard.test.ts tests/k6-code-migration.test.ts tests/k6-compat.test.ts tests/p2-4a-renders-db.test.ts tests/s7-fixture.test.ts tests/p2-1-timeline.test.ts tests/p2-1-f065.test.ts`: **9 files, 200 passed / 1 skipped**, exit 0 (`focused.log`). Includes all five new diagnostic tests; timeline migration/CLI regression coverage is also in the full suite.
- `npm.cmd run lint`: exit 0 (`lint.log`). `npm.cmd run typecheck`: exit 0 (`typecheck.log`, Next typegen + tsc).
- `npm.cmd test`: **43 files, 500 passed / 5 skipped**, exit 0 (`full.log`, 22.90s). Four skips are fixed-fixture generation gates; the extra skip is media availability because this new temp app has no default local tools folder.
- Bounded follow-up with explicit read-only FFMPEG_PATH/FFPROBE_PATH pointing to existing `D:/starwork/dream-ai-studio/.tools/ffmpeg/*.exe`: `npm.cmd test -- tests/media-storage.test.ts`, **9 passed / 0 skipped** (`media.log`). Do not relabel the original full run as 501+4; the extra coverage is a separate run.
- `node --conditions=react-server --import tsx t112-direct.mts`, T112_ROOT set to owned evidence root: **PASS** (`direct.log`, `direct-results.json`). Supplemental script lives only in temp app. It spawns actual product `scripts/db.ts migrate` with the react-server condition, explicit tsx loader file URL and TSX_TSCONFIG_PATH.

## Direct CLI findings

Legal SQL6 mutation: running render → succeeded, finished time/path/size/verify supplied, SHA NULL; no guard bypass was used for this primary reproduction. Actual child CLI exits **1**, stdout empty, stderr exactly four lines (`invalid-stderr.log`):

```text
데이터 구조를 바꾸지 못했어요. 바꾸기 전 데이터는 그대로이고, 따로 복사본도 남겨 두었어요.
앱과 작업기를 끈 뒤 npm.cmd run db:migrate를 한 번 더 실행해 주세요. 계속 실패하면 이 안내와 복사본 이름을 알려 주세요.
원인 진단: 렌더 기록 019b8b82-be00-76c9-928d-d67503eacebb — file fields are incomplete
바꾸기 전 복사본: backups/pre-migrate/20261116T152109Z_s6-s7.db (자동으로 지우지 않아요)
```

PASS: diagnostic names the exact offending UUID and fixed reason. Output contains no stored input JSON, render path, 64-character hash, secret value, raw exception/stack, absolute runtime path or source location. Relative prebackup filename is the existing intended fourth line, not a stored render-input path.

PASS: original app.db SHA256 identical before/after; all table rows and schema identical; journal remains exact 1..6; zero of the three 0007 guards. Exactly one retained prebackup exists; its complete table/schema snapshot equals the invalid original. VACUUM copy byte identity is not claimed. Public record stays schema1, code MIGRATION_FAILED, reason null, from6/to7, relative snapshot and fingerprints; no diagnostic/UUID is serialized. `migration-record.ts` is unchanged.

PASS: actual normal s6→7 child exits0, installs three guards and preserves six original journal entries; subsequent noop exits0 with empty stderr and unchanged DB bytes. Actual source-unavailable child (cwd outside app with loader/config explicitly resolved) exits1, no diagnostic/stack, original schema/journal/DB bytes unchanged. Separate stdout/stderr logs and result JSON are retained.

PASS: five diagnostic tests additionally verify job-diff cause, exact four-line generic+safe cause output, invalid non-UUID suppression, normal/noop, and unknown SQL failure through actual runMigrateCommand. Unknown failure gets generic MIGRATION_FAILED output with no diagnostic and no raw missing-table name/stack. The unknown-error test calls the command function rather than spawning scripts/db.ts; actual spawned invalid/normal/noop/source cases above cover process integration. This distinction is intentional.

## Safety and boundary semantics

RenderRowError exposes typed subject render/project, nullable sanitized subjectId, and a RenderRowReason union derived from **17 unique fixed reasons**. UUID is strictly lowercase 8-4-4-4-12 hex; malformed values become null and are omitted from message text. It does not enforce UUID version/variant, which is unnecessary for this output allowlist. Every production throw site uses fixed literal reasons; none interpolates input/path/hash into reason. This is an internal typed contract, not a runtime whitelist for arbitrary JavaScript callers casting fabricated reasons. Current production data cannot supply a reason directly.

LiveMigrationError preserves the safe structured diagnostic only for `instanceof RenderRowError`; public code and shared copy stay generic. Unknown errors receive diagnostic null. There is no native Error.cause chain or raw exception propagation; the intended safe cause is carried in `diagnostic`. Existing busy/source/timeout branches remain ahead of generic handling. Command renders only these typed fields; nullable ID has fixed fallback.

checkMigratedData now calls checkRenderRows after verification, integrity, edit snapshot and timeline checks. Independent future boundary probe starts from s7, forges a bad row only in a disposable fake root (temporarily removes/recreates the tuple update trigger), then supplies contiguous step8 `SELECT 1`. The existing step7 verifier does not rerun; **the added final post-upgrade check rejects with the correct typed render cause**, rolls back step8, preserves the complete pre-upgrade table/schema snapshot and leaves journal7. This is a test-supplied future migration, not a new product migration.

Independent fresh in-memory schemas4/5/6 pass checkMigratedData: absent renders table is a no-op, valid schema6 renders structure is supported. The new call is inside the existing upgrade transaction; same/current noop and fresh-initialization paths retain their existing behavior rather than becoming a universal corruption scan. Future migration semantics must continue satisfying the current stored-row contract or deliberately update it in a reviewed change.

## Preservation, inherited evidence and gaps

`git diff --exit-code 8e2da31 HEAD -- lib/db/migrations tests/fixtures/backups`: exit0. Issued migration sources1..7 and fixed s4..s7 ZIP/JSON/input bytes are unchanged from the independently checked T109 target; copied source bytes match current target. No journal rehash or fixture regeneration occurred.

Explicitly inherit T110's independent **496 passed/4 skipped, lint/type/build**, 33 NFT manifest source inclusion, real s7/s6/s5 inspect+finish restore, upgraded terminal MP4 preservation, active-job normalization, SQL guard permutations and semantic forgery checks. Those are prior T110 executions, not newly rerun T112 evidence. T111 changes neither issued migration/fixture bytes nor restore implementation. No needless broad render build/restore repetition was performed. T111's author build is separate author evidence.

Remaining limits: no actual-user migration, real composition renderer/browser/worker/UI acceptance, deployment, phone/screen-reader/lifecycle coverage, or fresh dependency installation claimed. Runtime-invalid fabricated RenderRowError reasons from untyped internal callers are outside the current typed-caller guarantee; no such production caller was found. The skipped generation gates were not forced. No new blocker remains for F110-1; Master owns integration and the broader foundation acceptance.

All invoked processes completed and handles closed. No server, watcher or persistent worker was launched; no process termination was needed. Owned evidence/fake roots are retained, with no recursive cleanup of other work. Repository status before report was clean; only this report is added.

Copyable message for Claude design / planner (draft; worker_done is separately sent to coordinator):

> T112 independently rechecked 10b8aa1 and resolves F110-1: actual invalid fake s6→7 exits1 with exact safe render UUID/reason, unchanged DB bytes/journal6/newguards0 and preserved prebackup; normal/noop/source regression and future8 post-check pass. Focused200+1skip, full500+5skip, separate media9/0skip, lint/typecheck pass; T110 build/restore/guard evidence is explicitly inherited. Please integrate this diagnostic gate result within foundation scope; actual renderer/UI/deployment and actual-user migration remain outside this review.