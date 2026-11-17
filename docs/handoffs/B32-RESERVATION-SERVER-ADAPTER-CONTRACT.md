# B32 — Server reservation adapter implementation contract

Status: **B32-FIX ready_review; design only**. Original Master assignment `msg_57315748cb8a`; correction assignment `msg_f744d154d6ac`, final clarification `msg_e6171e1073a5`. Final B32-R `e45e7cb2c945f467f1a87d0e7fab32148527608f` was read in full: exactly F32-1/F32-2 require correction, no additional mandatory gap. Original ccc8207 and independent report remain immutable git evidence. This handoff changes one document only. No adapter, transaction boundary, SQL/role/grant, environment selector, route, registry, provider operation or deployment is implemented or enabled. Master design acceptance and a separate bounded implementation assignment are required.

## Evidence and recommendation

| Current source | Relevant fact |
| --- | --- |
| `lib/db/postgres/types.ts:5`, `:10`, `:14` | VerifiedActor is internally branded; constructor validates UUID shape, not Auth. It must be created only from trusted verified Auth. Its UUID-shape check is broader than B25/shared RFC UUID grammar. |
| `lib/db/postgres/transaction.ts:15`, `:21`, `:30`, `:49` | B3 owns a checked-out client, a private ALS scope and pending-query tracking, then BEGIN/local dream_api/local actor. Its generic tx.query is trusted-repository-only. |
| B3 `:61`, `:65`, `:70`, `:78`, `:81` | COMMIT failure and precommit failures converge on PG_TRANSACTION; after attempted COMMIT it still attempts ROLLBACK. That later rollback does not prove the earlier COMMIT failed. Release is unguarded in finally and can replace a successful return or safe error. B3 does not return a durable-outcome field. |
| `lib/db/postgres/connection.ts:13`, `:26` | Explicit connection options, max1..20, finite connect/statement/idle limits, verified TLS by default; no role-identity proof. The local no-TLS exception requires loopback and a `dream_test_...` database name. |
| `lib/repo/postgres/projects.ts:17`, `:31`; `lib/services/postgres/project-reads.ts:33` | B4 separates repository/service and owner-bound parameterized reads. Its Date conversion/read-only-repeatable-read mode is unsuitable for reservation epochs and SQL5 locking functions. |
| `lib/services/postgres/project-read-request.ts:45`, `:52`; `project-read-pool.ts:8` | B4 verifies Auth before constructing actor/reading params and has a process-managed pool. Its environment/request adapter and shared pool are not reservation opt-in or reservation-owned resources. |
| `lib/db/postgres/upload-reservation-codec.ts:25`, `:64`, `:71`, `:88`, `:116` | B25 validates raw JSON/semantic fingerprint and emits pristine proposals plus SQL specs. Its decoder requires pristine current rows; it is not a current/evolved history decoder, Auth checker or upload issuer. |
| `lib/db/postgres/drafts/0005_upload_reservation.sql:235`, `:277`, `:309`, `:356`, `:379`, `:396` | Fixed SQL5 has two bounded entries, history before fresh guards, closed current-policy binding, post-latch clock checks, and staged with commitConfirmed=false. It still has its unpublished fuse and is not registered. |
| `lib/db/postgres/migration-manifest-v2.ts:6`, `:8`; `migration-state-v2.ts:1442` | Existing v2 tools accept only3/4; full version5 descriptor/registry/apply/provisioning is absent. V1 remains at its original boundary. |

**Select one recommendation: a new closed reservation-only transaction boundary, leaving B3 unchanged.** Reusing B3 while classifying every PG_TRANSACTION as unknown is conservative but cannot report confirmed-COMMIT cleanup failure accurately. Do not wrap B3 with driver interception to guess its hidden commit state. New code must own that state directly and expose no arbitrary transaction callback or general SQL interface.

First implementation uses a **fresh exclusively owned max1 pool per attempt**, one checked-out client and no second borrower. This favors a reviewable connection lifecycle over pooling efficiency; no throughput claim is made. It never uses B4's process pool or accepts a caller-owned checked-out client. Existing createPostgresPool may construct the private pool from explicitly injected, snapshotted restricted connection options, with max fixed1. No environment read or import-time pool creation. A future optimized shared-pool lease requires separate ownership/cleanup review.

This distinction matters: installed `pg-pool/index.js:369` marks release-once before `_release`, and `:389` invokes release listeners before removal/idle handling. After a shared-pool release throws, blindly ending its client can race another borrower. A private single-borrower pool avoids that cross-request hazard. Installed `pg/lib/client.js:799` supports ending the client; non-pipeline active-query end disconnects it. These are local implementation observations, not adapter fault-test results. Do not access private driver fields/streams or assume cleanup always succeeds.

Additional installed-source evidence for this correction: `pg-pool/index.js:190`–`:308` retains connecting clients before application lease delivery; `:311`–`:358` can still deliver the pending callback after application abandonment; `:127`–`:145` and `:488`–`:500` show pool.end sets ending and waits, not cancellation of pending checkout. `_remove` at `:173`–`:186` removes the client from its list **before** the asynchronous client.end callback, so pool.end fulfilment is not socket-end proof. `pg/lib/client.js:702`–`:735` can reject a driver read-timeout promise while non-pipeline server work remains active. These are source observations only, not mock/native tests.

## Proposed modules and exact public interface

The following are **future implementation scope candidates**, not authorization to create them now:

| New path | Responsibility |
| --- | --- |
| `lib/storage/uploads/reservation-client.ts` | Pure strict logical serializer, exact canonical-text parser and immutable request snapshot. |
| `lib/db/postgres/reservation-replies.ts` | Server-only closed seed/replay/staged decoding and original-snapshot validation. |
| `lib/db/postgres/reservation-outcome.ts` | Server-only immutable issued outcomes/closed failure reasons; no driver causes. |
| `lib/repo/postgres/upload-reservations.ts` | Server-only two fixed parameterized entry calls; private statement port owned by the boundary. |
| `lib/db/postgres/reservation-attempt.ts` | Closed whole attempt: private pool/client, role proof, READ COMMITTED, workflow, cancellation, finalization/outcome/cleanup. No user callback. |
| `lib/services/postgres/upload-reservations.ts` | Server-only verified-actor API; snapshots inputs/dependencies before awaiting and invokes that one boundary. No Auth/environment/HTTP resolution. |

Proposed public signatures:

```ts
serializeUploadReservationClientV1(input: unknown): ClientSnapshotV1;
parseUploadReservationClientV1(canonicalText: unknown): ClientSnapshotV1;
postgresUploadReservations(serverDependencies: ServerReservationDependencies): Readonly<{
  reserve(actor: VerifiedActor, request: unknown, options?: Readonly<{signal?: AbortSignal}>): Promise<ReservationAttemptResult>;
}>;
// request must be exactly {requestId: lowercaseUUIDv7, clientJson: canonicalText}
// actor/owner, pool, target, policy, IDs, timestamps, limits are not request fields.
```

Concrete value contracts (all returned objects detached and deeply readonly):

```ts
type ReservationMime = 'image/png'|'image/jpeg'|'image/webp'|'video/mp4'|'video/quicktime'|'video/webm';
type ClientSnapshotV1 = Readonly<{clientVersion:1; requestedMaxBytes:number; claimedMime:ReservationMime;
  canonicalJson:string; clientDigest:string}>;
type RetryIdentity = Readonly<{requestId:string; clientVersion:1; clientDigest:string}>;
type ReservationSnapshotDto = Readonly<{requestId:string; objectId:string; assetId:string; intentId:string;
  reservedAt:number; authorizationUntil:number; issueEnvelopeUntil:number; maxBytes:number;
  policyEpoch:number; policyDigest:string}>;
type CurrentReservationInfo = Readonly<{lifecycle:'reserved'|'publication_reserved'|'registered'|'cleanup_claimed'|'tombstoned';
  revision:number; intentStatus:'open'|'completion_requested'|'succeeded'|'canceled'|'expired'|'failed';
  intentRevision:number; initialClosed:boolean}>;
type ReservationRecord = Readonly<{origin:'created'|'replayed'; reservation:ReservationSnapshotDto;
  current:CurrentReservationInfo; fingerprint:string; rawSha:string; issuanceAuthorized:false}>;
```

Numbers above mean validated safe integer domain values, never type-only permission to accept any JS number. UUID/digest grammars and exact key counts are runtime-checked. Readonly annotations alone do not snapshot data.

Server dependencies are explicit immutable connection options, trusted target/provenance facts, finite attempt limits and an optional trusted synchronous record-ID generator (default existing uuid.v7). The connection options are snapshotted privately, not returned/logged. Test-only driver/pool factories stay internal; they must vend new privately owned instances, with duplicate instance reuse rejected. No public arbitrary pool/client/SQL/role/isolation callback.

Dependency fields are exactly `connection`, `target`, `limits`, optional `nextRecordId`. Connection is readonly existing PostgresConnectionOptions **without max**; boundary fixes max1. Target is server-owned `{schemaVersion:5,sql5Sha256,serverMajor:18,loginOid,apiRoleOid,apiMembershipGrantorOid,issuerRoleOid,migrationOwnerOid,bootstrapOid,readSeedFunctionOid,reserveUploadFunctionOid,provenanceId,scope:'owned-synthetic'|'approved-runtime'}`. All **13 fields are required**, with unknown keys/symbols/accessors/prototypes rejected before snapshot/await. Every OID is an integer1..4294967295; the two function OIDs must be distinct. Digest is the frozen source SHA. `provenanceId` references trusted provisioning evidence, not a request token or hash learned from the live target. Approved-runtime construction remains unavailable until its separate activation gates are satisfied; the next phase supplies only owned synthetic fixtures. Limits are exactly statementTimeoutMs/lockTimeoutMs/idleTimeoutMs/attemptDeadlineMs/cleanupDeadlineMs. The ID function is synchronous and returns one lowercase UUIDv7; thenables/invalid/duplicate allocations fail. For the existing connection factory, a future no-TLS owned test database must use its allowed `dream_test_...` name; do not relax connection.ts for the prior b28/b29 fixture names.

No production target proof/environment constructor or runtime composition is supplied in the next foundation phase. Missing approved target facts fails closed before opening a pool; owned native fixtures may supply explicitly synthetic facts. A POJO or brand is not deployment authorization. Full schema5 verification/provisioning remains a separate prerequisite. The service is callable only by explicit trusted server composition and remains absent from route/import graphs.

## Client snapshot and actor identity

Client v1 logical input has exactly `{clientVersion:1, requestedMaxBytes, claimedMime}`. Inspect own data descriptors before reads, reject getters/nonplain prototypes/symbols/unknown fields; copy primitives without trimming or coercion. As with existing assertPlainData, proxy traps are not a JavaScript sandbox. Numbers must be safe positive integers, not -0, at most2147483648. MIME is exactly image/png, image/jpeg, image/webp, video/mp4, video/quicktime or video/webm.

Serializer emits exactly `{"claimedMime":"...","clientVersion":1,"requestedMaxBytes":N}` in that order, ASCII/no whitespace/escapes. Parser accepts only this canonical string, at most160 UTF8 bytes, unsigned base10 token `[1-9][0-9]{0,9}`, numeric ceiling checked independently before conversion. Duplicate/escaped/unknown keys, fractions/exponents/leading zero and quoted numbers are rejected before JSON.parse. Client digest is SHA256 UTF8 of `upload-reservation-client:v1\n` plus exact canonical text (real LF). Compare/persist identity as owner+request+canonical text/digest, not a newly generated server snapshot fingerprint.

The logical serializer cannot infer whether a JS number originally came from an exponent token. Therefore the adapter accepts **canonical clientJson only**, not an already-lossy generic browser body. A later HTTP parser must perform its own strict raw lexical validation before constructing logical input; no such parser/route is delivered here. Serialization does not attest browser bytes, rights or actual media.

Validate genuine actor before inspecting request input, matching B4's denied-before-params pattern. Snapshot actor.id and request/client synchronously before the first await. Require the genuine B3 brand **and** exact lowercase36-character shared owner UUID grammar before using it in B25. A B3-shaped non-RFC UUID must fail before checkout, not be silently normalized into a valid reservation identity. Snapshot does not mint a brand from a row, request, seed or envelope. No email/Auth reread occurs inside a transaction. Trusted Auth integration remains upstream and unimplemented for reservations.

## Reply decoding and original history

Require exactly one result row, one fixed alias `reservation_reply`, a plain closed JSON object, exact key sets/types and bounded safe integers/strings. Reject zero/multiple rows, arrays/JSONnull, stringified numeric fields, Date coercions, unexpected properties/tags and wrong-phase success tags. Detach/freeze validated results; do not retain mutable driver rows. All unexpected replies become REPLY_INVALID, never an empty/missing reservation.

| SQL shape | Exact meaning |
| --- | --- |
| seed | Keys tag,ownerId,requestId,policyId,policyEpoch,policyDigest,policy,now,issuanceAuthorized. Owner/request must match trusted snapshot; policyId asset-upload; issuanceAuthorized=false. Policy exact bodyVersion1/keyRule, six finite numeric limits, bucket and three UUID arrays follow frozen SQL5/B30 grammar. **No body_digest/provenance token is returned.** |
| replay | Keys tag,reservation,originalEnvelope,current,issuanceAuthorized. No commitConfirmed field. Both entries can return it. Historical result; no fresh admission/time/policy check. |
| staged | Same fields as replay plus commitConfirmed=false; only reserve entry may return it. It is provisional, not public success. |
| failure | Exactly `{tag}` with phase-appropriate closed tag. No raw message/cause/status fields are accepted. |

Reservation DTO exact fields: requestId/objectId/assetId/intentId, reservedAt/authorizationUntil/issueEnvelopeUntil, maxBytes, policyEpoch/policyDigest. Current exact fields: lifecycle,revision,intentStatus,intentRevision,initialClosed, using source enums/safe counters. This current fragment is informational: no receipt, active generation, fence, issue count, verified availability or transition CAS authority is returned. It must never be presented as ready/upload-authorized.

Read entry allows seed/replay and CONFLICT,ISOLATION,ACTOR_REQUIRED,INPUT,POLICY_LOCK,POLICY,UNAVAILABLE. Reserve allows staged/replay and CONFLICT,ISOLATION,ACTOR_REQUIRED,INPUT,POLICY_LOCK,STALE_SEED,IDENTITY_CONFLICT,UNAVAILABLE. A known tag in the wrong phase is still invalid. Preserve the minor POLICY tag fixed in B27-FIX; do not omit it.

For replay/staged, independently validate **originalEnvelope**, bounded by the SQL5 printable-ASCII decoded subset and B25 raw grammar. Public B25 exposes no standalone raw-envelope parser. A concrete reuse path is: bounded JSON.parse only to propose the ORIGINAL model; require its raw owner to equal the already-verified actor; reconstruct reserveUpload using original reservedAt (never live time) and the trusted actor ID; then call encodeUploadReservation with that model and the **unchanged raw string**. B25's independent strict scan must pass before accepting anything, so JSON.parse duplicate-key/number loss alone can never authorize a result. Compare encoded original IDs/time/limits/policy/request to every DTO field. This reconstructs the original reservation snapshot, **not current rows**; it must not fabricate pristine projections or call B25's current-row decoder on an evolved object.

For staged, also require exact originalEnvelope equality/hash/model with this attempt's prepared envelope. For replay, accept the original snapshot even when this attempt's fresh IDs/current policy/time differ; never substitute the new proposal or reapply today's expiration policy. B25 hashes are unkeyed integrity bindings, not Auth/provenance attestations. SQL5 does not return the ledger client text/digest; the adapter relies on the fixed bounded SQL entries' owner/request/client comparison, not a nonexistent client-digest field in the server envelope. Full evolved histories remain unverified until explicit adapter-native fixtures; unsupported/corrupt history fails closed without resetting current counters.

## Closed workflow and role checks

1. Before checkout: validate actor and request; freeze client snapshot/retry identity, target/config/limits and trusted synchronous ID dependency. Abort already requested returns not-applied without DB work. No body getter, live request reference, Date-based authorization or environment lookup survives into async work.
2. Create one new owned max1 pool; connect once through the retained checkout-owner procedure below. An abandoned/late lease performs **no SQL**, including identity/BEGIN/ROLLBACK/hygiene queries. Only an adopted lease validates actual session_user=current_user and native expected login OID/flags before BEGIN. Reject management/superuser/BYPASSRLS/CREATEROLE/schema or table owner credentials even if SET LOCAL ROLE could downgrade them. Inspect expected API membership/options and no path to migration/issuer/worker administration, using pg_roles/pg_auth_members/native OIDs, never password catalogs or marker-name identity. Target facts pin source/schema5, approved role/function/grantor OIDs, expected PG major18 and provenance; full v5 descriptor is a separate activation gate, not learned from target rows.
3. Explicit `BEGIN ISOLATION LEVEL READ COMMITTED`; SET LOCAL ROLE dream_api; parameterized local actor GUC; local row_security/search_path and fixed server-owned timeout policy. Verify actual local role OID, actor equality, RC and unchanged restricted session_user. Then perform the fixed function-identity check below **before either entry**, with schema USAGE available through the local API role. Never B4's REPEATABLE READ READ ONLY mode. Only that one client owns transaction state.
4. Repository calls only `SELECT dream_reservation.read_upload_seed_v1($1::uuid,$2::text) AS reservation_reply`. Replay skips ID generation entirely; retain original result for finalization. Seed is decoded before use; it is not an externally reusable capability.
5. For seed only, allocate object/asset/intent UUIDv7 from trusted uuid.v7, validate canonical shape and no duplicate allocation; never trust client IDs or DB clock encoded in UUID as authorization time. Construct times from seed.now plus approved body durations with BigInt bound checks before safe-number conversion. maxBytes=min(requested,policy,provider ceiling)<=2GiB; arrays/epoch/digest/bucket come only from validated seed. Incoming key exactly owner/incoming/object/intent, providerVersion=null. Build B19 model and B25 envelope with deterministic canonical JSON; preserve encoded raw/hash/fingerprint. **Do not execute B25's emitted INSERT specs**: API has no direct new-table write grants.
6. Call only `SELECT dream_reservation.reserve_upload_v1($1::uuid,$2::text,$3::text) AS reservation_reply`. A racing replay replaces the provisional candidate with validated original history. Stale/error tags end this attempt, not a hidden reseed/re-ID/retry loop. No network/Storage/provider/signing work under locks.
7. Decode all results before COMMIT. A validated staged/replay candidate becomes public success only after that attempt's confirmed COMMIT and successful cleanup. SQL guards remain the final post-wait time/policy authority. Decode after COMMIT would risk losing a known committed result to validation failure and is prohibited.

Recommended **adapter execution** limits for future implementation tests: statement5000ms, lock3000ms, idle-in-transaction10000ms, whole attempt12000ms plus bounded cleanup1000ms; all trusted finite, snapshotted and consistent with connection limits. They are not policy TTL/provider deadlines or operational capacity approval. Setup uses parameterized set_config for local values; no user-selected SQL/role/isolation/timeout. Pipeline is disabled and queries are sequential. Server statement timeout and client deadline are not proof of provider completion.

The new boundary has its own ALS/reentry guard and exposes no tx/client/query callback. B3's private ALS cannot detect cross-boundary nesting without changing B3: do not claim otherwise. The adapter must be invoked at a top-level server operation, never from a B3/B4 transaction callback. Its private pool cannot share that client's transaction. Any later need for a hard shared nesting token is a separate B3/integration change, not silently included here.

### F32-2: fixed function identities before entries

After restricted-login validation and local-role setup, resolve **only** these literal signatures using public pg_catalog lookups:

```sql
SELECT pg_catalog.to_regprocedure('dream_reservation.read_upload_seed_v1(uuid,text)')::oid::text AS read_seed_oid,
       pg_catalog.to_regprocedure('dream_reservation.reserve_upload_v1(uuid,text,text)')::oid::text AS reserve_upload_oid;
```

Require exactly one closed row, two nonnull positive native32-bit OIDs, and exact equality to the snapshotted readSeedFunctionOid/reserveUploadFunctionOid in their respective slots. The explicit ::text projections use a separate strict unsigned-decimal OID parser/range check; they are not permission to coerce business-reply numbers. Missing configuration fields fail before connect; missing native function/NULL, wrong or swapped IDs fail after connect **before the first entry**. Inspect those exact pg_proc rows and namespace: expected issuer owner, SECURITY DEFINER, VOLATILE, fixed search_path/row_security settings, expected namespace owner and selected EXECUTE/access facts. No name/signature comes from client/config interpolation. Unknown target fields are not ignored and expected OIDs are never refreshed from a mismatch. Roll back any begun transaction and retire the private lease; no reservation command has executed.

These OIDs come from trusted owned-fixture provisioning or separately approved target evidence. Matching OIDs is **not a body/content hash or native provenance proof**; CREATE OR REPLACE can preserve an OID. It neither supplies a missing complete v5 descriptor nor enables approved-runtime scope. All earlier activation/provenance gates remain off.

### F32-1: one retained pending-checkout and retirement owner

Selected executable procedure for both ordinary and abandoned leases:

1. Before connect, install safe private-pool error consumption and create a retained owner record for the **original** checkout promise, pool-end promise, settlement, abandonment/adoption and at-most-once retirement flags. No request-owned objects/callbacks or raw logs are retained. Call pool.connect once, catching synchronous throws. Immediately attach fulfilment/rejection handlers plus rejection sinks to every derived retirement/end promise **before registering/racing abort or deadline**. Then synchronously recheck signal.aborted/deadline before awaiting the race, so an abort that already fired cannot be lost while registering its listener. A bounded Promise.race is not the owner and cannot discard the original promise.
2. Fulfilment first records settlement/client and synchronously attaches safe client error handling and a **positive public end-event witness**, before any query/release/end can occur. It never runs workflow SQL itself. If abandonment/deadline/abort already applies, start retireOnce and never adopt. Otherwise offer the lease to the main flow, which rechecks abort/deadline and atomically claims adoption without an intervening await. If abandonment wins that handoff race, retirement owns the client. No continuation may revive an abandoned attempt or run metadata/BEGIN/role/actor/ROLLBACK/entry SQL on its late client.
3. Abort/deadline marks abandonment irreversibly **before** cleanup starts. If a client was delivered but not adopted, call the same retireOnce; if still pending, keep the original settlement handlers reachable after the bounded response. Start owned pool.end once and retain/consume its eventual settlement. Pool.end is not connect cancellation: a successful in-flight connect can still deliver a checked-out lease, which must then be retired by the fulfilment handler.
4. retireOnce has one shared promise/token for main, fulfilment and error paths. Set releaseAttempted before a single release(true) attempt. Keep end/error witnesses registered. If release throws and end has not been positively observed, permit **one explicit best-effort client.end fallback**, because ownership is private and exclusive; never second-release. Skip that fallback when an end event already proves termination. Underlying pool-internal close requests are not guessed from a thrown release. No repeated explicit fallback, second pool.end, or new SQL/retry is allowed. A fulfilled release/pool-end alone is not proof of socket end.
5. For a checkout abandoned **before adoption and any workflow SQL**, within cleanupDeadlineMs, cleanup:ok requires original checkout settled, no unresolved application lease, positive end witness for any delivered client, owned pool-end fulfilled and no cleanup error. A rejected checkout with no delivered lease needs settlement+pool end, not an invented client end event. A still-pending checkout, delivered-but-unobserved end, release/end error or pending/failed pool end yields **not-applied / cleanup:failed**, reason CANCELLED for abort or SERVICE_UNAVAILABLE for deadline/connection failure, because no reservation/BEGIN query was ever run on this abandoned checkout. Do not mark unknown business writes merely because connection acquisition is unresolved; do not equate not-applied with absence of prior history. An already adopted workflow uses its actual transaction/COMMIT classification instead, never this pre-adoption shortcut.
6. At the cleanup deadline return a frozen bounded result while the minimal retirement owner/handlers remain reachable for late fulfilment/rejection/end/error. A late rejection is consumed, a late fulfilment follows step4 with **zero SQL**, and late cleanup facts may be recorded only in safe internal diagnostics. They cannot mutate returned cleanup:failed to ok, change the returned commit classification, resume admission or trigger another connection/retry. Never-settling producers remain unresolved ownership, not successful cleanup. A function return/serverless freeze/process shutdown does **not** prove these handlers will execute or sockets close; post-return retirement under real shutdown remains explicitly unverified and an activation gate. This design promises retained in-process responsibility, not impossible cleanup completion after process termination.

For a normally adopted lease the same early end/error witnesses, retireOnce and poolEndOnce apply after transaction finalization. Its known commit outcome takes precedence; failed or unresolved cleanup after confirmed COMMIT retains record/confirmed durability under CLEANUP_FAILED. All errors from pool/client/end and late promises are consumed without leaking causes. Witness handling retains only private lifecycle facts, not mutable public result objects.

## Typed outcomes, COMMIT and cleanup

Proposed returned union (no thrown driver error or cause):

```ts
type ClosedReason = 'AUTH_REQUIRED'|'INVALID_REQUEST'|'DISABLED'|'CONFIGURATION_REJECTED'|
 'CLIENT_CONFLICT'|'ADMISSION_STALE'|'ADMISSION_REJECTED'|'IDENTITY_CONFLICT'|
 'REPLY_INVALID'|'SERVICE_UNAVAILABLE'|'CANCELLED';
type ReservationAttemptResult =
 | {kind:'success'; commit:'confirmed'; cleanup:'ok'; record:ReservationRecord}
 | {kind:'failure'; commit:'not-applied'; cleanup:'ok'|'failed'; reason:ClosedReason; identity:RetryIdentity|null}
 | {kind:'failure'; commit:'unknown'; cleanup:'ok'|'failed'; reason:'OUTCOME_UNKNOWN'; identity:RetryIdentity}
 | {kind:'failure'; commit:'confirmed'; cleanup:'failed'; reason:'CLEANUP_FAILED'; identity:RetryIdentity; record:ReservationRecord};
```

RetryIdentity contains requestId/clientVersion/clientDigest; owner is the internal verified actor scope, not a client override. Invalid/unauthed input can have identity null. ReservationRecord contains created/replayed origin, original DTO/fingerprint/rawSHA, current informational fields and issuanceAuthorized=false; raw envelope/authority arrays stay internal validation data, not a default HTTP response. No signed URL/token/capability type exists.

`not-applied` means **this attempt committed no reservation mutation**, not that the owner/request has no prior history. Known original history can exist even when its new read-only attempt fails. No failure emits NOT_FOUND from uncertain read absence.

| Boundary event | Required classification/action |
| --- | --- |
| Actor/input/config/target/checkout failure before any reservation command | not-applied, fixed safe reason; close any created private pool. No Auth failure reads caller getters. |
| Closed SQL failure, invalid reply, ID/preparation error before COMMIT | Send ROLLBACK on a usable idle client. Confirmed ROLLBACK => not-applied. If a reserve may have run and rollback cannot be confirmed => conservatively unknown. Do not preserve a domain reason over uncertain finalization. |
| COMMIT dispatch begins | Set commit state unknown **before awaiting**. Failure, timeout, missing/unexpected command tag => unknown, poison/destroy; no follow-up ROLLBACK can establish noncommit. No automatic retry/compensation. |
| Actual sole pending COMMIT acknowledged with command COMMIT | Set confirmed irreversibly before any cleanup/abort checks. A later connection/cleanup error cannot downgrade that observed durability to unknown/not-applied. |
| Confirmed COMMIT then role-reset/release/pool-end failure | Return failure/confirmed/CLEANUP_FAILED **with validated record**, destroy/quarantine private resources. No success/cleanup claim, lost record, retry or false absence. |

This is a **new proposed runtime boundary**, not a claim B3 or B23 already provides it. B23 migration outcome handling (`migration-runner-v2.ts:102`–`:137`) is useful evidence of explicit state/cleanup reporting, but has different ownership and poisoned-ack policy and must not be copied as runtime authority.

Track the original pending checkout **and** original pending query and their single finalizers; no unawaited SQL or double release. Healthy COMMIT/ROLLBACK resets local role/GUC; before cleanup verify outside-transaction role=session login and actor GUC absent/empty **only when no timed-out/abandoned server work may remain**. A failed hygiene check poisons the client. The first implementation's release(true)/owned pool.end are at-most-once requests, with positive client end observation required by retireOnce; `_remove` can empty a pool before client.end finishes. Missing end proof at deadline is cleanup:failed even if pool.end fulfilled. Keep minimal safe late-error handlers after a bounded return for their owned object's lifetime; no native close/late-cleanup guarantee is claimed until tests pass.

## Cancellation, secrets and explicit reconciliation

Abort before DB work => not-applied/CANCELLED. Abort before COMMIT stops new work, waits for an in-flight query only within the finite deadline, then confirmed rollback gives not-applied/CANCELLED where possible; deadline/connection destruction without confirmed rollback after reserve => unknown/OUTCOME_UNKNOWN. pg.query is not assumed to support AbortSignal cancellation or to stop server SQL when a client timeout fires. Non-pipeline private-client destruction and pending promise settlement must be tested; no private stream access or arbitrary CANCEL channel.

Foundation selects **no driver/per-query query_timeout**, one retained underlying native query promise and an external attempt deadline; existing connection.ts omits query_timeout, installed connection-parameters.js:124 uses its disabled default without that ambient setting. Do not add a user override. A wrapper race/driver read-timeout rejection is not query completion or an idle protocol: mark pending server work poisoned, destroy/retire the owned client, and **never queue ROLLBACK, hygiene SELECT or COMMIT merely because that wrapper/promise settled**. Only actual successful underlying completion on a healthy non-abandoned connection permits subsequent SQL; ambiguous/rejected query work can conservatively skip rollback and retain unknown after reserve. Preserve original query/end/late-error ownership until settlement or explicitly unresolved cleanup, with no private driver-state access. Tests must inject both wrapper timeout and the installed-driver-style early rejection so no fake idle/rollback proof can pass.

After COMMIT dispatch, cancellation cannot turn the operation into rollback: finish bounded finalization, keep confirmed outcome if acknowledged, otherwise unknown. A completed acknowledged operation remains a confirmed record even if its original consumer stopped listening; cancellation does not mint a new request. It may be recorded as an internal cancellation flag; it must not invent a different durability state or introduce an untyped cleanup reason.

No internal retries. An explicit caller reconciliation invokes the same reserve API on the authoritative primary with a freshly verified actor and **same request/canonical payload**. read_seed may return original replay; if no committed history is visible, the new admission still goes through the SQL unique latch. A still-running original serializes there; commit yields its original, rollback permits new admission only after serialized absence/current checks. No replica/status-read absence proves rollback. A new request ID, new authority/TTL, clean-up deletion or signer dispatch is never an unknown-COMMIT recovery strategy. B29/B31 prove bounded SQL race/history cases; actual adapter lost-response reconciliation is not yet implemented/tested.

Closed reason mapping keeps every SQL tag: CONFLICT→CLIENT_CONFLICT; STALE_SEED→ADMISSION_STALE (also covers SELECT STRICT no-data paths, not just time); IDENTITY_CONFLICT→IDENTITY_CONFLICT; INPUT after trusted preparation→ADMISSION_REJECTED, **not automatically browser400** (B31 policy mismatch is INPUT); ACTOR_REQUIRED/ISOLATION/POLICY_LOCK/POLICY after established context→CONFIGURATION_REJECTED; UNAVAILABLE→SERVICE_UNAVAILABLE. Invalid phase/shape→REPLY_INVALID. Prevalidation has AUTH_REQUIRED/INVALID_REQUEST/DISABLED/CONFIGURATION_REJECTED; driver failure→SERVICE_UNAVAILABLE unless finalization makes OUTCOME_UNKNOWN. HTTP statuses/route mapping are separate future work. No SQLSTATE/message-based domain promotion.

Outcomes/errors/logs contain only fixed reason/phase/commit/cleanup and permitted correlation identity. No DSN/password/CA contents, raw SQL/params, driver message/detail/where/stack/cause, raw request/policy/envelope, Auth token, signed URL or secret may escape. Preserve B4's issued-safe-error principle; structurally similar foreign errors are not trusted. No customer logger callback runs inside finalization.

## Completion gates and separately assigned tests

Proposed test paths: `tests/postgres/reservation-client.test.ts`, `tests/postgres/reservation-replies.test.ts`, `tests/postgres/reservation-attempt.test.ts`, and later separately authorized `tests/reservation-adapter-native-owned.ts`. No edit to frozen B28–B31 runners, B3, SQL1–5, package/config, existing registry or project services is needed for the isolated foundation. Implementation handoff is a separately assigned artifact; this document does not allocate a new task number or authorize any native execution.

Required meaningful coverage:

* Installed six-MIME/client numeric grammar and exact digest bytes; strict text versus logical serializer distinction; getter/prototype/symbol rejection; input/config mutations during deferred connect cannot change owner/request/statement/policy. Invalid actor/input/disabled target performs zero connects; forged row/actor cannot authenticate.
* Every actual tag and phase, exact row/key counts, safe integers/no Date, malformed/duplicate original wire and mismatched owner/IDs/policy/DTO rejected; original reconstruction validates through B25. Replay of evolved current fragments does not use pristine row decoding or today's policy/time; native evolved state is a distinct later fixture, not inferred from B31.
* Role/OID/config mismatch rejects management pools before entries; one private max1 pool/connect, RC/local role/GUC/timeouts, only two fixed entry statements, no direct B25 INSERT/Storage/signing. Unknown target facts do not autoapply SQL5 or learn a catalog from a target.
* F32-2 exact target tests: missing/undefined/zero/negative/fraction/over32-bit/swapped function OIDs, unknown keys and mutation during delayed connect; native NULL/wrong signature identity, owner/definer/volatility/settings/access mismatch. Assert no entry dispatch on mismatch and no live-target repinning; OID equality alone never produces deployment/provenance approval.
* Fault before BEGIN/after seed/after reserve, thrown and caught query failures, malformed returns, failed rollback, unexpected COMMIT tag, lost acknowledgement, late client errors, release/end failures and cancellation before/during/after dispatch. Check exact typed outcome, confirmed record retention, single finalizer/destroy, no raw cause, no retry or leaked client. Inject actual COMMIT-success-then-response-loss separately from mocked rejection.
* F32-1 deterministic deferred-checkout faults: abort before connect (zero connect), abort/deadline while connect never settles, late fulfilment before/after cleanup budget, late rejection and post-return errors. Hold settlement under test control, not sleep-based inference. Assert handlers attached before racing, late client executes zero SQL including ROLLBACK, one release attempt, at-most-one explicit private fallback/end and one pool.end, no unhandled error/rejection, immutable not-applied/cleanup:failed while pending, retained retirement ownership after return. A release-throws-before-close fixture permits one fallback; release-throws-after-positive-end permits none. Pool.end-fulfils-before-client-end must remain failed at deadline; query wrapper/native read-timeout must not trigger rollback/hygiene/COMMIT while server work may still run. No source reasoning here counts as a passed fault test or real post-shutdown guarantee.
* Separately authorized owned full-schema tests execute this **new adapter**, not old direct harness calls: actual restricted role/primary, new admission, same-key race/replay/conflict, expiry/policy history, actual committed native B25 hash/model bindings, unknown COMMIT plus explicit same-key reconciliation, and confirmed-COMMIT cleanup failure without duplicate admission. Preserve source/fuse-only derivation/ownership/stop proof under the assigned native scope.

Already evidenced, not new adapter tests: B28 ac7272f / independent fccd226 (local syntax/selected privilege/rollback/fresh deferred); B29 84fb3bb / b0ae405 (three SQL races); B30 ee709a6 / e98aadd (312 management vectors+five restricted workflows); B31 85119b9 / afcba33 (expiry/policy history). None supplies this new JS decoder/outcome/cancellation/pool proof. B32 ran no tests, cluster, build or deployment; validation is source/line comparison and document diff review only.

B32-FIX closure table: **F32-1** now specifies original checkout settlement ownership before deadline races, abandoned-lease zero-SQL retirement, positive end proof, bounded failed cleanup/immutable return and retained late handlers. **F32-2** now includes both function OIDs in the exact13-field target and a signature-to-OID check before entries. Final review's query-timeout versus server-work and pool-list versus socket-end implementation gates are mandatory above. These are corrected design requirements for separate fixed-source review, **not implemented or tested behavior**. Original review e45e7cb and original ccc8207 remain unchanged.

Production remains off: SQL5 is unpublished/unregistered; tools3/4 reject5 and v1 is unchanged. Need separately reviewed full v5 descriptor/migration/provisioning and restricted credential graph, actual target-major validation, immutable policy provenance/provider permission/finite operating values and rate/concurrency/total-byte budgets. Evolved lifecycle executors, actual Auth/B3 integration, runtime environment/route opt-in, Storage/signing/provider/paid actions are independent scopes. **Next recommended step after design acceptance: only the six isolated modules and focused unit/fault tests, with no runtime wiring; native verification gets its own assignment.**
