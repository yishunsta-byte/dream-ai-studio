# B48 shifted-OID full observation diagnosis

2026-11-18 ? CX-RECOVERY-01 ? Master assignment msg_9b3b5a572938, fixed seed approval msg_db08975e6302 ? existing Codex session, no new agent/window/worktree. Baseline HEAD c4a9bece011a3580af92bb90c452c18ca667f3f9; B47-R90542f8 accepted by Master.

**PASS for the assigned two-scenario diagnostic: actual OID assignments changed, while complete typed catalog/canonical JSON/observation bytes/hash matched.** Scenario A and B each executed exactly once, sequentially, actual exit0/stoppedtrue. Both remain descriptor4/unvalidated/approvalfalse/expectedCatalogfalse. This is the author experiment, not independent Tester acceptance or a general cross-cluster equivalence proof. No Golden/reference/state/runner/provenance/runtime or managed/production acceptance.

## Fixed source copy and predeclared limits

New harness `tests/b48-schema5-oid-equivalence-native-owned.ts` LF SHA **d9333f3cdcbf2049f5e08d2f2fa8412459d7c0aaed4bb08150bd63568987067b**, unchanged before/between/after native execution. Removing the marked seed block and reversing only scenario CLI, task/root/DB identifiers, cleanup datname parameterization and B48 labels restores the full B47 LF source byte-for-byte **ce6a2c73c25b406ec3bee3c65b0025f0875af2d5a204bfed04cce14e6e7cd821**, frozen48c653c. No original fifteen projection SQL, collector/binding recipe, migration body, decoder, policy, final normalization or finally control-flow change. Each CLI invocation validates Windows, exact existing binary directory and scenario A or B. A?success+OS cleanup?B was enforced by the controlling session; the standalone CLI itself does not enforce invocation count or ordering. No retry occurred.

Source guards before execution and final verification:

|Source|LF SHA256|
|---|---|
|catalog|97ccf4f241dcbf5c572a314d61d10f488891977929cadc71e55c216374354e14|
|loader|0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698|
|D draft|9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb|
|published P|f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339|

Marked seed block LF SHA **8baf641bb06c7a42fe0809b67966168793f2dd79c5ff27349d0b50ddc4eb8918**. Its exact mutation SQL sequence (36 query dispatches, some containing multiple statements; joined with LF/no trailing LF) SHA **cd4bebbc8652490ddd5d91654422d472d86a5f54ac0a0cd38b400168566d6ae7**; source-derived sequence preserved in B root seed-sql-sequence.json, file SHA **bca867173b2076d4b79efd866bac467c6aeb4a8cefa84efb9ce6a709cdc0821d**. This records the actual frozen recipe, not target-derived SQL.

Seed design was sent before execution and explicitly approved. Only B, in bootstrap's **postgres** database before M/Auth/P creation: fixed NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS roles b48_oid_seed_r0/r1; schema b48_oid_seed; enum flag('x','y'), domain flag_domain over that enum; immutable SQL constant_one() returning integer1; tables t00..t15 with `(id uuid PRIMARY KEY, note text)`. One explicit seed transaction; capture allocated catalog identities, reverse DROP TABLE16 then DROP FUNCTION/DOMAIN/TYPE/SCHEMA and roles, commit. No CASCADE, target object deletion, graph mutation or remaining dummy allowlist entries.

A allocates no seed and captures an empty inventory. B captures **72 actual namespace-local/catalog seed rows**: roles2, namespace1, pg_class32 (tables16+indexes16), pg_type36, pg_proc1. Associated internal allocation outside that namespace (for example TOAST) is not exhaustively inventoried or used as proof. Both before/after seed queries return namespaces0/roles0; successful DROP SCHEMA without CASCADE proves its contained objects were removed. Same-role absence verifies global seed roles removed. Target database uses template0 after seed removal, fixed original fixture, and all final raw projections contain no b48_oid_seed identifier. No cleanup relaxation/retry was needed.

## Two actual owned scenarios and ordering

|Scenario|Root under tmp|Database|Postmaster|Port|Client PIDs|Actual exit|
|---|---|---|---:|---:|---|---:|
|A|b48-native-a-0ef58c38-bcb9-40be-bb8a-b7bfcdf6a554|dream_test_B48_A|59588|54059|75908,47240,76788|0|
|B|b48-native-b-f7c3827e-3596-4c6d-ba48-1db70e9db2bf|dream_test_B48_B|74204|50433|17048,53336,63224|0|

Commands: `node --conditions=react-server --import tsx tests/b48-schema5-oid-equivalence-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin --scenario A`, then same command with `--scenario B`. No other native invocation/experiment.

Fresh preflight13:11:47 found no active B47/B48 node/postgres/initdb/pg_ctl matches, oldPID25920 absent and old63451 listener absent. Existing signed EnterpriseDB postgres/initdb/pg_ctl verified Valid in each scenario, actual18.7. Fresh random roots/passwords/ports; loopback only, UTF8/C/template0. No installation/PATH/service/env/DSN change, password file read/reuse/output, or shared-cluster connection.

A ownership13:12:17.513406; postgres ready13:12:32.291; start.log13:13:31.845171; final13:13:34.082860; cleanup-safe13:13:44.920682. Independent **13:13:47.080386 +09:00** OS read found A postmaster and all three clients absent,54059 listener absent, own PID file absent. Only after actual exit0 and that independent witness was B launched (ownership13:14:04.949887).

B ready13:14:15.811; start.log13:15:15.440625; seed.json13:15:16.505623; final13:15:18.069597; cleanup-safe13:15:29.865821. Independent **13:15:33.616203 +09:00** found B postmaster and all three clients absent,50433 listener absent, own PID file absent. Both original finally sequences used awaited rollback/end attempts, observer witness, exact owned PID-directory/port/PID validation and pg_ctl fast stop; cleanup flags alltrue/completedtrue. No per-client end-ACK ledger exists; OS absence is additional evidence.

Both startups had about59.6s between readiness and saved start completion. Bounded tool reads observed the correct owned PID/listener during that interval. Original awaits returned naturally, no forced intervention/startup timeout edit/extra launch. Cause is unproven. Tool yields stayed below60s; progress was reported. No relationship to the original interrupted B47 cause is asserted.

Distinct B bootstrap10 and M; M LOGIN/CREATEROLE/NOSUPERUSER/NOBYPASSRLS/NOINHERIT with remaining original role flags. Same minimal Auth/journal prerequisite. Each applies all five loader-verified bodies/history inserts in **one M READ COMMITTED transaction**, shared lock(1725031001,5), trusted pg_catalog settings and awaited original COMMIT, then separate B membership verification. Three admin-only B-granted M edges (ADMINtrue/INHERITfalse/SETfalse). Both migrationCommittedtrue/profile none/null pair logins and exclusive M REPEATABLE READ READ ONLY reader. Both have **527 actual fixed external facts**, preserved526 plus unchanged B44 exact Auth PK fact. Source body identities match, P body15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9.

## Actual native mapping and unchanged semantic result

Offline mapping uses captured actual catalog identity fields (schema/name, relation+constraint/index name, function identity arguments and role names) to associate raw rows; no OID text replacement, numeric substring deletion, expected learning or source/definition adjustment. Complete per-object A/B OIDs are retained in B-root pair-comparison.json. Identity keys are checked unique in each scenario and identity-key sets equal before counts below. These are diagnostics of actual raw rows, not a second decoder or an edited fixture.

|Category|Mapped identities|Changed OID|Same OID|
|---|---:|---:|---:|
|schemas|3|3|0|
|relations|33|33|0|
|constraints|700|700|0|
|indexes|140|140|0|
|functions|18|18|0|
|types|69|69|0|
|roles|5|4|1|
|memberships|3|3|0|

Concrete actual examples:

|Identity|A OID|B OID|
|---|---:|---:|
|M b48_migration|16389|16528|
|auth namespace|16391|16530|
|auth.users|16392|16531|
|auth.users_pkey index|16396|16535|
|auth.users_pkey constraint|16397|16536|
|dream namespace|16415|16554|
|dream.activity_log|16426|16565|
|dream._activity_log type|16427|16566|
|dream.actor_id()|17136|17275|
|dream_api|17132|17271|
|dream_worker|17134|17273|
|dream_upload_reserver|17753|17892|
|dream_api?M membership|17133|17272|
|bootstrap B|10|10|
|pg_catalog.uuid builtin|2950|2950|

Measured changed mappings here all have delta139; this describes these captured identities, not a claim about every catalog object or the global allocation mechanism. **522/527 external-fact endpoints are unchanged**, including builtins; exactly5 shift (Auth schema/relation/column/index/constraint). Builtin equality and bootstrap10 are explicit bounds of this experiment, not hidden exceptions. All original raw/native evidence is retained: **13/15 raw projection files differ bytewise**, while context and empty defaultAcls match. Projection trace files are identical (all15 SQL hashes/counts/compact JSON byte measurements), showing that the collector queries did not change. Raw equality was neither expected nor forced.

Both typed catalog objects, canonicalJson strings, complete unvalidated-observation.json file bytes and observation hashes match exactly. Shared SHA **88148dc170a912568432239e55bfff6f12fa9fd3cbbe021e8b769c6beb67a2b1**. Recomputing SHA256 of the unchanged `catalog-observation:v3\n` domain plus each actual canonicalJson matches; explicit descriptor4 remains. No semantic difference occurred, so there is no first-difference diagnosis or subsequent-difference hunt. No function source/prosrc/definition/numeric literal was rewritten, regex-scrubbed or relaxed to manufacture equality.

Both raw category inventories/compact JSON byte sizes:

|Category|Rows A=B|Compact JSON bytes A=B|
|---|---:|---:|
|context|1|103|
|schemas|3|1795|
|relations|33|90838|
|columns|430|171233|
|constraints|700|846225|
|indexes|140|99389|
|policies|57|23551|
|triggers|334|376963|
|functions|18|19380|
|domains|3|6941|
|types|69|152047|
|defaultAcls|0|2|
|dependencies|2996|785290|
|roles|5|1437|
|memberships|3|814|

Each raw dependency batch contains **2996 complete native rows/2960 exact seven-field groups**:2924 singleton+36 double. Each canonical catalog has2960 dependency rows with explicit multiplicity **2924?1+36?2=2996**. No rows dropped/merged without quantity, and no preaggregated fake fixture was used. Named triggers38/internal296. Both envelope/final/canonical output remain descriptor4/unvalidatedOnlytrue where applicable/approvalfalse/expectedCatalogfalse.

## Evidence identity and validation limits

B-root pair-comparison.json SHA **3b9e425dc3de8552f7b36599dc3160871013cca282189d1de87915d791d1019f** retains full native mapping, unchanged/changed external endpoints, per-scenario raw counts/traces/Auth proof and hashes of every original top-level JSON capture. It is an offline diagnostic artifact, not expected/Golden data. The following are original file-byte hashes, with passwords intentionally excluded:

|Evidence file|A SHA256|B SHA256|
|---|---|---|
|sources.json|7b247b599dd5538d83acb7c332a8a56f6ab8a5bb02673eabfa4802339009546c|7b247b599dd5538d83acb7c332a8a56f6ab8a5bb02673eabfa4802339009546c|
|seed.json|7c9e5a2f6f2b673745b2345e8810d01060004f8a9dbbf98e289400a708de1f7b|8ed994d528c20c49269f11709fcd6fe98db5fe5e620216d115b3437972357385|
|management-bindings.json|e6c5a953ab05c34d7bb3f13be195a4ab472d863f2b8943f60ac25d5070c8f1da|1b8adb158a39456451962769a76d2520c3d48d71e0187db213526748979601de|
|exact-auth-primary-fact.json|b8ecf27ad2da5c2be0af7c6c0ecce52b5cf9c08cf2c1833b0d06b8fcc6d8a874|7ad04d2ba20ec974966d128db02975839b34548702223e2f2a85e5af2624ed6d|
|projection-dependencies.json|d9fb557963bdccfaf234e81739911f402a19477232d7f543617d9566c643b531|a3d075c753f2e85b800c251423e1ab1f2b2e9764f6698346672167b8b34d6f22|
|projection-trace.json|13f6b9ff0009f6d9da6a02d8c2d057759367475827115720f4058dfea5fc2ec2|13f6b9ff0009f6d9da6a02d8c2d057759367475827115720f4058dfea5fc2ec2|
|unvalidated-observation.json|5445150afb472543029a1383d84644574060576293768807645fa2096ffc258a|5445150afb472543029a1383d84644574060576293768807645fa2096ffc258a|
|final.json|3f2056e0ce3f3e2f091103ca0c079b1fbfdb57adaec6cc20d224a176bac5a93d|aebca8ad6cd15eb4e6c4d2c92400d71842183b62bcf83d550ed258d067441894|
|cleanup-safe.json|76171fe7606cb91d79a497b68040fd5a68a9bc65f22dfdbf44d08da8e0de7492|d833d7208365d16b29659df796d8d9b7a6a50769bf96bc5527745085da70cab3|

Validation: harness scoped ESLint --max-warnings0 exit0; scoped strict TypeScript/import graph exit0 using `tsc --ignoreConfig --noEmit --incremental false --target ES2020 --lib ESNext,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict tests/b48-schema5-oid-equivalence-native-owned.ts`; catalog unit suite240/240 pass. This is not whole-project type/build/full-suite acceptance. Initial command-only type probes failed first TS5112 (explicit files require --ignoreConfig), then with too-low ES2020 lib (existing hasOwn/replaceAll APIs); correcting CLI/lib yielded exit0 without editing sources. Native scenario commands each succeeded first invocation; no retry is concealed by those type-command corrections.

Historical preservation was reverified offline: original B47 recovery **25/25** evidence-file hashes match fixed d510a1a report; both B45 original input sets **36/36** match their original manifest. Original interrupted root2359 nonsecret source/ownership/postgres.log/stale-PID hashes **4/4** unchanged before/after; no password file included. Original B47 harness/intake/catalog/loader/D/P remain fixed. No historical B45 decode/backfill, old cluster repair or managed/production SQL.

Only the new B48 harness and this report are allowed tracked changes. Own evidence is ignored under the two new roots. Existing untracked T122/T137 reports, concurrent Front/Auth work/shared index, preview50963/Ego54, deployed5148, shared3013/.next, accounts/mail/build/deploy/install and all product/runtime/Golden paths were preserved. No shared-index wholesale staging or unrelated commit.

Master copyable return: B48 author diagnostic ready_review. Frozen d9333f3c harness, A0ef58c38/Bf7c3827e each exactly1 native exit0/stoppedtrue; A OS cleanup verified before B. Fixed seedB72 observed rows?namespace/roles0, actual M/Auth/catalog/membership OIDs shifted (mapped delta139), bootstrap10/builtin522same explicit. Raw13/15 files differ; typed catalog/canonicalJSON/full observation bytes/hash88148dc?a2b1 match, each2996raw/2960groups/36double/multiplicitysum2996. Own bothpostmasters/6clients/listeners/pidfiles OSabsent. catalog240/scopedtype/lintPASS; oldB47 25/B45 36/interrupted4hashes unchanged. No patch/retry/Golden/state/runtime approval; fixed two-path deliverable for separate Tester review.
