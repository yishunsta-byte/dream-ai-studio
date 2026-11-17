# B21 — versioned PostgreSQL migration contract (design only)

Status: ready_review; no runner, SQL, manifest, package, API or deployment change.
Confirmed against local sources on 2026-11-18 00:12 KST (2026-11-17 15:12 UTC). Current B20-FIX candidate: `eeca88d0fa71639f3fd99bce184f2f727f62523a`; B20-R2 independent re-review is assigned and acceptance is pending. This document proposes a future contract, not an implemented API or authorization to apply SQL4. A mandatory B20 review defect takes priority; any changed SQL4 hash requires a new reviewed candidate and revision of this contract before publication.

## Fixed versions and source identity

Keep the existing v1 `runPostgresMigrations` API and its three-entry manifest unchanged. It accepts only fresh initialization to complete3 or exact complete3 reexecution; it continues rejecting every complete4 or unjournaled draft catalog. Do not reinterpret its counts as lower bounds, append SQL4 to its imported manifest, replace old checksums, backfill history for a draft, or accept arbitrary migration prefixes.

Future explicit v2 selection is a closed set: target schema **3** or **4**. There is no implicit latest/default4. Selection of an unsupported version fails before connecting. Runner API version and database schema version are distinct: v2 can target complete3 with the same frozen first three entries.

| Ordinal / id | Canonical LF UTF-8 SHA-256 | Publication |
| --- | --- | --- |
| 1 / `0001_schema` | `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19` | Existing v1, immutable |
| 2 / `0002_invariants` | `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100` | Existing v1, immutable |
| 3 / `0003_rls` | `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` | Existing v1, immutable |
| 4 / proposed `0004_storage_verification` | `7568cf313b3fb203bda8a8d810b62d8345c0d158931902bef06dffa6703566d4` | B20-FIX candidate only; B20-R2 acceptance pending, unpublished and excluded from every current manifest |

Rejected historical candidate, not a selectable source: B20 `ef38db7965ad1794f00925251e5dcf019646b17f`, draft hash `0385c666162f0c2dcb98c48e38f7cc4a6289c8f826b936d04ad8c3a434efdee8`. B20-R `988da2a` rejected three closure/cleanup JSON missing-field/type/SQL NULL bypasses. B20-FIX reproduced22PASS/3FAIL with unchanged independent expectations, then passed80 local cases (original17 + independent8 + boundary55); that local result is not independent acceptance. See `B20-FIX-JSON-EVIDENCE.md` for reproduction, scope and cleanup evidence.

CRLF→LF is the only source normalization. BOM, comments, whitespace or statement changes otherwise invalidate the hash. Future published SQL4 must match the independently accepted candidate bytes; its release location and frozen manifest are separate work. Do not load drafts by directory scan or trust a caller-supplied manifest/hash. Only checksum-verified fixed sources may have their known outer BEGIN/COMMIT removed for the runner-owned transaction. No arbitrary SQL splitter is proposed.

## Closed catalog models

Both models require exact schema/history ownership by the migration operator; UUID NOT NULL unique `auth.users.id` and REFERENCES/USAGE authority; original 18 table names and Auth owner FKs; exact restricted role flags and allowed membership graph. Optional existing login roles must occur as the complete approved pair, each with only its single ADMIN FALSE / INHERIT FALSE / SET TRUE runtime membership. No role adoption or repair. The migration owner remains the trusted management root, not a runtime principal.

Original table set: `activity_log`, `assets`, `backups`, `characters`, `exports`, `generations`, `jobs`, `plans`, `project_assets`, `project_characters`, `projects`, `renders`, `review_items`, `scene_versions`, `scenes`, `settings`, `stage_states`, `timeline_revisions`.

| Property | complete3 | Proposed complete4 |
| --- | --- | --- |
| History | Exactly ordinals 1–3, exact ids/checksums | Exactly ordinals 1–4; rows 1–3 unchanged |
| `dream` business/companion tables | Exactly original 18 | Exactly original 18 + fixed 12 below = 30 |
| ENABLE + FORCE RLS | All 18 | All 30 |
| Policies | Existing 36 | Same 36 + seven owner SELECT = 43 |
| Existing `guard_row` triggers | Exactly 18 | Same 18; do not compare this name to 30 |
| New `storage_guard` triggers | 0 | Exactly 12 |
| New deferred constraint triggers | 0 | Five `storage_consistency` + one cleanup link = 6 |
| New helper/trigger functions | None from SQL4 | Exactly six B20 functions; zero new SECURITY DEFINER |
| SQL4 role/membership delta | None | None |
| SQL4 grants | None | Default deny + seven explicit owner SELECT grants; no broad worker grants |

The 12 new tables are `storage_policy_versions`, `storage_policies`, `storage_objects`, `upload_intents`, `storage_verification_operations`, `storage_verification_runs`, `storage_verification_receipts`, `asset_receipt_state`, `storage_cleanup_claims`, `storage_outbox`, `storage_capability_issues`, `creation_operations`.

Owner SELECT is limited to objects, intents, verification operations/runs/receipts, receipt state and creation ledger. The six functions are `storage_raw_hash`, `storage_uuid7`, `storage_creation_fingerprint`, `storage_guard`, `storage_cleanup_link_guard`, `storage_consistency_guard`; their signatures and EXECUTE revocations must be pinned to the accepted SQL4. Original columns, constraints, owner FKs, policies, grants and function definitions are not rewritten by upgrade.

Candidate-change impact: B20-FIX strengthens selected constraints inside the existing guards; it adds no table, function, role, membership, policy or privilege. Every count in the complete4 model remains unchanged. The future version4 descriptor must bind the new guard definitions, not merely accept identical object counts: closure/observation required keys, JSON kinds, explicit-null rules and safe integer ranges now reject before casts; deferred GC/target/time predicates fail closed with `IS NOT TRUE`; tombstone evidence compares genuine JSON booleans rather than coercing text. Valid nullable closure operation and genuine true/false observations remain valid. This strengthens recorded evidence checks without adding runtime worker authorization, current-clock checks or any transition executor. Freeze the eventual accepted SQL4 hash and descriptor together after B20-R2; do not publish either candidate merely because its local tests pass.

Counts alone are insufficient: v2's versioned descriptor must check exact object names, owners, RLS, trigger placement/deferral/function binding, selected structural definitions (columns/types/nullability, PK/unique/check/composite FKs), policy role/command/owner predicates, helper signatures/security and relevant ACLs. Generate/review explicit expected descriptors from the accepted fixed sources on synthetic PG; do not generate expectations from the target under test. This is a bounded schema contract, not a claim to detect arbitrary administrator tampering or to validate every protocol transition. Existing v1 checks remain as implemented; do not claim it already performs the expanded v2 inspection.

## State and result contract

Fresh means no `dream`, no `dream_migrations` and no reserved dream roles, while the external Auth prerequisite exists. A journal namespace without its exact table, an unexpected owner, extra/partial/mismatched history, extra dream table, or otherwise unknown catalog is rejected. Unrelated application namespaces are not adopted or modified.

| Observed under lock | Requested version | Apply result | Dry-run plan |
| --- | --- | --- | --- |
| Fresh | 3 | Apply 1–3 atomically; applied 3 / pending 0 | pending 3 |
| Fresh | 4 | Apply 1–4 atomically; applied 4 / pending 0 | pending 4 |
| Exact complete3 | 3 | applied 0 / pending 0 | pending 0 |
| Exact complete3 | 4 | Apply only 4 atomically; applied 1 / pending 0 | pending 1 |
| Exact complete4 | 4 | applied 0 / pending 0 | pending 0 |
| Exact complete4 | 3 | Reject; no downgrade | Reject |
| Partial 1/2, gap/duplicate/extra/unknown history, checksum drift | Either | Reject; no resume/repair | Reject |
| SQL4 objects already present but history only 1–3 or absent | Either | Reject; no adoption/backfill | Reject |
| History 1–4 with missing/partial/drifted SQL4 catalog | Either | Reject | Reject |

Existing v1 on complete4 always rejects; depending on the corruption shape its existing error is HISTORY or STATE. B20's draft-on-history3 fixture specifically returns STATE. Error reporting must not depend on leaking the offending SQL or connection details. Future v2 should retain the existing public SOURCE/TARGET/PRIVILEGE/HISTORY/STATE/FAILED error categories; distinguish unsupported version as SOURCE or a separately reviewed closed code, never as a successful no-op.

## Transaction, lock and concurrent runners

1. Snapshot primitive target/version inputs. Verify selected fixed sources and target fingerprint before opening an owned pool. Reject external pool/factory injection, unsupported mode/profile/version and URL query/hash overrides. A source failure creates no pool.
2. Create one owned max-1 pool and acquire one client. Begin an apply transaction at READ COMMITTED, then take the existing shared transaction advisory lock **(1725031001, 5)**. v1, future v2 and provision template must retain this same lock namespace; a version-specific key would permit unsafe overlap.
3. Inspect identity, privileges, Auth prerequisite, history and catalog **after acquiring the lock**, using queries whose snapshots can observe a preceding runner's commit. A pre-lock plan is never authority to apply. Do not use a pre-lock REPEATABLE READ snapshot for the apply decision.
4. Select only a closed transition from the table above. For fresh4, create history and apply SQL1–3, verify complete3 inside the transaction, then apply SQL4 and insert row4. For complete3→4, revalidate complete3 and preserve rows1–3, apply only SQL4 and insert row4. Verify the exact target catalog/history before COMMIT. Never commit the fresh3 prefix as a separate stage of fresh4.
5. Any source/DDL/history/catalog error before commit rolls back all work of that invocation. Failed fresh4 returns to fresh; failed upgrade returns to unchanged complete3. Incomplete or failed rollback means unknown connection state and client destruction, not proof of rollback.
6. Return success only after confirmed COMMIT command. A lost/ambiguous COMMIT response is FAILED/unknown outcome: destroy the client, close the pool, and require a new approved inspection. Do not compensate with DROP/DELETE or infer rollback. A later exact complete4 reexecution is safe and returns zero applied.

Two target4 callers: the waiter inspects after the first commit and returns applied0, rather than retrying DDL. If the first rolls back, the waiter can apply from the unchanged valid state. Mixed v1/v2 callers: if v1 wins on fresh it creates complete3 and v2 can upgrade after reinspection; if v2 commits complete4 first, v1 rejects. A complete3 request never silently returns complete4 success. The advisory lock serializes cooperating tools only, not arbitrary administrator SQL.

Dry-run retains a READ ONLY REPEATABLE READ inspection transaction and makes no DDL/history/role mutation. It is a point-in-time plan and may become stale immediately; apply repeats every check under lock. A shared apply lock is not acquired inside read-only mode merely to imply a reservation. Lock/statement timeouts must fail with cleanup, not bypass locking.

## Target, lifecycle and secret invariants

| Boundary | Required unchanged behavior |
| --- | --- |
| Explicit target | No general DATABASE_URL, app/SQLite or environment PG fallback; URL has protocol/host/port/db/user/password and no query/hash. Connect with the same frozen target that was hashed. |
| Fingerprint | Preserve existing profile-specific target hash calculation. Separately bind reviewed execution to target hash + requested schema version + selected manifest checksum list; a target hash alone does not approve an upgrade. No password in fingerprint/output. |
| Synthetic | Explicit loopback, named `dream_test_*` DB; TLS-off only via this profile. Fresh Auth fixture and owned database only. |
| Managed Direct | `managed-staging`: exact `db.<20-character projectRef>.supabase.co`; explicit port/db/user, verified TLS hostname/CA and matching actual server identity. Profile label is not proof of staging or permission to connect. No direct-live alias is added. |
| Managed Session | Only existing staging/live session profiles; exact approved `aws-<n>-<region>.pooler.supabase.com`, frontend/backend 5432, independent host/port/db/provider username/actual role/ref binding; `role.ref` routing name and actual role are distinct. Required explicit CA. No transaction-mode pooler or inferred host/suffix. |
| Actual DB identity | PostgreSQL >=16; database/backend port/session_user/current_user exactly match target; authorized migration operator with schema/role/Auth privileges. No IP-string substitution for TLS/DNS hostname verification. |
| Pool lifecycle | Internally owned max1 pool only. Connect failure closes pool; all success/error paths release or destroy client and call pool.end. BEGIN failure, client error, rollback failure and ambiguous COMMIT destroy uncertain client. No reusable poisoned transaction. Cleanup failure cannot be evidence that resources ended. |
| Output/errors | Allow only redacted target hash, requested version, mode, applied/pending and fixed manifest id/checksum (plus closed error code). Never print DSN/password/CA/raw driver error/SQL data, actual host/db/user or provider credentials. No secret CLI arguments or committed env file. |

Support claims must remain separate: the existing implementation accepts PostgreSQL16+ and the above profiles, but B20's SQL4 actually ran only on owned Windows portable EnterpriseDB PostgreSQL18.7, UTF-8, loopback, synthetic Auth. SQL4 has not passed managed Direct/Session or PostgreSQL16/17 testing. A Node server-side process with `pg` and filesystem access to fixed SQL is required; no browser/Edge runtime, import-time migration or automatic application startup hook is proposed. No new binary downloader is included.

Existing `postgresProvisionTemplate()` is a separate complete3-only login provisioning contract and remains unchanged; it must reject history4. It is not part of schema4 migration and must not provision new roles during upgrade. Any future versioned template is separate review/work.

## API alternatives and minimum future files

| Option | Benefit | Risk / decision |
| --- | --- | --- |
| Version-selection wrapper that delegates target3 to v1 and implements target4 separately | Preserves old calls; central choice point | Two lifecycle/inspection implementations can diverge; wrapper must never run v1 commit3 then SQL4 for fresh4, as that breaks whole-operation rollback. Acceptable only if target4 has its own atomic runner. |
| Separate explicit v2 API/CLI with closed target version and isolated frozen manifests/descriptors | Keeps v1 behavior/import graph stable; single v2 transaction path for fresh3/fresh4/upgrade | Some duplicated inspection logic; protect by shared regression fixtures rather than changing v1 mid-rollout. **Recommended initial implementation.** |

Proposed minimum production-source additions, names provisional: `lib/db/postgres/migration-manifest-v2.ts` (frozen versions/source loader), `lib/db/postgres/migration-state-v2.ts` (version descriptors/inspection), `lib/db/postgres/migration-runner-v2.ts` (closed transitions/transaction ownership), and `scripts/postgres/migrate-v2.ts` (explicit version selection/redacted output). Reuse existing target/connection/error/lock exports without changing their behavior. SQL4 publication needs its own approved fixed source location after B20 acceptance; do not import the mutable draft directly. Add focused contract/integration test files and an owned synthetic runner; document invocation in a dedicated handoff. No package script is necessary initially. Existing v1 manifest/runner/CLI/provision template, SQL1–3, runtime APIs and package remain unchanged. These are future file proposals, not files created by B21.

## Required follow-up verification matrix (not run in B21)

| Layer | Required evidence before implementation acceptance |
| --- | --- |
| Pure contract | Closed version selection; exact ordered manifests/hashes; LF-only normalization; unknown/pool injection/target mismatch rejected; no DSN in logs/errors; v1 regressions unchanged. |
| Owned real PG transition | Fresh3, fresh4, complete3→4, complete3→3 and complete4→4 zero reapply; exact version-specific catalog/history/ACL/role/FK checks. Test PG16/17/18 before claiming all supported for SQL4. |
| Negative catalog/history | Unknown/partial/gap/extra/checksum/owner mismatch, missing object and extra table, altered RLS/policy/trigger/FK/ACL, unjournaled SQL4 all reject without repair. Version3 rejects complete4. |
| Atomicity | Inject failure in SQL2/SQL4 and after row4 insert/before commit; verify fresh rollback vs retained complete3, including roles/history/catalog. No previous data changes on failed upgrade. |
| Concurrency | Two real clients: fresh4/fresh4, upgrade4/upgrade4, mixed v1/v2 and rollback winner; demonstrate blocked waiter and post-lock reinspection with exact applied counts. No sleep-only inference. |
| Lifecycle | Connect/BEGIN/lock/inspection/DDL/COMMIT/rollback failures, lost COMMIT response, client error and pool close failures; prove release/destroy/end paths and separately inspect ambiguous final state. |
| Target safety | Synthetic non-loopback rejection; managed profile/host/ref/role/CA/port bindings and secret-redaction tests without real managed connection. Dry-run read-only no changes; stale dry-run cannot authorize apply. |
| Real managed | Only after separate exact-target approval: read-only identity/TLS/privilege preflight, then separately authorized synthetic/staging application and failure/concurrency evidence as permitted. Neither technical profile acceptance nor B20 local pass substitutes for this gate. |

This assignment performed only local read-only source inspection and wrote this one document. No new PG run, network/provider operation, config/paid/deploy change or product operation was performed. Document whitespace/diff verification is appropriate; rerunning implementation tests would not validate an unimplemented design.

Execution boundaries: B21 authorizes only this document. Future runner/source publication needs a concrete code assignment and independent acceptance. Managed inspection/apply requires the exact target/project/environment, migration owner, schema version/hash/manifest and operation to be authorized separately; existing DEC-SSL-01 remains unresolved and is not bypassed here. Storage/provider/config/paid/deployment and transition executor work remain separately scoped. SQL4 selected constraints do not implement the worker protocol, complete causal-prefix validation, byte attestation or Storage readiness.
