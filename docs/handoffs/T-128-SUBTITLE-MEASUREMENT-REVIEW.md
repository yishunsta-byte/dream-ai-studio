# T128 — Independent actual subtitle measurement review

- Target: `3ebf95c8b9377d94b2b74913e9be098a8caba49d` (T127), reviewed 2026-11-17 KST by dispatched Codex without implementation participation or helper workers.
- Read AGENTS/common rules, CLAUDE, applicable team roles, PLAN 18/20, REVIEW, TEAM, T057, T127 and T124/T126. Latest dispatch restricts repository writes to **this report only**; no product/test/fixture/shared-document changes, commit/push, real-user DB/data access or UI measurement flag changes.
- **PASS: T127's fixed three-aspect, four-cue, four-second test matrix at RGB threshold48/minPixels40.** Independently reproduced actual production Composition MP4s and all120 decoded frames per aspect. Video maximum error is **5/30 = 0.166666…s (reported0.167)**; SRT maximum is **1/3000 = 0.000333…s (reported0.000)**.
- **FAIL for a universal “human-visible subtitle error ≤0.2s” claim.** Threshold96 gives fade end error7/30=0.233333…s, and the detector is a controlled-background pixel detector, not a text recognizer or calibrated human-visibility measure. T127 already discloses most limits; reporting corrections/acceptance qualifiers below are necessary. No mandatory product timing defect is established by this review.

## Isolation, evidence and original checks

Evidence root **E**:

`C:/Users/Administrator/AppData/Local/Temp/dream-t128-447700e11b444085a248edd7e0e1ddc7`

`E/app` is a byte-for-byte copy of all480 tracked target files, installed with `npm.cmd ci`. This is a disposable OS-temp source copy, not another Git checkout. `E/integrity.json` verifies **zero byte differences** after original checks and all probes. Original CRLF counts: package.json62, lock8036, measurement script168, measurement test61, existing gated E2E182; LF-only0 in those files. Node v26.13.0. No expectations or line endings changed.

Existing tools were only read/executed via `E/app/.tools` junction to `D:/starwork/dream-ai-studio/.tools`. Own renderer work/bundles/output/browser profiles lived below `E/runtime`; new reviewer scripts live only at `E/app/t128-*.ts`. No user-data root or database is required by these direct renderer calls. Do not recursively delete E through its tools junction.

| Independently executed | Result | Evidence |
|---|---|---|
| `npm.cmd ci` | PASS exit0; existing7 moderate audit notices/esbuild0.28.1 unapproved-install-script warning retained; actual bundler works | ci.log |
| `node node_modules/vitest/vitest.mjs run tests/measure-subtitle.test.ts tests/p2-4-render-tools.test.ts tests/p2-4-render-props.test.ts` | **6 PASS /0 skip /1 actual matched file**; latter two named files do not exist and are not claimed as executed | focused.log |
| `node node_modules/vitest/vitest.mjs run tests/p2-4-render-units.test.ts tests/p2-3b-timeline.test.ts tests/p2-1-timeline.test.ts` | **53 PASS /0 skip /3 files** | related.log |
| `npm.cmd run lint` | PASS exit0, zero warnings, before adding reviewer probes | lint.log |
| `npm.cmd run typecheck` | PASS exit0, before adding reviewer probes | typecheck.log |
| `node --conditions=react-server --import tsx scripts/remotion/measure-subtitle.ts --out <E>/measure.json --keep` | PASS exit0/report.pass=true; original script unchanged, TEMP/TMP below E/runtime | measure.log, measure.json |
| `node --conditions=react-server --import tsx t128-audit.ts` | PASS execution exit0; separately coded full-frame detector, ffprobe and controls; output includes intentional negative findings | audit.log, independent.json, controls.json |
| `node --conditions=react-server --import tsx t128-extras.ts` / `t128-roi.ts` | PASS execution exit0; compression, exact SRT errors, invalid CLI/ROI probes | extras.json/log, wrapped-roi.json/log |

Set `T128_EVIDENCE=<E>` and cwd=`E/app` for reviewer scripts. Main renderer used a dedicated TEMP/TMP=`E/runtime`. Existing artifacts must be preserved before rerunning scripts with fixed output names (ffmpeg refuses overwrite).

**Inherited, not rerun here:** T124 independently executed551 PASS/13 skips, lint/type/build and nine real backend E2Es; T126 independently executed17 focused checks, lint/type/build and actual-render-backed UI. Their acceptance boundaries, including T124 active same-user attempt-copy tampering findings and Master's stated local trust model, remain unchanged. This review adds59 focused original checks and actual subtitle measurement; it does not repeat or claim a new whole-app build/full suite/nine-E2E pass. T127 adds only its script, tests and report to its parent.

## Expected boundaries and SRT

Manual seconds are the external cue definition. The target's integer rule first rounds seconds×1000 to milliseconds, then computes `floor((ms×30+500)/1000)`. The unchanged original test compares the script's copy to product `secondsToFrames` for all5001 whole milliseconds from0 through5s. Independent arithmetic confirms the chosen non-frame-aligned cues:

| Cue | Animation | Manual seconds | Expected frames [start,end) | Product SRT ms [start,end) | Exact maximum SRT error vs frames |
|---|---|---|---|---|---|
| c1 | none |0.37–1.52|11–46|367–1533|0.000333…s|
| c2 | none, spans image/video cut |1.71–3.08|51–92|1700–3067|0.000333…s|
| c3 | fade in/out, duration10, ease-out |0.55–2.43|17–73|567–2433|0.000333…s|
| c4 | typewriter in, no out |1.18–3.61|35–108|1167–3600|0.000333…s|

Product `timelineSrt` sorts by start, so reading pairs by unique cue text is appropriate for this fixed matrix. This is not an independent arbitrary SRT duplicate/multiline parser validation: `parseSrt` captures one content line, and `find` assumes unique text. Existing test explicitly checks product-sorted SRT; exact error calculations are in extras.json.

Detected frame intervals store inclusive first/last. Conversion **end=last+1** correctly matches Remotion Sequence's `[from,from+duration)` convention; e.g. detected11…45 means [11,46), not [11,45). At threshold48 the fade last detected67 becomes end68, five frames before expected73. Raw manual-second errors include frame quantization and are a different statistic: c1/c2/c4 max0.013333…s; c3 max0.163333…s. They must not replace the specified frame-relative error.

**Reporting correction R128-1:** T127 “SRT0s” is true only after its `round(...×1000)/1000` formatting. It is not mathematical zero; one-third of a millisecond remains at non-integer-ms frame times. State “SRT maximum0.000333…s, displayed0.000s” or “within millisecond precision.” This does not change PASS against0.2s.

## Actual production runtime and full-frame independent reproduction

The unchanged path is `runRenderAttempt` → actual forked `render/child.ts` → pinned Chromium/Remotion → `render/entry.tsx` `DreamTimeline` → `RenderComposition`. `renderProps` is the production adapter; `RenderComposition` uses actual `Img`, `OffthreadVideo`, registered `FontFace` and production `TextView`/`textMotion`. No mocked renderer, drawn-box replacement Composition, synthetic success MP4, or JSON-only timing comparison was used for these three MP4s.

Remotion **4.0.543**, pinned browser **158.0.8127.2**, browser SHA256 `40fcceffa39380a1188ead560d9dea125d1075284ad56448be0c1282e4f652a7`; normalized production composition source SHA256 `b75f8d38e80488d9d68f76805bd8994225a50face5c4c1e2bb3d2d02bc0a4d34`. The actual PretendardVariable.woff2 asset (700 weight requested,100–900 face range) is SHA256 `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`. The production code waits for native FontFace loading before rendering; neither text nor glyphs are replaced by ffmpeg boxes in this matrix. Separate box controls below test only the detector.

Media are **synthetically generated solid-color source files**: image0x335577 for frames0–59, actual H.264 video0x6a4a2a for frames60–119. They exercise native image/video loading/rendering, but are not natural footage or user projects. The DB claim/publication pipeline is bypassed, as T127 says; its backend coverage is inherited separately.

| Aspect / native size | MP4 bytes / SHA256 prefix | Actual render seconds | Independent frames decoded | Threshold48 detected intervals c1/c2/c3/c4 | Control shown/peak |
|---|---|---|---|---|---|
|9:16 /1080×1920|65018 /d2489fc7c720|62.8|120|11–46 /51–92 /17–68 /35–108|0/0|
|16:9 /1920×1080|65685 /bb402baa4f98|56.6|120|11–46 /51–92 /17–68 /35–108|0/0|
|1:1 /1080×1080|65378 /1a9f170fb646|25.4|120|11–46 /51–92 /17–68 /35–108|0/0|

All three MP4 digests exactly reproduce T127's published digests. Product verify passes; separate raw `ffprobe -show_streams -show_format -of json` confirms H.264/yuv420p, BT.709/tv, requested native dimensions,30/1 nominal/average rate,120 frames,4.000s, one video/no audio or other stream. Product verification also uses `-count_frames`. independent.json retains the separate raw probes.

The reviewer detector does **not call bandCounts/detect/score for these independent results**. It independently decodes all frames0–119 once to owned rgb24 files, uses reference-channel histograms to compute medians, accumulates a per-frame channel-distance histogram across each ROI, then evaluates16/32/48/96 and first/last boundaries directly. Raw sizes are746496000 bytes for each rectangular output and419904000 bytes for square. Counts agree with the original reader, including threshold48 c3 peaks11426/11403/11404 and controls0. No interior gaps were observed.

**Reporting correction R128-2:** T127's statement that image/video source SHA256s are the same in all aspects is incorrect. Same colors do not mean same encoded files at different dimensions. `measure.json` has correct per-aspect hashes; only the font file hash is shared:

| Aspect | Image SHA256 prefix | Video SHA256 prefix |
|---|---|---|
|9:16|3bee77452e1a|84ee6c964f2e|
|16:9|23ef4fd1e47a|8438a8eadb5f|
|1:1|52ebb172e504|ca2199e07955|

## ROI, thresholds, contrast and compression

Fixed ROI x20–80%, y±7% around centers14/32/50/68%; reference x2–5% at the same y. Separate control center88%. All actual rectangles fit the three frame sizes, their vertical bands do not overlap, and fixed centered64px single-line white glyphs/black3px stroke stay inside their intended bands. Reference bands are outside these centered texts. Per-frame reference sampling follows the scene cut, avoiding a stale first-frame background estimate. Real footage gradients/objects would invalidate the same assumption.

Distance is **max absolute difference of RGB channels > threshold**, not luminance or perceptual contrast; visibility requires≥40 differing pixels. Forty pixels is far below actual full-glyph peaks (threshold48 roughly11k–16k), excluding small codec noise in this fixture while allowing the first typewriter glyph. It has not been calibrated against humans, low-contrast text, alternate sizes/fonts, backgrounds, HDR or codecs. Correct typewriter start means at least an initial glyph is present, not that the full sentence is readable at that boundary.

| Threshold | Fade interval, all3 aspects | End error | Matrix criterion | None/typewriter | Control |
|---|---|---|---|---|---|
|16|17–70|3/30=0.100s|PASS|exact expected intervals|0|
|32|17–69|4/30=0.133333…s|PASS|exact|0|
|48|17–68|5/30=0.166666…s|PASS|exact|0|
|96|18–66|7/30=0.233333…s|**FAIL**|exact|0|

For the fade, production ease-out leaves nonzero but very low opacity near the end (final local frame has0.001 opacity). A nonzero mathematical alpha is not the same as a detected compressed RGB difference or human visibility. Threshold96 is a different numerical contrast criterion; describing it as a scientifically “stricter human visibility” standard would be unsupported.

**Was48 fixed before measurement?** It is a literal constant in the committed target before this independent run; this reviewer used it unchanged and did not select a passing threshold afterward. In the subsequent document-only supplement `fb5149a0477f0be98ecd8ce7e67d83e08d1a1ee4` (coordinator message `msg_51dc11a8eee5`, author reply cited there as `msg_f63611e1245d`), the author explicitly states that48 and40 pixels were initialized before any actual-render measurement, were not changed after seeing0.167s, and that16/32/96 sensitivity was added after the first result without changing the verdict threshold. **This chronology is now explicit author testimony; it is not independently timestamped preregistration of the initial script or proof of the first-run history.** No evidence establishes posthoc selection of48, either. The author's stated heuristic is48/255≈18.8%, above expected solid-background compression noise and below the white/black glyph contrast (maximum channel contrast against the chosen RGB backgrounds exceeds100). This is numerically plausible for the fixed colors and consistent with independent control0 at16 and the below-threshold faint-box check; it is not independent validation of the author's selection chronology or human perceptual calibration. The supplement leaves96/fade0.233s and the restricted matrix scope explicit. Reviewer verified `git show --stat fb5149a` changes only eight lines of T127's report; comparison `git diff 3ebf95c fb5149a` contains only T127/TEAM/REMAINING_WORK documentation, with zero script/test/product/package differences. Original target and measured artifacts remain3ebf95c; no render/test rerun is needed for this documentary clarification.

Extra lossy stress checks: re-encode the actual square MP4 using libx264 CRF35 and45, then rerun the original pixel reader at48. Both retain120 frames, exact none/typewriter intervals and control0; fade changes to17–69 (error0.133333…s). Thus modest changes in compression can move this measured boundary, even though both extra cases pass. This is two additional encodes of one fixture, not all-color/all-codec robustness. The original actual outputs are the required30fps BT.709 limited-range path; RGB decode/reference subtraction tolerate its particular chroma/rounding artifacts. No general color-management claim follows.

## Detector/CLI adversarial controls

Own640×360/120-frame ffmpeg synthetic controls are in `controls.json`; the existing original tests also exercise a background switch at frame60. These are detector checks, distinct from the real Composition matrix.

| Probe | Actual | Verdict / consequence |
|---|---|---|
|Box frames11…45|detected[11,46), error0, control0|PASS exact detection|
|1-frame shifted box12…46|[12,47), error0.033s, control0|PASS, within limit|
|7-frame shifted box18…52|[18,53), error0.233s, control0|PASS negative-control behavior: score fails|
|No text/no object, uniform background|no detected frame, score false, control0|PASS missing-text failure|
|Near-background colored box|no detected frame, score false, control0|PASS below-threshold control; not a claim that faint text is visible|
|Unrelated white rectangle at the expected cue timing|[11,46), score true, control0 despite no letters|**FAIL as general text detection**; image-difference-only false positive|
|No text, different color only inside cue ROI|shown120 frames, control0, score false on boundary mismatch|Pixel false positives occur despite negative control0; score happens to reject this timing|
|Out-right/out-bottom ROI or empty reference|no argument rejection; silent0 counts on blank video|**FAIL input-validation expectation**|
|ROI x840,y164,w200,h30 in width640 frame|wraps into next rows, detects box11…45/peak6000|**FAIL spatial-validation expectation**; impossible rectangle still yields plausible boundaries (wrapped-roi.json)|
|Threshold−1 on blank video|shown120 frames, peak19200|**FAIL threshold sanity**, false positives|
|ThresholdNaN or256|no rejection; silently no detected frames|**FAIL threshold sanity**, false negatives|
|minPixels0 on all-zero counts|shown120 frames although peak0|**FAIL minimum sanity**, false positives|
|CLI missing value: `--out`|exit1, TypeError ERR_INVALID_ARG_TYPE before rendering|Fails closed, but no useful argument validation/usage|
|CLI unknown flag / `--out --keep`|not rejected; both reach scene-generation stage|**FAIL strict CLI validation**; see isolation note below|

The last CLI checks deliberately set FFMPEG_PATH to an owned nonexistent path, terminating at scene generation with ENOENT before extra render attempts. This proves malformed arguments pass parsing; it does not misrepresent the injected media failure as a product render failure. Temporary directories from these two failures remain preserved below E/runtime.

These exported helpers accept invalid inputs, but T127's fixed main path provides valid constant ROIs/thresholds/minimums. Consequently these findings **do not overturn the reproduced matrix PASS**. Before accepting arbitrary dimensions/ROIs/thresholds or using the tool for user-project measurements, validate finite positive dimensions, bounded nonempty integer rectangles, finite threshold in range, positive integer minimum, complete frame byte count and expected decoded-frame total; distinguish invalid inputs from “nothing visible.” The main script currently reports pass:false in JSON without setting a nonzero exit solely for a failed measurement (source inspection); automation must read report.pass, not treat exit0 alone as acceptance. No failed actual Composition run was manufactured to test that exit behavior.

## Acceptance, gaps and next entry conditions

1. Master may accept **only** the reproduced fixed synthetic-source matrix at48/40, with the quantitative boundary convention above. Incorporate R128-1 exact/rounded SRT distinction and R128-2 source hash correction in acceptance wording. Reviewer did not edit the author's report or shared status.
2. Do not turn this into universal human visibility, all animations, all fonts/colors/backgrounds/compression, natural footage, semantic voice sync, user-project measurement, complete P2-4 or P2 completion. In particular threshold96's fade result is a real criterion FAIL and must remain visible.
3. **VTT is not implemented/measured.** PLAN18's complete SRT/VTT requirement remains open for that part; a successful SRT test cannot close it. Actual-phone playback and meaning-level voice sync remain unperformed.
4. `lib/services/renders.ts` still types/returns `subtitleMeasure:null` and `phonePlayback:null`; `components/render-panel/render-panel.tsx` still displays “측정 전/확인 전.” T127 changed none of those files. No result was written to a user project and no measurement-complete UI flag is authorized by these results.
5. Invalid-input/false-positive findings are concrete limitations of reusing this controlled measurement helper, not evidence that the production subtitle timeline is wrong. Generalized reuse needs its own method/validation; no speculative product redesign or additional approval gate is introduced here.

Own process cleanup: original renderer reports descendantsLeft0 after each render; final CIM scan found **0 owned non-PowerShell processes** matching the evidence root, recorded in cleanup.json. File servers closed through the unchanged script, all foreground audit processes exited, and no own persistent web server was started. All MP4s, raw decoded frames, JSON, logs, failed-CLI work directories and reviewer scripts are preserved. Shared tools and other workers' processes were not stopped. The sole repository write is this report; integration/acceptance remains Master's responsibility.

복사용 전달 메시지: T128은 3ebf95c의 고정 3비율·4초·4자막 시험을 독립 실제 렌더 및 각120프레임 별도 검출로 재현해 임계값48/40 범위 PASS입니다. 최대 영상 오차5/30=0.166667초, SRT 실제 최대0.000333초(표시0.000)이며 임계값96 페이드는7/30=0.233333초 FAIL을 유지합니다. T127의 모든 비율 원본해시 동일 문장은 정정이 필요하고, 작성자는 fb5149a에서 첫 측정 전48/40 선택·첫 결과 후 민감도 추가를 명시했고 문서만 변경됐음을 확인했으나 당시 선택 이력은 독립 증명되지 않았습니다. 원CRLF 관련59/lint/typecheck 통과, T124/T126 전체빌드·백엔드 근거는 계승만 했습니다. 잘못된 ROI 행넘김·임계값/minimum/CLI 검증 부족과 무관한 물체 오검출은 고정시험 밖 재사용 한계로 기록했으며 VTT·사용자영상·휴대폰·의미싱크·측정null/UI미변경은 계속 미완료입니다. 고유 보고서만 작성했고 자기 프로세스0/증거 보존 완료이니 이 한정 범위와 보고 정정을 반영해 통합해 주세요.