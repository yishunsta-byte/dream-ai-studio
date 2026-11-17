# B27-R2 — Fixed SQL5 source re-review

**Verdict: SOURCE-ONLY PASS for the assigned F27-1/F27-2 corrections and POLICY-tag clarification. SQL5 native verification remains NOT RUN / UNVERIFIED. This is not registry, migration, runtime or deployment approval.**

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_4207ca10358b`, acceptance receipt `msg_6f24ef5282b1`. Date: 2026-11-18, Asia/Seoul. Master retains final acceptance authority.

## Frozen evidence

| Input | Evidence |
| --- | --- |
| Fixed Backend commit | `fbfc48c95264eaf37826f943b5e35e9fe67fa616` |
| Fixed SQL | `lib/db/postgres/drafts/0005_upload_reservation.sql`, 543 lines; independently recalculated LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| FIX handoff | `docs/handoffs/B27-FIX-UPLOAD-RESERVATION-SOURCE.md` at the same commit, read in full |
| Original review | `9b8fb17a3d387b97e7f6aa93844e15a5f5f02cac`, B27-R, original source `dfb521c5a367a2db0827fdf392f24df6559fce3b` |
| Prior contracts | Controlling B26 `14fd8a3`, B26-R/R2, accepted B25 `da0f740` and review `85108b6`; their scope and unresolved native gates remain |
| Installed model dependency | Zod 4.6.7, shared lowercase `id` schema and actual existing B19/B25 implementations; no dependency/model edit |

Review used the actual frozen diff (`git diff dfb521c fbfc48c -- lib/db/postgres/drafts/0005_upload_reservation.sql`), not the handoff alone. SQL changes are +34/-2 lines in three hunks: UUID predicate, namespace inventory, namespace facts output. The FIX commit itself changes only its SQL and new FIX report. Other commits between the two SHAs include unrelated team/UI documents/tests and are not attributed to this FIX.

## Finding closure

| Finding | Fixed source and conclusion |
| --- | --- |
| F27-1 UUID mismatch | Lines 144–155 iterate all three arrays; retain JSON-string and 1..100 bounds; add exact length 36, C collation, version `[1-8]`/variant `[89ab]` and explicit nil/max alternatives. These match installed `z.uuid()` plus shared lowercase refinement and B25's exact authority length requirement. Source check and actual JS whole-envelope evidence below support closure. Actual PostgreSQL regex/policy execution is still unverified. |
| F27-2 schema ACL inventory | Lines 426–447 require namespace owner M, exactly four expanded ACL facts and equality in both directions across grantee OID, grantor OID, privilege text and grantability. Lines 531–534 emit these typed native facts. This closes the original omitted schema allowlist at source level. Native catalog representation and rejection/rollback fixtures remain unverified. |
| Minor POLICY tag omission | FIX handoff's Closed tags section explicitly includes POLICY alongside the actual unchanged line-299 seed failure result (original line 296). Original frozen handoff is preserved. No HTTP or B3 adapter mapping was introduced. Clarification accepted in this scope. |

Namespace expected facts are exactly `(M,M,CREATE,false)`, `(M,M,USAGE,false)`, `(API,M,USAGE,false)`, `(R,M,USAGE,false)`, with typed native OIDs, not role marker strings. The owner check is separate from ACL equality. Unexpected/missing privilege, principal, grantor or grant-option changes produce a set difference, including a missing fact replaced by an unrelated fact while keeping count four. Count four additionally rejects duplicate expanded facts which EXCEPT alone would collapse. A null ACL falls back to native owner defaults, which cannot silently supply missing API/issuer USAGE. PUBLIC/worker/extra runtime/default grants are absent from expected. Existing effective forbidden-privilege and role checks are retained; no defaults are modified to manufacture agreement.

The expected owner ACL grant-option bits being false are consistent with PostgreSQL's implementation: ordinary owner privileges are self-granted, while owner grant power is treated implicitly rather than stored as explicit ACL grant options. This is primary-source corroboration, **not a native observation**. See [PostgreSQL 18 acl.c, acldefault owner-entry implementation](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/acl.c#L848-L863). Actual target ownership transfer, defaults and ACL expansion still need the separately authorized fixture.

## Actual JS verification

Owned scratch: `D:/starwork/b27r2-source-fbfc48c`, outside the shared repository. No SQL engine/parser was invoked. SQL text was read from the fixed git blob only. The extracted predicate was evaluated as JavaScript RegExp; its success is not PostgreSQL regex execution.

1. Independently ran the FIX handoff's 60-vector × 3-array reproduction using installed modules and real `reserveUpload`/`encodeUploadReservation`. Only adaptation: read the frozen SQL blob instead of a moving shared file. Result: **exit 0, 180 matches, 102 accepted / 78 rejected**. Vectors cover versions 1..8 × four valid variants plus nil/max (34), and invalid versions/variants, uppercase, malformed and trailing data (26). Shared id, source predicate and whole-envelope model/codec outcomes all match expected values.
2. Extended that reproduction with independently assembled B25 text-projection rows for every accepted case. Called actual `decodeUploadReservation`, deep-compared the reconstructed model and compared request JSON, raw SHA, semantic fingerprint, request ID and byte limit with encoder output. Result: **exit 0, 102 projection roundtrips preserved all checked values**. These are the accepted subset of the same 180 cases, not 102 new protocol vectors. Rows are JS fixture objects; no INSERT/SELECT was executed.

Saved scripts/output are `reproduce.mjs`, `reproduce-result.txt`, `decode-projections.mjs`, `decode-result.txt` and the fixed SQL text in that owned scratch. Reproduce from repository root:

```powershell
Get-Content -Raw D:/starwork/b27r2-source-fbfc48c/reproduce.mjs | node --import tsx --input-type=module
Get-Content -Raw D:/starwork/b27r2-source-fbfc48c/decode-projections.mjs | node --import tsx --input-type=module
```

Observed output, respectively:

```json
{"vectors":60,"arrayFields":3,"cases":180,"accepted":102,"rejected":78,"matched":true}
{"vectors":60,"arrayFields":3,"cases":180,"decodedCases":102,"accepted":102,"rejected":78,"matched":true}
```

## Regression and remaining gates

Protected-source comparison enumerated `git diff --name-only dfb521c fbfc48c -- lib/db/postgres lib/storage/uploads package.json package-lock.json` and asserted that the **only** returned path is draft SQL5. Thus SQL1–4, B25, model, closed DB tools and package inputs are unchanged between those fixed inputs. Current SQL5/model/codec/package comparison with fbfc48c also returned exit 0 at verification time. The SQL5 unconditional fuse at lines 4–5 is unchanged; it still raises before role/object creation. Registry integration remains absent. Function/table/policy/trigger counts and the two exact entry boundaries are unchanged.

No new mandatory source gap or regression was found in the assigned delta. The original source observations on policy → owner/request latch → business insertion order, explicit VOLATILE/READ COMMITTED, owner/RLS scope, original-snapshot replay, B25 raw/hash binding and staged-versus-COMMIT separation remain applicable. This delta does not implement or prove them natively.

Remaining unverified gates include actual SQL/PLpgSQL syntax/compilation, PostgreSQL C-collation regex/JSON handling for all three arrays, nil/max whole-envelope committed readback, four-row namespace positive inventory and unexpected default CREATE/USAGE/grantor/grant-option/owner/missing-fact rejection with full rollback. Also retain the full SQL4+5 non-superuser ADMIN/SET cleanup, effective ACL/FORCE-RLS/lock negatives, deferred trigger role/dependencies, concurrency/rollback waiters, fault injection, evolved-history corruption boundary, exact time/hash parity and lost-COMMIT/pool tests. Prior reduced PG18.7/B25 evidence is not a substitute.

Approved policy-body provisioning/provenance, operational limits/budgets, JS client adapter, a complete separately approved version5 descriptor/registry/apply path, Auth/API/provider/runtime and deployment remain separate prerequisites. ASCII wire restriction remains the original explicit draft choice. No database or deployment is authorized by this source-only PASS.

Tester changed only this report and created owned local JS scratch. No SQL submission/parser, connection/cluster, fuse removal, role/grant/default setting, registry, product, package, build, browser, service, provider or deployment action occurred. No new agent/window/worktree. Unrelated T122/T137 WIP was preserved. Only the assigned report is staged/committed, with its selected `git diff --cached --check` as formatting validation.

Copyable return:

> B27-R2 fixed fbfc48c SOURCE-ONLY PASS: F27-1/F27-2 and POLICY clarification resolved in the assigned delta. Independent JS 60×3=180 comparisons matched (102 accepted/78 rejected); all 102 accepted B25 projection roundtrips preserved model/raw/semantic bindings. Native SQL5 was not run or parsed and remains unverified; fuse and protected sources remain intact. This does not approve registry/apply/runtime/deployment. Master final acceptance and a separate owned native scope are required for any next execution stage.
