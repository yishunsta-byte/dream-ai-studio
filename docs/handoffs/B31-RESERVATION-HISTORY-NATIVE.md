# B31 — Native history replay after expiry and policy advance

Status: **author native PASS, three assigned scenarios; independent review pending**. Master assignment `msg_5fdc804011bb`, receipt `msg_e1c91b3a4a23`. B30's bounded matrix was accepted after independent `e98aadd`; that does not preaccept B31. Only this report and `tests/b31-reservation-history-native-owned.ts` are added.

## Frozen source, invocation and ownership

```powershell
node --import tsx tests/b31-reservation-history-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Actual **one invocation / one owned initialized cluster / exit0 / three scenarios PASS**. No first source/native mismatch, source patch, expectation relaxation or retry occurred. Focused type/lint checks passed before execution.

| Artifact | Fixed evidence |
| --- | --- |
| SQL5 source | fbfc48c95264eaf37826f943b5e35e9fe67fa616, LF SHA256 **9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb** |
| Scratch-only derived SQL5 | LF SHA256 **16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e** |
| Executed runner | LF SHA256 **02066cc739b3f876e7353bb3f05a2d21794086d04373c999b9aaa8465045b9c1** |
| Engine | Existing EnterpriseDB-signed **PostgreSQL18.7**, Windows x86_64/msvc-19.44.35229; Node26.13.0 |

The original and full SQL1–4 approved hashes are verified before startup. The unchanged SQL2 pin is `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`; other baseline pins are the same accepted values frozen in B28–B30. All five source files are compared unchanged. SQL5's repository fuse remains intact; only the exactly known **87-character statement at offset252** is removed in owned scratch, preserving its newline and proving exact reconstruction on reinsertion:

```diff
--- fixed-fbfc48c.sql
+++ B31-owned-derived.sql
@@ -5 +5 @@
-DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;
+
```

The entire derived source executes without guard/function/trigger/inventory edits. Full SQL1–5 are installed by a nonsuperuser migration login in a new synthetic UTF8/C-locale SCRAM database. No global/default ACL change, operating clock change or history UPDATE is used.

Evidence root: **D:/starwork/dream-ai-studio/tmp/b31-native-9978d763-6239-407e-a138-fc69049d6e69**. Postmaster PID **66836**, verified sole loopback listener **127.0.0.1:49420**. Original binaries/signatures/version, owned PID/data-directory/port are checked. No OS service/install/PATH change, existing cluster, shared3013/.next or app/browser was used. No `.env`, real DSN or credential is read; only newly generated local synthetic credentials are used and no password text is reported/committed.

## Real clock and guarded policy conditions

Each original is normally created by restricted `b31_api_a` (OID**17837**, backendPID**79732**, nonsuperuser/no-BYPASSRLS/no-CREATEROLE), using local dream_api/fixture-owner GUC, a real current DB seed, B19/B25 encoding, staged/commitConfirmed=false/issuanceAuthorized=false, then a **confirmed COMMIT**. Its first native observation is before both original deadlines.

Expiry cases use explicitly synthetic intentTTL**800ms** / issueEnvelope**500ms**. The observer polls for at most the 5-second observation window using a single materialized `clock_timestamp()` numeric sample per query, comparing that exact numeric value against both original deadlines. The25ms scheduling pause is not expiry proof. Both actual expiry observations completed in about0.8seconds. No fake clock, mutable deadline, historical-row rewrite or time-guard bypass is involved.

Policy changes are bootstrap-only synthetic fixtures. Immutable version/body rows are appended, and the existing guarded current pointer is updated with epoch+1/revision+1 and exact tuple FK. New bodies change authority arrays from worker1 to worker2, max issues3→1, byte ceiling and durations. They are not a runtime policy-provisioning executor or operational values. Previous bodies/versions and original object/intent/ledger are retained.

| Scenario | Original→current epoch | Original authorization / issue deadline (epochms) | Native DB clock at test condition | Condition |
| --- | --- | --- | --- | --- |
| A Expiry only | **1→1** | **1794945614200 / 1794945613900** | **1794945614211.984000** | Strictly after both, no policy transition |
| B Policy only | **2→3** | **1794945734246 / 1794945704246** | **1794945614253.987000** | Before both, current tuple/body advanced |
| C Expiry and policy | **4→5** | **1794945615072 / 1794945614772** | **1794945615077.272000** | After both and current tuple/body advanced |

The same conditions remain true after all scenario checks; final observed clocks are A1794945614241.484000, B1794945614268.760000, C1794945615091.522000. Samples are retained as native numeric text with booleans from the same sample; no Date/float epoch comparison establishes expiry.

## History, payload and owner results

For **each** scenario:

* `read_upload_seed_v1` and `reserve_upload_v1` with original owner/request/canonical client both return **replay**, exact original result, original envelope bytes, original policy epoch/digest and **issuanceAuthorized=false**. No new seed/staged reservation, refreshed deadline or authority is returned for that history.
* Same owner/key with requested bytes changed1024→2048 returns exactly **CONFLICT** from both entries, before fresh proposal/expiry policy admission. No original result/raw is attached to the closed error.
* Independent restricted `b31_api_b` (OID**17839**, backendPID**78376**) sets the other fixture owner. Its same request/key read returns **its own seed**, not the original reservation/IDs/envelope; submitting the original owner's envelope returns only **INPUT**. Owner-scoped request IDs legitimately permit another owner's seed; this is not claimed as a global request-ID ban or actual server Auth proof. No other-owner ledger or object is created.

There are three original seed/stage/COMMIT workflows and, afterward, six exact history calls, six changed-payload calls, six other-owner calls and three stale fresh calls. This is **three scenario groups**, not27 independent protocol cases. Runtime entries are on restricted connections; management only provisions/observes synthetic facts. No B3 wrapper/getUser integration is exercised.

Before/after snapshots include every native field of the original ledger, intent and object via `to_jsonb`; canonical snapshots and hashes match field-for-field, including exact raw text/result/digest fields. B25 native text projections then decode to the exact original pristine model/raw/SHA/fingerprint in all three scenarios. Intent status remains open and object reserved/revision0: clock expiry is proven separately and no cleanup/evolved status is manufactured. This is not evolved-row replay coverage or a claim that a pristine codec checks current authorization.

## New-key stale proposal: actual first guard

The negative proposal binds a **new request ID and new object/asset/intent IDs with the matching incoming path**, while retaining original timestamps/policy/authorities. Thus rejection is not a trivial request-ID mismatch or collision with existing candidate IDs. The database clock remains real and unchanged; this is a deliberately old proposal, not a fake execution clock.

| Scenario | Actual fresh return | Guard classification from fixed source and test facts |
| --- | --- | --- |
| A | **STALE_SEED** | Old policy/body still matches and exists. After valid closed-envelope binding and the new request latch, current DB time exceeds original windows. Source line379 raises B27_STALE_SEED/P0002 and line397 catches it to this closed tag, undoing the subtransaction. The internal exception is caught; no raw exception is claimed as externally emitted. |
| B | **INPUT** | Old tuple/authorities/durations differ from current policy. Whole-envelope equality at source line356 rejects **before** latch/time check. It is a generic binding tag, not a dedicated epoch-error SQLSTATE. |
| C | **INPUT** | Current-policy envelope binding fails first, even though time is also expired. Do not mislabel this as an observed expiry-guard execution. |

The test intentionally **COMMITs closed rejection tags** and then checks no partial new-key ledger/intent/object remains. This tests the bounded function's own atomic failure guarantee, even for a caller that ignores a failure tag; it is not the recommended B3 adapter error handling. No cap/outbox records exist. Each scenario retains exactly one original ledger/intent and zero other-owner/stale-candidate rows; final aggregate is **ledger3 / object3 / intent3 / capabilities0 / outbox0**.

## Retained evidence, checks and cleanup

`derivation.json`, saved original/derived SQL and exact diff identify the fixed source and authorized derivation. `ownership.json`, `run.json`, `principals.json`, `runtime-identities.json`, signatures/version/listener logs identify native engine/ownership. Each `*-result.json` plus `checks.json` contains original/current policy rows/bodies, original raw/result, deadline/creation/final clock samples, both history and conflict/foreign/stale responses, before/after snapshots/hashes, counts and B25 roundtrip. `events.json` preserves policy installation and entry-return-then-COMMIT order. `active-case.json`/`stale-proposal.json` retain latest phase inputs for first-failure diagnosis. No unexpected first-failure file was produced.

Focused checks passed before the run, then selected whitespace/protected-source comparisons passed:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck tests/b31-reservation-history-native-owned.ts
node node_modules/eslint/bin/eslint.js tests/b31-reservation-history-native-owned.ts --max-warnings 0
```

`stop.log`, `stopped-listener.log`, `cleanup-safe.json` confirm **postmasterPidAbsent=true, listenerAbsent=true, completed=true** for PID66836/port49420. Owned data/logs remain for inspection. Protected original SQL/model/B25/package/registry/runtime and B28/B29/B30 runners/reports are unchanged. No new agent/window/worktree, extra cluster or product build/deploy was used; no provider/Storage/managed/API-app change occurred.

Still outside this result: receipt/registration/cancellation/other evolved rows, helper extreme/bulk/other-major matrices, B3/real Auth/pool handling, lost/uncertain COMMIT response, provider late writers/operational budgets and complete version5 registry/provisioning/deployment. All COMMIT responses in these tests were received. Fixed author result is ready for separate Tester review, not independent acceptance or operating authority.
