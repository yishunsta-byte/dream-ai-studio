# B49 cleanup witness diagnosis and minimum specification

2026-11-18 ? CX-RECOVERY-01 ? Master msg_1fd0476e3a6d, scope/time wording confirmation msg_fdc1d1479949. Fixed independent review **32d1189a0d35c512a2e6d20e4e296b21708da974**. **Offline diagnosis/specification only; zero live process/network/DB queries, zero native launches or process operations.**

**The historical cause is unproven. The original witness has demonstrable evidence gaps in time, identity and query-error reporting.** Its first guard remains FAIL; later absence does not retroactively pass it. B48 author's two-scenario diagnostic remains separate, and B48-R independent pair remains incomplete (own B never ran). No product/SQL/decoder/cleanup-script fix or new experiment is performed or authorized by this report.

## Observed facts and exact time semantics

Inputs: fixed B48-R report; original cleanup-os.ps1; first-discrepancy/current-final JSON; copied tool transcript; own A-c6850ec7 run/final/cleanup/postgres/stop/witness logs. None contains the synthetic password, and no password file was read. The transcript is a reviewer's copy of tool outputs, not independently timestamped original stdout; its own attribution limit is preserved.

|Retained evidence|What it establishes|What it does not establish|
|---|---|---|
|run.json|Owned root A-c6850ec7, postmaster PID35560, loopback61009, cluster path|PID35560 creation time or executable identity|
|Native tool receipt/transcript|Exactly one own A, parent command exit0/stoppedtrue; B not launched|A separate OS termination receipt for the original postmaster identity|
|postgres.log13:28:40.416|Postmaster logged receipt of fast-shutdown request|Immediate process exit or timestamp of a later OS query|
|postgres.log13:28:49.450|Database system logged shut down|PID object removal/reuse timing or OS API result at another instant|
|cleanup-safe.json|Producer reports completedtrue/all three absence flags true, clients74724/41172/66300,15 projections, migrationCommittedtrue|Independent validation of those booleans, process start/path, per-probe timing/error details|
|First guard JSON aggregate at13:29:05.7225958+09:00|PID35560 absent=false; clients absent=true; listener absent=true; PID-file absent=true; guard exit1|Identity of the positive result, exact PID-query time, or proof that it was still the original PostgreSQL process at aggregate at|
|Immediately subsequent tool read|CIM/Get-Process returned no35560 row; shutdown log copied|StartTime/path (no row), precise query wall time (not captured)|
|Current-final aggregate at13:29:38.8000928+09:00|Later recorded CIM absence for four PIDs, Get-Process35560 no row, no listener/PID file|Retroactive explanation/PASS for the first guard, exact simultaneous time of every query|

The first direct .ps1 invocation was execution-policy blocked before the body ran; the first actual witness used Invoke-Command with a ScriptBlock created from the retained script text. No policy change was made. Those are distinct attempts; the blocked attempt supplies no process measurement.

**Source evaluation order matters.** In cleanup-os.ps1:

1. Line7 builds processChecks by sequential Get-Process calls for35560,74724,41172,66300.
2. Line8 runs Get-NetTCPConnection and collects the listener array.
3. Line9 begins constructing the ordered result: `at=(Get-Date).ToString('o')` is evaluated here.
4. Later in that same ordered literal, `pidFileAbsent=(-not (Test-Path ...))` is evaluated, followed by assigning the existing cleanup receipt.
5. Lines10?11 serialize/write/print the result; line12 checks booleans and throws Cleanup witness failed.

Therefore **at follows the process and listener queries, but precedes the PID-file Test-Path**. Master's earlier phrase ?after every query? is also too broad and was explicitly corrected in msg_fdc1d1479949. It is a construction-time label, neither the first PID-query start nor a bound enclosing all probes. The duration between the35560 lookup and at was not captured. It is invalid to claim that the original postmaster existed precisely at13:29:05, survived a computed number of seconds after the shutdown log, or that all resources were sampled atomically. File modification times and downstream transcript order cannot reconstruct those missing timestamps.

## Source-confirmed limitations versus possible causes

**Confirmed witness limitations (not established product defects):**

- `absent=($null -eq (Get-Process -Id $_ -ErrorAction SilentlyContinue))` collapses success-stream output into one boolean. absentfalse records a non-null lookup result under that expression; the actual object, count, process name, creation/start time, image path and HasExited are discarded. It is not evidence identifying the original postmaster.
- Get-Process and Get-NetTCPConnection explicitly use SilentlyContinue and save no ErrorRecord/status/provider completion. Outer ErrorActionPreference Stop does not negate those explicit per-command choices for suppressed nonterminating errors. For an empty result, missing target and a suppressed query failure cannot be distinguished afterward. Listener Count0 alone has the same evidence gap. This does not prove an error actually occurred in these runs. The PID-file Test-Path has no local SilentlyContinue, but its success/failure details/time are likewise absent; some errors could abort the script instead of producing a result.
- No startup process identity baseline exists in run.json; the first positive witness has no identity metadata. It cannot establish or exclude PID reuse. Bootstrap PID, native role OIDs and executable version in other artifacts cannot substitute for process creation identity.
- The ProcessId list comes from run.pid plus cleanup receipt client PIDs; only receipt.completed is checked from producer flags at the final guard. There is no explicit run/receipt/root/cluster identity-agreement validation in this witness. Current captured values agree, so no artifact mismatch is diagnosed here. A stronger next witness should reject mismatched inputs before sampling.
- Queries across PIDs/providers/port/file are sequential and not timestamped individually. The original guard has no independent CIM process measurement; subsequent CIM reads happen later and cannot cross-check the earlier lookup at its own instant.
- The output path cleanup-os-A.json is replaceable on later invocation. The reviewer separately preserved a byte-identical first-discrepancy copy, which prevents loss in this incident; append-only per-attempt evidence should be built in for the next witness. No overwrite of the first-discrepancy file occurred here.

The null comparison itself is not proven incorrect. No recorded parse error or proven PID-variable bug explains this positive result. Source review establishes an inability to disambiguate causes, not that the script fabricated a process or PostgreSQL cleanup failed.

|Possible explanation|Compatibility with retained evidence|Missing discriminator|
|---|---|---|
|PID reused by another process before the first lookup|Compatible; currently unproven|Startup baseline and positive-row start/creation time/path|
|Original process still present/exiting during an early lookup, gone before later reads|Compatible; currently unproven|Original-identity match, per-query time bounds, identity-specific exit evidence|
|Process disappears between sequential provider/property reads|Compatible; currently unproven|Separate provider/identity property errors and begin/end times|
|Command/provider/error-handling behavior affected result|Not excluded; no specific mechanism established|Actual returned row/type/count, source/runtime identity and unsuppressed structured errors|

The shutdown log and producer absence claims do not select a row in this table. Neither does later empty CIM/Get-Process output. There is no basis to recover a historical StartTime/path or exact lookup instant. B49 does not reproduce an actual cause.

## Minimum next witness specification (implementation and native run require a later assignment)

**1. Bind ownership and expected identity before shutdown.** Validate normalized evidence root, exact scenario/task/attempt ID, source hashes, run.root/cluster/port/PID and receipt PID/client coverage; preserve their original bytes/hashes. At startup and when each actual client PID is collected, record its PID plus UTC creation/start time and image path, provider and retrieval errors. Resolve path/identity in the owned session, with access denied or process-already-gone recorded as missing metadata, never guessed. A new process identity should be `(PID, creation-time, image-path)` on the recorded execution host; include host/boot identity when available, and its unavailability explicitly. Do not extract or print credentials/full command lines; the known owned cluster directory is sufficient separate context. Old35560 has no such baseline and cannot be upgraded retrospectively.

**2. Make each probe a bounded record.** Before and after every individual Get-Process, CIM, identity-property, listener and PID-file query, capture UTC timestamp with offset plus a monotonic elapsed counter from the same witness invocation. Include attempt/sample/probe sequence, method/provider, target PID or port/path, invocation mode and PowerShell/runtime identity, success-stream row count, bounded safe row data, exact outcome and structured errors. Probe start/end are not an assertion of a single atomic observation. A sample has startedAt/finishedAt and a separate generatedAt; generatedAt must never be labeled measuredAt for earlier probes.

Minimum process record shape (field names illustrative, not a runnable OS script):

```json
{"attemptId":"unique","sampleIndex":0,"probeIndex":0,"provider":"GetProcess","pid":35560,"beginUtc":"captured-before-call","endUtc":"captured-after-call","elapsedBegin":0,"elapsedEnd":1,"status":"present|absent|error","rowCount":0,"rows":[],"identityReadStatus":"not-applicable|complete|partial|error","error":null}
```

For present rows, retain PID/name/start time/path and separate per-property access or exit-race errors. If HasExited is available, record its own sampled value/time/status; it is not a substitute for startup identity. Paths/start times can be inaccessible even when existence was observed. Do not discard the positive row while retaining only absentfalse.

**3. Separate providers and missing from error.** Get-Process and CIM produce different records with no merged success stream. An explicit, recognized no-such-PID result may be classified absent; generic failure, permission denied, timeout, unsupported provider, serialization failure, unknown error or partial observation is error/unknown. Provider-specific no-match classification must be verified in the implementation's own bounded fixture/controlled gate; do not blanket-catch and return absent. Retain ErrorRecord category/FullyQualifiedErrorId/HResult/message with secrets removed. Use terminating error capture or explicit error-variable collection that preserves nonterminating errors; an empty output plus any unclassified error cannot pass. A listener probe records local address/port/owning PID and errors; PID-file probe records exact path and found/missing/error independently. Different provider times can yield different values without proving either provider wrong.

**4. Keep lifecycle phases distinct.** Preserve shutdown-request intent/time/owned identity, actual pg_ctl command start/end/exit code (or explicit failure), native harness completion code and per-client end attempt/ack or failure as separate receipts. Preserve database shutdown log event separately. Then record identity-aware OS absence witnesses. A request, a successful pg_ctl return, parent node exit0, SQL COMMIT and a log line each describe a different phase; none alone establishes every OS resource absent. Do not kill/reclaim a PID on a numeric match, particularly when its creation identity differs.

**5. Define conservative outcomes and the scenario barrier.** All expected PIDs must have both prescribed provider records with valid bounds; no unclassified query/property error or missing coverage. Keep `originalIdentityState` and `numericPidState` separate. A present matching identity fails; a present unknown identity is insufficient; a confirmed different identity is a reuse observation requiring review, not an automatic PASS or authority to stop that process. If any prescribed provider sees a present PID, or providers disagree, preserve the first discrepancy and stop the A?B gate even if a later sample is absent. The listener and PID-file checks require explicit successful absence, and a completed producer receipt remains a separate precondition. A ?sample absence PASS? is bounded to that invocation, never proof of permanent absence.

**6. Preserve first failure and bound any retry.** Save attempt-specific append-only JSON/raw safe output before returning status, including first discrepancy and all probe/error records, with source/input/output hashes. No overwrite, automatic live polling, PID termination, post-failure B run or automatic conversion to PASS. Default one planned witness sample. Any additional sample/known transient-provider retry needs an explicit Master plan naming reason, permitted count/deadline and its gate effect; preserve earlier failure unchanged. A later current-state record can help choose the next action but cannot satisfy an earlier failed first-discrepancy gate. B48-R B remains unexecuted until separately assigned.

## Pure fixture validation and preservation

Ignored own directory `tmp/b49-cleanup-witness` contains fixtures.py and fixture-results.json, plus a nonsecret input hash manifest. The fixture code uses only synthetic dictionaries/integer ordering units, no subprocess/live-system-provider/process/DB calls (only own fixture-file I/O). **17/17 checks PASS**: clean absence, aggregate-only time rejection, reversed bounds, missing startup baseline, original/reused/unknown identities, provider disagreement, empty output plus error, listener/file errors, missing provider/PID coverage, resource present, producer flag not overriding process presence, incomplete producer and append-only first-failure barrier despite later absence.

This verifies selected representation/decision properties only. It is not a complete witness implementation, a real-provider/no-such-PID classifier test, a timing calibration, PID-reuse reproduction, an actual process termination race, or proof of the incident's cause. Synthetic fields are not reconstructed historical metadata. No package/test/build/lint/native command was needed for a report and pure-Python fixture.

|Own artifact|SHA256|
|---|---|
|fixtures.py|cb7e05d0063c3ceb41a337b398604b8c71d5f52a3bf7cfe86136a87fdfebb32a|
|fixture-results.json|c881c24c6db521ff604a216b9445e1099610ac6b85310bad73abc216e9fd4098|
|input-hashes-before.json|5e221919812a7af75437876aaa9401855daf7d18e4352f622626b28f2f82864f|

The following **13/13 original nonsecret inputs were byte-hashed before and after analysis and remain unchanged**. No repeated live polling or even one new process/network query occurred during B49.

|Original input|SHA256|
|---|---|
|tmp/b48r-review-f7e02ad/cleanup-os.ps1|6553306c9d75b37f5075f4eca142d4fd1fb9b695e4ad3c95c43af3823de1eb5e|
|tmp/b48r-review-f7e02ad/cleanup-os-A-first-discrepancy.json|59cab63f5d27e75149836cf9b1b42737a4877f20a74adce528e0074ad18f0dfa|
|tmp/b48r-review-f7e02ad/cleanup-os-A.json|59cab63f5d27e75149836cf9b1b42737a4877f20a74adce528e0074ad18f0dfa|
|tmp/b48r-review-f7e02ad/cleanup-current-final.json|5346f91139c2854e643a34d0e4f515fb9e1c11f52fcca3f911700399ea88a0cf|
|tmp/b48r-review-f7e02ad/first-witness-transcript.md|d700a20294278c4009e2cf77365e2816e04cdf8b9d860ad62e377d7ee9e8a937|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/run.json|6bbb0d4942bf4c7309ca4caffb11f4fd86b2948151ce864d15995223f9f677be|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/final.json|b66197ddf4fbb04253dccd4630ba26dbde65594a7c4f09025a8d1901018ee327|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/cleanup-safe.json|a670e0f8c642ea666854b20502491bf9e23f5f092313296bab789ebbf27cbd2b|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/postgres.log|99741f76e88d40e603e2233e1acb884bd5dc6d8d3e6cd506037754f0aa714f44|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/stop.log|ab12e0f5c6e1a3c44d12c860181a586dbe391dfcc0f881f0c5db14be4e22708a|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/stopped-process.log|2193ac55bb8f32b239724640b340748f15bb68b581a8d2be714c25226303c529|
|tmp/b48-native-a-c6850ec7-f31a-4dd1-8bdb-70de055cbc07/stopped-listener.log|86c7a212877f58a81114472740bafdc1fa61f99a1933acd6aab8e84d8328aa3c|
|docs/handoffs/B48-R-OID-EQUIVALENCE-REVIEW.md|3b162c5ea04bd060bb2b60027928774eebdcc1201e957ebece05e987d7661085|

Only this new tracked report changes; fixture artifacts stay ignored. Original witness/script/first failure/current evidence/native roots, B48 source/author report and independent review, shared index/Master document edits, old2359/production5148/preview50963/Ego54/55/shared3013.next/accounts/mail remain untouched. No source product fix, native operation, stop/kill/restart, new agent/window/worktree, install/build/deploy or Golden/state/runtime action.

Master copyable return: B49 offline diagnosis ready_review. Source??: aggregate at is after process/listener queries but before PID-file Test-Path; first35560 lookup time/identity/error details absent. First absentfalse guard FAIL and later absence preserved separately; PIDreuse/exit race/provider causes unresolved, no historical identity/timestamp restoration. Minimum witness specifies startup identity baseline, per-probe UTC+monotonic bounds, separate CIM/GetProcess/error/missing status, lifecycle receipts versus OS absence, immutable first failure and Master-bounded retry/barrier. Pure fixture17PASS only, original13hashes unchanged. Exactly this report tracked; no live/native/process operation. B48 author diagnostic scope stands; independent pair incomplete. Master decides implementation and any later bounded experiment.
