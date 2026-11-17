# B9 — Explicit Session migration profiles

- Task/owner: B9 / Codex(Backend); Master assignment `msg_3c19d92c3928`.
- Status: **ready_review — self-verification, independent review pending**.
- Accepted prior code: B5-FIX `52ea968`; B8 evidence `dfce2ae`. Pre-delivery shared HEAD: `5328bea5d4ec7b1d18f0bb7ce3ac6aab2aa524f6`.
- Scope: migration-target, migration runner CA gate, migration CLI, PostgreSQL README, dedicated tests, this handoff. SQL3/B3-B4/Auth/package/T213/3013/`.next` untouched.
- Received/read operational update `msg_87076a257344`: AI_TEAM_RULES §6 five-minute/event/handoff rules and CODEX_MASTER guidance. Shared status documents remain Master-owned; this report and actual Orca return carry worker status. No polling, scheduler, or resident monitor was installed.

## Official support and transport contract

Sources checked 2026-11-17, primary sources only:

| Question | Evidence and conclusion |
| --- | --- |
| Migration/DDL support | Supabase's [Prisma guide](https://supabase.com/docs/guides/database/prisma) explicitly supports Session or Direct for migrations. This is sufficient for a separate Session implementation; it is not a guarantee that our full SQL3 succeeds on this live project. |
| Session and transaction boundaries | The [Supavisor terminology contract](https://supabase.com/kb/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO) dedicates a backend to a client in Session mode. PostgreSQL transactions and transactional DDL therefore retain their backend context; this is an engineering inference from that contract. [PostgreSQL advisory-lock documentation](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS) defines transaction lock release at transaction end. Existing code still uses one client and `pg_advisory_xact_lock`. |
| State/role mapping | The [connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) distinguishes Session5432 from Transaction6543, supports session state in Session mode, and documents shared routing usernames as `role.ref`. SET ROLE remains subject to actual PostgreSQL membership/privileges; no role transition was attempted in this managed diagnostic. |
| Client TLS / internal TLS | [Official SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) describes both shared-pooler legs. This does not establish the current project's enforcement state. B8 observed verified client→pooler TLS, but the own backend `pg_stat_ssl.ssl=false`. **No claim of full-path TLS or internal TLS acceptance.** No enforcement setting was changed (the provider documents restart implications). |

The general connection guide prefers Direct for migrations. The more specific official Prisma migration example explicitly permits Session as well. Transaction mode and dedicated transaction poolers remain outside this implementation; Session is not mislabeled as Direct.

## Implementation

`MigrationTarget.profile` adds **managed-session-staging** and **managed-session-live**. These labels bind intent and produce different fingerprints; neither proves the physical environment or authorizes apply. Existing `synthetic` and Direct `managed-staging` contracts and hash tuple are retained. Supplying Session binding fields on a non-Session profile now fails closed.

Every Session target requires project ref plus independently supplied primitive fields: `sessionHost`, `sessionPort`, `sessionDatabase`, `sessionUsername`, `sessionRole`. They must exactly match the parsed DSN, not be populated by parsing it inside the CLI. Shared host currently accepts only the official AWS shared-pooler naming shape; arbitrary hosts, suffix lookalikes, Direct hosts, and unrecognized providers fail closed. Host is copied from the provider, never constructed from region/ref. Port must explicitly be5432;6543 is rejected even if the separate approval field also says6543. No actual endpoint, username, secret, or project default was added to product code.

Provider username must exactly equal the explicit expected DB role plus explicit ref. The inspector returns that expected role for the existing server identity/owner/privilege checks; the runner never silently strips a suffix or trusts an unverified server role. Server `session_user` and `current_user` must both equal it, database must match, and backend port must equal the pinned5432 contract. A different real role/backend port is rejected, not substituted.

Session fingerprint includes profile, supplied host/port/database/routing username, project ref and actual expected role, excluding password. The original immutable primitive snapshot and internally owned pool remain: hash validation and connection use the same DSN; independent pool/factory injection remains forbidden. Session execution additionally requires a nonblank process-local CA. The existing B3 TLS client still verifies certificate/hostname and rejects URL query/hash SSL overrides; no TLS code or trust bypass was introduced.

CLI inputs are documented in `lib/db/postgres/README.md`: `DREAM_PG_MIGRATION_SESSION_HOST/PORT/DATABASE/USERNAME/ROLE`, existing URL/profile/ref/hash, and CA. No new CLI commands or command-line secret arguments. `fingerprint` stays offline; executable modes require the approved hash and Session CA. CA provenance/approval remains the operator's responsibility; the CLI does not fetch or trust a server-sent root automatically.

Source loading/checksum, transaction/lock SQL, role graph, history validation, rollback, disposal, published SQL and provision template are unchanged.

## Verification actually performed

| Check | Result |
| --- | --- |
| New dedicated Session tests | **35 PASS**, mocked transport explicitly labeled; no managed DDL test claim. |
| Six-file focused unit/regression run | **121 PASS**: migration sources/CLI, new Session cases, connection, request/backend selection and GET route tests. |
| Original actual PostgreSQL migration suite | **33 PASS** on a fresh owned loopback cluster: original source/atomic apply/concurrency-lock/history/role graph/target mismatch/rollback/disposal regressions. It exercises synthetic profile, not Supavisor. |
| ESLint (changed TS/test paths) | exit0, no warnings. |
| Root TypeScript `--noEmit --incremental false` | exit0 on current shared checkout. No root config edits or temporary source exclusions. |
| Diff whitespace / SQL3 raw SHA256 | clean; three published source hashes unchanged. |

Final focused command:

```powershell
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/session-migrations.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-request.test.ts tests/postgres/project-read-backend.test.ts tests/project-get-routes.test.ts
node tests/postgres/run-migrations-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-target.ts lib/db/postgres/migration-runner.ts scripts/postgres/migrate.ts tests/postgres/session-migrations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

An earlier broad path selection reported68PASS/22explicit integration skips; nonexistent selected test paths were not counted as coverage. The exact six-file run above supersedes that selection. Original33 and focused121 overlap in the old13 unit tests; counts must not be added as distinct tests. New35 profile tests were run after the final test addition. No production Next build/typegen was run because this is an offline CLI change and shared `.next` is explicitly protected.

Actual synthetic evidence: `tmp/b5-postgres-c99e8fb2-28d0-4d21-ac6a-91fb3aad94b2`, server PID24064/port56482. Stop log confirms shutdown; pidfile absent and listener count0. Cluster retained, not deleted.

SQL3 raw hashes remain:

- `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`
- `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`
- `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd`

## Managed read-only boundary

A new bounded probe used the existing authenticated provider Connect Session endpoint and independently dashboard-sourced B8 CA (fingerprint rechecked). The existing local password was selectively read in memory. A direct `pg.Client` with CA, `rejectUnauthorized:true`, SNI and default hostname verification connected successfully; no migration runner was invoked. Within `BEGIN READ ONLY`, SELECT returned only booleans:

- `session_user || '.' || explicit_ref = supplied_provider_username`: true.
- `current_user = session_user`: true.
- Actual database and backend port match the supplied connection database/port: true.
- Read-only flag: true; client TLS authorized/hostname valid: true.

Then ROLLBACK and client close succeeded. Evidence: ignored `tmp/b9-managed-01/role-safe.json` and secret-free probe source; browser task finished. No raw role/host/DSN/password was output or stored. No Auth rows, SET ROLE, advisory-lock acquisition, DDL/GRANT, apply/provision, or external settings/deployment/new resources were executed on managed service. The managed probe used a plain pg client, so it does not validate every startup parameter of the migration-owned pool.

## Independent review request / next gate

Review target field/hash completeness, environment separation, provider→actual-role verification, unchanged Direct behavior, CA requirement, and immutable target→owned pool binding; rerun negative cases and original synthetic regressions as needed. Session tests with mocked transport are not real managed migration success. Actual Supavisor DDL/SQL3 lock/concurrency/rollback/disposal/role provisioning remain untested. Direct still requires IPv6; live Auth target remains live/unclassified for staging purposes. Master must separately decide exact approved environment, internal transport acceptance and subsequent read-only/apply scope after independent review.

Transfer text: **B9 ready_review. Explicit managed-session-staging/live profiles bind independently supplied host/port/db/provider username/ref/expected actual role and hash; Session5432 only, mandatory CA, original Direct guards and owned pool unchanged. New35/focused121/local actual33 pass, lint/tsc0, SQL3hash unchanged. Real managed check only verified TLS+READ ONLY role/ref/db/backend-port booleans; no managed runner/DDL/lock/apply/provision. Internal backend SSL=false remains open; request fixed-SHA independent review. Operational1.1 received/read; shared docs/WIP protected.**
