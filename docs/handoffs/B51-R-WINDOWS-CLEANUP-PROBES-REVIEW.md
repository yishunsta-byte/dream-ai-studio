# B51-R Windows raw collector independent review

2026-11-18 · Codex(Tester) · Master msg_f8c916a55022; accepted msg_cc5e412f5bb2. Fixed **0d0b5b3ec496ab2923096288a3de6734e8fc73e1**, exactly collector/fixture/new B51 report, reviewed in full. Only this new report and own ignored scratch were written by Tester.

**Changes requested: F51-1 P2, restrict the default CIM acquisition projection before any separately authorized live use.** Function-only load, injected collection/error/timing behavior and all executed fixture expectations pass. The default CIM call lacks a property projection, so safe serialization afterward does not establish the assigned no-CommandLine-acquisition boundary. This is a static query-scope finding, not a live data-leak observation. No default provider/SystemClock or actual OS/network/DB query was executed. B48 original guard FAIL/cause unproven/independent pair incomplete remain unchanged.

## Fixed sources and applicable verification

Collector working-byte SHA **ee8dd36accf28cafdad767596d5f3af76458ee304ef7c8c46879337ab1ae420b**, fixture **1c9aa9175d798262334a1010455fc6cc77b36884d1845fe813d86123a35bee15** and all three current file texts match fixed0d0b5b3. Preservation manifest **tmp/b51-windows-cleanup-probes/preservation-before.json** SHA **706a78ca77b8731f2fc2e5aa5d031afecc136074145cf2ce4ec99514bc8371b9** matches; **117/117** original protected inputs/reports/artifacts are unchanged before/after. Accepted TS helper/test match012c9be. Original scripts/fixtures/native roots/failure outputs were not executed or modified.

Copied collector and fixture bytes into own scratch and ran only those copies through the existing PowerShell host's source-scriptblock invocation. Parser0 and **28/28 author fixture cases PASS**, LiveCmdletCalls0, TargetProcessOperations0. No execution policy, installation or host configuration was changed. No new target process or external PowerShell host was launched.

Independent source-only checks cover the implemented default branches, but **do not certify actual Get-Process/CIM/TCP/Test-Path behavior, native property permissions/races, system clock behavior, Windows-version behavior or no-match classification**. No PSScriptAnalyzer install, TS/full-suite/type/lint/build claim is appropriate for this PS-only review; executed parser/injected fixtures and static source analysis are the applicable checks.

## Confirmed behavior and independent boundary checks

The collector has only function definitions at load. Context construction uses supplied data and no environment/host/path lookup or default time acquisition. Startup captures process-only records; current collection requires exact startup/current host/attempt/origin/ticks/frequency/PID order/port/path agreement before callbacks. Context strings are controller labels and literal path bindings, not authenticated host or canonical filesystem ownership. Trusted injected callbacks are explicit, not an arbitrary-user-code sandbox.

Begin precedes the invoker; QueryEnd follows invocation/envelope/error bookkeeping and precedes row-property snapshots; End follows them. Individual properties also retain separate Begin/End. UTC/Stopwatch ticks/origin/frequency remain separate reads and raw values; no aggregate at is substituted, no conversion into a B50-ready sample occurs. Invalid clocks and within-/cross-probe reversals remain explicit. A raw record's empty status does not erase CollectionErrors or establish a complete collection/gate result.

Provider envelopes require exact boolean completion/scalar flags and arrays. Empty output plus errors remains error; both query error channels are retained without de-duplicating away their provenance. Positive rows plus errors preserve both. Row count/128 limit/incomplete snapshot are explicit. Property PID/port native integral types are bounded rather than coercing strings/bools/floats; mismatching target values are retained with binding errors. Native DateTime Kind is retained, including Unspecified without an invented offset. No no-such-PID error is upgraded to known absence.

Error messages are always replaced by `[native message omitted]`; raw errors retain safe channel/operation/FQID/category/HResult and unclassified-error status, with unsafe or credential-labeled IDs redacted. The safe-row serialization map contains only the declared process/CIM/TCP/file fields; no CommandLine/Environment getter is explicitly read. The distinction between this serialization whitelist and provider acquisition is the remaining finding below.

Additional **16/16 independent injected cases PASS**:

- Seven separate startup/current mismatches (host,attempt,origin,ticks,frequency,port,path) reject with zero query/clock callbacks.
- Same native error appearing in both Terminating and ErrorVariable channels retains both; omitted messages do not expose the synthetic marker. Malformed error envelopes and string completion flags stay errors rather than empty success.
- A per-property end-clock failure retains its failed field bound and marks clock-error; a cross-probe reversal is retained in CollectionErrors separately from otherwise raw-empty records. Wrong clock attempt prevents all invocations.
- Native Unspecified DateTime retains its Kind and no fabricated timezone; wrong TCP port stays partial with actual value and ReturnedPortMismatch; string CIM PID becomes a property error without numeric coercion.

The independent wrapper loads only original function definitions and inert fixture builders. It replaces the live-invoker boundary with a throwing counter and wraps Get-B51Clock to reject a missing injected clock. It also shadows actual provider/process-operation commands. Final counters: **LiveBoundaryCalls0, LiveCmdletCalls0, DefaultClockCalls0, TargetProcessOperations0**. These are local execution guards, not an actual OS process-inventory measurement. Every inspected record/group still marks LiveProfileValidated=false.

## F51-1 · P2 · CIM acquisition is not limited to the safe-row whitelist

Location: **tests/helpers/windows-cleanup-probes.ps1:89**, inside the unexecuted default provider function:

```powershell
Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId='+$Request.Target) -ErrorAction SilentlyContinue -ErrorVariable +nativeErrors
```

The PID filter restricts which process instance is requested. It does not select which properties of that instance are acquired. The call requests an unprojected Win32_Process instance, whose properties include CommandLine; only later, around the row map in Invoke-B51RawProbe, is the output restricted to ProcessId/Name/CreationDate/ExecutablePath. Avoiding `$row.CommandLine` and excluding it from returned JSON is useful, but differs from avoiding acquisition by the CIM request itself. The assignment explicitly requires the latter boundary to be checked. The current source/fixtures cannot substantiate it.

AST-only evidence in static-cim-projection.json confirms the single Get-CimInstance command at89 has ClassName/Filter/ErrorAction/ErrorVariable and **no Property projection**. No cmdlet or default invoker was called to obtain that evidence. The existing sensitive ScriptProperty traps test later dereferencing/serialization only; injected invokers bypass this default query and cannot test its requested property set.

**Required bounded fix:** request only the approved CIM fields at the provider boundary, for example an explicit `-Property ProcessId,Name,CreationDate,ExecutablePath` projection or equivalent bounded SELECT with the same numeric PID binding. Preserve error-variable/terminating channel capture, safe snapshots, timing bounds and no-match-as-unclassified-error behavior. Add a pure AST/source-contract check that the default CIM request selects the allowed fields and excludes CommandLine; do not exercise the default branch or relax the live gate for this fix. Document any unavoidable nonsensitive CIM key metadata separately. Actual provider compliance remains for a separately authorized limited live validation, not assumed from a new fixture.

No evidence of actual CommandLine/Environment acquisition during this review exists because the default branch was never run. The finding prevents carrying a broad default query into that later gate; it does not authorize or require a new live experiment now. No other required issue emerged from this bounded review.

## Artifacts, limits and return

Own ignored **tmp/b51r-review-0d0b5b3** contains preflight.mjs/preflight.json, byte-identical collector/fixture copies, fixture-replay.json, independent.ps1/independent-results.json and static-cim-projection.json. Executed with source-text scriptblocks in the existing host; wrapper file I/O reads new source copies and writes only own diagnostic artifacts. Collector/fixture themselves persist no raw evidence. Only injected invoker/clock paths were used. No default SystemClock execution occurred.

Final117-hash/source/accepted-TS recheck passes. No normalization/B50 adapter import, byte-hash receipt interface, provider certification, durable store/history/CAS/ACK/readiness/B authorization or runtime integration exists. Old first failure is not retroactively passed. No live/native/provider/network/DB query, target-process operation, product/source edit, package/config/install/build/deploy, account/mail/password, Golden/state/runtime action or new agent/window/worktree. Master TEAM/plan WIP/shared index, T122/T137, production5148/preview50963/Ego54/55/shared3013/.next are protected.

Master copyable return: B51-R fixed0d0b5b3 changes requested F51-1 P2: default CIM89 lacks allowed-property projection; post-query whitelist excludes CommandLine from serialization but does not restrict provider acquisition. Add explicit four-field projection+pure AST regression; keep defaultlive/SystemClock unexecuted, later real profile separately authorized. Copied28fixture+independent16 PASS/parser0, actual/default/provider/clock/process counters0,117hashes/acceptedTS unchanged. All liveProfileValidatedfalse/raw-unclassified/noB50-storage-history linkage, B48 guardFAIL/causeunproven/pairincomplete maintained. No required additional abstraction or live experiment is requested by this finding.
