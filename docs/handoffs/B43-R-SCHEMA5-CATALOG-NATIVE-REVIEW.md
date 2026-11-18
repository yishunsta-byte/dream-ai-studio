# B43-R — Independent all-SQL/final-identity failure reproduction

**Evidence/reproduction verdict: PASS. Product native observation: FAIL, exit1.** Independently reproduced all15 successful SQL/raw-batch stages followed by final cross-category rejection, then located the first unresolved endpoint offline without altering input or acceptance. No full observation/hash, Golden/reference/state or runtime acceptance exists. Master retains final authority.

Reviewer: Codex(Tester), separate from Backend. Assignment `msg_eedf8fef4606`; receipt `msg_4f07ccae8cb9`. Date:2026-11-18 Asia/Seoul. Only this tracked report changed.

## Frozen copy and actual invocation

Reviewed fixed **cd4fd982390acd66c7642e6bb4f5bc05d5ff5281**, exactly new B43 harness/report. Independently reversed B43/b43 labels and approved catalog pin to B41/B40 pin; complete LF source equals frozen22b0d49 B41. This proves the reviewed execution/error/recipe/cleanup control flow is unchanged beyond the authorized labels/pin.

| Artifact | Independent LF SHA256 |
| --- | --- |
| B43 harness |7f4270298b831e31b86a41c03c827c2ea5b6a11a041677cc2abaa1616d8d1f8e|
| B43 handoff |0764d50f4f2023dccaa51b1bee19de4fd73b7c148d7914b0a335efb7eee69726|
| Frozen B42 catalog module |aea12e9f90970637d22421904fa0b861f1dfda28c871c5bfffeca5f712640b1a|
| Unchanged loader |0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698|

```powershell
node --conditions=react-server --import tsx tests/b43-schema5-catalog-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

One unchanged invocation, **exit1/stopped=true**. Own root `tmp/b43-native-5a4a9ea2-46e2-44c0-b1fe-7232825299c8`, fresh UTF8/C SCRAM loopback/template0 dream_test_B43, ephemeral127.0.0.1:56136. Existing postgres/initdb/pg_ctl EnterpriseDB signatures and actual18.7 verified. Explicit synthetic secrets only; retained log contains no generated password/PASSWORD statement/SCRAM credential material. No DSN/.env, managed/provider, shared3013/.next/PID or existing cluster operation.

The fixed loader verifies actual P full **f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339**, body **15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9**, and all source1–5 full/wrapper/body pins. sources.json's five actualBodySha match bodyChecksum. D stays fused/unchanged; no E derivative was made or relabeled.

Actual B=b43_bootstrap/10 superuser and distinct M=b43_migration/16389 restricted LOGIN CREATEROLE use the unchanged prerequisite/journal recipe. M executes one RC/shared lock(1725031001,5)/pg_catalog transaction with trusted settings, five verified bodies and history inserts; original pg COMMIT resolves before migrationCommitted=true. Separate observer sees the exact three B-granted M→API/worker/issuer ADMIN-only edges, INHERIT/SET false. None profile/no runtime pair; fixed recipe supplies526 native management facts, not learned expected rows. M's exclusive RR READ ONLY/pg_catalog transaction supplies the unchanged reader.

## Actual native result and raw-only measurements

All15 SQL calls completed, including the corrected columns query, and the reader progressed through its per-batch raw parsing. Completed trace has context plus all14 categories, with no failed SQLSTATE or server ERROR. Final public exception is CATALOG_OBSERVATION_INVALID; nativeError is the fallback copy of that decoder error because firstNativeError was unset. category memberships/lastReturnedRows3 denote the last dispatch/result, **not the rejection's cause**.

| Raw category | Rows | Raw category | Rows |
| --- | ---: | --- | ---: |
|schemas|3|relations|33|
|columns|430|constraints|699|
|indexes|140|policies|57|
|triggers|334|functions|18|
|domains|3|types|69|
|defaultAcls|0|dependencies|2995|
|roles|5|memberships|3|

Context returns1 row180007/pg_catalog/repeatable read/read_only on. Offline raw classification is38 named/296 internal triggers,33 table-composite/36 generated-array rows and two definer rows named read_upload_seed_v1/reserve_upload_v1. These counts, raw function/type references and successful SQL are **not full inventory/body/normalization or expected-catalog PASS**. No final.json, unvalidated-observation.json, full canonicalJson or observationSha256 was produced. Capacity is measured only for this captured fixture; no future complete-reference capacity claim is made.

## Same-input offline reproduction and first endpoint

After owned shutdown, called the **unmodified original module** offline on exactly the fourteen captured batches and management bindings: same public rejection/no observation. Then called an explicitly separate exact source copy with only utility import relocation and stderr endpoint/stack instrumentation immediately before the existing missing-identity rejection. The existing need(identity), registry and return behavior remain unchanged. analysis.diff records both changes; reversing them yields the frozen original bytes.

Both calls retain identical input-object hashes and the same fifteen file hashes (fourteen batches plus bindings), with no in-memory/file input changes. The original native execution had no such instrumentation. The copy's path is analysis evidence, not a native stack trace or product correction. It stops on the first missing endpoint; no skipped row, invented mapping or next-failure exploration occurred.

First copy-only marker identifies normalize/dependency resolve at354–355, with:

```json
{"dependent":{"class":"pg_class","nativeOid":"16396","subId":0},"referenced":{"class":"pg_constraint","nativeOid":"16397","subId":0},"dependencyType":"i"}
```

Independently linked captured index16396 to the actual external-prerequisite **auth.users.users_pkey**, parent relation16392, primary/unique/valid/ready/live/immediate true, btree/uuid_ops/key[1], no predicate/expression. The exact index binding exists. No one of699 collected constraint rows has native16397; no external binding maps pg_constraint16397/sub0. Thus the strict registry cannot resolve that referenced endpoint. The native generic throw itself does not expose this path; same-input original rejection plus bounded copy instrumentation establishes the offline first-reject diagnosis.

Source alignment: the dependency query includes the approved external supporting index and both dependency directions; constraint rows/registration cover the owned namespaces, while the strict external fact contract lacks a corresponding Auth constraint identity. The edge is consistent with a primary-index constraint dependency. **The target constraint's actual name, definition, owner/parent ownership, keys and enforcement metadata were not collected and are not asserted or synthesized here.** No index-name-to-constraint-name inference was used.

Minimum recommended next direction is a separately reviewed exact external Auth prerequisite constraint contract: collect the target's real typed metadata and parent/index/key/ownership links, then bind only that reviewed prerequisite identity. Preserve unknown-endpoint rejection and the captured edge; do not filter it, allow arbitrary pg_constraint objects or create an identity from an OID/name guess. No such collection/schema/allowlist change is made or authorized by this report. Other possible unknown endpoints remain unassessed.

## Author analysis, cleanup and checks

Independently verified the author's analysis copy reverses exactly to the same original after its documented utility relocation/fail-stack/unresolved-marker additions; no predicate/result changed. All seventeen files in its supplied offline-input-hashes manifest match retained artifacts. Its original and copy rejection records, minimum index/edge evidence and absence of target constraint facts agree with the independent result. No author evidence was modified.

Own postmaster **11360**, port **56136**, backends **63656 /59272 /63916**. Harness validates owned PID-file directory/port/PID before fast stop and records completed=false/migrationCommitted=true/projectionCalls15 with all three shutdown flags true. Independent post-exit OS query confirms **all four PIDs absent, listener56136 absent and postmaster.pid absent**. Only the frozen finally activity witness/rollback/end followed failure; no extra native catalog query, retry, skip or correction occurred. Per-client end-ACK results are not separately emitted; physical absence is independently established.

Author cleanup artifact contrasted: root5a56de32, postmaster74572/port57866/backends78936,75816,68060, same committed=true/completed=false/15-call failure and shutdown flags true; PID file absent. No author process was operated on.

Whole-project `node node_modules/typescript/bin/tsc --noEmit --incremental false` and new-harness `node node_modules/eslint/bin/eslint.js tests/b43-schema5-catalog-native-owned.ts --max-warnings 0` both exit0. Separate offline replay commands use official react-server/tsx and write only diagnostic artifacts. Native invocation exit1 is intentionally preserved, not counted as product PASS. Protected57 original source/harness/package/config files and fixed pins remain unchanged; product diff empty. Unrelated T122/T137 files preserved; report-only whitespace/selective commit checks pass.

Own ignored review root `tmp/b43r-review-cd4fd98` retains preflight/copy comparison, native-run.log, original/analysis same-input results, input hashes, analysis-only copy/diff/log, independent-evidence-summary.json, offline inspector, OS cleanup and postrun checks. No DB parser, additional native cluster/query/rerun, product/original harness/test/SQL/allowlist edit, Golden/state/runner/provenance/runtime, env/package/build/deploy/install/provider/browser or new agent/window/worktree action occurred. Return **PASS-for-evidence/reproduction; product native FAIL**, with the external prerequisite gap and unverified full-catalog boundary preserved for Master allocation.
