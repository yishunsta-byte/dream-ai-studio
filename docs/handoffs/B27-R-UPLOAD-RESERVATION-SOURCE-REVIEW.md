# B27-R — Upload reservation SQL5 independent source review

Status: **SOURCE CHANGES REQUIRED — two mandatory gaps. Native SQL5 remains unverified.**

Reviewer: Codex(Tester), separate from Backend author. Master assignment `msg_07708b354018`; acknowledged `msg_58afc3b5f106`. Review completed 2026-11-18, Asia/Seoul. This report concerns the original fixed draft, including after Master assigned Backend a separate FIX. It does not review that moving correction.

## Fixed inputs and scope

| Input | Fixed evidence |
| --- | --- |
| B27 source and handoff | `dfb521c5a367a2db0827fdf392f24df6559fce3b` |
| `lib/db/postgres/drafts/0005_upload_reservation.sql` | 511 lines; LF SHA256 `020cf51f38b78c7926cdf696ee2214c8566b13a0c521a2c5f95695cfa49d9bb1`, independently recalculated |
| Controlling B26 | `14fd8a3b7527aec1179a71fe42bbe83d9ffd18e7`; contract LF SHA256 `a0352e430ad8409edb8871fbea32413c1096e0b6836f498c737d51908db7bf8f`, independently recalculated |
| Earlier privilege reviews | B26-R `3f0a44a`, B26-R2 `92c6a70`; their reduced native observations are historical evidence, not a full SQL5 test |
| B25 accepted codec | `da0f7407e194a0dc84c612b44fb98aa43f2efc2a`; independent report `85108b6` |
| SQL4 dependency source | `lib/db/postgres/drafts/0004_storage_verification.sql`, especially guards at 261, 436 and deferred trigger creation at 564–565 |

Only this report is edited by Tester. No SQL was submitted to any database or SQL parser. No fuse removal, cluster, connection, role, grant, database fixture, product build, browser session, registry change, provider action or deployment occurred. Shared `.next`, port 3013, other sessions' services and WIP were not touched. No agent/window/worktree was created.

Method: fixed-commit `git show`, bounded source reads/`rg`, manual comparison to B26/B25 and installed dependency implementation, `git diff --quiet`, LF SHA256 calculation, then report whitespace check. The protected comparison against dfb521c returned exit 0 before Backend's FIX work: drafts, B25 codec, upload model, package and lockfile matched. Subsequent source conclusions remain pinned to `git show dfb521c:...`, independent of shared-tree changes.

## Mandatory findings

### F27-1 — Policy UUID grammar can admit a B25-invalid original snapshot

**Severity: P1 compatibility/validation gap.** Location: SQL5 lines 144–149, copied to the fresh expected envelope at 350–351; B25 codec lines 11–15 and 62–70; `lib/storage/uploads/schema.ts:3,114` and authority fields following that line.

SQL's authority-array regex allows any hexadecimal version nibble in the third group:

```text
^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

For example, `11111111-1111-9111-8111-111111111111` meets that source predicate. The model's `id` is lowercase `z.uuid()`. The installed `node_modules/zod/v4/core/regexes.js:25–29` accepts version nibble `[1-8]`, with separate nil/max UUID alternatives. Thus this example is outside the actual B19/B25 schema. Conversely, B27 rejects nil/max UUIDs currently accepted by that model; this narrower UUID choice is not the handoff's documented ASCII-only restriction.

The canonical ASCII policy body can contain this example in a nonempty authority array. `policy_v1` has no later UUID validation. Fresh admission copies those arrays into its exact expected envelope; raw/semantic hashes and `replay_v1` do not add a UUID-model check. Consequently, source logic permits an authority snapshot that the accepted codec/model cannot construct or decode. This is a static counterexample to validator equivalence, **not a claim that a database transaction was run or committed**. Policy provisioning remains a separate prerequisite; rejecting malformed authoritative policy data is still this validator's contract.

Required correction: freeze the same lowercase UUID grammar as the accepted model, including an explicit nil/max decision. For unchanged B25 compatibility use versions 1–8 plus its nil/max alternatives. Validate all three authority arrays with that grammar. Add paired SQL/JS vectors later for versions 0, 1, 7, 8, 9 and f, variant failures, uppercase, nil and max; verify the whole envelope/codec result, not only a copied regex. Changing the shared accepted model is outside this FIX scope.

### F27-2 — Final schema ACL/grantor inventory does not reject extra schema grants

**Severity: P1 privilege-inventory gap.** Location: SQL5 lines 46–49, 430–433, 482–484 and 494–509. Controlling B26 G1 step 5 requires typed schema/function ACL and grantor verification before COMMIT.

The source revokes new-schema privileges from PUBLIC/API/worker, grants API/issuer USAGE and later removes issuer's temporary CREATE. Final checks reject issuer CREATE, API CREATE and worker USAGE. They never expand/assert `dream_reservation`'s complete `pg_namespace.nspacl`, its exact allowed grantees, grant options and grantor OIDs. Final emitted catalog facts also omit namespace ACLs. Entry/helper/table ACL checks do not cover schema ACLs.

A concrete source-level negative fixture is a pre-existing creator default grant of CREATE/USAGE on future schemas to an unrelated runtime principal. PostgreSQL 18 supports these defaults, and new object privileges use the creating role's defaults. See [PostgreSQL 18 ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html), synopsis `ON SCHEMAS` and Description. This documentation supports the fixture's premise; the conclusion about B27's missed rejection follows from the source inspection.

Such a schema grant survives the named revokes at line 47. It need not create a role-membership edge or any extra function/table ACL, and none of the current schema booleans rejects it. The inventory can therefore accept an extra schema CREATE/USAGE grant outside the intended delta. This does **not** claim immediate bypass of the exact entry function ACL or an observed exploit; it establishes that the required final privilege allowlist is incomplete.

Required correction: assert the new namespace's typed owner and expanded ACL against the exact selected contract: migration owner permissions/grant options and grantor; API and issuer USAGE only, no grant options, expected grantor; no PUBLIC, worker or other grantees. Keep temporary CREATE revoked and inspect effective forbidden paths as required. Emit namespace OID/owner/ACL facts for independent inspection. Fail and roll back on unexpected creator defaults; do not alter global/default ACLs to force a pass. Later native negative fixtures must inject extra schema CREATE and USAGE separately, grant options and unexpected grantors, and verify atomic rollback. This narrow assertion is required even though the complete version5 descriptor is separate work.

The two findings were actually sent to Master in `msg_9b03ac487caf`. Master confirmed comparison and assigned Backend FIX in `msg_18805d24a6a8`. A first send using an erroneous `terminal:` target prefix returned `terminal_not_found`; the successful receipt above uses the full terminal ID directly. No delivery claim rests on the failed attempt.

## Source checks without additional mandatory findings

These are source observations, **not native PASS results**.

| Area | Observation and remaining boundary |
| --- | --- |
| Unpublished execution boundary | Lines 4–5 open one transaction and unconditionally raise before role/schema creation. Registry/version3/4 integration is absent by design. Fuse remains intact. |
| Approved ADMIN exception | Preflight pins migration/root OIDs, PG major 18 and empty `createrole_self_grant`; automatic/final checks permit exactly one root-granted ADMIN edge with inherit/set false. Temporary self-granted SET and schema CREATE surround exactly two OWNER transfers, then are revoked. Runtime paths to management owner are rejected. The management owner can reacquire SET by ADMIN, as explicitly accepted in B26; this is not runtime isolation from management credentials. Actual native edge/revoke behavior remains unverified here. |
| Definer boundary | Exactly two entry functions declare SECURITY DEFINER, VOLATILE, fixed `pg_catalog,pg_temp` search path and row_security on. Application relations/helpers are qualified; no caller-chosen identifiers or dynamic SQL. Actor is derived from `dream.actor_id()`, not a passed owner. Actor GUC trust still depends on private runtime credentials and server-verified Auth/B3. |
| Function ACL creation/transfer | Immediate named revokes follow helper/entry creation within the same transaction. API gets only two entry signatures. Final function ACL checks inspect typed grantees/grantors and owner/settings; schema gap is F27-2. Do not replace the selected same-transaction path with global default ACL changes. |
| Grants/RLS and trigger dependencies | Nine SELECT relations, three INSERT relations and two single-column UPDATE lock grants match B26. UPDATE USING is scoped and WITH CHECK false. SQL4's pristine deferred consistency branch reads objects, asset state, operations and receipts; these are granted. Its cleanup read is conditional on nonnull cleanup_id, so absence of a cleanup grant is not an additional fresh-insert defect. Replay FOR UPDATE alone does not queue an object UPDATE event. Full native immediate/deferred dependency and effective RLS tests remain mandatory. |
| Lock order | Both entries reject other isolation levels before locking, then lock/check the asset-upload policy anchor and matching current version. Replay resolves history and locks the required owner/object with FOUND/exact ID checks; it does not later INSERT/update the request ledger. Fresh path uses the owner/request unique latch before unique business inserts. No object-first policy reacquisition is present. Native zero-row lock negatives and lock-only mutation rejection remain unverified. |
| Latch/race | INSERT DO NOTHING RETURNING on owner/request is followed by a separate replay statement after a loser waits. Entries/helper are VOLATILE and enforce READ COMMITTED. Fresh winner checks clock/preparation/expiry after latch acquisition. Actual two-session commit/rollback waiter behavior is a native gate, not proved by these statements alone. |
| Immutable data relationships | Two new tables are append-only, ENABLE/FORCE RLS. Ledger targets the exact new intent UNIQUE tuple through a deferred composite FK, plus immutable policy-body tuple FK. No object/intent upsert adopts collisions. Policy body digest is separate from the pre-existing opaque policy digest. No approved body provisioning is supplied, as explicitly disclosed. |
| Replay versus evolved state | Ledger result/raw hash/fingerprint are checked against original intent and immutable object IDs/times. Current lifecycle/revisions/status are returned separately. Today's policy body/expiry is not required before historical replay; the anchor/version still must be sound. Changed client payload conflicts before proposed envelope/body/fresh-time checks. No pristine B25 decoder is applied to an evolved object. |
| Historical reader scope | `replay_v1` checks many cross-row bindings but is not a complete closed-envelope/policy-body decoder: e.g. codecVersion, original authority arrays and providerVersion are not individually revalidated there. Fresh admission's whole-envelope equality checks those fields, and intent identity/history is immutable. I found no separate legal fresh/evolution path that bypasses those facts beyond F27-1. Do not claim a coherent management rewrite is an authenticated-runtime exploit. Native tests should nevertheless include original-history corruption rejection and confirm the promised reader boundary. |
| Client and envelope canonicalization | Exact six-MIME fixed-order client grammar, range and digest framing are explicit. Raw server envelope is retained; raw SHA is UTF8-unframed, semantic fingerprint uses domain plus canonical JSON. JSON lexemes are checked before jsonb conversion, duplicate keys use SQL/JSON unique-key predicate. Closed fresh equality binds all expected fields. SQL parser/recursive duplicate/escaping behavior has not been executed. |
| B25 restriction and exact values | ASCII-decoded-string restriction, byte limit versus JS character limit, fixed incoming key rule and providerVersion null are explicit new draft choices. They need acceptance/paired vectors, not silent full-Unicode compatibility claims. Authority UUID mismatch is a distinct undeclared gap, F27-1. Epoch conversion uses integer days plus small remainder in UTC; integer bounds/expiry ordering are visibly checked. Native MAX_SAFE/timezone/hash parity is still open. |
| Atomicity and COMMIT | Exception-bearing reserve block contains ledger/object/intent writes; post-latch errors raise and unwind that block. Fresh return is staged with commitConfirmed=false and issuanceAuthorized=false. Deferred checks and outer COMMIT remain outstanding. B3 PG_TRANSACTION stays conservatively unknown; no signer/provider/automatic retry is authorized. Fault injection and real lost-COMMIT reply remain native/integration gates. |

One minor documentation issue for later tag mapping: read_upload_seed_v1 line 296 can emit `POLICY`, which is absent from the handoff's enumerated result tags. It fails closed and is not a third mandatory source blocker; keep any eventual closed adapter mapping consistent with actual source tags. No public HTTP contract was implemented here.

## Verification boundary and return

Source count is consistent with the draft description: nine functions (two definers/seven helpers), two tables, fourteen policies, two append-only triggers and an extra intent UNIQUE constraint. Counts are not an observed target catalog or an approved version5 descriptor.

No native test was attempted. In particular, syntax/PLpgSQL compilation, exact proconfig/ACL deparsing, non-superuser transfer and final ADMIN topology, default-ACL negative tests, full SQL4+5 trigger role/dependencies, locks/RLS negatives, concurrency, rollback/fault injection, evolved history, numeric/time/raw wire parity, outer COMMIT outcomes and pool hygiene remain **unverified**. Prior reduced PG18.7 probes and accepted B25 tests do not fill those gates.

Keep body provenance/provisioning, finite operating values and budgets, JS client adapter, complete v5 descriptor/registration/apply support, Auth/API/provider/runtime and deployment as separately assigned prerequisites. Their explicitly absent implementation is not mislabeled as a new hidden defect. No real database work is authorized by this review.

Only this report is staged/committed; `git diff --cached --check -- docs/handoffs/B27-R-UPLOAD-RESERVATION-SOURCE-REVIEW.md` is the report-format check. No new implementation tests were added for a read-only source review. Backend correction requires a separately frozen SHA and assigned re-review; this report does not preaccept it.

Copyable return to Master / Backend:

> B27-R original dfb521c SOURCE CHANGES REQUIRED: F27-1 policy UUID grammar admits versions excluded by accepted B25; F27-2 final schema ACL/grantor allowlist is missing. Positions, static counterexamples and narrow fixes are in this report. All DB execution/fuse removal/role changes stayed prohibited; native SQL5 remains unverified. Please return a fixed SHA for separately assigned source re-review, then separately authorize any owned native test scope.
