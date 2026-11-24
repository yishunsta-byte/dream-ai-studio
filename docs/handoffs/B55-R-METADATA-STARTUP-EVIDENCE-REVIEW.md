# B55-R independent Startup metadata evidence review

2026-11-18 · Codex(Tester) · Master msg_1bb1789761dd; exact-SHA correction msg_440c819f3c62. Fixed author report is **6dbde42b7cc94a2b63960ff7e384c39d22b19532**, established by git log/show of the B55 report path, exactly one report file. The earlier message's6fb8a03 is not used as a commit. Only this new report and own ignored scratch were written.

**Evidence integrity and completion of the allocated Startup-only measurement: scoped PASS.** Captures support one driver Startup phase/two raw default-provider probes/one same-result native observer, with no Current/TCP/TestPath. **F55-1/P3 requests a small timing-sentence clarification**, not another measurement or a source fix. No provider/internal-acquisition/privacy/absence/profile/B execution PASS is inferred. Original B52 stop/Current0, missing old Flags, and B48 guardFAIL/cause unproven/pair incomplete remain unchanged.

## Exact source and capture provenance

Driver **tmp/b55-windows-metadata-driver/driver.ps1** SHA **18abf6e02c48ae7a795104679f0cb57d570706abb097e445ee9faea579f4cb17** and driver-preflight.json SHA **0a0a5dd2f3a22a9e0ef21588ed98f5d6e0e59b7059a06081911723c0314bab29** match. Preflight script58f0baa2, author offline analyzer6b4ae88a/analysis02f007a3 also match the report. Those scripts were read/hashed, never executed by this review. Preflight's recorded provider/clock zeroes describe preflight, not the later measured Startup.

Collector **e474c132f788c652280d0edbc1217e57716b1ff622b70bdd348936b8612feef9**, observer **461e8b5552ff22c7579780bdd18a52c7c2c0718cc489083bbae174f3047137f2** match current accepted source bytes. Independent AST-only provider body SHA **89f6b17dc433cddfccab01eb999e0cad9ab881c5a74e83e41bcd1c07374c03ac** and observer body SHA **6a4a6fa424e236f7a72fc098637c37173071f8da1a62e54d87abbf5fee01aab5** match header pins. Driver/collector/observer parser errors0. No helper or driver is loaded by the static audit.

Root **tmp/b55-live-9b776934-7e5d-4c9b-8d9e-0e0084d893a1** contains exactly five files; all manifest entries plus hashes.json's own hash match:

|Capture|Verified original-byte SHA256|
|---|---|
|header.json|6d0d44ba2ca93bdf9d455dee127aae570e18c65af61a4ed8a7cb379ed82c4e18|
|startup.json|77eeb480dc42f9921d0a4a4194c3163aafaefa6396333906ca1f06577de971e0|
|metadata.json|c0167c3754e66bf3adde0ce7a7ed0fe0e6ff276dd931810216afb971fa811698|
|driver-result.json|219c555657d775a3c63a736492dc5a4017ae6369952bad96742818e4b6f10ee9|
|hashes.json|d0c192a16149f0389374ebe30428ecc55ea4a2e2378684ce2123d247ca8efdbe|

Original139 protected hashes and all five old B52 captures remain unchanged. File-only integrity checks are not a Current/file-provider observation. Own review creates no replacement input/evidence in either original root.

## Invocation accounting and barriers

Header binds host labelSTAR/PS5.1.26100.9818/64-bit/self69916, attempt9b776934, origin5736240139195/frequency10000000 and configured port65534. Privilege/elevation remains unverified; these self-PID observations do not establish other-target access. No subsequent PID/exited-process query is performed here.

DriverStartupPhases1, PublicStartupCollectionInvocations0, RawProbeInvocations2, ProviderDelegations2, ObserverAttempts1, Current/TCP/TestPath0 agree between result, two requests and two raw records. Driver AST has two exact Invoke-B51RawProbe sites, one `& $originalProvider $Request` site and one `& $observerFunction -CimResult $envelope.Rows[0] ...` site, with public Startup/Current/direct provider/process calls0. The saved schema is correctly **B55-driver-startup-raw-v1**, not the public collector's collection schema.

The first raw GetProcess result passes its binding/row/property/clock barrier before the conditional CIM probe. The wrapper binds phase/provider/index/target/host/attempt/origin, limits delegation to2, preserves FirstFailure and directly delegates the original provider once per request. The same returned CIM row0 feeds the pinned native observer; there is no extra acquisition/class query. Exclusive CreateNew attempt.claim and finite flow support the recorded single attempt/no retry; they are not a durable history/CAS or OS-wide execution ledger. No Current code path exists in the driver.

Stored status startup-only-measurement-returned, FirstFailure=null and DriverError=null are supported by raw present/error0 and native metadata-recorded/error0. The author reports actual exit0; this offline review does not independently rerun its process exit. Unlike B52's stopped shape allocation, the B55 allocation ends at this successful bounded Startup return. It still does not grant a later phase or establish cleanup/absence success.

## Same-result metadata and no-value boundary

The native observer output has InputKind=caller-owned-native-result,45 unique supported names, all seven validity fields true, Errors empty and unknown enum/bit text0. Captured CimType backing is Int32 and Flags backing is Int64; native enum strings/numeric text/width/sign fields are preserved. This is captured metadata, not a DLL version attestation. Required types are ProcessId UInt32/6, Name String/14, CreationDate DateTime/13, ExecutablePath String/14; Handle is a String/key descriptor.

Independent grouping and exact bit-mask arithmetic confirm:

|Kind|Count|Flags numeric text|Enum string|
|---|---:|---|---|
|requested|4|35651588|Property, ReadOnly, NotModified|
|unrequested key Handle|1|35655684|Property, Key, ReadOnly, NotModified|
|other descriptors|40|572522500|Property, ReadOnly, NotModified, NullValue|

Key/NotModified/NullValue annotations agree with retained4096/33554432/536870912 masks. All45 have NotModified, including requested fields whose approved safe values were independently recorded;40 extras have NullValue. This is not a mandatory projection rule or evidence that NotModified means a value was never acquired. No unapproved Value getter is observed or inferred from the bits. B55's metadata cannot reconstruct the old B52 object's unrecorded Flags.

Driver source has no cp variable/Value getter, CommandLine/Environment/CimClass/system-metadata member access or whole native-row dump. Its only `.Value` use is checking an already-approved safe PID field. Static serialization review finds header/scalar summaries, collector safe records and observer metadata, not the returned native envelope. The pinned observer's native path accesses only Name/CimType/Flags through declared accessors; captured metadata-recorded/native InputKind is consistent with that path being exercised once on this result. Internal OS population/acquisition/transmission/cache behavior is still not measured, and privacy/profile decisions remain none/false.

## Clock recomputation and F55-1/P3 wording correction

Independent arithmetic confirms **22 collector clock pairs plus6 wrapper pairs**, all28 ordered by raw ticks and exact offset-aware UTC across both probes. Collector snapshots bind host/attempt/origin/frequency/anchor and SourceSystemUtc/Stopwatch. These are preserved pairs, not a count of every clock API read: header/origin acquisition is separate. UTC/ticks are sequential readings, not atomic instants.

The **six wrapper pairs** are enclosed by each raw probe's Begin/QueryEnd. Raw property reads occur after QueryEnd and before End. Precisely18 collector snapshots (four property Begin/End pairs plus End for each provider) are after their probe's QueryEnd. This is correct source behavior, not clock reversal or an observation failure.

**F55-1/P3:** the author timing sentence “all28 ordered ... and bound within collector Begin/QueryEnd” should explicitly apply the enclosure to wrapper6 only. Suggested wording: **“All28 retained pairs are ordered; the six wrapper interval endpoints are enclosed by the corresponding collector Begin/QueryEnd, while property bounds occur after QueryEnd and before End.”** Underlying captures and the later QueryEnd/envelope explanation support this correction. No new probe, rerun or capture edit is needed; it does not invalidate the Startup-only evidence PASS.

CIM acquisition ticks5736242368153–5736247343630 span **4975477 ticks**. External observer ticks5736247353696–5736248582202 span **1228506 ticks**, beginning after acquisition ends. Observer input Bounds equal acquisition ticks and retain observer461e SourceSha; helper BoundsProvenance remains caller-supplied-unverified-no-clock-read. Those input bounds do not cover the later observer execution, and the wrapper does not relabel the helper as having measured them. QueryEnd includes acquisition plus wrapper/observer/envelope work before safe property snapshots.

Both approved identities retain self69916 and the same executable path, with powershell versus powershell.exe name forms. Start texts **2026-11-18T16:52:42.9060951+09:00** and **2026-11-18T16:52:42.9060950+09:00** differ by exactly **100ns** using integer timestamp arithmetic. They remain unchanged; no rounding, causal diagnosis or exact cross-provider identity equivalence is asserted.

## Offline scope and return

Own ignored **tmp/b55r-review-6dbde42** contains analyze.mjs/analysis.json, static.ps1/static-analysis.json with complete hash checks, source/request counts,45 metadata groups,28 ordered pairs,18 post-QueryEnd snapshots and exact interval/start arithmetic. Analysis reads preserved bytes only. Static.ps1 parses and hashes AST bodies without dot-sourcing or invoking target functions. An initial console projection of an ordered dictionary showed null display fields; casting it to PSCustomObject corrected that presentation only. The saved checks/body hashes were populated and no original data or expected result changed.

Final139/capture/source preservation checks pass. No new live/provider/Clock/helper/driver call, native process/DB operation, product edit, build/deploy/install/policy/account/mail, Golden/state/runtime action or agent/window/worktree. Master TEAM/plan WIP/shared index, Front auth/deployment files, T122/T137 and production/preview/Ego54/55/shared.next remain protected. Operating auth/mail approval-review blocks are unrelated and neither resolved nor bypassed by this measurement. Current remains unallocated and unauthorized.

Master copyable return: exact B55 fixed6dbde42b7cc94a2b63960ff7e384c39d22b19532 evidence/Startup-only allocation scopedPASS; F55-1/P3 timing sentence should say wrapper6 enclosed Begin/QueryEnd, all28 ordered, rawproperty/End18 after QueryEnd. No recapture needed. Driver18ab/preflight0a0a/provider89f6/observer6a4a/source/capture5/139original hashes match. DriverStartup1/publicStartup0/rawprobe2/provider2/nativeobserver1/CurrentTCPfile0;45 types/Flags groups4/1/40/unknown0/validity true. Acquisition4975477 ticks versus externalobserver1228506 separated, callerbounds label intact, starts100ns apart unchanged. Names/NullValue/NotModified do not certify internal acquisition/privacy/absence, oldB52Flags remain missing/B48FAILpairincomplete. No new live/native/value access or further permission.
