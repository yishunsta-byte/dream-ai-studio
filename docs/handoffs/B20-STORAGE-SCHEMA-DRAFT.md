# B20 — offline storage verification schema draft

Status: ready for independent review; unpublished draft, **not an operational migration**.
Evidence recorded 2026-11-17 23:54 KST (14:54 UTC). Protocol reference: accepted B19 FIX4 `d9d438a541d82664a6227f0545863da98692e10c`; B19-R5 acceptance `8333bb38`. B20 has no independent acceptance yet.

## Scope and artifacts

Only these four files belong to this change:

- `lib/db/postgres/drafts/0004_storage_verification.sql`
- `tests/postgres/storage-verification-schema.test.ts`
- `tests/postgres/run-storage-verification-local.mjs`
- `docs/handoffs/B20-STORAGE-SCHEMA-DRAFT.md`

No manifest entry, published SQL4, SQL3→4 runner support, API/worker wiring, provider operation, Storage bucket, configuration, paid action or deployment is included. Existing SQL1–3, runner, history format, original 18 business tables, their Auth owner FKs and role graph remain unchanged. Applying this draft makes the existing v1 runner reject `MIGRATION_STATE`; the test asserts that rejection rather than relaxing the runner.

Canonical LF UTF-8 SHA-256:

| Source | SHA-256 |
| --- | --- |
| Published SQL1 | `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19` |
| Published SQL2 | `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100` |
| Published SQL3 | `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` |
| B20 draft | `0385c666162f0c2dcb98c48e38f7cc4a6289c8f826b936d04ad8c3a434efdee8` |

## Model-to-DDL mapping

The draft creates 12 companion tables and six ordinary invoker helpers/trigger functions. There are no SECURITY DEFINER functions and no new role or membership.

| Protocol data | SQL representation and selected guarantees |
| --- | --- |
| Policy/version | Append-only `storage_policy_versions`; current `storage_policies` pointer references a version. |
| Object reservation/publication | `storage_objects`: owner Auth FK, UUIDv7 object/reserved asset, optional same-owner registered asset, permanent bucket/key and reserved asset uniqueness, write-once canonical identity, lifecycle, aggregate revision, barrier, generation, first closure/publication evidence. Registered objects cannot enter orphan GC. |
| Upload admission | `upload_intents`: owner/object composite FK, permanent owner/request identity, exact incoming target, immutable raw request and fingerprint, authorization window and issue envelope. Stored size is bounded at 2 GiB. |
| Verification operation | `storage_verification_operations`: owner/object/intent binding, initial/reverify generation, one initial operation and one active operation per object, immutable request/policy, claim worker/fence/time/verifier evidence, completion and aggregate revision, canceled claim snapshot, terminal result/receipt. Terminal groups cannot be half populated. |
| Verification observation | Append-only `storage_verification_runs`, bound to owner/operation/fence with raw observation hash and outcome. |
| Receipt history | Append-only `storage_verification_receipts`, owner composite FKs to operation/run/asset/object identity and policy/fence. One object supports R1 then R2 without replacing R1. Deferred checks bind successful operation, worker, recorded lease and receipt body. |
| Receipt availability/revocation | `asset_receipt_state`: current receipt binding and append-only JSON history prefix. Deferred checks validate selected event shape, authorizer evidence, same-owner failed operation, revision points and derived availability. |
| GC fence/tombstone | `storage_cleanup_claims`: permanent object claim, barrier/time/claimed aggregate revision, mutable latest observation only. Deferred claim link requires the corresponding closed object. Tombstone needs absent/quiescent evidence; late observations restore cleanup pending without reopening the reservation. Unbound objects use the explicit domain hash of raw `null` identity. |
| Durable delivery intent | `storage_outbox`: immutable exact owner/object/operation/generation/intent/cleanup/key/digest target and raw payload hash. Operation and generation must both exist or both be absent. No prefix deletion target. |
| Capability horizon | `storage_capability_issues`: owner intent/object FK, unique issue ordinal, explicit lifetime/bound evidence and conservative generated horizon; unknown horizon remains NULL. Dispatched issues cannot be reset and known evidence cannot be shortened or replaced. |
| Creation idempotency | `creation_operations`: permanent owner/request identity, v2 client/snapshot/composed fingerprint and raw request, authorization, result/project owner FK, settlement and retirement evidence. Retirement retains terminal proof and identity. No deletion/reuse. |

Helpers are `storage_raw_hash`, `storage_uuid7`, `storage_creation_fingerprint`, `storage_guard`, `storage_cleanup_link_guard`, and `storage_consistency_guard`. Hashing uses exact raw UTF-8 with domain/version framing. It does not perform JavaScript normalization or canonical sorting.

All 12 new tables enable and FORCE RLS. All new table privileges are revoked from PUBLIC, `dream_api` and `dream_worker`; seven explicit owner SELECT policies/grants expose objects, intents, verification operations/runs/receipts, receipt state and creation ledger to `dream_api`. No API write, registration, receipt issuance or GC privilege is granted. No broad worker read/write privilege is added. Helper EXECUTE is revoked from these roles. The original 18 guard triggers and 36 policies remain; the new tables add 12 guards, six deferred constraint triggers and seven owner policies (30 dream tables / 43 policies total).

## Explicit limits and future executor work

This is selected DDL validation, not an implementation of every accepted pure-model transition or of the full runtime trust boundary.

- No claim, heartbeat, finalize, cleanup, creation or admission transition/executor functions are implemented. Row revision `+1` checks do not themselves implement expectedRevision CAS. Callers must supply the expected revision predicate; the test demonstrates an explicit stale predicate updating zero rows.
- No authenticated worker authority, current-clock lease authorization, native byte proof or actual provider fence is established by recorded strings, timestamps, arrays or hashes. Recorded completion-inside-lease checks are not worker authentication. Historical/current verifier allowlists need bounded, authorized runtime interfaces.
- No procedure enforces shared policy→objects→operations→state→outbox lock order or serializable model execution. The real row-lock contention test demonstrates PostgreSQL locking mechanics only. FIX4 per-operation causal prefixes and the complete old-claim lease→later-reclaim temporal rule are not fully encoded as DB constraints. A future executor must reconstruct/validate the accepted protocol state under ordered locks and CAS.
- `creation_operations.revision` is a per-row revision, not the pure model's owner-ledger counter. With permanent rows and preserved settlement/retirement evidence, that counter can be projected as row count + settled row count + retired row count. A stable owner lock/expected-counter adapter is still required.
- Revocation history preserves the semantic JSON array prefix; appending can reserialize the surrounding raw array text. Its JSON event fields are checked by deferred invoker logic, not individual physical FK columns. Selected deferred checks do not establish universal model equivalence.
- A future executor must use the accepted canonical serializer before hashing. Raw JSON semantic checks and SHA-256 do not attest that the worker inspected the claimed bytes.
- No source download/native probe, final rehash, actual no-overwrite publication, provider version enforcement, expiry cancellation, or real quiescence detection is present. No worker is assigned. The 2 GiB database ceiling does not override the observed Free provider 50 MB limit.
- No new registrar role or original asset registration policy is installed. Future narrowly scoped functions/privileges require separate design and review. Managed PostgreSQL compatibility and migration rollout remain untested.

## Actual validation

Final exact synthetic command, exit 0:

```text
node tests/postgres/run-storage-verification-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

Final run: **17 tests passed, 0 skipped**, one test file; started 2026-11-17 23:49:35 KST, Vitest duration 2.75 seconds. This is one final run; earlier pass totals are not additional independent cases.

| Case | Observed assertion |
| --- | --- |
| 1 | Published three source hashes, manifest loader and history remain exact. |
| 2 | Real middle-DDL event-trigger failure after a companion table exists rolls the draft back; original catalog/history and v1 dry-run remain valid. |
| 3 | Atomic draft success; original columns/FKs/RLS/roles/history retained; 12 FORCE-RLS tables; expected old-runner rejection. |
| 4 | Durable reservations; cross-owner composite FK, raw hash, initial/generation uniqueness and incomplete terminal-group rejection. |
| 5 | Canonical target/key and reserved asset uniqueness; identity immutability and deletion denial. |
| 6 | R1 then independent R2 for the same immutable object; raw whitespace retained; current R2 and old R1 both present. |
| 7 | Forged receipt/raw body, generation mismatch and registered-object GC rejection. |
| 8 | Valid R3 finalization reaches `SET CONSTRAINTS ALL IMMEDIATE` before intentional rollback; forged issuer and completion outside recorded lease reject. |
| 9 | Exact outbox target FKs; wrong owner/key, retarget/delete and partial operation/generation pair reject. |
| 10 | Append-only manual revocation; false ready state and history shrink/change reject. |
| 11 | Owner SELECT isolation; API writes, worker new-table reads and helper EXECUTE denied; zero SECURITY DEFINER and unchanged role graph. |
| 12 | Closed-barrier cleanup linkage, canceled prior claim preservation, observation/tombstone, no reservation reuse, late-write cleanup pending. |
| 13 | Two real sessions contend on the object row (`55P03` with 100 ms lock timeout); stale expected-revision predicate updates zero rows. |
| 14 | Unknown capability horizon is NULL; explicit evidence produces the expected bound; reset/shortening/deletion reject. |
| 15 | Creation v2 snapshot/fingerprint, terminal settlement, retirement and permanent dedup identity remain immutable. |
| 16 | Failed reverify requires its owner-bound revocation event; atomic failure/event/unavailable commit preserves R1/R2 and current receipt identity; history edits reject. |
| 17 | Canceled unbound reservation tombstones using explicit null-identity digest without inventing a canonical identity. |

The fixture uses synthetic Auth users and admin SQL transactions. `SET LOCAL ROLE` tests SQL role permissions through a trusted synthetic admin connection; it is not an end-to-end application authentication test. No real media, actual 2 GiB upload or runtime worker was tested.

Static checks, exit 0 on 2026-11-17 23:53–23:54 KST:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/postgres/storage-verification-schema.test.ts tests/postgres/run-storage-verification-local.mjs --max-warnings 0
```

No Next build/type generation was run; shared `.next` was not changed by this task.

## Owned synthetic database and cleanup

Only the explicitly supplied local EnterpriseDB-signed portable PostgreSQL 18.7 binaries were used. The runner verifies signatures, scrubs inherited PG connection variables, initializes its own UTF-8/SCRAM cluster, binds loopback on a chosen ephemeral port, verifies PID/listener ownership and passes an explicit guarded synthetic target. No environment or managed DSN fallback exists in this fixture.

Final evidence directory: `tmp/b20-postgres-5cc72453-b9f8-44c2-8708-d45d1fcdf085`.
`run.json`: PID **45952**, port **59270**, address `127.0.0.1`, database `dream_test_b3`.
After fast stop, `cleanup-safe.json` records `postmasterPidAbsent: true` and `listenerAbsent: true`. No owned PostgreSQL process, listener or transaction remains. Evidence directories are retained; none were recursively deleted.

Earlier owned run suffixes (all have both cleanup flags true):

| Suffix | Result before subsequent fixes |
| --- | --- |
| `a8cdfd39-1efb-4d93-a0d9-f4a3b1bf72d9` | 10 pass / 2 fail: test identifier helper wrongly excluded digits in `sha256`; dependent receipt assertion then had no fixture. Fixed helper and kept fixed table whitelist. |
| `1f6ee4cf-6415-4e9d-94d4-9d8aabba2636` | 10 pass / 2 fail: actual deferred PL/pgSQL record/SQL alias collision rolled receipt transaction back; dependent receipt assertion then failed. Renamed PL variables; expectations retained. |
| `91700ecb-3464-4b97-9ca6-cf12bd7d69b9` | 12 pass. |
| `34bee4c5-9360-4fb6-ae2a-5eec9b866ba3` | 15 pass. |
| `861334a6-51c7-429a-9c0a-75798c617019` | 16 pass. |
| `0ccd9d71-0ddd-4d19-9b94-edfb556d4b7f` | 16 pass after explicit paired-NULL guards. |

The final added unbound-reservation case exposed a draft observation comparison that expected SQL NULL instead of the model's explicit null-identity digest. The draft now uses that domain digest when canonical identity is absent; the final 17-case run includes this correction. No weakened assertion or production resource was used to obtain the pass.

Review gate: independently inspect this exact four-file commit, its draft hash and scope. Any published migration, runner upgrade, executor, privilege expansion or provider/runtime action requires separate work; B20 passing does not make Storage operational.
