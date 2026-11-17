# B32-R — Independent server adapter contract review

**Verdict: DESIGN CHANGES REQUIRED — two mandatory contract gaps.** The closed boundary/outcome direction is sound, but late checkout ownership and the exact target/OID interface must be completed before implementation acceptance. No adapter/runtime/native PASS is claimed. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_eed4a059a3de`, acceptance receipt `msg_c133af5c3e84`. Date:2026-11-18 Asia/Seoul. Only this report is edited in the repository.

## Fixed inputs and actual method

| Input | Evidence |
| --- | --- |
| Fixed contract | `ccc82078a4ce5524e66116f219ca8ae7b88c9dc2`, `docs/handoffs/B32-RESERVATION-SERVER-ADAPTER-CONTRACT.md`,175 lines |
| Independently recalculated contract LF SHA256 | `dcf623713a21d6d9819e379215a7600271a725ad1078d4f0443a210a324ec05b` |
| Runtime source | B3 transaction.ts/connection.ts/types.ts, B4 projects repository/project-reads/request/pool/errors, B25 codec/shared model and fixed SQL5fbfc48c |
| Installed driver | pg8.23.1 `node_modules/pg/lib/client.js`, SHA256 `ad6aa93c26b0bf26db1f2ebe74216212790a04c41af5585c63760f9fa8322a32` |
| Installed pool | pg-pool3.14.0 `node_modules/pg-pool/index.js`, SHA256 `6f304776edaabde2954cbf8c4366fa6d9512bfba0e408e78cc56b3c46c69d058` |

Read the frozen contract in full and compared its concrete statements with actual local implementation, including driver/pool acquisition, query timeout, error, release and end paths. Also read B23 outcome cleanup for comparison. Current contract/code/package comparison with ccc8207 returned exit0 before Backend FIX; conclusions remain pinned to `git show ccc8207:...` while its moving correction is authored.

No tests, mocks, SQL parser/submission, connection/cluster, browser, build/deploy, installation or product/SQL/harness/package/config/env change occurred. No new agent/window/worktree. Prior accepted B28–B31 results remain historical direct-SQL evidence; they do not validate this proposed adapter. This is source/design reasoning, not an observed runtime failure.

## Mandatory findings

### F32-1 — Abandoned pending checkout needs an explicit late-client retirement owner

**P1 lifecycle contract gap.** Contract lines21,106–107 create a private pool and connect once; lines139,147,151 require bounded cleanup/cancellation and track pending query/finalizer. They do not specify a retained pending **checkout** and a handler which owns a client delivered after abort/deadline has already abandoned that checkout. Closing the private pool is not cancellation of the pending checkout.

Installed pg-pool evidence:

* `connect`/`newClient`190–308 can have a connection attempt already in `_clients` before the application receives its lease. The configured5000ms connection timeout is independent of an earlier AbortSignal/attempt deadline.
* `_pulseQueue`129–145, when ending, removes idle clients and finishes only when `_clients` is empty. `end`488–500 sets ending/callback and pulses; it does not abort an already pending connect/lease callback.
* Successful connect continues through `_afterConnect`311–331 and `_acquireClient`335–358. That path can deliver the original pending callback without rejecting it merely because pool.ending became true. It assigns release and removes the pool idle-error listener before delivery.

Concrete source-level counterexample: abort during the first connect; a deadline race stops awaiting it and starts pool.end; cleanup deadline1000ms expires; connection succeeds later but still inside its5000ms connect window. If the original promise has no abandonment-aware owner, the late client remains checked out, pool.end cannot finish, and no code necessarily attaches its checked-out client error handler. A private max1 pool prevents another borrower's ownership race, but does not retire this late lease by itself. This describes an allowed unsafe implementation of the incomplete contract, **not a test that was run**.

Required correction/one selected alternative: retain the original checkout promise and attach rejection/fulfilment handlers **before any abort/deadline race**. Mark abandonment irreversibly. A late successful lease must attach safe error/end observation, execute **no BEGIN/role/actor/reservation SQL**, and be destroyed with one release(true) attempt; any fallback client.end is safe only for this exclusively owned client, never a second release. Retain ownership/handlers until it is retired even after the bounded public result. End the owned pool once, observe its eventual settlement, and report cleanup failed if resources remain pending at the cleanup deadline. Pre-reservation outcome remains not-applied/CANCELLED or the appropriate safe reason; a timeout is not evidence that checkout never completed. No pool internals/streams or unrelated-client cancellation are needed.

Required future fault vectors: abort before connect, abort/deadline while connect is pending, late fulfilment, late rejection, release/end throw and post-return error. Assert zero SQL on abandoned late clients, exactly one lease retirement/finalizer, no unhandled rejection/error and no cleanup:ok while ownership is unresolved. These are implementation gates, not tests performed here.

### F32-2 — Exact target type omits the function OIDs required by its own checks

**P2 executable-interface contradiction.** Contract line71 declares exact dependency/target fields: schemaVersion, sql5Sha256, serverMajor, login/api/membership-grantor/issuer/migration/bootstrap OIDs, provenanceId and scope. It has **no read-entry or reserve-entry function OID fields**. Line107 nevertheless requires trusted target facts to pin approved role/**function**/grantor OIDs; line169 requires OID/config mismatch rejection. Native function OIDs cannot be derived from source hash or a role OID. A provenanceId string alone supplies no specified resolver/object carrying the missing expected values.

Required correction/one selected alternative: add exactly **readSeedFunctionOid** and **reserveUploadFunctionOid** to the closed trusted target contract, with the same positive-native32-bit validation. Before entries, compare the fixed signatures `dream_reservation.read_upload_seed_v1(uuid,text)` and `dream_reservation.reserve_upload_v1(uuid,text,text)` resolved in the approved target against those expected OIDs and required owner/definer/volatility/settings/access facts. Expected values come from trusted synthetic provisioning/approved target evidence, never learned from the target under test. Missing/wrong/swapped OIDs fail closed. This narrow runtime target check does not replace the separately approved full v5 descriptor or activate approved-runtime composition.

The two findings were actually sent to Master in `msg_bfe9628e0b1f`; Master acknowledged in `msg_f6c359f9b8b7` and separately assigned Backend B32-FIX. That does not accept the moving correction. Original ccc8207 remains this report's target.

## Source-aligned design and implementation gates

No additional mandatory contract defect was found in the following assigned areas; observations are design judgments, not runtime results.

| Area | Finding and boundary |
| --- | --- |
| Six modules/public surface | Pure canonical client snapshot, server-only reply/outcome/repository/attempt/service responsibilities are separated; only reserve(actor, exact request, optional signal) is public. No general SQL/transaction callback, caller pool/client or request-owned policy/IDs. Future module creation still needs its own assignment. |
| B3 information loss | Actual B3 transaction.ts keeps committing state privately, converges query/COMMIT errors on PG_TRANSACTION and has unguarded finally release. Wrapping it cannot recover a confirmed record lost to release. New closed boundary owning finalization state is a defensible selected alternative; do not promote B23's different poisoned-ack handling into runtime proof. |
| Actor-first immutable snapshot | B4 verifies Auth before lazy params; types.ts brand/UUID constructor is shape validation, not authentication. Contract additionally requires shared lowercase36-character UUID grammar, then detached actor/request/config snapshots before await. Shared z.uuid permits versions1–8 plus nil/max; record IDs are UUIDv7. Branding does not authenticate a row or a compromised runtime credential. Proxy trap limitations are explicit. |
| Client preparation | Exact canonical-text client API avoids lost lexical information from a generic JS/browser body. Six MIME/range/no-whitespace/digest grammar follows SQL5/B30. Logical serializer cannot infer exponent spelling from an already parsed number; later strict HTTP raw parsing is correctly separate. |
| Policy/IDs/time | Seed owner/request/body/now are validated before use. UUIDv7 generation is trusted/synchronous; BigInt addition precedes safe-number conversion. Incoming path/providerVersion/byte minimum/authority arrays match fixed SQL5. No Date clock authority and no execution of B25 INSERT specs. Replay skips fresh allocation and racing replay replaces the provisional proposal. |
| Reply shape/phase | Exact row/alias/key/type checks and source enums match SQL5. read allows POLICY; reserve does not. Staged exists only in reserve and requires commitConfirmed=false; replay omits that field. All successes have issuanceAuthorized=false. Informational current fragment is not receipt/availability/CAS permission. Unknown/phase-invalid replies fail closed. |
| Original/evolved distinction | Proposed reuse constructs the original model using original reservedAt plus trusted actor, then actual B25 encoder must validate the unchanged raw string, rejecting duplicate/numeric loss from preliminary JSON.parse. Every DTO field must bind back to that snapshot. This is not fabrication of pristine current rows or B25 evolved-row decoding. Current fragment remains separate and native evolved fixtures remain open. SQL5 omits client digest/body provenance in replies; the stated reliance on bounded SQL owner/request/client comparison is explicit. |
| Outcome union | Success requires confirmed COMMIT+cleanup ok. Unknown uses OUTCOME_UNKNOWN/same retry identity, not domain-error promotion. Confirmed-COMMIT cleanup failure retains validated record and confirmed durability. not-applied means this attempt's mutation, not absence of previously committed history. These semantics address B3's information loss but remain unimplemented. |
| COMMIT/abort ordering | State becomes unknown before dispatch; only actual sole COMMIT acknowledgement fixes confirmed before later poison/cleanup/abort handling. Later abort cannot undo acknowledged durability; failed/missing COMMIT response is not cured by a subsequent rollback. Cancellation after acknowledgement retains confirmed record, with no invented untyped failure reason. Required fault/native tests remain future work. |
| Pool ownership/release | Dedicated new max1 pool avoids cross-request harm after release listeners throw; installed releaseOnce marks released before listeners/removal. No second release; fallback client.end is limited to private ownership. F32-1 completes the missing pre-checkout portion. This model deliberately makes no throughput claim. |
| Query deadline/late errors | Installed client.js702–735 can reject a query-timeout callback while nonpipeline server SQL is still active; a settled promise does not establish protocol idleness. Contract correctly warns timeout/AbortSignal is not SQL cancellation. Implementation must retain the underlying operation, poison timed-out/cancelled work and never queue rollback/hygiene/COMMIT merely because a wrapper race settled. The simplest foundation policy is no driver query_timeout, one tracked underlying promise plus external deadline and owned-client destruction when abandoned. Test late errors with safe handlers, no raw cause/logs and no false confirmed rollback. |
| Socket close versus pool end | Installed pool `_remove`173–186 removes its client from the list **before** asynchronous client.end callback. A later pool.end may see an empty list before socket end. The contract's no-false-socket-closure rule therefore requires a separate positive public end observation registered before retirement; release(true) returning/pool.end resolving alone is insufficient cleanup proof. Preserve unresolved cleanup as failed and keep safe late-error handling. No native close-failure behavior was tested here. |
| B3/B4 cross nesting | B3 scope is module-private ALS. A new boundary cannot inspect it or enforce global nesting without a shared B3 change. Line116 correctly makes top-level composition a prerequisite and acknowledges that limitation. Its own ALS can reject only its own reentry. A future integration must prove callers obey the top-level rule or separately introduce a shared token; do not claim private guards reject cross-boundary nesting. |
| Primary reconciliation | No internal retry/reseed/re-ID. Explicit same owner/request/canonical payload on authoritative primary uses unique-latch serialization, not status-read absence or replica evidence. This is a design rule; B29/B31 do not prove adapter lost-response reconciliation. Approved primary target/provenance and all native adapter tests remain gates. |
| Activation/secrets | No production constructor/environment/route wiring; synthetic-only next foundation phase, unpublished fuse/closed3/4 registry preserved. A POJO/brand/hash is not deployment permission. B4's issued WeakSet-safe-error principle supports closed redaction; driver details, SQL, policy/raw envelope/secrets stay internal. |

Recommended implementation tests must explicitly distinguish query promise timeout from server completion, client end from pool end, COMMIT acknowledgement from cleanup, and the retained late-checkout owner from the returned bounded result. Readonly types alone prove none of these. Fixed connection.ts's no-TLS local test exception requires `dream_test_...` DB names; keep it unchanged rather than reusing old harness names. Per-attempt finite connection/statement/lock/idle/deadline bounds must compose without a claim of guaranteed instantaneous cancellation.

## Return and preserved scope

Only this report is staged/committed, with a selected whitespace check. No mock repo file, implementation, DB/parser/native test, cluster, browser/build/deploy, SQL/role/harness/package/config/env/DSN/managed edit or new agent/window/worktree. Unrelated T122/T137 and Backend moving contract WIP are preserved.

After document corrections, obtain a separate fixed SHA for source re-review. Only then consider separately assigned six-module implementation/unit-fault work; native adapter execution, actual lost COMMIT, evolved records, Auth/B3 integration, complete v5 descriptor/provisioning, budgets/provider and runtime deployment retain their own approval/verification gates. No initial foundation wiring is authorized by this review.

Copyable return:

> B32-R original ccc8207 DESIGN CHANGES REQUIRED: F32-1 retain pending checkout with abandonment-aware late-client retirement/error/end ownership; pool.end does not cancel checkout. F32-2 add two expected entry function OIDs to the exact target type and match fixed signatures. Source-aligned findings cover actor/snapshot/replies/history, outcomes/confirmed record retention, private pool/release/query timeout/close semantics, top-level B3 ALS prerequisite and activation OFF. No code/DB/parser/native tests were run. Please return a fixed document SHA for separately assigned review; implementation/runtime acceptance remains separate.
