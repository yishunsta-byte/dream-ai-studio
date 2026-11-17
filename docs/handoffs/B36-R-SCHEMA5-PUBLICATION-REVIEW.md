# B36-R — Independent schema5 publication contract review

**Verdict: FAIL / return for one P2 design correction (F36-1).** The isolated v3, source identities, migration lifecycle and trust boundaries are coherent with the inspected implementation. The declared closed catalog type does not yet represent all of its required subordinate inventory. Resolve that contract gap before allocating its typed reader/reference implementation. This is a source/design verdict, not a database acceptance result. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_e9b7a9768f2b`; receipt `msg_567473fd755b`. Date: 2026-11-18 Asia/Seoul. Only this tracked report changed.

## Fixed identity and review method

Reviewed all219 lines of `docs/handoffs/B36-SCHEMA5-PUBLICATION-CONTRACT.md` at `0a890f4b494c76a313e8c4d6474bbee70d9ac00a`. Independently verified LF SHA256 **ab3c8f8dc486df98778dbb3168ab8b12612381d319313cdef25b06c6255ba9d3**. Current inspected implementation/SQL bytes matched that fixed commit. No moving WIP was accepted.

Read and compared v1/v2 manifest/state/runner, migrate-v2 CLI, target, connection and provisioning behavior; current reservation service/attempt identity checking; fixed SQL1–5 and prior B33–35 acceptance boundaries. Static hashes and text/shape inspection only. No SQL parser, tests, database connection/process/reference generation, publication, fuse removal, product/registry change, package/config/env edit, browser/provider request, build/deployment or extra agent/window/worktree was used.

Relevant independently matched LF anchors:

| Source | SHA256 |
| --- | --- |
| migration-manifest-v2.ts | c73a60058c29be29216fd32581a2a1ceccfbd8eca2d73013648ba6eed7578c0a |
| migration-state-v2.ts | c51745a4c482732a428374831690ebd1eb5ee310487221cf9a95858465c77f70 |
| migration-runner-v2.ts |11005c7a0ac75cc11db34dfd5afc88822f0e898acfb87d1e4e218622f5efa431|
| scripts/postgres/migrate-v2.ts |36325c91d58270f8389799238ac6b6e93d9c7be076882f569f317423d1c10922|
| provision-template.ts |455938349e1790680467f151d62127bb267363b81dd4e13ce53f4a077eafc19a|
| migration-target.ts |72995ec127c9284333806a5e6e5ec2359c3cf9804d543ad7870c73b9f4ee9b75|
| reservation-attempt.ts |72a3118bd21c0e6edfb5cc2b44eaaba988273c7733e594193c1be05479af550e|
| services/postgres/upload-reservations.ts |9cc0cd6720604fcb163a896442a91a591a7439737be9fae85b77497619b441b5|

SQL1–4 matched respectively `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`, `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. Fused draft D matched `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`. No executable derivative was made in this review.

## F36-1 — Required subordinate inventory has no closed typed representation

**P2, mandatory design correction.** Contract lines110–127 define DomainRow and a closed Catalog5 with exactly13 row arrays: schemas, relations, columns, constraints, indexes, policies, triggers, functions, domains, defaultAcls, dependencies, roles, memberships. There is no non-domain type row/category or subordinate-inventory field. Line130 nevertheless requires explicit table-owned composite/array inventory and automatically generated internal-constraint metadata, and rejection of unexpected types. Thus the required14-category/full-inventory boundary cannot be implemented literally using the supplied closed shape.

The omission is material to the proposed reader/reference allocation, rather than a count typo: DomainRow only accepts `kind:"d"`; RelationRow represents tables; ColumnRow represents columns; neither carries a table row type's or array type's owner/ACL/kind/element/associated-relation identity. DependencyRow records endpoint/type edges, not those object properties. TriggerRow also has no internal marker or parent-constraint/constraint-relation/index identity for the separately required internal-trigger inventory. The named38-trigger sanity total is explicitly noninternal and cannot stand in for that inventory.

Exact source basis: existing `migration-state-v2.ts:47–50` reads domain-like types using `typrelid=0 AND typelem=0`; inheriting that query omits table composites and generated arrays. The new contract correctly says not to inherit v2's incomplete boundary, but must supply its replacement shape. Installed PG18.7 static `share/postgres.bki:3434` separately declares pg_type owner/kind/typrelid/typelem/typarray and ACL metadata; `:7117` separately declares pg_trigger tgisinternal/tgconstraint/tgconstrrelid/tgconstrindid. Fixed SQL5:169–198 adds real tables/FKs, including the deferred cross-table reservation FK. No native bypass or mutation was executed or claimed here.

**One minimal implementable remedy:** amend section4's typed contract and section3's reference envelope before implementation: add a strict `types` array for the reviewed non-domain table-composite/array forms, with stable qualified type/element/array/relation identities, actual kind, owner and applicable ACL properties; retain domains as their separate category. Define the explicit typed internal-constraint/trigger subordinate records (inside the existing appropriate category if preferred), including internal status and stable parent-constraint/related-object keys. Specify how native generated identities are resolved structurally across distinct reference/target clusters, without wildcarding rows or using target-generated expectations. Keep the38 named noninternal trigger count separate. Decoder/query/normalizer/reference hashing must include these records; unknown type/object kinds or subordinate rows reject before journal data is read. This requires no SQL change, old descriptor edit or DB execution in the corrective design task.

Future verification gate: separately authorized reference generation must demonstrate the same normalized subordinate identities across different native OID assignments, and mutations of required/missing/extra type and internal-constraint metadata must fail comparison. Those checks have not been run in B36-R. A prose instruction to include subordinate inventory, without its closed typed representation, does not close this finding.

## Source-consistent decisions and remaining implementation gates

| Area | Independent design assessment |
| --- | --- |
| Closed tools | Separate v3/schema5-only is compatible. Current manifest-v2:6–9 and CLI:16 reject5; state-v2:1469–1477 compares complete3/4 before journal reads. Its queries only cover dream/dream_migrations and nine categories. No old union, query, target profile, template or descriptor should be expanded. |
| D/E/P and adapter | D remains fused/unregistered; historical E is not a publication checksum. P is unset and must have its own full/body hashes and reviewed executable equivalence/diff. Current service:13 hardcodes D; explicit future publication-pin integration must reject D/E in publication mode. B34/35 evidence cannot be relabeled as P or migration-runner acceptance. |
| Owned scope | Declared32 business/companion tables plus separate history,57 policies,38 noninternal triggers,18 functions and two definers are consistent with the fixed source's intended named/dynamic inventories. These are static sanity checks only; expected rows, reference/hash and a database validation are still absent. |
| Catalog/ACL closure | Explicit principal slots, native OID equality, grantor-bearing ACL tuples, defaults, source/definition hashes, exact policy/RLS/index/FK/trigger data and reviewed external dependencies are the right comparison boundary, subject to F36-1. Expected fields must not be learned from the target. History metadata must pass before SELECTing journal rows. |
| Management exception | SQL5:36–47 and425–466 require the exact M→R ADMIN-only edge grantor B, temporary SET/CREATE removal and issuer ownership limited to two entry functions. Contract preserves this rather than broadening old graph exceptions. |
| Login pair | Existing provision-template creates under its caller; actual attempt:31/58–60 counts incoming login memberships and requires exactly one approved login→API edge. Bootstrap-only PASSWORD NULL pair avoids M's incoming ADMIN edge. Existing incompatible pairs reject and require separate remediation; no adoption/revocation is authorized here. |
| State transitions | Fresh→5 atomically, exact eligible4→5, exact5 no-op,3 rejection and unjournaled/drift rejection are coherent. Stronger PG18/M/B/profile/default/grantor eligibility must precede upgrade; v2 complete4 alone is insufficient. Implementation must freeze or explicitly bind the expected prefix3/4 checks and stronger eligibility predicates before generating any apply plan; no target-derived prefix baseline. |
| Lock/atomicity | Reusing exported lock(1725031001,5), RC checks after lock and no intermediate commit preserves cooperating-writer serialization. Fresh journal creation, source bodies/history1–5 and temporary privilege changes must share one transaction; existing4/history/data survive failure. READ ONLY RR dry-run is only an unreserved snapshot. |
| Unknown/cleanup | Proposed original-promise retention, predispatch deadline checks, exact original ACK handling and separate positive socket/pool settlement correct the stricter lifecycle gap in v2. Migration COMMIT loss needs its own native evidence; B35 proves reservation behavior only. Unknown neither retries nor compensates nor mints provenance; later authorized primary inspection may establish exact complete5. |
| Actions/provenance | Source publication, target/action authorization and runtime activation remain separate. Action binding includes target/database identity, M/B, P/body/reference/profile/recipe and limits; M apply and B provisioning are distinct approved actions. Confirmed commit plus fresh full inspection and successful cleanup precede signing. No usable attestation follows unknown/failed cleanup. |
| Signature/handle | Pinned trusted Ed25519 verification plus closed signed facts and private WeakMap membership is implementable as a future internal boundary. A hash, caller JSON, signature field or untrusted key cannot mint it. Signature/expiry/revocation/database/transport/source/native checks and independently authorized policy provenance remain required. No signer/key/activation implementation is accepted by this design review. |
| Runtime readiness | Actual PG18/reference build/locale, Auth, managed privileges/TLS/provider limits, policy authority/body/principals/budgets, evolved executors and B3 composition remain separate gates. Synthetic values or hashes supply none of those permissions. Existing approved-runtime POJO remains DISABLED; future genuine-handle path must also keep activation OFF. |

## Return and acceptance sequence

Return the one-document design for F36-1; preserve the other boundaries. After a fixed corrective document and independent re-review, allocate source publication, typed reference/state, runner/CLI, bootstrap/attestation and published adapter work separately, in the contract's review order. No expected descriptor, P hash, approval authority, native compatibility or implementation acceptance exists merely because this report enumerates the gates.

This review found no second independently substantiated mandatory contradiction. It did not execute the proposed acceptance matrix. Report-only diff/whitespace and selective one-path commit are the performed checks; original sources, fuse, packages/config, shared services and unrelated T122/T137 documents remain untouched.
