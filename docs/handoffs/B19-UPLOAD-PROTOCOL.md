# B19 — Pure upload protocol and bounded traces

- Owner: Codex(Backend); Master `msg_f03e1becaabc`.
- Status: **ready_review — pure model implemented, no runtime integration or real persistence/Storage readiness**.
- Accepted design: B16-FIX `9302419`, independent B16-R2 `81a03805`. Shared source baseline during final inspection `8d415202462ca9cdda45ee5b3aa6c0c5d397bce4`.
- Last actual local check: **2026-11-17 22:16 KST (13:16 UTC)**; exact final commands/results below. No provider check in B19.

## Files and behavior

| Allowed file | Implemented purpose |
| --- | --- |
| `lib/storage/uploads/schema.ts` | Strict existing-Zod runtime schemas/types, safe counters/UUIDs, owner/asset-bound canonical final identity, exact2GiB ceiling, source identity/media fields, receipts, verification operations, capability reservations and tagged commands. Sanitized protocol error codes and detached frozen snapshots. |
| `lib/storage/uploads/receipt.ts` | Bounded sorted-key canonical JSON convention matching repository serialization; rejects non-JSON/undefined/NaN/Date/bigint/cycles/accessors/symbols/sparse arrays and excessive input. Domain-separated version1 SHA256; receipt shape/digest checking. No signature or worker-execution attestation. |
| `lib/storage/uploads/state.ts` | Deterministic single-object aggregate transitions with explicit principal/time/expected revision, operation fences/lease, generation/reverification, terminal replay, publication reservation, GC barrier/tombstone, issuance accounting, policy epoch/digest, revocation and DB-only admission projection. |
| `lib/storage/uploads/operation.ts` | Separate owner-scoped creation request ledger with normalized client payload, original server snapshot fingerprints, terminal result/status, permanent retired-ID rejection. No actual project/stage/link/audit writes. |
| `tests/storage-upload-protocol.test.ts` | Valid/forged/stale/expired/duplicate and ordered failure traces; fixed-seed bounded serialized interleavings. No socket/PG/fs/media/worker fixtures or clock/random dependency. |

No other implementation or shared type/API/SQL/package file was changed. Production modules import only Zod, `node:crypto` and these sibling protocol modules. No Date.now, random generation, environment access, mutable module-level authority, timers, network/SDK/PG/fs/native imports, runtime wiring or default callback changes. Tests use deterministic injected IDs/counters; a Date object exists solely as rejected-input fixture.

## Accepted rule mapping

| Rule | Implementation and verification |
| --- | --- |
| Object1:receiptN | One aggregate's owner/object/asset/tuple remains fixed; initial finalize registers once, receipts append uniquely per operation/generation. Runtime snapshot checks bind receipt ID/digest/source/media/policy/generation/fence/terminal request digest. Global cross-aggregate key uniqueness remains a future DB constraint, not a module-global map. |
| Independent reverify | Registered object may reserve new owner/policy-manager-authorized generation with own expiry and worker claim. Original intent may be expired. Reverify uses the same final source/tuple/media, cannot publish/replace object, and replaces only current receipt pointer. Old R1 remains readable. |
| Terminal replay before live checks | Exact matching complete/finalize/failure and creation terminal result paths precede current revision/lease/intent/policy expiry checks. Authentication/owner-or-allowed-principal and fingerprint/payload comparison still apply. Historical success returns no new IO authority and does not reset current R2. Changed payload conflicts. |
| Stale lease/fence/CAS | Expected aggregate revision serializes proposed transitions; operation fence/active generation/lease/current policy and expected state revision independently gate incomplete finalize. Reclaim invalidates earlier publication fence; republishing requires a new matching reservation. Renew cannot resurrect expired authority. |
| Invalid bytes | Authorized worker can record enumerated terminal failure; initial invalid upload closes without receipt, reverify failure revokes new admission while preserving registered original/R1. Failure replay is terminal-first and exact-payload bound. This models a supplied observation, does not inspect bytes. |
| Publication before IO / unknown COMMIT | `reservePublication` records exact identity/operation/fence before an instruction can be requested. `publicationInstruction` requires injected **confirmed** persistence knowledge and live matching reservation; unknown/rolled-back status fails RECONCILE. No external upload runs here. Future executor must obtain that knowledge from its authoritative DB, never caller JSON. |
| GC linearization | Same aggregate revision/barrier represents the future common row. Claim requires unregistered canceled/expired object, all issued lifetimes bounded/elapsed; atomically closes it, invalidates pending fences and records permanent cleanup identity. Registered originals cannot be orphan-GC claimed even after receipt expiry/failure. |
| No ready after supported GC | Cleanup/tombstoned states permanently reject publication/finalize/reverify and never reuse the key. Lost cleanup response returns the same claim ticket; different claim ID conflicts. Delete instruction needs confirmed claim commit. Exact tuple digest and barrier fence bind cleanup observations. |
| Late write / cleanup incompleteness | Absent=true with writerQuiescent=false remains cleanup_claimed. Absence plus injected quiescence may tombstone completion; later observed reappearance returns to cleanup pending while remaining permanently closed to ready/reuse. No404→quiescence inference, no guessed finite deadline. |
| Capability issue/remint | Reservation precedes dispatch; unknown horizon blocks remint and GC. Bounded envelope/count/unique issue IDs; one CAS dispatch claim per reservation, only after confirmed reservation commit and within issue window. Uncertain provider result consumes the reservation; a new attempt consumes a new ID. Pure helper conservatively adds explicit latest possible acceptance+token lifetime+resource lifetime+grace, preserving unknown acceptance as null and rejecting overflow. |
| Policy epoch / create admission | Explicit manager epoch advance requires next epoch and policy digest. Incomplete operations/admission must match current epoch/digest, validity, revocation and tuple; future/expired receipts fail. Historical terminal receipt remains queryable after policy change. Actual DB policy/object/state lock ordering remains executor work. |
| Original creation snapshot | Canonical trims only declared client menu/title fields, sorts object keys, preserves other JSON strings/ordered references; binds original menu/config/policy snapshot. Exact retry compares client digest and retains original stored snapshot despite today's changed menu/policy/expiry. Different payload/key conflicts. |
| Retired IDs and lost creation response | Terminal success/failure/cancel result is modeled separately from upload operation; result replay precedes expiry/CAS and returns same project identity. Retiring preserves owner/request/fingerprints and a terminal tombstone; no delete/reset/reuse function. A retired ID returns retired, never new creation. |

## Exact validation

Run from repository root, using existing dependencies (PowerShell's npx.ps1 execution policy rejected the initial wrapper; no execution policy was changed):

```text
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
git diff --check -- lib/storage/uploads tests/storage-upload-protocol.test.ts docs/handoffs/B19-UPLOAD-PROTOCOL.md
```

Final focused result: **32 tests PASS**. Includes table-driven invalid serialization cases; do not add earlier30/27 intermediate runs as distinct coverage. The seeded test performs **64 seeds×24 attempted serialized transitions=1,536 bounded steps**, asserts accepted/rejected coverage and after every step forbids receipts/current-ready/registered state once cleanup was claimed. Explicit competing stale-snapshot finalize/GC proposals show CAS exclusion in either order. This is bounded model simulation, not exhaustive concurrency exploration, executed PG locks or provider IO.

Root TypeScript and targeted ESLint pass with zero diagnostics; documentation diff check clean. Initial development checks caught a test helper's broad union return type and prefer-const; both corrected before final results. No Next typegen/build (shared.next untouched), full product suite, native inspection or actual2GiB benchmark was needed for unconnected pure modules. No earlier B14/B15/native tests are claimed as fresh B19 coverage.

## Explicit unimplemented trust and operational boundaries

Inputs are **trusted executor snapshots, authenticated principal identities, authoritative clock/policy/configuration and external observations injected explicitly**. UUID shape, allowed-principal membership and digest consistency are not authentication, unforgeable credentials, signed snapshots, media validation or native-tool attestation. A caller able to fabricate a coherent entire snapshot/authority list/confirmed-commit flag/quiescence observation is outside this pure model's trust boundary. Tests deliberately show a receipt digest can be recomputed publicly. Unkeyed fingerprints are not encryption or privacy erasure.

Future DB executor must enforce globally unique owner/request/object registrations, atomic CAS/outbox/terminal commits and policy→sorted objects→operations→asset/state→outbox locks, plus least-privilege roles/FORCE-RLS and creator authorization. Returning a proposed snapshot does **not** persist anything or prove a commit. Exact terminal replay is a read, not authority to overwrite newer state. Creation success proposal must commit with actual project/seven stages/refs/audit atomically; none exists here. Cross-object atomicity is not implemented by separate in-memory calls.

Capability horizons and writer quiescence must come from independently established provider/in-flight bounds or stop evidence; callers cannot supply an optimistic number/boolean as security proof. Dispatch CAS is modeled, but future executor must persist it before one signer call, avoid re-executing an uncertain call under that ID, and record/reconcile every attempt. This module does not provide exactly-once external calls, provider token revocation, TUS semantics or actual eventual cleanup. Unknown bounds remain a readiness blocker. No numeric TTL, grace or operational retry policy was newly chosen; all times/lifetimes are injected synthetic values in tests.

Validation arrays/counts/depth/node/JSON-size limits bound this in-memory protocol representation, not a new product retention/verification-lifetime policy. Real tables must preserve deduplication/receipt/history beyond these bounded snapshots. Retiring may remove verbose snapshot/result detail while retaining a nonreusable minimal ID; permanent namespace retirement/purge/privacy enforcement belongs to separately reviewed persistence policy.

Real full-stream hash/size/MIME/decode/ffprobe, source immutability, same-artifact publication/final-byte proof, private Storage RLS/no-overwrite enforcement, receipt issuer credentials and cleanup/delete reconciliation are absent. Current B14 API still deletes its verified scratch artifact; no worker reuse or Vercel request integration was introduced. Actual project remains B17-observed Free50MB/no bucket, worker unassigned; B18 comparison is not paid approval. No actual bucket/upload/DDL/DB registration/API/worker/startup/Scheduler/service/managed/config/subscription/purchase/deployment or3013 operation.

## Transfer and next gate

Request independent review at the fixed B19 commit, particularly terminal replay versus authority, all F1/F2 traces, capability dispatch/unknown horizons, coherent snapshot trust and permanent key/request retirement. After acceptance, Master may separately scope SQL4/versioned runner/isolated PG locking tests; no SQL4 implementation is started or implicitly authorized here. B14/B15/B16 design, original fixture and other authors' WIP preserved.

Master transfer: **B19 ready_review. Four pure protocol modules plus focused tests/report only. Strict runtime shapes, bounded canonical domain digests, object1:receiptN/reverify, terminal-first exact replay, original creation snapshot/retired IDs, lease/fence/revision/policy guards, durable-reservation/confirmed-knowledge instruction gates and irreversible orphan cleanup traces implemented.32 focused tests PASS including64×24 bounded seeded steps; root tsc and targeted ESLint clean. No IO/native/PG/SQL/worker/API/UI/env/package/runtime wiring or operational writes; DB durability/locking/actual byte/provider permissions remain future executor prerequisites, digest is not attestation. Last check22:16KST; independent review requested before further SQL scope.**
