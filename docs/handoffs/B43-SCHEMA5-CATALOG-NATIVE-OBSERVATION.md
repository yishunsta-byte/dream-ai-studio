# B43 — all catalog SELECTs returned; final dependency identity rejection

**Result: all15 fixed SQL dispatches and per-batch raw parsing completed; final cross-category decode/normalization rejected. No full observation/hash was produced.** This is first-failure diagnostic evidence, not full native/reference/state acceptance. Assignment `msg_42392e42248c`, receipt `msg_0cd6f05ae3dc`; first failure `msg_ab7e47524462`; offline diagnostic permission `msg_b33fd277b129`, minimum endpoint return `msg_d815ace2abcc`, acknowledged `msg_4efda7ab606d`. Date2026-11-18 Asia/Seoul. Exactly two new paths: B43 harness and this report.

## Frozen source and exact harness copy

New188-line harness is frozen B41 `22b0d4904b0c6c07cb9bf3826c6a2b9136cf0891` copied with only B41→B43, b41→b43 task/root/role/database labels, and catalog SHA `2b0b9df2d6e30039cb90d708789a0a28415e6c7503f623ff1a33989f93d3a000`→approved B42 SHA **aea12e9f90970637d22421904fa0b861f1dfda28c871c5bfffeca5f712640b1a**. Reverse substitution yields the complete original LF source byte-for-byte. No query/recipe/error/cleanup control flow changed. harness-copy-evidence.json records old harness SHA `d37a2d239da5d72f1a62eaa0e456e81b1f0d3b1a9d996d13a1ac46f28214e5bb`, B43 SHA **7f4270298b831e31b86a41c03c827c2ea5b6a11a041677cc2abaa1616d8d1f8e** and inverseComparisonExacttrue. Harness was not changed after execution.

B42 `1fcbf83` / independent review facc25c accepted code/unit/bounded small-native only. Unchanged B37 loader SHA `0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698` verifies all five complete source hashes and fixed wrapper/body identities. Actual P full SHA **f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339**, body **15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9**. sources.json retains5 entries with actualBodySha equal each bodyChecksum. SQL1–4 pins, original D fuse, P and loader remain unchanged; no E derivation/execution.

## One owned native execution

New root `tmp/b43-native-5a56de32-0911-4db7-99c0-af7673ed45b3`, UTF8/C/template0 database dream_test_B43, loopback127.0.0.1:57866. Existing portable EnterpriseDB postgres/initdb/pg_ctl signatures Valid and actual18.7 verified. Explicit synthetic credentials, no DSN/.env/managed target, no installation/PATH/service/shared PID action. Server statement/connection/error-parameter logging remains disabled/suppressed; no password/auth values were printed.

Native B=b43_bootstrap/10 superuser; M=b43_migration/16389 distinct LOGIN CREATEROLE/NOSUPERUSER/NOBYPASSRLS/NOINHERIT/NOCREATEDB/NOREPLICATION. Same minimal auth.users(id uuid PRIMARY KEY) and source-checked journal prerequisite. M executes one explicit RC transaction/shared advisory xact lock(1725031001,5)/pg_catalog, trusted native settings, five loader-verified bodies and history inserts; original pg COMMIT resolves before migrationCommittedtrue. B observer then verifies three persisted B-granted M→API/worker/issuer ADMINtrue/INHERITfalse/SETfalse edges. None profile; no pair/runtime login.

Same fixed recipe collects526 trusted native binding facts before the unchanged reader, within exclusive M RR READ ONLY/pg_catalog. No dependency-derived whitelist or unknown endpoint adoption. Product port forwards actual fixed SQL/params without mocking/coercion. Original finally activity witness and rollback/end are the only SQL after the first failure; no follow-on catalog query/retry occurred.

## Actual SQL/raw dispatch results

| Dispatch/category | Returned rows | Compact JSON bytes |
| --- | --- | --- |
|context|1|103|
|schemas|3|1795|
|relations|33|90838|
|columns|430|171233|
|constraints|699|819294|
|indexes|140|99389|
|policies|57|23551|
|triggers|334|376963|
|functions|18|19380|
|domains|3|6941|
|types|69|152047|
|defaultAcls|0|2|
|dependencies|2995|785027|
|roles|5|1437|
|memberships|3|814|

All15 queries succeeded and the reader reached its final decode call after parsing every batch. Actual generated columns SHA **be1d15f4a2884b938fb855861c1c92b6af78059d1d21d95f63201f7c3adb3e3b** matches B42 fixed source. B40/B42 prior raw/SQL blockers did not recur at these stages. No successful full cross-category observation follows. All batch counts are below10000 and maximum compact JSON819294 bytes; these are this fixture's returned measurements, not proof of every internal text/node bound or future capacity.

Native first-failure record: phase frozen actual catalog reader, projectionCalls15, migrationCommittedtrue, lastReturnedRows3, public **CATALOG_OBSERVATION_INVALID**. No failing PostgreSQL SQLSTATE exists; firstNativeError was unset and the field named nativeError falls back to the same public decoder error. category memberships means last dispatched query, **not proof that memberships caused rejection**. No reader projection remains undispatched in this run. Neither final.json nor unvalidated-observation.json/full canonicalJson/observationSha256 exists.

Raw offline classification only:38 named/296 internal triggers,33 table-composite/36 generated-array type rows,3 domains. Two raw definer rows are read_upload_seed_v1(uuid,text) and reserve_upload_v1(uuid,text,text), owner17753, with actual qualified argument type references pg_catalog.uuid/native2950 and pg_catalog.text/native25. These facts are observed raw data, not a completeness/definition/normalization acceptance or native distinct-OID equivalence result.

## Bounded offline first-reject diagnosis

Master explicitly permitted an ignored scratch copy of the exact frozen module with analysis-only markers. catalog-offline-analysis.diff records exactly:

1. Utility import relocation from ../../storage/uploads/schema to ../../lib/storage/uploads/schema because the copy lives in tmp/taskroot.
2. fail emits an Error stack before throwing the same PostgresCatalogObservationErrorV3.
3. Dependency resolve emits the unresolved endpoint/current dependency only if identity is absent, before the same need(identity) rejection.

No expectation, registry entry, condition/result or accepted input changed. Diagnostics add stderr I/O/stack allocation only; this instrumented copy is not an attested product execution or a correction. Native reader ran the original frozen module without these markers. Both the unmodified original decoder and analysis copy were then called offline on exactly the captured14 batches and bindings; both reject with the same public error and produce no observation. offline-input-hashes.json records the retained batch/binding hashes; after analysis all inputs and original product LF hash remain unchanged. No DB/native process or SQL query was used in this analysis.

Copy-only stack shows the first offline rejection at normalize's dependency resolve, source354–355, need(identity). Minimum captured row:

```json
{"dependent":{"class":"pg_class","nativeOid":"16396","subId":0},"referenced":{"class":"pg_constraint","nativeOid":"16397","subId":0},"dependencyType":"i"}
```

Captured index16396 is **external-prerequisite auth.users.users_pkey**, parent relation16392, primary/unique/valid/ready/live/immediate true, key[1], btree/pg_catalog.uuid_ops, no expressions/predicate. Its observed definition is CREATE UNIQUE INDEX users_pkey ON auth.users USING btree(id). The fixed binding contains exactly that external index identity. **No collected constraint row has native16397, and no external fact maps that constraint endpoint.** The strict registry cannot resolve the captured internal dependency's referenced endpoint.

Source alignment explains the boundary: dependency collector includes the approved external supporting index and both dependency directions, while constraints projection/typed registry collect owned-namespace constraints, and the fixed external binding shape has no Auth prerequisite constraint kind. The actual original native throw remains generic; the precise resolve path comes from the explicitly modified offline diagnostic on unchanged inputs. An internal edge from the observed primary index is consistent with an external primary-key constraint dependency, but the target constraint's native name/definition/owner/keys were **not collected**, and were not guessed, synthesized or added to a whitelist. This task does not allocate a new external identity/provenance path or approve relaxing unknown-endpoint rejection.

Ignored catalog-offline-analysis.ts/.diff, offline-diagnostic-result.json (endpoint+stack), offline-original-module-result.json, offline-input-hashes.json and offline-minimum-evidence.json link original raw dependency/index/binding rows to this analysis. No row was skipped to investigate a later failure or create a healthy hash. Further unknown endpoints remain unassessed.

## Owned cleanup and validation

Owned postmaster74572/port57866; actual clients78936 B/postgres,75816 M,68060 B/observer. Original finally attempts/awaits rollback/end and verifies PID-file directory/port/PID before own pg_ctl fast stop. cleanup-safe.json records completedfalse/migrationCommittedtrue/projectionCalls15 and postmasterPidAbsent/listenerAbsent/processAbsent alltrue. Separate OS verification confirms **all four PIDs74572/78936/75816/68060 absent, listener57866 absent and postmaster.pid absent**. No shared/original process was stopped; no owned leak remains. The unchanged harness does not emit a separate per-client end-ACK ledger.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/b43-schema5-catalog-native-owned.ts --max-warnings 0
node --conditions=react-server --import tsx tests/b43-schema5-catalog-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
git diff --check
```

Whole-project TypeScript0/new harness lint0/zero warnings. One actual invocation exit1 with the original final decoder failure and stoppedtrue; no native rerun. Exact copy comparison and whitespace/selective two-path checks pass. Prior units were not rerun because no product changed. Original B39/B41/B42 harnesses, old failures/reports, SQL/loader/catalog query/decoder/allowlist, env/package/config/build/deploy/install/provider/managed/browser and agent/window/worktree remain unchanged.

Next is independent native evidence reproduction/offline diagnosis review; Master separately decides whether/how the fixed external prerequisite identity contract must grow. Cross-cluster/drift/pair/Golden/reference/state/runner/provenance/runtime and complete5 acceptance remain unallocated. All raw artifacts are ignored diagnostic evidence, never an expected/Golden catalog.

Copyable return: B43 exact B41 copy except labels/approved catalog pin; P5body singleMRC COMMIT/same526none/RRreader. All15 SQL/raw batches pass, final cross-category decode rejects generically/no SQLSTATE/no fullhash; last dispatch memberships is not cause. Authorized diagnostic-only copy with unchanged inputs identifies first unresolved pg_class16396→pg_constraint16397/sub0/internal edge. Index16396 auth.users.users_pkey is collected; target constraint details are absent and no identity was invented. Raw counts/38named296internal/33composite36array/2function refs are diagnostics only. Original module same-input rejection retained; copy diff/input hashes/product hash unchanged; no query/fix/skip/retry. Owned postmaster74572/backends78936,75816,68060/listener57866/pidfile all absent. Exact two-path/type-lint0 frozen return for independent review, no full native/reference/state/runtime acceptance.
