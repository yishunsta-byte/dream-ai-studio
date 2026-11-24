# B54-FIX: validate Requested rank before indexing

2026-11-18 · CX-RECOVERY-01 · Master msg_f45986f60fb3; accepted msg_c892b79f3735. Fixes F54-1 P2 from independent review **2f66a6e3645c43346fd7480b51398faafb052455**, implementation baseline **7354339c67be60f37749d5a67d1854b408628079**. **Self-verification passes; independent re-review pending.**

Requested previously passed the array/Count4 check for a2×2 array, then single-index access threw NeedMultidimensionalIndex instead of returning the promised structured binding rejection. The helper now explicitly requires **Rank1 after the array-type check and before Count/index validation**. Unsupported rank2/rank3 arrays return `stop-review` with `Binding/InvalidBinding`; no metadata reads occur. Existing ordered four-string validation and all other behavior remain unchanged. The entire helper diff is this one added condition plus line wrapping.

Exactly three authorized paths changed: existing `tests/helpers/cim-property-metadata.ps1`, existing `tests/postgres/cim-property-metadata.fixture.ps1`, and this new report. Original B54 report/review are preserved as historical records.

## Verification

Same-host source-scriptblock command, without script-file launching or execution-policy changes:

```powershell
$ErrorActionPreference='Stop'
$b54FixSource=Get-Content -Raw -Encoding utf8 -LiteralPath tests/helpers/cim-property-metadata.ps1
$b54FixFixture=Get-Content -Raw -Encoding utf8 -LiteralPath tests/postgres/cim-property-metadata.fixture.ps1
& ([scriptblock]::Create($b54FixFixture)) -ObserverSource $b54FixSource
```

**99 cases PASS, exit0: original85 retained plus14 new shape/preference cases.** Source/fixture parser0. Each new case explicitly sets caller ErrorActionPreference to Stop or Continue, restores it in finally, and requires exactly one output record, no caught exception and an empty error stream.

|Requested shape, tested under both preferences|Outcome|Metadata getters|
|---|---|---:|
|2×2 rank2;1×2×2 rank3|Structured stop-review/InvalidBinding|0|
|Non-array generic list; rank1 lower bound1; wrong ordered strings|Structured stop-review/InvalidBinding|0|
|Ordinary rank1 string[]; ordinary rank1 object[]|metadata-recorded|18 per case|

All ten invalid shape/order cases have null output Binding, Validity.Binding=false and zero property records. Every Name/CimType/Flags mock getter is instrumented: invalid cases total0 reads, four normal-array positive controls total72 reads. Thus both shape rejection and remaining order validation complete before metadata access, while valid arrays still reach the observer. SensitiveReads0, ForbiddenProviderProcessClockCalls0, UnexpectedMetadataReads0 remain unchanged; the original separate intentional trusted metadata getter remains1. No general sandbox claim is added.

Current LF-byte SHA256:

|Path|SHA256|
|---|---|
|tests/helpers/cim-property-metadata.ps1|461e8b5552ff22c7579780bdd18a52c7c2c0718cc489083bbae174f3047137f2|
|tests/postgres/cim-property-metadata.fixture.ps1|64d6503c22057653701f1ce93b4c6f4800406100acc8863c23403ce375491a9c|

## Preservation and return

Original139/139 preservation hashes match. Original B54 report hash **01963b26845dad4d63cc630a56284de517bce54b355e25574d1199e05c9582ff** and B54-R review hash **9c7c0e49833dcaac965599ab228501c29b1c50f405fda9996b8ed530f89d5180** are unchanged. Accepted collector e474c132, driver95cbcb2a and all five B52 capture hashes match. Front T246/T247 auth WIP, Master plan/TEAM and unrelated T122/T137 files were not touched or included.

No native result/provider/Clock/live query, original driver/collector loading, product change, process operation, build/deploy, policy change, new agent/window/worktree, B50/storage/normalization or execution-capability expansion. NativeLiveResultTested=false and LiveProfileValidated=false. Current remains unallocated; historical B52 stop/old Flags missing and B48 guardFAIL/pair incomplete remain. Request independent F54-1 re-review before any separately authorized Startup-only decision.

Master copyable return: B54-FIX adds Requested Rank1 pre-index guard only.99 cases PASS=old85+new14; rank2/rank3 and list/lower-bound/order controls return structured InvalidBinding under Stop/Continue without error stream or metadata reads; normal string/object arrays retain72 positive-control reads. Source461e8b55/fixture64d6503c, parser0, sensitive/provider/Clock traps0;139 originals/B54 report-review/collector-driver/B52 captures preserved. Exactly helper+fixture+new FIX report; independent re-review requested, no live/Startup/Current authorization.
