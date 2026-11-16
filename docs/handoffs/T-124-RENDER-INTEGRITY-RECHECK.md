# T124 — Independent focused render integrity recheck

- Target: `c7f7774330d57b7476a9ca146ca3787337b04250` (T120). Reviewed 2026-11-17 KST by dispatched Codex, without implementation participation, subagents or helper workers.
- Read AGENTS, AI_TEAM_RULES, CLAUDE, PLAN, REVIEW, TEAM, applicable team roles, exact T116 F116-1–4, T120 and T113/F113-1 lifecycle evidence. Latest dispatch restricts all repository writes to this report.
- **Verdict: PASS for the four original T116 reproductions within their original boundaries; FAIL for an unconditional executed-bundle/attempt-input immutability claim under the additionally requested same-privilege Windows timing attacks.** F124-1 and F124-2 below remain. These findings require access to the owned attempt directory; neither demonstrates a public arbitrary-code/URL route or a remote exploit.
- No product, original tests, fixtures, shared documents, packages or installed root tools changed; no commit/push or actual-user data/DB access/migration. Master retains integration/acceptance responsibility.

## Isolation, original checks and evidence

Evidence root **E**:

`C:/Users/Administrator/AppData/Local/Temp/dream-t124-5b5158420632485eac3af1094165f2cd`

`E/app` is a byte-for-byte copy of every tracked target file, installed freshly with `npm.cmd ci`. Reviewer probe files were added only inside this disposable copy after original full tests/lint/type/build. `E/integrity.json` compares all **471 tracked files**, with **zero byte differences**, including after all original checks. Original CRLF counts are package.json **62**, package-lock.json **8036**, and the unchanged E2E test **182**. Lock SHA256 remains `7d619f2d366052f1ed28b02245292593fb32491f2920e40f9b038daba8c6b2fc`; Node is `v26.13.0`.

The existing `D:/starwork/dream-ai-studio/.tools/remotion-browser` was only read/executed through an E/app/.tools junction. ffmpeg was copied into an ordinary E directory for the build. Destructive browser tests used an ordinary independent copy at E/runtime/owned-browser, restored afterward. Do not recursively dispose of the evidence through its tools junction.

| Independently executed command in E/app | Result | Evidence under E |
|---|---|---|
| `npm.cmd ci` | PASS, 397 packages installed; 7 moderate audit notices and unapproved esbuild 0.28.1 postinstall warning retained; actual bundle execution works | ci.log |
| `npm.cmd test` | **551 passed / 13 skipped**, 48 passed test files plus one gated skipped file | test-final.log |
| `npm.cmd run lint` | PASS, zero warnings | lint-final.log |
| `npm.cmd run typecheck` | PASS | type-final.log |
| `npm.cmd run build` | PASS including verify-build; **37 NFT manifests** | build-final.log |
| `DREAM_RENDER_E2E=1`, `npm.cmd exec -- vitest run tests/p2-4-render-e2e.test.ts` | **9 passed / 0 skipped**, 435.44 seconds | e2e.log |

T120's author-reported **551+13 skips**, **9 E2Es** and own lifecycle/pixel evidence remain author evidence, separate from the independently executed counts above. Default 13 skips are the existing four fixture-generation paths and nine gated E2Es. No expectations or line endings were changed to obtain these results.

Reviewer probes and direct reproductions are preserved as E/app/t124-*.ts, E/app/t124-*.mjs and E/app/tests/t124-*.test.ts. Re-run commands are `node --conditions=react-server --import tsx t124-runtime.ts`, similarly t124-boundaries.ts, t124-parent.ts and t124-aspects.ts, and `node node_modules/vitest/vitest.mjs run tests/t124-fullworker.test.ts tests/t124-publication.test.ts` / `tests/t124-copy.test.ts`. These evidence scripts intentionally include adversarial mutations and use unique, owned temp data; preserve the current evidence before repeating scripts with fixed output names.

Setup corrections are not product failures: the first command's asynchronous ci was still running when early test/lint/type/build commands were issued, producing missing-CLI errors; all were rerun after ci and final exits were 0. A publication-test regex containing `|` was interpreted by npm.cmd's extra shell; direct `node node_modules/vitest/vitest.mjs ... -t 'ENOSPC|EACCES|ENOENT|EINVAL|EAGAIN|EBUSY'` corrected quoting. Final successful logs are explicitly named below.

## F116-1 original cache reproduction: PASS; F124-1 execution-copy gap: FAIL

Actual product child, unchanged composition source, pinned browser and two-frame black-background MP4s were used. The corruption changes executed `bundle.js` black styles to red; this is not an unused-chunk check. At the child `browser` stage the reviewer hashes every file in the attempt bundle against the worker's trusted closed manifest and records expected/actual digests. `E/runtime-results.json` is authoritative; runtime.log is the verbose equivalent.

| Actual attempt | Cache outcome | Decoded first RGB pixel |
|---|---|---|
| Initial build | built, no trusted build | [0,0,0] |
| Normal hit | hit | [0,0,0] |
| Cached executed chunk changed to red | rejected `changed: bundle.js`, rebuilt | [0,0,0] |
| Metadata marker added | rejected `file set differs`, rebuilt | [0,0,0] |
| index.html changed | rejected `changed: index.html`, rebuilt | [0,0,0] |
| index.html removed | rejected `file set differs`, rebuilt | [0,0,0] |
| Extra JS file | rejected `file set differs`, rebuilt | [0,0,0] |
| New-worker empty trust map plus old name-only folder | built, no trusted build; old folder removed | [0,0,0] |
| Cache changed to red after accepted copy | accepted attempt copy remains original | [0,0,0] |

The normal accepted copies match all trusted file hashes at the measured boundary. Disk cache/marker metadata is not used as a trust root, and changing the cache after copying no longer changes execution. Thus the original F116-1 cache-only attack is closed.

**F124-1: accepted attempt bundle can still change after verification, before execution.** At the same `browser` stage, after every copied file matched the accepted manifest, change **E/runtime/10/bundle/bundle.js** from black to red. The real child subsequently returns `{ok:true}` and the actual decoded MP4 pixel is **[253,0,0]** (`work-after-copy` in runtime-results.json). In that case a previous cache corruption causes a rebuild first; the rebuilt attempt's complete manifest also matches before the mutation. The outcome therefore covers fresh-build output as well as the post-copy timing gap, not acceptance of an already-corrupt disk cache.

Relevant code: render/bundle-cache.ts:43–53 authenticates during copying; render/child.ts:33–45 prepares the bundle, then lines 47–63 load/launch the browser and serve `start.workBundle` by pathname. There is no later execution-time binding of served bytes to the accepted manifest. The attack uses the parent onStage callback solely as a deterministic scheduler to write its own temp attempt file while the real child launches; it does not replace rendering, bundling, browser code or MP4 verification.

Scope: a same-privilege local writer that can alter the attempt directory can cause this. No normal app writer to that directory was identified. Cache immutability against changes to the original cache passes; a claim that *all actually executed bytes remain authenticated against an active writer of the attempt copy* does not. Require an explicit accepted trust boundary or a mechanism binding the bytes actually served/executed; another earlier pathname hash is insufficient for the stronger guarantee.

## F116-2 original full-worker reproduction: PASS; F124-2 same-privilege gap: FAIL

`E/app/tests/t124-fullworker.test.ts` extracts a fresh fixed s5 backup into E/fullworker/fake, migrates only this fake DB and uses the real request, claim, source/browser preflight, input copying, file server, child rendering, independent app ffprobe, publication and DB transitions. A real heartbeat protects each 900-frame claim. Only the timing wrapper around the actual runRenderAttempt introduces mutations. `worker-probes.log` reports **10 passed**: this one three-scenario full-worker diagnostic plus nine separate controlled worker tests.

| Actual 900-frame worker scenario | Served media SHA vs immutable input | Result |
|---|---|---|
| Original stored image overwritten with equal-size valid alternate PNG after preparation | equal | succeeded, correct accepted bytes |
| Attempt copy chmod'd writable and changed persistently to that alternate PNG | different | failed `RENDER_INPUT_CHANGED`, no publication |
| Attempt copy changed before real rendering and restored after real child completion, before verifyStaged | different | **succeeded, app verification passed, different pixels published** |

Input SHA is `831a7e1e7cec6be1268d408fdce74c5687ce67304027c393d0f0c0e75c7f9543`; replacement/served SHA in the two staged cases is `b162eb1252f0363536a541c94a35b90bb8622d1c691ded7cca3643dcc4ff944b`. Both images are the fixed fake fixture's same-size valid PNGs. Originals are restored in finally; inventory confirms all seven pre-existing stored files and the earlier successful MP4 stay unchanged. checkRenderRows passes and no worker render-* work directory remains. See fullworker-results.json and fullworker-pixels.json.

The third scenario is **F124-2**, a real wrong-input success under a same-privilege attempt-copy write/restore (ABA) attack. Decoding the first complete actual output frame confirms different content:

| Output | Center RGB at (540,960) | Entire decoded RGB frame SHA256 |
|---|---|---|
| Original-source overwrite, accepted bytes served | [88,168,88] | fb0ef108ac167420b7fb4d2d3d5bbd0246c560d88cf124c374c3c99a09b44473 |
| Attempt-copy ABA | [149,78,179] | 3e7a6f5db6602a219c68386531f0eda3da02ad641c9158f6a1d180c36daddb64 |

Relevant code: lib/jobs/render.ts:54–75 hashes the copied stream and applies 0444, file-server.ts:17–35 opens an fd then serves that fd, and jobs/render.ts:78–81/140 rehashes **the pathname** before ffprobe/publication. An open read handle does not freeze in-place writes on this Windows filesystem; 0444 can be changed by the same user. The end hash detects persistent changes, but cannot reconstruct the bytes read earlier or detect restored bytes.

There is also a separately reproduced retained-inode/path mismatch for **both media and fonts**: place BBBB at the staged pathname before startFileServer opens it, retain the opened fd, rename BBBB aside and restore original AAAA at the pathname. GET returns BBBB while real verifyStaged on the same StagedFile returns success for AAAA. `boundary-results.json` records served SHA `4a8d8134f29b0b7b60c126f5532bc9f5d9bb73037373cf6fb872d81f1dcefdfd`, accepted/restored SHA `63c1dd951ffedf6f7fd968ad4efa39b8ed584f162f46e715114ee184f8de9201`. This minimal server/validator test uses arbitrary bytes and is **not** claimed as another full font/video render.

Passing complementary coverage:

- Original author tests rerun independently exercise staged inputs despite original equal-size overwrite/delete, retained-fd rename-over/delete and Range reads. They explicitly do not assert that an in-place write to the opened file preserves its bytes.
- Reviewer copy-race test uses real copy streams with controlled pre-open mutation or mutation after the first stream data event. **Media and font × both timings = four rejected copies, RENDER_INPUT_CHANGED**; copy.log and copy-race-results.json. Font perturbations touch only E/app/public/fonts and are removed.
- Persistent staged tampering, including the real full-worker case above, rejects before publication. This is stronger than an existence/size recheck, but is still not an immutable snapshot against an active same-user writer.

Original storage mutations can no longer reach the attempt snapshot, closing the exact original F116-2 path. Stronger same-privilege execution-input immutability remains false. Master must retain this boundary honestly or require binding/verification of the actual served object/bytes; adding another pathname hash alone does not fix ABA/handle identity.

## F116-3 publication cause and bounded retry: PASS

In addition to the independently rerun author tests, `tests/t124-publication-real.test.ts` reuses the **actually rendered successful 900-frame MP4 above** at the attempt output. Browser/source checks, re-copying inputs, real app ffprobe, output hashing, final publication and DB/job transitions are real; only recomposition is substituted with copying this verified MP4, and the exact final link call receives a controlled errno. No disk was actually filled and no OS ACL was changed.

Final direct-Node commands and results: publication-real-final.log **8 passed / 3 intentionally filtered**, then publication-preservation.log **8 passed / 3 intentionally filtered**, the latter adds explicit file/timeline/SQLite preservation assertions. Each single-fault case reaches the injected link (otherwise the required I/O activity entry and state assertions cannot pass).

| Injected link errno | Attempt 1 job/render result | Automatic retry |
|---|---|---|
| ENOSPC | failed / DISK_FULL | none |
| EACCES | failed / STORAGE_FAILED | none |
| ENOENT | failed / STORAGE_FAILED | none |
| EINVAL | failed / STORAGE_FAILED | none |
| EBUSY | queued / STORAGE_FAILED | bounded |
| EAGAIN | queued / STORAGE_FAILED | bounded |

Both transient causes were exercised through actual claim/worker-fail transitions at attempts **1, 2, 3**: queued → queued → failed; nextRunAt is null after attempt 3. errno is retained in render.io_error, no target MP4 appears, and render work folders are removed. retry-EBUSY.json and retry-EAGAIN.json contain the histories. publication-preservation.json records all eight cases preserving the seven pre-existing stored files, **all pre-existing timeline_revisions including r1**, and SQLite integrity_check=`ok`. Schema/semantic row validation also passes. Earlier-success preservation is additionally exercised in fullworker-results.json and unchanged E2Es.

## F116-4 normalized connects and owned sources: PASS within application boundary

The unchanged original tests execute their own non-loopback Node HTTP/TCP guard tests. Reviewer t124-boundaries.ts independently adds actual net.connect(options), createConnection(port,host), Socket.connect(options), the normalized array overload, **localhost DNS returning this machine's LAN address**, and **undefined-host DNS returning that LAN address**. All six are refused with RENDER_NETWORK_REFUSED; explicit loopback and normal undefined-host localhost connections succeed. The listener sees exactly the two intended loopback TCP connections. No external endpoint is contacted.

The actual child repeats the original OffthreadVideo attack with this machine's owned non-loopback address **100.84.98.85**. A dedicated HTTP listener counts requests. Non-loopback video, non-loopback font, non-loopback base, query/redirect-shaped URL, userinfo and encoded path are each rejected with RENDER_FAILED / RENDER_NETWORK_REFUSED **before bundle/browser stage**; **HTTP requests = 0**. Thus the original native fetch never reaches its owned server. See runtime-results.json, boundary-results.json and runtime.log.

Trusted binding was traced rather than inferred from origin syntax: render request schema is strict revision+timelineId only (lib/services/renders.ts:23/101); the server builds saved media/font descriptors, and runClaimedRender obtains a fresh startFileServer base, constructs props through renderProps from that saved input and passes the same base to its newly forked child (jobs/render.ts:123–127, run.ts:74–77). The IPC channel is that fork's parent channel. There is no discovered request field/route for caller-supplied base/source props. Child exact prefix/token/kind/index syntax plus the real server's finite index lists constrain access; unknown indices remain local 404s and the server does not redirect.

The child **does not independently authenticate a job ID/input SHA or server ownership from an untrusted parent**. Calling runRenderAttempt directly with a forged matching loopback base/props would satisfy the syntactic predicate. Within current code the parent supplies those values from its exact active attempt, so this is a trusted-parent boundary, not an origin-alone authentication claim. Same-privilege compromise of that parent/IPC is not contained. The Node monkeypatch and Chrome flags are **not an OS firewall** and do not universally govern native networking, other transports or Windows remote named pipes. No broader claim is made.

## Actual aspects, lifecycle, trace and inherited data scope

The unchanged nine real E2Es passed normal full request→claim→child→app ffprobe→publication→download, 9:16/16:9/1:1, text-only new result/stale snapshot, input change, controlled verification failure, late cancel retention/404/inventory, real cancellation, child crash/retry, expired lease recovery through attempt 3, previous output preservation and process/temp cleanup.

Reviewer additional two-frame aspect renders use a newly generated own PNG and **real Pretendard FontFace loading** through the owned file server. All pass real app verification: H264, yuv420p, tv/bt709, 30/1 fps, one video stream, audio0/other0, full aspect dimensions, no surviving sampled descendants. aspects-results.json and each aspects/*/netlog.json are retained.

| Aspect | Dimensions | MP4 SHA256 |
|---|---|---|
| 9:16 | 1080×1920 | b859857973add75d35f0156ebe3c7de23075fe6477f02c2817c0e942a27468b9 |
| 16:9 | 1920×1080 | b6c18dfb07fd989f98ef89144174f7691174963c39a5caa67cf73fa698b2ba2a |
| 1:1 | 1080×1080 | 23c3539d0ae53e787b9481462f1a6b6fbb5ec5e3a0a69f6deca5938240b9f8a9 |

Each Chrome NetLog has seven URL_REQUEST_START_JOB URLs, all loopback; TCP records with endpoints are loopback and UDP_BYTES_SENT events are zero. These are bounded Chrome observations; they do not measure every native packet, DNS/transport event or all future inputs. They are not firewall proof, subtitle timing measurement, audio verification or phone playback evidence.

Additional actual lifecycle checks pass: missing own browser after successful hash preflight → RENDER_BROWSER_MISSING; invalid own executable → same; executable restored byte-identically; graceful cancellation → RENDER_CANCELED; 1ms-grace cancellation → tree-kill fallback; actual render-child kill → RENDER_BROWSER_CRASHED; nonexistent composition → RENDER_FAILED. Every sampled post-exit descendant list is empty. parent-lifecycle-results.json additionally records **actual IPC disconnect** and **killing only the real wrapper parent**, with child/browser/compositor alive lists empty after 6.5 seconds. No unrelated processes were killed.

Direct runRenderAttempt leaves folder cleanup to its caller: reviewer retained MP4s/bundles as evidence, recorded owned os-tmp contents in caller-cleanup.json and then removed those own os-tmp directories; crash/cancel can leave fragments until caller cleanup. The two parent-lifecycle attempt directories were removed by their caller. Product full-worker/E2E paths remove their work directories. Final runtime server-handle count is zero, all owned listeners are closed, all command sessions exited, and final process command-line inventory found no E-specific runtime process. Process-table sampling cannot prove every platform/PID-query race absent.

Production build passes the existing private/render trace checker across 37 NFT manifests: no renderer/bundler/browser/worker render source or local runtime data traced into the Next server. The separately launched worker still has source render/child.ts, entry/composition/dependencies and public/fonts available in the source deployment; actual child/font renders above demonstrate this in E. No claim that the Next standalone trace alone is a complete worker deployment is made.

`git diff 3893e32 c7f7774 -- migrations tests/fixtures lib/backup lib/db` is empty. Therefore issued SQL, fixed backup fixtures, semantic migration/restore and broad actual backup/restore preservation are **explicitly inherited from T116/T110/T112**, not freshly rerun actual backup creation/restore here. Fresh whole-suite checks plus preservation probes corroborate the unchanged scope. No actual-user data was touched. UI/design, real-device playback and subtitleMeasure remain outside this review.

## Master action and delivery

Accept original-reproduction closure only within the documented trust boundary. Before asserting stronger immutability, address F124-1 executed attempt-bundle mutation and F124-2 same-user staged-input ABA/handle-path identity, or explicitly decide/record that an active same-privilege writer of private attempt directories is outside the product guarantee. This review does not silently weaken that guarantee or claim OS-level isolation. No product edits are proposed or performed by this worker.

This report is prepared in the sole authorized repository path. Orca worker_done delivery is separate from Master reading/integrating it; no shared status document was changed.

### Copy-ready message to planner / Master

T124 independent recheck of c7f7774 completed: fresh original-CRLF ci, independent 551+13skip, lint/type/build and nine actual E2Es pass, and all four exact original T116 reproductions are closed within their original boundaries. Stronger same-privilege integrity remains FAIL: changing a verified attempt bundle before browser execution renders red [253,0,0], and a real 900-frame worker with staged-input write/restore publishes succeeded with changed center pixels [88,168,88]→[149,78,179]; separate media/font retained-handle/path restoration also defeats pathname revalidation. Please integrate scoped PASS results for cache/input-source protection, permanent-vs-transient publication with bounded retries, exact owned-source rejection and lifecycle cleanup, retain F124-1/F124-2 and network/worker-deployment/inherited-backup limits, and decide or correct the active local-writer boundary before an unconditional integrity acceptance.
