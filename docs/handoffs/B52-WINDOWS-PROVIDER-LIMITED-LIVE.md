# B52 limited Windows provider measurement

2026-11-18 · CX-RECOVERY-01 · Master assignment msg_1721af62955e; first difference returned msg_8227b4c71b32; Master stop confirmation msg_e837a60d0497. Fixed collector **44a90ebddf068bd0ffcd4684bcbd0d2626390db8**, accepted source/injected review **ef5d1b131c9aae315e5ea22d4fafeae464b69e38**.

**One limited live driver execution: Startup ran once, then stopped at the first returned-property-name difference; Current did not run.** Get-Process and CIM each returned the current host PID present with four safe identity properties and no captured query/property/clock error. The projected CIM result exposed45 property names, including CommandLine, rather than only requested4 plus key metadata. **Names are not values: no CommandLine/Environment value was accessed or serialized, and internal OS acquisition scope is not established.** No retry or further provider experiment occurred. This is not cleanup success, absence PASS, provider certification or B execution approval.

## Preflight, source and exact invocation scope

Own ignored driver: `tmp/b52-windows-provider-driver/driver.ps1`, SHA **95cbcb2ab47c64b7d2403cac379cd5e623cbc57bba69236d7131d2b7215295e7**. Before live execution, AST/source review verified parser0, exactly one Startup and one conditional Current call site, exactly one unchanged-default-provider delegation site in the wrapper, no direct extra Get-Process/CIM/TCP/TestPath command or process/mutation/retry command. Writes are restricted to own JSON evidence filenames and an exclusive one-shot driver claim. Preflight artifact SHA **3fe2da71610b6d5f0129805795b1386234970e3852e036ff086c8a62bc8cbdb1**. The claim is a development anti-duplicate marker, not a witness storage/CAS/history gate.

Actual command, exactly once in the existing tool PowerShell execution host:

```powershell
$b52DriverText=Get-Content -Raw -Encoding utf8 -LiteralPath tmp/b52-windows-provider-driver/driver.ps1
& ([scriptblock]::Create($b52DriverText))
```

Actual driver exit0 means diagnostic evidence returned, **not that the full planned measurement passed**. Returned status is `stopped-after-startup-difference-current-not-executed`; FirstDifference=`unexpected-returned-nonkey-property-names`; StartupInvocations1/CurrentInvocations0/ProviderDelegations2. An existing host's own `$PID` was used, with no manually launched target workload. No start/stop/kill, new DB/native cluster, window/agent/worktree, alternate PID/port search or post-exit process query was performed.

The wrapper passes every request **once** directly to the original loaded Invoke-B51WindowsProvider scriptblock. It does not copy/change its provider commands. It records only native row type, CIM property names/key-name classification and system-metadata member names from that same result before the original collector's four-field safe snapshot. It never reads `cp.Value`, CimClass, CommandLine or Environment values; no whole native row is serialized. Names inspection errors would be sanitized and stop the phase barrier.

Collector LF SHA **e474c132f788c652280d0edbc1217e57716b1ff622b70bdd348936b8612feef9** matched before execution and remains unchanged. The executed original default-provider body SHA **89f6b17dc433cddfccab01eb999e0cad9ab881c5a74e83e41bcd1c07374c03ac** was independently recomputed from the fixed source's function AST afterward, with no function/provider execution, and matches the header. Thus the command request retained exact four-field Property projection, numeric PID filter and both error channels. Request counters and direct delegation source establish two explicit provider invocations, not a claim about undocumented internal provider activity.

## Actual host, binding and call counts

Host label **STAR**, PowerShell **5.1.26100.9818**,64-bit process. Current execution-host PID **74332**. Privilege/elevation is **not independently verified**; no account/token/environment dump was collected. Successful access below is scoped to this one self PID and does not establish other-process permissions.

Attempt **873ed368-8c54-4255-bac3-a86c5a727b31**; origin ID B52-873ed368-8c54-4255-bac3-a86c5a727b31; actual Stopwatch origin ticks **5688784410919**, frequency **10000000** ticks/s. Context includes only that PID, configured TCP65534, and new own evidence directory:

`tmp/b52-live-873ed368-8c54-4255-bac3-a86c5a727b31`

No postmaster.pid was created. TCP65534 was configured only: it was not queried, followed, stopped or reassigned. No planned Current TestPath invocation occurred. Own evidence-file inventory/byte-hash checks afterward are filesystem artifact verification, not a substitute Current/provider/absence observation.

|Phase/provider|Actual calls|Target/result|
|---|---:|---|
|Startup GetProcess|1|74332, present,1 native/safe row|
|Startup CIM|1|74332, present,1 native/safe row|
|Current GetProcess/CIM|0/0|Not executed after first shape difference|
|Current TCP/TestPath|0/0|Not executed; no inference about listener/file absence|

All22 retained clock snapshots (probe Begin/QueryEnd/End plus four properties' Begin/End for each provider) are actual SystemUtc/Stopwatch, with bound host/attempt/origin/frequency and successful monotonic/UTC order checks. Raw QueryErrors,PropertyErrors,ClockErrors and CollectionErrors are empty. Current self presence is expected and is not a cleanup failure or success verdict. Every fixed collector output still marks LiveProfileValidated=false.

|Provider|Begin UTC|QueryEnd UTC|End UTC|
|---|---|---|---|
|GetProcess|2026-11-18T06:33:37.6470450+00:00|06:33:37.7007629+00:00|06:33:37.7313161+00:00|
|CIM|2026-11-18T06:33:37.7364831+00:00|06:33:38.4026715+00:00|06:33:38.4147649+00:00|

Corresponding raw ticks: GetProcess5688785637000→5688786166696→5688786482850; CIM5688786526682→5688793193199→5688793308846. QueryEnd remains a conservative bound after invocation/envelope bookkeeping, including the names-only wrapper inspection; these are not atomic native-query instants or normalized nanosecond samples. Full per-property bounds are retained in startup.json, not reconstructed from aggregate time.

## Native safe identities and returned names

|Observation|GetProcess|CIM|
|---|---|---|
|Native row type|System.Diagnostics.Process|Microsoft.Management.Infrastructure.CimInstance|
|PID|74332|74332|
|Name|powershell|powershell.exe|
|Native start property|StartTime|CreationDate|
|Raw start text|2026-11-18T15:33:37.2411821+09:00|2026-11-18T15:33:37.2411820+09:00|
|Native time type/Kind|DateTime/Local|DateTime/Local|
|Path/ExecutablePath|C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe|Same returned string|

Both providers supplied all four approved properties successfully, each with its own bounded read. Names differ by provider format, and native start text differs by **100ns**. Both original strings are preserved; no precision adjustment, exact cross-provider creation-identity equivalence or cause of that difference is claimed. This was not probed further. The first driver stopping condition was the returned property-name shape, not a query exception or clock error.

The requested CIM fields were exactly ProcessId,Name,CreationDate,ExecutablePath. The returned CimInstanceProperties collection exposed **45 names**:4 requested, key-name Handle1, additional non-key names40. Full ordered names are retained in names-only.json; the40 additional names are:

```text
Caption, Description, InstallDate, Status, CreationClassName,
CSCreationClassName, CSName, ExecutionState, KernelModeTime,
OSCreationClassName, OSName, Priority, TerminationDate, UserModeTime,
WorkingSetSize, CommandLine, HandleCount, MaximumWorkingSetSize,
MinimumWorkingSetSize, OtherOperationCount, OtherTransferCount,
PageFaults, PageFileUsage, ParentProcessId, PeakPageFileUsage,
PeakVirtualSize, PeakWorkingSetSize, PrivatePageCount,
QuotaNonPagedPoolUsage, QuotaPagedPoolUsage, QuotaPeakNonPagedPoolUsage,
QuotaPeakPagedPoolUsage, ReadOperationCount, ReadTransferCount,
SessionId, ThreadCount, VirtualSize, WindowsVersion,
WriteOperationCount, WriteTransferCount
```

The wrapper read Flags only to derive **KeyPropertyNames=[Handle]**. Complete original flag strings/other bits were **not saved**; no later reconstruction is claimed. That evidence limit was returned separately in msg_8c4d78709d28, with no follow-up query. System metadata member names retained are Namespace,ServerName,ClassName,Path; their values were not read/serialized by the wrapper. Handle's value and the40 additional property values likewise were not inspected.

Presence of a property name does **not** establish its value was populated, null, acquired, serialized, transmitted or requested internally by Windows. The result is consistent with more than one representation/provider mechanism, which this experiment does not decide. Only the explicit source request, returned names/key-name classification and four approved field values were observed. No CIM traffic/internal acquisition trace or broad follow-up query was performed. The first unexpected shape was preserved and the Current barrier stayed closed, as confirmed by Master.

## Evidence integrity, preservation and return

Safe raw collector output is preserved unmodified in startup.json; native envelopes are not dumped. Header/names/driver result and original byte hashes are in the same owned root. No current.json was generated. No witness normalization/B50 invocation, provider-profile promotion, persistence/CAS/history or B execution gate was connected. Driver-owned JSON artifact writes/hashes and its one-shot claim are experiment evidence, not such an implementation.

|Evidence under owned root|SHA256|
|---|---|
|header.json|ad0befdecaf93e770d294e1d3f9a930ddfbff4b2b5f5a783e6226c6fb7cdd02a|
|startup.json|4dcb2b6209d3b476319075f7b2bca0bd285ae38ccf4065306368cdafeff8204b|
|names-only.json|ceb1bd95e36ce9b819095dc85d2c4338315666a5ded08da97208936a299f3bd5|
|driver-result.json|96d4080883f6c9f5caae3e990affce5d106153fde98f79b31459422576f112c8|
|hashes.json|fb3542d5cd8e46daa6cb51ff9eea18cb0ae97a8da0314ab2108378bcc40417f5|

All four manifest hashes were independently rechecked against actual bytes, plus hashes.json itself. Driver source remains its preflight95cbcb2a…95e7 hash. Preservation manifest in driver scratch SHA **16497637458a2150f30826f048e76fafc6217547899e3eef8bc0bc56636e7c50** retains **139/139** protected original hashes, including accepted collector/fixture, TS helper, B48/B49 evidence and B51 final review. Post-run file-only rechecks pass. No original script, report, source, diagnostic or native root was edited or rerun.

Only this report is tracked; driver/evidence remain ignored. Master TEAM/plan/shared index, T122/T137 reports, production5148/preview50963/Ego54/55/shared3013.next, account/mail/deploy/install/config/package state are untouched. No absent-PID, terminated-process, lifecycle reproduction, alternate port or further native/provider experiment was allocated or performed. B48 first guard FAIL/cause unproven/independent pair incomplete remain separate historical facts.

Master copyable return: B52 one limited actual driver returned at first startup shape difference. HostSTAR/PS5.1/PID74332, Startup1 and2 original-provider delegations, ownProcess present/safe4 fields/errors0/default clocks22 recorded. Projected CIM result exposes45 names(4approved+Handlekey1+40nonkey includingCommandLine); names/key-name evidence only, values/internal OS acquisition unproven/fullFlags not retained. Current0/TCP0/TestPath0, no retry/extra PID/port/process action. Root873ed368 startup/header/names/result/hash preserved; collector44a90eb/sourcebody89f6…03ac unchanged/directdelegateonce proven;139originalhashes unchanged. Report ready for independent evidence review; unresolved representation/provider scope requires Master decision, no further experiment started.
