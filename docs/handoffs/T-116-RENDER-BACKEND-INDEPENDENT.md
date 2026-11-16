# T-116 — Independent actual render backend review

- Reviewer: dispatched Codex independent reviewer, no implementation participation, subagents, or helper workers.
- Target: `3893e3233b7c2c0c8962e26a6164183085151fb8` (`3893e32`); initial working tree clean.
- Date: 2026-11-17 KST. Read AGENTS, AI_TEAM_RULES, CLAUDE, PLAN, REVIEW, TEAM, role instructions, T114, T113/F113-1, T101, T102 and T106.
- **Verdict: FAIL for backend acceptance: F116-1 through F116-4 require correction.** Normal output, the nine actual E2E cases, and the tested child containment paths pass. Those passes do not establish immutable rendered inputs, authenticated cache reuse, or comprehensive loopback egress containment.
- Only repository write is this report. No product, tests, fixtures, shared documents, packages, commits, pushes, actual user data, or user database migrations were changed. UI is intentionally outside this assignment; its absence is not a defect.

## 1. Isolation and reproducible evidence

Evidence root **E**:

`C:/Users/Administrator/AppData/Local/Temp/dream-t116-18ae4644b60343ee86249ad4b581fe16`

E contains the original-source runtime and logs; `E/independent-app` contains a second source copy and reviewer-authored probes; `E/evidence` contains fake databases, output MP4s, NetLogs, JSON results and an owned browser copy. All additions and mutations for these probes are under E. Existing tools were read/executed from `D:/starwork/dream-ai-studio/.tools`; the root browser was never renamed or overwritten. Own `.tools` junctions point to that browser; ffmpeg was copied into an ordinary E directory for the build. Do not recursively delete through these junctions during later evidence disposal.

The committed lock was installed with `npm.cmd ci`, exit 0, using Node v26.13.0. No dependency updates or script approvals were performed. npm reported the unapproved esbuild@0.28.1 postinstall; actual bundling subsequently worked. Package/lock/E2E-test copies are byte-identical to the working checkout, with 62/8036/182 CRLF delimiters respectively (`integrity-build.json`). No line-ending normalization was used to make tests pass.

| Independent command, original source in E | Result | Evidence |
|---|---|---|
| `npm.cmd ci` | PASS, exit 0 | `install.log` |
| `npm.cmd test` | **523 passed, 13 skipped**, 46 files; exit 0 | `full-test-final.log` |
| `npm.cmd run lint` | PASS, zero warnings | `lint-final.log` |
| `npm.cmd run typecheck` | PASS | `type-final.log` |
| `npm.cmd run build` | PASS, including verify-build | `build-regular-tools.log` |
| `$env:DREAM_RENDER_E2E='1'; npm.cmd exec -- vitest run tests/p2-4-render-e2e.test.ts` | **9 actual tests passed, 0 skipped**, 417.31 seconds | `e2e.log` |

T114's author-reported **523 + 13 skips** and **9 actual E2E** are separate evidence, not the counts above. The independent default suite's 13 skips are the existing four fixture-generation skips plus the nine explicitly gated render E2Es; the separate enabled run executes all nine.

Harness corrections are retained, not hidden as product defects: an initial broad robocopy exclusion also omitted nested `lib/storage` and backup fixture directories, causing missing-module failures. Copying every tracked file byte-for-byte corrected that setup. The first build with an ffmpeg junction hit Turbopack's outside-root symlink restriction; copying those binaries into E corrected it. An initial `fs` default-object spy did not intercept named imports; the publication probe was replaced with a named-module mock and explicit fault-hit counts. The fake s5 backup-directory setting initially referenced its historical `C:/dream-s4` location; backup rejected the unavailable parent before publication, and the final probe configured an E-only directory through the product service. A repeated pixel probe hit its own pre-existing output until unique evidence names were used. Final results below distinguish these harness issues from reproduced backend defects.

## 2. Required fixes

### F116-1 — A source-key cache can render changed code under the unchanged input source hash

**FAIL, required integrity correction.** `render/child.ts:53` reuses a bundle whenever `index.html` exists. It neither reads/compares `render-source.json` nor verifies the bundle bytes; the marker written at line 58 has no enforcement on reuse. A matching directory name is not authentication of its contents.

Independent actual reproduction (`tests/t116-publication.test.ts`, case `source key cache tamper changes actual rendered pixels`):

1. Build the real application composition under source key `b75f8d38e80488d9d68f76805bd8994225a50face5c4c1e2bb3d2d02bc0a4d34`.
2. In this owned cache only, change `bundle.js`'s composition root background from `#000000` to `#ff0000`, and set the marker's sourceSha256 to 64 zeroes. Leave every source file and the requested source key unchanged.
3. Call the real `runRenderAttempt`, pinned browser, actual composition, two frames, with no media/text obscuring the background.
4. Child returns `{ok:true}`. Decode the actual MP4 through the independent app ffmpeg: first RGB pixel **[253, 0, 0]**, confirming changed executed rendering rather than merely an unused edited chunk. Source hash before and after is the same key above.

Evidence: `publication-final.log`, `evidence/publication-results.json` (`cache-wrong-pixels`), `tampered-red-*.mp4`; output SHA256 `30dcb33dd25802652a09df617c1add826797e7b956238ff48ee6e9f952214253`. The probe restores the cached code and marker afterward. The earlier metadata/unused-chunk probe is narrower and is not substituted for this pixel proof.

Required: validate cache identity and contents against a trusted build manifest or rebuild into an owned verified directory when validation fails; do not trust only a caller-writable directory name or marker. Recheck altered metadata, altered executed code, missing files, and normal cache hits. This is an actual changed-cache integrity failure, not a claim that a public API currently accepts arbitrary source code.

### F116-2 — Fresh input hashing does not freeze the bytes served during rendering

**FAIL, required immutable-input correction.** `lib/jobs/render.ts:36` freshly hashes media/fonts, then passes original mutable paths to the server. `lib/render/file-server.ts:22` checks only size; line 29 opens the pathname later. Neither equal-size changes after recheck nor the stat/open race are detected.

Independent full-worker actual reproduction (`tests/t116-input-race.test.ts`):

1. Request a real render from the fake s5-derived project, claim it, and allow product `recheckInput` to finish successfully.
2. At the following file-server boundary, overwrite the first selected image with another valid PNG from the same fake fixture. Both files are 94 bytes; original SHA equals the saved input's media SHA, replacement SHA differs. This hook changes only the timing of an ordinary file overwrite; rendering, server reads, browser, ffprobe, and publish are real.
3. Run actual `runClaimedRender` for 900 frames, renewing its real lease while it runs.
4. The row becomes **succeeded**, ffprobe **passed**, and an MP4 is published while its immutable input still names the original image SHA. Original source image bytes are restored in `finally`.

Evidence: `actual-input-race.log` (**1 diagnostic passed**, 60.23s), `evidence/actual-input-race-results.json` records both different input/served hashes and the successful verification. The result demonstrates a wrong-input success; container verification cannot authenticate source pixels.

Separate minimal probes: server created for `AAAA`, equal-size overwrite `BBBB`, GET returns 200/`BBBB`; a named `createReadStream` boundary overwrite between stat and open returns 200/`CCCC` (`publication-results.json`, `stat-open`). Thus reopening the same pathname is not a retained snapshot. Token/index traversal checks still pass; this finding concerns the contents behind an authorized index.

Required: create verified per-attempt input copies or an equivalent stable read mechanism for media and fonts, serve only the accepted bytes, and reject inconsistent copies before publication. Checking existence/size/hash again before later opening the same mutable path is not a complete race fix. Recheck equal-size replacements, stat/open swaps, deletion, missing fonts, and preservation of earlier successful outputs.

### F116-3 — Publication reclassifies permanent storage failures as retryable

**FAIL, required retry-policy correction.** `lib/jobs/render.ts:119` converts every non-EEXIST link error into `RenderFailure("STORAGE_FAILED", ..., true)`. This intercepts ENOSPC before the outer DISK_FULL mapping and also retries permanent permission/path failures. It violates T106's unchanged-capacity/permission policy.

Independent controlled-fault reproduction (`tests/t116-publication.test.ts`): copy an already actually rendered, app-verified 900-frame output into the attempt's output location, then execute real product verification, hashing, publication and job transitions. Only recomposition is replaced in these publication-specific fault tests. Inject a named `linkSync` error at the exact final MP4 target; each case records **one actual injection hit**.

| Link cause | Actual job/render outcome, attempt 1 | Required |
|---|---|---|
| ENOSPC | queued / STORAGE_FAILED / next_run_at set | terminal DISK_FULL; no automatic unchanged-capacity retry |
| EACCES | queued / STORAGE_FAILED / next_run_at set | terminal permanent storage failure |
| EBUSY | queued / STORAGE_FAILED / next_run_at set | bounded transient retry is appropriate |

No file was published in these three cases. Evidence: `publication-final.log` (**4 diagnostic cases passed**, meaning the observations reproduced), `publication-results.json` (`publish-*`). This is not a claim that an actual disk was filled or Windows ACLs were changed. Required: preserve the original cause at publication and use the same transient-only classification as other worker I/O, including ENOSPC, EACCES, invalid-path and EBUSY/EAGAIN rechecks.

### F116-4 — Node guard bypass and native video fetch contradict unconditional loopback containment

**FAIL for the claimed containment boundary; required hardening before claiming R-13 for untrusted URLs.** `render/child.ts:29` interprets an array-normalized `Socket.connect` call as an options object without a host, then permits undefined host. Native compositor networking is not governed by this JavaScript patch or Chrome proxy flags.

Two independently executed probes use only an **owned server on this machine's non-loopback interface**, `100.84.98.85`; no remote account, public endpoint, or user service was contacted:

1. Import the exact child guard in a disposable Node process; open an own TCP listener. `new net.Socket().connect({host,port})` is correctly rejected with RENDER_NETWORK_REFUSED, but standard `net.connect({host,port})` succeeds and receives `owned T116 server`. Evidence `node-guard.log`, `node-guard.json`, `independent-app/guard-probe.mjs`.
2. Feed an own-host HTTP URL for the fake historical video to actual `OffthreadVideo` props, render two real frames with the unchanged child and Chrome restrictions. The own server receives GET `/owned-video.mp4` from that non-loopback interface, and the render returns `{ok:true}`. Evidence `native-egress.log`, `native-egress-results.json`, `native-egress.mp4`. Chrome NetLog shows only its loopback composition connections, illustrating why browser-only observation misses the native fetch.

Normal product `renderProps` constructs tokenized loopback URLs; this probe does **not** show that the public request API accepts arbitrary URLs. It does show the stated process-level guard is bypassable and that untrusted video sources reaching the child are not contained. Required: correctly handle normalized Node connect overloads, validate child source/font URLs against the specific owned file-server origin, and constrain native fetches as well. A JavaScript monkeypatch is not an OS egress firewall. Recheck own non-loopback HTTP sources, redirects, Node connection overloads and native video paths; do not infer comprehensive isolation from normal-path Chrome logs.

## 3. Passing runtime scope

The unchanged nine enabled E2Es independently passed the request → worker → owned Remotion child → application ffprobe → publish → file route path. They verify 9:16 900-frame success and other stored bytes, full/Range downloads, post-request timeline edit with old snapshot rendering/stale display, text-only next request and different name, changed-media failure without retry, 16:9 and 1:1 success, forced verification failure/no publish/404, late cancel retained/not served/in inventory, real running cancellation, child kill/retry, expired-lease recovery through attempt 3, old output preservation, and temp/process cleanup. Their verify-failure and late-cancel timing are deliberate test injection points, not spontaneous production failures.

Additional reviewer probes, rather than only repeating those tests:

- Concurrent promises and a second SQLite handle return one active render and the same IDs; one real claim blocks another handle's claim under the global lease. Changing project revision during the awaited preflight causes the second CAS check to return CONFLICT with no inserted render. Queued cancel terminates immediately. The original full suite also covers active-project rejection, idempotency keys, bounded retries/recovery/exhaustion, running-cancel flags and manual-render-retry rejection.
- Fresh recheck rejects equal-size media mutation despite restored mtime, changed font bytes, and changed composition source as RENDER_INPUT_CHANGED; deleted media/font return RENDER_INPUT_MISSING/FONT_MISSING. These passes are explicitly **before-recheck** coverage and do not override F116-2. Initial blockers include empty/missing selections, stale clips, missing fonts/browser, bad snapshot/request structure and insufficient disk space in the original suite.
- `renderInputSchema` structurally accepts `media:[]` despite timeline references; `renderProps` subsequently rejects unknown/empty clips. This is a semantic-validation hardening gap, not evidence that a normal request can enqueue that invalid snapshot. Snapshot JSON/hash and immutable DB binding guards remain covered by the original suite. No forged-user-DB acceptance claim is made.
- Own file-server token, allowlisted indices, GET/HEAD restriction, malformed/traversal/encoded separator paths, Range and close behavior pass in the original units; extra query/Range/path probes also pass. They do not authenticate mutable contents.
- Actual file-route extra probe: full bytes hash equals DB; HEAD body empty; Range 206 exact slice, unsatisfiable 416; missing file 503 STORAGE_FAILED; wrong size 409 STORAGE_FAILED; late result 404. Deleting the path at stream-open yields a 200 header response whose body rejects ENOENT, without a process crash; this is a streaming error, not a successful completed download. Original file bytes restored and hash equal afterward (`download.log`, `download-results.json`). Same-size post-publication tampering is not authenticated by the size-only download contract.
- Actual no-replace publication probe precreates a different-byte sentinel at the exact target: render fails, sentinel SHA remains `b19e35c6e6de7266fd992086159e4838c8496b92b01923e8b2ba6300f7164b06`, and the older successful MP4 SHA is unchanged.
- Real backup creation and real restore inspect/finish preserve newly recorded successful and canceled_late rows and their MP4 SHA values. Final manifest contains 14 files; source ZIP unchanged, old output unchanged, restored `checkRenderRows` passes (`publication-results.json`, `backup-restore`). These publication/backup-specific rows reuse an actually rendered verified output to isolate publication state; the separate unchanged E2Es exercise fresh actual successful/late rendering.

## 4. F113-1 containment recheck

**PASS for the executed Windows paths.** Own browser folder is an ordinary copy under `E/evidence/owned-browser`, with exe SHA verified equal to the pin before perturbation. Missing-after-preflight and invalid-executable changes touch only this copy and are restored afterward. Child opens/retains its browser before selectComposition, and its Remotion servers live inside the bounded child.

| Independent actual case | Outcome | Cleanup evidence |
|---|---|---|
| Warm actual composition | success | no descendants after exit |
| Hash-preflight success, then rename exe before launch | RENDER_BROWSER_MISSING | no descendants; targeted parent TCP Server handles 0→0; 5.395s in final instrumented run |
| Replace own exe with non-executable bytes | RENDER_BROWSER_MISSING | no descendants; parent TCP Server handles 0→0; 2.650s |
| Cancel at actual compose | RENDER_CANCELED | no descendants |
| Cancel with 1ms grace | RENDER_CANCELED, tree-kill fallback | no descendants |
| Kill only actual render child | RENDER_BROWSER_CRASHED | no surviving owned browser/compositor descendants |
| Real nonexistent composition selection | RENDER_FAILED | no descendants |
| Disconnect IPC at real compose | child and all sampled owned descendants exit | alive [], 8.09s including deliberate 6.5s observation wait |
| Kill real wrapper parent only, not its tree | render child and descendants exit | alive [], 8.59s including observation wait |

Evidence: `lifecycle.log` (4 passed), `lifecycle-full-results.json`; extra parent-Server-handle instrumentation `launch-TCP-final.log` (1 targeted passed, 3 intentionally filtered), `lifecycle-results.json`. Own attempt work folders are removed by the harness after recording contents, as the direct runRenderAttempt API delegates folder removal to its caller. Product worker cleanup is exercised separately by the actual E2Es and full-worker input-race probe. PID/creation-time descendant sampling is not proof against every process-table query failure, PID reuse or unsupported platform.

## 5. Additional actual three-aspect outputs and network evidence

Reviewer-created props use a newly generated PNG, the fixed historical video as **input only**, three Korean text layers with fade/pop animation, and the real pinned Pretendard FontFace path. Each render has 60 frames, 2 seconds, 30/1 frame rates, video stream 1, H264, yuv420p, tv range, bt709, audio 0 and other streams 0; all app ffprobe items pass (`independent-results.json`).

| Aspect | Pixels | MP4 SHA256 |
|---|---|---|
| 9:16 | 1080×1920 | `f67f7f90114efa94c3389e41dd72eafd621d7eb039a956828c97ddf1a5d3adda` |
| 16:9 | 1920×1080 | `cd96cf98b5119b1b2b69c26d1dfe14b0859884fce2ef5edf1179fc6a64d81bfe` |
| 1:1 | 1080×1080 | `ceab6cc5cb4f64b222d459ded49aa67e84d18f7dc0e840e4425dd32e75c956de` |

The JSON is authoritative for output hashes; the E2E outputs independently cover actual product publication at all three full aspect sizes. No subtitle start/end pixel-detection experiment was performed: **subtitleMeasure remains unverified/null**, and animation-enabled rendering is not a subtitle timing measurement. Phone playback, UI, actual devices and accessibility are outside this backend review.

Actual Chrome NetLogs were independently parsed; `netlog-summary.json` records 14,283 / 14,279 / 14,303 events for 9:16 / 16:9 / 1:1, respectively, with **37 URL start jobs each, all loopback**, and four TCP connection-start records each, all loopback. Resolver metadata is present; do not describe this as no resolver events. Each has an IPv6 UDP reachability connect to `[2001:4860:4860::8888]:443`, ending -109 ADDRESS_UNREACHABLE. No general DNS/UDP/packet capture guarantee follows from these logs.

An injected `Img` documentation-address URL fails; Chrome NetLog records three attempted external URL jobs but TCP attempts go to the closed 127.0.0.1:9 proxy and fail, rather than contacting the source. Native video succeeds to the owned non-loopback source in F116-4 while its Chrome log still looks loopback-only. **No independent CDP Network session was attached**; NetLog is the actual browser evidence, and it does not cover all native/Node transports. Final TCP sampling and the Node guard cannot substitute for an exhaustive egress audit.

## 6. Build, historical contracts, cleanup, and next gate

- PASS: independently inspected **36 actual .nft.json** traces; no root `render/`, renderer, bundler, compositor, browser, `.tools`, `.remotion` or render-bundle contents. Shared `lib/render` request/worker helpers are allowed and are not confused with the separate root `render/` composition source directory. `verify-build` also passed.
- PASS: actual worker bundle sourcemaps contain `render/entry.tsx`, `render/render-composition.tsx`, `components/player/composition-core.tsx`, and `lib/edit/text-ops.ts`; actual font file-server requests succeed and FontFace-backed renders finish. Fonts are served from pinned input files, not embedded into Next traces (`worker-bundle-sources.json`, actual render request records).
- PASS preservation: `integrity-build.json` records all seven issued SQL migrations and s4–s7 ZIP/JSON/MP4 protected files, 17 files in total. Committed target blobs equal pre-backend `2f12b9b` blobs, and review-copy bytes equal this working checkout. CRLF working bytes are not incorrectly compared to Git's normalized LF blob as a byte-preservation failure. Original full-suite r1/P1 bundle/SRT compatibility and ZIP verification/non-overwrite tests pass, including the fixed export-r4 ZIP. No old fixture was renamed.
- `tests/fixtures/backups/s6-inputs/render-passed.mp4` remains a **historical foundation fixture**, not proof that the current renderer produced a passing result. Its missing color tags correctly fail current colorRange/colorSpace verification in the original unit test. Current actual outputs and their own ffprobe evidence are separate.
- Final cleanup evidence `cleanup.json`: no own Node/browser/compositor process, no own TCP connection/listener, no fake-runtime render attempt folder, and no lifecycle work folder remains. Root browser executable SHA is still `40fcceffa39380a1188ead560d9dea125d1075284ad56448be0c1282e4f652a7`. Evidence files, databases, MP4s, logs, copied browser and bundle caches remain intentionally preserved under E; those are evidence, not running work resources. Later input-race and launch probes also settle and remove their attempt folders.
- No exhaustive fault matrix for Windows process-table failures, filesystem reparse-point attacks, all redirect/URL protocols, or native transports was performed. Source-hash parsing is a static import walk, not an authenticated dependency graph of arbitrary dynamic code. Do not extend these observations into full security or P2 completion claims.

Next entry condition: implementation owner fixes F116-1/2/3/4 with bounded code changes and returns precise repro results. Independent recheck must show altered cache rejected/rebuilt, equal-size post-recheck source replacement cannot become wrong-input success, permanent publication failures do not retry, and Node/native untrusted sources cannot escape the owned origin. Preserve the passing F113-1 lifecycle and historical contracts. Master integration/acceptance is separate from this report and its delivery receipt.

### Copy-ready message to Master / Claude design

T116 independent review of 3893e32 is complete: fresh exact-lock install, original-CRLF 523 passed/13 skipped, lint/type/build, nine actual E2Es, additional real three-aspect renders, F113-1 owned-child launch/cancel/crash/disconnect/parent-death cleanup, and real output backup/restore checks passed within the report's stated scope. Backend acceptance remains FAIL: F116-1 executes altered cached code under the same source key (actual red-pixel proof), F116-2 publishes a real 900-frame render after a different same-size PNG replaces the freshly checked input, F116-3 retries publication ENOSPC/EACCES as STORAGE_FAILED, and F116-4 permits standard Node connect/native video access to an own non-loopback source despite the claimed guard. Please assign these four fixes and retain the NetLog/CDP/native-network and unmeasured-subtitle limits; no UI defect, user-data migration, whole-P2 approval or remote transmission is implied.
