# B33 — reservation server adapter foundation

Status: implementation and local validation complete; independent review pending. Production activation remains DISABLED. No native PostgreSQL, parser, cluster, HTTP, UI, provider, build or deploy action was performed for B33.

## Frozen basis and scope

- B32 contract: `5f01b766991f38da4d1a1e1811c87024f5157d2c`; accepted R2 review: `d6bd91b`.
- SQL5 source pin: `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`, PostgreSQL major 18, schema version 5. This is a source identity check, not deployment authorization.
- Exactly six new modules, three focused test files and this handoff. Existing B3, SQL1–5/fuse, codec, model, harnesses, package/config/env, registry and runtime entry points were not edited by B33.
- Concurrent Front T239 baseline is `223bd6bc9f7b7854442c586cab0fd500f513d3bf`: its tsconfig tmp exclusion and B28–31 harness NODE_ENV typing correction are separate from B33. Historical native source hashes and prior acceptance remain historical evidence, not hashes of the post-T239 harness files.

## Server API and boundaries

`postgresUploadReservations(dependencies).reserve(verifiedActor, request, { signal? })` is an explicit server-only foundation. Dependencies contain a snapshotted connection, fixed target metadata, finite limits and an optional trusted synchronous ID generator. Request is exactly `{ requestId, clientJson }`. No caller pool, query callback, SQL, role, environment selection or provider capability is accepted. Existing `createPostgresPool` is used privately with max 1; tests mock that existing import.

The target must explicitly select `owned-synthetic`. `approved-runtime` always returns `DISABLED` before pool creation. A supplied POJO/provenanceId is not authenticated provenance: this foundation has no production bootstrap or trusted runtime attestation mechanism. The internal attempt module is not a runtime activation interface. No existing application path imports the service.

| Module | Responsibility |
| --- | --- |
| `lib/storage/uploads/reservation-client.ts` | Exact v1 client JSON, six MIME values, safe positive byte limit up to 2 GiB, domain-separated SHA-256, strict detached request snapshot. |
| `lib/db/postgres/reservation-replies.ts` | Closed phase-specific SQL5 reply decoder, strict policy/DTO/current shapes, original raw envelope validated by actual B25 encoder and original B19 model. |
| `lib/db/postgres/reservation-outcome.ts` | Frozen closed outcomes with commit/cleanup separated; no raw errors, envelope, SQL or capability leakage. |
| `lib/db/postgres/reservation-attempt.ts` | Private lease ownership, role/function metadata checks, transaction, two-entry workflow, bounded cancellation/deadlines and retained late cleanup. |
| `lib/repo/postgres/upload-reservations.ts` | Only fixed parameterized `read_upload_seed_v1` and `reserve_upload_v1` calls; no direct inserts. |
| `lib/services/postgres/upload-reservations.ts` | Real VerifiedActor gate before request access, immutable configuration/request snapshots and owned-synthetic gate. |

## Transaction and result semantics

Each attempt creates its own pool and checks login identity, non-inheriting API membership, forbidden role ancestry, ownership, server major, empty actor GUC and both exact function OIDs/owners/config/ACLs. Inside READ COMMITTED it sets the fixed API role, actor and local timeouts, then rechecks local identity and function metadata.

A read replay uses the original stored envelope and skips ID generation. A seed generates three distinct UUIDv7 IDs, computes safe integer expiry sums, uses the minimum client/policy/provider byte cap and encodes through B19/B25. Only the SQL5 reserve entry is executed; B25 insert specifications are never executed. Current lifecycle data remains informational and is never substituted for the original reservation. Staged replies require pristine current state and exact prepared raw text. All records retain `issuanceAuthorized: false`.

`commit: confirmed` requires the actual COMMIT acknowledgement. Cleanup failure then retains the validated immutable record as `CLEANUP_FAILED`; it cannot turn a confirmed commit into not-applied. Lost acknowledgement or an unresolved dispatched reserve without confirmed rollback returns `OUTCOME_UNKNOWN`. No automatic retry is performed. Explicit same-key reconciliation uses the caller's original requestId/client digest and a fresh attempt.

The checkout promise remains owned after cancellation/timeout. A late delivered client receives zero SQL, is retired at most once, and its positive public end event is witnessed. Cleanup also tracks private pool.end settlement. release(true) throwing permits at most one public client.end fallback. Missing witnesses, late rejection, end/pool errors and deadline exhaustion yield cleanup failure without mutating a previously returned result. Query rejection does not prove server idle: poisoned/abandoned work receives no rollback, hygiene query or COMMIT. COMMIT and healthy rollback remain observed despite cancellation. Attempt reentry and pool reuse are rejected.

## Validation performed

Final checks, 2026-11-18 KST, after T239 was accepted:

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0, full project.
- `node node_modules/eslint/bin/eslint.js` over all nine new TypeScript files with `--max-warnings 0`: exit 0.
- Focused Vitest: `reservation-client`, `reservation-replies`, `reservation-attempt`: **127 passed**, three files.
- Focused plus `connection`, `project-read-backend`, `upload-reservation-codec`, `storage-upload-protocol`: **299 passed, 12 skipped**, seven files. Native-related environment switches were explicitly `DREAM_PG_INTEGRATION=0` and `DREAM_PG_B25_SCHEMA_TEST=0`. The 12 skips are not native validation evidence.
- Earlier full typecheck exposed three new test typing issues (corrected), existing B28–31 childEnv NODE_ENV typing and an ignored tmp backup included by tsconfig. The latter issues were assigned to Front and fixed independently by T239. A strict nine-root compiler check also passed before the final full check.

Fault tests use controllable original fake driver promises, EventEmitter client/pool events and fake timers/performance, with no wall-clock sleeps. They exercise late checkout success/rejection/never settlement, synchronous abort races, zero-SQL abandonment, release/end/pool failures and missing witnesses, metadata replacement, bad replies, original-envelope/evolved-current separation, poisoned queries, failed rollback, abort around reserve and COMMIT, lost COMMIT acknowledgement, immutable returned outcomes, explicit same-key replay, hygiene failure after confirmed commit, ID faults, bounded byte caps, immutable inputs, reentry, invalid actors and closed configuration/options. Lost-ACK persistence and replay are simulated driver behavior; no native claim is made.

## Remaining gates

Independent review is required before accepting B33. Any later native adapter/role/ACL/failure verification requires its own assigned owned-synthetic task and cleanup evidence. Existing B28–31 native evidence validates its own fixed scope only.

Production still requires authenticated target provenance, approved full schema-v5 provisioning and role/function identity evidence, actual Auth integration, top-level transaction integration, budgets and explicit activation authorization. The adapter's private AsyncLocalStorage does not share B3's private transaction scope; callers must not nest it inside existing B3 transactions. No production route, credential discovery, migration registry change, SQL5 fuse removal or upload issuance was added.
