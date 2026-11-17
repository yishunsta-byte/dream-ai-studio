# B24 — explicit versioned migration CLI

Status: ready_review; independent B24 acceptance pending. Backend sole author; assignment `msg_4f53a5d074e4`. Final verification2026-11-18 02:02 KST (2026-11-17 17:02 UTC).
Accepted baseline: B23 `ea5a477d622ac3d839035e9abfbdcb88770e37a5`, B23-R `192f0a6` designated synthetic runner scope PASS accepted by Master. B24 requires its own independent review.

Allowed paths recorded before implementation:

- `scripts/postgres/migrate-v2.ts`
- `tests/postgres/versioned-migration-cli.test.ts`
- `tests/postgres/run-versioned-cli-local.mjs`
- `docs/handoffs/B24-VERSIONED-MIGRATION-CLI.md`

All are new. Existing v1 CLI/runner/target/connection/manifest/state/SQL1–4/B19/runtime/package are protected. No provision template/profile addition, automatic migration/retry, actual managed/SSL/Storage/API/config/paid/deploy/.next/3013 action or new agent/window/worktree. Production builds/deployment remain separately assigned to the main PC.

Planned canonical syntax: `fingerprint --schema 3|4 --mode dry-run|apply`; `dry-run --schema 3|4`; `apply --schema 3|4`. Fixed argument order/length, no aliases or secret arguments. Secrets only from the explicit DREAM_PG_MIGRATION_* environment family; separate expected target/approval hashes for execution. Fingerprint is offline information, not human approval or self-authorization. Validate parser/env snapshot/outcomes with mocks and actual supported Node/tsx child processes against owned signed PG18.7 only.

## Delivered syntax and environment contract

Explicit standalone invocation, using the existing installed Node/tsx and server-only condition:

```text
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts fingerprint --schema 4 --mode apply
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts fingerprint --schema 4 --mode dry-run
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts dry-run --schema 4
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts apply --schema 4
```

Literal schema3 is also supported. Only those exact ordered argument shapes are valid. No default/latest/version coercion, reordered flags, `--schema=4`, duplicates, extra arguments, provision-template, URLs, passwords or CA arguments. Schema text must be exactly3 or4. Parser errors never echo rejected tokens. A negative test supplies a synthetic canary as a forbidden URL argument to verify this; no real DSN is passed through argv.

Only these explicit existing-family environment keys are read and snapshotted before the first await:

| Purpose | Variables |
| --- | --- |
| Secret connection / profile |DREAM_PG_MIGRATION_URL, DREAM_PG_MIGRATION_PROFILE|
| Project binding |DREAM_PG_MIGRATION_PROJECT_REF|
| Independent Session metadata |DREAM_PG_MIGRATION_SESSION_HOST, SESSION_PORT, SESSION_DATABASE, SESSION_USERNAME, SESSION_ROLE (each with DREAM_PG_MIGRATION_ prefix)|
| Optional approved CA |DREAM_PG_MIGRATION_CA|
| Independently reviewed execution values |DREAM_PG_MIGRATION_TARGET_HASH, DREAM_PG_MIGRATION_APPROVAL_HASH|

No general DATABASE_URL/PG fallback, `.env` loader, arbitrary source-root environment variable, new profile, runtime hook or package script. Missing/invalid explicit URL/profile rejects. Environment accessors are rejected without calling them; inherited values are not adopted. Target fields are copied exactly and frozen; session role/ref/port metadata is not inferred from a routing username. Original argv/environment mutations after an await cannot change the selected action, target, CA or reviewed hashes.

## Fingerprint versus execution

Fingerprint validates the exact selected source hashes from disk, inspects only offline target syntax and computes the accepted runner's target/version/**mode**/ordered-manifest binding. It calls no runner/pool and needs no live DB. Output is one JSON record with command, runnerVersion2, schemaVersion, mode, targetHash, approvalHash and fixed manifest id/checksum entries. No host/db/user/DSN/password/CA is printed. Offline managed profile syntax is not managed connectivity/TLS/privilege verification; an absent CA can remain offline information while the unchanged runner enforces it when actually connecting.

Hashes are review information, not proof of human approval. Fingerprint does not populate execution environment variables, write approval files, invoke apply, authorize a different mode, or retry anything. Dry-run/apply require **both separately supplied 64-hex expected hashes**. Their exact supplied values are passed to the accepted B23 runner; the CLI does not replace missing/wrong approval values with hashes it computes itself. The trusted operator must independently review those values and the intended action. The local tests compute fixture approvals as explicitly authorized synthetic test inputs, not as a human-approval mechanism.

Execution delegates unchanged to `runPostgresMigrationsV2`; no new transaction/provisioning/rollback logic is duplicated in the CLI. Dry-run and apply retain B23's distinct approval bindings and READ ONLY versus write behavior. There is no automatic migration on import or application startup. A direct-entry path guard prevents imports from executing a command; actual child import with an invalid environment emits nothing and opens no operation.

## Output, failures and secrets

Each command attempts exactly one JSON stdout record. Success uses a closed field projection: command, targetHash, approvalHash, schemaVersion/fromVersion/mode/applied/pending and the exact fixed manifest. Extra runner fields or private nested entry fields are not serialized. Manifest entry order/values are validated while ordinary object-key order is semantic, not a false mismatch. Unexpected result shape becomes FAILED/unknown rather than success or retry.

Known errors produce only the closed migration error code. MIGRATION_FAILED also preserves the accepted runner's `not-applied`, `unknown` or `committed` outcome. Unexpected exceptions after runner invocation conservatively report unknown; raw driver messages, cause/stack, rejected arguments and environment contents are never emitted. Error exit is1; success is0. Unknown/committed outcomes are not recast as rollback or permission to retry. A broken output callback returns nonzero without another write/operation; standalone stdout stream errors also set nonzero without printing raw exceptions. If output delivery fails after a database operation, an operator must explicitly inspect state rather than assume failure meant no commit.

## Actual validation and overlap

Exact final owned command:

```text
node tests/postgres/run-versioned-cli-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

Final **59PASS /0skip**, exit0, start2026-11-18 02:00:27 KST,6.18s:45 pure/parser/env/error/projection tests +14 actual child-process cases. Those14 cases launched **22 children**:13 expected exit0 and9 expected exit1. No child timed out; all children reached close. Raw stdout/stderr are retained per invocation in `child-output.jsonl`; **all22 stderr streams are empty**, and every stdout/stderr pair excludes canary values, the synthetic password and complete synthetic DSN. Import alone has empty stdout; other invocations have one parseable JSON line.

| Actual child cases / canonical arguments after script path | Observed result |
| --- | --- |
| `fingerprint --schema 3 --mode apply/dry-run`, `fingerprint --schema 4 --mode apply/dry-run` |Four offline fingerprints succeed using valid syntax pointing to unreachable loopback port1; no DB required. Pure spies independently verify no runner/factory call.|
| Import via `node --conditions=react-server --import tsx --input-type=module -e "await import('./scripts/postgres/migrate-v2.ts')"` |exit0, no output/command even with invalid secret environment.|
| `dry-run --schema 4` with separately reviewed dry-run binding |pending4/applied0; native parent inspection confirms no dream/history/roles.|
| `apply --schema 3`; `dry-run --schema 4`; `apply --schema 4`; same apply again |fresh3 applied3, upgrade plan1, upgrade applied1, repeat0. Native first3 history rows/timestamps and raw business sentinel remain unchanged.|
| `apply --schema 4`; then `apply --schema 3` |fresh4 applied4; downgrade exit1/STATE. Secret CA canary in synthetic environment is not printed.|
| Fingerprint for apply; then apply with no expected hash environment |Fingerprint success does not self-authorize; apply exit1/TARGET and native state remains fresh.|
| Apply with dry-run binding, wrong target hash, or only general DATABASE_URL |Three exit1/TARGET; no schema/history/role changes.|
| `apply --schema 4 --url <forbidden synthetic-canary token>` |exit1/TARGET, rejected token not echoed. Exact token is the source fixture's `offlineUri`; no real credential argument.|
| Apply4 with partial history after a child fresh3 setup |exit1/HISTORY; native incomplete history remains2 rows, no repair/adoption.|
| Apply4 with real owned middle-DDL exception |exit1/FAILED, outcome not-applied; native original prefix/history/roles all roll back.|
| `dry-run --schema 4` with reviewed unreachable synthetic target |exit1/FAILED/not-applied, child ends, native connection details/cause absent from streams.|

The expected nine failed-child invocations above are assertions within passing tests; they are not unresolved product failures. Child executable/flag arrays, environment construction and all exact assertions are in the fixed test source. Logs record safe labels and raw streams, not secret environment/argv values. No child loads an env file, installs a binary, uses a real managed target or runs a deployment.

Pure coverage includes canonical syntax positives and missing/duplicate/extra/unknown/secret-looking negatives; strict version strings; offline source verification/no pool; argv/env mutation snapshots; no generated missing approval; exact target/CA/session metadata forwarding; no DATABASE_URL fallback; accessor rejection; all three failure outcomes; raw error/cause redaction; one-shot writer failure; unknown-result rejection and safe result projection. Unknown/committed CLI outcomes are tested with accepted runner errors in mocks; actual B24 child failures exercise not-applied. B23's independent actual commit-response-loss evidence remains its separate accepted scope, not a new physical-outage test here.

Final regression:

```text
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts
```

**126PASS /100skip**, exit0: old v1 pure13 + B22 pure22 + B23 pure46 + B24 pure45. The100 integration skips need their respective owned environments (66+20+14); the B24 fourteen passed above. These overlapping pure results are not added to59 as new cases. Earlier accepted suites are unchanged; they were not all reexecuted as real PG matrices for this CLI-only change.

Final TypeScript/targeted lint exit0, warnings0:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/postgres/migrate-v2.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/run-versioned-cli-local.mjs --max-warnings 0
```

## Resources, hashes and next review

Actual environment: existing Windows Node **v26.13.0**, installed local tsx loader and signed EnterpriseDB PostgreSQL18.7 UTF-8/C. No binary installation, Next build/typegen/.next/3013 action or remote connection.

| Owned root under tmp/ | Evidence |
| --- | --- |
| `b24-postgres-aa322968-aa43-40c2-b4c3-56f8e0e9df7e` |First56PASS (42pure+14child); both cleanup flags true.|
| `b24-postgres-4e5ea0a3-4af8-4772-870f-fd930bd88f49` |Final59PASS after three projection/snapshot boundaries; PID20612,127.0.0.1:59271, database dream_test_b3; postmasterPidAbsent=true/listenerAbsent=true.|

Both owned clusters stopped and all22 final child processes closed. No owned PG process/listener/transaction remains. Evidence directories retained, no recursive deletion. Destructive fixture resets were guarded to the runner's fresh synthetic namespace/roles; actual managed/Auth/provider resources were not touched.

New CLI canonical LF UTF-8 SHA256: **`36325c91d58270f8389799238ac6b6e93d9c7be076882f569f317423d1c10922`**. SQL1–4, existing v1 CLI, accepted runner/target/connection/manifest/state/B19/runtime/package have no change. Only the four predeclared new paths are submitted.

Limitations: tested Node26.13.0/Windows/PG18.7 and this supported tsx invocation only; other Node/server/collation/managed environments are not newly verified. CLI fingerprints do not establish human approval, TLS connectivity, operator privilege, Storage/worker readiness or deployment authority. No new provision/profile/automatic application wiring is included. Request independent B24 review before any separate managed/operational assignment.

Master handoff: B24 separate strict env-only CLI is ready_review;59PASS including14 actual cases/22 children, raw output secret checks, old/new pure126PASS with100 integration skips explained, TypeScript/ESLint pass and both owned clusters stopped. Review the fixed four-file commit; preserve explicit approval and all runtime/managed/build/deploy gates.
