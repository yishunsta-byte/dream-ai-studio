# B28 — Owned full-schema native syntax and privilege verification

Status: **author native PASS for this bounded scope; independent review pending**. Master assignment `msg_3c7f8d9c333d`, receipt `msg_2e06dadca96c`; final-return boundary confirmed by `msg_7d26c983006a`. No production/managed/shared database, registry, API/runtime or deployment approval is implied. Only `tests/b28-schema5-native-owned.ts` and this report are added.

## Frozen source and exact derivation

| Artifact | Fixed evidence |
| --- | --- |
| SQL5 source | B27-FIX `fbfc48c95264eaf37826f943b5e35e9fe67fa616`, source-only review accepted by Master after B27-R2 `b229f78` |
| Original LF SHA256 | `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| Owned derived LF SHA256 | `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` |
| Runner LF SHA256 | `974977933d03faaf93d668bfe29d86a7116869ff4c656925c295201fad5d6f45` |
| Engine | Existing EnterpriseDB-signed portable PostgreSQL **18.7**, x86_64-windows / msvc-19.44.35229; Node **26.13.0** |

The runner verifies the original hash **before starting a cluster**, verifies exactly one occurrence of the known fuse, and removes **only its 87-character statement at character offset252** in an owned scratch copy. The newline remains, preserving source line numbers. Reinsert-at-offset reconstruction must reproduce the original exactly. No other source substitution or expected-result relaxation occurs.

```diff
--- fixed-fbfc48c.sql
+++ B28-owned-derived.sql
@@ -5 +5 @@
-DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;
+
```

Original repository SQL5 retains its unconditional fuse and its fixed hash. SQL1–4 are hash-verified before use:

| Source | Accepted LF SHA256 |
| --- | --- |
| `0001_schema.sql` | `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19` |
| `0002_invariants.sql` | `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100` |
| `0003_rls.sql` | `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` |
| `0004_storage_verification.sql` | `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c` |

## Execution and isolation

```powershell
node --import tsx tests/b28-schema5-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Actual run: **exit0**, nine recorded result groups. Evidence root: `D:/starwork/dream-ai-studio/tmp/b28-native-aa505a16-8ac3-4d77-8cbf-8be154db44a7`. The runner verified Authenticode signatures for postgres/initdb/pg_ctl and the 18.7 version, initialized a new UTF8/C-locale SCRAM cluster, and verified the single loopback listener against its new postmaster PID. No OS service, install, global PATH change or pre-existing cluster was used.

Cluster PID **21208**, address **127.0.0.1**, random free port **49882**. Each case gets a fresh `b28_fixture` database and applies full SQL1–4 as the actual **non-superuser LOGIN CREATEROLE** `b28_migration`, which owns its synthetic Auth stub and schema. The candidate SQL5 runs as that same login. After each case, its connections/database and cluster-global candidate/API/worker roles are removed before the next case, preventing cross-case schema/default contamination. All of this is inside the one newly owned cluster.

No `.env`, external DSN or real credential is read. PG ambient variables are discarded in this runner process; database clients receive explicit loopback fields and new synthetic secrets only. The generated local password file is not reproduced in this report or committed. Application/signer/provider credentials are never used.

## Native result groups

| Group | Actual observation |
| --- | --- |
| 1 Original fuse | Full original SQL5 was submitted before derivation execution. First error was **P0001 / B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED**. ROLLBACK left new role and namespace absent. |
| 2 Full SQL1–5 positive | Derived source compiled/executed and COMMIT succeeded under non-superuser migration login. Native inventory accepted exact namespace ACL4, selected ADMIN edge1, two definer signatures/settings/ACLs, revoked temporary SET/schema CREATE, required read/insert/lock grants and FORCE-RLS delta. Committed counts: **32 business tables / 2 new SECURITY DEFINER functions**. |
| 3 Restricted fresh/deferred | A separate restricted LOGIN sets local dream_api/actor in one dedicated transaction, obtains a seed, submits a B25-encoded envelope, receives staged/commitConfirmed=false/issuanceAuthorized=false, then confirms COMMIT. Exactly **one object + one intent + one request ledger** persist; native fingerprint/raw SHA equal actual B25 codec outputs. Full original SQL4 guards remain active. A diagnostic deferred witness observes issuer current_user and restricted session_user after definer return. |
| 4 Default schema CREATE | Unrelated login's creator default CREATE grant survives named REVOKEs; final inventory throws **P0001 / B27_SCHEMA_ACL**. Candidate transaction rolls back. |
| 5 Default schema USAGE | Separate default USAGE-only setup, same exact rejection and rollback. Defaults are not changed to make a positive pass. |
| 6 Grant option | Inject API USAGE WITH GRANT OPTION before inventory; exact schema ACL rejection and rollback. |
| 7 Missing fact | Remove API USAGE before inventory; exact schema ACL rejection and rollback. |
| 8 Wrong owner | Transfer candidate namespace to a separately provisioned synthetic role with the required local fixture permissions; **P0001 / B27_SCHEMA_OWNER**, rollback. |
| 9 Grantor chain | An authorized synthetic grantor chain adds API USAGE from another grantor and an extra grantee. Schema ACL rejection and rollback. This fixture is **coupled** (wrong grantor plus extra grantee), not isolated grantor-only proof. |

Every ACL-negative result checks new role absent, namespace absent, added intent UNIQUE absent and no dangling roleid membership after ROLLBACK. The prefix had already removed its temporary SET/schema CREATE before the injected inventory failures; native pre-inventory facts show only the selected automatic ADMIN edge. These cases prove cleanup and rollback at that boundary, not fault injection at every earlier transient-grant step. No unexpected source/native failure occurred and no SQL source was patched to obtain a pass.

## Native principal and catalog facts

Positive fixture native IDs (not role-name marker identities):

| Principal/object | Native OID / observation |
| --- | --- |
| Migration login M | **16389**, current_user=session_user=b28_migration, nonsuperuser; actual createrole_self_grant empty |
| Trusted bootstrap grantor | **10** |
| Existing API A | **17116** |
| Issuer R | **17737** |
| New namespace | **17739**, owner **16389** |
| Restricted native runtime fixture login | **17838** |

Namespace expanded facts are exactly `(M,M,CREATE,false)`, `(M,M,USAGE,false)`, `(A,M,USAGE,false)`, `(R,M,USAGE,false)`. Native owner ACL grant-option bits are false, consistent with the closed allowlist. Final issuer membership is exactly roleid17737/member16389/grantor10/admin=true/inherit=false/set=false. The approved management ADMIN can reacquire SET; this does not make that credential suitable for runtime. Runtime used the distinct restricted login17838, not migration/bootstrap credentials.

Deferred observation: **B28_EVENT role=17737 session=17838** after the entry returns and COMMIT runs. The extra witness is an INVOKER AFTER INSERT / INITIALLY DEFERRED trigger that emits a NOTICE and returns NULL; it does not modify NEW, read/write application data, bypass RLS or change any original SQL4 trigger. It is created only as a clearly synthetic observation fixture **after** positive SQL5 catalog acceptance. Its PUBLIC EXECUTE is revoked. Passing fresh COMMIT with original consistency guards active supplies the minimum full-SQL4+5 pristine dependency evidence; it does not cover evolved registration/receipt/cleanup branches.

Synthetic seed setup uses the local bootstrap only to create Auth rows and immutable policy facts, with explicitly synthetic byte/TTL/issue values. It is not a policy-administration implementation or production recommendation. Runtime reservation itself uses only the separate restricted login. No real Auth getUser/VerifiedActor or B3 adapter is exercised.

## Injection and evidence boundaries

The saved derived SQL is an exact fuse-only copy. To permit local negative fixtures, the runner executes its unchanged prefix before `DO $inventory$`, injects the explicitly named fixture SQL, then executes the unchanged suffix through COMMIT; prefix+suffix equality with the saved derived copy is asserted. Default CREATE/USAGE setup is pre-existing fixture state in that case's fresh database. Grant-option/missing-fact/owner/grantor setup occurs within the candidate transaction before inventory. Expected inventory expressions are never edited, skipped or weakened. Wrong-owner/grantor cases receive only the additional local fixture ownership/SET grants required to create those negative facts; they are not additional production permissions.

Evidence retained under the owned root:

* `derivation.json`, `sql5-original.sql`, `sql5-fuse-only-derived.sql`, `fuse-only.diff`: fixed IDs/hashes and exact derivation.
* `ownership.json`, `run.json`, `principals.json`, `signatures.log`, `version.log`, `listener.log`: owned identity, engine and listener proof.
* `positive-catalog.json`, `checks.json`: native OIDs/expanded ACLs/selected ADMIN row/counts, original fuse error, fresh hashes/commit/witness, six rejection errors and rollback facts.
* `stop.log`, `stopped-listener.log`, `cleanup-safe.json`: shutdown proof. No source-failure file was produced because there was no unexpected native failure.

Observation correction: while output was pending, I initially described it as a Windows handle issue. The completed process/evidence showed a normal successful run **without any such workaround or rerun**. A subsequent redundant stop attempt found the already-removed PID file and returned no-running-server; it changed no running service. The runner's own successful stop and cleanup records are the authoritative shutdown evidence.

## Checks, cleanup and remaining work

Focused checks passed before execution:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck tests/b28-schema5-native-owned.ts
node node_modules/eslint/bin/eslint.js tests/b28-schema5-native-owned.ts --max-warnings 0
```

Initial tooling-only issues (TS6 requires --ignoreConfig with explicit files; four harness lint findings) were corrected before native execution. They were not SQL failures and no SQL expectation changed. Selected diff whitespace check passed. Original SQL5 remains byte-equivalent after LF normalization to fbfc48c; protected sources/model/B25/package/registry/runtime are unchanged.

`cleanup-safe.json`: **postmasterPidAbsent=true, listenerAbsent=true, completed=true** for PID21208/port49882. Owned data/logs remain for independent inspection; no existing service/cluster was stopped or removed. No new agent, window or worktree was created.

Still unverified: two-connection same/different payload races and rollback waiters; lock-omission/zero-row/UPDATE-denial exhaustive matrix; all 60 UUID vectors through native SQL; full canonical/raw/epoch/timezone boundary parity; isolated grantor-only and every missing-fact ACL combination; faults at each temporary-ownership phase; evolved/expired replay; B3/Auth integration, real lost-COMMIT response, outcome/pool hygiene; every actual deployment major. Policy provenance/operating values/budgets, complete version5 descriptor/registry/provisioning, provider/Storage/API/runtime/managed deployment and paid operations remain separately assigned prerequisites. No broad test or operational readiness claim follows from these nine groups.

Return: fixed two-file author result for Tester independent review. Native scope is full local syntax/selected privilege inventory/ACL-rejection atomicity plus minimum fresh deferred behavior, not a production reservation service acceptance.
