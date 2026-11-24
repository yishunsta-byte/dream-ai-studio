# B51-FIX bounded default CIM acquisition projection

2026-11-18 ? CX-RECOVERY-01 ? Master msg_be493a5018b3 ? responds to **F51-1 P2** in independent review **9ea282ffe755b1e9b4f76334bdf7382b946f19cd**, baseline **0d0b5b3ec496ab2923096288a3de6734e8fc73e1**.

**Author fix/self-validation ready_review; independent re-review requested.** Exactly existing collector/fixture plus this new report. Original B51/R reports and static/injected review evidence are unchanged. **No actual provider or default SystemClock invocation occurred.**

## Requested properties versus serialization

The earlier Get-CimInstance used a numeric PID filter but no property projection. That limits the process instances requested, not which fields are acquired. The existing four-field serialization whitelist alone did not establish no-CommandLine acquisition. The review finding is accepted as a source/query-scope defect, not described as an observed live leak.

The default CIM command is now explicitly:

```powershell
Get-CimInstance -ClassName Win32_Process -Property ProcessId,Name,CreationDate,ExecutablePath -Filter ('ProcessId='+$Request.Target) -ErrorAction SilentlyContinue -ErrorVariable +nativeErrors
```

This requests only the approved **ProcessId,Name,CreationDate,ExecutablePath** fields. No CommandLine/Environment property, wildcard or broader SELECT is requested. Numeric PID binding, ErrorVariable capture, terminating-error catch, query/property timing, safe rows and raw/unclassified error behavior are unchanged. Reversing only the inserted Property argument restores the entire collector LF source byte-for-byte to0d0b5b3; there is no other collector control-flow or provider change.

Requested projection, actual provider acquisition and final serialization are distinct boundaries. This fix constrains the source request and retains the output whitelist. It **does not certify real provider compliance**. Any unavoidable nonsensitive CIM key/identity/system metadata returned alongside a projection must be inspected in a separately authorized limited live gate; this task does not assert which extra metadata an actual instance supplies. It does not read an instance to discover that information or assert that serialization proves acquisition minimization.

## Pure AST contract and injected verification

Added Assert-B51CimProjectionContract to the **fixture only**, parsing source without evaluating its default query. It requires:

- Exactly one literal Get-CimInstance command, owned by Invoke-B51WindowsProvider.
- Exactly the four existing default-provider command calls; no added/dynamic command or second CIM variant.
- Exact unsplatted ClassName/Property/Filter/ErrorAction/ErrorVariable parameter shape, Win32_Process literal class, literal approved field array with exactly four entries.
- Original `('ProcessId='+$Request.Target)` filter expression, SilentlyContinue plus append-mode +nativeErrors.

This is a deliberately narrow source regression contract, not a general PowerShell theorem prover or a test of actual CIM traffic. A future intentional equivalent query change would need its own reviewed contract update.

**Eight mutated-source controls are rejected**: missing projection, added CommandLine, wildcard, dynamic field array, broad Query replacement, second CIM request, different class and unbound fixed PID filter. Each mutation is checked to differ from the real source, then only parsed by AST; none is loaded or invoked. The valid source contract passes.

The original **28 injected fixture cases remain** with the same expectations. New fixture wrappers also trap any selection of the default live invoker or missing injected clock, in addition to shadowing actual provider/process commands. They do not alter the collector source. All runtime fixture collection remains injected; the original clock implementation is called only with the explicit fake clock. Parser/source-contract evaluation performs no provider invocation.

Actual command in the existing PowerShell host, no policy change or separate target process:

```powershell
$b51Source=Get-Content -Raw -Encoding utf8 -LiteralPath tests/helpers/windows-cleanup-probes.ps1
$b51Fixture=Get-Content -Raw -Encoding utf8 -LiteralPath tests/postgres/windows-cleanup-probes.fixture.ps1
& ([scriptblock]::Create($b51Fixture)) -CollectorSource $b51Source | ConvertTo-Json -Depth 5
```

**37/37 PASS, exit0, parser0**: prior28 plus valid AST1/eight rejected mutants. Final counters **LiveCmdletCalls0,TargetProcessOperations0,LiveBoundaryCalls0,DefaultClockCalls0**. The wrapper reads new source text; collector/fixture persist no raw evidence. These are injected/static guards, not a live OS inventory measurement. No actual provider, privilege/property race, no-match rule, system clock or Windows-version behavior is validated. PSScriptAnalyzer/install/TS/full-suite/build were not needed or run for this PS-only change.

## Preserved scope and artifacts

The collector remains functions-only at load, explicit startup/current with same-context/PID coverage, per-probe/property raw UTC+ticks/frequency/origin and safe error channels. Empty plus error is not success; no-such-PID stays unclassified. Every output remains LiveProfileValidated=false and raw-only. No normalization/B50 candidate import, original-byte witness interface, storage/history/CAS/ACK or B execution permission was added. Old B48 first guard FAIL/cause unproven/independent pair incomplete remain historical.

Preservation manifest `tmp/b51-fix-cim-projection/preservation-before.json`, SHA **5e3beac71bb5826ffe93600b10235a5c2b051aa2b35c9f166b6f1927788a19bc**, verifies **127/127 protected originals unchanged**: previous117 plus original B51 report, fixed independent review and its copied collector/fixture/static/injected evidence. Original report/review text matches0d0b5b3/9ea282f. The intentionally edited current collector/fixture are not called unchanged; original versions stay fixed in0d0b5b3.

Exactly these three allowed paths are selected. Master TEAM/plan WIP/shared index, T122/T137 reports, old native roots, production5148/preview50963/Ego54/55/shared3013.next/accounts/mail/package/config/build/deploy/install remain protected. No live/native/OS/network/DB query or process operation, new dependency, window/agent/worktree or Golden promotion. Separate independent code review precedes any separately assigned limited live validation; none is started here.

|Changed script|SHA256 (working bytes)|
|---|---|
|tests/helpers/windows-cleanup-probes.ps1|e474c132f788c652280d0edbc1217e57716b1ff622b70bdd348936b8612feef9|
|tests/postgres/windows-cleanup-probes.fixture.ps1|a49ee69ad6e266de46a414762afe1ff0304d545f7acdc5aa77529c163674e8cd|

Master copyable return: B51-FIX F51-1 ready_review. Default CIM now exact four-field Property projection+original numericPID/error channels; removing that one insertion restores whole original collector. AST validcontract1/eight broader-mutant rejections plus original28 =37PASS/parser0, actual/defaultprovider/SystemClock/process counters0.127protectedhashes unchanged, original report/review/evidence fixed. Nonsensitive key/system metadata and actual provider projection compliance unverified for separate live gate; no provider classification/B50/storage/history/B-authorization expansion. Exactly PScollector/PSfixture/newFIXreport three paths for independent re-review.
