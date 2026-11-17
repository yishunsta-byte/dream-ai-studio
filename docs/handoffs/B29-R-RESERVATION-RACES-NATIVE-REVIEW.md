# B29-R — Independent native same-request race review

**Verdict: PASS for the three assigned owned PostgreSQL 18.7 races.** Independently reproduced the unchanged fixed runner once, exit 0, then checked native blocking, finalization, durable bindings and OS cleanup. No mandatory defect found in this bounded result. Master retains final acceptance; this is not broader protocol, registry/apply/runtime or deployment approval.

Reviewer: Codex(Tester), separate from Backend author. Master assignment `msg_d68e25e7d71a`, acceptance receipt `msg_f47a4e323416`. Date: 2026-11-18, Asia/Seoul. Only this report is edited in the repository.

## Frozen inputs and execution identity

| Input | Verified evidence |
| --- | --- |
| Author fixed commit | `84fb3bbdce660fffecef502d917c46b97f216226` |
| Runner | `tests/b29-reservation-races-native-owned.ts`; LF SHA256 `9c4398041b6a94fdd7995d4f44a02fca5d8f52854c7a592077987a7bbde8e2f3` |
| Handoff | `docs/handoffs/B29-RESERVATION-RACES-NATIVE.md` at that commit, read in full |
| SQL5 | fbfc48c95264eaf37826f943b5e35e9fe67fa616; original LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| Owned derivative | LF SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` |
| Engine | Existing `.tools/b3-postgres-18.7/pgsql/bin`; PostgreSQL 18.7, Windows x86_64/msvc-19.44.35229; postgres/initdb/pg_ctl each Valid EnterpriseDB signature |
| Reviewer evidence root | `D:/starwork/dream-ai-studio/tmp/b29-native-48113412-40e0-47a3-abcc-d68eb5cc3c96` |
| Review scratch | `D:/starwork/b29r-review-84fb3bb` |
| New owned server | **PID39448 / 127.0.0.1:56203**, directory/PID/port and sole loopback listener verified |

Before execution, compared current runner, all postgres sources/tools, upload model, package and lockfile with 84fb3bb: no differences. Independently recalculated runner/SQL5 hashes. Used the unchanged current runner at its required existing binary path, without bypass or copied-runner changes. Recursively hashed installed pg/tsx/Zod dependency packages: 18 packages, 1,018 files. `installed-dependency-hashes.json` in review scratch has SHA256 `8932ae815952cb474f18702569078807bccdaa877602930016a47620fad776d5`; package/lockfile hashes are in `preflight.json`. Existing Node v26.13.0, pg8.23.1, tsx4.23.15 and Zod4.6.7 were used; nothing installed.

Actual command, from repository root:

```powershell
node --import tsx tests/b29-reservation-races-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Result: **exit0 / three native blocking races PASS / stopped=true**, retained in review scratch `run.log`. New UTF8/C SCRAM cluster, synthetic Auth stub/policy/credentials only; explicit loopback clients, no env file/external DSN/real credential read. This is a new Tester-owned reproduction, not the author's recorded cluster.

## Original source and authorized derivation

The runner verifies accepted SQL1–4 LF hashes before startup: SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, SQL2 `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`, SQL4 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`.

Independently compared the retained SQL5 original with its fixed git blob and checked exact replacement/reconstruction: exactly one known **87-character fuse statement at offset252** is removed, newline retained, 543 lines before and after. Derived hash matches above. No other statement is changed, split around an injection, or skipped; full SQL1–4 and whole derived SQL5 execute as the nonsuperuser migration login. Original repository SQL5/fuse remains intact. No new witness, trigger override or guard instrumentation is used. This assignment's derivative execution permission applies only to the newly owned B29-R cluster.

## Real wait and release evidence

Each race uses separate restricted LOGINs **b29_api_a/OID17837** and **b29_api_b/OID17839**, not two administrative clients. Native identity flags show neither superuser, BYPASSRLS, CREATEROLE nor INHERIT; distinct backend PIDs and session/current identities were independently checked. Both transactions set local dream_api/actor and call the actual entries. Their successful seeds/stages pass the entries' explicit READ COMMITTED guard; no B3 or real Auth is exercised.

Both get seeds before A stages. Owner/request match. Candidate object/asset/intent IDs, raw envelopes and server fingerprints differ. Equal canonical client payload is used in races 1/3; race 2 changes requested bytes1024→2048. Winner A returns provisional staged, then B's reserve call starts asynchronously. No sleep duration is accepted as proof of blocking.

| Race | A PID / XID | B PID / XID | Native sample before A release | B settled before release |
| --- | --- | --- | --- | --- |
| Same payload / A commit | 38980 / 778 | 50804 / 780 | A idle in transaction; B active, Lock/transactionid; blockers **[38980]** | false |
| Different payload / A commit | 18160 / 784 | 71956 / 786 | A idle in transaction; B active, Lock/transactionid; blockers **[18160]** | false |
| A rollback | 10160 / 789 | 79580 / 791 | A idle in transaction; B active, Lock/transactionid; blockers **[10160]** | false |

All sampled transactions have nonnull xact_start. Independently matched each blocked-file identity to its result identity, inspected actual `pg_stat_activity`/`pg_blocking_pids` samples and asserted sample time < release start, block-confirmed ≤ release start ≤ B return. This supports serialization on the common request admission path; the source has compatible shared policy locks and distinct object proposals before this request-latch wait.

Observed monotonic milliseconds from process origin:

| Race | Native block confirmed | A release started | A response confirmed | B returned |
| --- | --- | --- | --- | --- |
| Same payload | 77040.2595 | 77040.2627 | 77049.0920 | 77055.9599 |
| Different payload | 77189.2054 | 77189.2065 | 77199.3665 | 77199.6348 |
| A rollback | 77327.9871 | 77327.9894 | 77328.1905 | 77337.2157 |

This run received A's completion callback before B's return in all three cases. The necessary harness condition is actual blocked/noncompleted B before release, then B return after release **begins**; independent network callback ordering after that is not a general protocol guarantee. Before release the observer sees zero committed request/intent rows. That visibility absence is not used as proof of rollback.

## Finalization and committed bindings

| Race | A actual command | B original entry result | B actual command | Durable original |
| --- | --- | --- | --- | --- |
| Same payload | COMMIT confirmed | replay; exact A reservation and original raw envelope | COMMIT confirmed | A proposal |
| Different payload | COMMIT confirmed | CONFLICT | ROLLBACK confirmed | A proposal |
| A rollback | ROLLBACK confirmed despite staged return | staged / commitConfirmed=false | Its own COMMIT confirmed | B's own proposal |

All initial A stages have commitConfirmed=false and issuanceAuthorized=false. Successful B replay/stage also has issuanceAuthorized=false. In race3 the runner additionally checks zero visible ledger rows after B stages but before B's own COMMIT. No provisional return is treated as a confirmed transaction. Actual command replies are checked for COMMIT/ROLLBACK, not inferred from tags or primary-read absence.

Each race leaves **one request, one intent, one candidate object**, zero rejected object/intent rows, zero capability issues and zero outbox rows. Selected object/intent/reserved-asset IDs match the chosen original envelope. Final global totals: requests3/objects3/intents3/capabilities0; global outbox count is zero in every per-case query. Native joins bind owner/request/intent/object, original canonical client text/digest, original server-envelope text, raw SHA and semantic fingerprint. Actual B25 native text projections are decoded with `decodeUploadReservation`; reconstructed model, raw text and hashes match that candidate's encoder output in **all three** cases.

Reviewer's separate evidence inspector recomputed UTF8 raw SHA, client domain digest and canonical ASCII-fixture server fingerprint from retained envelopes, checked cross-row hash equality/selected IDs and compared immutable ledger result JSON to the selected staged reservation. All matched. This is independent checking of the three actual fixtures, not an expanded canonical/Unicode matrix or a new DB test. No supplemental native fixture was needed.

## Timeouts, failure handling and cleanup

Source review confirms connection timeout5s, native statement_timeout30s, client query_timeout45s; wait observation has a monotonic7s polling deadline and 25ms scheduling pauses. The7s deadline is checked between observer queries, each separately subject to its query/statement bounds; it is not an unconditional7s wall-clock cancellation guarantee. Waiter errors get a rejection handler immediately. Failure-finally releases A before awaiting pending B and queueing B rollback, avoiding cleanup rollback queued behind its unresolved blocker. Errors retain closed stage/native cause in first-failure evidence; expectations are not relaxed. Timeout/error injection itself was not run; no unexpected first-failure or cleanup-failure file was produced.

Runner cleanup-safe reports PID39448/port56203, completed=true/postmasterPidAbsent=true/listenerAbsent=true. After exit, Tester independently verified **OS PID count0**, **port listener count0**, and **no owned postmaster.pid**. Stop/listener logs are retained. No redundant stop or forced termination was used; data/logs remain for inspection with the server stopped.

Runner evidence includes per-case `*-blocked.json`, `*-result.json`, checks/totals, signatures/version/listener/ownership, original/derived SQL and derivation, and cleanup logs. Review scratch retains source/dependency preflight, run transcript, `inspect_evidence.py` and `independent-evidence-summary.json`. Inspector exit0 confirms all recorded waits/order/commands/hashes/ledger results/counts and exact derivative/cleanup; it only reads owned evidence and fixed git source.

Post-run comparison found no changes to B29/B28 runners, postgres sources/tools, model, B25, package or lockfile relative to 84fb3bb. Only this report is staged/committed with selected whitespace validation. Unrelated T122/T137 WIP is preserved. Shared3013/.next, existing clusters/services, real env/credentials, managed DB, registry/runtime/API/provider, build/deploy and external settings are untouched; no agent/window/worktree.

Remaining unverified: expired/evolved replay; UUID/time/canonical-boundary native matrices; policy-advance/broader lock/ACL races; actual uncertain/lost-COMMIT reply, B3/verified Auth/outcome/pool handling; provider late writers, policy provenance/operating values/budgets, other deployment majors and complete v5 descriptor/registration/apply/runtime. All six finalization replies in these three races were received. These tests do not prove outcomes when COMMIT response is lost, nor authorize production admission.

Copyable return:

> B29-R fixed84fb3bb independent PASS for three owned PG18.7 races, exit0. Distinct restricted logins/backends actually blocked on transactionid before winner release: commit→exact original replay, changed payload commit→CONFLICT, rollback→waiter's own provisional stage then real COMMIT. Each leaves one selected triple, discarded object/intent0, cap/outbox0; native B25 decode/model/raw/hash and independent digest/ledger-result checks pass. PID39448/127.0.0.1:56203 stopped with OS PID/listener0/pidfile absent. Original SQL/fuse/protected files unchanged. Broader gates remain unverified; Master final acceptance required.
