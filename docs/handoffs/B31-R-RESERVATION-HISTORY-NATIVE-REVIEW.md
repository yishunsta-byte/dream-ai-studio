# B31-R — Independent native history review

**Verdict: PASS for the assigned three owned PostgreSQL18.7 history scenarios.** Ran the unchanged frozen runner once, exit0, and independently checked source/derivation, exact native clock conditions, policy tuples/bodies, both entries, row preservation, rejection atomicity and OS cleanup. No mandatory defect found within this scope. Master retains final acceptance; this is not evolved-history, B3/Auth, uncertain-COMMIT, registry/runtime or operating approval.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_1001b8b7a5e9`, acceptance receipt `msg_513e440c65d8`. Date:2026-11-18 Asia/Seoul. Followed clarification `msg_79ee6235c06e`: **A/C use800ms/500ms; B uses120000ms/90000ms**, with no duration or expectation change. Only this report is edited in the repository.

## Frozen identity and execution

| Artifact | Verified evidence |
| --- | --- |
| Author commit | `85119b995a68b40f9677465322d7af849d1db990` |
| Runner | `tests/b31-reservation-history-native-owned.ts`; LF SHA256 `02066cc739b3f876e7353bb3f05a2d21794086d04373c999b9aaa8465045b9c1` |
| Author handoff | `docs/handoffs/B31-RESERVATION-HISTORY-NATIVE.md` at85119b9, read in full |
| Original SQL5 | fbfc48c95264eaf37826f943b5e35e9fe67fa616; LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| Scratch derivative | LF SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` |
| Native engine | Existing signed `.tools/b3-postgres-18.7/pgsql/bin`; PostgreSQL18.7 Windows x86_64/msvc-19.44.35229; Node26.13.0 |
| Reviewer root | `D:/starwork/dream-ai-studio/tmp/b31-native-d775ee0b-8d29-46a8-9b6e-9d06f3371307` |
| Review scratch | `D:/starwork/b31r-review-85119b9` |
| Owned server | **PID75500 / sole listener127.0.0.1:61408**, owned directory/PID/port verified |

Before execution, current runner/postgres sources/tools/model/package/lockfile matched85119b9. Independently recalculated runner/SQL5 pins. Recursively hashed installed pg/tsx/Zod dependency packages:18 packages/1,018 files; manifest SHA256 `8932ae815952cb474f18702569078807bccdaa877602930016a47620fad776d5`, retained in review scratch with preflight inputs. No installation, path-check bypass, archive, runner/source rewrite or expectation relaxation.

Actual command, from repository root:

```powershell
node --import tsx tests/b31-reservation-history-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Actual **one invocation, one newly initialized owned UTF8/C SCRAM cluster, exit0 /three PASS /stopped=true**; review-scratch run.log retains output. postgres/initdb/pg_ctl each verified Valid EnterpriseDB signature and engine18.7. Full SQL1–5 installs under actual nonsuperuser CREATEROLE migration login. Runtime calls use two distinct restricted logins, below. Explicit loopback clients/new synthetic secrets only; no env file, external DSN, real credential, existing cluster/service or shared3013/.next used. Password text was not printed/committed.

The runner verifies all accepted SQL1–4 hashes before startup. SQL2 remains approved `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`; other full baseline pins match their previously accepted source hashes frozen in this runner. Independently compared saved SQL5 original to fixed git blob and asserted **only the known87-character fuse at offset252 is removed**, newline retained/543 lines; exact reinsertion and derivative hash match. Entire derived SQL5 executes without function/guard/inventory/trigger edits. Original repository SQL5 retains its unconditional fuse/hash. This scratch execution permission is confined to the new B31-R cluster.

## Clock and policy scenario separation

Original reservations are normally seeded/built/staged under local dream_api and fixture owner, then COMMIT is actually confirmed. All creation-time samples are before both original windows. Observer uses a single MATERIALIZED `clock_timestamp()` numeric sample and native comparisons; reviewer rechecked all recorded text/booleans using Decimal, without Date/float truncation. A/C wait for real expiry, not a fake clock, deadline rewrite or fixed sleep assumption.

| Case | Original→current epoch | Original authorization/issue deadline, epochms | Native condition sample | Final sample |
| --- | --- | --- | --- | --- |
| A Expiry only | **1→1** | 1794945985355 /1794945985055 | **1794945985358.063000**, after both | 1794945985387.597000, after both |
| B Policy only | **2→3** | 1794946105392 /1794946075392 | **1794945985399.270000**, before both | 1794945985412.401000, before both |
| C Expiry and policy | **4→5** | 1794945986217 /1794945985917 | **1794945986237.073000**, after both | 1794945986250.927000, after both |

B stays unexpired throughout the checks; no expiry contamination or timing adjustment. Original TTL/envelope are800/500ms for A/C and120000/90000ms for B. Native current body/epoch/digest are independently checked against each policy fixture and body domain digest. A has no transition. B/C append new immutable version/body and normally update the guarded pointer; new authorities differ, maxIssues3→1, ceiling and applicable duration facts differ. These are bootstrap-managed synthetic fixtures, not a runtime provisioning implementation, operational limits or policy-transition race.

Expiry polling has a nominal5s monotonic window with25ms scheduling pauses; native queries have statement_timeout30s/client query_timeout45s and connection_timeout5s. The window is checked between bounded observer queries, not a hard5s wall-clock cancellation guarantee. Actual samples show expiry around the original800ms duration. No timeout or clock-failure injection was run.

## Both entries, payload and owner isolation

Native runtime identities are distinct: **b31_api_a/OID17837/PID72000**, **b31_api_b/OID17839/PID54732**; current_user=session_user at connection identity check, nonsuperuser/no-BYPASSRLS/no-CREATEROLE. Calls set local dream_api and the appropriate fixture owner. This tests owner scoping through the trusted actor-GUC interface; it does not authenticate that GUC cryptographically or exercise real getUser/VerifiedActor/B3.

For each of A/B/C:

* Both read_upload_seed_v1 and reserve_upload_v1 return **replay** with exact original reservation result, policy epoch/digest, raw envelope and issuanceAuthorized=false. Current policy/deadline state does not refresh original authority or issue a new seed/stage for that history.
* Same owner/key with requested bytes1024→2048 returns only **CONFLICT** from both entries, without original result/raw attached.
* Distinct owner's same request ID obtains **its own seed**, no original reservation/raw/object/asset/intent IDs. Submitting original owner's envelope returns only **INPUT**. Owner-scoped request IDs legitimately allow another owner's seed; no global request-ID prohibition or real Auth proof is claimed.

There are3 original seed/stage transactions with actual COMMIT and21 subsequent single-entry transactions with actual COMMIT:6 replay,6 CONFLICT,3 other-owner seeds,3 foreign INPUT and3 stale-new-key results. The saved21 return-then-COMMIT events independently match tags replay6/CONFLICT6/seed3/INPUT5/STALE_SEED1. These are assertions within three scenarios, not27 independent protocol cases. Even failure tags are deliberately committed to test the bounded function's own no-partial-write guarantee, not recommend an adapter ignore errors.

## Exact history content and new-key negatives

Before/after snapshots materialize every user column of original ledger/intent/object via to_jsonb. Reviewer independently asserted full three-row equality and canonical snapshot hash equality, raw SHA, client/result bindings, semantic snapshot fingerprint and immutable result-domain digest. Both history results equal original staged result and original raw text. Actual native B25 text projections and decoder reconstruct original pristine model/raw/SHA/fingerprint in all3 cases. These are user-column content invariants, not MVCC/system-column or physical-no-rewrite measurements.

Original intent remains open/revision0 and object reserved/revision0; expiry is clock state, not a manufactured cleanup/cancellation/registration transition. A pristine decoder's continued acceptance is not live authorization or evolved-row coverage. Capabilities/outbox stay0 and all replay returns deny issuance.

Fresh stale attempts use a **new request key and distinct new object/asset/intent IDs**, with matching new incoming path. Reviewer reconstructed each proposal from the original and asserted that only these IDs/key change; original timestamps/policy/authorities remain. All original/new IDs are distinct within and across scenarios, and final stale candidate rows are absent. Thus observed rejection is not a request mismatch, malformed target or adoption of existing candidate IDs.

| Case | Actual tag and COMMIT | Guard classification from fixed source plus native facts |
| --- | --- | --- |
| A | **STALE_SEED**, then actual COMMIT; partial0 | Old current tuple/body still matches and exists; fresh binding succeeds, then request latch precedes real-clock check. Original windows are expired while preparation age is still well below30000ms. Source line379 raises caught P0002, handler line397 emits STALE_SEED and unwinds the subtransaction. This is source-path inference supported by native tag/state, not an externally observed uncaught exception/SQLSTATE. |
| B | **INPUT**, then actual COMMIT; partial0 | Original tuple/body/authorities mismatch current policy while time is still valid; line356 whole-envelope equality fails before latch/time admission. Generic binding rejection, not a dedicated epoch SQLSTATE. |
| C | **INPUT**, then actual COMMIT; partial0 | Same binding check fails first despite expiry also being true. No claim that C executed the post-latch expiry branch. |

Each retains one original request/intent and zero other-owner request, fresh stale request/object/intent, capability and outbox rows. Final totals: **request3/object3/intent3/capability0/outbox0**. No raw/native error or collision was substituted for a closed expected tag. No original history UPDATE or operating-clock change is present in the runner.

## Cleanup, evidence and remaining limits

Cleanup-safe records PID75500/port61408, completed=true/postmasterPidAbsent=true/listenerAbsent=true. After exit, Tester independently verified **OS PID count0**, **port listener count0**, **owned postmaster.pid absent**. Stop/listener logs remain; no redundant stop or force termination. Owned data/logs remain with server stopped. Successful run has no first-failure or cleanup-failure record.

Runner root retains original/derived SQL/derivation, signatures/version/ownership/listener, runtime identities, policies, per-case snapshots/clocks/results, events/counts/totals and cleanup. Review scratch retains preflight/dependency hashes, run.log, read-only inspect_evidence.py and independent-evidence-summary.json. Inspector exit0 confirms exact Decimal conditions, policy mappings/digests, both history responses, isolated error results, three-row/raw/result hashes, unique fresh IDs/key, committed-call counts and cleanup. No supplemental native fixture was needed.

Post-run comparison confirms B31/B28/B29/B30 runners, postgres sources/tools, upload model/B25 and package/lockfile unchanged relative to85119b9. Only assigned report is staged/committed with selected whitespace validation; T122/T137 WIP preserved. Existing clusters/services, shared3013/.next, real env/credentials, managed/registry/runtime/API/provider/Storage, install/build/deploy and external settings untouched. No new agent/window/worktree or extra cluster.

Still unverified: cancellation/registration/receipt/cleanup or other evolved rows; B3/real Auth/pool handling; actual uncertain/lost-COMMIT response; other deployment majors; expanded corruption/clock/lock/concurrency matrices, provider late writers/operating budgets and complete v5 descriptor/registry/provisioning/managed deployment. All tested finalization responses were received. No operational authority follows from this bounded history acceptance.

Copyable return:

> B31-R fixed85119b9 independent PASS, one new owned PG18.7 run exit0/three scenarios. Exact DBclock proves Aexpiry only/Bpolicy only before deadlines/Cboth. Both entries replay immutable original result/raw/epoch/hash, changed client CONFLICT, foreign owner own seed then original-envelope INPUT. Full3row content and native B25 model/raw/hash unchanged. Unique fresh keys/IDs/targets give A STALE_SEED vs B/C INPUT with documented first-guard classification; actual COMMIT after tags leaves partial0/cap/outbox0. PID75500/127.0.0.1:61408 stopped, OS PID/listener0/pidfileabsent. Originals/fuse/protected sources unchanged; evolved/B3/lostCOMMIT/operational gates remain. Master final acceptance required.
