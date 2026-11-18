# B41-R — Independent next native catalog failure reproduction

**Evidence/reproduction verdict: PASS. Product native observation: FAIL, exit1.** Independently reproduced the fourth-dispatch columns SQL error after context/schema/relations succeeded. No columns batch or full observation was obtained; eleven later categories remain unexecuted. This does not accept a Golden/reference/state, provenance or runtime path. Master retains final authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_42068f499b2e`; receipt `msg_2e1bcee30f5a`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen copy and one actual run

Reviewed fixed **22b0d4904b0c6c07cb9bf3826c6a2b9136cf0891**, exactly new B41 harness/report. Independently reversed B41→B39, b41→b39 and approved catalog pin substitution: resulting complete LF harness bytes equal frozen afd7972 B39. No query, recipe/allowlist, driver, failure/cleanup control flow or expectation changed.

| Artifact | Independent LF SHA256 |
| --- | --- |
| B41 harness |d37a2d239da5d72f1a62eaa0e456e81b1f0d3b1a9d996d13a1ac46f28214e5bb|
| B41 handoff |9da696f94577e2156c8f6e95b643a299bc0b52e585e07d5aeef2a1dee3485346|
| Original B39 inverse-copy target |c2dd5b42791ebf6f4f37bc3778b1d499347946d7d363ff26338e39de41dcf9fc|
| Frozen B40 catalog module |2b0b9df2d6e30039cb90d708789a0a28415e6c7503f623ff1a33989f93d3a000|
| Unchanged B37 loader |0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698|

Actual command from repository root:

```powershell
node --conditions=react-server --import tsx tests/b41-schema5-catalog-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

**One unchanged invocation, exit1/stopped=true.** Existing postgres/initdb/pg_ctl verified Valid EnterpriseDB signatures and actual PG18.7. New owned UTF8/C SCRAM loopback cluster only, template0 dream_test_B41; own root `tmp/b41-native-43738b92-fd95-496f-afbc-0107db4663a1`, listener127.0.0.1:60517. Explicit synthetic secrets were not printed; no DSN/.env, managed/provider or existing cluster used. Server error/parameter/statement settings keep SQL/auth material out of retained logs; offline inspection found no generated secret/PASSWORD statement/SCRAM credential material.

Actual P full hash **f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339**, body **15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9**. The unchanged loader verified all five complete sources/wrappers/bodies, with sources.json actualBodySha matching every pinned bodyChecksum. D remains fused and unchanged; no E derivative was generated or relabeled as P.

## Recipe and dispatch evidence

Exact copied recipe uses actual B=b41_bootstrap/10 superuser and distinct M=b41_migration/16389 restricted LOGIN CREATEROLE. M creates only the owned Auth prerequisite. Text-checked journal constant, shared transaction lock(1725031001,5), pg_catalog path, trusted native settings, verified bodies1–5 and history inserts execute in one M RC transaction; its original COMMIT call resolves before migrationCommitted=true. Separate observer verifies three persisted B-granted M→API/worker/issuer ADMIN-only edges, INHERIT/SET false. No runtime pair or migration registry/runner is invoked.

Under M's exclusive RR READ ONLY/pg_catalog transaction, the fixed recipe collects526 native management facts:36 types/118 function overloads/354 operator signatures/2 namespaces/4 languages/3 collations/6 opclasses plus Auth relation/id-column/index. These are finite predetermined binding selectors, not dependency-driven expected rows or provenance. No unknown endpoint extends the allowlist.

| Reader dispatch | Independent actual result |
| --- | --- |
|1 context|1 row180007/pg_catalog/repeatable read/read_only on; accepted|
|2 schemas|3 rows, raw shape accepted|
|3 relations|33 rows/compact JSON90838 bytes, raw shape accepted|
|4 columns|actual pg query rejects22023/check_acl; no returned column batch|
|Remaining11 categories|Not dispatched|

Completed projection-trace has exactly context/schemas/relations; projectionCalls records **4 attempts,3 completions**. First-three query hashes match the author's trace and prior B39. Reader reaching the columns dispatch demonstrates B40's relations raw-shape correction passed that stage, not complete normalization. Retained relations file SHA256 remains **4aa31bbc9be7d35875795dc9212a3a702c647bcdb8defe80f78b872e97971dc1**, with33 relations/32 TOAST auxiliaries/96 false physical flags. Identical row bytes/OIDs do not prove shifted-native-OID equivalence.

Actual firstNativeError: **SQLSTATE22023**, routine **check_acl**, message **ACL arrays must be one-dimensional**. The server log independently corroborates `2026-11-18 09:47:46.367 KST [66132] ERROR: ACL arrays must be one-dimensional`, matching the owned M backend. Unlike B39's decoder-only fallback, this firstNativeError is set by an actual rejected pg query. Public decoderError is **CATALOG_OBSERVATION_INVALID**, with no native details promoted through that boundary; it is not a SQLSTATE.

first-failure.json records columns/4 attempts/committed=true/lastReturnedRows33. That33 and last-returned-catalog-batch refer to the previous relations result, never a successful columns batch. No projection-columns.json, final.json, unvalidated-observation.json or whole observation hash exists. The cleanup witness sees M idle in transaction(aborted), consistent with the actual SQL error.

## Source inference and minimum next investigation

Static columns SELECT474 invokes aclSql(a.attacl). Helper440–442 applies aclexplode(coalesce(a.attacl,'{}'::aclitem[])) when using its default empty-array fallback. This is the direct relevant source path for the dimensionality error and a strong candidate for the next bounded correction. **Which actual attacl value triggered the error, its nullness/dimensions and the fallback as the exact cause remain inference.** No individual ACL row exists in the capture, and no standalone aclexplode/array-dimension query was run. Server message/routine and the fixed expression alone are not a completed minimal native cause isolation.

Recommend separately isolating the nullable/empty column-ACL expansion path; a bounded candidate is explicit empty-tuple JSON handling for proven NULL/empty column ACLs without calling aclexplode on an invalid empty fallback. Preserve nonempty grantor/grantee/privilege/grantable tuples, unknown-principal rejection and other objects' deliberate acldefault semantics. Exact behavior/query correction still needs its own allocation and tests; this review neither applies nor declares that candidate verified. Do not bypass columns, coerce output, change allowlists, or weaken decoder/provenance expectations to continue.

After first failure, no reader category or additional diagnostic catalog query ran. Only the unchanged finally activity witness and rollback/end/owned shutdown executed. Offline analysis used already captured batches, metadata and server log. No native retry or product/harness/SQL/recipe edit occurred.

## Cleanup, author comparison and limits

Own postmaster **59252**, port **60517**, backends **17064 /66132 /72936**. Harness verified owned PID-file directory/port/PID before fast stop; cleanup-safe records completed=false/migrationCommitted=true/projectionCalls4, postmasterPidAbsent/listenerAbsent/processAbsent=true. Independently queried OS after exit: **all four PIDs absent, listener60517 absent, postmaster.pid absent**. Server log ends with database shutdown. Per-client end-ACK success is not separately emitted by this unchanged harness; physical resource absence is independently proven.

Author artifact independently contrasted: `tmp/b41-native-afa366bc-7d4e-4ba0-bef9-78c1034b94ad`, postmaster67828/port61042/backends76608,78012,72016; same actual22023/check_acl, attempted4/completed3, previous relations batch, no observation, committed=true/completed=false and shutdown flags true; PID file absent. No author process or cluster was operated on.

Review root `tmp/b41r-review-22b0d49` retains preflight/inverse-copy proof, native-run.log, offline inspect_evidence.py/independent-evidence-summary.json, independent-os-cleanup.json and postrun-checks.json. All fixed source hashes and protected SQL/loader/old harness/adapter/model/package/config bytes remained unchanged; tracked product diff empty. Existing B39/B40 reports/evidence and unrelated T122/T137 files preserved; report-only whitespace/selective commit checks pass.

Return **PASS-for-evidence/reproduction, product native observation FAIL(exit1)**. Only first-three raw stages passed; columns and remaining11/full catalog semantics, capacity, native reference/Golden/state/runner/provision/provenance/runtime remain unaccepted. No DB parser, extra cluster/native retry, env/package/config/build/deploy/install/provider/browser or new agent/window/worktree action occurred. Master decides the separately bounded cause/correction and next native gate.
