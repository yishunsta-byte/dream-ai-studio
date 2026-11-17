# B7 — Managed environment read-only check

- Date: 2026-11-17 KST
- Author: Codex(Backend)
- Assignment: Master `msg_e8dde6b769a7`, resumed under `msg_71449df87aed`; B5-R2 acceptance notice `msg_c5c3b65e0bdc`.
- Result: **environment metadata partially confirmed; managed PostgreSQL connection and preflight NOT established**.
- Accepted migration baseline: `52ea968e41e2224c8febae5571c5871086f9126c`. No migration runner or migration SQL was executed or changed during B7.

## Confirmed observations

| Surface | Observed | Limit |
| --- | --- | --- |
| Local connection configuration | Selective key parsing found `SUPABASE_DB_PASSWORD` and the expected public Supabase URL. No database DSN, migration URL/CA, or PG host/user/database configuration was present among the allowed keys. | Presence does not validate password correctness or authorize a target as staging. Values were never printed or persisted by probes. |
| GitHub | Existing `gh` authentication succeeded; metadata for `yishunsta-byte/dream-ai-studio` was readable and identified a public repository. | No deployment permission, environment policy, or organization administrator claim. |
| Supabase | Existing browser login opened project `dream-ai-studio`, ref `osvjfyjlbixmvnjkxdry`. Its Connect dialog supplied both Direct and Session pooler endpoints matching that ref. | Current organization ownership, administrator role, and staging designation remain unverified. |
| Vercel | Existing browser login opened the `dream-ai-studio` project; `dream-ai-studio-orpin.vercel.app` and Production/Preview labels were visible. | Git repository association, environment variable contents, role/ownership, and staging mapping were not independently established. No configuration or deployment was changed. |
| CLI availability | `gh` installed; Supabase and Vercel CLIs absent in the checked shell. | Browser observations above used existing sessions. |

The public Supabase ref identifies the existing live-auth project previously reported by Master/Front. That history does **not** establish a separate staging database. Prior reports of organization `star`, region Seoul, compute size, and API/RLS settings were not independently revalidated here.

## Actual connection attempts

Endpoints were read from the authenticated provider Connect UI, held only in process memory, and never constructed from a project ref. The existing local password was selectively read into memory. `pg.Client` received explicit host/port/database/user/password fields and `ssl: { rejectUnauthorized: true }`; no URI SSL override, trust bypass, or guessed fallback was used. No credentials or endpoint values were written into scripts, reports, logs, command arguments, or result artifacts.

| Provider-supplied target | Target fingerprint¹ | Outcome |
| --- | --- | --- |
| Direct | `0ad1a2d0b6016a58192a68542a1dde30a87887f1307329c50b45381d5c89a462` | `getaddrinfo` failed with `ENOENT`; no PostgreSQL connection. |
| Session pooler | `b857268ff00d94f5bc9432f78c322a1de253f3835a62c6a80e3f9c8c44c9df23` | TLS certificate-chain verification failed with `SELF_SIGNED_CERT_IN_CHAIN`; no PostgreSQL connection. |

¹ SHA-256 of the provider-supplied host, port, database path, and username tuple; excludes password. Fingerprints document distinct supplied targets without exposing connection parameters.

The probe was prepared to start `BEGIN READ ONLY` and query only catalog/current-session metadata after successful connection. **Neither attempt reached that transaction or any SELECT.** Clients were closed. Password validity, database reachability beyond these failure stages, server TLS identity, and PostgreSQL authentication therefore remain unverified. The certificate failure alone does not establish whether its source is provider chain configuration or local network trust.

## Unverified prerequisites and next decision

- Exact approved environment classification and owner/admin authority, including whether any isolated staging target exists.
- Direct endpoint DNS/network support, or a validated trust chain/CA for the actually supplied pooler endpoint. No certificate was installed and no TLS validation was disabled.
- Database/current-role CREATE, CREATEROLE, superuser status; `auth.users` UUID/unique/not-null/reference prerequisites; dream schema, migration history, reserved roles and membership graph.
- Pooler session behavior, TLS-authorized PostgreSQL session, and target-bound migration profile. No managed dry-run/apply readiness claim follows from local B5/B5-R2 acceptance.

Master must determine the next exact target and authorized execution scope from these results. Any credential or CA provision should use the existing secure environment mechanism, never plaintext chat. No new resource, paid service, account, Auth user/mail, GRANT, DDL, migration, deployment, or external setting was created or changed.

## Evidence and workspace boundary

Ignored local directory: `tmp/b7-managed-01/`. Safe result artifacts: `local-safe.json`, `direct-provider-safe.json`, `direct-safe.json`, `provider-safe.json`, `db-safe.json`, and `vercel-safe.json`. Probe scripts contain no connection values or secrets. Error reporting retained only whitelisted codes/stages, without messages, stacks, or raw auth output. Browser task space was finished and agent pages closed.

Only this report is a tracked B7 change. Concurrent Auth/session work and other handoffs were left untouched. Documentation-only delivery requires no product test run; evidence consists of the observed provider UI metadata and bounded failed connection attempts described above.
