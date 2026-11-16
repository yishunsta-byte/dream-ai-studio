# T104 — bounded independent recovery/layout recheck

- Reviewer: dispatched Codex worker, task `task_8faf41ad7e86`, dispatch `ctx_f6c7dfa9b086`; no participation in T103 implementation and no helper workers.
- Target / start / end HEAD: `aa7aae0adf21d1f0e205569a5a1a2497119a935e`.
- Verdict: **PASS within the assigned T103 follow-up scope.** T100's 1280 overflow observation is resolved at the stale ruler-measurement boundary. No new mandatory defect found. This is an independent review, not the author's self-review, and is not full P2 or deployment acceptance.
- Repository output: this report only; no product/test/fixture/shared-document edit, commit or push. Master owns shared status updates.
- Read: AGENTS, AI_TEAM_RULES, CLAUDE, PLAN/REVIEW/TEAM, both docs/team role guides, T100 (especially section 6), T103, and installed Next 16.4.6 output tracing guide. Applied orchestration and ego-browser skills.

## Isolation and commands

Preserved evidence root:

```text
C:/Users/Administrator/AppData/Local/Temp/t104-review-639b857915d746ac82ee3ee743ed96fc/
```

Copied tracked child-checkout files into a new `app/` using byte reads/writes, installed its own dependencies with `npm.cmd ci`, and extracted the fixed s4 fixture through the product archive verifier into new `app/runtime2/`. Applied product migrations and populated only the fake project's menu snapshot. Read the earlier T100 setup/helper scripts and adapted them into new scripts under this evidence root; did not reuse its runtime, DB, browser or results. No root user data, storage, backups, `.env.local`, installed dependencies or existing server used.

Runtime: own `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3114`, cwd `<root>/app`, `DREAM_DATA_ROOT=<root>/app/runtime2`; ego-browser TaskSpace **96**, own p1/p2 only. Project `019b8b74-3f10-7137-8265-68b11d809f0c` is fixture data. `setup.log` reports **180 CRLF TS/TSX files, zero LF-only files**. Production copied source was not instrumented.

| Independent execution in new temp copy | Result / evidence |
|---|---|
| `npm.cmd ci` | PASS, `install.log` |
| `npm.cmd test -- tests/p2-3b-timeline.test.ts` | **19 passed / 1 file**, `tests.log` |
| `npm.cmd run lint` | PASS, max-warnings 0, `lint.log` |
| `npm.cmd run typecheck` | PASS, Next typegen + tsc, `typecheck.log` |
| `npm.cmd run build` | PASS, production build + verify-build, `build.log`; run to enable actual production browser checks |
| `python <root>/verify.py` | All 19 assertions PASS, `validation.json` |
| `node <root>/preserve.cjs` | Original r1 rows and seven storage/ZIP hashes PASS, `preservation.json` |

## Diff boundary and inherited evidence

Inspected the product diff from T100 `df094f9` to target. It is the T103 ruler `overflow:clip`, recovery textarea margin, region name, copy failure status/focus/select, download-start wording, own-saved-version explanation and `ownSave.timelineRevision` addition. Existing exact revision+pointer ownership predicates, DB/API/schema/migrations, text editor/timeline behavior and save lifecycle logic are unchanged. Recovery JSON still serializes the complete input; the new own-save field is additive, not a data reduction.

Explicitly inherit **T100's independent original-CRLF 467 passed / 2 skips, full-suite/lint/typecheck/build, original dual-writer CAS/external-field preservation, complete style/box/animation/order/raw-input recovery, lifecycle/actual31.5s/StrictMode/CDP and original-byte broad PASS**, with its stated limits. T100's inherited earlier export/font/API evidence remains evidence from those earlier versions. This review reruns the focused 19 tests and checks above; it does not claim a fresh 468-test full suite or repeat the 31-second/API matrix. The author's T103 468-test result remains self-verification.

## Actual dual-writer recovery and complete bytes

`browser1~4.mjs`, `before.json`, `after.json`, `fallback.json`, `validation.json`:

1. Selected the first editable subtitle and saved `T104 SENT` through the real UI. Held delivery of the real successful POST response **after** the server processed it; did not synthesize status, response body, revision or pointer.
2. While held, filled a long unbroken Korean/Latin subtitle and invalid raw start/end fields. The existing textarea maximum admitted **500 characters** (350 Korean + 150 Latin); this actual UI value, not the overlong attempted input, is the recovery expectation. Raw start is `bad-` + 180 nines + two trailing spaces (**186 characters**), end is 120 x's. Captured the current React root's TextEditor props read-only, as an independent expected full draft/times/selection snapshot.
3. Node loopback HTTP posted a real newer external save changing a different subtitle to `T104 EXTERNAL KEEP`. Own response: content revision **6**, timeline **r2**, id `01a1e4ba-3282-74d1-a67c-355c5b52c033`; external response: revision **7**, **r3**, id `01a1e4ba-6708-7737-bf91-92c37c5cf721`.
4. Released own response. The refreshed screen retained the external timeline, while the complete local follow-up remained in recovery. No silent rebase occurred.

Full comparisons pass for draft, sent actual HTTP timeline, timeFields including raw trailing spaces/error messages, selectedTextId, projectId, format/version/date/note, sentFrom revision/pointer, ownSave revision/pointer/**timelineRevision=2**, and shown revision/pointer/**timelineRevision=3**. Selection at send is also present and identifies the same first subtitle selected throughout this case. T100 supplies the broader changed-selection/style/order matrix; no new broad matrix is claimed here.

Actual browser download events were armed before clicking, and artifacts were saved with `saveAs`:

| Payload | Result |
|---|---|
| `actual-download1280.json` at verified viewport1280 | Exact bytes equal fallback |
| `download390.json` at viewport390 | Exact bytes equal fallback |
| `download1280.json` | Also equal; despite its initial filename this first download was at **1440**, not1280; corrected by the separate verified1280 capture |
| `fallback.json.raw` and `mobile-fallback.json.raw` | Exact string/UTF-8 equality; **11,148 bytes / 10,234 UTF-16 code units** |

Recovery does not clip or omit any of the captured draft/raw-time data. The existing input maxLength is separate from recovery serialization and was not modified. Native Windows clipboard success/line-ending behavior is inherited from T100; this review deliberately exercises rejection and fallback, not a fresh native clipboard-success claim.

## Resize, bulk layout and focus

`browser5.mjs`, `wide.json`, `immediate1280.json`, `bulk1280.json`, `bulk390.json`:

- Natural actual **1440→1280**, measured immediately after CDP resize: document scrollWidth **1265**, positive page overflow **0**. Bulk recovery/fallback at1280 also1265; at390 document scrollWidth **390**, positive overflow **0**. Screenshots `bulk1280.png` and `bulk390.png` were opened and visually inspected; long text/raw values wrap and controls remain inside the page.
- Because the observer had already caught up in that natural sample, additionally reproduced the precise stale-measurement boundary in own p2. Before loading, a browser-only wrapper queues ResizeObserver callback delivery when enabled. Established1440 layout, held delivery, then actually resized to1280. This is deliberate scheduler control, not an uninstrumented timing claim; production source stayed byte-identical.
- With the real stale1440 tick coordinates, max tick right remains **1347.296875** while ruler right is1220. Target `overflow:clip` keeps document width **1265** (`resize-gated-fixed.json`). Temporarily overriding only that DOM ruler's overflow to the old **visible** value yields document width **1347** (`resize-gated-old-style.json`). Restoring the target style returns1265 **before** releasing the observer. Releasing updates max tick right to1192.625. This isolates the original overflow cause and the fix rather than hiding recovery text or changing JSON.
- Focused the ruler with keyboard interaction: active slider and `:focus-visible=true`, computed teal solid outline /2px offset; ancestor overflow is visible. `ruler-focus1280.png` was opened: the complete outer focus ring, including all edges/corners, is visible. The ruler's own overflow clip does not clip its external outline.
- Phone-sized390 intentionally hides the timeline as existing design specifies; this is desktop viewport emulation, not a physical-device/touch test.

## Recovery accessibility and wording

- Clipboard rejection is deliberate browser harness behavior. Real button click yields a nonempty **role=status** message saying copying failed and instructing manual copy. Fallback textarea receives focus and selection **0..10234**, its entire value; repeated failure at390 focuses/selects it again. `fallback.json`, `mobile-fallback.json`.
- Recovery wrapper has **role=region**, with accessible name matching its title: “저장하는 동안 다른 창에서 더 새 버전을 저장했어요.” Confirmed DOM and actual accessibility snapshot.
- Actual displayed explanation identifies own saved **r2** and other window **r3**, explains subsequent edits were not included, recovery is not automatically saved/applied, and dismiss/navigation/refresh loses the in-memory recovery.
- Download status says **“내려받기를 시작했어요. 브라우저의 내려받기 목록에서 파일을 확인해 주세요.”** It does not guarantee a completed download. Actual download completion was separately observed through artifact capture.
- Literal-entered-text sharing notice is present; successful copy is not claimed on rejection. Required notices, controls and textarea remain accessible at1280/390. Actual screen-reader announcement testing remains open.

## Preservation, harness corrections and cleanup

- `validation.json`: **all392 copied tracked files byte-identical** to starting source hashes after install/typegen/build/runtime; zero differences, including fixtures/migrations/public assets. No newline normalization or test/fixture regeneration.
- `preservation.json`: every original fixture timeline row remains exactly equal in final fake DB; all seven manifest storage files, including existing ZIP, retain expected SHA256.
- Explicit real own/external saves intentionally add r2/r3 in the fake DB. Later bounded UI/download/resize operations leave all **18 application tables plus migration bookkeeping** identical: `db-before-bounded-ui.json` = `db-after-bounded-ui.json`, hash `83ef9714a7261202f41467687ff6bb5070aa7ab38a86f646415429ef41f20197`. This DB equality covers that recorded late interval, not all earlier deliberately writing actions. T100's broader CDP/write audit is inherited. `network-final.json` is preserved raw evidence, not a new whole-session zero-write claim.
- First browser2 script had non-ASCII literals damaged by the PowerShell/Python stdin bridge and stopped at a scene-order selector. Read the actual browser snapshot, rewrote the latest subtitle using ASCII JS Unicode escapes, and captured expected state only afterward. Scene reorder did not execute and is not counted; T100's order recovery PASS remains inherited. Overlong subtitle input was bounded by the existing500-character control and is reported accurately above.
- An initial attempt to locate the installed Next guide used an incorrect directory; located and read the actual `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`. No product change resulted.
- Own browser **TaskSpace96 finish({keep:[]})** completed, `browser-cleanup.json`. Verified server pid **58768** command line as own loopback3114 Next process, then stopped it; no3114 listener remains. `owned-server.json` and `cleanup-confirmation.json`. Other servers/browser spaces were untouched. Temp source, fake DB, scripts, downloaded artifacts, screenshots and logs remain preserved.

## Gaps and next entry condition

No required T103 correction remains from this review. Master can integrate this bounded PASS with T100 and T099; shared status/acceptance is Master's action. Native unload dialog display/cancel, physical devices, screen readers, touch/pen/real-hidden behavior and exhaustive saved16:9/1:1 geometry remain the previously stated gaps. Stale ruler positions can temporarily exist internally before ResizeObserver delivery; the verified fix contains their visual overflow. No additional feature milestone or production deployment was performed.

### Copy-ready message for Master / Claude design

> T104 independently rechecked aa7aae0: focused19 tests, lint/typecheck and isolated production build PASS; natural1440→1280 and deliberately delayed ResizeObserver reproduce the old1347 overflow with visible, while target clip holds1265, and390 holds390. Actual dual-writer recovery retains the full captured draft/raw times/metadata including ownSave.timelineRevision2; actual1280/390 downloads equal fallback11148 UTF-8 bytes, copy rejection announces failure and focuses/selects all, named region/download-start/loss notices and visible ruler focus ring PASS. T100 originalCRLF467+2/full-suite/build/dualwriter/recovery/lifecycle broad PASS is explicitly inherited;392 source files, originalr1 and7 storage/ZIP hashes are preserved, own3114/browser96 are closed, and only this report changed with no commit/push; please integrate while retaining native-unload/device/screen-reader/wide-square gaps.
