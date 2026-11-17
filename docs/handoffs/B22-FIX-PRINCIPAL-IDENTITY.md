# B22-FIX — collision-free catalog principal identity

Status: ready_review; independent reacceptance pending. Confirmed 2026-11-18 01:10 KST (2026-11-17 16:10 UTC). Assignment `msg_3c75087e6c08`, ACL-only supplement `msg_07c3887ffafa`.
Rejected baseline: `853e861ae2eae52ca93418ceab8eca72a2e74560`. Sole author Backend; only `migration-state-v2.ts`, existing B22 test and this unique handoff currently change. Existing B22 manifest/runner may be used if needed but need no change so far. SQL1–4, v1/B19/runtime/provider/managed/SSL/Storage/API/package/deploy/shared .next are protected; no new agent/window/apply CLI.

Read Tester's exact reproduction and retained observations in `D:/starwork/b22r-catalog-853e861/tests/postgres/b22r-independent.test.ts` and `tmp/b22r-independent-30f70356-ae6e-4ac1-93ed-1b26ea2eb983`, plus final ACL-only evidence under `tmp/b22r-independent-9f921a9a-d18b-4269-8542-05df1233927e`. The reviewer verified foreign native owner OIDs, while literal role name `$owner` collided with the descriptor string. An ACL-only variant kept actual function owner correct but swapped owner EXECUTE to the foreign `$owner` grantee and also passed. The old owner-normalization claim in B22 is rejected historical behavior.

Plan: preserve six original STATE rejection expectations, reproduce baseline on owned PG, replace owner/public/named-role strings with disjoint tagged identities based on native OIDs throughout owners/grantors/grantees/policy roles, then test foreign roles, ACL-only substitutions, true session owners with marker-like names and pre-journal rejection.

## Fixed baseline and reproduced failure

Read final independent report `docs/handoffs/B22-R-VERSIONED-CATALOG-REVIEW.md`, fixed report commit `b4d9d4f7e891fe1d6e7b48ac4bc5976404383ba2`. It reports original71PASS and independent14PASS/6FAIL from one principal-marker collision cause. It does not evaluate this fix. Reviewer fixtures/reports were not edited or staged; no extra defect/task is inferred from repeated notifications.

Own baseline reproduction retained the original71 and the six STATE rejection expectations/native identity checks. First owner-only run reproduced71PASS/5FAIL of76. After the exact ACL-only case arrived, a new run reproduced **71PASS/6FAIL of77**, exit1: all five foreign owners and the correctly owned function with foreign EXECUTE grantee incorrectly returned complete4/pending0 and read journal contents. `owner-observations.jsonl` records native same_owner=false for owner cases and the actual normal owner/foreign grantee tuple for ACL-only.

To run that second baseline against the fixed historical implementation, a temporary ignored script saved only this task's own state-file WIP, loaded the exact `git show 853e861:lib/db/postgres/migration-state-v2.ts`, invoked the owned runner, and restored the typed fix in finally. Its output confirms restoration after expected exit1. No other tracked file or reviewer's archive was reset. The temporary backup is text, not a compiler input. This is reproduction tooling, not a shipped source-selection feature.

## Minimal common fix and audit

Native OID comparisons now produce disjoint JSON variants:

```json
{"kind":"owner"}
{"kind":"public"}
{"kind":"role","name":"$owner"}
```

Owner means **OID equals session_user's OID**, not a matching name and not merely equality to an arbitrary object's owner. Public means grantee/policy OID0. Every other role is an explicit named-role object, including literal `$owner`, uppercase `PUBLIC`, and a JSON-looking role name. No role name is parsed as a principal tag. There is no reserved-name blacklist; legitimate migration owners with those names remain valid.

Audited and changed every principal representation in the nine catalog query categories: schema/relation/function/domain owners; schema/relation/column/function/domain ACL grantors and grantees; policy roles. Grantor/grantee owner identity is consistently relative to the native session owner. Other metadata/counts, fixed source hashes, exact role graph rules, read-only query behavior and metadata-before-journal order remain unchanged.

The explicit version3/version4 literal descriptors were converted offline to the tagged format from the same previously verified, controlled reference records (reference JSON SHA `afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`). That fresh reference had the known synthetic administrator as actual owner and no marker-named foreign roles. Only the known reference's semantic principal slots were converted; runtime never converts arbitrary name strings into owner/public tags or learns expected rows from its target. Nested descriptors remain frozen.

No new schema/table/function/role/policy/privilege, source hash or migration was introduced by the fix. Runtime role creation, ownership changes and permission substitutions below occur only in rollback-only owned test transactions. The historical B22 handoff's string-marker normalization claim is superseded by this fix; original SQL1–4 and current v1 manifest/runner are untouched.

## Final tests

```text
node tests/postgres/run-versioned-source-catalog-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

Final **88PASS /0skip**, exit0, start2026-11-18 01:09:00 KST,2.33s. Exact composition: original71 + six review regressions + eleven added boundary tests =88 (22 pure +66 actual PG cases). Earlier runs overlap and are not additional coverage.

- All six review cases now record accepted=false, code=STATE and **historyRead=false**. Native wrong-owner/ACL evidence remains unchanged; no failed expectation was inverted, skipped or weakened.
- Additional ACL substitutions cover table, journal schema, domain and column grantees. A real foreign grantor is created through SQL grant-option delegation; native grantor and observed tagged role are checked. Actual uppercase `PUBLIC` role vs OID0 public domain usage are distinct and rejected when substituted. This is newly tested fix coverage, not a claim the original reviewer independently reproduced a PUBLIC collision.
- Three positive actual-session-owner boundaries use names `$owner`, `PUBLIC`, and `{"kind":"owner"}`. Each rollback transaction creates an owned synthetic superuser, transfers **only explicit project descriptor objects**, sets LOCAL SESSION AUTHORIZATION, verifies the actual session name and accepts exact complete4/pending0. No bootstrap/system ownership is reassigned. All six original negatives remain independent of these positives.
- Ordinary foreign owner still rejects; final rollback restores the original owner and complete4, with no temporary roles left. The new pure test checks owner/public/named-role variants in fixed descriptors.

```text
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts
```

**35PASS /66skip**, exit0: v1 pure13 + B22 pure22; the66 integration cases require the owned runner and all passed there. These results overlap the88 and are not added to it.

TypeScript and targeted ESLint both exit0, warnings0:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-state-v2.ts tests/postgres/versioned-source-catalog.test.ts --max-warnings 0
```

## Owned evidence and cleanup

| Suffix under tmp/b22-postgres- | Actual result |
| --- | --- |
| `63ad6425-c963-4a47-ac2f-1992a83925cf` |Baseline71PASS/5FAIL, owner-only reproduction.|
| `a75c548e-4847-4413-9171-990f019331e3` |Baseline71PASS/6FAIL, all six reproduced with original rejection expectations.|
| `430ab1b5-ceea-4366-9159-f7018baff151` |Typed fix85PASS/3 fixture failures: overly broad REASSIGN OWNED tried to include initdb system objects before positive inspection. Replaced fixture with explicit project-only ownership transfers; no product assertion relaxed.|
| `68b5c678-c580-4f67-bc74-1fef7fd43eb0` |Final88PASS including real owner-name positives.|

All four own runs have `cleanup-safe.json` postmasterPidAbsent=true and listenerAbsent=true. Final `run.json`: **PID48692**, address127.0.0.1, port60720, database `dream_test_b3`. No owned process/listener/transaction remains; evidence retained, no recursive deletion. Same explicit signed EnterpriseDB PostgreSQL18.7/UTF-8/C synthetic-only guard remains. No .next/3013/provider/managed/SSL/Storage/API/paid/deploy action.

## Hash, limitations and review gate

Changed `migration-state-v2.ts` canonical LF UTF-8 SHA256: **`c51745a4c482732a428374831690ebd1eb5ee310487221cf9a95858465c77f70`**. Accepted SQL4 canonical hash remains `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`; published SQL1–3 remain exact and pass original source tests. Manifest, owned runner and every SQL file have no change in this fix.

The inspector is still a caller-owned-client SELECT-only foundation, not an apply/CLI/connection-authority boundary. PostgreSQL18.7 is the actual verified environment;16/17/other collations/managed are not newly verified. All prior bounded-catalog/full-executor/current-clock/worker/native-byte/provider and operational-readiness limitations remain. Independent B22-FIX acceptance is pending; a new fixed review must assess this commit, not overwrite baseline853e861's FAIL. v2 apply/CLI and managed/runtime work remain separately gated.

Master handoff: B22-FIX six original marker-collision negatives reproduced then rejected before journal reads using native-OID tagged principals; final88PASS, pure35PASS, TypeScript/ESLint pass and four owned clusters stopped. Request independent re-review of the fixed three-file commit; no SQL or operational change.
