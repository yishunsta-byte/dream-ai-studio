# B10 — Current SSL enforcement and environment

- Task/owner: B10 / Codex(Backend); Master assignment `msg_dbb5b65e7002`.
- Status: **ready_review — read-only assessment complete; no operational change**.
- Last dashboard observation: **2026-11-17 20:19:45 KST / 11:19:45 UTC**. Browser finished20:19:52 KST.
- Shared HEAD before report: `7fac6304d1d77afd2efba71a5c24a640613d5894`. B9 implementation `0d85186` and migration files left untouched during independent review.

## Actually observed

Authenticated official dashboard pages read: project Database Settings, Project Settings → General, and Connect → PostgreSQL connection metadata. Public project ref **osvjfyjlbixmvnjkxdry**, name **dream-ai-studio**; route and project name match. No Auth user listing/content, credentials, or account identity was exposed in outputs.

| Item | Current UI observation | Interpretation limit |
| --- | --- | --- |
| Environment/branch | Semantic dashboard header displays **main / PRODUCTION**. No STAGING badge found in that view. | This is provider UI metadata. Together with known live Auth use, treat this as the existing production target; never relabel it staging. It does not inventory every branch or prove traffic/user counts. |
| SSL enforcement | Label **Enforce SSL on incoming connections**; its associated switch has `aria-checked=false`, `data-state=unchecked`. | Current displayed setting is **off**. Initial hydration had not rendered the control; the recorded result is the later fully rendered associated control. No toggle/save occurred. |
| Control availability | Associated switch is not disabled; Database Settings and General are readable. | UI availability does not establish an Owner/Admin role or permission to perform this operational change. |
| Connection choices | Direct connection, Session pooler, Transaction pooler are offered. Connect display currently shows shared Session pooler5432; supplied routing identity matches the ref. | This is a remembered Connect display selection, not a global database mode switch. No connection mode was configured or changed. |
| Platform account role/ownership | No explicit current-account Owner/Admin/Developer role label found in the inspected views. Organization navigation link exists. | **Platform role, organization ownership and project authorization boundary remain unverified.** No member list or account identity was collected; enabled controls are not substituted as evidence. |

The General page's visible text did not repeat the ref during inspection; the exact route and Connect metadata matched it. Production status is based on the semantic dashboard header, not a guessed project name or Vercel label.

DB operator evidence is from **B8/B9**, not a new B10 SQL session: actual `current_user=session_user`; superuser=false, CREATEROLE=true, database CREATE=true, auth schema USAGE and auth.users REFERENCES=true; provider `role.ref` mapping/database/backend port matched. No raw DB role was printed. These DB privileges do not prove Supabase platform Owner/Admin or authority over organization resources. Dream/history/reserved runtime roles were absent in B8; this does not mean the whole production database is empty. No B10 database connection or migration runner was executed.

## Official SSL contract versus this project

Official source checked today: [Supabase Postgres SSL Enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), updated2026-11-16. It states enforcement applies to Direct/shared/dedicated pooler, covers both shared-pooler legs, requires a DB reboot when updated, and leaves HTTP API TLS in place. Its timing descriptions vary from seconds to minutes; do not promise a fixed interruption. It documents enable/disable operations and requires Owner/Admin for its CLI workflow. Client CA/hostname verification remains separate from server-side enforcement.

B8 actually observed verified **client→Session pooler TLS1.3**, authorized=true and hostnameValid=true with the official dashboard CA. Own backend `pg_stat_ssl` returned one row with **ssl=false**. Today's enforcement-off display is consistent with that finding. It does not independently establish every provider internal-network property, and client TLS must never be reported as full-path TLS.

The concrete candidate change to address this gap is **enable this project's Enforce SSL on incoming connections setting**, followed by reconnecting and verifying both client authorization/hostname and the own backend `pg_stat_ssl.ssl=true`. According to the official contract, enforcement governs pooler→DB as well as client→pooler. We have not performed the change or observed the resulting internal session. No provider-private-network encryption assumption replaces that post-change measurement.

## Operational impact and compatibility

| Area | Expected implication / what remains unknown |
| --- | --- |
| Restart | Provider says changing enforcement restarts the database. Existing DB sessions may disconnect; transactions may abort or have an uncertain completion response. Plan an interruption on the order of minutes rather than guaranteeing uninterrupted access. Actual duration here is unknown. |
| Existing Auth/API | HTTP endpoints continue to require HTTPS; this is not an API TLS, Auth URL, user, password, or key change. **Inference:** DB-dependent login/token refresh/API/storage operations may temporarily fail while the database restarts/reconnects. No live Auth traffic or users were queried to measure impact. |
| SQL clients | Non-TLS clients can be rejected after enabling. B8/B9's client verified the current CA/hostname, but that proves only those probes. Actual deployed connection pools, tooling, runtime logins, and startup options were not inventoried. No claim that every client is compatible. |
| Existing CA | Official Database Settings CA SHA256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid2021-04-28→2031-04-26 (B8 provenance/signature/chain checks). Existing probes used it process-locally with hostname verification. Enforcement is not evidence of a CA rotation; recheck the actual presented chain afterward. Do not install global trust or disable validation. |
| Direct path | IPv6 `ENETUNREACH` from B8 is independent of SSL enforcement. Enabling it will not create a Direct network path. Session remains the observed reachable mode; B9 support still needs independent review and separate execution scope. |

Recommended compatibility level is CA **and hostname** verification (libpq verify-full equivalent; Node rejectUnauthorized=true plus hostname validation). Merely encrypting without verifying identity is insufficient for the existing client contract. A server enforcement toggle does not configure remote client trust automatically.

## Reversal scope and recommendation for Master

Provider supports disabling enforcement again, but **updating it also restarts the database**. Reversal restores acceptance policy for compatible/non-TLS clients; it does not recover dropped sessions, resume interrupted transactions, undo already committed writes, or guarantee zero downtime. If a write loses its commit response, inspect its known state before retrying; this B10 task performed no writes. Keep client CA/hostname verification enabled when reverting the server policy. No data restore, certificate rotation, account change, or resource purchase is implied by reversal.

Recommended next scope, for Master to assess against existing authorization:

1. Confirm the designated operator's actual platform Owner/Admin scope and the exact **production** target. DB CREATEROLE and a visible switch do not establish it.
2. Reconcile existing backend setup authorization with the specific production DB-restart/temporary Auth-access impact. This is an operational effect to account for, **not a new automatic user-approval flow created by B10**; Master uses the existing approval record and authority.
3. If change is assigned, preserve the current off-state record, choose an acceptable interruption window, confirm affected clients use verified TLS and have the official CA, and identify reconnection/abort handling. B9 independent acceptance remains distinct from enabling SSL.
4. Perform only the assigned enforcement change, allow provider restart, and verify displayed enforcement, verified client TLS, backend SSL=true, and bounded service health without inspecting user content. If compatibility fails, consider the documented disable operation with its second restart and policy regression explicitly understood.

B10 has not toggled or saved anything, restarted a service, changed environment/network/CA stores, queried Auth rows, executed managed runner/lock/SET ROLE/DDL/GRANT/apply/provision, deployed, sent mail, or created resources. Current authorization for this task was read-only; future action belongs to Master's separately assigned scope.

## Evidence and transfer

Ignored secret-free probes and safe observations: `tmp/b10-managed-01/ssl-safe.json` (early loading state), `controls-safe.json` (rendered switch association), `environment-safe.json` (branch/production/ref/settings), `mode-safe.json` (offered/selected display mode). No DSN, DB host, account identity, password, or token persisted. Browser closed. Only this report is tracked; no product test needed for a read-only documentation deliverable. B9 code/SQL/package/shared WIP untouched.

Transfer: **B10 ready_review. Current exact project main/PRODUCTION, enforcement OFF (associated switch aria=false/unchecked), Connect Session5432 offered/displayed; platform self-role/ownership not shown and remains unverified. B8 DB privileges do not prove platform Owner/Admin. Official enforcement controls both pooler legs but requires DB restart; client TLS=true/backendSSL=false kept distinct. Recommend Master resolve exact operator/production interruption scope and client compatibility, then separately assign enable+post-check or reversal; no setting/runner/DDL/apply performed. Last actual observation2026-11-17 20:19:45 KST.**
