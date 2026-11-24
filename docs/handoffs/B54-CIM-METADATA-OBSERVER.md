# B54 same-result CIM metadata observer

2026-11-18 · CX-RECOVERY-01 · Master msg_ea6283ec79c2; accepted msg_f2771fee7e6d. Baseline B53-R **04d25cc75eced6c84487b3fb8c38a9db30f50c62**. **Implementation and injected self-review complete; independent code review pending. No live measurement authorized or performed.**

Exactly three new tracked paths: `tests/helpers/cim-property-metadata.ps1`, `tests/postgres/cim-property-metadata.fixture.ps1`, this report. Existing collector/provider/driver remain unchanged.

## API and explicit execution boundary

`Get-CimPropertyMetadata -CimResult $alreadyOwnedResult -Binding $binding -Bounds $bounds` is the native entry. It accepts an exact local MMI CimInstance type, obtains that object's CimInstanceProperties once, and reads only Name/CimType/Flags via the corresponding native metadata property accessors. There is no provider, clock, callback default, class lookup, process operation, storage, normalization, continuation or B50 connection. No result is fetched by this helper. Its native result path is implemented but has **not** been exercised with a real CIM result in B54.

The mutually exclusive fixture entry uses `-InjectedProperties $array`, with output InputKind=`trusted-injected-metadata`. Those mock metadata objects are controlled by the trusted test/controller and may execute their allowed metadata getters. This is not an arbitrary-object/callback sandbox. A positive control explicitly executes one allowed Name getter, while all sensitive getter traps remain0. Native result acquisition, correct result-to-target association, fresh timing and the caller's authority remain outside this helper.

The source contains four function definitions only. Loading supplied source text defines them without I/O. Local MMI enum/type resolution happens only inside an invocation; there is no assembly-install, Add-Type/compiler, script-file launch or execution-policy change. No public API grants permission to continue a driver.

## Input and result contract

Binding is an exact PSCustomObject of NoteProperties: HostId, AttemptId, Phase (`startup`/`current`), Target (positive integer PID through Int32.MaxValue), Requested (exact ordered array ProcessId/Name/CreationDate/ExecutablePath), SourceSha256 (64 lowercase hex). Host/attempt are nonblank literal strings, maximum128 characters, without controls. Strings are copied without wildcard matching or normalization; requested arrays are cloned. SourceSha256 is an explicit caller claim, not authenticated source provenance.

Bounds is another exact data object: matching HostId/AttemptId/Phase/Target/SourceSha256 plus OriginId, Frequency, BeginTicks, EndTicks. Integers must be nonnegative Int64-compatible native integer types, Frequency positive; end must follow begin with span at most10 seconds at that frequency. BigInteger arithmetic avoids overflow, including maximum frequency/ticks. The helper does not read a clock, establish an actual observation interval or prove freshness. Output labels bounds `caller-supplied-unverified-no-clock-read`. Invalid controller binding/bounds returns before metadata access.

Output has separate Binding, Bounds, Properties, fixed-code Errors and Validity for binding/bounds/collection/property metadata/known enums/duplicates/required metadata. Unevaluated property validity is null. RequiredMetadata checks presence and expected CimType of the four requested names; independent property/enum validity also covers their Flags. Only all checks with zero errors yield `metadata-recorded`; every unsupported/error case yields `stop-review`. Neither status means populated, safe, absent or never acquired. LiveProfileValidated is always false.

Maximum128 property entries are retained; a129th stops and marks the prefix incomplete through Collection=false and PropertyLimitExceeded. Supported identifiers use ASCII CIM-style syntax, length1–128. Bounded malformed raw Name strings are retained with NameOk=false; overlength/nonstring names are omitted with InvalidName, never truncated or coerced. Duplicate detection is case-insensitive; requested-name/type matching is literal and case-sensitive. Empty/null/malformed collections, partial metadata reads, wrong types, duplicate names, missing requested fields and unknown enums/bits remain explicit stop conditions. Additional supported names alone are normal, including the CommandLine **name**, without any NotModified requirement.

Each enum retains EnumType, native general-format EnumString, exact signed/unsigned NumericText, UnderlyingType, BitWidth, UnsignedBitsText, Known and UnknownBitsText. A real Enum and its exact CLR type are verified before native formatting. CLR GetType reflection and static Enum.Format(`G`, equivalent native general format) bypass PowerShell ETS GetType/ToString overrides. Numeric conversion uses the actual underlying integer type; BigInteger handles bit patterns and masks without double rounding, sign loss or Int32 narrowing. All native declared flag bits form the known mask; raw unknown bits remain retained. Defined CimType.Unknown also stops as unsupported.

Key/NotModified/NullValue annotations derive masks4096/33554432/536870912 from the retained bits. They classify metadata only. In particular, NotModified does not prove no internal acquisition; missing NotModified does not prove overfetch. No unapproved value, `cp.Value`, CommandLine/Environment getter, CimClass, system-metadata value, setter, whole native object formatting/serialization or exception message/target dump is used. Error records contain fixed scope/index/field/code only. Results are ordinary mutable data records, not durable witnesses, approvals or a history/CAS implementation.

## Executed validation

Run in the existing tool PowerShell host with source-scriptblock loading:

```powershell
$ErrorActionPreference='Stop'
$b54Source=Get-Content -Raw -Encoding utf8 -LiteralPath tests/helpers/cim-property-metadata.ps1
$b54Fixture=Get-Content -Raw -Encoding utf8 -LiteralPath tests/postgres/cim-property-metadata.fixture.ps1
& ([scriptblock]::Create($b54Fixture)) -ObserverSource $b54Source
```

**85 cases passed, exit0; source/fixture parse0.** SensitiveReads0, ForbiddenProviderProcessClockCalls0, UnexpectedMetadataReads0; ExplicitTrustedMetadataGetterCalls1 is the intentional positive control. NativeLiveResultTested=false and LiveProfileValidated=false. Static AST checks require four definition-only top-level statements and only helper-to-helper commands; forbidden member/clock sites are also checked. Counters cover the named shadowed commands; source/AST review additionally establishes no direct static clock/provider operation. This is fixed-source injected verification, not proof about arbitrary scripts or OS internals.

Cases include extra-name normal controls; full flag combinations above signed32; exact binding copies/literal mismatches; malformed/null/partial/duplicate/required metadata; getter failures; unknown enum/bit retention; 128/129 unique entry boundaries; caller-bound time validation; wrong native-result rejection before its getter; fake/ETS GetType/ToString traps. Actual local MMI enums have CimType Int32 and CimFlags Int64 in this host; no DLL version claim is made. Pure in-memory Reflection.Emit CLR enum fixtures cover min/max of signed and unsigned8/16/32/64-bit backing types, including UInt64.MaxValue. They use no compiler/provider. Integrated MMI flag regressions preserve Int64.MinValue/MaxValue, -1, 2^31 and 2^53+1 exactly; only the known Adopt value passes the known-bit check.

Development failures were corrected before this result: the `[pscustomobject]` accelerator versus actual PSCustomObject type distinction; PowerShell casts rejecting undefined enum integers (fixtures now use Enum.ToObject); a test wrongly expecting the declared Adopt bit to be unknown; PSBase.GetType returning a wrapper rather than underlying enum (now CLR reflection). Two exploratory local-type/output-shape mistakes also returned errors and were corrected. These were source/local fixture diagnostics, not provider attempts. Final85 is the post-correction suite, not a claim that every earlier invocation passed.

SHA256 of current LF source bytes:

|Path|SHA256|
|---|---|
|tests/helpers/cim-property-metadata.ps1|76002503ae4b6ed4e1dff3f6665d53aa37ec5f30cd9ba376762ad087a15e8461|
|tests/postgres/cim-property-metadata.fixture.ps1|d4f3a0eae237573eafb7176b74250c826f116e29537604ac0467ce6917eb9593|

## Preservation and next gate

B52 preservation manifest **139/139** hashes match. Collector e474c132, driver95cbcb2a and all five B52 capture hashes match their accepted records; existing collector/fixture and fixed B53/B53-R reports have no diff. Master TEAM WIP and unrelated T122/T137 are preserved. No actual CIM/Clock/getter live query, old driver execution, target process operation, DB/native cluster, product/build/deploy/install, policy change, account/mail, Golden/state/runtime action, new window/agent/worktree or output artifact store was introduced.

Request independent code/fixture review of these fixed three files. Only afterward may Master separately consider a new **Startup-only once/two provider delegations** scope and its reviewed driver/bounds/profile contract. This helper neither resumes B52 nor supplies that driver. Current remains unallocated; no live profile, requested identity equivalence, cleanup/absence or B execution PASS is claimed. Old B52 full Flags remain unrecoverable; B48 guardFAIL/cause unproven/pair incomplete remain unchanged.

Master copyable return: B54 same-result Name/CimType/full-Flags observer plus fixture/report implemented in exactly3 paths. Final85 injected/local-enum cases pass, parser0, sensitive/provider-process-clock/unexpected traps0; one intentional allowed-metadata getter proves trusted-injection boundary. All widths/signs/MAX/unknown bits retained losslessly; extra names normal; unsupported input stop-review. Source76002503/fixtured4f3a0ea;139 originals/accepted collector-driver/B52 captures preserved. No live result tested or provider/Clock call; request independent code review before any separate Startup-only2-delegation decision.
