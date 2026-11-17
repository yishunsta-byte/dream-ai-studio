# B34 — actual reservation adapter, owned native foundation

**Author result: PASS for the assigned normal native foundation; independent review pending.** The actual `postgresUploadReservations` service, unchanged `createPostgresPool` and installed pg driver executed against a new owned PostgreSQL 18.7 loopback cluster. No driver/factory mock, reply reconstruction, product correction or expectation relaxation was used. This does not activate production or prove lost-COMMIT/races/expiry/evolved behavior.

## Basis, scope and invocation

- Adapter fixed source: `5f97f007abd2272dff265f19d229e14ab609c7c3`, accepted code/unit/fault R3 `2afbc3e`. All six module LF SHA256 values are pinned in the new harness and verified before native setup and after service execution.
- Exactly two new paths: `tests/b34-reservation-adapter-native-owned.ts` and this handoff. B33 modules/tests/reports, B3, SQL1–5/fuse, old native harnesses, config/package/env, app/HTTP/UI/registry and shared 3013/.next were not edited.
- Existing `.tools/b3-postgres-18.7/pgsql/bin` only: postgres/initdb/pg_ctl Authenticode Valid EnterpriseDB, actual version 18.7; no installation or existing cluster/service reuse.
- `server-only` uses the existing package's official `react-server` export condition (`empty.js`); no package patch or mock. Fixed synthetic credentials are created only for this new cluster. No .env/real DSN is read; inherited PG defaults are cleared inside the harness process.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/b34-reservation-adapter-native-owned.ts --max-warnings 0
node --conditions=react-server --import tsx tests/b34-reservation-adapter-native-owned.ts --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

All three final commands exited 0. The native invocation ran once, printed seven recorded checks and stopped its cluster. The two preconnect negative results are separately retained in final.json; seven recorded checks are not seven independent native runs. An initial pre-execution typecheck rejected assigning generic sha() text to the service's literal SQL5 pin; the harness uses the already-verified literal and passed full tsc before native execution. A scratch source-generation interpolation error occurred before a harness file/native process existed; no product error is attributed to it.

## Source derivation and synthetic provenance

SQL1–4 full source hashes match the historical fixed baselines (`3f88da7…`, `1b60efc…`, `7aa9567…`, `61ceb11…`); full expected values are explicit in the harness. SQL5 fixed fbfc48c source SHA256 is `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`. Only the exact 87-character fuse statement at offset 252 is removed from a scratch copy. The inverse reconstruction is checked; derived SHA256 is `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e`. Original fused SQL5 stays unchanged. Both original and derived SQL plus the one-statement diff/derivation metadata are retained under the owned root.

The new bootstrap directly creates a non-superuser/non-bypass migration owner, applies full SQL1–4 and the approved synthetic SQL5 derivation, creates two restricted LOGIN NOINHERIT principals and grants only the explicit dream_api edge with ADMIN FALSE / INHERIT FALSE / SET TRUE. The actual native grantor, role flags, function owners/config/ACLs and exact two function OIDs are retained separately in synthetic-provisioning.json. The 13-field owned-synthetic target is built from those trusted provisioner facts. Its POJO/provenanceId is not production provenance authentication. Database name `dream_test_b34_adapter` satisfies the unchanged factory's loopback/no-TLS test restriction.

## Actual service results and bindings

| Check | Actual result |
| --- | --- |
| New admission | success / confirmed / cleanup ok, origin created, exactly three generated UUIDv7 IDs; one actual ledger/object/intent triple. No capability/outbox rows. |
| Stored B25/model | Read actual ledger and fixed B25 object/intent projections. Actual B19 reconstruction and B25 decode agree on exact raw request, SHA/fingerprint/model and all ten returned reservation DTO fields. No B25 INSERT specification is executed by the harness/service. |
| Same-key same-payload | success / confirmed / cleanup ok, origin replayed; original DTO/rawSha/fingerprint preserved, generated ID count remains 3 and triple counts unchanged. |
| Changed client payload | not-applied / CLIENT_CONFLICT / cleanup ok, no new IDs and all counts unchanged. |
| Other synthetic owner, same key | Own new admission with distinct IDs, no original object/intent identifier in its response. Each owner has one own ledger. Total becomes two triples and six generated IDs intentionally. |
| Management credentials | not-applied / CONFIGURATION_REJECTED / cleanup ok; server log shows identity query only, no BEGIN/entry and no writes. |
| Swapped function OIDs | not-applied / CONFIGURATION_REJECTED / cleanup ok; actual metadata check then ROLLBACK, no entry and no writes. |
| approved-runtime | DISABLED; no adapter connection/SQL added to the server audit. |
| Unverified actor | AUTH_REQUIRED, identity null, body getter reads 0; no adapter connection/SQL. This is a synthetic trusted-actor fixture, not actual Auth integration. |

First-owner actual rawSha: `d222e91cffaeb5044224b2c987d9da3aea98bf7f0674706b43c9f66afc0f53e4`; fingerprint: `d9a41f50f6ab8d9ac9ea16e45689508c59bb866bcff677bad408d63112341236`. Full raw/rows/model remain in native-triple-b25.json. No first product catalog/query/reply/cleanup mismatch was observed; server audit contains zero ERROR records. No native SQLSTATE failure is claimed or hidden.

## Connection and cluster cleanup evidence

Owned evidence root: `D:/starwork/dream-ai-studio/tmp/b34-native-977b1a8e-b790-4f0d-85a2-7eec5c518507`.

Cluster PID **68644**, loopback port **55808**. postmaster.pid directory/PID/port and OS listener ownership were checked before setup. Statement/connection/disconnection audit was enabled only after secret-bearing provisioning. Actual adapter backend PIDs were **53772, 44284, 21560, 37480, 74256, 58300**; all six have disconnection records. Server statements show real RC BEGIN, fixed local role/actor, function metadata and two-entry dispatch where expected. Only new owner admissions call reserve (two calls); replay/conflict do not. Three successful admissions/replay commits have hygiene checks. Management and wrong-OID controls stop at their corresponding boundaries.

After every attempt, pg_stat_activity contains no dream-backend session. At the final observation the server is still responsive and the only client in the fixture DB is the intentionally owned bootstrap observer (PID 75560), distinct from adapter connection cleanup. Final counts: requests 2, objects 2, intents 2, capabilities 0, outbox 0. Harness finally closes tracked clients, verifies its exact cluster identity, requests pg_ctl fast stop and records postmaster.pid absent / listener absent / completed true. A later explicit external read-only check also confirms PID 68644 absent and no listener on 55808. No existing cluster was stopped.

Timing correction: while the native session was still running, startup output seemed delayed and an inherited-pipe problem was tentatively reported in msg_6f1341d4695a. The original process then returned exit 0 with all checks and its own completed shutdown. A manual stop attempt found postmaster.pid already absent and pg_ctl reported not running; it had no effect. The original start.log completed at 06:48:20, normal admission occurred around 06:48:22 and stop.log completed at 06:48:32 KST. The pipe hypothesis is not an established failure. It was explicitly corrected in msg_3d49a8d3123f and Master acknowledged in msg_b01ee0eaa933; no startup runner change, second cluster or rerun followed. operator-timing-correction.json preserves this distinction.

## Retained evidence identities and next gate

| Evidence | SHA256 (file bytes) |
| --- | --- |
| checks.json | `5dd227a598ae1552c31ac5a7a5d1c38b1e66fb2394a771b4ad589bb624dcfb5f` |
| final.json | `cac2040e42b3439657dccf6e93f507f978d4e131cba4bbfc954af1e3e9635faa` |
| synthetic-provisioning.json | `2cdc8150a098642126d066d21bc3febea9268f7b4fca5265a892860c11a0221b` |
| native-triple-b25.json | `d4763efa8553fa770a6b85257a0aed51c5abaf1ffe3c9d6f9c7209f9be05399c` |
| native-server-redacted.log | `6c3623da786c91bfb9ef85290149bf82d86a641617f2429abcbc6bd29102d952` |
| cleanup-safe.json | `a420e09d19f89b4bb92ab54533fc3c0aa2fe6faa2ca4303f268131f5df323f2e` |
| post-run-external-cleanup.json | `10bf46ebcb0d4c4485c758cd6ca21267c45436e55f0d38d6a5158819e7fc8bb1` |

Executed harness LF SHA256: `83d8de7edd617ef189dbad1f738d7aeacbeeace4f06438216d1180a3b7934851`. The post-run adapter-server-audit-summary.json is an offline summary of the retained server log, not an additional DB run. The native source and outcomes remain reviewable in the owned scratch; synthetic password material is not included in this handoff or Orca messages.

Not verified: actual committed-response loss/reconciliation, expired/evolved policy/lifecycle, repeated concurrent races, faulted socket/late shutdown, actual Auth/B3 composition, production target authentication/full-v5 provisioning, operating budgets or activation. approved-runtime stays DISABLED and no route/runtime/registry is connected. Next gate is Tester's separately assigned independent native verification of the fixed B34 source.

Copyable return: B34 author normal native foundation PASS on unchanged5f97f00 actual service/factory/pg in one owned PG18.7 cluster; seven recorded stages plus approved-runtime/invalid-actor controls pass, actual stored B25/raw/hash/model bindings and two owner-isolated triples observed, six adapter sessions disconnected/pg_stat_activity clean, PID68644/port55808 stopped. No product mismatch/fix or production activation; startup-delay hypothesis explicitly corrected. Request independent B34 native review of the new two-path fixed commit.
