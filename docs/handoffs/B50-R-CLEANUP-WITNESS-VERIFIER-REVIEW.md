# B50-R independent pure verifier code review

2026-11-18 · Codex(Tester) · Master msg_d268e948bf5d; accepted msg_d40892d1289a. Fixed implementation **02293287957f0703d2f4e3c74a82bc47dde739ea**, exactly helper/test/B50 author report. Read AGENTS.md, the complete three-file change and accepted e41a6a3 specification/953be37 review.

**Changes requested: F50-1 and F50-2, both P2 within this test-support API.** Existing379 tests and scoped type/lint pass, but13 independent diagnostic inputs expose five unexpected acceptances: two exact pinned noninteger JSON numbers rounded into a valid PID, and three Proxy-bearing argument positions that execute caller traps and return a candidate. These findings do not establish an actual OS/provider failure or runtime exploit: the helper is test-only and has no product import. Original B48 guard remains FAIL/cause unproven/independent pair incomplete. No native run, source fix or expectation relaxation occurred.

## Fixed sources, normal behavior and scope

Helper working-byte SHA **76a3b0949f883271b331807e8b9f929f05a067c73ef411315bd4b90ed3796736** and test **f9199e906aa51b465313f4a488b995c4552af97afcbee674b529b326cd506c61** match the fixed report. All three current files match commit text; accepted R2/R3 reports match their fixed commits. Preservation checks verify original B49 twenty inputs, five accepted pure-model artifacts, original B48 pair artifact and its54 input-file hashes: **80/80** entries unchanged before/after review.

The function checks a separately supplied strict authority, synthetic profile, four original-byte hashes before parsing each input, strict binding/receipts, complete owned inventory/baselines and sample/probe plan. It returns only `absence_candidate` with synthetic-test-only scope or bounded structured `blocked`; it has no history/ACK/CAS/readiness API. `authorized=true` does not authenticate authority or authorize execution. Current-state candidate output is explicitly independent of any previous failed gate. Provider acquisition, host/path canonical ownership, authoritative pins and persistence remain outside this implementation.

Positive controls, exact byte hash checks and bounded receipt/sample validation generally match F49-1/2/3's sample portion. All13 named counterexample conditions are represented. Dedicated tests additionally use consistent positive rows/counts and empty declared inventory with no process probes, so rejection does not rest solely on the named cases' incidental shape differences. Correctly pinned malformed receipt fixtures are constructed before freezing synthetic authority; post-freeze tampering is tested separately. Nanosecond UTC comparisons use BigInt and retain equivalent-offset/touching-bound controls. Present/reused PID records block even if the other provider says absent. Missing/partial/error channels and unknown profiles block.

Repository search finds imports only from the new test, with no product/runtime wiring. Helper imports only node:crypto and existing zod; static code has no filesystem/network/DB/process operation, current-clock read or environment read. `Date.parse` interprets supplied timestamps. The indirect caller-code issue below qualifies the claimed pure unknown-input boundary.

## F50-1 · P2 · Exact pinned noninteger numeric tokens round into accepted PID

Location: **tests/helpers/cleanup-witness-verifier.ts:130–148**, specifically JSON.parse at134 followed by post-parse schema checks. Input-byte hashing is correct, but JSON.parse converts number tokens to binary64 before integer validation. The duplicate-key scan retains number lexemes without validating their exact numeric value. A mathematically noninteger receipt value can therefore become an apparently safe integer.

Reproduction uses an otherwise complete positive fixture, changes only the run JSON PID token, freezes the actual new run byte hash in the synthetic authority and updates the sample inputSet/probe bindings. All other receipts, baselines and probe targets remain PID101. No hash mismatch, missing field or expected-data relaxation is involved:

|Exact original JSON token|Exact rational remainder|JSON.parse value|Required|Observed|
|---|---|---:|---|---|
|101.1|nonzero|101.1|blocked|blocked control|
|101.000000000000000001|1 / 10^18 beyond101|101|blocked|absence_candidate|
|1010000000000000000001e-19|1 / 10^19 beyond101|101|blocked|absence_candidate|

The independent confirmation computes quotient/remainder with BigInt, verifies the exact run-byte hash against the authority pin and preserves the original token/bytes/full bound sample. This is semantic numeric loss after successful original-byte verification, not a hash bypass or proof of real authority forgery. It undermines the receipt contract's exact integer/type check even though the returned candidate remains synthetic.

**Required fix and regression:** retain/validate numeric token values without binary64 rounding before accepting receipt integer fields. Require each such value to denote an exact safe integer, or explicitly document/enforce a narrower canonical integer-token grammar. Handle decimal/exponent forms consistently; do not use Number(token) plus Number.isSafeInteger as the exactness test. Preserve hash-before-parse, duplicate-key and strict-schema behavior. Add otherwise complete, correctly pinned cases above and boundary exponent/unsafe-integer controls. No real provider or persistence implementation is needed to fix this parser boundary.

## F50-2 · P2 · Unknown object arguments execute Proxy traps and pass plain-data guard

Location: **tests/helpers/cleanup-witness-verifier.ts:82–92** (`plain` reflection), **:168–170** (byte-bundle reflection). Accessor descriptors are rejected without invoking getters, and native typed-array getters reject a Proxy used as an individual byte container. Those protections do not reject a Proxy wrapping authority, sample or the four-member byte-bundle object before reflecting on it.

Independent inputs wrap a complete valid object in a transparent Proxy with getPrototypeOf/ownKeys/getOwnPropertyDescriptor traps that only increment a local counter and delegate to Reflect. Results:

|Wrapped argument|Caller trap executions|Observed|
|---|---:|---|
|authority|16|absence_candidate|
|sample|22|absence_candidate|
|inputBytes bundle|7|absence_candidate|

A normal accessor control blocks with zero getter calls. The Proxy cases show that the unknown-input/plain-data boundary can execute caller-supplied functions before accepting a snapshot. Actual I/O was not attempted; a local counter establishes execution. This is not evidence that a genuine separately authenticated authority can be forged, nor that a production path uses the helper. It is a direct counterexample to treating these inputs as inert plain data in a pure validation API.

**Required fix and regression:** reject Proxy values before reflection or property reads on unknown object inputs, including nested plain objects/arrays and the byte bundle, using a non-trapping native brand check appropriate to this Node-only helper. Keep proxy/subclass/shared byte-container rejection. Add root/nested/revoked Proxy cases whose traps would fail or increment a counter; blocked results must occur without invoking them. Maintain structured, input-text-free failures and immutable isolated candidate evidence. Do not execute callbacks to decide whether data is plain.

## Actual independent checks and evidence

Reproduced author commands: Vitest new139 + unchanged catalog240 = **379/379 PASS** with native switches process-local0; scoped strict TypeScript/import graph exit0; scoped ESLint max-warnings0 exit0. Commands used the report's explicit tsc flags (`--ignoreConfig --types node --noEmit --target ES2022 --lib ESNext,DOM --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict`) and only the two assigned TS files. No whole-project test/type/build was needed or run.

Own ignored **tmp/b50r-review-0229328** contains preflight.mjs/preflight.json, prepare.mjs, fixture.ts, direct.ts/direct-results.json and confirm.mjs/confirmation.json. prepare.mjs copies only the fixed test's inert fixture/serialization builders into own scratch; it does not edit or execute the original test outside Vitest. Direct command: `node --import tsx tmp/b50r-review-0229328/direct.ts` produces **diagnostic evidence**, not an all-PASS test result. Its13 cases comprise five unexpected acceptances above and eight matched controls: normal positive, visible fractional PID rejection, accessor nonexecution, hash mismatch before malformed JSON parsing, nanosecond reversal, consistent positive row, empty process inventory and malformed baseline path. Confirm.mjs independently checks exact fractional remainders, bound byte hashes, trap counts and controls.

The first scratch fixture-preparation inline command failed on shell quoting before writing a fixture; standalone prepare.mjs succeeded. An initial summary checker compared the human label "blocked without getter" literally against kind "blocked"; the original mismatch JSON is retained and the corrected summary checks blocked plus zero getter calls. These were review-tool corrections only. The two code findings and all original diagnostic outputs remain unchanged; no product/test expectation was modified to make them pass.

Final offline hashes retain fixed sources, accepted reports and80 preservation entries. Original scripts/fixtures/native roots and first OS discrepancy were neither executed nor changed. Only this new tracked report and own ignored scratch were written; Master TEAM/plan WIP, shared index and T122/T137 files preserved. Production5148/preview50963/Ego54/55/shared3013/.next, accounts/mail/password, package/config and Golden/state/runtime remain untouched. No live OS/network/DB query, target-process operation, native A/B rerun, build/deploy/install or new agent/window/worktree.

Master copyable return: B50-R fixed0229328 changes requested F50-1 exact numeric token rounding after JSON.parse and F50-2 caller Proxy traps during plain/bundle reflection, both P2 test-support scope. Existing379/scopedtype/lintPASS do not cover two correctly pinned noninteger tokens accepted as101 or Proxy authority/sample/bundle accepted after16/22/7traps. Own13 diagnostic inputs preserve five unexpected acceptances/eight controls; fixed hashes and80 historical entries unchanged. No source edits/live/native operations; actual provider/storage/CAS/history/B authorization remain absent, B48 guardFAIL/pairincomplete unchanged. Assign bounded helper/test fix and separate re-review; no new abstract backend work is required by these findings.
