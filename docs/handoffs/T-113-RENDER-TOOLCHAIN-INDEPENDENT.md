# T-113 · Independent pinned render toolchain review

- Reviewer: dispatched Codex independent reviewer; no implementation participation or helper workers.
- Target: `2f12b9bc3d4028499a44f6d94108a01a0b2ffb69` (`2f12b9b`). Worktree initially clean.
- Reviewed 2026-11-17 KST. Read AGENTS, AI_TEAM_RULES, CLAUDE, PLAN, REVIEW, TEAM, docs/team roles, T-108, T-101 and T-106. Latest dispatch limits override shared-document update conventions.
- Only repository write: this report. No product/test/package/asset/shared-status edits, commit, push, user-data migration, app worker or UI operation.
- Verdict: **PASS for the pinned toolchain and the specified normal/cancel/composition-failure/missing-at-preflight smoke paths; FAIL for an unconditional launch-failure cleanup guarantee.** F113-1 below must be contained before application-worker integration can claim robust cleanup. This is not approval of P2-4 application rendering or exhaustive network privacy.

## 1. Isolation, commands and evidence

Own OS-temp runtime: `C:/Users/Administrator/AppData/Local/Temp/dream-t113-90c0b61bc16e4cdab6e8d68166262c87` (abbreviated E below). Source copied with robocopy excluding .git/node_modules/.next/.tools/.env.local; no checkout rewriting or line-ending conversion. Node `v26.13.0`; `npm.cmd ci` installed 397 packages, exit 0. Initial bare npm.ps1 was blocked by Windows execution policy; corrected to npm.cmd without changing policy. Lock SHA256 before/after: `7d619f2d366052f1ed28b02245292593fb32491f2920e40f9b038daba8c6b2fc`.

Original package.json/package-lock.json/relevant test are byte-identical to source, with respectively 62/8036/119 CRLF delimiters. Root tools were used only for reading/executing: `D:/starwork/dream-ai-studio/.tools/remotion-browser/158.0.8127.2` and `.tools/ffmpeg`. Own-temp .tools junctions resolve those paths; no root installation script or root overwrite was performed. Installer mutations below use entirely separate ordinary directories under E.

| Independent command in E | Actual result / evidence |
|---|---|
| `npm.cmd ci` | PASS exit 0; ci.log; esbuild 0.28.1 postinstall unapproved/skipped as reported; platform binary nevertheless bundles successfully; 7 moderate audit notices retained, no dependency remediation attempted |
| `npm.cmd test` initially without tools | PASS 43 files, 500 passed/5 skipped; test.log |
| `npm.cmd test` with read-only tools junctions | PASS 43 files, **501 passed/4 skipped**; test-tools.log; media test now executes |
| `npm.cmd run lint` | PASS exit 0, zero warnings; lint.log |
| `npm.cmd run typecheck` | PASS exit 0; type.log |
| `npm.cmd run build` | PASS exit 0 including verify-build local-data/secret tracing check; build.log |
| `node scripts/remotion/smoke.mjs --out evidence-original` | PASS exit 0, unmodified target smoke; smoke-original.log and evidence-original/smoke-result.json |

Author T108's 501+4skip is author evidence, separate from the independently executed 501+4skip above. Four remaining skips are generation fixture paths, not suppressed failures. The initial fifth skip was missing media binaries. No test expectations were edited.

CLI limitation: target smoke has only `--out`, no `--help`, `--browser` or `--ffprobe` handling. Its explicit browserExecutable and ffprobe are computed from app/.tools. An initial temp-only adapter supplied literal root paths (evidence/smoke-result.json; exit 0); final result above restored the exact smoke bytes and used junctions. Thus no nonexistent CLI path-option support is claimed. Adding configurable explicit paths/help is a usability follow-up, not a failed codec check.

## 2. Exact packages, prior versions and pinned license

PASS: direct Remotion set is exactly remotion, @remotion/player, @remotion/renderer and @remotion/bundler, all exact `4.0.543`, no ranges or fifth direct Remotion package. Relevant original test (13 cases within full suite) checks package declarations, lock metadata, installed versions and normalized LICENSE.md hashes. All four installed licenses match `53e92b6560f26f9d913a8ac97e4861e013c99ee9164fa0b11c25d8a02672fc09` and `SEE LICENSE IN LICENSE.md` metadata.

Independently compared parent `2f12b9b^` lock to target: **177 added package locations; zero removed locations; zero version changes to existing locations**. This verifies prior-version preservation, rather than inferring it from diff size. Installed renderer/bundler/remotion/compositor version results are all 4.0.543; player is covered by the exact-license test. Lock unchanged by npm ci.

Pinned LICENSE.md eligibility explicitly includes an individual. T040/T101/T106 already record actual user's personal-use approval; no new approval question is required. This report records that existing decision against exact installed text, and does not make a general legal determination. Compiled `renderer/dist/render-media.js:582` returns before registering usage when licenseKey is null; free-license instead enters the registration path. Smoke explicitly uses `licenseKey:null`, `concurrency:1`, `muted:true`, H264/yuv420p and bt709. This agrees with T106 decisions.

Compiled compositor ffmpeg actually reports `n7.1`, `--enable-gpl`, `--enable-libfdk-aac`, libx264 and libx265. Compositor package lacks a license field/file as T108 noted. Redistribution/source/notice obligations and the compatibility of shipped codecs remain a separate distribution assessment if the app/binaries are shared; local render success is not redistribution clearance. No redistribution occurred. No current web/legal-policy claim is substituted for the pinned artifacts.

## 3. Installer validation and rejection checks

PASS official pin: installed renderer TESTED_VERSION is `158.0.8127.2`; its Windows URL is remotion.media/chromium-headless-shell-win-x64-158.0.8127.2.zip (renderer adds `?clear`). Pin uses that same archive, not the differently packaged Google CfT archive.

Copied the existing root archive into own installer sandbox through `-ArchivePath`; **no 137MB network redownload**. Actual install exits 0 and version output is Chromium 158.0.8127.2. Second execution exits 0 with already-installed-and-verified. Evidence install.log/idempotent.log. Archive size 137435497, SHA256 `58afb19b136b32c36a9b879cedde3d8a05d0f5cfb2e60b6f17b7c0301e10299a`; executable `40fcceffa39380a1188ead560d9dea125d1075284ad56448be0c1282e4f652a7`; license `cc6e35dcf31e3c8f72714c87c4b2f14486e2085a5e956a8ddd1421ffbab3d18b`. Successful install verifies the pinned 19 entries/files. All later perturbations are own copied configuration/files.

| Case | Actual result |
|---|---|
| Five-byte wrong archive | exit 1 checksum mismatch; no final install/staging; bad archive retained for evidence |
| Existing partial installation with sentinel | exit 1 incomplete-folder rejection; sentinel preserved; no executable installed |
| Copied pin installDir `../escape` | exit 1 outside-root rejection before extraction; no escaped install |
| Copied pin deliberately wrong expected license SHA | exit 1 license mismatch, **final directory and executable already exist**, staging absent |

Evidence: installer-cases.ps1, installer-cases.json and wrongarchive/partial/boundary/license.log in E. Wrong archive rejected before any entry extraction. Static archive-entry checks require expected prefix, forbid '..', resolve each target under staging and use ExtractToFile overwrite=false. Because archive SHA is fixed, arbitrary zip traversal content cannot reach extraction without changing trusted configuration. Existing-target path and staging containment are lexical; no adversarial junction/reparse-point or concurrent-installer guarantees were tested. Entire pinned archive authenticates auxiliary files on first install; repeat verification only checks executable/license hashes and file count, not every DLL's bytes.

**O113-2 (nonblocking staging robustness):** executable hash is checked in staging, but license hash/count and version execution are checked after Move-Item publishes the final directory. The deliberately inconsistent trusted pin demonstrates a failed validation can leave a published install, which subsequent runs refuse until manually moved. Validate license/count/version in staging before publish for a stronger atomic install contract. With the current authentic immutable archive+matching pin this artificial mismatch does not occur, so this does not invalidate the successful current installation. Concurrent appearance between Test-Path and Move-Item is also not proven safe by the single existence check; do not promise race-free no-overwrite publication.

## 4. Actual output and lifecycle results

Unmodified final smoke: started `2026-11-16T15:31:08.937Z`, ended `2026-11-16T15:31:41.282Z`; self-exited, no watchdog termination. Each output has **one H264 video stream, yuv420p, tv range, bt709 space/primaries/transfer, r/avg 30/1 fps, 45 decoded frames, 1.5 seconds, audio0 and other-streams0**.

| Composition | Size | bytes | SHA256 |
|---|---|---:|---|
| Smoke916 | 1080x1920 | 35836 | 29e3e29afa4b87bc5b110bb4a39b34f51c3fca9ec9a23a56d93ddc0c0e24b502 |
| Smoke169 | 1920x1080 | 33948 | 0bb7e11a44d4e5e169de90529a2dc5d43f5b99ad0c061864f62ba89aa1ace58b |
| Smoke11 | 1080x1080 | 30095 | 4f8ce44a891a422493e5bcb3ed902ff3d32747828100b51f1ce65fafc41e8e35 |

ffprobe was the existing application's independent .tools/ffmpeg executable, not the rendering compositor's ffprobe. MP4s are intentionally removed by smoke; probe fields and hashes remain in JSON.

- PASS cancel: actual 900-frame render cancelled at 0.05 progress, six browser/compositor processes observed during render; rejection `renderMedia() got cancelled`, settled 4.806s; afterward process0/server0/output absent/no fragments.
- PASS runtime composition failure: throws at frame10; actual rejection `T-108 planned failure`; process0/server0/output absent/no fragments.
- PASS browser absent before launch: browserCheck returns RENDER_BROWSER_MISSING; explicit-path openBrowser rejects, browser-download callback not called, process0 and additional-server0. This path intentionally does not call selectComposition.
- PASS final normal run cleanup: process0, TCPServerWrap0, no node_modules/.remotion before/after, workFolderRemoved true. Independent post-run process query found no pinned browser or this runtime compositor; no own Node worker remained.

## 5. F113-1: preflight does not contain launch failure / TOCTOU

**FAIL for absolute cleanup coverage; mandatory containment requirement before production-worker integration.** Target smoke browserCheck runs before bundling and returns an existence/hash result, not a live retained browser instance. A browser can disappear/change or fail to launch after that check. The comment saying the worker never lets Remotion meet a missing browser is too strong; there is no application render caller yet.

Installed select-composition.js:105 onward performs page/browser launch and makeOrReuseServer in Promise.all. The cleanup try/finally is reached only after Promise.all succeeds. A browser rejection before the server settles can bypass cleanup. The smoke outer finally records handles and removes its work directory, but does not close such a leaked server or place the operation in a bounded owned child. Merely setting exitCode does not terminate a Node process with an open server.

Independent reproduction E/race.mjs: bundle a real minimal composition; validate own sandbox browser exists and SHA equals pinned exe; rename **only that own copied executable**; call selectComposition with its now-missing explicit path. After rejection plus 2.5s: **TCPServerWrap=1**, download=false. This verifies a passed preflight does not eliminate the race. Harness closed its one owned Server handle, restored the renamed executable, then confirmed TCPServerWrap=0 and self-exited (race-result.json/race.log, exit0). Root browser was never renamed. No global PID kill was used.

Required integration response: own child/process-tree containment with bounded timeout/termination and verified own server/browser/compositor cleanup, or launch/retain the browser before opening composition servers and ensure caller-owned server cleanup for failures. Recheck missing-after-preflight and other browser-start failures. A second exists/hash check alone cannot prove absence of TOCTOU. This finding does not negate PASS for the smoke's tested missing-at-preflight/openBrowser-only path.

## 6. Network limits, remaining scope and handoff

Final run Node guard recorded 0 rejected external connections; Windows TCP sampler recorded 10 browser/compositor samples with 0 external rows. No download callback and no Remotion cache appeared. **PASS only for these observations.** This is not an exhaustive CDP request audit or a proof of zero external traffic: Node monkeypatch is process-local and does not instrument native children/all transports; TCP snapshots can miss short connections/UDP/DNS, have broad path-based process selection and silently ignore sampler errors. Guard's host checks also are not a general egress firewall. No CDP claim is made.

No actual user data, app render job/worker/UI, stored timeline composition, phone playback, subtitle timing, retry/recovery, late cancellation, backup integration or final user flow was verified here. Product render acceptance remains separate. Evidence directory is preserved, including own installer copies and all logs/scripts; no running monitor/server/child was left. Only temporary junctions reference root tools; do not recursively delete through them during later evidence cleanup.

Master next entry condition: accept the exact toolchain/output scope if desired, record F113-1 as required integration containment, and retain O113-2/CLI/network limitations explicitly. If requiring an unconditional toolchain cleanup PASS now, hold that gate until F113-1 is fixed and independently rechecked. Report preparation and Orca delivery are separate; worker_done receipt establishes delivery, not Master integration.

### Copy-ready message to planner / Master

T113 independent review of 2f12b9b completed: exact four 4.0.543 packages/unchanged prior versions/license pin, fresh npm ci, original-CRLF independent 501+4skip, lint/type/build, cached-archive install/idempotence/rejection checks and actual three-aspect H264/yuv420p/tv/bt709/30fps/45frame/1.5s/audio0 smoke passed. F113-1 independently reproduces one leaked selectComposition TCP server when the browser disappears after successful hash/existence preflight; missing-at-preflight PASS is narrower, so bounded caller-owned containment is required before worker integration can claim robust cleanup. Please integrate this report's scoped PASS/FAIL and retain staging-publication, CLI-path-option and non-exhaustive network limits; no user-data/app-worker/UI acceptance or new approval question is implied.