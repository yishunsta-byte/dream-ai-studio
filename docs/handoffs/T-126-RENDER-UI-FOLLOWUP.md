# T126 · T119 independent render UI follow-up

- Reviewer: dispatched Codex worker, `term_bcc59f62-1905-4e6b-b62f-4978496417c2`; task `task_34cb80c449ab`.
- Target: **6714617466e86fa46a51dd7876d4be40d7850d90**, T119, 2026-11-17 Asia/Seoul.
- Result: **bounded UI PASS; mandatory FAIL/B 0**. T123 C2 (media-open name), C4 (cancel labels), and T119 R16 including its **exports browser gap** are closed within the evidence below. Existing C1/C3 and U1 limitations remain; this is **not T124/backend-integrity, full P2, deployment, or real-device acceptance**.
- Repository write: this report only. No product/test/fixture/shared-document edits, commit, push, helper worker, or user-data access.
- Read: AGENTS, AI_TEAM_RULES, CLAUDE, team role/assignment documents, PLAN/REVIEW, T102, T119, T120, T121, T123. The task's report-only ownership overrides general shared PROGRESS/REVIEW update instructions.

## Isolation and evidence provenance

Evidence root (preserved):

`C:/Users/Administrator/AppData/Local/Temp/dream-t126-9b24e5dee0c545359ad97e283d4066da`

This new child workspace's **475 tracked files were copied byte-for-byte** to `source/`, retaining working-copy CRLF. Final comparison found **0 mismatches**, `integrity-cleanup.json`. Existing dependencies were copied from `D:/starwork/dream-ai-studio/node_modules`; no dependency install/update was performed. Initially `.tools` was an own-temp junction to existing tools. Turbopack rejected that cross-root link, so only that checked junction was removed and the tools were copied into own-temp `.tools`. Shared tools were never moved, installed, or edited.

Runtime `runtime4/` was created from an **empty new database**, with product migrations and a synthetic source PNG. `t126-setup.ts` uses product project/planning services to create and approve one current-format shopping project, executes the real mock-provider image job through `runNextJob`, completes production, saves a current timeline through `timelineService.save`, and passes/approves the actual review items through `reviewService`. It has **canCreate=true**, ready export preview, no missing inputs, no timeline error/staleness. No locked s5 fixture or fixture bypass was used. Successful rehearsal `runtime3` and two failed initial setup roots are also owned synthetic data, not user data.

**Queue preparation is deliberately synthetic:** image and editing-bundle jobs were enqueued by current product services with valid snapshots, then their `next_run_at` was set to 2099 **only in the owned fake DB** to preserve queued cards while the renderer runs. They were not actual image/export executions during the wait checks. `blockedBy` was calculated by the real jobs service/API; no browser response/DOM/React state or running-render row was injected. The initial selected image and later speech control were actual executions of the existing **mock provider**, not an external AI service.

**Actual renderer evidence:** browser click requested the first render; an owned one-shot Node worker called the unchanged `runNextJob` and actual Remotion child/browser on this fake project. One scene, 30 seconds/900 frames, 1080×1920, H.264, 30fps, audio0, product verify passed and file was published. `worker1.log`, `readonly-before.json`, and API/browser result evidence record the real success. This was not UI-state injection or a fabricated success MP4. This single UI-supporting render does not rerun or replace T124's backend tests.

Server: **production build**, `next start --hostname 127.0.0.1 --port 3126`, `DREAM_DATA_ROOT=<root>/runtime4`. Browser: own ego-browser TaskSpace **19**, p1 only. Layout claims below use recorded `innerWidth`, not screenshot filenames.

## Direct checks

| Check | Result and concrete evidence |
|---|---|
| Shared ConfirmPanel default | **PASS.** Existing library “보관하기” opens with buttons **취소 / 보관하기**, initial focus “취소”; Escape dismisses without archiving. `readonly-browser.json`, `default-confirm1280.png` (filename is not a width claim). Static default/custom-label cases also pass. |
| Render cancel labels and focus, 390/1280 | **PASS.** Buttons exactly **계속 만들기 / 취소하기**, initial focus “계속 만들기”. Shift+Tab reaches danger, Tab returns to safe button. Escape closes and restores “취소” trigger focus; reopening and pressing Enter on safe default also closes/restores. API after each dismiss/continue still says **running, cancelRequested=false**. `confirm-evidence.json`, `confirm-390.png`, `confirm-1280.png`. |
| Explicit user cancel | **PASS, queued case.** A second real UI request was canceled by opening its panel, Tab to “취소하기”, Enter. Real API now returns **canceled, attempt0, cancelRequested=true, fileExists=false**; UI shows cleanup/canceled copy. No worker was started for this second job. First actual succeeded file remains available and hash-identical. `browser12.mjs`, `actual-cancel-after.json`, `queued390.png`, `canceled390.png`. This does not newly claim compose-stage cancellation coverage; T121 has that earlier evidence. |
| Media-open labels/ARIA/no autoplay, 1280/390 | **PASS.** Closed “영상 보기”, aria-expanded=false; opened “영상 닫기”, true; aria-controls resolves to the visible player region. Actual renderer-produced MP4 reaches readyState4, 1080×1920, **paused=true/currentTime=0/autoplay=false**. Closing returns false, hides region, removes video. `play-idle.json`, `play-1280.png`, `play-390.png`. No automatic playback is implied or added. |
| RenderWait predicate | **PASS.** Existing five T119 tests cover queued **non-render** + blockedBy render only, negatives for running/render/other blocker/null/missing job, and note without guessed link when running row is absent. Same/other-project label cases and JobsPanel static label/link cases pass. Direct browser uses actual API states, below. |
| R16 production/jobs/exports during real renderer | **PASS at both widths.** API has actual running render plus queued image/export blockedBy render. Production/export each show one note; jobs shows two, one per queued non-render job. Each points to exact `/projects/01a1e577-685b-731b-8690-cb0759a47973/render`. Render jobs use “소리 없는 영상” and render-route link. `wait-evidence.json`, six `wait-*.snapshot.txt` and PNGs. |
| Keyboard render-flow navigation | **PASS, all six route/width combinations.** Actual Tab sequence reaches “영상 만들기 진행 보기”, Enter opens the exact render route. Tab counts production/jobs/export: **32/33/33 at1280; 9/9/10 at390**. Wait links measured **44px** high. No programmatic link click/focus substitute. `wait-evidence.json`, `browser05.mjs`. |
| Exports author browser gap | **CLOSED.** Current-format project is genuinely review-approved; export preview is usable and the valid product-enqueued queued bundle displays the note/link while actual renderer runs. Both widths and Tab/Enter are covered. The bundle itself was held queued and was not generated in this test. |
| No false render wait: global idle | **PASS, all three routes × two widths.** Deferred queued jobs remain, but no job is running; API blockedBy=null and note/link counts **0**. `play-idle.json`. A later settled idle navigation sweep also remains 0, `readonly-browser.json`. “Idle” here means no running global job, not an empty queue. |
| No false render wait: other running job | **PASS, all three routes × two widths.** Real product-enqueued `speech`, scenario delay:10s, was executed through unchanged runner; API running kind=speech, queued blockers=`generate`, note/link counts **0**. `other-job.json` plus `other-job-followup.json`. First two desktop samples raced worker startup and were idle; the follow-up explicitly replaces those with confirmed speech-running samples. |
| Width and visual review | **PASS within T119 scope.** Six positive wait views have actual innerWidth1280/390, scrollWidth1265/375, no document horizontal overflow; same measurements for cancel/player checks. Mobile export note wraps, link is legible; cancel safe/danger actions and desktop player inspected visually. This is not exhaustive touch-target, native zoom, phone, or screen-reader testing. |
| Existing disabled/focus policy | **PASS unchanged scope.** T119 diff changes only labels/optional prop in ConfirmPanel and ResultRow; effect/focus/Escape handlers are unchanged. Shared Button implementation is unchanged. Native disabled + reason-discovery limitation C1 remains; this review does not claim it fixed or expand into a global refactor. |
| Read-only UI actions | **PASS within measured sweep.** After workers settled and explicit request/cancel ended, captured **every SQLite table's rows** and old MP4 hash before/after library panel open/Escape, production/jobs/export/render navigation, API reading, and media open/close. Captures are byte-identical, including activity/settings/jobs/reviews/timeline. `readonly-before.json`, `readonly-after.json`, `integrity-cleanup.json`. Startup temporary write probes are incidental and not a claim of a physically read-only HTTP server. |

First success file SHA256, still equal after explicit second cancellation and read-only sweep:

`0853c6c50cc3170aad4202864f96d8c141072b84bf3123935f99895e0bfb1ed4`

## Commands and checks

All commands below ran in the owned source copy, not shared build/output folders.

| Command | Actual outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/p2-4-render-wait.test.ts tests/p2-4-render-panel.test.ts tests/production-panel-render.test.ts` | **17 PASS / 0 skip / 3 files**, exit0: T119 five + render-panel ten + production two. `focused.log`. |
| `npm.cmd run lint` | **PASS exit0**, zero warnings; `lint.log`. |
| `npm.cmd run build` | First attempt **environment FAIL**: Turbopack could not resolve cross-root `.tools` junction. Own checked junction replaced with ordinary copied tools; repeat **PASS exit0**, including `scripts/verify-build.mjs` no local data/secrets/render tools in production traces; `build.log`, `build2.log`. Product config unchanged. |
| `npm.cmd run typecheck` | **PASS exit0**, also repeated after successful build; `typecheck.log`, `typecheck2.log`. |
| `node --conditions=react-server --import tsx t126-setup.ts` with owned runtime | New valid synthetic project/services preparation. First two harness attempts needed asset created_at and correct scene lookup, then succeeded. Failed roots were not reused as test evidence. `setup*.log`. |
| `node --conditions=react-server --import tsx t126-worker.ts` | Unchanged production runner, one real successful render, no fake terminal-state injection; `worker1.log`. |
| `node --conditions=react-server --import tsx t126-other.ts` | Actual delayed mock-speech negative control, then exited; `worker-other.log`. |

Original CRLF preserved: wait test **50**, render-panel **122**, production test **60**, package.json **62**, package-lock **8036** CRLF; LF-only0 for these files. No line-ending normalization to make tests pass. Entire tracked source copy stayed byte-identical after checks. `git diff c7f7774 6714617 -- app lib db migrations tests/fixtures package.json package-lock.json` is empty: T119 did not change old API/schema/migrations/fixtures/packages. Backend changes already in T120 remain subject to T124, not accepted by this comparison. Full backend nine-E2E suite was intentionally not repeated.

Harness-only browser mistakes were resolved without product edits: first-dialog selector matched the navigation dialog rather than the open confirmation; corrected to `dialog[open]`. Explicit cancellation completed, but the harness waited for incorrect wording and timed out; subsequent real API + UI observation confirmed the already-canceled record, without repeating the request/action. A server-start race caused an initial refused navigation; navigation was retried after readiness. No such tool/harness error is counted as a product FAIL. `queued1280.png`/`canceled390.png`/`default-confirm1280.png` names alone do not prove viewport dimensions; only the measured JSON-backed series support exact-width claims.

## Remaining C items, gaps, and next entry conditions

- **C3 retained, not new scope:** actual fresh queued render has server attempt0, but UI **“시도 1/3”** from `Math.max(render.attempt,1)`. Reproduced again in the second request (`queued390.png`, `browser12.mjs`); cancellation API still records attempt0. T119 did not implement the optional pre-attempt wording. Master may assign a small later UI copy change; no server retry-policy change is requested here.
- **C1 retained:** common Button native disabled/reason association/accessibility policy is unchanged. No new global accessibility refactor or actual screen-reader result.
- **U1 inherited uncertainty:** initial hydration-boundary focus observation from T123 was not newly reproduced or reclassified. Hydrated confirmation focus is directly checked here; no general R10 completion-focus defect is asserted.
- Backend F116-1~4, cache/input race integrity, external-network containment, fault classification, real backup/restore and broad renderer cleanup remain **T124's independent scope**. This report neither turns T120 author results into independent PASS nor supersedes T124.
- No actual phone, screen reader, native200% browser zoom, subtitle frame-error measurement, complete error/blocker matrix, or generated export ZIP is claimed. Existing “측정 전/확인 전” remained honest. Other-project label/no-running-row fallback have static tests, not a separate live multi-project browser run.
- This bounded UI result can be integrated with T123/T121. Overall renderer/P2 acceptance still needs Master's separate T124 result and the existing user/design gates. No additional permission question is introduced.

## Cleanup and return

Own TaskSpace19 finished with `finish({keep:[]})`. Own production server PID70800 stopped after command-line ownership check; **3126 LISTEN0**. Both one-shot workers exited (**ownWorkers0**), no own-temp-path node process remained. Other sessions' servers/browser spaces were untouched. `integrity-cleanup.json` records these checks. Source/runtime/MP4/scripts/logs/PNG/JSON evidence is preserved in the OS-temp root; no cleanup removed review evidence. Only this repository report is added; no commit/push.

복사용 전달 메시지: T126은 6714617의 T119 독립 UI 후속 범위 PASS(B0)입니다. 새 유효 가상 프로젝트를 실제 제품 서비스로 생성·검수 승인하고 실제 renderer 실행 중 production/jobs/exports 1280·390 안내·정확한 링크·Tab/Enter를 확인해 T119 exports 공백을 닫았습니다. 계속 만들기/Escape 뒤 실제 running·cancelRequested=false, 명시 취소 뒤 queued→canceled, 실제 MP4의 영상 보기/닫기·ARIA·자동재생 없음, 다른 작업/전역유휴 때 거짓 렌더대기 없음, 읽기 UI 전후 모든 DB 행·MP4 해시 불변을 확인했습니다. 원본 CRLF 집중17/lint/type/build PASS이며 초기 도구 junction 빌드 실패는 자기 tools 사본으로 해결했습니다. 기존 C1·C3(queued0에 시도1/3)·U1/실기기 등 갭과 T124 backend 판정은 별도로 유지합니다. 고유 보고서만 작성했고 자기3126/worker/browser19 정리·증거 보존 완료이니 T123/T121 및 별도 T124 결과와 함께 수용 범위를 결정해 주세요.
