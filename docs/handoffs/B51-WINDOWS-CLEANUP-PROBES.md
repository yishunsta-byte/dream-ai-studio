# B51 Windows raw cleanup probe collector

2026-11-18 ? CX-RECOVERY-01 ? Master msg_f92907eec170, progress msg_61ca8a9f1917 ? accepted B49-R2/R3 specification and B50 final pure-helper review **ebaca68395b868f87bf9841ce180ba1c559dfa31**. **Author implementation/injected-fixture verification ready_review; independent code review and separately authorized limited live gate remain.**

Exactly three new tracked paths: `tests/helpers/windows-cleanup-probes.ps1`, `tests/postgres/windows-cleanup-probes.fixture.ps1`, this report. **No live provider invocation occurred.** The default Windows provider branch is implemented but not executed or certified in this task. Every returned record/group explicitly marks LiveProfileValidated=false.

## Entry points, binding and load behavior

The collector file contains only function definitions. Dot-sourcing/loading it performs no provider query, clock read, persistence or other I/O. Fixture AST checks enforce function-definition-only top-level statements and absence of process/mutation/retry commands. The test loads supplied source text; no execution policy was changed.

Public entry points:

- `New-WindowsCleanupProbeContext`: pure construction/validation of caller-supplied HostId,AttemptId,OriginId,OriginTicks,Frequency,unique positive owned Pids,Port,ClusterPath. No environment/current-machine/path lookup or default clock acquisition. Clock origin and frequency must come from the controller in a future authorized run.
- `Get-WindowsStartupIdentityRaw -Context ... -Invoker ... -Clock ...`: one GetProcess and one CIM record per bound PID, no listener/file probe.
- `Get-WindowsCleanupCurrentRaw -Context ... -StartupContext ... -Invoker ... -Clock ...`: requires the same complete startup/current host/attempt/origin/frequency/PID order/port/path binding **before any clock/query**; then process records plus one TCP and one literal PID-file TestPath probe.

Contexts are copied/revalidated before collection, with note-property data and exact string/integer checks; duplicate/coerced PIDs reject. Target PIDs/port/path derive only from the bound context. Every probe records phase/index/provider/target/host/attempt/origin. Host labels are controller assertions, not host authentication; path strings are bound literally, not resolved or validated as filesystem ownership. This is read-only evidence acquisition, not authority attestation or an execution gate.

A single low-level invoker/clock boundary is used throughout each collection. An injected invoker receives the bound request and returns an explicit envelope: Completed boolean, Rows array, Errors array of native ErrorRecord+channel, ScalarPresent boolean and Scalar. An injected clock returns bound UTC/ticks/frequency/host/attempt/origin. Malformed/incomplete envelopes or mismatches close as errors; context mismatches throw before invocation. Injected functions are trusted controller/test callbacks, not a sandbox for arbitrary user code.

When invoker is omitted on an **explicit** collector function call, the default read-only provider uses only Get-Process -Id; Get-CimInstance Win32_Process with numeric PID filter; Get-NetTCPConnection local-port/Listen; or Test-Path -LiteralPath/-PathType Leaf. Nonterminating errors are suppressed from display but captured with ErrorVariable; terminating errors are caught separately. Both channels are retained, without silently dropping duplicate channel reports. This default branch was intentionally never selected by the fixture.

When clock is omitted on explicit invocation, the default reads DateTimeOffset.UtcNow, then Stopwatch.GetTimestamp and Stopwatch.Frequency. No new process is required. Fixtures always inject their clock, so no default system-clock branch was exercised here. Each successful clock snapshot records Source=InjectedClock or SystemUtc/Stopwatch, origin anchor and frequency; injected output is never labeled a native measurement.

## Raw evidence and exact capture positions

Each raw probe records **Begin**, **QueryEnd**, **End**. Begin is taken before invoking the provider. QueryEnd is an upper-bound stamp after provider invocation plus envelope/error bookkeeping and before safe row-property reads. End follows property snapshots and their error capture. Each property also has its own Begin/End and success/value/error record. These are bounded sequential intervals, not atomic query instants; UTC and Stopwatch values are separate reads. No delayed aggregate at is substituted for the first PID lookup time. The collection has no misleading single measurement timestamp.

Clock snapshots retain offset-bearing round-trip UTC, raw integer Stopwatch ticks, Frequency,OriginTicks,OriginId,HostId,AttemptId and source. Bound origin/frequency/host/attempt are validated; invalid begin prevents that query, invalid/query-end/ordering records remain explicit. Monotonic or UTC reversal is clock-error; cross-probe order is checked separately in CollectionErrors. Raw ticks are not converted to normalized nanoseconds or rewritten for B50.

Safe row whitelist:

|Provider|Collected fields|
|---|---|
|GetProcess|Id,ProcessName,StartTime,Path|
|CIM|ProcessId,Name,CreationDate,ExecutablePath|
|TCP|LocalAddress,LocalPort,OwningProcess|
|TestPath|bound Path,Exists; original boolean result also retained separately|

Native signed/unsigned integral PID/port types (including CIM UInt32 and TCP UInt16) are validated without accepting strings/bools/floats, bounded before safe numeric conversion. Time properties retain native DateTime/DateTimeOffset text/type/Kind; Unspecified is not silently assigned a timezone. Unsupported/missing time or inaccessible path becomes an explicit property error, never a reconstructed identity. CommandLine and Environment are not read; fixture getters on those properties remain uncalled. No provider-native whole object, invocation details, target object, stack or environment dump is returned.

Each native ErrorRecord is reduced to safe channel/operation, bounded/redacted FullyQualifiedErrorId, enum Category, Exception.HResult and **Message='[native message omitted]'**. Raw message contents are always omitted, avoiding secret text leakage; IDs with unsafe format/credential-like labels are redacted. Query/property/clock errors remain separate and are also retained as sanitized RawErrors. They are all unclassified-error. Actual no-such-PID/provider-specific absence interpretation remains unverified; even a matching-looking FQID is not promoted to known absence.

ProviderRowCount and safe RowCount differ explicitly when a snapshot cannot be completed. Safe rows are capped at128 with RowLimitExceeded, original count and SnapshotIncomplete; no silent truncation. TestPathValue is the actual boolean when available, distinct from null on invalid/failed scalar acquisition. A false scalar is not a guessed null/missing result. Invalid scalar strings/objects are never echoed.

Raw statuses are empty/present/partial/error/clock-error, with explicit QueryAttempted/ProviderCompleted and error lists. Empty provider output **plus any error is error**, not absence. Positive rows with errors retain both. Property failures are partial (unless query/clock error has priority), and a failed clock after a positive provider preserves its provider count and marks the skipped safe snapshot incomplete. These labels are raw capture summaries, not normalized absence or permission decisions.

No automatic retry/poll/delay/kill/stop exists. The finite prescribed plan is visited once per explicit collection call, retaining failed/not-attempted records; later planned probes are not retries of earlier targets. Callers control any later sampling policy. Startup/current equality checks bind metadata but do not authenticate authority, establish a valid identity baseline or decide a previous failed gate.

## Actual fixture command and results

Executed in the tool's existing PowerShell host using source-text scriptblocks, without invoking .ps1 files through a changed policy or launching another target process:

```powershell
$b51Source=Get-Content -Raw -Encoding utf8 -LiteralPath tests/helpers/windows-cleanup-probes.ps1
$b51Fixture=Get-Content -Raw -Encoding utf8 -LiteralPath tests/postgres/windows-cleanup-probes.fixture.ps1
& ([scriptblock]::Create($b51Fixture)) -CollectorSource $b51Source | ConvertTo-Json -Depth 5
```

**28/28 fixture cases PASS; exit0; LiveCmdletCalls=0; TargetProcessOperations=0.** The script parser reports no errors. Source loading is checked by AST and actual shadow cmdlet traps. All explicit collector calls use injected invoker/clock; the forbidden live Get-Process/CIM/TCP/TestPath function traps remain at0, as do target-process operation traps. Counter0 plus audited absence of creation calls is fixture/static evidence, not a live process-inventory measurement. The wrapper reads only the new source files; the collector and fixture do not write raw evidence.

Coverage includes inert load/context; successful empty results and separate TestPath false; separate startup/cleanup provider/target coverage; positive safe identities/per-property clocks/TestPath true; partial access denied and unsupported time; empty+nonterminating query error; no-match raw error remaining unclassified; positive+error; thrown and incomplete invoker; invalid scalar sanitization; wrong returned PID; invalid begin host/frequency/origin/UTC/clock; monotonic and UTC reversals; startup/current attempt and PID mismatches; duplicate/string PID and numeric host rejection; native unsigned properties; explicit row-limit handling; query-end clock failure retaining original count without retry. Full collection JSON checks exclude a synthetic secret marker, while sensitive-property getter counters remain0.

The fixture initially covered21 cases, then expanded to28 while adding unsigned-native types, strict round-trip clock/type boundaries, explicit clock-source labels, row-limit and query-end failure coverage. Each final expectation passes without a live provider call. No actual Windows provider/no-match classifier, StartTime/Path privileges, kernel process race, real host clock, PowerShell cross-version behavior or OS cleanup outcome is accepted. No PSScriptAnalyzer/dependency installation, TypeScript/lint/build/full-suite claim is made for this PS-only change; parser and executed injected fixtures are the applicable checks.

## Preservation, limits and fixed paths

Preservation manifest `tmp/b51-windows-cleanup-probes/preservation-before.json`, SHA **706a78ca77b8731f2fc2e5aa5d031afecc136074145cf2ce4ec99514bc8371b9**, validates **117/117 original source/report/artifact hashes unchanged**. This includes prior protected102, accepted B50 helper/test/FIX2/final review and final independent evidence. Accepted TS helper/test still match012c9be exactly. Original B48/B49/B50 scripts/fixtures/native roots/failures are neither executed nor modified.

No byte-hash interface or normalization/B50 import/candidate output, provider certification, durable storage/CAS/history/ACK or B execution authorization is connected. Development file hashes below are provenance only, not a collector normalization feature. Old B48 guard remains FAIL/cause unproven/independent pair incomplete. Real read-only probing needs independent code review and a **separate explicit limited live assignment**; this report does not start one.

Only these three new tracked paths change. Existing Master TEAM/plan WIP/shared index and T122/T137 reports, production5148/preview50963/Ego54/55/shared3013.next, accounts/mail, package/config and build/deploy/install state are protected. No new agent/window/worktree or target process.

|New script|SHA256 (working bytes)|
|---|---|
|tests/helpers/windows-cleanup-probes.ps1|ee8dd36accf28cafdad767596d5f3af76458ee304ef7c8c46879337ab1ae420b|
|tests/postgres/windows-cleanup-probes.fixture.ps1|1c9aa9175d798262334a1010455fc6cc77b36884d1845fe813d86123a35bee15|

Master copyable return: B51 raw Windows collector ready_review. Functions-only inert load; explicit startup/current APIs bind context/targets, invoker/clock boundary, per-query/property UTC+Stopwatch ticks/frequency/origin, safe native rows/error metadata with messages omitted, unknown errors never absence. Injected28PASS/parser0/livecmdlet0/targetprocess0, no actual provider/default clock invocation or normalization/B50/storage/history link.117originalhashes/acceptedTS preserved, exact PScollector/PSfixture/newreport3paths. Actual live profile remains unvalidatedfalse; separate independent code review then explicit limited-live gate required.
