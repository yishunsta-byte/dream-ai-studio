# B35-R — Independent actual COMMIT ACK-loss native review

**Verdict: PASS for the assigned single owned PostgreSQL18.7 COMMIT-response-loss scenario.** Independently executed the frozen actual-service harness once, exit0; independently checked durable data, B25 bindings, event chronology, native statement/session audit and OS resource shutdown. No mismatch found. Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_c04b1ae3ad0c`; acceptance receipt `msg_04de3bfca01f`. Date: 2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen source and execution

| Item | Independent evidence |
| --- | --- |
| Harness commit | `bc9c107cd8375c55ff9622054267211f70a19f41` |
| Harness | `tests/b35-reservation-commit-loss-native-owned.ts` |
| Harness LF SHA256 | `083107f60b373922526e2e59c69b5812e08024691c1561c6b63c4a718c01173c` |
| Accepted six-module adapter | `5f97f007abd2272dff265f19d229e14ab609c7c3`; all six pins matched before/after |
| Owned native evidence | `tmp/b35-native-9e7d6a10-4936-4a7c-8e34-266b97ca891b` |
| Independent scratch | `D:/starwork/b35r-review-bc9c107` |
| PostgreSQL | Existing signed PG18.7 binaries; owned PID66192, sole listener127.0.0.1:64467 |
| Proxy | Owned runner PID58952, sole listener127.0.0.1:64532 |

```powershell
node --conditions=react-server --import tsx tests/b35-reservation-commit-loss-native-owned.ts --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

One invocation, one fresh UTF8/C SCRAM cluster and `dream_test_b35_adapter`, one proxy connection, one explicit direct-primary reconciliation. No rerun, fixture patch, mock driver/factory/reply or package modification. Actual `postgresUploadReservations`, `createPostgresPool` and installed pg execute. Official server-only0.0.1 `react-server` export is used. Preflight matched42 protected source/package/config files to the fixed commit; installed dependency closure20 packages/1091 files retained separately (including pg8.23.1/pg-pool3.14.0/tsx4.23.15). All42 source hashes remained unchanged afterward.

Original SQL1–4 pins verified by the frozen harness. Original SQL5 LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` remains fused. Independently checked that only the exact87-character fuse at offset252 was removed in this owned scratch derivative, preserving543 lines; derivative SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e`. No other SQL rewrite or application permission inferred.

Full baseline and derivative execute under the fixture's migration login. Restricted native login/API/issuer/M/bootstrap/function OIDs are actual13-field owned-synthetic target metadata:17837/17115/17736/16389/10 and read17830/reserve17831; API membership grantor10. This establishes fixture provenance only.

## Framing and loss boundary

Reviewed the proxy parser before execution. It assembles startup length headers and subsequent typed PostgreSQL length frames, handles partial headers/bodies, enforces frame bounds and forwards opaque startup/auth traffic. Exact frontend `Q` payload `COMMIT\0` is forwarded once. Exact server `C` payload `COMMIT\0` and following idle `Z` are withheld, using frame type and complete payload rather than chunk substring searches. Deliberate seven-byte parser fragments exercised40 partial headers and1479 partial bodies.

Observed counters: accepts1, clientCommits1, heldCommitCompletes1, heldReady1, forwardedCommitAcks0; failed=false. No reconstructed server ACK or fake native result is injected. Socket frame buffers exist transiently; persisted proxy evidence contains safe event names/times/counters/ports only. No raw packets, startup/auth/SCRAM or credentials are recorded. Server statement audit is enabled after secret provisioning, with bind/error parameter logging disabled; the redacted native log has no ERROR/FATAL/PANIC or authentication-secret payload records. Required synthetic B25 application data is retained separately from wire evidence.

Independent chronology from persisted artifacts (epoch milliseconds):

| Event | Time |
| --- | ---: |
| Exact client COMMIT frame forwarded |1794953835302|
| Server COMMIT CommandComplete and idle ReadyForQuery withheld |1794953835312|
| Separate primary observer clock; recovery=false |1794953835313.753|
| Committed triple/B25 saved; API still pending, proxy not dropped |1794953835319|
| Owned proxy pair destroy requested |1794953835320|
| Both owned sockets closed |1794953835321|
| Original unknown result saved |1794953835322|
| Explicit direct-primary replay saved |1794953835375|

The observer was PID67828 on the authoritative primary. Before the drop it saw exactly one ledger/object/intent triple, zero capabilities/outbox, and the restricted backend idle after COMMIT while the API remained pending. This proves server commit precedes both connection loss and the public unknown result.

## Outcomes, replay and native audit

Actual driver result: `failure / commit=unknown / reason=OUTCOME_UNKNOWN / cleanup=failed`, with stable original requestId/clientVersion/clientDigest. Observed elapsed91.2566ms is below attemptDeadline10000ms: this is actual socket loss before the external deadline. The original frozen unknown remains unchanged after reconciliation. Cleanup failed preserves the observed driver connection-error path; physical resource closure does not retroactively change that typed result to ok.

An explicit fresh call against the direct primary with the same actor/key/payload returned `success / confirmed / cleanup=ok / origin=replayed`. Total generated IDs remained3, proxy accepts remained1, final counts remained requests1/objects1/intents1/capabilities0/outbox0. Thus there is no internal retry or duplicate write.

Independently recomputed raw SHA, domain-separated semantic fingerprint, client/result digests, complete decoded model and all ten replay DTO fields from the stored original raw JSON. Before/after decoded data is identical; no issuance authority is granted. Raw SHA `b7abd28abd8665ab6cfe1b6f8ddeda2fe73f8abf5521d63e8717bf8cbf78db8f`; fingerprint `0c5aa57a3ae844c738cb8f946a4764282d970995017b55c14eb1797333c9223b`.

| Native adapter PID | Identity | Read seed | Reserve | COMMIT | ROLLBACK | Hygiene | Disconnection |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
|57432 original through proxy|1|1|1|1|0|0|1|
|66168 explicit primary replay|1|1|0|1|0|1|1|

The first session cannot run post-COMMIT hygiene after transport loss. The replay performs normal hygiene. After both loss and reconciliation, fixture DB activity contains only the responsive observer, no dream-backend session. Native audit has exactly these two adapter sessions and one reserve execution.

## Cleanup and limits

Harness completed=true/stopped=true, with owner-verified cluster shutdown. Independently queried OS after exit: PostgreSQL PID66192 absent, runner/proxy PID58952 absent, both owned listener ports absent, postmaster.pid absent. Proxy final sockets0/listening=false; no first-failure or cleanup-failure artifact. Evidence retained; no unrelated process/service was stopped.

Independent `inspect_evidence.py`, `independent-evidence-summary.json`, `independent-os-cleanup.json`, `preflight.json`, dependency manifest and `run.log` are retained in the separate scratch directory. Native evidence includes `before-drop-committed.json`, `proxy-ack-held.json`, `proxy-final.json`, `unknown-result.json`, `reconcile-result.json`, activity snapshots, provisioning, redacted server log and `cleanup-safe.json`.

This acceptance covers one deliberate actual COMMIT-ACK-loss scenario, the returned unknown identity, explicit same-key primary replay and owned cleanup. It does not extend to additional races/expiry/evolved behavior, real authorization/B3, managed/provider/registry integration, runtime activation, production provenance or deployment. No UI/route/config/package/protected source change, build, installation, additional agent/window/worktree or shared server3013 operation occurred.
