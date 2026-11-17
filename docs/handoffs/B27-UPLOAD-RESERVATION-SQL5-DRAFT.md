# B27 — Unpublished upload reservation SQL5 draft

Status: **ready_review, offline source only, unaccepted and unexecuted**. Master assignment `msg_14e88865e97f` authorizes this draft plus this handoff and the narrow B26 decision correction only. It authorizes no SQL application, synthetic database, role creation, API/runtime integration, provider action, paid operation or deployment.

Source: `lib/db/postgres/drafts/0005_upload_reservation.sql`. It is deliberately outside the closed version3/4 registry/manifests/runners/CLI. The file begins one transaction with an **unconditional execution fuse** that raises `B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED`; accidental execution cannot create its role or objects. Removing the fuse needs a separately reviewed assignment. It is not an apply-ready migration and does not write migration history.

Fixed draft LF SHA256: `020cf51f38b78c7926cdf696ee2214c8566b13a0c521a2c5f95695cfa49d9bb1`. Protected SQL1/2/3/4 LF hashes were recalculated and match their previously accepted values; no protected source edit is included.

## Fixed decisions and source delta

The controlling B26 document is commit `14fd8a3b7527aec1179a71fe42bbe83d9ffd18e7`, LF SHA256 `a0352e430ad8409edb8871fbea32413c1096e0b6836f498c737d51908db7bf8f`. Master selected G1-a option 1 and G1-b simplification after independent R2 `92c6a70`; original B26-R/R2 reports remain unchanged.

| Contract | Concrete offline source |
| --- | --- |
| G1 management exception | A non-superuser CREATEROLE migration owner creates the NOLOGIN/NOBYPASSRLS role. Native OID inventory permits exactly one automatic ADMIN edge: migration owner member, trusted bootstrap/root grantor, admin=true / inherit=false / set=false. Temporary self-granted SET and schema CREATE surround exactly two OWNER transfers and are revoked. No API/worker/login path to migration owner is accepted. ADMIN can reacquire SET: migration credentials remain trusted management roots and cannot be runtime credentials. |
| G1-b ACL | Each CREATE FUNCTION is followed immediately by explicit PUBLIC/API/worker REVOKE in the same transaction. API gets exact EXECUTE on two entries only; precommit ACL inventory checks typed grantors/owners. No ALTER DEFAULT PRIVILEGES or global/server-setting change. |
| Explicit preflight | Trusted settings must pin migration-owner OID, bootstrap OID and expected PG major. This first draft targets the observed **18** major, requires UTF8/standard strings and actual empty `createrole_self_grant`; any unconfirmed value/topology aborts. No automatic setting correction. Another major requires separately reviewed source and native evidence, not a changed environment flag alone. |
| FORCE RLS | Two new tables ENABLE/FORCE RLS; issuer is not schema/table owner. Owner SELECT/INSERT policies, fixed `asset-upload` policy reads, lock-only UPDATE USING + WITH CHECK false match B26. Nine table reads, three INSERTs, two single-column lock grants; no receipt/capability/outbox/lifecycle writes. |
| G2/C2 | Both static entry functions explicitly VOLATILE, enforce READ COMMITTED, lock policy FOR SHARE, check FOUND/current tuple and matching version. Required-existing replay object FOR UPDATE checks FOUND/owner/id. Fresh absent IDs use unique INSERT and cannot adopt collisions. |
| Snapshot and idempotency | Immutable policy body tuple and owner/request canonical-client ledger. Exact new `(owner,request,intent,object)` unique/FK binding. Ledger INSERT DO NOTHING is the unique latch, followed by a new statement snapshot for the committed winner. New triple is atomic inside an exception-bearing function block; errors after latch undo writes even if caller commits an error tag. |
| History | Replay helper reads original intent bytes/hash/fingerprint and ledger result separately from evolved object/intent state; changed client payload conflicts before current policy/expiry checks. Original IDs/time never refresh. No use of B25 pristine decoder on evolved rows. |
| Limits/result | Approved immutable body supplies byte/provider ceilings, TTL/envelope, max issues and preparation age; no operational values are seeded. Fresh clock check occurs after latch wait. SQL returns **staged / commitConfirmed=false** for new writes: it cannot confirm outer COMMIT/deferred constraints. Every success/history response has issuanceAuthorized=false. |

Planned delta: two tables, one schema, one role, nine functions (two SECURITY DEFINER entries, seven INVOKER helpers), fourteen policies, two append-only triggers and one additional intent UNIQUE constraint. If SQL4 baseline counts remain as accepted, business tables become 32 and policies 57. These are source counts, not an observed database/catalog fingerprint. Existing SQL1–4, B25, closed3/4 source/state/manifest/runner/CLI, role graph, v1, product, API, Auth/runtime and packages are unchanged.

## Exact client v1 and paired-validation contract

Closed logical fields are `{clientVersion:1, requestedMaxBytes, claimedMime}`. Accepted database **canonical text** has this exact key order and no whitespace:

```json
{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1048576}
```

Keys sort as `claimedMime`, `clientVersion`, `requestedMaxBytes`, matching existing `canonicalJson`'s ASCII key order. `claimedMime` must be exactly one of `image/png`, `image/jpeg`, `image/webp`, `video/mp4`, `video/quicktime`, `video/webm` from `lib/storage/uploads/schema.ts:65`. No escapes or alternative casing. `clientVersion` is the literal integer token `1`. Bytes use `[1-9][0-9]{0,9}` and numeric range 1..2147483648; no leading zero, plus/minus, decimal, exponent, quoted number, duplicate/unknown key or trailing data. Maximum canonical input is 160 bytes. These are claims, not ownership/rights/actual-byte or MIME proof.

Client digest is SHA256 UTF8 of `upload-reservation-client:v1\n` followed by the exact canonical text (real LF, not the two characters backslash-n). Compare text and digest. A future JS adapter must reject duplicate keys/ambiguous numeric tokens before parsing browser input, validate the closed logical shape, then emit this exact canonical text. Browser whitespace/key order/escaping may normalize before that boundary; raw browser bytes are not this ledger. SQL rejects noncanonical text at its trusted-adapter interface.

Required paired SQL/JS vectors: all six MIME values; 1 and 2147483648 accepted; 0, 2147483649, -0, 01, +1, 1.0, 1e0, numeric strings, unknown/duplicate/escaped keys and unsupported MIME rejected; differently formatted browser requests normalize to the same text only after strict parsing; one-field changes conflict under the same owner/request. Digest bytes and canonical strings must match independently, not via one implementation copied as the oracle. **No JS adapter or paired native test was implemented/run by B27.**

## Policy body and B25 wire subset

Policy body v1 is exact sorted-key canonical ASCII JSON with fields: `bodyVersion=1`, `collectors`, `incomingBucket`, `intentTtlMs`, `issueEnvelopeMs`, `keyRule="owner/incoming/object/intent:v1"`, `maxBytes`, `maxIssues`, `maxPreparationAgeMs`, `policyManagers`, `providerMaxBytes`, `verifiers`. Authority arrays contain 1..100 lowercase UUID strings. Positive integer limits are safe integers, bytes <=2 GiB, maxIssues<=1000, envelope<=TTL. Body digest uses `upload-policy-body:v1` framing, separately mapped to existing policy identity/epoch/digest; it does not redefine the old opaque policy digest.

Draft target key rule is `ownerUUID/incoming/objectUUID/intentUUID`; incoming providerVersion is **null** before any provider operation. This concrete v1 choice and policy-body shape require source review before acceptance. No bucket or provider configuration is created. No policy-body fixture is inserted; missing body fails closed. Policy administration/approved seed provenance, actual finite values, rate/concurrency/total-byte budgets and provider permission are **not supplied**. The FORCE-RLS migration owner cannot simply INSERT a policy body without an approved provisioning policy/path. This is an explicit deployment/integration blocker, not a reason to use management credentials at runtime.

B25's envelope version/fields are unchanged. SQL accepts a deliberately narrower **ASCII-decoded-string** subset, rejects duplicate keys with `IS JSON ... WITH UNIQUE KEYS`, validates unsigned safe-integer lexemes while still `json`, and recursively canonicalizes sorted keys before fingerprinting. Raw envelope whitespace/order/ASCII escapes are retained in intent text; raw SHA is unframed UTF8 SHA256. It binds exact derived owner/IDs/policy/authorities/target/time/limits through JSONB equality to a closed expected envelope. Generic non-ASCII B25 values are not silently rewritten; they are rejected in this draft. Byte/character/node/escaping parity remains a native paired-test gate. The epoch helper uses exact days plus small millisecond remainder in UTC, not a floating-point epoch conversion.

## Result and failure boundary

Entry results are bounded JSON with tags: seed, replay, staged, INPUT, ACTOR_REQUIRED, ISOLATION, POLICY_LOCK, CONFLICT, STALE_SEED, IDENTITY_CONFLICT or UNAVAILABLE. Not every tag is a public HTTP contract. SQL does not expose driver errors/query text/DSN/tokens. A committed replay returns immutable initial result/original envelope plus current lifecycle/revisions/status separately; its historical lookup needs no new request insertion/latch and never later acquires a request-write lock after its object lock. New admission uses policy → unique latch → fresh object/intent creation → original-binding validation. No capability is authorized.

The future B3 adapter must treat staged as provisional until confirmed COMMIT and throw a closed domain error for failure tags so its dedicated outer transaction rolls back. Deferred failures can still occur after the function returns. B3 PG_TRANSACTION remains conservatively unknown; no structured runtime outcome change, auto retry, provider action or cleanup is implemented. Explicit same-owner/request/payload primary reconciliation remains required; read absence during an in-flight commit is not rollback proof. Exceptions inside the write function undo its subtransaction; unexpected/cancelled/connection failures still require B3's safe connection/outcome handling.

## Actual validation and remaining gates

Performed: source comparison against B26/B26-R/R2, SQL4/B25 and existing six MIME/digest convention; selected diff whitespace check, protected-source hash comparison and manual static review. **No SQL parser/native syntax check, database connection, cluster, role creation, SQL5 application, provider IO, build or deploy occurred.** The unconditional fuse remains in source. Source review is not native PASS.

Required before moving beyond this offline draft:

1. Independent source review of DDL, canonicalization subset, all ACL/grantor/membership assertions, full positive/negative inventory coverage and original-snapshot validation. Native syntax and exact PostgreSQL ACL/config deparsing are unverified; current assertions fail closed on mismatch. The draft inventory asserts critical deltas and emits typed native policy/function/table/column facts; it is **not a complete version5 catalog descriptor** and must not be used to learn one from a target.
2. Separately assign an owned isolated full SQL1–4+5 test scope and reviewed fuse removal. Reproduce all B26 matrix rows: actual role/deferred-event context on target major; automatic ADMIN and temporary SET cleanup; explicit ACL atomic visibility and fault rollback; all four lock cases; same/different payload commit/rollback waiters; fresh/colliding IDs; evolved/expired replay; malformed raw and time/zone bounds. Never use shared/managed DB or substitute the old reduced fixture.
3. Freeze and implement the separate client JS parser/paired vectors. Verify recursive SQL JSON string escaping/raw lexemes against B25 hashes, including nested duplicate decoded keys, ASCII escape variants, length bounds and safe-integer extremes. No successful vectors are claimed here.
4. Approve policy administration/provenance and all operational values/budgets before any admission integration. Create no production policy/table/role from this draft. Review tag mapping, staged/confirmed separation and B3 unknown-COMMIT/lost-response/pool tests separately.
5. Version5 typed descriptor/source approval/migration/provisioning support requires separate work. Do not edit old SQL hashes or register this file in closed3/4 as a shortcut. API/Auth/runtime/Storage/paid/managed/deployment decisions remain outside scope.

B27 returns reviewable source, not a complete operational reservation service. Only the two new B27 paths and the separately committed narrow B26 document correction are owned in this assignment; other sessions' work is preserved.
