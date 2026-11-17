# B30-R — Independent native wire, UUID and epoch review

**Verdict: PASS for the assigned 317-record local PostgreSQL 18.7 matrix.** Independently ran the unchanged fixed runner once, exit0; inspected source, layer-specific evidence, native causes, committed projections and OS cleanup. No mandatory SQL/contract gap found in this bounded matrix. Master retains final acceptance; this is not full protocol, registry/apply/runtime, managed migration or deployment approval.

Reviewer: Codex(Tester), separate from Backend. Master assignment `msg_0cd660c78d44`, acceptance receipt `msg_789485baa42b`. Date: 2026-11-18, Asia/Seoul. Only this report is edited in the repository.

## Fixed inputs and execution

| Input | Independently verified evidence |
| --- | --- |
| Author fixed commit | `ee709a6c8b1e148ccf7c74dbd00884810ba9345e` |
| Runner | `tests/b30-reservation-wire-native-owned.ts`; LF SHA256 `8ec4f01297c4e2befd5a67eeb519829a8eb6aaef3776d1375f1d0a54247655b7` |
| Handoff | `docs/handoffs/B30-RESERVATION-WIRE-NATIVE.md` at ee709a6, read in full |
| Original SQL5 | fbfc48c95264eaf37826f943b5e35e9fe67fa616; LF SHA256 `9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb` |
| Owned derivative | LF SHA256 `16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e` |
| Engine | Existing signed `.tools/b3-postgres-18.7/pgsql/bin`; PostgreSQL18.7 / Windows x86_64-msvc-19.44.35229, Node26.13.0 |
| Reviewer evidence root | `D:/starwork/dream-ai-studio/tmp/b30-native-c7edae3f-1e2b-4ace-a812-ba811f43a990` |
| Review scratch | `D:/starwork/b30r-review-ee709a6` |
| Owned server | **PID40400 / sole listener 127.0.0.1:63911**, owned directory/PID/port verified |

Before execution, compared runner, postgres sources/tools, upload model, package and lockfile to ee709a6: no differences. Recalculated runner/SQL5 pins. Hashed installed pg/tsx/Zod dependency packages recursively: 18 packages /1,018 files; manifest SHA256 `8932ae815952cb474f18702569078807bccdaa877602930016a47620fad776d5`, retained with preflight hashes in review scratch. Existing pg8.23.1/tsx4.23.15/Zod4.6.7 were used; no installation or runner/path-check workaround.

Actual command, from repository root:

```powershell
node --import tsx tests/b30-reservation-wire-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

Actual result **exit0 /317 records matched /stopped=true**, retained as review-scratch `run.log`. postgres/initdb/pg_ctl each verified Valid EnterpriseDB signature and engine18.7. New UTF8/C SCRAM cluster and explicit loopback connections with synthetic credentials only; no existing database/service, env file/external DSN or real credentials used. Synthetic secret text was not printed or committed.

## Initial author pin failure: audited, not replayed

Read the preserved `first-failure.json`, cleanup record and `harness-before-hash-pin-fix.ts` under `tmp/b30-native-cdf03867-3887-4f28-a256-918d271ad256`. The failure is source verification of SQL2, without a SQLSTATE/native DB error. Independently diffed that saved runner against ee709a6: **the only difference is `defdb30a6cfa100` restored to approved `defdb29a6cfa100` in the SQL2 hash**. This equals the already accepted SQL2 pin used before B30 and the unchanged protected SQL2, rather than an expectation learned from a target.

Initial root has no cluster, run.json or initdb.log. Its PID0/port0, completed=false, postmasterPidAbsent=true/listenerAbsent=false describe failure before listener allocation; no started listener required cleanup. Preserved this distinction from the successful author run and this independent run. Did not insert the wrong pin, recreate that failure or create an extra cluster. The inspected one-line diff is retained as review-scratch `initial-pin-correction.diff`. Master's B30-R assignment explicitly directed this record-only verification and approved-pin review.

## Source/derivative integrity

Runner verifies all accepted SQL1–4 hashes before startup, including SQL2 `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`; SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`, SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`, SQL4 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`.

Independently matched saved SQL5 original to fixed git source, verified one known fuse and **exactly its87 characters at offset252 removed**, retaining newline/543 lines; derived hash and exact reinsertion match. Full original SQL1–4 plus whole derivative execute as the actual nonsuperuser migration login. No SQL statement/guard/inventory expression is patched or skipped. Original repository SQL5 retains fuse/hash. The owned scratch derivative execution permission applies to this B30-R run only.

## Execution layers and verified counts

| Layer/group | Nonerror outcomes | Expected data rejections | Records |
| --- | ---: | ---: | ---: |
| Management policy UUID | 102 | 78 | 180 |
| Management parse_wire | 8 | 27 | 35 |
| Management canonical_json | 13 | 8 | 21 |
| Management STRICT SQL NULL | 1 | 0 | 1 |
| Management client grammar | 18 | 27 | 45 |
| Management epoch | 24 | 6 | 30 |
| Restricted entry/actual COMMIT | 5 | 0 | 5 |
| Total | 171 | 146 | **317** |

**312 are management helper queries**, actual b30_migration/OID16389/backendPID57948, invoking helpers it owns. They characterize data/arithmetic behavior and do not prove helper EXECUTE access through dream_api. **Five are dedicated restricted-entry transactions**, actual separate b30_api/OID17837/backendPID60260, with native nonsuperuser/no-BYPASSRLS/no-CREATEROLE flags. Repeated vectors/shared-codec assertions are not counted as additional uploads or concurrency cases. STRICT SQL NULL's nonerror outcome is not a valid upload/policy-body acceptance.

### UUID matrix

All60 vectors ×3 fields are actual `policy_v1` calls, with expected positive policy JSON compared as well as acceptance. Versions1..8 ×four valid variants and nil/max:102 accepted. Versions0/9/a..f, invalid variants, uppercase, malformed/trailing text:78 rejected. Actual shared lowercase id schema, B19 model and B25 whole-envelope encoder are invoked for every vector by the frozen runner; all agree. Reviewer independently checked identical60-vector order/outcomes across verifiers/collectors/policyManagers and exact positive native policy contents. This proves syntax compatibility for the matrix, not actual Auth/provisioned authority rights for nil/max or other IDs. Record IDs remain unchanged UUIDv7.

### Wire, canonical, client and actual negative causes

Wire positives preserve ASCII escapes/decoded key, quote/backslash/slash, whitespace/order, nested boolean/null/array values and unsigned integers through MAX_SAFE. Literal and decoded duplicate keys at root/nested/in-array boundaries are rejected with **22023/B27_INPUT**. These are actual decoded-key negatives, not byte-string duplicate checks alone. Independently parsed positive values and canonical strings and compared them with retained native outputs.

Depth16 accepted/depth17 rejected in both helper paths, matching the root-at-depth0 convention. Wire inputs are independently measured **65536 UTF8 bytes accepted /65537 rejected**, using a valid object padded with ASCII whitespace. They test the generic wire helper, not a closed reservation envelope of that shape. The ASCII fixture's byte count also equals its JS character count; it is not full generic Unicode parity. Printable-ASCII/control restrictions remain the explicitly accepted draft choice.

SQL NULL bound as a parameter returns SQL NULL through STRICT without executing parse_wire's body. JSON text `null` instead receives **22023/B27_INPUT** because wire input must be an object; canonical_json intentionally permits JSONnull/scalar/array forms. canonical_json is not a standalone duplicate-key validator: required parse_wire checks precede it on entry paths. No duplicate-acceptance claim follows from the scalar helper tests.

All146 negatives are data-class22, specifically **144×22023**, **1×22021** and **1×22P05**. Literal NUL text transport produces22021/invalid UTF8 byte0x00 **before helper-body validation**, and therefore supplies no policy-body-validation evidence. The direct canonical helper's escaped-NUL extraction produces22P05/unsupported Unicode escape; this too is not evidence of an explicit policy UUID predicate. Other tested wire control/surrogate/number/shape/depth/length and client cases reject as22023. No permission, syntax or timeout error was counted as an expected malformed input. The runner accepts the22 class for negatives; reviewer checked the actual per-label native codes/messages to substantiate these causes.

Client positives are the six allowed MIME values ×bytes1/1024/2147483648; negatives cover the frozen exact-order/no-whitespace/no-escape grammar, integer forms/ranges, type/version and duplicate/unknown keys. Inputs of160/161 spaces are invalid grammar too: their rejection does not isolate only the byte-limit branch or invent a valid160-byte client. No client JS adapter/browser normalization is implemented or tested here.

### Exact epoch and restricted commits

For **UTC, Asia/Seoul, America/New_York**, helper inputs0,1,86399999,86400000,86400001,MAX_SAFE−2,MAX_SAFE−1,MAX_SAFE all return exact numeric text; −1 and MAX_SAFE+1 reject in each zone. Runner compares integer components with BigInt, with optional fractional zeros only. Reviewer independently validated retained strings with arbitrary-precision integer comparison; no Date/full-epoch float or bigint-rounding cast. Extreme results include `0.000000` and `9007199254740991.000000` in all zones. These are24 helper accepts/6 rejects, **not maximum/future/expired entry admission tests**.

Restricted workflows use representative version1/version7/version8/nil/max in all three policy arrays, fresh current seeds and synthetic finite policy limits. The bootstrap seeds and sequentially advances fixture policy facts; runtime entry calls use the separate restricted login. This is not a policy-advance race or policy-administration executor.

Each of five raw envelopes has escaped codecVersion key, ASCII bucket character and slash plus outer whitespace. Actual B25 encoder confirms semantic equality with unescaped text but different raw SHA. Native return is staged/commitConfirmed=false/issuanceAuthorized=false; COMMIT command is actually confirmed before native text projections and actual B25 decode/model/raw/hash comparison. **All five commits/roundtrips pass**, totals5 requests/5 objects/5 intents/capabilities0. Reviewer independently recomputed raw/plain SHA and ASCII-fixture semantic domain digest from retained entry envelopes and checked originalEnvelope/authority/policy bindings. No pristine decoder is claimed to support evolved rows; no lost-response outcome is simulated.

## Cleanup, preservation and limits

Cleanup-safe records PID40400/port63911, completed=true/postmasterPidAbsent=true/listenerAbsent=true. After process exit, Tester independently confirmed **OS PID count0**, **listener count0**, and **owned postmaster.pid absent**. Stop/listener logs remain; no forced termination or redundant stop was needed. Data/logs are retained for review, with the server stopped. Successful run has no first-failure or cleanup-failure record.

Review scratch retains preflight/dependency hashes, original author pin-correction diff, run.log, read-only `inspect_evidence.py` and independent-evidence-summary.json with per-label negative causes, layer counts, exact epochs, entry hashes and cleanup. Runner root retains all original/derived sources/derivation, signatures/version/ownership/listener, checks/counts/totals/identities and shutdown logs. No supplemental native fixture was necessary; the inspector only reads evidence/fixed git blobs.

Post-run comparison again finds B30/B28/B29 runners, postgres source/tools, model/B25 and package/lockfile unchanged relative to ee709a6. Only assigned report is staged/committed with selected whitespace check; T122/T137 WIP preserved. No existing service/cluster, shared3013/.next, real env/credentials, managed/registry/runtime/API/provider/Storage, build/deploy, install or external settings touched. No new agent/window/worktree.

Remaining unverified includes expired/evolved replay, broader policy/lock races, full generic canonical/node/object-key limits beyond these vectors, every possible Unicode/NULL/type combination, B3/real Auth/pool behavior, uncertain/lost-COMMIT response, provider late writers/operating budgets, other deployment majors and complete v5 descriptor/registration/apply/runtime/managed integration. This bounded matrix and the separately accepted B28/B29 results do not authorize operational admission.

Copyable return:

> B30-R fixedee709a6 independent PASS: one new owned PG18.7 run exit0/317 records, strictly312 management helper vectors plus5 restricted real COMMITs. Native UUID180 agrees with shared/B19/B25; wire/client/canonical expected data errors, decoded duplicates/depth/bytes and exact epoch text across3zones verified. SQLNULL STRICT differs from JSONnull; NUL transport22021 proves no helper/policy-body validation. Five native B25 projections/model/raw/hash plus independent digest checks pass. Author initial failure audited as only restored approved SQL2 pin before DB startup, not recreated. PID40400/127.0.0.1:63911 stopped, OS PID/listener0/pidfile absent; source/fuse/protected files unchanged. Broader gates remain; Master final acceptance required.
