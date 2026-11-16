# T131 — Subtitle validation focused independent recheck

- Reviewed target **b3084c888a27c0b668968467dca50caf8f32d110** (T129) on2026-11-17 KST, by the T128 independent reviewer, without implementation participation, subagents or helper workers.
- **Verdict: PASS for the assigned T128 reporting/input/automation follow-up.** R128-1/2 corrections are explicit; invalid ROI/dimensions/threshold/minimum/frame data/CLI inputs fail closed; actual subprocess execution now confirms both failed-attempt and failed-SRT verdicts produce **report.pass=false and exit1**, with a passing replay control producing exit0.
- This does not expand the fixed matrix's visibility acceptance. **Threshold96 fade7/30s remains FAIL**; threshold48/minimum40 remains unchanged. Pixel differences still do not recognize text or measure universal human visibility.
- Read T129 report/diff, corrected T127, T128 and current Master TEAM assignment, and retained AGENTS/common/team/PLAN18/T057 boundaries. Only this new report was written in the repository. Product/shared documents/tests/fixtures, real-user DB/data, tools and other workers' evidence were not modified; no commit/push. The pre-existing untracked T128 report was preserved unchanged.

## Isolation and target identity

Evidence root **E**:

`C:/Users/Administrator/AppData/Local/Temp/dream-t131-6365ae541f0347f3bd9f46babab97df1`

The review worktree remains at3ebf95c; the newer target was read with `git show`, without a checkout/reset/cherry-pick. `E/app` copies Master's tracked source at0f4c27f, which incorporates T129. `source-integrity.json` compares all519 copied tracked files with Master after the checks: **zero byte differences**. `target-content.json` compares all519 files with b3084c's Git blobs, allowing the existing checkout CRLF representation: **only docs/TEAM.md differs**, reflecting Master's subsequent assignment record; target script/tests/product/package contents match. No product mismatch was ignored.

Line endings were **not rewritten** to obtain green checks. The exact copied Master environment contains original package.json62CRLF and lock8036CRLF; T129's new script has241LF/0CRLF and its test120LF/0CRLF, as present in Master. This preserves the mixed source environment honestly instead of calling every file CRLF. Source script SHA256 is `0ca98a4c26aedcac2482ea91d86dacbc710bb231e15709c409ce65ba4705e895`; test SHA256 is `49b7410b1980236663d76058b8c46e47e3aabad5c3b89effeb6957f5440422fc`; lock SHA256 remains `7d619f2d366052f1ed28b02245292593fb32491f2920e40f9b038daba8c6b2fc`.

Fresh `npm.cmd ci` installed only in E/app. Existing tools were read/executed through E/app/.tools junction to `D:/starwork/dream-ai-studio/.tools`; do not recursively delete E through that junction. TEMP/TMP for spawned CLI measurements point to E/runtime. Reviewer scripts, a compiled byte-stream fixture and dependency harness live only under E. No persistent web server or actual renderer was started in this follow-up.

An initial comparison using Git checkout filters produced line-ending mismatches; it is retained as integrity.json/log, **not evidence of product changes**. The authoritative exact-Master byte comparison and normalized target-content comparison above resolve that representation issue.

## Commands and independent results

Run reviewer commands from E/app with `T131_EVIDENCE=<E>`.

| Command / inspection | Actual result | Evidence |
|---|---|---|
| `git show --stat b3084c`; `git show b3084c:docs/handoffs/T-129-SUBTITLE-VALIDATION.md`; script/test/T127 diff | Four assigned files only; no product API/DB/UI/package modifications in T129 | Git target and this report |
| `npm.cmd ci` | PASS exit0; existing audit/install-script notices retained | ci.log |
| `node node_modules/vitest/vitest.mjs run tests/measure-subtitle.test.ts` | **14 PASS /0 skip /1 file**, exit0, copied source unmodified | focused.log |
| `npm.cmd run lint` | PASS exit0, zero warnings; before adding reviewer probes | lint.log |
| `npm.cmd run typecheck` | PASS exit0; before adding reviewer probes | typecheck.log |
| `node --conditions=react-server --import tsx t131-probes.ts` | PASS exit0; **23 accepted/62 rejected** assertion cases and **8 actual invalid-CLI subprocess checks** | probes.json/log |
| `node t131-harness.mjs` | PASS harness exit0; actual child statuses **1/0/1**, corresponding reports **false/true/false** | harness.log, harness/results.json and per-mode JSON/stdout/stderr |
| `node t131-target-content.mjs`; source byte comparison | All target code matches; docs/TEAM-only newer content; all519 files byte-identical to copied Master source | target-content.json/log, source-integrity.json |

Master's prior14-test rerun is distinct from this independently executed14. Author's **570 passed/13 skipped, lint/type and three matching actual MP4 hashes** remain author evidence. T128's actual Composition/frame verification and T124/T126 build/backend/UI evidence remain inherited with their original limits. No whole suite/build/nine-E2E run was repeated or newly claimed here.

## Point-by-point recheck

| T128 point | Recheck and quantitative result | Verdict |
|---|---|---|
|R128-1 SRT “0” overprecision|T127/T129 explicitly distinguish actual maximum**1/3000s** from displayed0.000; target `srtErrorSec(367,11)` returns exactly1/3000 in the rational formula. Main now records exact `maxErrorSec` separately from `maxErrorSecDisplay`. Replay reports0.0003333333333333333.|**PASS**|
|R128-2 all source hashes identical|Corrected T127 supplies distinct image/video prefixes9:16 `3bee77452e1a/84ee6c964f2e`,16:9 `23ef4fd1e47a/8438a8eadb5f`,1:1 `52ebb172e504/ca2199e07955`; only font hash is shared. These match T128's retained measurements.|**PASS**|
|Threshold selection chronology|Corrected report labels “48/40 before first run, sensitivity afterward” as **author testimony**, with no independent preregistration and no evidence proving posthoc selection. Fixed-matrix/non-text-recognition limitations and96/fade FAIL remain explicit.|**PASS reporting scope**|
|ROI row wrapping|Original impossible rect{x840,y164,w200,h30} at640×360 now throws MeasureInputError. Exact right/bottom overflows, negative coordinates, empty dimensions, fractional/NaN coordinates and invalid reference rectangles reject before decoder spawn.|**PASS**|
|Valid rectangle boundaries|Full640×360 rectangle and last-pixel{x639,y359,w1,h1} accepted. A rectangle extending one pixel beyond either edge rejects. Valid ordinary/near-top generated bands accepted; center0/1/outside/NaN/infinite or a generated band extending below frame rejects.|**PASS**|
|Frame dimensions|Zero/negative/fractional/NaN/infinite/oversized dimensions reject. Main's three actual dimensions remain valid.|**PASS**|
|Threshold sanity|−1,255,256,fractional,NaN,±Infinity reject.0,16,32,48,96,254 accepted; because comparison is “> threshold,”255 is deliberately invalid. Fixed48 unchanged.|**PASS**|
|Minimum/count sanity|Minimum0/negative/fractional/NaN/infinite rejects;1/40 accepted. Negative/fractional/NaN/infinite pixel counts reject;[0,39,40,41] shows exactly2 frames at40, blank counts show0.|**PASS**|
|Decoded bytes/count|For2×2 RGB frames (12bytes),0bytes rejects “no frame”;11/13/25bytes reject leftover bytes;24bytes with expected1 rejects “decoded2”;24bytes with expected2 accepts two all-zero counts. Invalid expected counts0/negative/fractional/NaN/infinity reject. Original14 tests additionally use real ffmpeg MP4 decode to reject wrong height361 and expected119 versus actual120.|**PASS**|
|CLI missing/duplicate/unknown|Actual unchanged CLI subprocesses reject8 cases with exit2+usage: `--out`; `--out --keep`; empty out value; duplicate out; duplicate keep; unknown option; extra positional; `--out=a`. Runtime directory inventory unchanged before/after every case.|**PASS**|
|Inclusive/exclusive conversion and boundary scoring|Expected[11,46), detected11…45 gives0frames;6frame error passes and7fails. Fade48 detected17…67 gives5frames PASS; fade96 detected18…65 gives7frames FAIL. Missing detection remains false. Integer-frame verdict avoids rounded-seconds acceptance drift.|**PASS**|
|Runtime error and cleanup|Original test's missing owned ffmpeg path returns exit1 without report or leftover work folder. Harness measured-verdict cases also leave no measurement work folders.|**PASS**|
|report.pass false → exit1|Actual failed-attempt report and separately injected SRT-verdict failure both exit1; positive replay exits0. Details below distinguish dependency fixtures from native rendering.|**PASS**|

The custom byte producer is an owned .NET console executable compiled via PowerShell `Add-Type`, deliberately emitting the requested number of zero bytes (one byte at a time). It tests actual child stdout/frame accumulation and close handling, **not ffmpeg decoding quality**. Real decode validation is covered by the unchanged original14 tests and inherited actual MP4 evidence. Both fixture and source remain under E.

## Actual automation path: failed verdict coverage

T129's gap was that the author only inspected the `return report.pass` → `process.exitCode` path for a failed verdict. The reviewer tested the executable path without changing the target script or its48/40 criterion:

- `t131-harness.mjs` bundles the **unchanged target script** with esbuild into the owned `E/app/.t131-harness/measure-subtitle.ts`. Only the render-run and timeline import edges are redirected to explicit owned fixture modules. The original main loop, source fixture generation, report aggregation/writing, cleanup finally block and final exit wrapper execute.
- Each mode is a separate ordinary Node subprocess, invoking `--conditions=react-server --import tsx <harness-script> --out <owned-json>`. Parent captures the **OS process status**, reads the report and asserts pass/status/inventory. It does not manually set child exit codes or inject a report file.
- `attempt-fail`: render dependency returns an explicit failed attempt for all3 aspects. No renderer is launched. Main writes3 failed result rows, report.pass=false, and the subprocess exits1.
- `replay-pass`: render dependency copies the **existing T128 actual-render MP4s** into the owned current work directory. Native source encoding, original verifier/ffprobe, original pixel decode/scoring and original SRT run. All3 rows pass, report.pass=true, process exits0. This is a positive control using previously rendered files, **not a new actual render**.
- `srt-fail`: same replay, but the timeline dependency forwards the real SRT with only c1's367ms start timestamp replaced by1367ms. Expected cue seconds, fixedthreshold48/minimum40, actual MP4s and video detector remain unchanged. Product script's SRT error path observes **1.0003333333333333s**, all3 rows fail, report.pass=false, subprocess exits1.

| Harness mode | Render dependency | Video max error | SRT max error | Final report.pass | Actual child status | Temp folders before/after |
|---|---|---|---|---|---|---|
|attempt-fail|explicit injected failure|not measured|not measured|false|**1**|0/0|
|replay-pass|copy of prior actual MP4|5frames/0.167s|1/3000s|true|**0**|0/0|
|srt-fail|same replay + injected SRT timestamp|5frames/0.167s|1.000333…s|false|**1**|0/0|

Thus the failed-verdict gap is closed through an actual subprocess/report path, including a measurement whose video remains passing and SRT fails. The harness does not validate a fresh renderer failure, renderer lifecycle or DB publication; those are outside this focused exit-state check. The positive replay and SRT-fail modes both read120 frames per aspect and retain threshold96 fade pass:false/maxErrorFrames7; no passing threshold was substituted. `harness/calls.jsonl` and stub source make the injection points reviewable. Retained T128 source MP4 hashes are unchanged and recorded in cleanup.json.

## Remaining limits, cleanup and integration

No new mandatory defect found within this assigned follow-up. The fixed three-aspect/four-cue solid-background matrix remains the only accepted measurement scope at48/40. The detector still counts unrelated contrasted objects and cannot establish human visibility or complex-background text presence. This behavior was documented rather than claimed fixed. Threshold96's0.233333…s fade failure remains a real result for that criterion.

VTT remains unimplemented/unmeasured; user-project measurements, real phone playback, semantic voice sync and general fonts/colors/codecs/footage remain unverified. No subtitleMeasure/phonePlayback flag, UI, API or DB path changed; users' “측정 전/확인 전” state remains. T129's actual-three-aspect hashes are author evidence, supported by unchanged render sources and T128's earlier independent actual run; the replay harness is not an additional native-render acceptance claim.

Final CIM scan: **0 owned non-PowerShell processes** referencing E; **0 `dream-t127-measure-*` folders** remain in E/runtime. All spawned tests/harness/decoders exited, and no persistent server was started. E retains logs, reports, reviewer scripts, harness and byte fixture. Shared tools, other workers' processes and T128 evidence were not removed; T128's three MP4 hashes remain exactly `d2489fc7c720…`, `bb402baa4f98…`, `1a9f170fb646…`.

Next entry condition: Master may integrate T129's reporting/input/automation fixes under the preserved fixed-matrix limitations. This closes the specified T128 follow-up, not the remaining VTT/device/user-project/general-visibility requirements. Sole new repository file: this report.

복사용 전달 메시지: T131은 b3084c T129의 R128-1/2 정정·ROI 행넘김/경계·치수/임계값/최소화소/프레임바이트·개수/CLI 거부를 독립 확인해 배정 범위 PASS입니다. Master 원본 바이트 그대로 관련14/lint/typecheck 통과, 고유 probe23정상/62거부 및 실제CLI8종 종료2를 확인했습니다. 전용 의존성 harness의 실제 자식 프로세스에서 실패attempt는 report.pass=false/exit1, 기존MP4 정상replay는 true/exit0, SRT경계만 오류 주입한 측정은 false/exit1을 확인해 저자 코드검토만 남았던 간극을 닫았습니다. 새 실제렌더로 주장하지 않으며48/40 고정·96페이드7프레임 FAIL·비문자인식·VTT/사용자영상/실기기/의미싱크 미확인을 유지합니다. 자기프로세스/측정잔여폴더0·기존T128 MP4 해시 보존을 확인했고 고유 T131 보고서만 작성했으니 한정 범위로 통합해 주세요.