# B26 — Upload reservation transaction contract

Status: **ready_review; design only**. No SQL, role, grant, function, transaction executor, API, provider call, or deployment is implemented by this handoff. Master design acceptance and a separately assigned implementation scope are required. B25 is submitted for independent review; this design does not declare its acceptance. Mandatory B25 corrections take priority.

## Evidence and current gaps

| Source | Observed contract and consequence |
| --- | --- |
| `lib/db/postgres/types.ts:10` | `actorFromVerifiedUserId` validates/brands a UUID; it does not authenticate it. Only trusted server Auth may construct the actor from a verified user. |
| `lib/db/postgres/transaction.ts:16`, `:50`, `:61`, `:72` | B3 checks the brand, begins one client transaction, sets local `dream_api` and actor GUC, and requires confirmed COMMIT. `PG_TRANSACTION` does **not** distinguish confirmed rollback from uncertain COMMIT. Domain preservation applies only to safe callback errors after successful rollback without query failure. |
| `lib/db/postgres/0004_storage_verification.sql:19`, `:24` | Policy version/current rows contain identity, epoch and digest, not authority arrays, upload limits or a canonical policy body. |
| SQL4 `:29`, `:69`, `:261`, `:436` | Object/intent constraints and guards govern pristine insertion. The deferred object consistency trigger also reads operations, receipts and receipt state even for the pristine branch. Two INSERT grants alone are insufficient evidence of a working transaction. |
| SQL4 `:559`–`:573` | All twelve new tables use ENABLE/FORCE RLS. API receives only seven owner SELECT grants/policies. No new writes, policy lookup grants, registrar, worker grant or SECURITY DEFINER boundary exists. Helper EXECUTE is revoked. |
| `docs/handoffs/B16-STORAGE-UPLOAD-WORKER-CONTRACT.md`, `B16-FIX-UPLOAD-WORKER-CONTRACT.md`, `B16-R2-UPLOAD-WORKER-CONTRACT-REVIEW.md` | Admission follows policy → object → operation/state/outbox order; terminal history replay does not create authority; durable capability allowance precedes signing; unknown provider completion is not permission to clean up. |
| `lib/storage/uploads/state.ts`, B19 FIX4 / R5 | Pure `reserveUpload` validates a server model, not Auth, durable request idempotency, provider attestation or a transaction. Creation-operation client/snapshot digest logic is not an implemented upload-reservation ledger. |
| `lib/db/postgres/upload-reservation-codec.ts:14`, `:71`, `:81`, `:88`, `:116` | B25 preserves raw server-envelope text and SHA, fingerprints the entire original server snapshot, and emits two INSERT specifications. The envelope contains generated IDs, policy, authorities and time, but no separate browser payload ledger. Decoder requires pristine rows and cannot decode an evolved object as historical replay. |

Frozen SQL4 LF SHA256: `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. B19 FIX4 commit: `d9d438a541d82664a6227f0545863da98692e10c`. B25 submitted commit: `da0f7407e194a0dc84c612b44fb98aa43f2efc2a`. B25 review changes must be reconciled before implementation freezes this dependency.

## Alternatives and recommendation

| Alternative | Assessment |
| --- | --- |
| Give `dream_api` INSERT and policy access directly | Possible only with new exact policies and checks. Expands arbitrary application SQL authority; RLS alone cannot enforce trusted policy construction or canonical payload binding. Not recommended. |
| Separate login/SET ROLE issuer, then reuse B3 | Requires a new actor transaction boundary because B3 fixes `dream_api`. Makes unrestricted issuer SQL available to a runtime credential. More privilege and transaction machinery than needed here. Not recommended. |
| Bounded functions owned by an isolated NOLOGIN role, with append-only SQL5 | **Recommended for design review.** Existing API can execute only narrowly specified reservation functions. The function owner is neither table owner nor BYPASSRLS, and needs explicit grants and FORCE-RLS policies. |
| Management/superuser/service-role runtime pool, even followed by `SET LOCAL ROLE` | **Prohibited shortcut.** A privileged `session_user` retains an escalation path. Migration credentials cannot become the production reservation connection. |

Use a restricted backend API login with exactly its approved `dream_api` membership. Do not reuse an administrative synthetic-test pool. No direct browser database credentials, PostgREST exposure, or worker authority is introduced.

## Proposed SQL5 data and privilege delta

Names below are proposed exact review targets, not existing objects or executable migration instructions. SQL5 source, typed catalog descriptor, migration support and independent real-PG proof are separate future work.

1. Schema `dream_reservation`, owned by the migration owner, not by the runtime/function role. Runtime API gets USAGE only. Revoke PUBLIC CREATE/USAGE and PUBLIC default function EXECUTE; explicitly revoke API/worker CREATE. All new objects and existing references are schema-qualified.
2. Role `dream_upload_reserver`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB, NOCREATEROLE, NOREPLICATION. Owns only the two bounded entry functions below, not either schema or any table. No API/worker/login membership in this role; no membership held by this role. No runtime SET ROLE path to it.
3. `dream_reservation.upload_policy_versions`: immutable `(policy_id, epoch, digest)` PK/FK to existing `dream.storage_policy_versions`; canonical policy body and independently checked body digest. Stores approved authority arrays, bucket/key rules, byte ceiling, intent TTL, issue envelope, max issues and finite seed preparation age. It does not redefine the existing opaque B19 policy digest as a hash of a previously unspecified body. Immutable trusted mapping binds the body to that tuple. No runtime INSERT/UPDATE/DELETE; separate approved policy-administration provisioning is required. Missing mapping/configuration fails closed.
4. `dream_reservation.upload_requests`: append-only PK `(owner_id, request_id)`, Auth owner FK, client format version, canonical client payload and domain digest, original policy tuple, intent/object IDs, original reservation fingerprint/raw SHA, and immutable initial-result data. Original B25 raw server envelope remains in `upload_intents` unchanged. New deferred composite FK `(owner_id, request_id, intent_id, object_id)` targets a **new SQL5 UNIQUE** `(owner_id, request_id, id, object_id)` on `dream.upload_intents`. Its existing separate unique keys do not provide that exact FK target. This extra index is an explicit SQL5 catalog delta. The bounded function statically validates the ledger's snapshot hashes/result against immutable intent fields before successful return. Do not add a caller-context deferred custom ledger reader without an explicitly reviewed privilege delta; the native FK is the deferred relationship check. No upsert that overwrites a ledger or adopts a colliding object.

Both new tables ENABLE and FORCE RLS. Own them with the migration owner; no broad owner-exemption assumption. Explicit policies below target only `dream_upload_reserver`; API gets no direct new-table access. All new functions/tables revoke all privileges from PUBLIC, `dream_api`, `dream_worker` before narrowly granting the stated entry-point access. If deployment has `anon`, `authenticated`, `authenticator` or service roles, verify no direct/inherited grants or schema exposure; do not reference nonexistent roles blindly in portable DDL.

| Object | Exact proposed grant to `dream_upload_reserver` | Exact proposed RLS scope |
| --- | --- | --- |
| `dream.storage_policies` | SELECT; UPDATE(`policy_id`) solely to satisfy row-lock privilege requirements | SELECT USING `policy_id = 'asset-upload'`; UPDATE USING same predicate, WITH CHECK `false`. |
| `dream.storage_policy_versions` | SELECT | SELECT only for `policy_id = 'asset-upload'`. |
| `dream_reservation.upload_policy_versions` | SELECT | SELECT only for `policy_id = 'asset-upload'`. |
| `dream.storage_objects` | SELECT, INSERT; UPDATE(`id`) solely for locking | SELECT USING `owner_id = (SELECT dream.actor_id())`; INSERT WITH CHECK same expression; UPDATE USING same expression, WITH CHECK `false`. |
| `dream.upload_intents` | SELECT, INSERT | Same owner SELECT / INSERT policies. |
| `dream.storage_verification_operations` | SELECT | Same owner SELECT only; supports pristine deferred guard reads. |
| `dream.storage_verification_receipts` | SELECT | Same owner SELECT only; supports pristine deferred guard reads. |
| `dream.asset_receipt_state` | SELECT | Same owner SELECT only; supports pristine deferred guard reads. |
| `dream_reservation.upload_requests` | SELECT, INSERT | Same owner SELECT / INSERT policies. |

No grant on assets, runs, cleanup claims, outbox, capability issues or creation operations. No UPDATE on epoch, revisions, statuses, issue counters or any ledger field. No DELETE, TRUNCATE, REFERENCES, schema CREATE or role administration. UPDATE on immutable ID columns is lock-only authority: UPDATE USING makes only the intended existing rows lockable, while WITH CHECK false forbids storing an updated row, alongside existing guards. PostgreSQL requires UPDATE column privilege and applies UPDATE USING policies to locking SELECTs; SELECT policy alone is insufficient. See [PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html) and [CREATE POLICY command matrix](https://www.postgresql.org/docs/18/sql-createpolicy.html). Native tests must prove both locking and mutation rejection; any needed widening returns for review.

Grant required schema/domain USAGE and EXECUTE on the exact scalar functions `dream.actor_id()`, `dream.valid_object_key(text,uuid)`, `dream.storage_uuid7(uuid)`, `dream.storage_raw_hash(text,text)` to the function role. Pin any additional scalar dependency found during SQL5 implementation; no blanket `ALL FUNCTIONS`. Trigger execution privileges are not equivalent to ordinary function calls: do not infer that every trigger helper needs runtime EXECUTE or that revocation prevents trigger firing. Verify actual initial/deferred trigger contexts. Do not convert existing guards to SECURITY DEFINER, disable FORCE RLS, or use `SET CONSTRAINTS ALL IMMEDIATE` to run unrelated queued constraints with elevated authority.

Proposed entry signatures:

* `dream_reservation.read_upload_seed_v1(uuid,text) RETURNS jsonb` — request ID and canonical client payload; owner comes only from actor GUC. Returns closed historical result or a policy/clock seed. No writes or capability authority.
* `dream_reservation.reserve_upload_v1(uuid,text,text) RETURNS jsonb` — request ID, canonical client payload, original B25 envelope text. Returns closed domain tag and result. Validates every authoritative binding itself; the seed is not a bearer credential.

Only these exact signatures get EXECUTE to `dream_api`; revoke PUBLIC/worker EXECUTE. Functions are SECURITY DEFINER with fixed `search_path = pg_catalog, pg_temp`, `row_security = on`, fully qualified persistent objects/operators where needed, static parameterized SQL and no caller-controlled identifiers/dynamic SQL. Functions derive owner from `dream.actor_id()`, reject missing owner, accept no `owner`, `role`, policy override or signer input. New append-only validation/constraint trigger helpers remain ordinary invoker functions with PUBLIC/API/worker EXECUTE revoked. Ownership transfer/default ACL ordering must not leave a transient public entry point at migration commit.

The actor GUC is not cryptographic authentication: anyone holding a runtime database credential can attempt to set it. The trusted boundary is server-verified Auth plus private credentials, branded actor construction, the B3 transaction wrapper, and no arbitrary external SQL endpoint. Branding prevents accidental/untrusted data reuse, not malicious code in the same server process. A decoded row must never create a VerifiedActor.

## Client idempotency and original snapshot

The upload client payload contract is not currently defined by B19/B25. Proposed closed v1 fields for review: `{clientVersion:1, requestedMaxBytes, claimedMime}` with a frozen supported MIME allowlist. Claimed MIME is a request hint, never native media proof. Owner, record IDs, policy/authority arrays, target, timestamps, TTL and capability allowance are server-selected. Master must accept the exact fields and canonical grammar before implementation.

Persist a fixed-field canonical serialization and domain digest (`upload-reservation-client:v1`). Reject unknown/duplicate keys, ambiguous numeric forms and unsupported string encodings. SQL must independently validate the exact canonical grammar; PostgreSQL `jsonb::text` is not assumed to equal JavaScript canonical JSON. Compare **canonical payload and digest**, not only the digest. Digest is integrity binding, not authentication. Any future client field/version change needs an explicit version rule.

The B25 fingerprint continues to mean the original server snapshot, including generated IDs, policy and reservation time. Never recompute a new snapshot fingerprint to decide whether a retry is the same client request. Equal canonical client payload under the same owner/request returns the original reservation; changed semantic payload returns CONFLICT, including after expiry. Formatting differences allowed by the eventual client parser must canonicalize identically. No original browser-byte audit is promised: B25 preserves the raw **server envelope** bytes; browser audit would be separate scope.

## Transaction and locking sequence

Use one dedicated B3 actor transaction for one owner/request, default READ COMMITTED. No nested transaction or unrelated mixed operation. Fixed policy ID `asset-upload` is a permanent lock anchor; SQL4 prevents its deletion. Policy advancement must acquire the conflicting exclusive row lock and preserve historical version bodies.

1. Verify Auth server-side before DB work and brand the verified UUID. Validate bounded request/client syntax. Start B3 transaction and set local API role/actor.
2. Acquire policy anchor FOR SHARE **before any request/object lock**. Resolve existing owner/request history first. Same payload can replay without matching today's epoch or expiry; changed payload conflicts. Historical reads do not admit new work. A missing live policy/body can block new admission without invalidating already committed history; an unavailable/corrupt anchor/history is a safe data/configuration error, not permission to invent a replacement.
3. For new admission, read the immutable body matching the locked current tuple. Return a seed with database clock and policy facts. Trusted server builds fresh B19 model/B25 envelope using that seed in the same open transaction, without network/provider work.
4. `reserve_upload_v1` reacquires/checks the anchor and first resolves any already-existing owner/request. For absent history, INSERT the immutable `upload_requests` row with `ON CONFLICT (owner_id,request_id) DO NOTHING RETURNING ...`. This is a unique-key admission latch, not an object/intent upsert. Deferred FK allows this ledger record to precede its referenced business inserts. A competing insert waits; use a new READ COMMITTED statement after the wait to read the committed winner, not an old statement snapshot. If winner exists, compare client payload and return its original result.
5. If this call owns the new ledger slot, take object locks in sorted ID order for any existing referenced object. Fresh object IDs acquire protection through unique insertion. An ID collision is an error, never adoption of another row. Extended common order is **policy → owner/request unique latch → sorted objects → sorted operations → asset/current state → outbox**. Future operations must adopt this order; no object-first call into this boundary.
6. After all waits, use `clock_timestamp()` again. Validate owner, UUIDv7 IDs, raw envelope/JSON/hash/fingerprint, exact policy tuple/authorities, allowed incoming identity, byte bounds, zero pristine counters and all initial fields. `reservedAt` must not be future and must satisfy an approved finite preparation age. Derive expiration/envelope/max issues exactly from policy with safe arithmetic. Do not use transaction-start time as fresh time after a long wait. A seed that became stale fails; no silent TTL extension.
7. Insert exactly one pristine `storage_objects` and one pristine `upload_intents`, plus the one immutable request ledger already inserted. This recommendation has **three atomic durable records**, not B25's two business INSERTs alone. All constraints, ledger binding and deferred consistency must pass before COMMIT. A failure between any writes rolls back all three; no compensating deletion or half-ledger commit.
8. Return success only after B3 confirms COMMIT. No signed capability, provider upload or external IO occurs within or after this reservation implementation's scope.

Reservation creates revision-zero rows and performs no lifecycle UPDATE. Replay reads current lifecycle under the ordered object lock but does not change it. Later lifecycle executors must check expected aggregate/state revision and fence under that lock, use conditional revision-CAS UPDATE with affected-row count exactly one, and return CONFLICT on mismatch; a reservation/replay result is not a CAS token authorizing a later transition. Do not grant those future UPDATE columns here.

Any closed domain failure after the ledger insert must roll back that mutation (guarded function subtransaction or outer transaction rollback), never return a tag that the caller can accidentally commit with partial writes. The callback maps a successful SQL closed failure tag to a safe domain Error and uses B3's narrowly scoped domain classifier to force rollback. Unexpected SQL failures remain masked PG errors. Do not rely on raw SQLSTATE escaping B3. An entry function must be safe against direct invocation by a caller with its exact EXECUTE grant, including callers that ignore a returned failure tag.

For multiple future policy IDs, lock sorted policy anchors before request/object locks. Discovering a different original policy after taking a lock requires abort/restart with the correct sorted set. Never acquire a new policy lock after object/request locks. This document does not authorize multipolicy support.

## Replay after evolution or expiry

Reservation success is durable reservation history, not verification success or an assertion that upload is currently allowed. Return original IDs/snapshot result for authenticated same-owner/same-client-payload retry after intent expiry, cancellation, registration or policy advancement. Report current availability/status separately. Do not issue a fresh expiry, ordinal, capability, receipt or new reserved identity.

B25's pristine row decoder cannot be used on evolved current rows. A separately reviewed initial-result reader must validate the immutable ledger, original raw envelope/hash/fingerprint and immutable intent bindings while reading mutable lifecycle separately. Never reset current revisions/statuses to zero, fabricate pristine rows, or bypass the decoder's checks. Missing/inconsistent history fails closed. Tombstones and request IDs cannot be recycled.

A COMMIT confirmed after the authorization deadline can still establish historical reservation success; current issuance is unavailable. Future capability issuance is a separate live-policy/time/fence/allowance transaction. Reservation inserts leave issue count zero and create no capability row.

## Unknown COMMIT, errors and limits

B3 `PG_TRANSACTION` is conservatively **outcome unknown** to this adapter unless a new reviewed boundary proves a more precise result. Do not interpret it as confirmed rollback. B23 migration outcome types do not automatically apply to runtime B3. A future runtime result boundary should distinguish confirmed committed, confirmed not-applied and unknown, preserving the safe/closed error boundary; altering B3 requires separate review and regression scope.

After a timeout/lost COMMIT response: no automatic new request ID, provider call, cleanup or presumed success. Reauthenticate and explicitly retry/reconcile on the authoritative primary with the same owner/request and canonical client payload. The unique-key latch serializes against a still-running original: committed original returns its result; rolled-back original permits fresh admission only after serialized absence and current checks. A read returning absence while the original is in flight is **not** proof of rollback. Replica absence is never authoritative. Busy/timeouts remain pending/unknown. Newly generated server IDs may be used only after serialized absence establishes no committed original; never replace committed/tombstoned IDs.

Proposed safe response classification for later API review: malformed input 400; failed Auth 401; generic inaccessible owner 403 without existence leak; changed client payload 409; stale new-admission seed 409/reseed; unavailable/unknown 503 with stable retry identity. Historical exact replay returns a result plus expired/current status rather than silently granting new authority. No route is introduced here.

Apply finite input lengths and concurrency/rate/budget controls. Admitted bytes must be positive and no more than the minimum of requested bytes, approved policy ceiling, explicitly authorized provider ceiling and SQL's 2 GiB ceiling. SQL's ceiling is not operational upload permission. Historical Free 50 MB observations are neither current configuration proof nor consent to upgrade. Missing provider/policy ceiling fails closed. Intent TTL, issue envelope (no longer than intent TTL), preparation age and max issues (within existing protocol bounds, at most 1000) need approved finite values; this document invents no operational durations or provider late-writer guarantees.

Error/log output contains only closed tags, safe correlation/request identity where authorized and outcome classification. No DSN, password, raw driver errors/query text/parameters, Auth token, signer secret, capability URL or raw policy/request body in public errors/logs. Preserve B3 client destruction on uncertain connection state and transaction-local role/GUC cleanup. Do not convert process cancellation or response timeout into a provider deadline.

## Required real PostgreSQL acceptance matrix

These are **future required tests**, not B26 executions or passed evidence. Use an owned isolated cluster with actual restricted login/session_user and SQL5; management credentials may provision fixtures only. Never use production/shared 3013 or change another agent's cluster.

| Case | Required observation |
| --- | --- |
| Actor boundary | Unbranded/forged data fails wrapper; verified A cannot reserve/read B; row decoding never brands Auth; missing GUC fails. Explicitly document runtime-credential compromise is outside the branding boundary. |
| Role/ACL inventory | Exact NOLOGIN/NOBYPASS flags, no memberships/SET ROLE escalation, exact function signatures/search path/owner, no PUBLIC or worker entry EXECUTE, no runtime schema CREATE, no direct API INSERT. Runtime session_user is restricted. |
| FORCE RLS | Exercise each function-role SELECT/INSERT policy and owner mismatch. Table ownership alone grants nothing to the function role. Lock-only column grants cannot mutate IDs, epochs, status or revision. |
| Trigger dependencies | Fresh pair passes immediate/deferred guards; remove each needed read/scalar privilege and observe safe failure. Test deferred firing after SECURITY DEFINER returns to API as well as direct dedicated transaction paths. No disabled RLS/guard or ALL-constraint elevated sweep. |
| Atomicity | Inject failure after ledger, object and intent insert and at deferred checks/COMMIT. Zero partial rows. Exact ledger FK/hash/result binding rejects mismatched request/owner/intent/object. |
| Same request race | Two connections, same owner/request/payload: one original triple, one replay; immutable raw snapshot is the winner's, no duplicate object or changed time. |
| Changed request race | Same key, changed payload: one winner, other CONFLICT; including whitespace-equivalent canonical requests and changed payload after expiry. |
| Rollback waiter | First transaction holds key then rolls back; waiter rechecks fresh clock/live policy after wait. Expired preparation seed cannot create new authority. |
| Policy race | Shared admission lock versus exclusive epoch advance in both orders; new stale epoch denied, exact historical replay allowed, missing body blocks only new admission. No deadlock from object-first inversion. |
| Identity collision | Colliding object/intent/asset IDs cannot adopt unrelated or same-owner existing objects. Rollback leaves no request-only record. |
| Evolved history | Replay expired/cancelled/registered object and advanced policy using original snapshot reader; B25 pristine decoder continues rejecting evolved rows. No refreshed TTL/issue count/capability. |
| Wire/numeric integrity | Raw whitespace/escapes preserved, duplicate keys/noncanonical integers rejected, owner/authority/body digest bindings checked, epoch zero/MAX_SAFE_INTEGER and timezone cases remain exact. No jsonb serialization substitution. |
| Lost COMMIT reply | Actually commit server-side then lose client response; API reports unknown, explicit same-key retry returns original triple. Delay original completion: primary read absence remains unknown; unique latch reconciles after commit/rollback. |
| B3 failure hygiene | Swallowed query error still rolls back, escaped/nested transaction fails, role/GUC do not leak across pool reuse; failed COMMIT client destroyed. Domain tag does not accidentally commit partial writes; raw SQL error stays redacted. |
| Resource/IO boundary | Oversized/missing/invalid finite limits fail, overflow fails, no network signer/provider/worker/outbox/capability IO. Concurrent request/resource limits measured separately. |
| Version boundary | Exact SQL5 catalog and role/ACL inventory accepted only as version5; existing version3/4 descriptors and v1/closed-v2 tools fail closed on incompatible target. Apply is atomic and requires its own approved source/target hash. |

Do not substitute mocks for lock waits, native role/RLS behavior, deferred triggers or lost-response commit observation. Include deterministic barriers, bounded waits and owned-cluster shutdown evidence in the implementation handoff.

## Version impact, proposed files and decisions

This recommendation adds two tables (30 → 32 business tables), a schema, role, two entry functions, append-only/integrity helpers, new RLS policies/ACLs and a unique constraint. Exact policy/helper counts must be frozen in SQL5 review, not guessed here. It is a **version5** catalog. Do not edit SQL1–4 bytes/hashes, relabel a SQL5 database version4, or backfill history dishonestly. V1 supports its original three-version boundary; existing B22–B24 closed versions3/4 inspection/migration/provisioning must not silently accept version5. Current provisioning is not a version5 grant mechanism.

Proposed separately assigned implementation paths: `lib/db/postgres/0005_upload_reservation.sql` (offline draft first); version5 source/typed catalog registry and migration/provisioning support; `lib/db/postgres/upload-reservation-request.ts` (frozen client canonical contract); `upload-reservation-repository.ts` (actor adapter, initial-result reader and outcome reconciliation); focused request/transaction tests and an owned real-PG runner. Names are planning targets only. Existing B25 codec changes, B3 boundary changes and any API route must have explicit scopes. No Auth/runtime/package/v1 change is authorized by this document.

Master review decisions remaining:

1. Accept/reject the bounded NOLOGIN function-owner route and the exact privilege/RLS delta; confirm production restricted-login provisioning path.
2. Freeze the closed client payload fields/canonical format and immutable original-result representation; approve the third ledger record and exact composite FK/index.
3. Approve policy-body provenance/administrator path, permanent policy anchor, finite limits and provider ceiling. No paid/provider/storage change follows from accepting this design.
4. Decide whether to add structured runtime outcome reporting to B3 or retain conservative unknown plus explicit reconciliation, with separately reviewed tests.
5. Accept B25 independent review/fixes and this design before authorizing any SQL5 or transaction implementation. SQL5 migration/managed execution/deployment remain separate approvals.

B26 validation: document-only source comparison and selected-path diff review. No SQL execution, real-PG run, provider action, build or deployment was performed for B26. All test rows above are acceptance gates for future implementation, not claimed results.
