# B42 — bounded ACL cause experiment and empty expansion correction

Status: cause experiment complete, conditional minimal product correction and author source/unit checks complete; independent review/replay pending. Master assignment `msg_1084690831c2`, receipt `msg_3329b8cb04e6`; cause return `msg_497244ad27e1`; replay provenance accepted in `msg_2c995c507e78`. Exactly four paths: catalog module, catalog unit tests, new b42-column-acl-native-owned.ts and this report. B41-R5f39740 accepts earlier failure reproduction, not full native catalog behavior. Original B39/B41 failures/harnesses/reports are unchanged.

## Actual native cause experiment before product editing

One new signed portable EnterpriseDB PG18.7 UTF8/C loopback cluster/database dream_test_B42. Owned root `tmp/b42-native-42e39bff-03ea-4518-8331-133f0d2ee558`. Original product remained B40 hash `2b0b9df2d6e30039cb90d708789a0a28415e6c7503f623ff1a33989f93d3a000` throughout this execution. No P/SQL1–5 migration, B41 cluster, full reader/catalog retry or managed target was used.

Executed pre-integration harness LF SHA **d9b0a54b0d3f35d18f4fa308216215c76316ebf0f7317990c4e5f43430b7f777**, preserved verbatim as ignored `executed-before-product-fix-harness.ts`. Command was node --conditions=react-server --import tsx tests/b42-column-acl-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin. This ran **25 probes,21 successful results and4 expected SQLSTATE22023 controls**, exit0, completed/stoppedtrue. Expected errors were isolated with SAVEPOINT/ROLLBACK TO SAVEPOINT; continuing after these errors was explicitly authorized for this small experiment only.

Only synthetic bootstrap, nonsuperuser b42_owner and NOLOGIN b42_reader roles, a minimal owned database/schema and dream.acl_probe(c text) were created. Actual owner native16389, reader16390, relation16393/column1. Column metadata, parameterized direct expansion/old-expression/candidate-expression SELECTs and minimal own GRANT/REVOKE establish:

| Actual experiment | Result |
| --- | --- |
| New pg_attribute.attacl |SQL NULL; raw_is_nulltrue; array_ndimsNULL/cardinalityNULL|
| Original exact generated columns SELECT on that column |22023/check_acl, ACL arrays must be one-dimensional|
| Direct aclexplode(NULL::aclitem[]) |0 tuples|
| Direct aclexplode(explicit empty aclitem[]) |22023/check_acl|
| Empty-array metadata |IS NULLfalse; array_ndimsNULL; cardinality0|
| Old coalesce(native NULL,empty) expression |22023/check_acl|
| Old expression with explicit empty input |22023/check_acl|
| Candidate NULL and explicit empty |JSON empty tuple array[] for both|
| Actual SELECT(c) grant WITH GRANT OPTION to reader plus UPDATE(c) to PUBLIC |Two nonempty tuples; original generated projection, old expression and candidate preserve exactly equal tuples|
| REVOKE GRANT OPTION FOR SELECT(c) |Both tuples remain, grantablefalse|
| REVOKE all column grants |Native attacl returns SQL NULL; candidate[]|
| acldefault n/r/f/T (schema/table/function/type), raw NULL |Old and candidate complete effective tuples equal and nonempty|
| Explicit empty with each nonempty default |Candidate[]; explicit empty does not select the NULL fallback|
| Relation raw ACL after column grants/revokes |Still SQL NULL|

Granted native ACL text `{b42_reader=r*/b42_owner,=w/b42_owner}` has ndims1/cardinality2. Exact expanded tuples retain grantor16389, reader16390 SELECT/grantabletrue, PUBLIC0 UPDATE/grantablefalse. Grant-option revoke retains the SELECT tuple with grantablefalse; full revoke returns raw NULL. This directly confirms the original NULL→empty fallback invokes an expansion PostgreSQL rejects, rather than an unknown individual B41 column having to be queried after its first failure. It also independently proves explicit-empty rejection. No pg_attribute/system catalog value was rewritten.

## Minimal conditional product correction and projection impact

Only private aclSql helper440–443 changes. It names the existing `coalesce(expr,fallback)` as effective ACL and wraps the original full aggregate/expansion in:

```sql
CASE WHEN coalesce(pg_catalog.cardinality(effective_acl),0)=0
THEN '[]'::jsonb
ELSE original_complete_acl_expansion
END
```

This handles effective SQL NULL/empty before aclexplode. The original grantor/grantee/privilege/grantable tuple builder and aggregation are retained for nonempty values; no result row/ACL entry is filtered, no duplicate deduplication or arbitrary role/name conversion is added. Null defaults remain coalesce-only: raw explicit empty never becomes owner/PUBLIC default. Native principal OIDs still resolve through the existing typed registry, PUBLIC remains a grantee-only semantic tag where allowed, and invalid grantors/tuples remain rejected. Decoder, descriptorVersion2, canonical output shape,14 categories, external allowlist and all ownership/parent/F38 semantic checks are unchanged.

| Projection | Effective NULL fallback preserved | Impact |
| --- | --- | --- |
| schemas |acldefault('n',n.nspowner)|Empty guard before existing expansion|
| relations |acldefault('r',c.relowner)|Same|
| columns |Empty aclitem[]|Same; fixes demonstrated failure|
| functions |acldefault('f',p.proowner)|Same; PUBLIC default EXECUTE preserved|
| domains/types |acldefault('T',t.typowner)|Same; raw aclIsNull expression unchanged|
| defaultAcls |Empty aclitem[]|Same; empty default ACL observations remain[]|
| constraints/indexes/policies/triggers/dependencies/roles/memberships |No ACL helper|No query construction change|

Seven of14 projection strings use the helper. This shared source change is covered by fixed-expression/default tests for all seven; only the bounded column/ACL/default candidate paths were executed natively. It is not a successful actual14-projection run. No unrelated SQL generation or normalized row behavior changed.

## Native candidate versus final product expression: exact differences

Original experiment-source.json preserves the actual parameterized old and candidate expression strings. Candidate is the same guard plus the original complete tuple aggregation. Final generated product columns ACL expression is **not byte-identical** to that parameterized experiment string. Exactly three textual differences are present:

1. Product fixed generated alias aN versus experiment alias a.
2. Product effective operand coalesce(a.attacl,'{}'::aclitem[]) versus parameterized coalesce($1::aclitem[],$2::aclitem[]).
3. Product casts `(alias.grantor)::text`/`(alias.grantee)::text` versus experiment `alias.grantor::text`/`alias.grantee::text`.

The new unit test extracts the complete final columns ACL expression and applies only those three explicit textual substitutions; the entire resulting string must exactly equal the candidate transcribed from the completed pre-edit native experiment. These substitutions are a source-integration assertion, not another SQL execution, parser or native equivalence proof. The final product expression itself has **not** been executed natively by Backend after integration. No full catalog/native PASS is claimed from the candidate experiment.

## Final replay harness versus actual executed harness

Final committed harness LF SHA **f1a759e3f5a8aa839e66379de3da4cd10a95fdbd667d004e33f36f9378b7a9d2** is a subsequent independent-replay source, **not the source Backend actually ran**. Executed-to-final-harness.diff is retained in the ignored root. Final source pins only corrected product hash **aea12e9f90970637d22421904fa0b861f1dfda28c871c5bfffeca5f712640b1a**. It removes exactly one known fixed column guard to recover the old control and requires recovered whole query SHA **4d6ff67037656bdd98f2bc896bb13ec99949a75aa20379c6d84d2c3096bb6383**, recorded during the original native run. There is no arbitrary old-source fallback or target-learned SQL. Offline inverse comparison verifies the exact hash. Fixed columns query hash is **be1d15f4a2884b938fb855861c1c92b6af78059d1d21d95f63201f7c3adb3e3b**.

Final replay retains all25 original case expectations and adds two corrected generated-query probes: native NULL column→one row/ACL[], and nonempty grants→exact candidate tuples. Thus it will attempt27 probes/four expected errors if independently authorized/executed successfully. Its final output correctly identifies correctedGeneratedColumnsExecutedtrue/candidateExpressionOnlyfalse only after those queries actually run. Backend did not rerun it after editing the product; independent Tester must supply that evidence separately. The retained original final.json correctly records25 probes/candidateExpressionOnlytrue/old product, and is not overwritten by claims about the final source. No original failure evidence was rewritten as green.

## Author unit/type/lint validation

Added20 unit cases to the previous170: entire candidate/product source integration, seven effective-default guards, seven empty-observation categories, full synthetic column principal/PUBLIC/grant-option tuples, three malformed tuple controls and retained raw-type ACL NULL/effective/explicit-empty distinction. Other synthetic categories/fixtures are not learned from the experiment. Full normalized signatures/aliases/type/parent/TOAST/dependency/membership regressions remain.

```powershell
# All DREAM_PG_INTEGRATION/B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST flags are0.
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts tests/b42-column-acl-native-owned.ts --max-warnings 0
git diff --check
```

Actual final result: **190 catalog cases,361 related passed /100 native-disabled skipped**. Whole-project type0, three-file lint0/zero warnings, whitespace/selective four-path checks0. Original cause harness passed type/lint before its one native invocation; final replay source passed type/lint after the explicit integration changes. Native experiment/candidate checks and final unit checks are separate evidence scopes.

## Cleanup, preserved limits and return

Owned postmaster45544/port60510; actual clients56796 bootstrap and63696 owner. Original client rollback/end and PID-file directory/port/PID check preceded own pg_ctl fast stop. cleanup-safe.json records completedtrue/postmasterPidAbsent/listenerAbsent/processAbsent alltrue. Separate OS check confirms **all three PIDs absent and no listener60510**. Secret/auth/DSN values were not printed; server statement/connection logging and error parameters were disabled. Original experiment source/checks/final/cleanup/signatures/logs remain ignored owned diagnostic evidence, not a reference/expected artifact. No original B41 cluster or shared PID/listener was operated on.

Independent source review and separately authorized small-cluster fixed replay are next. Full source P/catalog retry, later categories, capacity/native equivalence, cross-cluster/drift/pair, Golden/reference/state/runner/provenance/runtime remain unverified/unallocated. No SQL1–5/D/P/loader/original harness/report, env/package/config/build/deploy/install/provider/managed/browser or agent/window/worktree change occurred.

Copyable return: B42 original small owned run25 probes/four expected22023 confirms native column NULL→empty fallback cause and candidate NULL/empty/default/nonempty tuple correctness; grantoption/PUBLIC/revoke/rawNULL distinctions preserved, owned cleanup allabsent. Conditionally approved helper-only empty-cardinality guard integrated without decoder/default/protocol relaxation.190 catalog/361 related PASS100native skips/type-lint-whitespace0. Original executed harness d9b0a54... and old-product native evidence remain separate from final newpin replay f1a759e... (Backend did not run final replay); exact query/candidate differences and old-control SHA reconstruction documented. Four-path fixed return for independent review/replay, no full catalog/native/Golden/state/runtime acceptance.
