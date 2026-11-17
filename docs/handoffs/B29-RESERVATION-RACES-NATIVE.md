# B29 — Owned native same-request reservation races

Status: **author native PASS, three assigned races; independent review pending**. Master assignment `msg_ee148d643abc`, receipt `msg_29559b3cc9a8`, final-return boundary `msg_34fd455bf804`. B28's nine-group local PG18.7 result was accepted after independent B28-R `fccd226`; this new result does not extend that acceptance to B29. Only the new runner and this report are owned here.

## Fixed source, reproduction and isolation

```powershell
node --import tsx tests/b29-reservation-races-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Actual result: **exit0 / three native races PASS**, one new owned synthetic cluster, no retry or source workaround. Engine is existing EnterpriseDB-signed portable PostgreSQL **18.7** / Windows x86_64-msvc-19.44.35229, Node **26.13.0**. postgres/initdb/pg_ctl signatures and exact engine version were verified. Runner LF SHA256: `9c4398041b6a94fdd7995d4f44a02fca5d8f52854c7a592077987a7bbde8e2f3`.

SQL5 source is B27-FIX **fbfc48c95264eaf37826f943b5e35e9fe67fa616**, fixed LF SHA256 **9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb**. Before cluster startup the runner checks this hash and exactly one occurrence of the known unconditional fuse. Only in its owned scratch it removes that **87-character statement at offset252**, retaining the newline. Exact reinsertion must reproduce original source. Derived LF SHA256: **16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e**.

```diff
--- fixed-fbfc48c.sql
+++ B29-owned-derived.sql
@@ -5 +5 @@
-DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;
+
```

The repository original fuse remains intact. This task's special scratch-only execution permission is not registry/apply/runtime permission. Full SQL1–4 are verified against the accepted LF hashes before execution: SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, SQL2 `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`, SQL4 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. All five execute in the new database as the actual non-superuser migration login; the entire derived SQL5 is submitted unchanged as one batch. No inventory bypass, function/guard patch, trigger instrumentation or SQL injection into the candidate is used.

Owned evidence root: **D:/starwork/dream-ai-studio/tmp/b29-native-ec6eb414-88df-481f-ac36-62e1053b8e95**. New server PID **64644**, sole loopback address **127.0.0.1**, random port **62887**. Listener PID/directory/port ownership is checked. No OS service, installation, global PATH change, existing cluster, shared3013/.next, browser or app server is used.

The local bootstrap provisions only this cluster's Auth stub rows, immutable synthetic policy body and two restricted logins. Test values are explicitly synthetic (1MiB ceilings, finite TTL/envelope/preparation and maxIssues3), not operating limits or policy-administration implementation. No `.env`, external DSN or real credential is read; PG ambient variables are discarded locally and clients use explicit loopback fields and newly generated synthetic secrets. Password text is not reported or committed.

## Deterministic native wait and release

Each race uses two **different LOGIN principals**, `b29_api_a` and `b29_api_b`, each on its own dedicated backend/connection. Native identity queries confirm distinct login OIDs/PIDs and nonsuperuser/no-BYPASSRLS/no-CREATEROLE/no-INHERIT flags. Both transactions set local dream_api and the same fixture owner GUC, then call the actual two bounded entry functions under their required READ COMMITTED isolation. No B3/Auth integration is claimed.

Both sides obtain seeds before the winner stages. Request ID and owner match, but candidate object/asset/intent IDs, raw envelopes and full server-snapshot fingerprints are deliberately different. Case2 changes requested bytes from1024 to2048; the other cases retain equal canonical client payload. The winner returns **staged, commitConfirmed=false, issuanceAuthorized=false**, while its transaction stays open. Then the loser entry starts asynchronously with immediate rejection handling.

The observer checks actual `pg_stat_activity` and `pg_blocking_pids` on those exact backend PIDs. It requires winner **idle in transaction**, loser **active**, nonnull transaction starts, loser wait_event_type **Lock**, and blocker list containing the winner PID. A 7-second monotonic deadline and native statement/query timeouts bound failure. The 25ms scheduling pause is not used as evidence; a resolved loser before observed blocking fails the test. **Only after recording this native wait** does the harness send the winner's COMMIT/ROLLBACK. It records command start/confirmed result and both original function returns separately.

| Race | Winner PID / XID | Loser PID / XID | Actual loser wait before release |
| --- | --- | --- | --- |
| Same payload, winner commit | **76532 / 778** | **77468 / 780** | Lock / transactionid, blockers **[76532]** |
| Different payload, winner commit | **76796 / 784** | **75892 / 786** | Lock / transactionid, blockers **[76796]** |
| Winner rollback | **53968 / 789** | **66320 / 791** | Lock / transactionid, blockers **[53968]** |

Monotonic ordering in this run (milliseconds from runner process origin):

| Race | Block confirmed | Winner release sent | Winner response confirmed | Loser return |
| --- | --- | --- | --- | --- |
| Same payload | 74578.2046 | 74578.2086 | 74587.0071 | 74592.9644 |
| Different payload | 74727.6472 | 74727.6490 | 74736.0652 | 74736.4109 |
| Winner rollback | 74865.9458 | 74865.9489 | 74866.1909 | 74875.8120 |

The harness requires native blocking before release and loser return after release starts. It does not depend on cross-connection network callbacks always arriving in release-response order; the exact observed order above is preserved as evidence, not a general protocol guarantee. Before release the independent observer sees zero committed ledger/intent rows for the key; **that absence is not treated as rollback proof**. Admission proceeds only through the actual unique-index serialization and known winner finalization.

## Three results and durable data

| Case | Winner's actual command | Loser's original API return | Loser's actual command | Durable original |
| --- | --- | --- | --- | --- |
| Same client payload | COMMIT confirmed | **replay**, exact winner result/original envelope, issuanceAuthorized=false | COMMIT confirmed | Winner IDs/raw snapshot/time, not loser's replacement proposal |
| Different client payload | COMMIT confirmed | **CONFLICT** | ROLLBACK confirmed | Winner IDs/raw snapshot; no loser writes |
| Winner rollback | ROLLBACK confirmed despite earlier staged return | **staged / commitConfirmed=false / issuanceAuthorized=false** | Its own COMMIT confirmed | Waiting loser's proposed IDs/raw snapshot; rolled-back winner absent |

All three cases leave **one ledger + one intent + one candidate object** for their owner/request. The rejected or rolled-back proposal's object/intent rows are absent. Capability issues and outbox rows remain **zero**. In the rollback case, the independent observer also sees zero request rows after loser stages and before its own COMMIT, proving the provisional return was not mistaken for a durable result.

For each committed result the observer joins ledger/intent/object on exact owner/request/intent/object keys and checks selected candidate IDs, canonical original client payload/digest, original server-envelope text, raw SHA and semantic fingerprint. It then runs the accepted B25 **fixed native text projections** against those committed rows, calls actual `decodeUploadReservation`, and deep-compares the reconstructed original model/raw text/fingerprint/hash with that candidate's real encoder output. **Three native-row B25 roundtrips passed.** These are checks within the three races, not additional concurrency cases. This uses pristine rows only and makes no evolved-row decoder claim.

Final aggregate: **requests3 / objects3 / intents3 / capability issues0**. No source/native failure occurred, expectations were not relaxed, and no second cluster/run was needed.

## Evidence, checks and cleanup

Evidence retained under the owned root:

* `ownership.json`, `run.json`, `principals.json`, `signatures.log`, `version.log`, `listener.log`: native engine/source/server ownership.
* `derivation.json`, `sql5-original.sql`, `sql5-fuse-only-derived.sql`, `fuse-only.diff`: exact fixed source and authorized derivation.
* `synthetic-fixture.json`: clearly synthetic owner/policy facts, no password.
* Each `*-blocked.json`: both backend identities, sampled transaction/wait states, actual blocker PID and settledBeforeRelease=false.
* Each `*-result.json`, `checks.json`, `totals.json`: original API returns versus actual finalization, monotonic events, both candidate raw envelopes/client payloads/hash pairs, selected durable row/counts and B25 roundtrip confirmation.
* `stop.log`, `stopped-listener.log`, `cleanup-safe.json`: owned shutdown. No unexpected first-failure file was produced.

Focused type/lint checks passed before the native run:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck tests/b29-reservation-races-native-owned.ts
node node_modules/eslint/bin/eslint.js tests/b29-reservation-races-native-owned.ts --max-warnings 0
```

Selected whitespace check and protected-file comparison passed. SQL1–5/B25/model/package/registry/runtime are unchanged relative to the fixed source; B28 runner/report are unchanged relative to ac7272f. No new agent/window/worktree or product build/deployment occurred. No signer/provider/Storage/managed/API-app work occurs in this runner.

Failure cleanup releases the blocker first before awaiting/rolling back its queued waiter, then closes all owned clients and stops only the verified owned data directory. Actual cleanup: **postmasterPidAbsent=true, listenerAbsent=true, completed=true** for PID64644/port62887. Data/logs remain on disk for inspection; the synthetic database is stopped and no existing service/cluster was touched.

Still unverified in B29: expired/evolved history, native UUID/time/canonical-boundary matrix, policy-advance races, broader lock/ACL matrix, B3/verified Auth and production pool handling, lost/uncertain COMMIT response, provider late writers, operational policy/budgets, other deployment majors and full version5 descriptor/registration/apply support. All three actual COMMIT/ROLLBACK responses were received. This is not a lost-COMMIT test or operational reservation approval. Fixed result is ready for separately assigned Tester review.
