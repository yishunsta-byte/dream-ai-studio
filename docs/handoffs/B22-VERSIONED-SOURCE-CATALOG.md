# B22 — versioned source/catalog foundation

Status: ready_review; independent B22 acceptance pending. Assignment `msg_4483e4e47049`, Backend sole author. Final verification 2026-11-18 00:50 KST (2026-11-17 15:50 UTC).
Accepted input: B20-FIX2 `9d388993a480a9ec0881484dd14b45bba1de3c03`, SQL canonical LF SHA256 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`, B20-R3 `3ec0ddfa` selected-DDL PASS accepted by Master.

Allowed paths recorded before implementation:

- `lib/db/postgres/migration-manifest-v2.ts` (new fixed closed3/4 source loader)
- `lib/db/postgres/migration-state-v2.ts` (new explicit fixed descriptors/read-only inspector)
- `lib/db/postgres/0004_storage_verification.sql` (new local fixed source, exact LF bytes of accepted draft)
- `tests/postgres/versioned-source-catalog.test.ts` (new B22 tests)
- `tests/postgres/run-versioned-source-catalog-local.mjs` (new owned synthetic runner)
- `docs/handoffs/B21-VERSIONED-MIGRATION-CONTRACT.md` (accepted source reference update)
- `docs/handoffs/B22-VERSIONED-SOURCE-CATALOG.md` (this unique handoff)

Existing v1 source/manifest/runner/CLI/provision template, SQL1–3, B19, runtime/API/package and shared .next/3013 are protected. No v2 apply runner or CLI, automatic migration, managed/SSL/Storage/config/paid/deployment operation is assigned. Common/team rules v1.3 read: reminders target the existing Master only; no new check window/agent/scheduler or shared-state writer will be created.

Validation plan: pin explicit descriptors from verified accepted sources in a separately identified owned reference cluster, then use fixed descriptors against independent owned test states. Exercise complete3/4, source/version rejection, historyless draft/partial/unknown history and catalog drift, v1 complete4 rejection, read-only query behavior, and owned PG cleanup. Reference generation is development evidence only; runtime inspector never learns expected definitions from its target.

## Delivered behavior

`migration-manifest-v2.ts` exposes a deeply frozen closed registry for numeric versions3 and4 and a checksum-verifying loader. All first-three entries are independently pinned to their existing exact hashes; v2 does not inherit future manifest extension implicitly. Unsupported/missing/string versions reject before file reads or queries. SQL1–4 receive CRLF→LF normalization only; comment/BOM/statement drift rejects with redacted SOURCE. Only fixed verified outer transactions are removed, preserving PL/pgSQL bodies. Loading returns SQL text and never executes it.

`0004_storage_verification.sql` is a local fixed source whose LF bytes equal the accepted draft exactly, including its original unpublished/offline warning header. Its opt-in v2 registration does not extend the current v1 manifest, introduce a runtime import, create an apply runner, or authorize use on a managed target. Neither the accepted draft nor published SQL1–3 was edited.

`migration-state-v2.ts` exposes fixed descriptors, native catalog SELECT queries, a low-level observed-catalog reader and `inspectPostgresMigrationStateV2(client,{version,database,username,port})`. The inspector snapshots/validates expected identity, checks actual database/backend port/session_user/current_user, minimum server version, management/Auth privileges and the external Auth UUID unique prerequisite. It requires `search_path=pg_catalog` and validates the existing restricted role flags/graph, including the exact optional login pair.

Only two catalog models are accepted. Fresh returns pending3/4 without initializing anything; complete3 requested3 returns pending0, complete3 requested4 returns pending1; complete4 requested4 returns pending0. Version3 rejects complete4. History ordinals/ids/checksums must be exact and match the independently recognized catalog model. Unknown/partial history, missing journal/schema, checksum drift, SQL4 without history4, or history4 without SQL4 reject without adoption/repair. Catalog metadata is checked before querying history contents, so an untrusted history view/policy/owner is rejected before treating its rows as a trusted journal.

Inspection issues only fixed SELECT/WITH statements. It does not create/connect/end a pool, begin/commit/rollback, acquire an advisory lock, execute loaded source, write history or mutate schema/roles. The trusted caller owns its already-authorized client and transaction. The positive integration calls run inside REPEATABLE READ READ ONLY with pg_catalog search path. This low-level foundation is not a target-profile/CA/fingerprint connection API or a complete dry-run/apply command; those lifecycle and lock/reinspection duties remain future runner work. No arbitrary client/pool is accepted by an apply API because no apply API exists here.

## Explicit descriptor provenance and limits

Reference cluster: `tmp/b22-postgres-8aabf65f-5b2a-47ed-ad53-4252a4df67bf`, PID15440/loopback59114. A temporary development-only capture fixture initialized fresh synthetic Auth, ran unchanged v1 SQL3, captured metadata, applied checksum-verified accepted SQL4 with its synthetic row4, and captured metadata. The capture fixture was removed from the final tests. It was never pointed at a managed or test target to learn expectations.

Retained reference JSON `reference-catalog.json` SHA256: **`afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`**. A temporary ignored `tmp/b22-freeze-reference.mjs` wrote reviewed explicit literal rows into the state source; it is not shipped/imported or invoked by tests/inspector. Declared function arguments additionally pin the accepted sources' absence of defaults: every accepted full declaration equals its captured identity arguments. A separate test changes a default while retaining the exact accepted body/identity signature and verifies rejection.

Descriptors are explicit per-object data, not just counts or a target-generated hash. Complete4 reuses fixed complete3 rows plus an explicit fixed SQL4 delta; reference validation established no old row changed. Rows are compared canonically as category sets, while ordered fields such as column ordinal and ACL tuple positions remain significant. Nested objects are frozen. Owner/grantor/grantee names become `$owner` only for the actual session-owned object; unexpected ownership still mismatches.

| Captured category | complete3 | complete4 | Checked fields |
| --- | --- | --- | --- |
| Schemas |2|2|exact names/owners/effective ACLs|
| Relations |19|31|includes history; names/kinds/owners/ACLs/RLS/FORCE/replident/persistence/options/partition flag|
| Columns |217|410|names/ordinal/type/nullability/default/generated/identity/dropped state/collation/column ACL|
| Constraints |330|660|table/domain names, PK/unique/CHECK/compositeFK definitions, validated and deferral flags|
| Indexes |90|136|names/full definitions/unique/primary/valid/ready/live|
| Policies |36|43|table/name/roles/command/permissive/USING/WITH CHECK|
| Noninternal triggers |18|36|old18 + new guards12 + deferred6; names/enabled/type/function binding/full definition/deferral|
| Functions |3|9|identity/full declarations/result/language/owner/security/strictness/volatility/parallel/config/body SHA/ACL|
| Scalar/domain types |3|3|names/base/nullability/default/owner/ACL; domain constraints above|

Thus business/companion table counts are18/30, not19/31; the extra relation is the migration journal. SQL4 adds seven owner SELECT policies and six invoker functions, zero new roles/SECURITY DEFINER. The accepted constraint semantics remain bounded: no full transition executor, causal-prefix proof, current-clock authorization, worker identity, native bytes, provider fencing/quiescence or Storage readiness is added.

This is a bounded catalog contract, not a universal administrator-tampering detector. Global extensions/event triggers, every PostgreSQL internal/physical property, unrelated schemas and application data are not fully attested. The inspector does not lock out external administrators or create a consistent transaction itself; its trusted caller must supply stable inspection/authorized target handling. Metadata deparsing and ACL defaults are pinned from **PostgreSQL18.7 UTF-8/C on Windows**. The minimum version gate remains16, but SQL4/descriptors are actually verified only on18.7; PG16/17, other collations and managed Direct/Session are unverified and may fail closed on catalog representation differences. No compatibility weakening is introduced to assume those environments work.

## Actual final validation

```text
node tests/postgres/run-versioned-source-catalog-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

Final run: **71PASS /0skip**, exit0, started2026-11-18 00:49:28 KST,1.91s. Composition:21 pure source/input/descriptor tests +50 real PG matrix cases. Matrix includes fresh3/4 plans, real complete3, independent rollback-only fresh4 setup from all verified sources, known3→4 fixture setup, exact complete4 repeat inspection, v1 complete4 HISTORY rejection, Auth prerequisites, incomplete/unknown/checksum/historyless states, column/type/default/constraint/index/policy/ACL/RLS/trigger/function/owner/role drift, allowed optional login pair and rejected graph extensions, read-only statements/redaction, and untrusted history view rejected before row access. Synthetic setup code is test-only, not an exported v2 apply runner. No concurrent-runner/lock/COMMIT-failure claim is made.

```text
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts
```

Final nonintegration regression: **34PASS /50skip**, exit0 (existing v1 pure13 + B22 pure21; integration50 intentionally requires the owned runner and passed in that run). Do not combine repeated cases as additional coverage.

Final TypeScript and targeted ESLint: exit0, no lint warnings.

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-manifest-v2.ts lib/db/postgres/migration-state-v2.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/run-versioned-source-catalog-local.mjs --max-warnings 0
```

No Next build/typegen, shared .next or3013 action. Source search found no v2/SQL4 import in existing lib/scripts/app paths outside the new modules.

## Iteration and owned resource evidence

All runs below used explicit signed local EnterpriseDB PG18.7, isolated random roots, fresh SCRAM/UTF-8 Auth fixtures, scrubbed PG connection variables and PID-owned loopback listeners. Each finished with both cleanup flags true; all evidence is retained and no directory was recursively deleted.

| Suffix under tmp/b22-postgres- | Result |
| --- | --- |
| `8aabf65f-5b2a-47ed-ad53-4252a4df67bf` |Reference capture1PASS; not counted in final matrix.|
| `6ed1887a-c496-429a-b5fc-5d152b9b1bb3` |0 tests: temporary descriptor serialization used JavaScript replacement-token interpolation on SQL regex `$'`; fixed callback serialization to preserve bytes, no target assertion weakened.|
| `9905da46-6cf0-4e93-a859-8c59ef841aef` |59PASS/2FAIL: fixture guessed a truncated FK name incorrectly, and serialization recovery had omitted the search-path check. Correct fixed FK name and restored check.|
| `59de3dc9-031f-49e9-8686-b4a898e0d4b4` |62PASS after corrections and independent fresh4 case.|
| `553e5217-0a0d-4702-adf6-bc3e73201dd3` |69PASS after target/Auth/history boundary checks.|
| `86e9d6f4-a497-493f-bfbd-313159711279` |70PASS after metadata-before-journal view check.|
| `32e9ecf1-f12f-42f9-bdb3-0502ffd6270f` |Final71PASS including helper-default drift.|

Final `run.json`: PID12196, address127.0.0.1, port60879, database `dream_test_b3`. Its `cleanup-safe.json` records **postmasterPidAbsent=true / listenerAbsent=true** after stop. No owned PostgreSQL process/listener/transaction remains.

## Hashes, review gate and actual handoff

SQL4 accepted draft/local fixed source canonical LF SHA256: **`61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`**. Published SQL1–3 hashes remain the exact frozen B21/v1 values and pass the source loader tests. B21 now records this accepted selected-DDL source, earlier rejected candidates as history, and B22's limited opt-in registry authorization.

Request independent B22 review of the final seven-path commit, descriptor provenance/coverage, readonly/history admission and actual PG evidence. B22 is ready_review, not independently accepted yet. Next possible work is a separately assigned v2 apply runner/CLI with immutable approved target binding, lifecycle/locking/reinspection/atomicity/ambiguity tests. No automatic migration, managed/SSL/Storage/API/config/paid/deploy action is authorized by this submission.

Master handoff text: B22 fixed3/4 source/catalog foundation is ready_review; final owned PG71PASS, v1/B22 pure34PASS, TypeScript/ESLint pass and every owned cluster stopped. Review the fixed commit and explicit descriptor/source hashes before assigning any apply runner; retain all managed/runtime execution gates.
