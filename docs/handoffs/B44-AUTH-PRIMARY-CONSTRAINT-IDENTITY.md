# B44 — exact Auth primary constraint identity

Status: author code/unit and bounded native fact/projection verification complete; independent review pending. Assignment msg_9efc816a53bb; scope receipt msg_d27e049f8059; Master technical decision msg_beb9a2a6b4e8 approves the contract delta below. B43 original generic native failure and independent ced85bf failure reproduction remain historical and unchanged. Exactly four allocated paths changed.

## Allocated contract before implementation

Current descriptor2 observes external auth.users/id/index facts and the supporting index, but collects only owned constraints. Its dependency inventory contains index→unobserved constraint, which cannot be resolved. B44 retains14 categories and adds one strict external-prerequisite PK row to constraints; ordinary owned constraint rows are explicitly tagged owned. A typed external constraint binding is allowed only for objectKind relation/object auth.users; this is not arbitrary external constraints or an unknown-endpoint fallback.

The actual fixed projections must collect the native constraint identity/kind/definition/key/index, its auth.users relation and UUID id column, the supporting index and the index's unique/primary/valid/ready/live/immediate metadata, actual relation/index owner OIDs and the exact one constraint owning that index. All native references must agree with detached management facts and each other. PKkind p, exact conkey/index key[1], UUID/id/non-dropped/not-null column, exact parent/index OIDs, one PK only, no duplicate/native/semantic aliases, matching observed index and the retained internal index→constraint dependency are required. A binding alone does not create an observed constraint.

For this owned PG18.7 recipe only, observed auth.users and index owners must equal existing migrationOwner M; no new Principal tag or general external role is permitted. pg_constraint has no independent owner field: relation/index owner evidence must not be represented as a fictional constraint owner. Other Auth owners are explicitly unsupported here, including any assumption of managed Supabase compatibility.

Native registry identity is qualified typed constraint(objectKind relation, object auth.users, actual observed name), checked against its explicit management binding; native OIDs normalize away. Supporting index and column identities retain exact qualified parent/name/ordinal/type. External scope/proof is observable in the constraint row; descriptorVersion3 is therefore an incompatible new envelope. Version2 histories/reports/artifacts are not rewritten. No expected catalog, state/runner/provenance/runtime approval is introduced.

Only a new minimal owned UTF8/C PG18.7 database dream_test_B44 with auth.users(id uuid PRIMARY KEY), fixed parameterized fact/projection/dependency SELECTs and owned cleanup is authorized. No P migration, full native reader retry, B43 cluster reuse or patching later unknown endpoints. Final report must separate native facts/projections from synthetic cross-category unit normalization, include actual owner/type/key/link evidence, negative/shifted-OID cases, ACL/F38 regressions, type/lint and all owned process/listener/PID-file cleanup.

## Implemented input, observed row and semantic contract

External facts now require exactly one each Auth relation, ordinal1/id column, supporting index and constraint mapping. The added strict semantic fact is `{kind:constraint,objectKind:relation,object:{schema:auth,name:users},name:<observed name>}`, endpoint pg_constraint/nativeOid/subId0. Catalog class/sub-ID, native and semantic uniqueness remain checked. No standalone arbitrary serialized identity or generic foreign constraint is admitted. Bindings are trusted administrative input, not authenticated provenance.

Constraints is a discriminated raw/normalized union. Owned rows add scope:owned and prerequisite:null while retaining the prior complete owned fields/identity rules. External rows require scope:external-prerequisite, kind:p, exact Auth relation identity, null inherited parent and a mandatory prerequisite proof: actual relationOwner/indexOwner native principals, relation kind/nonpartition state, full actual id-column relation/ordinal/name/type/nullability/dropped/typmod/dimensions, index reference and exactly one observed index-owning constraint reference. There is deliberately no fabricated constraint.owner.

Fixed constraint SELECT retains all owned rows and adds only rows whose conrelid matches the explicitly bound Auth relation and conindid matches its explicitly bound index. It does not filter a wrong kind into silence: the strict external p variant rejects it. Nested fixed catalog joins collect owners/column/type/index identity and all same-parent constraints owning that index; a missing lookup is not defaulted to proof. The index SELECT is structurally unchanged. Dependency roots additionally include only that same bound constraint selection, retaining both dependency directions and original endpoints; the first internal edge is required exactly once, never hidden or rewritten.

Normalizer requires one observed external constraint and one observed external index, matching the explicit binding identities and each other. It independently checks both observed owners=M, column/native relation/type mapping, constraint/index exact parent and identity, singleton owning-constraint proof, conkey/index key[1], no include/expression/predicate, btree/uuid_ops/no collation/options[0], primary/unique/valid/ready/live/immediate flags, nondeferred/enforced/validated/local PK metadata and absence of FK/exclusion/expression fields. The index must still be actually used by an owned FK, as before. Missing observation cannot be replaced by a fact. Unknown/wrong endpoint, role, owner, parent, type, ordinal, key, native/semantic alias or duplicate fails closed.

The registry uses the existing typed qualified constraint key and stores the prerequisite proof in the observable row. Native OIDs disappear only after reference validation. Scope/proof and the explicit binding extension require **descriptorVersion2→3**, approved before implementation. API/module suffixV3, observation hash domain catalog-observation:v3, internal trigger structuralVersion1 and approval:false/expectedCatalog:false remain unchanged. Old v2 inputs are intentionally incompatible; no old report/artifact is relabeled as v3. New private SQL construction consumes fixed helper aliases, so generated alias suffixes/query hashes can mechanically change elsewhere; no unrelated query predicates or ACL helper behavior were changed. This is not evidence that all newly generated query text has been executed natively.

## Actual one bounded native run

Command: node --conditions=react-server --import tsx tests/b44-auth-prerequisite-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin. Existing portable postgres/initdb/pg_ctl signatures verified Valid EnterpriseDB; version18.7. One new owned UTF8/C/template0 database dream_test_B44, loopback49231, root `tmp/b44-native-3e334fc5-08b3-463f-9411-979d47d0efb9`. Original product source was pinned to LF SHA **87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0**; source and harness were not changed after this execution. No P/loader migration, full reader, business schema or runtime roles were installed.

Actual M=b44_migration/native16389 LOGIN CREATEROLE/NOSUPERUSER/NOBYPASSRLS/NOINHERIT. M creates only auth.users(id uuid PRIMARY KEY) in this fixture. Fixed parameterized discovery SELECTs and the actual exported constraints/indexes projections run in RR READ ONLY/pg_catalog. Each projection returns exactly one external-prerequisite row. Direct fixed native dependency SELECT confirms exactly one internal index→constraint edge with zero sub-IDs.

| Actual fact | Native evidence |
| --- | --- |
|auth.users relation|16392; kind r/nonpartition; actual owner16389=M|
|id column|attnum1/name id/not-null/non-dropped/typmod-1/dimensions0|
|type|2950 / pg_catalog.uuid|
|primary constraint|16397; actual name users_pkey; kind p; conkey[1]; actual definition PRIMARY KEY (id)|
|supporting index|16396; actual users_pkey; parent16392; actual owner16389=M|
|index properties|primary/unique/valid/ready/live/immediate true, btree/uuid_ops/key[1], no include/expression/predicate|
|observed index-owning constraints|Exactly native16397 under the same native relation/index|
|dependency|pg_class16396/sub0→pg_constraint16397/sub0, deptype i|

actual-prerequisite-facts.json retains actual native metadata and the four detached explicit binding fragments, with ownerScope M-only/constraintHasNoIndependentOwnerColumntrue/noP/noFullReadertrue. Source/query hashes, signature/version/ownership/run and raw projection files are retained. Projection-constraints.json SHA256 **46599f73b52546d4b31ac33b7e1cbc22e8e98ac988396f7cea6d76c5270421c9**; projection-indexes.json **98cc0b4a0ab046c2c7f72e8e12d21b9425ce6a56c18a2f2b83c243544abcd40c**. These are diagnostic captures, not Golden/expected artifacts.

Native command exit0 and completed/stoppedtrue prove this bounded fact/projection path only. No full14-category input existed in that DB and no official cross-category observation/hash was obtained. Identical integer OIDs to prior B43 are coincidental allocator results in a different cluster: B44's actual users_pkey name/definition/owner are not retroactive native evidence about B43's uncollected target constraint. B43 raw files were not amended or fed into a patched decoder to claim green. Further missing endpoints remain uninvestigated.

## Unit regressions and explicit capture rekeying

Added34 cases to190: two strict Auth prerequisite positives/semantic hash visibility,31 missing/duplicate/semantic alias/foreign-parent/wrong-kind/key/index/owner/type/column/singleton/dependency/binding negatives, and one newly captured B44 fixture-derived integration case. Existing ACL/PUBLIC/grantability/rawNULL/F38 argument/TOAST/internal graph/profile/strict parser regressions remain. The fixture adds explicit new scope/proof/fact/edge, never defaults missing caller evidence. A legacy TOAST test initially cloned the fixture's last dependency, which became the newly appended Auth edge; its selection was corrected to the original explicit TOAST edge. The original TOAST endpoint/type a positive assertion was retained; no product expectation was relaxed.

Captured B44 primary constraint/index/edge input is inlined with provenance hashes. That dedicated test explicitly **rekeys** native M16389→synthetic11, relation16392→900, index16396→301, constraint16397→902, UUID2950→9000, only in named nativeOid/principalOid fields and explicitly converted dependency fields. Other categories/bindings are synthetic. A second mapping shifts those synthetic assignments20000; canonical JSON/hash is equal. Actual name/definition/key/type/flags/proof metadata remain intact. This tests semantic normalization within a declared mixed synthetic graph, not an original native schema5 decoder PASS, native cross-cluster equivalence or a frozen expected reference. Changed valid-shaped definitions remain changed unvalidated observations.

Final checks (all five integration switches DREAM_PG_INTEGRATION/B22_SCHEMA_TEST/B23_SCHEMA_TEST/B24_SCHEMA_TEST/B25_SCHEMA_TEST set0):

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/schema5-catalog.test.ts tests/postgres/schema5-source.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-catalog-v3.ts tests/postgres/schema5-catalog.test.ts tests/b44-auth-prerequisite-native-owned.ts --max-warnings 0
git diff --check
```

Actual final **224 catalog cases /395 related passed,100 native-disabled skipped**. Full-project TypeScript0, three-file eslint0/zero warnings, whitespace/selective four-path checks0. The earlier pre-capture checkpoint was223 catalog/394 related pass. Native exact-fact assertions are separate from these mocked/synthetic unit checks; no extra native invocation followed.

## Cleanup, unsupported scope and next gate

Owned postmaster68148/port49231; actual clients70608 bootstrap and47072 M. Harness attempts/awaits rollback/end, verifies owned PID-file directory/port/PID then pg_ctl fast stop. cleanup-safe.json has completedtrue/postmasterPidAbsent/listenerAbsent/processAbsenttrue. Separate OS verification confirms all three PIDs absent and listener49231 absent. No original/shared cluster, PID, service or port was operated on. Statement/connection/error parameter logs suppressed; no secret/DSN/auth value printed.

This supports only the declared owned recipe where Auth relation/index owner=M. General external owners/Principal tags, managed Supabase compatibility, other Auth constraints/indexes/columns/types, full native schema5 normalization, capacities, pair/drift/cross-cluster/reference/Golden/state/runner/provenance/runtime remain unsupported/unverified. A caller POJO is not approval. Old SQL/P/D/loader/history/B39–43 harnesses/reports/evidence, ACL helper, UI, package/config/env/build/deploy/install/provider/managed/browser and agent/window/worktree remain unchanged.

Independent code/unit/bounded-native review is next; a separately allocated new full reader harness must discover the additional exact constraint fact and use descriptor3 before any schema5 native retry. Old full-native harnesses deliberately retain their old source pins and recipe, not silently updated. No subsequent failure has been patched or bypassed in this task.

Copyable return: B44 descriptor3/14-category strict exact Auth UUID PK scope adds explicit constraint fact and observed owner/type/key/index/single-owner/dependency proof, with both relation/index owner=M; no fictional constraint owner/general external Principal. Bounded new Auth-only PG18.7 run returned actual constraint/index rows and edge successfully, no P/full reader.224 catalog/395 related PASS100native skips/type-lint-whitespace0;31 negatives and declared captured-native-to-synthetic shifted-OID normalization covered. Original B43 failure/data untouched; new B44 details are not backfilled into old native evidence. Own postmaster68148/backends70608,47072/listener49231/PID-file all absent. Exact four-path source/facts return for independent review; full native/Golden/state/runtime acceptance remains unallocated.
