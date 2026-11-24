# B50 pure cleanup witness candidate verifier

2026-11-18 ? CX-RECOVERY-01 ? Master msg_db08a9d20f87 ? follows accepted B49-R2 **e41a6a3b9046fe153dc5ac2818d3ebecfe48ad45** and B49-R3 **953be37df5fb38b62383e5f20cc29d6ff19d9c91**. **Author implementation/self-validation ready_review; separate independent code review remains.**

Implemented test-support-only TypeScript verification of B49 input ownership/schema and within-sample ordering. Exactly three new tracked paths: `tests/helpers/cleanup-witness-verifier.ts`, `tests/postgres/cleanup-witness-verifier.test.ts`, this report. No production/runtime imports or wiring, no original Python translation of persistence/state logic, no actual provider or native experiment.

## API and trust boundary

`verifyCleanupWitnessCandidate(authority: unknown, inputBytes: unknown, sample: unknown)` is synchronous and pure. Its only imported dependencies are existing Zod and Node crypto; it performs no file/OS/provider/network/database/process I/O, calls no clock and does not inspect the environment. Input acquisition and authority authentication are caller/controller obligations.

The result is exactly one of:

- `{ kind: "absence_candidate", scope: "synthetic-test-only", evidence: { authority, sample, ownedPids } }` containing isolated, runtime-deep-frozen validated snapshots.
- `{ kind: "blocked", issues: [{ code, path }] }` with structured bounded diagnostics and no raw input/exception text. Codes distinguish malformed authority/bytes/JSON/inventory/sample/probe, hash mismatch, unsupported profile, provider error and present observation.

An absence candidate is **not** actual provider acceptance, durable completion, saved evidence, B execution permission or a historical first-failure decision. No commit/ACK/CAS/store/attempt registry/readiness API exists. A current-state sample can independently be an absence candidate; it cannot erase an earlier failed gate because this module never adjudicates a history. Later persistence and cross-sample contracts remain unimplemented.

The separately supplied controller authority has an exact schema: task/scenario/attempt/host, approved root/cluster/port, lowercase64-hex source SHA, authorized boolean true, explicit profile, planned client slots, monotonic origin and four original-byte SHA pins. authorized=true is the test input's authority eligibility field, not execution authorization. The module does not learn pins/ownership/plan/profile from sample. Approval/authenticity of that controller input, actual host/path acquisition and prevention of fraudulent collector output are outside a pure verifier.

Only profile `{ id: "pure-fixture-v2", mode: "synthetic-test-only" }` is implemented. Omitted/unknown/real Windows profiles close by default. Synthetic no-match codes are fake fixture identifiers, not asserted Windows error IDs. No actual Get-Process/CIM/TCP/file adapter or missing/error mapping is supplied.

## Original-byte input interface

inputBytes must be a plain object with exactly **run, clients, receipt, baselines**, each a Buffer or native Uint8Array (1..131072 bytes). ArrayBuffer-backed snapshots are copied; shared backing, proxy/subclass/extra-field byte containers, strings and accessors reject. For each input, SHA256 of the exact supplied snapshot must match the corresponding separately pinned authority hash **before that input is parsed**. Whitespace/encoding are not normalized or reserialized for this comparison. UTF-8 decoding is fatal, BOMs are not stripped, JSON syntax and duplicate decoded object keys reject; escaped duplicate keys also reject.

The sample inputSet is defined as SHA256 of UTF-8 `JSON.stringify([["run",runHash],["clients",clientsHash],["receipt",receiptHash],["baselines",baselinesHash]])`, in precisely that order. This binds the hash map; it is not a replacement for verifying each original byte input.

The bytes encode the **new frozen receipt contract**, not an automatic adapter for old B48 JSON files that lack binding/baseline fields. All four records carry exact task/scenario/attempt/host/root/cluster/port/source bindings. run contains postmaster PID; clients contains complete collected planned-slot receipts; receipt contains completed/postmaster/backend coverage; baselines contains captured/phase/acquisition UTC and an exact PID-keyed identity map. No old35560 baseline or time is fabricated.

Raw and object data are bounded. Object snapshots accept only enumerable plain data, no accessor execution, cycles, sparse arrays, custom prototypes, symbols or reserved prototype keys; limits include depth32, node budget20000, array length512 and string8192. Zod strict schemas reject omitted/unknown fields and non-exact boolean/integer values. Safe integers bound nanosecond arithmetic; nonfinite/unsafe numeric inputs close rather than coerce. Paths use an explicit lexical absolute forward-slash contract, no dot segments/backslashes/control characters/trailing separators; cluster equals approved root/cluster. This checks format and exact binding, **not real filesystem canonical ownership**.

## Implemented checks

**F49-1:** strict mandatory sample/probe/native-error fields; rowCount equals actual rows.length; absence requires explicit successful provider completion, zero rows, recognized synthetic reason and not-applicable identity status. All three query/nonTerminating/identity error arrays must exist and be empty. completed-empty permits no raw errors; recognized-no-match requires its exact retained synthetic code/classification/channel. Capture completeness and native/normalized outcome must agree. Partial/error/unknown records, hidden errors and positive rows cannot pass. Present matching or reused PIDs/provider disagreement are blocked; no process operation follows.

**F49-2:** controller-approved nonempty unique ordered slots versus collected slots, postmaster plus unique positive client PIDs, exact producer PID/client coverage and exact true completion/capture flags. Every expected PID has a complete PID/host/start UTC/image-path/error-free baseline; exact key coverage, startup phase and acquisition time are checked. Baseline acquisition precedes sample, process start precedes acquisition. Empty declared inventory or omission from both declared list/probes cannot reduce trusted collected coverage. Input roots/attempt/source/host/ports agree exactly after byte-hash verification.

**F49-3 sample portion only:** same attempt/sample/host/source/input digest/clock origin, contiguous prescribed sequence and complete CIM/GetProcess-per-PID plus listener/PID-file plan; sequential monotonic bounds enclosed by sample. Unit is ns, safe nonnegative integers, no overlapping/reversed intervals. Offset-bearing UTC is validated and compared at **nanosecond precision** with BigInt rather than rounding Date milliseconds; sample/probe/generated and baseline order are checked. UTC changed/unknown state closes. Sample index0 uses first-gate purpose; positive indices use current-state. No previous-sample lookup or durable gate decision is implemented.

## Tests and actual results

Final commands:

```text
node node_modules/vitest/vitest.mjs run tests/postgres/cleanup-witness-verifier.test.ts tests/postgres/schema5-catalog.test.ts
node node_modules/typescript/bin/tsc --ignoreConfig --types node --noEmit --target ES2022 --lib ESNext,DOM --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict tests/helpers/cleanup-witness-verifier.ts tests/postgres/cleanup-witness-verifier.test.ts
node node_modules/eslint/bin/eslint.js tests/helpers/cleanup-witness-verifier.ts tests/postgres/cleanup-witness-verifier.test.ts --max-warnings 0
```

**379/379 tests PASS** across two files: new verifier139 plus unchanged catalog240. Scoped strict TypeScript/import graph exit0; scoped ESLint exit0/zero warnings. No whole-project type/full-suite/build/native/provider/persistence verification claimed.

The thirteen independently supplied counterexample conditions are explicit Vitest cases: empty/missing-path baseline; truthy startup/completion strings; partial/identity-error state; positive rows under absence; nonterminating errors; unknown no-match reason; empty/duplicate declared inventory; overlapping sequence and out-of-sample bounds. Their required safety outcome remains blocked. Dedicated additional tests also use internally consistent positive rows/counts and an empty inventory with no process probes, so the tests do not rely solely on incidental shape errors. Malformed pinned receipt fixtures are deliberately built before freezing their test authority, reaching semantic checks; post-freeze byte tampering is separately rejected.

Meaningful additional controls cover complete positive absence and exact synthetic no-match; unknown/production profiles; source/authority and unsafe type boundaries; planned-versus-collected client/PID/baseline/input binding; every missing sample/probe field; raw error and identity contradictions; reused/original positive process with another provider absent; nanosecond reversal and precision bounds; equivalent UTC offsets/touching monotonic intervals; whitespace changes in original bytes; correctly pinned duplicate/escaped JSON keys in an otherwise complete receipt; invalid UTF8/BOM/syntax; JSON strings containing escaped braces/quotes; unsafe object/accessor/shared-buffer/size handling and immutable non-aliased output. I/O trap mocks remain unused. Expectations are candidate versus blocked plus concrete error code/path where meaningful, not copied Python branch strings.

Implementation-stage corrections are distinct from tests/native operations: the first scoped compiler command needed explicit --types node under TS6 ignoreConfig; indexed schema dispatch was replaced with statically typed per-record parsing. Lint caught a regex escape and control-character regex; the final implementation uses an explicit character-code predicate. These were resolved without package/config changes or lowered expectations. Final commands above all pass.

## Preservation and boundaries

Read-only preservation recheck: B48 original **54/54** evidence-file hashes plus fixed pair artifact3b9e425d?019f and frozen harness/report match. B49 original **20/20** preservation hashes, accepted new **5/5** Python model/fixture artifacts and fixed R2/R3 report bytes match. Original17-case fixtures and their result, old OS discrepancy/current evidence and every native root remain unchanged. No old script/model was executed in place.

Search across product paths found the helper imported only by the new test. No product/runtime/SQL/provider import, lockfile/package/config modification, installation, Next generation/shared.next mutation, build/deploy, account/mail action, live OS/network/DB query, process operation, new window/agent/worktree or Golden promotion. Concurrent Master TEAM edits and existing T122/T137 untracked reports are protected. Only these three new paths are selected for commit.

|Implemented file|SHA256 (working file bytes)|
|---|---|
|tests/helpers/cleanup-witness-verifier.ts|76a3b0949f883271b331807e8b9f929f05a067c73ef411315bd4b90ed3796736|
|tests/postgres/cleanup-witness-verifier.test.ts|f9199e906aa51b465313f4a488b995c4552af97afcbee674b529b326cd506c61|

Master copyable return: B50 test-only pure TS verifier ready_review. Exact original-byte authority pins/strict receipts/inventory/fullbaselines/probe row-error-knownabsence/within-sample monotonic+UTC verified; actual provider profiles unsupported, synthetic explicit. Output absence_candidate or structured blocked only, no durable/ACK/CAS/history/B-permission API. New139+catalog240=379PASS, scopedtype/lint0; B48 54+pair/frozenpaths and B49 20+5/fixedR2-R3 preserved. Exactly helper/test/report three paths; no live/native/product wiring/package/build changes. Separate independent code review requested; provider and persistence implementation remain unallocated here.
