# B52-R independent limited-live evidence review

2026-11-18 · Codex(Tester) · Master msg_879af08a431d; accepted msg_20e812bba917. Fixed author report **c20f156bcf7f08ea14433bd22c1d473197046c7c**, evidence root **tmp/b52-live-873ed368-8c54-4255-bac3-a86c5a727b31**. Review is offline file/source/AST analysis only; the original driver and collector were neither loaded nor executed by Tester.

**PASS for evidence integrity, bounded invocation accounting and first-difference return; full planned measurement remains incomplete.** The returned shape difference is supported, Current/TCP/TestPath remain unexecuted, and no absence/provider-compliance/cleanup/B-authorization PASS is warranted. No required correction to the fixed report was found within this evidence-review scope. The reported diagnostic exit0 is consistent with returning this stopped status, not a successful full measurement. No new live/provider/Clock invocation or process operation was performed.

## Fixed source, preflight and artifacts

Driver **tmp/b52-windows-provider-driver/driver.ps1** SHA **95cbcb2ab47c64b7d2403cac379cd5e623cbc57bba69236d7131d2b7215295e7**, driver-preflight.json SHA **3fe2da71610b6d5f0129805795b1386234970e3852e036ff086c8a62bc8cbdb1** and collector SHA **e474c132f788c652280d0edbc1217e57716b1ff622b70bdd348936b8612feef9** match. Fixed c20f156 report text matches the working file. Driver preflight records parser0, one Startup and conditional Current site and one original-provider delegation site, with no direct extra provider/mutation/retry command.

Independent AST parsing gives driver0/collector0 errors, exactly those same call sites and zero direct Get-Process/CIM/TCP/TestPath/process-operation sites in the driver. The wrapper executes `& $originalProvider $Request` once per request; that captured scriptblock comes directly from loading the pinned collector. Recomputed provider function-body SHA **89f6b17dc433cddfccab01eb999e0cad9ab881c5a74e83e41bcd1c07374c03ac** matches header.DefaultProviderTextSha256 without invoking the function. The original exact four-property CIM request/numeric filter/error channels therefore remain the audited source request; this hash is not a measurement of internal Windows behavior.

|Owned capture|Verified original-byte SHA256|
|---|---|
|header.json|ad0befdecaf93e770d294e1d3f9a930ddfbff4b2b5f5a783e6226c6fb7cdd02a|
|startup.json|4dcb2b6209d3b476319075f7b2bca0bd285ae38ccf4065306368cdafeff8204b|
|names-only.json|ceb1bd95e36ce9b819095dc85d2c4338315666a5ded08da97208936a299f3bd5|
|driver-result.json|96d4080883f6c9f5caae3e990affce5d106153fde98f79b31459422576f112c8|
|hashes.json|fb3542d5cd8e46daa6cb51ff9eea18cb0ae97a8da0314ab2108378bcc40417f5|

All four manifest entries and the manifest's own hash match. File inventory is exactly those five files, with no current.json. Preservation manifest SHA **16497637458a2150f30826f048e76fafc6217547899e3eef8bc0bc56636e7c50** matches and **139/139** protected original hashes are unchanged before/after. These are artifact checks, not Current/file-provider observations.

## Invocation and stop accounting

Header binds host labelSTAR, PowerShell5.1.26100.9818,64-bit, self PID74332, attempt873ed368, origin5688784410919/frequency10000000, configured port65534 and own root. Host/privilege are not independently authenticated; report correctly leaves elevation/other-process permissions unverified. There is no new query of PID74332 or its subsequent exit state in this review.

Driver-result records StartupInvocations1, CurrentInvocations0, ProviderDelegations2 and exactly two startup requests: GetProcess index0 and CIM index1, both target74332. Startup contains those two corresponding present records, one provider/safe row each, four successful identity properties each, no query/property/clock/collection errors. Names metadata likewise has two startup entries/one row each and zero inspector errors. These source/counter/capture facts agree; they do not count undocumented internal provider work.

Find-B52Difference tests the completed Startup evidence and detects the CIM UnexpectedNonKeyNames list. The Current call is inside the no-difference branch, which the stored non-null first difference skips. Stored status is **stopped-after-startup-difference-current-not-executed**, FirstDifference=unexpected-returned-nonkey-property-names. TCP65534 is configuration only; no TCP or TestPath request exists and no current.json was written. The one-shot exclusive claim plus single-site finite flow support the recorded one execution/no retry; the claim is not a durable witness/history/CAS implementation or an independent OS-wide execution ledger.

The source returns a summary normally after a diagnostic difference and does not make a stopped status a nonzero process exit. The author-reported tool exit0 is therefore a diagnostic-return outcome; this offline review does not rerun/re-measure that process exit. It is explicitly separate from full measurement completion and is not promoted to PASS for Current or provider profile.

## Clock and identity evidence

Independent exact timestamp arithmetic verifies **22 retained collector clock snapshots**: per provider Begin/QueryEnd/End plus eight property bounds. All have Oktrue, SourceSystemUtc/Stopwatch and matching host/attempt/origin/frequency/anchor; ticks and UTC remain nondecreasing across the ordered sequence and between providers. This is22 preserved collector bounds, not a claim that the driver made only22 clock-related API reads: header/start-origin acquisition is separate. No current clock was called for this review.

GetProcess UTC bounds06:33:37.6470450→37.7007629→37.7313161, ticks5688785637000→5688786166696→5688786482850. CIM bounds06:33:37.7364831→38.4026715→38.4147649, ticks5688786526682→5688793193199→5688793308846, all2026-11-18/+00:00. QueryEnd includes invocation/envelope bookkeeping and wrapper metadata inspection before safe property snapshots; neither it nor the UTC/ticks pair is an atomic native-query timestamp or normalized B50 sample.

Each provider's four retained fields match its whitelist and report. PID74332 and the executable path agree; names are powershell versus powershell.exe. Raw DateTime/Local start texts are **2026-11-18T15:33:37.2411821+09:00** and **2026-11-18T15:33:37.2411820+09:00**. BigInt nanosecond arithmetic yields exactly **100ns**. Both strings remain unchanged. No rounding, cause attribution or exact cross-provider creation-identity equivalence is justified; this difference was not a new probe or the stopping predicate.

## Names, values and acquisition limits

CIM names-only.json has45 unique names: four approved names, derived KeyPropertyNames=[Handle], and40 remaining names, including CommandLine. Independent set subtraction matches the complete saved UnexpectedNonKeyNames list. SystemMetadataMemberNames is Namespace/ServerName/ClassName/Path. These are names, not values. Handle's full original Flags/other bits and the other full flag strings were not saved, so this review verifies the recorded derived key-name classification and source algorithm, not an independent reconstruction of those flags.

Driver AST shows cp member reads only Name/Flags/Name; no cp.Value, CommandLine, Environment or CimClass value member access. Manual source review finds no whole native envelope/row passed to serialization: saved startup is the collector's safe field records, names-only is the bounded derived metadata structure, and header/result contain defined scalar/context summaries. Native metadata system values are not serialized. The approved GetProcess.Path/CIM.ExecutablePath values are intentionally captured and must not be confused with the uninspected CIM system-metadata Path member.

Presence of the CommandLine **name** does not prove its value was populated, null, acquired, transmitted or leaked; neither does not reading cp.Value prove Windows internally acquired no value. The source projection is preserved, but returned schema-name shape differs from the predeclared shape expectation. The evidence cannot choose between representation/provider mechanisms. Full Flags loss is acknowledged and cannot be repaired from these files; no flags/values query was made afterward. The fixed report accurately retains these limitations and does not assert leak or compliance PASS.

A future plan should first specify what non-value metadata would distinguish the relevant representation question and how it would be preserved, including full flag metadata if separately authorized. Do not simply relax the shape barrier based on an unproven explanation, inspect the40 values, infer internal acquisition or resume Current from this report. Any new measurement needs an explicit Master scope; this is a clarification of missing evidence, not probe authorization.

## Return scope and preservation

Own ignored **tmp/b52r-review-c20f156** contains analyze.mjs/analysis.json and static.ps1/static-analysis.json. Analysis reads preserved JSON/source bytes and computes deterministic hashes/timestamp arithmetic. Static.ps1 parses text and hashes an AST body only; no driver/helper is dot-sourced or invoked. No real provider/SystemClock call, live OS/network/DB query, target-process operation, original driver rerun, new native cluster, product/source edit, build/deploy/install/package/config, account/mail/password, agent/window/worktree or Golden/state/runtime action occurred. Only this new tracked report and own scratch were written;139 originals, shared index/Master WIP/T122/T137, production5148/preview50963/Ego54/55/shared3013/.next protected.

Master copyable return: B52-R c20f156 evidence/first-difference return scopedPASS, full planned measurement incomplete and no provider/absence PASS. Driver95cb/preflight3fe/collector e474/body89f6/header agree; five capture hashes and139 originals preserved. Startup1/provider2, Current/TCP/TestPath0;22 retained System clock bounds/error0/identity4 each validated, original starts differ100ns unchanged.45names=4approved+Handle derived key1+40extra are names only; full Flags absent, extra values/unseen OS acquisition unknown. No cp.Value/sensitive value/whole-native serialization in source; exit0 is diagnostic return, not completion. No new probe or permission given; B48 guardFAIL/causeunproven/pairincomplete remain.
