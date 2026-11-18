# B39 — first actual owned PG18 catalog observation failure

**Result: first native-data/strict-decoder mismatch captured; full catalog observation NOT obtained.** Frozen SELECTs were not edited or bypassed. This is a successful diagnostic capture of a failing native observation, not a native/catalog/reference PASS. Master assignment `msg_599f5907a42f`; scope receipt `msg_d29ea91b5460`; first-failure return `msg_fc9030d480aa`; Master acknowledged and required frozen return in `msg_f5ee5db7cc28`. Date2026-11-18 Asia/Seoul. Exactly two new assigned paths: `tests/b39-schema5-catalog-native-owned.ts` and this handoff.

## Frozen sources and executed recipe

B38-FIX `ee0f6914292e100e3f64f580996b8b01773c7f38` / independent R2 `a72d1e5` was accepted CODE/UNIT only. Actual run pinned catalog module LF SHA256 `27be5af15d0d5111c7f7a1c74506a4ce74e91c8c22e57353ca86e05a662c3faa` and B37 loader `0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698`, with no product query/decoder/source changes.

| Migration | Verified complete source LF SHA256 |
| --- | --- |
| SQL1 |3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19|
| SQL2 |1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100|
| SQL3 |7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d|
| SQL4 |61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c|
| SQL5 P |f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339|

Called the unchanged `loadPostgresMigrationsV3(5)`: complete source, fixed wrappers/offsets and all five body hashes verified before execution. P body hash `15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9`. The historical D fuse remains untouched and its hash was checked; no fuse removal or E derivation/execution occurred. `sources.json` retains five verified manifest entries and independently computed body hashes.

Existing portable PG18.7 postgres/initdb/pg_ctl Authenticode signatures were Valid EnterpriseDB. New owned UTF8/C cluster only, listening on127.0.0.1:52402; database exactly `dream_test_B39`, template0. No binary installation, PATH/service change or existing process action. Connection options are explicit, synthetic credentials are generated only for this cluster, no DSN/.env is loaded, and password/raw-auth values are not printed. Statement/connection/parameter logging is disabled for this diagnostic.

Bootstrap B is native role10/b39_bootstrap, superuser. M is native role16389/b39_migration, LOGIN CREATEROLE, NOSUPERUSER/NOBYPASSRLS/NOINHERIT/NOCREATEDB/NOREPLICATION; actual roles are distinct. M created the minimal prerequisite `auth.users(id uuid PRIMARY KEY)` in auth. The fixed journal schema/history-table DDL was copied exactly from the old runner's source, verified against that source text, and executed directly in this new database; the old runner was not invoked.

M executed **one explicit READ COMMITTED migration transaction**, pg_catalog search_path, shared advisory transaction lock(1725031001,5), journal creation, trusted native M/B/major settings, the five loader-verified bodies in order and five history inserts, then awaited actual `pg.query(COMMIT)` completion. Only after that original command resolved was migrationCommitted settrue. `provisioning.json`, `first-failure.json` and `cleanup-safe.json` all record this actual control-flow result. B's separate observer then saw the final three automatic B-granted M→API/worker/issuer memberships, each ADMINtrue/INHERITfalse/SETfalse (role OIDs17132/17134/17753, membership OIDs17133/17135/17754). No pair logins were provisioned.

## Native binding and reader boundary

Before discovery, the new harness fixes finite builtin type/function/operator-name allowlists and exact namespace/language/collation/btree-opclass/Auth prerequisite selectors. Native OIDs and qualified function/operator signatures are collected only for those recipe identities, not from the target dependency graph or a generated expected catalog. No unknown endpoint extends a whitelist. Actual external fact count526:36 types,118 function overloads,354 operator signatures,2 schemas,4 languages,3 collations,6 opclasses and one each Auth relation/id-column/primary-index. These are trusted management binding facts, not provenance or expected inventory; unused facts do not approve any catalog state. This limited native run does not establish complete dependency allowlist coverage.

M exclusively owned a new **REPEATABLE READ READ ONLY transaction**, with SET LOCAL search_path=pg_catalog, for native binding collection and the unchanged `readPostgresCatalogV3` call. The port adapter only forwards the exact SQL/parameter values to the actual pg Client, records returned catalog metadata/query hashes, and rethrows original SQL errors. No fake rows, schema mutation, output coercion or response normalization is performed by the harness.

| Fixed reader dispatch | Actual result |
| --- | --- |
| context |1 row, server_version180007, pg_catalog, repeatable read, read_only on; accepted|
| schemas |3 rows; accepted|
| relations |33 rows returned successfully by PostgreSQL; strict raw-shape decoding rejected|
| remaining12 category projections |Not dispatched after first failure|

The three successful SQL calls have **no failing SQLSTATE**. The public thrown code is `CATALOG_OBSERVATION_INVALID`, a decoder code, not a PostgreSQL SQLSTATE. The harness's first-failure JSON field named nativeError falls back to this public decoder error when no native query threw; it must not be interpreted as a server exception. `projection-trace.json` proves3 completed dispatches; relations compact JSON90838 bytes/33 rows, not a native 10000-row or4MiB-capacity breach claim. Full reference capacity was not tested.

## First mismatch and minimum actual facts

Frozen module line59 requires private TOAST columns `notNull: z.literal(true)`. The returned native pg_attribute projection has **attnotnull=false**. Its relation SELECT reads `ta.attnotnull` directly; no code default or fixture supplied these values. The raw schema check in reader line530 rejects before the decoder can form a complete normalized observation.

First returned row is `dream_migrations.history` relation16399, owner16389, rowtype16401. Its exact linked TOAST relation16409 has namespace pg_toast/kind t/owner16389, single internal parent16399. TOAST index16410 is kind i/unique/owner16389, parent16409, two key/two total attributes and ordered[1,2]. Actual columns:

| Parent native relation | attnum | attname | Native type / qualified identity | attnotnull | dropped / typmod / dimensions |
| --- | --- | --- | --- | --- | --- |
|16409|1|chunk_id|26 / pg_catalog.oid|false|false / -1 /0|
|16409|2|chunk_seq|23 / pg_catalog.int4|false|false / -1 /0|
|16409|3|chunk_data|17 / pg_catalog.bytea|false|false / -1 /0|

Offline inspection of this already-returned batch finds32 TOAST auxiliaries/96 columns; all96 notNull values arefalse, zero true. This corroborates the first failing literal against the actual fixed-query output. The33 rows include history and the32 business relations; this is a returned raw batch count, not complete inventory/definition/state acceptance. No follow-on catalog projection or additional query to investigate TOAST was run after the failure; the cleanup activity witness is recorded below. No true→false edit, boolean relaxation or native rerun was authorized/performed.

Full catalog canonicalJson/observationSha256 was **not produced**. Named38, internal trigger counts, complete types/dependencies, actual function argument semantics, unknown endpoint coverage, full14-category counts/capacity and native equivalence remain untested. No Golden/reference/expected artifact, complete5 classification, state comparison or runtime approval exists.

## Owned evidence and cleanup

Ignored owned root: `tmp/b39-native-a6c48bc1-6cac-4afa-9f70-ed48b196a32a`. `sources.json`, signatures/version logs, ownership/run/provisioning/management-bindings JSON, projection-context/schemas/relations JSON, projection-trace, first-failure and last-returned-catalog-batch JSON retain the actual diagnostic. `offline-first-failure-analysis.json` is explicitly subsequent analysis of the captured batch, not another native execution or expected artifact. Raw metadata remains ignored scratch only. Synthetic password/auth files are not deliverables and their contents were not exposed.

Postmaster40520/port52402. Actual client backend IDs:72904 bootstrap postgres,67508 migration,68388 bootstrap observer. Before cleanup, target activity contained M idle in read-only transaction and the active observer. Harness issued rollback/end for every owned client and awaited them; validated the owned PID-file directory/port/PID before pg_ctl fast stop. `cleanup-safe.json`: completedfalse, migrationCommittedtrue, projectionCalls3, postmasterPidAbsent/listenerAbsent/processAbsent alltrue. Stop command returned successfully. Separate OS verification then confirmed **all four PIDs40520/72904/67508/68388 absent and no listener52402**. No existing/shared PID or listener was stopped; no leak is left running.

## Checks, execution and next gate

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/b39-schema5-catalog-native-owned.ts --max-warnings 0
node --conditions=react-server --import tsx tests/b39-schema5-catalog-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
git diff --check
```

Whole-project TypeScript and new-harness lint exit0. Native harness ran once and exited1 for the captured first decoder mismatch, with owned cleanup true. Nonzero is diagnostic evidence, not a passed full observation. After that run, only its invalid-invocation usage string was corrected from the copied B34 basename to the actual B39 filename; final type/lint checks were repeated, with no native rerun or execution-path change. Product source is unchanged. No old unit suite was rerun because products were not edited. Whitespace/selective two-path commit checks complete before return.

Independent Tester evidence/reproduction review is next; Master decides the exact minimal product correction after independently confirming this physical metadata difference. Neither literalfalse nor a general boolean is allocated here. Later actual projection retries, cross-cluster/drift/pair/provenance/runner/runtime tasks remain separately assigned. No product/env/package/config/build/deploy/provider/managed/browser/new agent/window/worktree change occurred.

Copyable return: B39 first actual P/native catalog diagnostic captured after successful five-body single-transaction COMMIT. Frozen ee0f691 reader context+schemas passed; relations33 native rows returned, then private TOAST column notNull=true literal rejected actualfalse (32 auxiliaries/96false columns in captured batch). No failing SQLSTATE; decoder CATALOG_OBSERVATION_INVALID;3calls, remaining12 not run, no full observation hash/Golden/state/native acceptance. Owned postmaster40520/backends72904,67508,68388/listener52402/PID-file cleanup all verified absent. New harness type/lint0, exact two-path fixed return for independent review; no product correction or native rerun.
