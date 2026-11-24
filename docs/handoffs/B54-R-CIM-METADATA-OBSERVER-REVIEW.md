# B54-R metadata-only observer independent review

2026-11-18 · Codex(Tester) · Master msg_a6db9d758587; accepted msg_2777114a1f31. Fixed **7354339c67be60f37749d5a67d1854b408628079**, exactly new observer/fixture/B54 report, reviewed in full against accepted8509826/04d25cc minimum metadata contract. Only this new report and own ignored scratch were written by Tester.

**Changes requested: F54-1 P2, validate Requested array rank before indexed binding validation.** Copied85 fixtures and17 independent cases pass; a separate2-D binding diagnostic throws outside the promised structured stop-review result. It fails closed before metadata access, with no sensitive getter/provider/Clock call or acceptance bypass observed. This is a bounded input/error-contract defect, not a live provider finding or an arbitrary-object sandbox requirement. Native actual-result accessors remain statically reviewed only. No new live measurement or next-gate authorization is implied.

## Source identity and preservation

Observer LF SHA **76002503ae4b6ed4e1dff3f6665d53aa37ec5f30cd9ba376762ad087a15e8461**, fixture **d4f3a0eae237573eafb7176b74250c826f116e29537604ac0467ce6917eb9593** and all three current file texts match fixed7354339. Accepted B53/B53-R report texts match their commits. Original139 preservation entries, collector e474c132, driver95cbcb2a/preflight3fe2da71 and all five B52 capture hashes match before/after review. Old full Flags/CimType remain missing; no original object or driver was rerun to reconstruct them.

## Reviewed boundaries and observed checks

The observer has four definition-only functions and no provider, clock, class query, storage, B50 adapter or continuation API. Binding/source/target and caller-supplied tick bounds are data claims; they do not authenticate authority, prove result-to-target association, freshness or an actual interval. Output correctly labels BoundsProvenance=caller-supplied-unverified-no-clock-read and LiveProfileValidated=false. metadata-recorded is not provider compliance, value population, absence, internal non-acquisition or permission to continue a driver.

Native input requires the exact local CimInstance CLR type before obtaining CimInstanceProperties, and uses the declared CimProperty Name/CimType/Flags accessors through reflection. No cp.Value, system-metadata value, CimClass, setter or whole native-object formatting/serialization path was found. This implementation path has not been exercised here on an actual CIM result; rejecting an injected mock before its fake getter is not live native-path certification.

The separate InjectedProperties entry is explicitly trusted. Allowed metadata getters may execute, as the intentional one-Name-getter control demonstrates; it is not an arbitrary callback/object sandbox. Sensitive Value/CommandLine/Environment/etc. getter traps remain0. ETS GetType/ToString overrides on tested data/enums do not substitute for native enum type/format operations. No broader unknown-input nonexecution promise is inferred for trusted injected Name/CimType/Flags getters.

Enum records retain native type/name, exact signed/unsigned numeric text, bit width, unsigned two's-complement text, known status and unknown bits. Exact native type checks precede formatting; native reflection/Enum.Format bypass the tested ETS method overrides. Underlying integer conversion and BigInteger arithmetic preserve values above2^53, signed64 boundaries and unsigned64 fixture boundaries. Known masks come from declared native flags; these mean locally declared enum bits, not an approved acquisition profile. Derived Key/NotModified/NullValue annotations remain separate and confer no population/privacy guarantee.

Properties are capped at128 with an explicit incomplete-prefix/error result at129; bounded malformed names are preserved without coercion/truncation. Duplicate detection is ordinal case-insensitive, requested/type matching is literal. Additional supported names, including CommandLine as a name without a NotModified flag, do not cause a false shape failure. Unknown enums/bits, missing requested metadata and read errors remain stop-review rather than being dropped or repaired. RequiredMetadata and other validity dimensions are separate; unknown requested Flags cannot yield overall metadata-recorded merely because required names/types are found.

## Executed validation and native-path limits

Exact-copy fixture: **85/85 PASS**, source/fixture parser0, SensitiveReads0, ForbiddenProviderProcessClockCalls0, UnexpectedMetadataReads0 and intentional allowed metadata getter1. NativeLiveResultTested=false/LiveProfileValidated=false. The fixture's in-memory Reflection.Emit enums and local MMI enum tests are not CIM/provider queries or assembly-version attestation. No compiler/install or external host was launched.

Additional **17/17 independent injected/local-enum cases PASS**: extra name with no NotModified accepted; full known flag combination2717913092 retained/annotated;2^53+1 preserves raw9007199254740993 and unknown bit9007199254740992; signed64 minimum and -1 preserve exact full-width representations; declared Adopt is known; null entry/overlength name/case duplicate/string enum reject; invalid bounds prevent metadata getter; exact10s versus10s+tick bounds; supported flat Requested array versus non-array list; one intentional allowed metadata getter; fake native-result type rejected before its fake getters. Sensitive/provider/process/Clock/unexpected counters stay0, intentional allowed getter1.

A separate one-dimensional nonzero-lower-bound array check returns structured stop-review/InvalidBinding as expected. These controls distinguish the multidimensional finding below from rejecting every unusual input or forbidding legitimate metadata callbacks. No actual native CimInstance was acquired or created for a live accessor test. The prior actual B52 captures are read-only evidence, not inputs fed back into a native observer call.

## F54-1 · P2 · Requested rank2 array escapes the structured binding error contract

Location: **tests/helpers/cim-property-metadata.ps1:104–107**. Requested is checked only for `[array]` and Count4, then indexed with a single index. Unlike InjectedProperties at153, Requested has no Rank1 precondition. A2×2 object array containing the four requested strings passes the coarse type/count check and throws NeedMultidimensionalIndex during validation before an InvalidBinding result is returned.

Pure injected reproduction:

```powershell
$requested=[object[,]]::new(2,2)
$requested[0,0]='ProcessId'; $requested[0,1]='Name'
$requested[1,0]='CreationDate'; $requested[1,1]='ExecutablePath'
$fixture.Binding.Requested=$requested
```

Using otherwise valid binding/bounds and trusted injected metadata, both caller ErrorActionPreference=Stop and Continue yielded a caught **NeedMultidimensionalIndex,Get-CimPropertyMetadata**, null function result/Status and zero metadata/sensitive getter calls. Full shape/exception-ID/counter evidence is in rank-results.json. The invocation's diagnostic wrapper returns normally after recording the thrown exception; this is not a successful observer return or a passing regression.

The function safely stops execution before reading metadata, so no acceptance, sensitive-value leak or live behavior is claimed. However, the B54 contract says unsupported controller inputs yield a bounded stop-review record and fixed errors; this ordinary invalid array shape instead loses that record to the error stream. A later caller should not need to infer binding validity from a PowerShell indexing exception.

**Required bounded fix/regression:** require Requested to be a one-dimensional array before indexing, then retain existing exact four-string/order checks. Return the existing structured InvalidBinding stop-review outcome for rank2/rank3 inputs, with no metadata getter invocation and no uncaught exception. Keep ordinary one-dimensional string/object arrays supported and existing non-array/lower-bound rejection behavior. Add fixture assertions for the returned status/code and zero reads under caller Stop/Continue. No new sandbox, provider, storage or driver capability is requested.

## Artifacts, scope and return

Own ignored **tmp/b54r-review-7354339** contains preflight.mjs/preflight.json, byte-identical observer/fixture copies, fixture-replay.json, independent.ps1/independent-results.json, rank-check.ps1/rank-results.json and lower-bound.ps1/lower-bound-results.json. Sources run only through existing-host source-scriptblocks with controlled injected data; inert fixture builder definitions are selected by AST rather than running unrelated fixture setup again. Artifact wrappers write only own scratch. The rank diagnostics retain the unexpected throw rather than lowering its expected structured-output requirement.

Final original139/capture/source/B53 recheck passes. No actual CIM result/property/provider, default Clock, old driver, live OS/network/DB query, target-process operation, native cluster, product/source edit, build/deploy/install/package/config/policy, account/mail/password, Golden/state/runtime action or new agent/window/worktree. Master TEAM/plan/shared index, T122/T137, production5148/preview50963/Ego54/55/shared3013/.next protected; Front T246 browser notices required no action here. B52 Current0 and B48 historical FAIL/pair incomplete remain unchanged.

Master copyable return: B54-R fixed7354339 changes requested F54-1 P2: Requested `[array]`/Count4 check lacks rank guard,2×2 binding throws NeedMultidimensionalIndex with null result under Stop/Continue instead of structured InvalidBinding/stop-review; getter0, no acceptance/leak. Add pre-indexRank1+rank2/3 regression only.85copied+17independent cases PASS and separate lower-bound control structuredreject; sensitive/provider/process/Clock/unexpected0, intentional trusted Namegetter1. Native actual-result accessor path static-only/unvalidatedfalse, callerbounds not measured, no B50/storage/approval link. Original139+source/driver/fivecaptures preserved, no source edits/live/native/build action. Fix before any separately authorized observer driver/live gate.
