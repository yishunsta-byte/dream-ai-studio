# B32-R2 — Fixed server adapter contract re-review

**Verdict: SOURCE/DESIGN PASS for the assigned F32-1/F32-2 correction and query-timeout/end gates.** No new mandatory contradiction found in the fixed delta or complete contract. This does not mean implementation, fault tests, socket cleanup, adapter-native behavior or runtime activation passed. Master retains final design acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_333dd76015fe`, acceptance receipt `msg_6cdbd49af51c`. Date:2026-11-18 Asia/Seoul. Only this report is edited in the repository.

## Fixed evidence and method

| Artifact | Independent evidence |
| --- | --- |
| Fixed contract | `5f01b766991f38da4d1a1e1811c87024f5157d2c`, `docs/handoffs/B32-RESERVATION-SERVER-ADAPTER-CONTRACT.md` |
| LF SHA256 | `25fe280ac54537e91dfb5a19082bb197a849e36d308341fcfa0a514d62341e51`, independently recalculated;209 lines |
| Original contract/review | ccc82078a4ce5524e66116f219ca8ae7b88c9dc2 /B32-R e45e7cb2c945f467f1a87d0e7fab32148527608f |
| Exact correction | One document,+39/−5 lines; reviewed actual fixed git diff plus full contract, not only the closure statement |
| Installed driver | pg8.23.1 client.js SHA256 `ad6aa93c26b0bf26db1f2ebe74216212790a04c41af5585c63760f9fa8322a32` |
| Installed pool | pg-pool3.14.0 index.js SHA256 `6f304776edaabde2954cbf8c4366fa6d9512bfba0e408e78cc56b3c46c69d058` |

Read relevant installed acquisition/release/remove/end/query-timeout/error source again, plus connection-parameters/defaults for disabled query_timeout. Compared current contract, postgres/model/B4/service/repository/package inputs with5f01b76: exit0/no changes at verification. Read-only design reasoning and hash/diff checks only: no adapter/mock or fault-test execution, SQL parser/connection/cluster/native test, browser, build/deploy, installation or product/B3/SQL/harness/package/config/env edit. No new agent/window/worktree.

## F32-1 closure: executable ownership procedure

Fixed lines134–147 and175–183 address the original late-checkout counterexample:

| Required transition | Fixed procedure and review conclusion |
| --- | --- |
| Before abort/deadline race | Create retained checkout/lifecycle owner, call connect once with synchronous-throw handling, immediately attach fulfilment/rejection handlers and derived-promise sinks, then register/race abort/deadline and recheck already-fired abort. Original promise remains owned even after a bounded race returns. This closes the missing lease owner. |
| Fulfilment/adoption | Record settlement/client and attach safe error and positive public end observation before queries/retirement. Fulfilment never dispatches workflow SQL. Main flow rechecks cancellation/deadline and atomically adopts with no intervening await. If abandonment wins, retirement owns it; no continuation can revive it. These are implementable serialized JS state transitions without private pg fields. |
| Abandoned lease | No identity/BEGIN/role/actor/ROLLBACK/hygiene/reservation SQL. Mark abandoned before cleanup; late success follows shared retireOnce. Pending success/rejection stays consumed after the returned result. pool.end is explicitly not checkout cancellation. |
| Retirement | Shared promise/token, releaseAttempted set before one release(true). At most one explicit client.end fallback only after release throws and no positive end has been observed; never second release. One poolEndOnce with eventual settlement/error consumed. Private/exclusive ownership is retained; no unrelated borrower is endangered. |
| Cleanup proof | Pre-adoption cleanup:ok requires original checkout settled, no unresolved lease, positive end for any delivered client, fulfilled owned pool end and no cleanup error. A rejected checkout with no delivered lease does not invent a client-end event. Pending checkout/unobserved end/failed or pending pool end remains cleanup:failed. release return/pool list emptiness alone never proves socket termination. |
| Bounded return and late lifetime | Pre-adoption no-SQL abandonment remains not-applied; cancellation/deadline reason stays closed. At cleanup deadline return frozen failed cleanup if unresolved, retaining minimal private handlers for late settlement/end/error. Later cleanup cannot mutate public result/durability, resume SQL or retry. Never-settling producers are not called successfully cleaned. Process/serverless shutdown execution is explicitly an unverified activation gate, not an impossible guarantee. |
| Already adopted transaction | The pre-adoption shortcut cannot overwrite actual transaction state. Confirmed COMMIT retains record/confirmed outcome if retirement fails. Pending reserve without confirmed rollback remains conservatively unknown where required. |

This matches installed pg-pool behavior: a pending connect can deliver after pool.end, and `_remove` can empty the pool before asynchronous client end. The positive end witness is registered **before** release/fallback, including normal adopted retirement. Error handlers remain for the owned object's lifetime after a failed bounded return. Merely setting a cleanup flag is insufficient under this contract.

The design does not promise every broken release/pool bookkeeping state can be repaired through public APIs. For example, a release listener throwing before pool removal can leave pool.end unresolved even after a private fallback closes the socket. Its correct bounded result remains cleanup:failed, with known COMMIT preserved. No second release/private-field repair is authorized to manufacture success.

## Query timeout, COMMIT and cancellation

Line181 explicitly selects **no driver/per-query query_timeout**, one retained underlying query and external deadline. Installed connection.ts omits it; pg connection-parameters.js calls `val('query_timeout',config,false)` and defaults.js sets false. That `false` suppresses environment fallback for this parameter; no ambient value was read in this review. The implementation must preserve the selected disabled setting and reject user overrides rather than assuming early promise rejection means protocol idle.

Actual installed client.js702–735 may reject a driver read-timeout promise while nonpipeline server work continues. The fixed contract now explicitly poisons/retire such work and forbids ROLLBACK/hygiene/COMMIT solely because a wrapper/promise settled. Only healthy successful underlying completion permits new SQL. Nonpipeline client.end may force disconnection through its public API; no adapter access to private streams/state is needed. Conservative unknown after reserve without confirmed rollback remains allowed.

COMMIT dispatch still sets unknown before awaiting. Actual sole COMMIT acknowledgement fixes confirmed before later abort/error/cleanup; failed or missing acknowledgement stays unknown, not proven noncommit by later rollback. Confirmed cleanup failure retains the validated record. Abandonment after adoption cannot apply the no-SQL checkout result rule. These statements coexist consistently with bounded cancellation and immutable returned outcomes. Late acknowledgement/timeout/error order still requires implementation/fault/native proof.

## F32-2 closure: exact target and entry identity

Line73 contains **exactly13 required fields**: schemaVersion,sql5Sha256,serverMajor,loginOid,apiRoleOid,apiMembershipGrantorOid,issuerRoleOid,migrationOwnerOid,bootstrapOid,readSeedFunctionOid,reserveUploadFunctionOid,provenanceId,scope. Both new OIDs must be distinct safe integers1..4294967295; missing/undefined/wrong-type/out-of-range and unknown/symbol/accessor/nonplain data are rejected before snapshot/await. Expected values are trusted provisioning evidence, not refreshed from a mismatch.

Lines119–129 resolve only the two literal fixed signatures, after restricted-login validation and local API role/schema USAGE, **before either entry**. Exact aliases/row shape and nonnull strict decimal text/OID range are checked against each expected slot. Wrong/swapped/NULL identity rejects; relevant pg_proc/namespace facts must also match issuer owner, SECURITY DEFINER, VOLATILE, search_path/row_security, namespace owner and selected EXECUTE/access. No signature/client interpolation or business-number coercion follows from separate OID text parsing. Rejection rolls back/retire without reservation dispatch.

Matching OIDs does not prove unchanged function content: CREATE OR REPLACE may retain an OID. The fixed text explicitly preserves full v5 descriptor/provenance and activation gates. This resolves the original exact-type/check contradiction without claiming a replacement for catalog approval or production deployment permission.

## Preserved design and implementation gates

Actor-first snapshot, canonical-client-only request, trusted fresh IDs/BigInt time preparation, exact phase replies including read POLICY, original-envelope B25 validation without evolved-row decoder misuse, private pool ownership, closed issued outcomes/redaction, no-retry primary same-key reconciliation and confirmed-record retention remain intact. B3's private ALS cannot enforce cross-boundary nesting; top-level composition remains an explicit prerequisite pending any separately assigned shared guard. Production/approved-runtime constructor, environment/route wiring, registry/apply, Auth/B3 integration and provider authority remain OFF.

The fixed coverage list now requires deterministic pending-checkout/adopt-abandon faults, zero SQL on late leases, at-most-once release/fallback/pool end, pre/post end error cases, never-settled cleanup and immutable post-return outcomes. It also requires pool-end-before-client-end and wrapper/native-style query-timeout cases, wrong/missing/swapped OID/config/metadata cases and no target repinning. These are **required tests, none executed here**. Model/source plausibility cannot substitute for fault tests or real process shutdown/socket proof.

After separate design acceptance, the six isolated modules plus focused unit/fault tests are the proposed next scope only. Native tests must execute the new adapter, including real restricted role/primary behavior, actual committed B25 data, lost acknowledgement and explicit reconciliation, and confirmed-COMMIT cleanup failure. Old B28–B31 direct harness passes do not supply this evidence. Evolved history, complete v5 descriptor/provisioning, operating budgets/provider/Auth/runtime/deployment retain separate gates.

Only this report is staged/committed with selected whitespace validation; unrelated T122/T137 WIP and all original code/SQL/harness/package/env files are preserved. No mock repo artifact was added.

Copyable return:

> B32-R2 fixed5f01b76 SOURCE/DESIGN PASS: F32-1 retained checkout/atomic adopt-abandon/late zero-SQL retirement, once-only private cleanup, positive end+settled-checkout proof and immutable failed-cleanup late-handler ownership now specified; adopted transaction/confirmed record takes precedence. F32-2 exact13-field target adds two function OIDs with fixed-signature/metadata/access checks before entries. No-driver-query_timeout and settled-promise≠idle gates are explicit. No new mandatory gap, but no implementation/mock/fault/native/runtime test was run. Six-module foundation and activation/native work remain separately assigned; Master final acceptance required.
