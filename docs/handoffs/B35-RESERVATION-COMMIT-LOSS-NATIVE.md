# B35 — actual COMMIT response loss and explicit primary reconciliation

**Author result: PASS for the single assigned actual COMMIT-response-loss and explicit-reconciliation scenario.** Native command exited 0, with original unknown/cleanup failed and explicit replay confirmed/cleanup ok. Fixed-source independent acceptance is pending. Production remains DISABLED.

## Scope and fixed basis

Only `tests/b35-reservation-commit-loss-native-owned.ts` and this handoff are new. Actual adapter remains `5f97f007abd2272dff265f19d229e14ab609c7c3`; all six module LF SHA256 values are pinned before/after execution. B34 normal-native source `3749241` and accepted independent review `862e2fb` remain separate evidence. No product module, driver/factory, B3, SQL source, old harness, config/package/env, HTTP/UI/registry or activation is modified.

The harness uses the existing signed PG18.7 binaries, a new owned loopback cluster and `dream_test_b35_adapter`. Full fixed SQL1–4 hashes and SQL5 fbfc48c hash are checked. Only the approved exact 87-character fuse at offset 252 is removed from a scratch copy; inverse reconstruction and derived SHA256 are checked. SQL5 original SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`, derived SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e`. Existing source/fuse is unchanged. Provisioned native restricted role/function/edge OIDs and policy are retained separately; owned-synthetic POJO acceptance is not authenticated production provenance.

## Loss mechanism and evidence requirements

The unchanged real service uses unchanged createPostgresPool and installed pg through an owned ephemeral loopback TCP proxy. No pool/query replacement, mock, fake driver error, raw socket logger or fabricated reply is used. Existing `server-only` uses its official react-server export condition. TLS is false only under the unchanged explicit loopback/dream_test exception.

The proxy buffers the normal PostgreSQL startup length and subsequent typed frame lengths, bounds individual frames to 1 MiB and transparently forwards opaque authentication/startup/SCRAM data without inspecting or recording it. It deliberately feeds each incoming chunk through seven-byte fragments to exercise partial-header/body buffering independently of OS TCP chunking. It recognizes only a fully framed frontend simple Query Q with exact COMMIT plus NUL (the fixed real driver's actual COMMIT path), then withholds the matching backend CommandComplete C with exact COMMIT plus NUL and following idle ReadyForQuery Z. No byte-chunk string search is used. Unknown extended query traffic is forwarded transparently; this fixture does not claim a general extended-COMMIT fault proxy.

Only safe event names, timestamps, ports/PIDs, frame-state counters and lifecycle outcomes are persisted. Raw transport buffers, credentials and authentication/SCRAM payloads are never saved. Server connection-authentication logging is not enabled. SQL parameter logging and error-parameter logging are explicitly disabled before audited service traffic. Synthetic native B25 request/row data is read from the database for the separately required durability/model binding evidence, not captured from wire frames.

Required order in the single scenario:

1. Actual restricted adapter sends COMMIT; server C(COMMIT) and idle Z are withheld, neither reaches the driver.
2. A separate direct-primary observer checks pg_is_in_recovery=false, actual committed ledger/object/intent triple and native B25 raw/hash/model; adapter still has not returned, its backend is idle and original attempt deadline has not expired.
3. Only after that evidence is saved, destroy the owned proxy socket pair. Real installed driver observes the connection loss and returns a typed unknown outcome before the attempt deadline. No internal retry/new IDs are allowed.
4. Explicitly call the direct authoritative-primary service with the same owner/requestId/canonical client payload. It must replay original IDs/ten DTO bindings/rawSha/fingerprint, generate no further IDs and leave exactly one triple/capabilities0/outbox0. The already returned unknown is immutable.

## Commands and pre-execution checks

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/b35-reservation-commit-loss-native-owned.ts --max-warnings 0
node --conditions=react-server --import tsx tests/b35-reservation-commit-loss-native-owned.ts --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

Final pre-native full TypeScript and lint exit 0. Initial preparation exposed two socket data event typing errors and one lint expression issue; these were corrected only in the new harness before any native execution. No initial product failure is attributed to those preparation checks.

## Run evidence and cleanup

Owned root: `D:/starwork/dream-ai-studio/tmp/b35-native-87c47ce4-32d2-4180-aded-59c318b037e8`.

Exactly one native invocation completed, with no harness changes after its successful pre-native type/lint checks. There was no product/catalog/query/reply mismatch and no expectation relaxation. PostgreSQL PID **67492 / 127.0.0.1:56124**; proxy Node PID **45016 / 127.0.0.1:56179**, independently checked OS listener ownership. Original restricted adapter backend **77488**; direct primary observer **76332**; explicit reconciliation backend **23076**. No existing cluster was touched.

| Actual ordered observation | Epoch milliseconds / result |
| --- | --- |
| Proxy accepts original adapter connection | 1794953304885; one accepted connection in total |
| Fully framed client COMMIT forwarded | 1794953304953; one actual COMMIT command |
| Server C(COMMIT) and idle Z withheld | 1794953304962; one of each, forwarded COMMIT ACK count 0 |
| Direct primary clock / committed data | `1794953304964.053000`; pg_is_in_recovery false, one actual triple, native B25 decode/model/hash valid |
| Evidence snapshot before drop | 1794953304968; original adapterReturned false, backend77488 idle under restricted login, not dropped, original deadline not expired |
| Only owned proxy pair destroyed | 1794953304969 |
| Both proxy sockets observed closed | 1794953304970 |
| Original public unknown recorded | 1794953304971; elapsed **88.2413 ms** against the 10000 ms attempt deadline; OUTCOME_UNKNOWN / cleanup failed |
| Explicit direct-primary replay recorded | 1794953305030; success / confirmed / cleanup ok / origin replayed |

Thus this is actual acknowledged server-side COMMIT with its response withheld before delivery, independently observed primary durability and actual connection-loss response, not merely a timeout or simulated successful commit. The observer evidence was saved before dropping the pair. The original immutable unknown has the unchanged requestId/clientVersion/clientDigest (`f431193a04c82393e61142e73fd4f98fc823cf33cd9d8aa4760c15a774e415ea`), without falsely reporting the observer's durability as an ACK delivered to that caller. No internal retry occurred: proxy accepts1, original generated3, final generated3.

The explicit caller's same owner/request/canonical payload produces exactly the original object `…0065`, asset `…0066`, intent `…0067` and all ten original reservation DTO fields. Native rawSha is `0df4d33d44144367b06f8f550cf307144143f2d64ba8ee9ae5454e295a3e565b`; fingerprint `81c07adc592b2c3a4c229c50e5765e5ff672b32a8a837d7c79c2c7b2c123f142`. Before/after native B25 decode agrees on exact raw/model/hash. Final counts remain ledger1/object1/intent1/capabilities0/outbox0. The replay allocates no IDs and does not retrospectively mutate the earlier unknown result.

Server audit shows the original backend read+reserve+COMMIT, reconciliation read+COMMIT with no reserve, and disconnection for both PIDs. The safe offline audit summary contains zero server ERROR records, no authentication details, no bind-parameter detail logging and no synthetic password in the server log. No raw packet, auth/SCRAM or wire payload artifact was collected. Native database request/rows are retained only for the required synthetic B25 evidence.

`cleanup: failed` on the original result preserves the observed connection-loss error path; it is not rewritten to ok based on later resource evidence. Physical cleanup is separately observed: proxy failed=false, sockets0, listener=false, drop once; pg_stat_activity has no adapter sessions after loss and after reconciliation (only intentional observer76332 remains). Finally closes owned clients, checks the exact cluster identity and stops it. cleanup-safe.json reports completed=true / postmaster.pid absent / listener absent. A later external read-only check confirms process67492 and both primary/proxy listeners absent. Typed failure cleanup and actual shutdown success are deliberately distinct facts; no leaked session or successful ordinary cleanup is inferred from the wrong evidence.

### Retained evidence hashes

All entries are file-byte SHA256 under the owned root:

| Evidence | SHA256 |
| --- | --- |
| proxy-final.json | `e9d3f0de85464fc0c4ad3af241d2b5df82bdd7b20367bed9c057f584cc6cacbd` |
| before-drop-committed.json | `e7167ff27f2f79e4907c4656ff63bde262698f0391c3f4bd1d990acc22f50988` |
| unknown-result.json | `6b5ae116270ed03059d9d9a1a20323b52461b326c8f7b129aa730aef23fae2fa` |
| reconcile-result.json | `0619b0eea0fff40071605c4e819238e8dba8ee82059c20fb8d7fb8ab80f53996` |
| native-server-redacted.log | `46ff4147b69d6cdea8ca7d589b29c6bc540d5ffacc948cbd844aae4d9574f4d6` |
| native-audit-summary.json | `806dd0be292041a551d9aeaba274cf0a60f65d3aaf36c63635564cce759349fe` |
| cleanup-safe.json | `58052ed6291e8fcbc28907b90c6385985c51d278ed36a1610b741051fe7b9818` |
| synthetic-provisioning.json | `c130a6faeff74edeec261ad5032ee4f7c2a5e415eeb8e971e076387a84209e71` |

Executed harness LF SHA256: `083107f60b373922526e2e59c69b5812e08024691c1561c6b63c4a718c01173c`. The offline audit summary reads retained server evidence; it is not another native attempt. Partial frame counters were headers40 / bodies1479; proxy events contain safe labels/times only. No delayed startup was interpreted as a failure or externally interrupted in B35.

## Remaining boundaries

No other race, repeated fault, expired/evolved lifecycle, real Auth/B3 integration, full production v5 descriptor/provisioning, operating-budget or provider/runtime activation scenario is included. No .env/real DSN, managed DB, existing cluster, shared 3013/.next, build/deploy/install or new agent/window/worktree is used. A successful author native result still needs separately assigned independent verification of the fixed B35 source.

Copyable return: B35 author single actual native COMMIT ACK-loss PASS on unchanged5f97f00. Framed C(COMMIT)/idle Z withheld, authoritative committed1triple/B25 proof saved while original API pending, then owned pair dropped; actual driver unknown/cleanupfailed at88ms, explicit original-key primary replay confirmed/cleanupok with IDs unchanged3 and final1triple/capoutbox0. Both native adapter backends disconnected; owned proxy56179 and PG PID67492/port56124 stopped. No secret packet/auth/payload logs, mock, product change or activation. Request independent native verification of the new two-path fixed source.
