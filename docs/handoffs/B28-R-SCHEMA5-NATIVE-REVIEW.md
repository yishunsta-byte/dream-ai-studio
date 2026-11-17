# B28-R — Independent owned SQL5 native review

**Verdict: PASS for the assigned nine-group local PostgreSQL 18.7 scope.** Independently reproduced the frozen runner once, exit 0, and inspected its source, exact derivation, native evidence and cleanup. No mandatory defect found in this bounded result. This is not full protocol, registry, managed migration, API/runtime or deployment acceptance; Master retains final acceptance authority.

Reviewer: Codex(Tester), separate from Backend author. Master assignment `msg_a1faacf8a2b4`, acceptance receipt `msg_49409eb67655`. Execution/review date: 2026-11-18, Asia/Seoul. Only this report is edited in the repository.

## Fixed identity and actual execution

| Artifact | Independently verified evidence |
| --- | --- |
| Author fixed commit | `ac7272f7bbf949d57b9d345ad6ee0e0b7b89f841` |
| Runner | `tests/b28-schema5-native-owned.ts`, LF SHA256 `974977933d03faaf93d668bfe29d86a7116869ff4c656925c295201fad5d6f45` |
| Full author handoff | `docs/handoffs/B28-SCHEMA5-NATIVE-PRIVILEGE.md` at ac7272f, read in full |
| Original SQL5 | fbfc48c95264eaf37826f943b5e35e9fe67fa616; LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| Derived SQL5 | LF SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` |
| Engine | Existing `.tools/b3-postgres-18.7/pgsql/bin`; PostgreSQL 18.7, x86_64-windows/msvc-19.44.35229; postgres/initdb/pg_ctl each Valid EnterpriseDB Authenticode signature |
| JS runtime | Node v26.13.0; installed pg 8.23.1, tsx 4.23.15, Zod 4.6.7 |
| Tester's owned evidence root | `D:/starwork/dream-ai-studio/tmp/b28-native-2c1dd48b-0f84-4c8e-987f-9e4d99e5be97` |
| Separate review scratch | `D:/starwork/b28r-review-ac7272f` |
| Owned listener | `127.0.0.1:54708`, postmaster PID **78984**; independently verified directory/port/PID and loopback address |

Before execution, compared current runner, all `lib/db/postgres`, upload model, package and lockfile with ac7272f: no differences. Recalculated fixed runner/SQL5 hashes before starting. Used the unchanged current runner with its exact expected existing binary directory; no path-check bypass, copied runner workaround, worktree or archive was needed. Recorded package/lock hashes and recursively hashed the installed pg/tsx/Zod dependency packages (18 installed packages, 1,018 files). Dependency manifest is `installed-dependency-hashes.json` in review scratch, SHA256 `8932ae815952cb474f18702569078807bccdaa877602930016a47620fad776d5`. No installation or dependency edit occurred.

Command, from repository root:

```powershell
node --import tsx tests/b28-schema5-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Output was retained as `D:/starwork/b28r-review-ac7272f/run.log`. Actual process exit **0**, `9 recorded results`, `stopped=true`. This is a new Tester-owned cluster and fresh per-case databases, not inspection of the author's old run or a shared DB. Initialization was UTF8/C with SCRAM and new synthetic credentials. The runner used explicit loopback connection fields, discarded PG ambient defaults and did not read application env files/DSNs. Synthetic password contents were neither read out nor included in this report.

## Source and derivation audit

The runner hash-checks all original SQL1–4 sources before startup:

| Source | LF SHA256 |
| --- | --- |
| 0001_schema.sql | `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19` |
| 0002_invariants.sql | `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100` |
| 0003_rls.sql | `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d` |
| 0004_storage_verification.sql | `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c` |

Independently compared the retained original with the fixed git blob and verified `derived == original.replace(exactFuse, '', 1)`. Exactly one known 87-character fuse statement is removed at character offset 252; reinsertion reconstructs the original. Both files retain 543 lines and all other bytes after LF normalization. The repository original retains its fuse/hash. This removal is authorized only for this owned B28-R run, not a source correction or permission for another target.

The derived SQL is split at its original `DO $inventory$`; unchanged prefix plus unchanged suffix equals the complete derivative. Positive execution includes the suffix through COMMIT. Negative cases inject only the named local fixture changes between these segments, or creator default grants before the candidate transaction. Inventory expressions and expected errors are not relaxed. Wrong-owner/grantor fixture permissions are additional local setup, outside the candidate SQL, and are not production privilege proposals. No existing SQL4 function/guard is replaced or disabled.

## Reproduced native results

| Group | Actual independent evidence |
| --- | --- |
| 1 Original fuse | Exact first error P0001 / `B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED`; after ROLLBACK, new role and namespace absent. |
| 2 Full SQL1–5 positive | Actual current_user=session_user `b28_migration`, nonsuperuser LOGIN CREATEROLE. Candidate inventory/suffix completed; a separate bootstrap connection sees committed **32 business tables / 2 new definers**. Namespace has exactly four expected typed facts, selected ADMIN edge exactly one. |
| 3 Restricted fresh/deferred | Distinct restricted login sets local dream_api/actor, obtains seed, submits actual B25 envelope, receives staged/commitConfirmed=false/issuanceAuthorized=false. COMMIT returns command **COMMIT**. Independent bootstrap read sees exactly **1 request + 1 object + 1 intent**, with fingerprint/raw SHA equal to actual B25 outputs. |
| 4 Creator default CREATE | Native pre-inventory ACL has **5** rows, including unrelated login CREATE. P0001 / `B27_SCHEMA_ACL`, inventory block line 13: exact count check, not an unrelated SQL error. All recorded rollback checks true. |
| 5 Creator default USAGE | Separate case, ACL **5** rows with unrelated login USAGE. Same exact error/count-check location and rollback. |
| 6 Grant option | ACL remains **4** rows, API USAGE now grantable=true. P0001 / `B27_SCHEMA_ACL`, inventory block line **29**: bidirectional fact equality check is exercised beyond row-count rejection. Rollback checks true. |
| 7 Missing API fact | ACL **3** rows after removing API USAGE. P0001 / `B27_SCHEMA_ACL`, block line 13; rollback checks true. |
| 8 Wrong namespace owner | Native nspowner becomes unrelated role OID16390. P0001 / `B27_SCHEMA_OWNER`, block line **9**; rollback checks true. |
| 9 Grantor chain, coupled | ACL **6** rows includes unrelated grantable grantee and a second API-USAGE fact from grantor16390. P0001 / `B27_SCHEMA_ACL`, block line 13; rollback checks true. **This is extra-grantee/count plus grantor-chain rejection, not isolated grantor-only evidence.** |

For each of six negatives, native checks after explicit ROLLBACK establish candidate role absent, namespace absent, added intent UNIQUE absent and no dangling roleid membership. Native pre-inventory membership has just the permitted automatic ADMIN edge, after temporary SET/schema CREATE cleanup. This proves atomicity at the final-inventory failure boundary; it is not fault injection at every earlier transfer/grant phase. Per-case connections/database and candidate/API/worker roles are cleaned before reuse of the next fresh database.

Positive typed identities match: migration M16389, bootstrap grantor10, API17116, issuer R17737, namespace17739 owned by M16389. Exact schema ACL set is `(16389,16389,CREATE,false)`, `(16389,16389,USAGE,false)`, `(17116,16389,USAGE,false)`, `(17737,16389,USAGE,false)`. Independently asserted set equality from retained facts, not only row count. Issuer membership is roleid17737/member16389/grantor10/admin=true/inherit=false/set=false. The ADMIN exception remains trusted management authority; the separate runtime login is OID17838.

## Deferred observation and authority limits

Actual NOTICE: **`B28_EVENT role=17737 session=17838`**. The witness is an extra INVOKER, AFTER INSERT, INITIALLY DEFERRED trigger installed only after positive SQL5 inventory acceptance. Its body only emits NOTICE and returns NULL; it neither changes application rows nor replaces/enables/disables original guards. PUBLIC EXECUTE is revoked. It is observation-only and does not manufacture the triple or permit the COMMIT.

This directly observes the **witness's** queued-event context, not current_user inside the original SQL4 consistency function. The stronger relevant minimum evidence for original guards is successful real COMMIT with full hash-verified SQL4, its original immediate/deferred guards active and the restricted issuer's exact grants. This supports the pristine branch's required dependency sufficiency; it does not prove evolved receipt/registration/cleanup branches. The witness temporarily adds a fixture catalog object after inventory, so this is not an exact complete production catalog-descriptor proof.

Local bootstrap inserts synthetic Auth/policy facts and creates the restricted login/witness. The reservation call/COMMIT uses the separate restricted runtime login, not management credentials. This does not exercise real Auth, branded VerifiedActor, the B3 wrapper or policy provisioning. No signer/provider/cleanup authority follows from staged or historical results.

## Cleanup, preserved files and remaining scope

Runner cleanup record: pid78984, port54708, completed=true, postmasterPidAbsent=true, listenerAbsent=true. After process exit, Tester independently checked **OS PID count0**, **port listener count0**, and **no owned postmaster.pid**. `stop.log` and `stopped-listener.log` are retained. No redundant stop or forced process termination was needed. Owned data/logs remain for review; the cluster is stopped. No unexpected `first-failure.json`, `first-native-failure.json` or `cleanup-failure.json` exists.

Review scratch retains preflight/dependency hashes, run log and `independent-evidence-summary.json`. Runner root retains original/derived SQL, derivation/ownership/run metadata, signature/version/listener evidence, checks/positive catalog and cleanup logs. Independent evidence verification asserted nine groups, original/fuse-only bytes/hash/line count, exact positive ACL set, fresh confirmed triple, witness IDs and six rollback results. No supplemental DB fixture was needed; the existing evidence closes the assigned cause/rollback questions without expanded tests.

Post-run fixed comparison again found no runner/SQL1–5/model/B25/tool/package differences from ac7272f. Only this report is staged/committed, with a selected whitespace check. T122/T137 WIP is preserved. Shared 3013/.next, existing databases/clusters/services, env/real credentials, managed systems, registry/v1/runtime/API/provider, build/deploy, external settings/defaults and PATH remain untouched. Creator default-ACL changes are confined to the newly owned negative-fixture databases. No new agent/window/worktree.

Still unverified: isolated grantor-only rejection and all missing-fact combinations; faults during earlier temporary membership/OWNER/CREATE phases; exhaustive effective privilege/lock/zero-row/UPDATE-denial negatives; native 60-UUID and full raw/canonical/epoch/timezone matrices; evolved/expired replay; two-session same/different request races and rollback waiters; B3/Auth, actual lost-COMMIT response/outcome/pool hygiene and every target deployment major. Complete v5 descriptor/registry/provisioning, policy provenance/values/budgets, client adapter, Storage/provider/runtime/managed migration/deployment remain separate work. No concurrency/lost-COMMIT or operational-readiness expansion was run or claimed.

Copyable return:

> B28-R ac7272f independent PASS for the assigned nine-group owned PG18.7 scope: exit0, exact SQL5 fuse-only derivative, full SQL1–5 non-superuser commit and four-row ACL/one ADMIN edge, restricted fresh triple with real COMMIT/B25 hashes, six exact negative errors and final-inventory rollback. Grantor-chain remains coupled; witness observes itself while unchanged original SQL4 guards pass pristine COMMIT. Owned PID78984/127.0.0.1:54708 stopped, independently PID/listener0 and pidfile absent. No protected source/registry/runtime/managed changes. Broader native/integration/production gates remain; Master final acceptance required.
