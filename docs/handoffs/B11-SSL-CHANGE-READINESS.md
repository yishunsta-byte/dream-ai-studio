# B11 — SSL change preparation only

- Owner/task: Codex(Backend) / B11; Master `msg_9a9d931af32e`.
- Status: **ready_review — baseline and execution plan prepared; change not executed**.
- DEC-SSL-01 remains pending per latest Master `msg_e4add5ea5a6f`. Only a separate explicit Master execution instruction can authorize the next operational action; silence/time passing is not approval.
- B9 fixed `0d85186` local-contract independent PASS acknowledged; this does not accept managed DDL/locks/provision or full transport. B9 files unchanged.
- Last actual baseline: **2026-11-17 20:25:38–20:25:43 KST** (11:25:38–11:25:43 UTC); browser finished after this observation. Pre-report shared HEAD `947d30094e6468122cd046e6ae36dd579975e48f`.

## Platform scope: newly confirmed current-account role

From the existing project dashboard's organization link, navigated to that organization's **Team** page. Only the row marked **You** was inspected for role/scope labels. Exactly one such row was found; role **Owner**. No names, email addresses, member identities, invitations, or other members' roles were collected or output.

Then returned to the exact project's Database Settings and verified its organization navigation matched the same organization as the Owner view. This ties the observed organization role to project **dream-ai-studio**, public ref **osvjfyjlbixmvnjkxdry**. The own row did not separately display an all-projects/selected-projects scope label.

The official [Access Control contract](https://supabase.com/docs/guides/platform/access-control) gives an organization Owner access to organization/project resources and applies organization-level permissions to its projects. This provides platform-role evidence that was absent in B10; it is not a successful write-permission test, legal ownership verification, or authorization to bypass DEC-SSL-01. No member-management action was performed. General/project settings alone were not used to infer the role.

## Before-change baseline actually measured

| Surface | Result | What it proves / limit |
| --- | --- | --- |
| Project enforcement | Associated **Enforce SSL on incoming connections** switch `aria-checked=false`. | Still OFF; untouched. Project's main/PRODUCTION designation is B10 evidence; no staging relabeling. |
| Public web login | `https://dream-ai-studio-orpin.vercel.app/login`: HTTP200, HTML. | Public login route reachable. No login, user session, or complete application health claim. |
| Public Auth health, no key | `https://osvjfyjlbixmvnjkxdry.supabase.co/auth/v1/health`: HTTP401. | Expected baseline for an unkeyed gateway request; does not prove Auth down or healthy. |
| Auth health, existing public client key | Same endpoint: HTTP200; response's service-name marker recognized as GoTrue. | Health endpoint responds through existing public-client API-key access. No user JWT/cookie/service-role key, login, email, account creation, or Auth user content used. |
| Database Session pooler | Existing provider Connect Session endpoint; connected and closed successfully. | No Direct connectivity claim; no managed runner invoked. |
| Client TLS | TLS1.3; authorized=true; hostnameValid=true. | Client→pooler verification established; no validation bypass. |
| Catalog-only transaction | `BEGIN READ ONLY`; role.ref mapping/current role/database/backend port match=true; read_only=true; ROLLBACK succeeded. | No user/product rows, writes, SET ROLE, or lock acquisition. |
| Actual backend TLS | Own `pg_stat_ssl` row count1; ssl=false. | Internal backend leg remains the unresolved gap despite verified frontend TLS. |
| CA readiness | Existing official dashboard CA file present, CA=true, currently valid, expected fingerprint matches. | Process-local trust ready for this probe. No global installation or assumption about all deployed clients. |

CA SHA256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`; official dashboard provenance/chain/signature recorded in B8. Valid until2031-04-26; validity and fingerprint were rechecked today. Local public CA artifact `tmp/b8-managed-01/provider-root.crt` is ignored. Credentials and existing public client key were selectively read into memory only; values/headers/body/DSN/DB host/account identity were never output or persisted. Public health probes used no session cookies. Only safe status/boolean results were retained.

## Concrete future execution sequence — not run

The source for policy/restart/reversal is [official SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), already checked in B10: shared-pooler enforcement affects both legs; updates reboot the DB; CA/hostname validation is a separate client requirement. This plan does not change that policy or the existing authorization process.

1. **Receive explicit execution scope from Master after DEC-SSL-01.** Confirm exact production ref, desired OFF→ON change, accepted interruption and rollback scope. Re-read current state to avoid a duplicate toggle if another authorized operator acted. Do not execute B9 migration/apply/provision as part of SSL work.
2. **Capture a fresh pre-change comparison** using the same bounded public GET health checks and a new verified-CA read-only Session connection. Record only timestamps, statuses, frontend TLS booleans, own backend SSL, identity-match booleans and current displayed enforcement. Dispose the probe connection before the restart. No persistent watch/poll process.
3. **Perform the one assigned dashboard enforcement change.** The switch was never touched during B11, so a final confirmation/save dialog and its current wording were not inspected. Future executor must read it before committing and stay within the assigned change. Do not modify CA, roles, network, Auth, resources or deployment alongside it. Record actual submit time/provider receipt; a dispatched click is not completion.
4. **Allow the provider's database restart.** Existing sessions can disconnect; no production transaction was opened by this plan. Assess displayed provider state after the action. Use bounded follow-up observations during that assigned turn, report progress/delay, and stop for provider error/unresponsive state rather than repeated toggles or blind restart. No fixed zero-downtime promise; B10 records timing uncertainty.
5. **Reconnect with a new client**, using the provider-supplied Session target and same explicit trusted CA, SNI, `rejectUnauthorized:true` and normal hostname verification. Never reuse the pre-restart socket. Verify authorized/hostname match and actual role.ref/database/backend-port binding before catalog reads. Do not substitute a different endpoint, password, role or untrusted CA on failure.
6. **Measure the internal hop explicitly** in `BEGIN READ ONLY`, then ROLLBACK and close. The minimal safe SQL is:

   ```sql
   SELECT current_setting('transaction_read_only')='on' AS read_only,
          current_user=session_user AS unchanged_role;
   SELECT count(*)::int AS own_backend_ssl_rows,
          bool_and(ssl) AS own_backend_ssl
   FROM pg_stat_ssl WHERE pid=pg_backend_pid();
   ```

   Success requires exactly one own backend row and **own_backend_ssl=true**, in addition to verified client TLS. Bind role/ref/database/port using the existing safe parameterized probe; never print raw role or connection parameters. A missing row/NULL or false is not a TLS pass.
7. **Compare post-change public surfaces**: login HTTP200/HTML and keyed Auth health HTTP200/GoTrue marker; preserve expected unauthenticated401 as a separate gateway observation. These checks do not exercise a user's login/token refresh or all dependent services. Broader session validation belongs to separately authorized testing, without user-content collection.
8. **Report measured outcome to Master** with displayed ON state, restart/health timing, new-connection TLS and backendSSL result, and residual client compatibility limits. No schema/role/history change is required for this verification. Finish browser/client resources and stop after this assigned operation.

## Failure / recovery decision table

| Observation | Required interpretation and bounded response |
| --- | --- |
| Display ON, client verified, backendSSL=true, same baseline health | SSL objective measured for the checked connection and health surfaces. Not a general runtime/migration acceptance. |
| Display ON, backendSSL=false or no own TLS row | Objective not met. Preserve safe evidence, report provider/internal transport uncertainty. Do not mark full-path TLS, change profiles, or repeatedly toggle. |
| TLS CA/hostname failure | Record safe error code/stage. Keep verification enabled and compare approved CA/actual provider identity via official source. No arbitrary root trust or password transmission over an unverified TLS connection. |
| DNS/network failure | Separate from enforcement. Do not infer certificate or password failure, enable IPv6 globally, or guess replacement hosts. |
| DB authentication/role mapping failure | No automatic password reset/role changes. Report safe code; preserve exact approved target and distinguish authentication from transport. |
| Public web200 but keyed Auth health fails | Web page availability does not prove Auth availability. Report independently; avoid login/mail/user-data probes outside scope. |
| Transient reboot disconnects or provider still restarting | Preserve timestamps; bounded status observation and Master report. No additional restart because elapsed time alone is not evidence of failure. |
| Persistent compatibility failure after restart, rollback in execution scope | Re-read actual setting first. If ON and rollback is selected within that scope, disable only enforcement once; it entails a **second DB restart** and acceptance of non-TLS policy again. Reconnect/compare baseline afterward; retain verified client CA/hostname settings. |
| Completion/submit state ambiguous | Inspect current provider state before another action. Do not assume success, rollback or lack of effect. |

Disabling enforcement does not resurrect dropped sessions, resume aborted transactions, or reverse committed writes. A lost commit response requires state reconciliation before retry; this preparation and planned health check perform no application writes. Reversal can restore compatibility policy but cannot erase its outage or prove other clients healthy.

## Remaining limits and transfer

**Unknown:** compatibility and reconnection behavior of every deployed SQL client/runtime pool/tool; complete Auth login/refresh flow under restart; actual restart duration; post-change backendSSL; provider's final action dialog; managed B9 runner startup/DDL/lock/provision behavior. Existing B8/B9/B11 probes do not establish those facts. No inference that all clients are ready because the public web route or one verified pg client worked.

Ignored evidence: `tmp/b11-managed-01/platform-safe.json`, `baseline-safe.json`, secret-free probe sources. Own-row role evidence and project-organization match are booleans/enums only. Early `teamLinkObserved=false` snapshot diagnostic reflects its text-matching expression, not a missing link; the subsequent accessible Team link action succeeded and own-row marker was observed. Browser task finished; read-only client rolled back/closed. Only this report is a tracked B11 change; shared docs/B9 code/other WIP untouched. No toggle/save/restart/env/network/DDL/GRANT/runnerapply/provision/mail/deployment/resource action occurred. No product test run needed for a preparation-only report.

Transfer: **B11 ready_review; DEC-SSL-01 pending, no operational change. Current You-row Owner confirmed in project's matching organization. Baseline20:25:43KST: SSL OFF, public web/login200, unkeyed Auth health401/keyed public-client health200 GoTrue, verified Session TLS1.3 and READ ONLY identity checks true, own backendSSL=false. Official CA ready. Detailed one-change/reconnect/backendSSL=true/health/reversal-with-second-restart plan supplied; unknown client compatibility remains unknown. B9 independent local PASS acknowledged without managed acceptance; await Master's separate execution instruction.**
