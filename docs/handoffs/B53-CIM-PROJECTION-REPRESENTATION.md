# B53 CIM projection: names versus populated values

2026-11-18 · CX-RECOVERY-01 · Master msg_429841baa984 / clarification msg_20f29ec61b09. Documentation research and preserved-file inspection only; self-review, pending independent evidence review.

**The exact-name expectation was too strict.** PowerShell 5.1 documents that unrequested class properties remain present after `-Property`. B52's 45 names are therefore compatible with a projected representation; names alone cannot establish overfetch. This corrects a future interpretation rule, not the historical result: B52 stopped after Startup, Current/TCP/TestPath remain unexecuted. Neither projection compliance for that particular object nor absence of internal acquisition is proven.

## Fixed evidence and limits

Author report **c20f156bcf7f08ea14433bd22c1d473197046c7c**, independent evidence review **e0af33b9f2792676f0b63c26d4346258e7254052**, collector **44a90ebddf068bd0ffcd4684bcbd0d2626390db8**. B52 retained 45 unique CIM names: requested4, derived key-name Handle1, other40. It retained neither those properties' full original Flags nor their CimType. Full old Flags cannot be reconstructed from the derived key-name list, current documentation, source code, or a later run. No new run was made.

The fixed source requested `ProcessId,Name,CreationDate,ExecutablePath`; its safe snapshots contain only those four approved values. The wrapper inspected Name/Flags to derive names/key names, never `cp.Value` or unapproved values. Source and saved names do not establish what Windows internally fetched, transmitted, cached, or populated. The representation explanation below is documented and consistent with B52, not an empirical classification of all40 old properties.

## Official sources and what they establish

Sources accessed 2026-11-18; all links are Microsoft primary documentation. Short quotations below total fewer than25 words from each source.

1. **[Get-CimInstance, PowerShell 5.1, -Property](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance?view=powershell-5.1#-property)** states: “Other properties of the class are present but they are not populated.” The same section says key properties are included even if unrequested. Thus projection is not a promise that the property-name collection contains only the requested set plus keys. This directly invalidates the old names-only equality assumption as a general API rule; it does not measure this object's values or Windows internals.
2. **[WQL SELECT Statement for Data Queries](https://learn.microsoft.com/en-us/windows/win32/wmisdk/select-statement-for-data-queries)** describes named-property selection and inclusion of system properties in its result. That is a WQL result-set description, not a promise about the managed CimInstance property-descriptor collection. Replacing `-Property` with a SELECT query is not established as a remedy and is not proposed here.
3. **[CimProperty API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.management.infrastructure.cimproperty?view=powershellsdk-7.6.0)** exposes Name, CimType and Flags separately from Value. **[CimFlags API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.management.infrastructure.cimflags?view=powershellsdk-7.6.0)** defines bit combinations including Key=4096, NotModified=33554432 and NullValue=536870912. These pages identify Microsoft.Management.Infrastructure.dll, PowerShell5.1 reference assemblies v1.0.0 and MMI package v3.0.0. The selected SDK7.6 view is reference documentation, not a measurement of B52's installed DLL version; B52 recorded host PowerShell5.1.26100.9818 only.
4. **[Native MI flags, mi.h](https://learn.microsoft.com/en-us/windows/win32/api/mi/ns-mi-mi_constsint64afield)**, updated2024-02-22, describes MI_FLAG_NOT_MODIFIED as “Indicates that the property is not modified.” MI_FLAG_NULL describes a null element. This native reference supplies limited flag semantics, not a managed projection-to-flag guarantee. Neither NotModified nor NullValue proves that a value was never obtained internally, that a sensitive value cannot exist elsewhere, or that the request is privacy-certified. An unset NotModified bit likewise does not prove overfetch.
5. **[Win32_Process class](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)** documents ProcessId as uint32, CreationDate as datetime, Name/ExecutablePath as string, and Handle as a string key. These are schema expectations for a proposed metadata observer, not newly measured types or privileges on this host.

## Minimal proposed metadata contract — not implemented

Inspect only the *same result* of the unchanged projected CIM request, without a second query, class lookup, session, or value probe. For each CimProperty preserve:

|Raw metadata|Representation and derived annotation|
|---|---|
|Name|Exact string; requested-set membership; duplicate detection|
|CimType|Original enum name and lossless underlying numeric text|
|Flags|Full original enum string, lossless underlying numeric text and underlying integer type; retain all bits|
|Key classification|Derived `(Flags & 4096) != 0`; preserve the raw Flags that justify it|

Also derive NotModified/NullValue masks without discarding other bits. Never use floating-point conversion. Classify entries as requested, unrequested-key, or unrequested-nonkey descriptors; these labels do not mean populated, safe, or never acquired. Preserve inspector errors without native-object/message dumps. Bind the record to the attempt, host, phase, target, requested set and pinned source; keep bounded observation/error accounting. No `cp.Value`, unapproved property getter, IsValueModified setter, native-object ToString/formatting/serialization, or system-metadata value access. Approved four-field identity snapshots remain the collector's existing separate output.

This would establish which metadata the new object actually exposed and whether extra descriptors carry particular flags. It still would not establish their values, internal acquisition history, or a universal mapping between projection and NotModified. Do not replace the disproven names-only rule with an undocumented mandatory NotModified/NullValue rule.

## Proposed next Startup/Current gate — no execution authority

First independently review and pin a new observer/driver against this contract. Keep collector44a90eb unchanged. A separately authorized attempt would use one current execution-host PID, Startup once (GetProcess+CIM:2 provider delegations), then at most one Current (GetProcess+CIM/TCP/TestPath:4), maximum6 total, no retry or alternate target/port. Current remains conditional, with no automatic continuation from B52.

Stop before Current on source/request drift; extra invocation; wrong target/binding; query/property/clock/inspector error; unexpected native row/count; missing requested metadata; duplicate names; unreadable or lossy metadata; requested CimType mismatch; inconsistent key annotation; or any unauthorized value access. Preserve partial evidence without querying again. Additional readable descriptors alone are not a failure predicate. Unrecognized enum values/bits are retained and stop for review, not silently removed or labelled acquisition evidence.

Because the full flag profile has never been captured, the minimal next authorization should end after that new Startup metadata capture and return it for independent review. Current stays0 until Master explicitly accepts a named raw metadata profile and authorizes its continuation policy. Only then may a future plan use that profile as a phase barrier; profile acceptance permits a bounded raw measurement, not an absence/provider-compliance verdict. The old B52 driver cannot resume and the old Flags remain missing. No flag pattern in this proposal grants permission to read the40 values.

## Verification and return

Only this new tracked report was written. Official-doc browsing plus local byte/hash/source inspection performed; no collector/old driver loading, live OS/provider/Clock query, process operation, build/deploy, product change, DB or Golden/state/runtime action. The139 entries in B52's preservation manifest still match. Collector SHA256 **e474c132f788c652280d0edbc1217e57716b1ff622b70bdd348936b8612feef9** and all five B52 capture hashes match the accepted B52-R table. Historical reports, Master WIP and unrelated T122/T137 remain untouched. No runtime tests are applicable to this documentation-only change.

Master copyable return: B53 official PS5.1 -Property contract explains retained unpopulated class-property names; exact-name assumption is too strict. B52 stop/Current0 unchanged; names alone cannot prove overfetch, old full Flags unrecoverable. Proposed observer preserves Name/CimType/full raw Flags/key derivation only; NotModified is not a no-acquisition guarantee. Next minimum gate is separately authorized Startup metadata capture and independent profile review before any Current. No new live probe;139 originals/collector/five captures preserved. Request independent source-evidence review, not execution approval.
