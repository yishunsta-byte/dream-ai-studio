# B41 — next actual catalog failure at column ACL projection

**Result: B40 physical TOAST raw-shape correction passed that native stage; next first failure is a PostgreSQL columns SELECT error. Full native catalog observation remains unobtained.** This is diagnostic evidence, not native/reference/state acceptance. Master assignment `msg_29668ec84839`, receipt `msg_a710c9002619`; first failure returned `msg_ac870e70dff3`, acknowledged `msg_fc68675a1858`. Date2026-11-18 Asia/Seoul. Exactly two new assigned paths: B41 harness and this report. Original B39 failure/harness/reports and B40 source/unit history are unchanged.

## Exact copied harness and frozen execution identities

The new188-line harness is exactly frozen B39 `afd7972` with only these literal replacements:

1. B39→B41 (task/application label, uppercase database suffix and child environment key).
2. b39→b41 (filename, owned tmp-root prefix, bootstrap/migration role labels).
3. Catalog pin `27be5af15d0d5111c7f7a1c74506a4ce74e91c8c22e57353ca86e05a662c3faa`→approved B40 pin `2b0b9df2d6e30039cb90d708789a0a28415e6c7503f623ff1a33989f93d3a000`.

Inverse substitution yields byte-identical LF B39 source. `harness-copy-evidence.json` records this exact comparison, old harness hash `c2dd5b42791ebf6f4f37bc3778b1d499347946d7d363ff26338e39de41dcf9fc` and new B41 hash `d37a2d239da5d72f1a62eaa0e456e81b1f0d3b1a9d996d13a1ac46f28214e5bb`. No query, decoder, allowlist, source pin bypass or execution/error/cleanup control flow changed. New harness source was not modified after execution.

Actual frozen catalog is B40 `883fa8a` / independent source review `b7bf95d`. Loader LF SHA `0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698` remains fixed. Unchanged loadPostgresMigrationsV3(5) verified all five complete-source/wrapper/body identities; sources.json records all five actualBodySha equal pinned bodyChecksum. SQL1–4 hashes remain respectively `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`, `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. Actual P full hash `f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339`; P body `15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9`. D still has its original fused identity; no D edit/E derivation/execution occurred.

## One actual owned run

Existing signed EnterpriseDB portable postgres/initdb/pg_ctl verified; actual version18.7. New cluster only: `tmp/b41-native-afa366bc-7d4e-4ba0-bef9-78c1034b94ad`, UTF8/C/template0 database dream_test_B41, loopback127.0.0.1 ephemeral61042. No installation/PATH/service/shared process change. Synthetic credentials are explicit and never printed; no DSN/.env or managed target. Statement/connection/parameter logging remains disabled/suppressed by the fixed copied harness. Retained server error contains the ACL message without statement/parameter/auth material.

Native B=b41_bootstrap/10 superuser and distinct M=b41_migration/16389 LOGIN CREATEROLE/NOSUPERUSER/NOBYPASSRLS/NOINHERIT/NOCREATEDB/NOREPLICATION use the unchanged B39 recipe. M creates minimal auth.users(id uuid PRIMARY KEY). Text-verified fixed journal recipe is executed directly, not through a registry/runner. One explicit M READ COMMITTED transaction, SET LOCAL pg_catalog/shared xact lock(1725031001,5), trusted native M/B/major settings, all five verified bodies and history inserts: original pg COMMIT resolved before migrationCommitted=true. Separate B observer then verified the exact three persisted B-granted M→API/worker/issuer ADMINtrue/INHERITfalse/SETfalse edges. provisioning.json and first-failure/cleanup-safe record committed=true. None profile, no runtime pair.

M exclusively owns RR READ ONLY/pg_catalog for fixed native binding discovery and unchanged reader. Same finite recipe collects526 facts (36 types/118 function overloads/354 operators/2 schemas/4 languages/3 collations/6 btree opclasses and one each Auth relation/id-column/index). No dependency-derived allowlist, unknown extension or expected catalog learning. Actual pg port forwards fixed SQL/params without mocking/coercion. The unchanged reader's own raw validation controls continuation.

## Dispatch order and first failure

| Reader dispatch | Actual result |
| --- | --- |
|1 context|1 row180007/pg_catalog/repeatable read/read_only on; accepted|
|2 schemas|3 rows; raw shape accepted|
|3 relations|33 rows, compact JSON90838 bytes; raw shape accepted under exactfalse correction|
|4 columns|SQL error22023/check_acl, no column batch returned|
|Remaining11 category projections|Not dispatched|

Completed first-three query hashes exactly match B39: context `1ed45370d5adc27280120960fe2a615551ffff846ee697869e13bac673e3985d`, schemas `9c002bd36197843beba894cd4794b252f239e602d41fb34c85c5d5af6c6422de`, relations `0d14a047d5e00655a15755028253b0e120b110be2a5fbb634f00d7a3fcaff832`. Reader reaching columns proves its previous raw relation shape was accepted, not full cross-category normalization. The captured relations batch remains SHA256 `4aa31bbc9be7d35875795dc9212a3a702c647bcdb8defe80f78b872e97971dc1`:33 rows including history,32 TOAST auxiliaries/96 columns with notNull=false. Identical native OID/row bytes are not a distinct-OID equivalence proof.

Actual first failure: phase frozen actual catalog reader, category columns, attempted projectionCalls4, migrationCommitted=true. Original driver error **SQLSTATE22023**, routine **check_acl**, message **ACL arrays must be one-dimensional**. Server log independently shows the same ERROR at09:42:30.046 under migration backend78012. Unlike B39's decoder-only mismatch, firstNativeError was actually set by a rejected pg query. The public product boundary still redacts to CATALOG_OBSERVATION_INVALID; this public code is not a SQLSTATE. The recorded lastReturnedRows33/last-returned-catalog-batch is the previous relations batch, never a successful columns result. projection-trace contains only the three completed calls, while the attempted-call counter records4.

Source connection: catalog module columns projection474 invokes aclSql(a.attacl); helper440–442 calls pg_catalog.aclexplode(coalesce(a.attacl,'{}'::aclitem[])) with the default empty-array fallback. This fixed expression and actual ACL dimensionality error identify the source path to investigate. **The empty fallback as the specific cause remains an inference**, not a separately executed minimal reproduction: no individual attacl value/array dimensions were queried and no stand-alone aclexplode call followed. No column row exists to assert a particular native attacl nullness. Master explicitly requires this inference/evidence distinction pending independent reproduction and a separate correction allocation.

No failed row/query was skipped, no fallback/query/decoder/allowlist was edited, no retries or extra catalog queries followed. Only the original finally cleanup activity witness/rollback/end ran. No full canonical observation/hash or final.json/unvalidated-observation.json exists. Complete14-category counts, named38/internal trigger inventory, actual types/dependencies/function semantics/capacity/full reference equivalence remain untested. B40 passing relations shape cannot promote those unexecuted stages to PASS.

## Owned evidence and cleanup

Owned ignored root above retains source hashes/signatures/ownership/run/provisioning/native management bindings, context/schema/relation batches, completed projection trace, first-failure and last-returned relations batch, server log and shutdown logs. Offline-summary.json records5 body matches/526 facts/33 relations/96false TOAST attributes/no column batch/no observation; it is offline analysis only. Harness-copy-evidence.json records exact limited copy changes. None is Golden/reference/expected catalog or a state-approval artifact; synthetic password/auth material is not a deliverable.

Owned postmaster67828/listener61042; actual client backends76608 (B/postgres),78012 (M),72016 (B/target observer). Cleanup activity shows M idle in transaction(aborted) after the actual SQL error and B active for the witness. Harness attempts/awaits rollback/end on every owned client; bootstrap rollback-with-no-transaction warnings are in the server log and do not hide the first error. It verifies PID-file directory/port/PID before owned pg_ctl fast stop. Server log ends database system shut down at09:42:38.207. cleanup-safe.json: completedfalse, migrationCommittedtrue, projectionCalls4, postmasterPidAbsent/listenerAbsent/processAbsent alltrue. Separate OS verification after exit: **all four PIDs67828/76608/78012/72016 absent and no listener61042**. No other process/cluster was stopped; no owned leak remains. Per-client end-ACK ledger is not emitted by this unchanged harness.

## Actual checks and next gate

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/b41-schema5-catalog-native-owned.ts --max-warnings 0
node --conditions=react-server --import tsx tests/b41-schema5-catalog-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
git diff --check
```

Whole-project TypeScript exit0; new harness eslint exit0/zero warnings. **One native invocation, exit1**, first columns SQL error retained and stopped=true. No native rerun. Whitespace/selective two-path checks completed before return. No product/SQL/loader/B39 harness/recipe/environment/package/config/build/deploy/install/provider/managed/browser or agent/window/worktree change. Prior B39/B40 reports and failures remain unchanged.

Next: Tester independently reproduces/reviews this fixed diagnostic and cleanup evidence; Master determines exact cause and any minimum query correction separately. Cross-cluster/drift/pair/Golden/reference/state/runner/provenance/runtime and complete native acceptance remain outside this allocation.

Copyable return: B41 exact B39 copy with only task labels and approved B40 catalog hash changed; reverse comparison exact. Verified P/loader5 bodies committed in one M RC transaction, same native526 recipe/none/RR-read-only reader. Context/schema3/relation33 raw shapes accepted; next columns SQL fails22023/check_acl ACL arrays must be one-dimensional, public decoderredaction preserved. Empty-ACL fallback cause remains source inference, no additional attacl query/minimal reproduction/fix/retry.4attempts/3completed/columns batch absent/remaining11 not run/fullhash absent. Owned postmaster67828/backends76608,78012,72016/listener61042/PID-file all absent. Type/lint0, exact two-path return for independent evidence review; no Golden/state/runtime acceptance.
