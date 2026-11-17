# B23 — isolated versioned migration runner

Status: ready_review; independent B23 acceptance pending. Backend sole author. Assignment `msg_4208bcd7e860`. Confirmed 2026-11-18 01:35 KST (2026-11-17 16:35 UTC).
Accepted foundation: B22-FIX `f5d009ec72ce9411eeda322fa1ca12b2345dbe65`, B22-R2 `8b5237d` selected caller-owned SELECT-only source/catalog PASS accepted by Master. This assignment adds a separate apply API; independent B23 acceptance is still required.

Allowed paths recorded before implementation:

- `lib/db/postgres/migration-runner-v2.ts` (new API)
- `tests/postgres/versioned-migrations.test.ts` (new focused/pool-fault/real-PG tests)
- `tests/postgres/run-versioned-migrations-local.mjs` (new owned runner)
- `docs/handoffs/B23-VERSIONED-MIGRATION-RUNNER.md` (this unique handoff)

Existing v1/target/connection/manifest/state/SQL1–4/B19/runtime/package/CLI are protected. No managed access, actual environment/SSL/Storage/API/config/paid/deploy/.next/3013/new window or agent. Any required upstream contract change needs scope adjustment instead of an unassigned edit.

Planned verification: explicit3/4 immutable target/version/manifest approval; source/profile/TLS/redaction admission; one owned max1 pool and one transaction; shared advisory lock followed by RC inspection; fresh3/fresh4/upgrade/reexecution and rejected states; atomic injected rollback and preserved old data/history; actual lock waits with competing real clients and post-wait observation; dry-run read-only RR; connect/BEGIN/DDL/COMMIT/rollback/release/end fault and ambiguous outcome cleanup. Only owned signed PG18.7 is an execution target.

## API and admission

New opt-in server-only API:

```ts
runPostgresMigrationsV2({
  version: 3 | 4,
  mode: "dry-run" | "apply",
  target: approvedMigrationTarget,
  expectedTargetHash: independentlyReviewedTargetHash,
  expectedApprovalHash: independentlyReviewedVersionModeManifestBinding,
  ca: approvedCaIfRequired,
  // Optional trusted local sourceRoot for fixed-source testing; hashes still apply.
})
```

The shown values are shape notation, not an executable approval request. `postgresMigrationApprovalHashV2(version,targetHash,mode)` computes SHA256 of the fixed JSON record `{runnerVersion:2,schemaVersion,targetHash,mode,manifest:[{id,checksum},...]}`. Numeric3/4 and the exact mode are explicit; there is no latest/default version or automatic apply. A fingerprint is not evidence of human authorization: the trusted caller must obtain independently reviewed target/action values rather than accepting self-approval from an untrusted request. A dry-run binding cannot be reused for apply by changing only mode.

Before the first await, the runner copies only closed data properties, rejects unexpected keys/accessors/custom prototypes and pool/factory/client/hooks injection, snapshots primitive target fields, mode/hash/CA and any source URL. It reuses unchanged `inspectMigrationTarget` for existing synthetic/Direct/Session profile, project ref/role/host/port/database bindings, and requires exact expected target and approval hashes. It then loads the selected fixed sources with the accepted checksum loader before creating a pool. Runtime arguments cannot replace the manifest, inspector, executor or factory.

The exact same frozen DSN creates one internally owned max1 pool. Existing `createPostgresPool` retains TLS hostname/CA verification, timeouts and loopback synthetic-only TLS-off behavior. Managed Session requires explicit nonblank CA and the unchanged routing/actual-role contract. Profile acceptance and fingerprints do not authorize real managed access. No network call was made in the managed-profile tests; they mock the owned factory and assert its exact options.

## Transaction and outcome behavior

Apply begins explicit READ COMMITTED, sets LOCAL pg_catalog search path, acquires shared transaction advisory lock `(1725031001,5)` and only then calls the accepted inspector on that client. No pre-lock plan authorizes DDL. A waiter observes the winner's committed state in subsequent RC statements.

| State / requested schema | Apply behavior |
| --- | --- |
| Fresh /3 |Create journal, verified SQL1–3 and history1–3 in one transaction.|
| Fresh /4 |Create journal, verified SQL1–4 and history1–4 in one transaction; verify exact complete3 prefix before SQL4, without committing it separately.|
| Complete3 /4 |Run only fixed SQL4 and append row4; never rewrite first3 history or old rows.|
| Complete3 /3 or complete4 /4 |Exact inspection and confirmed transaction, applied0.|
| Complete4 /3 |Reject, no downgrade.|
| Partial/unknown/checksum/catalog drift or unjournaled SQL4 |Reject, no resume, adoption, backfill or repair.|

After writes, exact accepted catalog/history must be complete at the requested version before COMMIT. Successful return requires command COMMIT; return includes only targetHash/approvalHash/schemaVersion/fromVersion/mode/applied/pending and frozen fixed manifest ids/checksums. No DSN/host/db/user/password/CA/raw driver message is returned or logged.

Dry-run uses REPEATABLE READ READ ONLY, no migration lock or DDL/history writes, and returns a point-in-time pending count. Apply repeats admission and post-lock inspection; a stale dry-run is not authority. No CLI/runtime/application startup call or automatic migration was added. Production source search found no import of the new runner from existing app/lib/scripts paths.

`PostgresMigrationFailureV2` has closed code MIGRATION_FAILED and a redacted outcome:

- `not-applied`: no runner DDL transaction committed, including confirmed rollback or failure before transaction work.
- `unknown`: uncertain COMMIT response, client error at commit or unconfirmed rollback. Client is destroyed, no automatic retry/compensating delete, and no claim that rollback happened. A future explicitly authorized inspection may discover complete4 and allow a zero-apply reexecution.
- `committed`: COMMIT response was confirmed but release/pool shutdown failed. This is reported as failure, not successful cleanup; committed describes the transaction (including a read-only/no-op one), not newly applied schema count.

Connect/BEGIN/query/catalog errors attempt appropriate rollback before release; uncertain/failed clients are destroyed. COMMIT uncertainty never issues a follow-up ROLLBACK or compensation whose response could be misread as proof that COMMIT did not happen. Every created pool receives end on all paths; failed release/end triggers best-effort owned client close and failure preserving the known outcome. Cleanup errors are not evidence that resources actually stopped. No driver error/cause containing secrets is attached to public errors.

## Actual validation

Final exact owned command:

```text
node tests/postgres/run-versioned-migrations-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

**66PASS /0skip**, exit0, start2026-11-18 01:33:06 KST,10.31s. All66 are the new B23 suite:46 admission/mock lifecycle tests +20 real PG transaction/concurrency cases. Old B22 accepted counts are background evidence, not new runs in this submission.

| Real PG evidence | Observed result |
| --- | --- |
| Fresh3/fresh4, same-version repeats |Exact complete state, applied3/4 then0; first history preserved on repeat. Fresh dry-run leaves schemas/history/roles absent.|
| Known complete3→4 |applied1, original three history rows including timestamps unchanged, existing settings raw JSON preserved.4→3 STATE and old v1 on complete4 HISTORY rejection.|
| Mid-SQL4 fresh failure |Real owned event-trigger exception after a SQL4 table exists; all SQL1–4/history/roles roll back, external synthetic Auth remains.|
| Mid-SQL2 fresh3 failure |Real event-trigger failure, no partial prefix/journal/roles remains.|
| Upgrade SQL4 failure |Complete3 history/business sentinel retained and no SQL4 table residue.|
| Postcatalog failure |Owned DDL event trigger introduces a wrong column; a test-only passthrough records native history count4 before accepted inspector rejects; whole fresh4 transaction rolls back. Product API has no test hook.|
| Unknown/partial/checksum/catalog/historyless cases |Reject without changing the existing incorrect history or adopting draft objects.|
| Two fresh4 callers |Both natively observed waiting on the shared lock; first applied4, second observed complete4 and applied0.|
| Two upgrade4 callers |Both wait; applied1 then0, first3 history unchanged.|
| Mixed v1-first /v2-second |Shared lock; v1 applied3, v2 observed complete3 and applied only4.|
| Mixed v2-first /v1-second |v2 applied4; v1 observed complete4 and rejected HISTORY, retaining its old contract.|
| Rollback winner |Test-only public sequence makes the first real API caller fail mid-SQL4 once. Its transaction rolls back; the waiting second observes fresh and applies4. Sequence is deliberate owned nontransactional fault control, not production behavior.|
| Stale dry-run |Intervening journal ACL drift causes apply rejection rather than acting on pending1.|
| Backend lifecycle |Normal/failure API pools finish with no dream-backend connection left in the owned DB.|
| Lost COMMIT response |Test-owned factory instrumentation lets real server COMMIT finish, then discards the response and throws. API reports unknown/destroys client/no ROLLBACK. Separate admin inspection sees complete4/history4; a later explicit run returns applied0. This simulates the response-loss boundary, not a physical network/TLS outage.|

Five concurrency cases retain native pid/wait_event_type=Lock/wait_event=advisory observations in `lock-observations.jsonl`. A bounded condition loop checks actual pg_locks/pg_stat_activity before releasing the gate; no sleep-only inference of contention. All concurrent promises settle before fixture reset. Advisory locking is cooperative; arbitrary external administrator SQL is not fenced out.

Mock-only fault matrix covers factory/connect/BEGIN/lock/DDL/post-inspection errors; COMMIT error/unexpected command/client-error event, rollback failure; release and pool.end failure. It asserts owned pool connect/end counts, client destruction, unknown/no retry/no compensation, known committed cleanup failure and secret-free public errors. Unit profile tests cover synthetic rejection and exact Direct/Session stage/live options/ref/role/host/port/db/CA boundaries with no remote connection.

Final regression command:

```text
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts
```

**81PASS /86skip**, exit0: old v1 pure13 + accepted B22 pure22 + B23 pure46. The86 skipped integration cases (B22 66 + B23 20) require owned fixture environments; B23's20 passed above. Do not add repeated pure46 to66 as additional coverage. B22's66 were not rerun as an owned suite in B23; unchanged sources/import boundaries and its pure checks passed.

Final TypeScript and targeted lint both exit0, warnings0:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-runner-v2.ts tests/postgres/versioned-migrations.test.ts tests/postgres/run-versioned-migrations-local.mjs --max-warnings 0
```

The first iteration had pure33PASS/17skip and actual50PASS (33+17), followed by static failures for an overly wide mock pending type, unused type import and a rollback-command throw lint rule. Narrowed the mock type, removed the unused import and used explicit unknown-state assignment for an unexpected rollback command; no expectations were weakened. Mode-bound approval, target/profile cases and three additional real PG scenarios produced final66. No managed/SSL provider or shared build check was run.

## Owned resources, source identity and next gate

Only explicit signed EnterpriseDB portable PostgreSQL18.7/Windows/UTF-8/C on fresh loopback SCRAM clusters was used. Runner scrubs inherited PG connection variables and passes guarded owned fixture URLs. Its destructive test resets affect only its new synthetic dream/history schemas/roles. No managed DSN/environment fallback, shared server or3013/.next change occurred.

| Evidence root under tmp/ | Result / cleanup |
| --- | --- |
| `b23-postgres-fec220e5-06cd-4c4a-87e3-954760bfb060` |Initial50PASS; postmasterPidAbsent=true/listenerAbsent=true.|
| `b23-postgres-e5fffb83-f8f8-45ae-b416-4e8b2949f874` |Final66PASS; PID77196,127.0.0.1:54701, database dream_test_b3; both cleanup flags true.|

All owned PostgreSQL processes/listeners/transactions ended; evidence retained, no recursive deletion. Normal owned resource cleanup is actually verified; mocked close failures deliberately do not establish real shutdown success.

New runner canonical LF UTF-8 SHA256: **`11005c7a0ac75cc11db34dfd5afc88822f0e898acfb87d1e4e218622f5efa431`**. Fixed SQL4 remains `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`; old SQL1–3/v1/target/connection/manifest/state/B19/runtime/package/CLI have no change. Only the four predeclared files are submitted.

Actual compatibility claim is PG18.7 synthetic only. Existing profile/minimum-version code paths remain, but PG16/17/other collations/managed Direct or Session, live TLS/CA/SSL decisions and production privilege handling are not newly verified. Accepted catalog coverage is bounded; this runner is not a worker/Storage executor, native byte verifier, provider fencing/quiescence authority or deployment-readiness proof. Lifecycle fault injection and real concurrency do not guarantee behavior under every server crash/network partition/pool implementation fault.

Common/team v1.4 read at the safe work boundary. Actual environment remains this Windows workspace; no Tester device is inferred from a name, no new Codex agent/window/worktree/scheduler was created. Official team/status documents remain Master's responsibility.

Master handoff: B23 separate versioned API is ready_review;66 new cases pass, old/new pure regression81PASS with86 integration skips explained, TypeScript/ESLint pass and both owned clusters stopped. Request independent review of the fixed four-file commit, approval binding, transaction/unknown-outcome semantics and native lock evidence. No CLI or managed/runtime operation is approved or performed by this submission.
