# B39-R — Independent first native catalog failure reproduction

**Evidence/reproduction verdict: PASS. Product native observation: FAIL, exit1.** Independently ran the frozen harness once in a new owned PG18.7 cluster and reproduced the reported first TOAST metadata/strict-decoder mismatch. Full catalog observation was not obtained; twelve category projections remain unexecuted. No Golden/reference/state or runtime acceptance follows. Master retains final correction/allocation authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_e26e3ba63ce6`; receipt `msg_6905fb6a7bb2`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen identities and one actual execution

Reviewed all188 harness lines and75 handoff lines at **afd79720157763dc09cc2b052735d425fa81f274**, exactly two new paths. Independently matched fixed LF hashes before/after:

| Artifact | SHA256 |
| --- | --- |
| tests/b39-schema5-catalog-native-owned.ts |c2dd5b42791ebf6f4f37bc3778b1d499347946d7d363ff26338e39de41dcf9fc|
| B39-SCHEMA5-CATALOG-NATIVE-OBSERVATION.md |5333d0523b3b56631ecfac1376a5c6e0f116fb78a00b02baf68a55c480103c4f|
| Frozen ee0f691 catalog reader |27be5af15d0d5111c7f7a1c74506a4ce74e91c8c22e57353ca86e05a662c3faa|
| B37 loader |0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698|
| Actual executed P full source |f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339|

Actual command from repository root:

```powershell
node --conditions=react-server --import tsx tests/b39-schema5-catalog-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

**One invocation, exit1**, with the original product failure preserved and stopped=true. Existing postgres/initdb/pg_ctl each verified Valid EnterpriseDB signatures and actual postgres18.7. The official react-server condition is used; no driver/response mock. Own root `tmp/b39-native-f25ab90b-f03f-4395-b9a5-e632a79aa25e`; separate review evidence `tmp/b39r-review-afd7972`.

Only a new UTF8/C SCRAM loopback cluster, ephemeral127.0.0.1:57514, database dream_test_B39 was created. Explicit connection credentials belong to this cluster; no DSN/.env, managed/provider service or existing cluster was used. Server statement/connection logging is disabled and error parameter logging suppressed; retained server log contains no generated secret, PASSWORD statement or SCRAM credential material. Synthetic password content was not exposed. No shared3013/.next/PID action occurred.

## Executed P, trusted binding recipe and reader boundary

The unchanged loader verified all five full source hashes and fixed outer wrappers/body hashes before execution. sources.json independently records actualBodySha equal to every pinned bodyChecksum. P body is `15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9`. Original fused D still hashes `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb`. This run executed actual P, not a newly derived E; earlier B34/B35 E evidence remains separately identified.

B=b39_bootstrap/native10 is actual superuser; M=b39_migration/native16389 is distinct LOGIN CREATEROLE/NOSUPERUSER/NOBYPASSRLS/NOINHERIT/NOCREATEDB/NOREPLICATION. M created only this fixture's minimal auth.users prerequisite. Journal SQL was text-checked against the unchanged v2 runner constant, not applied through a runner/registry. In one explicit RC transaction with pg_catalog path/shared lock(1725031001,5), M executed the journal, trusted native settings, all five verified bodies and history inserts, then awaited its original pg COMMIT call. migrationCommitted became true afterward; the separate observer saw the three persisted B-granted M→API/worker/issuer ADMIN-only edges, with INHERIT/SET false. No runtime pair was provisioned.

The finite external allowlist is fixed before discovery, independent of dependency rows. Actual526 management facts:36 types,118 function overloads,354 operator signatures,2 namespaces,4 languages,3 collations,6 btree opclasses and one each Auth relation/id-column/primary-index. No unknown endpoint expands the recipe. These are native trusted fixture binding facts, not approved expected inventory or provenance; future coverage remains unverified.

M then owned RR READ ONLY with SET LOCAL pg_catalog for discovery and the fixed reader. Its port forwards actual pg queries/parameters and records returned rows/query hashes without coercion or fake metadata. Reader projection hashes exactly match the author's captured trace. First-failure control flow dispatches no subsequent reader category after the decoder rejection. The frozen finally block does perform its already disclosed pg_stat_activity cleanup witness and rollback/end; the reviewer added no post-failure diagnostic/catalog query.

## Actual first failure

| Fixed reader dispatch | Independent actual result |
| --- | --- |
| context |1 row:180007/pg_catalog/repeatable read/read_only on; accepted|
| schemas |3 owned namespace rows; accepted|
| relations |33 rows successfully returned by PostgreSQL, compact JSON90838 bytes; raw-shape decoder rejects|
| remaining12 category projections |Not dispatched|

The captured first-failure phase is frozen actual catalog reader/category relations, projectionCalls3, migrationCommitted=true, lastReturnedRows33. All three SQL dispatches completed successfully. `firstNativeError` was unset, so first-failure.json's nativeError field falls back to the public decoder error **CATALOG_OBSERVATION_INVALID**. It is not a failing PostgreSQL SQLSTATE. No full canonical observation/hash, final.json or unvalidated-observation.json exists.

The contradiction is direct: frozen catalog module59 requires `notNull: z.literal(true)` for private TOAST attributes; relation projection467/472 reads `ta.attnotnull` directly and returns **false**. First actual returned relation is dream_migrations.history/native16399, owner16389, rowtype16401; its linked TOAST16409 is pg_toast/kind t/owner16389 with single internal parent16399. Index16410 is kind i/unique/owner16389, parent16409, two key/two total attributes and ordered[1,2].

| Actual TOAST16409 column | Native type | attnotnull | dropped / typmod / dimensions |
| --- | --- | --- | --- |
|1 chunk_id|26 / pg_catalog.oid|false|false /-1 /0|
|2 chunk_seq|23 / pg_catalog.int4|false|false /-1 /0|
|3 chunk_data|17 / pg_catalog.bytea|false|false /-1 /0|

Offline inspection of the already returned batch finds32 TOAST auxiliaries/96 columns, all96 notNull=false. Context/schema counts, first parent/index/type metadata, and the96 false values reproduce the author's retained batch. This is an observed raw-batch fact, not complete32-table DDL/state acceptance. No row was altered, coerced, skipped or passed through a relaxed decoder; no additional native query or retry followed.

## Expectation origin and bounded correction recommendation

The existing local portable distribution contains postgres.bki but no toasting.c/heaptoast.c/pg_attribute.h source. BKI3663–3676 declares pg_attribute.attnotnull as bool; it does not establish a true default or physical TOAST construction semantics. The explicit true assumption appears in B38-FIX's private raw shape, synthetic fixture54 and handoff's proposed layout; those prior source/unit acceptances explicitly left physical/native compatibility unverified. BKI alone cannot validate that assumption, and no new fetch was performed.

Recommend a separately allocated narrow correction: pin the private physical TOAST attribute expectation to the independently observed false value for the approved PG18.7 reference scope, with a regression derived from this retained native batch, while retaining exact-parent/type/index/ordinal evidence and negative tests. Do not replace it with general boolean acceptance, coerce returned false to true, modify physical catalog data, or weaken logical business-column nullability. This recommendation concerns metadata representation; it does not infer that TOAST values may be NULL. No such code/test/expectation edit is authorized or made by this review. A later native attempt must still stop at its next first mismatch; this one correction cannot establish the unexecuted categories.

The author disclosed a post-run change only to the invalid-invocation usage basename. The frozen final harness's correct B39 usage text was reviewed and executed unchanged here; valid invocation does not take that error branch. The author's earlier uncommitted harness bytes are not separately attested by this report. The independent frozen replay and matching query/source evidence establish the final diagnostic behavior without retroactively inventing an old harness hash.

## Owned cleanup and preserved limits

Own postmaster **67416**, port **57514**; client backends **71156 /45816 /6136**. Harness attempted/awaited rollback/end for owned clients, verified PID-file directory/port/PID before stopping only this cluster, then recorded completed=false/migrationCommitted=true/projectionCalls3 and postmasterPidAbsent/listenerAbsent/processAbsent=true. Independently queried OS after exit: **all four processes absent, listener57514 absent, postmaster.pid absent**. This verifies physical cleanup; the harness does not emit a separate per-client end-ACK result ledger. No leak remained.

Author cleanup artifact was independently inspected: root tmp/b39-native-a6c48bc1-6cac-4afa-9f70-ed48b196a32a, postmaster40520/port52402/backends72904/67508/68388, the same completed=false/committed=true/3-call outcome and all three shutdown flags true; its PID file is absent. No author process or cluster was operated on.

Own raw context/schemas/relations/last-returned batch, trace, sources, bindings, provisioning and cleanup are retained in the native root. Review preflight, inspect_evidence.py, independent-evidence-summary.json, independent-os-cleanup.json, postrun-checks.json and native-run.log remain in the separate ignored review root. Inspection after failure was offline metadata analysis only. Independently matched54 protected source/harness/package/config files after the run; no product, original harness or expectation changed. Unrelated T122/T137 files were preserved; report whitespace/selective commit checks pass.

Return **PASS-for-evidence/reproduction; actual product native observation FAIL(exit1)**. No full14-category/native/reference equivalence, capacity, function/dependency/internal-trigger inventory, Golden/state/runner/provision/provenance/runtime or deployment acceptance exists. No DB parser, additional cluster/native rerun, environment/package/config change, install/build/deploy, provider/browser or new agent/window/worktree occurred. Master decides the bounded correction and later first-failure diagnostic allocation.
