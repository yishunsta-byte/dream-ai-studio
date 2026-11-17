# B30 — Native reservation wire, UUID and epoch boundaries

Status: **author native PASS for the bounded matrix; independent review pending**. Master assignment `msg_45d1b55d6c21`, receipt `msg_e5e359b05c34`. B29's three races were accepted after independent report `b0ae405`; they are not rerun or expanded here. Only `tests/b30-reservation-wire-native-owned.ts` and this report are added.

## Invocation history, including the initial harness failure

```powershell
node --import tsx tests/b30-reservation-wire-native-owned.ts --bin .tools/b3-postgres-18.7/pgsql/bin
```

There were **two runner invocations, one initialized cluster**:

1. First invocation: **exit1 before binary checks/initdb/any DB connection**, stage source verification. Copying B29's preparation code with a broad name replacement accidentally changed the SQL2 expected hash's `defdb29` substring to `defdb30`. Wrong harness constant: `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb30a6cfa100`. Actual/previously approved SQL2 hash remained `1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100`, with zero protected-source diff. Only that erroneous test constant was restored to the approved pin; the expectation was not learned from a target or relaxed and SQL was not edited. Master acknowledged this tooling correction in `msg_65abbbc7d3dd`.
2. Second invocation, with the approved pin: **exit0**, all **317 counted results matched**. No original SQL/contract mismatch or unexpected native failure occurred. No source workaround or further native rerun followed.

Initial evidence remains at `tmp/b30-native-cdf03867-3887-4f28-a256-918d271ad256`: `first-failure.json`, `checks-at-first-failure.json`, `harness-before-hash-pin-fix.ts`, `cleanup-safe.json`. PID0/port0, postmasterPidAbsent=true, listenerAbsent=false, completed=false mean **no listener was allocated/started; listener cleanup was not applicable**, not a live failed-cleanup server. That initial failure is not counted as a native SQL defect or hidden by the later success.

## Frozen inputs and isolation

| Artifact | Fixed identity |
| --- | --- |
| SQL5 | B27-FIX `fbfc48c95264eaf37826f943b5e35e9fe67fa616`, LF SHA256 **9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb** |
| Scratch derived SQL5 | LF SHA256 **16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e** |
| Corrected executed runner | LF SHA256 **8ec4f01297c4e2befd5a67eeb519829a8eb6aaef3776d1375f1d0a54247655b7** |
| Native engine | Existing EnterpriseDB-signed portable **PostgreSQL18.7**, Windows x86_64/msvc-19.44.35229; Node26.13.0 |

All SQL1–4 accepted hashes are checked before cluster startup, including the unchanged approved SQL2 pin above. SQL1 `3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19`; SQL3 `7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d`; SQL4 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`.

Before execution, the runner verifies one exact known unconditional fuse and removes **only its 87 characters at offset252** in an owned scratch copy, preserving the newline. Reinsertion must reconstruct the original exactly. The repository fuse is untouched. `derivation.json`, saved original/derived source and exact diff preserve this special B30-only permission:

```diff
--- fixed-fbfc48c.sql
+++ B30-owned-derived.sql
@@ -5 +5 @@
-DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;
+
```

Successful native evidence root: **D:/starwork/dream-ai-studio/tmp/b30-native-a80966ce-6daf-4459-9b27-bc4e2ed05e32**. New postmaster PID **76032**, verified sole listener **127.0.0.1:51765**. Authenticode signatures and version were checked; UTF8/C-locale SCRAM cluster and one fresh database were initialized. Full SQL1–5 ran as actual nonsuperuser CREATEROLE migration login. No existing cluster/service, OS installation, PATH change, shared3013/.next, app/browser or managed database was used. No `.env`, external DSN or real credential was read; synthetic password text is neither reported nor committed.

## Execution layers and exact counts

These counts distinguish **management helper query vectors** from **restricted entry workflows**. Repeated inputs across helpers are separately counted queries, not independent upload cases. The UUID JS comparisons and entry projection/decode checks are constituent assertions, not extra cases.

| Layer/group | Accepted/matched | Expected rejected/matched | Count |
| --- | ---: | ---: | ---: |
| Management policy_v1 UUID matrix | 102 | 78 | **180** |
| Management parse_wire_v1 JSON vectors | 8 | 27 | **35** |
| Management canonical_json_v1 vectors | 13 | 8 | **21** |
| Management STRICT SQL NULL behavior | 1 | 0 | **1** |
| Management client_v1 canonical grammar | 18 | 27 | **45** |
| Management epoch numeric-text matrix | 24 | 6 | **30** |
| Separate restricted entry/COMMIT workflows | 5 | 0 | **5** |
| **Total** | **171** | **146** | **317** |

Management subtotal is **312 query vectors**, executed as `b30_migration`, native OID16389/backendPID67744. That role owns the INVOKER helpers. These direct calls characterize validation/arithmetic and **do not prove API runtime helper access**. The SQL-NULL query returns NULL through STRICT without running the helper body; literal NUL is rejected at text transport with native22021. Both are explicitly distinct from a valid public upload input or helper-body success. Other negative data cases returned native data-class22 errors (typically22023); permission/syntax/timeout errors would fail the harness instead of being counted as expected data rejection.

### UUID compatibility

The original B27-FIX **60 vectors × three authority fields** (`verifiers`, `collectors`, `policyManagers`) were submitted to actual `policy_v1`. Positives: versions1..8 × variants8/9/a/b plus nil/max, 34×3=102. Negatives: versions0/9/a..f, invalid variants0..7/c..f, uppercase, malformed/trailing data, 26×3=78. Each vector also runs against installed shared lowercase `id`, actual B19 `reserveUpload` and actual B25 whole-envelope encoder. All outcomes agree. Native positive policy JSON is also compared to the expected body, not merely regex acceptance.

Nil/max acceptance is existing syntax compatibility; it does not establish a real authenticated/provisioned authority. Record IDs remain UUIDv7. No shared model/dependency/codec grammar is changed.

### Wire, canonical and client grammar

Native wire positives cover empty object, whitespace/key-order changes, ASCII-decoded escaped key/value/quote/backslash/slash, nested arrays/booleans/JSONnull, integer zero and MAX_SAFE. Negatives cover literal and decoded duplicate keys at root/nested/in-array levels; JSONnull/root arrays/scalars; literal/escaped non-ASCII; escaped and literal NUL; high/low/unpaired and non-ASCII surrogate pair; decoded control; -0/negative/exponent/fraction/over-safe/leading-zero/plus numeric tokens; trailing data and bad escape. Depth16 accepts, depth17 rejects. A whitespace-padded valid object at **65536 UTF8 bytes accepts**, **65537 rejects**. These are generic-helper vectors, not assertions that arbitrary generic objects satisfy the closed reservation schema.

Canonical helper additionally accepts its intended scalar/null/array forms and rejects numeric/ASCII/depth violations. Duplicate-key rejection is checked at the mandatory parse_wire validation boundary; canonical_json is not claimed as a standalone duplicate validator. SQL NULL via STRICT is kept separate from JSON text `null`. Printable-ASCII restriction is the existing draft choice: Unicode/control rejection is not represented as full Unicode compatibility with every generic B25 string.

Client positives cover **all six existing MIME strings × bytes1/1024/2147483648**. Negatives cover zero/-0/negative/over-2GiB/over-safe/leading-zero/plus/fraction/exponent/quoted number, unsupported/case-changed/escaped MIME, wrong key order, leading/trailing/interior whitespace, wrong version/type, duplicate/escaped/unknown key, JSONnull/array/empty and160/161-space inputs. The last two are invalid grammar as well as bounded-input probes; they do not invent a semantically valid160-byte client. The canonical key order and exact no-whitespace grammar remain unchanged.

### Exact epoch text in three timezones

Actual session zones: **UTC, Asia/Seoul, America/New_York**. In each, positive bigint inputs are `0`, `1`, `86399999`, `86400000`, `86400001`, `9007199254740989`, `9007199254740990`, `9007199254740991`; negative inputs are `-1`, `9007199254740992`.

The query is `(extract(epoch FROM dream_reservation.epoch_ms_v1($1::bigint))*1000)::text`. Returned text must contain only the exact integer and optional zero fractional digits; its integer component is compared with **BigInt**. No JavaScript Date, full-epoch float conversion or bigint-rounding cast is used. Every zone returned `0.000000` and `9007199254740991.000000` at the extreme positives, with all intermediate exact values matching. Maximum epoch values are **helper-only**; no stale/future preparation guard was bypassed to reserve them.

## Separate restricted entry proof

Actual separate LOGIN **b30_api**, backendPID**476**, nonsuperuser/no-BYPASSRLS/no-CREATEROLE, uses local dream_api/fixture owner GUC in five dedicated transactions. Synthetic policy versions advance monotonically through existing guarded pointer updates, with representative authorities **version1, version7, version8, nil, max** in all three arrays. Each uses a fresh current DB seed and finite synthetic limits; management seeds policy facts but does not execute runtime reservation.

Each actual envelope contains normal permitted raw escaping: decoded `codecVersion` key escape, incoming-bucket ASCII character escape and path slash escapes plus outer whitespace. The actual B25 encoder confirms semantic fingerprint equals its unescaped counterpart while raw SHA differs. Native reserve returns staged/commitConfirmed=false/issuanceAuthorized=false; actual **COMMIT is then confirmed**. Native committed B25 text projections are decoded and their complete original model, exact escaped raw text, raw SHA and fingerprint equal encoder results. **Five commits/five native projection roundtrips passed**; final ledger/object/intent counts are5/5/5, capability rows0.

This is not verified Auth/B3 integration or an authority-rights claim for nil/max. It preserves pristine-only decoding, separates provisional API output from confirmed COMMIT, and exercises no expired/evolved/concurrent/lost-response path. No signer/provider/Storage/API-app action occurs.

## Checks, retained evidence and limits

Focused checks passed after the pin correction and before native execution:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck tests/b30-reservation-wire-native-owned.ts
node node_modules/eslint/bin/eslint.js tests/b30-reservation-wire-native-owned.ts --max-warnings 0
```

`checks.json` preserves each management input/expected/actual result/native error and each restricted workflow; `counts.json` preserves the execution-layer counts; `totals.json`, `helper-identity.json`, `principals.json` preserve native identities/data. `ownership.json`, `run.json`, `derivation.json`, saved original/derived SQL and diff, signatures/version/listener logs identify engine/source/ownership. `stop.log`, `stopped-listener.log`, `cleanup-safe.json` preserve shutdown. Successful-run evidence has no unexpected first-native-failure file. Initial tooling failure remains separately preserved as described above.

Actual successful-run cleanup: **postmasterPidAbsent=true, listenerAbsent=true, completed=true** for PID76032/port51765. Data/logs remain for inspection. Protected SQL1–5/model/B25/package/registry/runtime and B28/B29 runners/reports were compared unchanged; selected diff whitespace check passed. Only this report and new B30 runner are committed. No new agent/window/worktree, build/deploy, global/default ACL setting or operating environment change was made.

Not covered: expired/evolved replay, policy/lock concurrency beyond prior separately accepted tasks, B3/Auth/pool handling, actual lost/uncertain COMMIT response, provider late writers/operational budgets, other PG majors, complete version5 descriptor/registration/apply/managed deployment. No operational readiness claim follows. Return is a fixed author matrix for separately assigned Tester review, not independent acceptance.
