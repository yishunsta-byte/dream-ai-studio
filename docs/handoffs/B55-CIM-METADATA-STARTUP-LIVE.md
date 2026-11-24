# B55 limited Startup-only CIM metadata measurement

2026-11-18 · CX-RECOVERY-01 · Master msg_77d60ee2cc6a; design accepted msg_67cbb6b05c67. Accepted observer review **98c2d9fefd4fb26cf2d61ae46794da2841e1c0b4**; collector **44a90ebddf068bd0ffcd4684bcbd0d2626390db8**, observer **f126c365392f4b4a8d46bcbcbf0ea7af46cb3a44**.

**One authorized attempt returned the complete bounded Startup measurement, exit0, FirstFailure=null.** One driver Startup phase used two unchanged raw probes/default-provider delegations and one same-result native observer call. **Public Startup collection invocation0; Current/TCP/TestPath0.** The native observer returned45 metadata records, errors0, all validity checks true. This is a measured metadata result for one self PID, not a provider/internal-acquisition/privacy/absence PASS or permission for Current. Independent offline review is requested.

## Frozen driver and exact allocation

New ignored driver `tmp/b55-windows-metadata-driver/driver.ps1`, SHA256 **18abf6e02c48ae7a795104679f0cb57d570706abb097e445ee9faea579f4cb17**. Preflight script58f0baa240cd0ffa30da2032744a324b0bd79cd9b9968c707e0cc91a5519fe36; `driver-preflight.json` **0a0a5dd2f3a22a9e0ef21588ed98f5d6e0e59b7059a06081911723c0314bab29**. Preflight was offline AST/file analysis: parser0, source definitions-only, two exact raw-probe sites, one original-provider delegation site, one same-result observer site; direct provider/process, public Startup collection and Current/TCP/TestPath sites0.

The public collector normally continues after a record error. Master therefore expressly accepted a driver-owned single Startup phase: unchanged `Invoke-B51RawProbe` GetProcess/startup/index0, raw validation barrier, then CIM/startup/index1 only if no failure. Both use the original default clock by omitting Clock. The driver does **not** claim to have called `Get-WindowsStartupIdentityRaw` or produced its public collection schema: saved startup uses B55-driver-startup-raw-v1, retaining the unchanged per-probe results. Default provider is delegated exactly once per request with the original bound request.

Pins before loading: collector LF/raw **e474c132f788c652280d0edbc1217e57716b1ff622b70bdd348936b8612feef9**, observer LF/raw **461e8b5552ff22c7579780bdd18a52c7c2c0718cc489083bbae174f3047137f2**. Loaded body hashes match independently parsed AST bodies: provider **89f6b17dc433cddfccab01eb999e0cad9ab881c5a74e83e41bcd1c07374c03ac**, observer **6a4a6fa424e236f7a72fc098637c37173071f8da1a62e54d87abbf5fee01aab5**. The projected ProcessId/Name/CreationDate/ExecutablePath request, numeric PID filter and error channels remain unchanged.

Executed once in the existing tool execution host:

```powershell
$ErrorActionPreference='Stop'
$b55DriverText=Get-Content -Raw -Encoding utf8 -LiteralPath tmp/b55-windows-metadata-driver/driver.ps1
& ([scriptblock]::Create($b55DriverText))
```

An exclusive new attempt.claim prevents an accidental second driver run; it is a development marker, not a durable witness/CAS/history guarantee. No patch/retry, old B52 resume, manually started target process or post-exit PID query occurred.

## Actual host, counts and capture integrity

Host labelSTAR; PowerShell5.1.26100.9818,64-bit; execution-host self PID **69916**. Privilege/elevation was not independently verified. Attempt **9b776934-7e5d-4c9b-8d9e-0e0084d893a1**; OriginId B55 plus that attempt; actual origin ticks **5736240139195**, frequency **10000000**. Context was validated by the fixed New-WindowsCleanupProbeContext. Configured port65534/root slots were inert: no TCP/TestPath request or PID-file creation.

DriverStartupPhases1, PublicStartupCollectionInvocations0, RawProbeInvocations2, ProviderDelegations2, ObserverAttempts1. Recorded requests are exactly GetProcess index0 and CIM index1, startup/self69916 with matching host/attempt/origin. Each raw record is present with one native/safe row, four approved identity fields, query/property/clock errors0. Status `startup-only-measurement-returned` means completion of this allocation only.

Evidence root **tmp/b55-live-9b776934-7e5d-4c9b-8d9e-0e0084d893a1**, exactly five files:

|Original file|SHA256|
|---|---|
|header.json|6d0d44ba2ca93bdf9d455dee127aae570e18c65af61a4ed8a7cb379ed82c4e18|
|startup.json|77eeb480dc42f9921d0a4a4194c3163aafaefa6396333906ca1f06577de971e0|
|metadata.json|c0167c3754e66bf3adde0ce7a7ed0fe0e6ff276dd931810216afb971fa811698|
|driver-result.json|219c555657d775a3c63a736492dc5a4017ae6369952bad96742818e4b6f10ee9|
|hashes.json|d0c192a16149f0389374ebe30428ecc55ea4a2e2378684ce2123d247ca8efdbe|

All manifest entries and its own hash were rechecked offline; no Current artifact exists. No raw native object was serialized: startup contains the collector's approved safe snapshots; metadata contains the fixed observer's metadata-only output plus wrapper intervals.

## Preserved native metadata, not unapproved values

Observer InputKind=caller-owned-native-result, Status=metadata-recorded, Errors empty, all seven Validity fields true. All45 identifiers are unique and supported, with native CimType backing Int32 and Flags backing Int64, exact numeric/enum strings and unknown bits0 retained. Source/target/request bindings match the header. Four requested types are Name String14, CreationDate DateTime13, ExecutablePath String14, ProcessId UInt32=6; Handle is String14/key. Complete per-property types and flags remain in metadata.json.

|Observed group|Count|Original Flags numeric text|Original enum string|
|---|---:|---|---|
|Requested four|4|35651588|Property, ReadOnly, NotModified|
|Unrequested key Handle|1|35655684|Property, Key, ReadOnly, NotModified|
|Other descriptors, including CommandLine name|40|572522500|Property, ReadOnly, NotModified, NullValue|

Thus **NotModified is set on all45**, including the approved requested properties whose separate safe snapshots contain values. **NullValue is set on the other40**. These are observed flag patterns, not direct readings of their Value getters or proof of how Windows obtained data. They are consistent with retained unpopulated descriptors described in B53, but do not certify internal acquisition, transmission or caching. No mandatory NotModified rule was introduced. No cp.Value, CommandLine/Environment value, CimClass, system-metadata value, setter or whole-native-object ToString/dump was accessed. This new observation cannot reconstruct B52's missing old full Flags or change its historical stop/Current0.

## Timing and approved identities

Offline validation checks **22 collector UTC/Stopwatch pairs plus6 wrapper interval pairs**, with all28 ordered across both probes. The six wrapper interval endpoints are enclosed by the corresponding collector Begin/QueryEnd; raw property bounds occur after QueryEnd and before End, and each raw End follows them. These are retained pairs, not an assertion of only28 clock API reads: origin/header acquisition is separate. UTC is read before ticks; pairs are not atomic native-query instants.

|Probe|Begin UTC|QueryEnd UTC|End UTC|
|---|---|---|---|
|GetProcess|2026-11-18T07:52:43.3199397+00:00|07:52:43.3788621|07:52:43.4130467|
|CIM|2026-11-18T07:52:43.4305735+00:00|07:52:44.0548240|07:52:44.0658558|

CIM observer input Bounds use actual same-result **acquisition** ticks5736242368153–5736247343630 (4975477 ticks). The external observer interval is separately measured5736247353696–5736248582202 (1228506 ticks). Both are preserved with UTC pairs. Input SourceSha256 identifies observer461e; BoundsProvenance remains exactly `caller-supplied-unverified-no-clock-read`: the helper itself read no clock. Wrapper measurements do not relabel it or make its input interval cover future observer execution. QueryEnd conservatively includes wrapper/observer/envelope work.

Both approved identities retain PID69916 and path `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`; names are powershell/powershell.exe. Raw native DateTime/Local starts remain **2026-11-18T16:52:42.9060951+09:00** and **2026-11-18T16:52:42.9060950+09:00**, exactly100ns apart. No rounding, cause attribution or exact cross-provider creation-identity equivalence is asserted.

## Offline verification and remaining boundary

Own `tmp/b55-windows-metadata-driver/analyze.ps1` SHA **6b4ae88a045895ca7f1d8cdb8856329818d1873860055520755ce7e1fd54d6a2**, analysis.json **02f007a3b721d9cdfa4939f6025ad3694141afe913f3fab046c74af8a7f66646**. File-only analysis verifies hashes, loaded body pins, native output labels, raw/request/metadata binding, row/field coverage, exact flag annotations, complete clock order and name partition. It never loads the driver/helper or makes a live query. No failure was found requiring another measurement.

Original139/139 hashes, accepted collector/observer/fixture/report-review sources, B52 driver95cbcb2a and all five B52 captures remain unchanged. Only this new tracked report and own ignored driver/captures/analysis were written. Master TEAM and unrelated T122/T137 WIP, Front auth/mail/production/deployment files were untouched. No native DB, target start/stop/kill, build/deploy/install/policy change, account/mail action, Golden/state/runtime integration or new agent/window/worktree. Driver/helper LiveProfileValidated=false; no absence decision. Independent offline evidence review precedes any further allocation; **Current is still unauthorized**. B48 guardFAIL/cause unproven/pair incomplete remain.

Master copyable return: B55 one attempt complete for Startup-only allocation, exit0/FirstFailure null. DriverStartup1/publicStartup0/rawprobe2/defaultprovider2/nativeobserver1; Current/TCP/TestPath0. New root9b776934, self69916;45 metadata=4requested+Handle1+40extras, native enum/raw Flags preserved, errors0/unknownbits0; all45 NotModified,40extra NullValue bits, not internal-acquisition/privacy proof.28 retained clock pairs ordered; acquisition Bounds and external observer interval separate; approved starts differ100ns unchanged. Driver18ab/preflight0a0a/capture hashes fixed;139 originals/B52 captures/accepted sources preserved. Request independent offline review; no new live or Current permission.
