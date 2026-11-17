# B15 — Real-row Storage verification adapter

- Task/owner: B15 / Codex(Backend), Master `msg_9d647b7793a2`.
- Status: **ready_review — unwired server adapter and self-verification complete; independent review pending**.
- Last verification **2026-11-17 21:21:00 KST**; pre-delivery shared HEAD `20e7e2758100fe8f3cb7910b612263564b9b8773`.
- B14 fixed `ba3ad44` local trusted-privateRoot contract accepted per Master `msg_1e05cdefa90e`. No B14 reader/config/key/media/gateway file was edited. B12 service/create behavior preserved; only its allowed repo DTO/query was extended.

## Exact changes

Five owned paths:

1. `lib/repo/postgres/project-create.ts`: adds actual `owner_id` and `mime` to existing owner-filtered, nonarchived FOR SHARE SELECT. Returned DTO adds ownerId and nullable MIME from **row fields**, with owner string/match and MIME null/string validation. No actor-ID substitution, MIME derivation, metadata assertion or fallback.
2. New `lib/services/postgres/project-create-storage.ts`: trusted server factory `postgresProjectCreateWithStorage(pool, reader, {ioTimeoutMs})`, returning create(actor,menuId,inputs,trustedSnapshot,signal?). Uses existing B12 create and B14 runtime OwnedStorageAsset/stream verification path.
3. `tests/postgres/project-create-storage-integration.test.ts`.
4. New `tests/postgres/run-project-create-storage-local.mjs`: fixed B15 suite or separate `b12` regression, new local cluster only.
5. This report.

No Auth/API/UI/default opt-in/pool implementation/schema/SQL/package/env/managed setting change. Other `tests/t164-export-ui.test.ts` WIP and unrelated handoffs excluded from this commit.

## Authority / data / transaction flow

Existing B12 validates actor/menu/input, enters its one actor transaction, and gets reference metadata through owner_id predicate + RLS + FOR SHARE. The mapper now returns the actual owner_id/MIME and refuses absent/wrong owner or malformed driver values. Non-link data then goes unchanged to B14's availability gateway/reader: required runtime owner match, canonical owner/id/hash key, supported explicit MIME, actual downloaded bytes/size/SHA and media validation. All must pass before the project's insert sequence.

Returned nullable MIME is **not** treated as a default. Null/missing/unsupported MIME cannot become image/png from kind. Wrong/missing ownership is not repaired from actor. Foreign/missing/archived rows remain unavailable through the original lookup. Canonical key mismatch and field failures cause Storage network0 (including bucket metadata requests), not an arbitrary endpoint request. Reader configuration/credential is supplied by trusted server composition, never HTTP or environment discovery in this adapter.

B12's project creation/title normalization/raw snapshot/input serialization/UUIDv7/revision1/seven stages/links/character dedup/audit are unchanged. Its link skip is preserved: eligible optional link references do not invoke the image/video reader; a link still cannot satisfy required productAssets image/video. New adapter supports the B14 image/video subset, not all future library media formats.

The B14 baseline's DTO-gap comment describes its pre-B15 integration state; that protected file was intentionally not rewritten during/after its review. Actual B15 repo now carries the fields. This new factory is still not connected to an HTTP route or a process-default creation path.

## Request-local IO/cancellation lifetime

- Explicit ioTimeoutMs integer1..10000, snapshotted once, with no default. It bounds each create's IO/continuation signal below the existing pool's15s idle-transaction limit; starts before pool acquisition. B14's own limits/admission still apply.
- Each call owns its controller, timer, request listener, scoped client view and callback. Shared factory/reader has no mutable current request signal. Concurrent cancellation isolation was tested.
- The scoped pool delegates to the supplied real pool and does not edit it. Pre-abort avoids acquisition; abort after acquisition releases the client. A client proxy forwards the real query/event/release behavior, but refuses **new** statements after cancellation, including COMMIT. ROLLBACK is explicitly allowed so the original transaction helper can unwind writes.
- Reader receives that operation signal. Timeout/abort while metadata row locks are held cancels download; B14 settles/cleans its work, then B12 rolls back/releases. No synthetic always-true callback is used in this adapter.
- No post-COMMIT abort check invents failure after a confirmed commit. If commit already succeeded, its ID remains a successful durable result. In-flight COMMIT uncertainty and connection loss remain the existing transaction helper's uncertainty contract; cancellation cannot undo a committed row or provide new create idempotency semantics.

**Limit:** this is not hard cancellation of an already executing PG statement. Existing query/statement bounds remain applicable; native media timeout granularity and awaited OS file cleanup can outlive the nominal IO signal. Under abnormal OS stalls or long SQL, do not promise every row lock disappears exactly at the IO deadline. No pool timeout/global setting was changed. Point-in-time object verification cannot prevent later cloud mutation/deletion; actual immutable upload/lifecycle policy is still missing.

## Actual verification evidence

| Execution | Observed result |
| --- | --- |
| Final B15 new synthetic PG + real installed SDK/native HTTP fake | **19PASS**, one integration file, no managed connection. |
| Earlier B15 iteration |18PASS; later added pre-abort acquisition check and made timeout test wait for real object IO before expiry. Final19 supersedes it. |
| Original B12 suite in separate new cluster | **20PASS**, preserving accepted create/reference/stage/audit/raw JSON and rollback contract with additive DTO. |
| Focused B14/B12/connection/backend regression | **97PASS /4files**. Overlaps the original B12 unit9 and B14 suite46; do not sum all counts as unique coverage. |
| Scoped ESLint / original root tsc noEmit | Both exit0, lint0 warnings/errors. |
| Published SQL3 raw hashes | Unchanged. No build/typegen due protected shared `.next`; no route/UI change. |

B15 actual cases:

- A's actual DB owner/MIME row + canonical object verified through the installed B14 SDK stream, then project creation; B4 list/get, seven states, nextStage/status, link owner/count, legacy audit fields and snapshot/input raw hashes compatible.
- B's real row inaccessible under A, missing row, corrupt MIME text, noncanonical key: zero Storage HTTP requests and no changes. B can create using its own row; A cannot read that project.
- Null/missing MIME, absent/wrong owner defensive mapper tests: actual PG query runs, then a test-only client proxy corrupts its returned row. **Published DB constraints already forbid non-link null MIME/missing owner**, so these are explicitly driver-row fault injections, not claims that such invalid physical rows were inserted under unchanged SQL. All refuse with Storage network0.
- Actual DB size/hash/declared-type disagreement with bytes: fixed safe invalid-input result, no project/dependent writes. Storage404 versus401: unavailable reference versus fixed503, no provider body/key/SQL text escaping.
- Time-bound IO test waits until object GET has actually started after the asset SHARE lock, expires300ms budget, then confirms rollback/no rows/scratch clean and immediate FOR UPDATE NOWAIT availability.
- **Actual lock contention:** another real connection's UPDATE is observed waiting with wait_event_type=Lock while download holds FOR SHARE. Request abort releases/rolls back; waiting UPDATE completes; fixture archive flag restored.
- Real verification success followed by a late audit trigger failure rolls back project/stages/links/audit. Cancellation after real audit insertion but before COMMIT also rolls back all. Cancellation delivered after confirmed COMMIT returns the valid committed ID, not a false rollback error.
- Same shared adapter, concurrent A/B requests: cancel A only; B still verifies and commits. Optional links skip Storage; required product image cannot be replaced by a link. Pre-abort has PG connect0/Storage network0. Budget configuration is explicit/bounded.

```powershell
node tests/postgres/run-project-create-storage-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
node tests/postgres/run-project-create-storage-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b12
node node_modules/vitest/vitest.mjs run tests/storage-private-read.test.ts tests/postgres/project-create.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts
node node_modules/eslint/bin/eslint.js lib/repo/postgres/project-create.ts lib/services/postgres/project-create-storage.ts tests/postgres/project-create-storage-integration.test.ts tests/postgres/run-project-create-storage-local.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Owned PG evidence under tmp, all stop logs/pidfile absent/listeners0 verified:

| Run directory | PID / port | Result |
| --- | --- | --- |
| `b15-postgres-3a71d345-7ce5-49d4-94eb-6c7bb1221a0e` |11120 /63028| Initial18PASS |
| `b15-postgres-856c3e1a-ffe1-4535-9eb1-b7dea8052149` |79220 /65527| B12 regression20PASS |
| `b15-postgres-1bba4e9c-fa01-45d8-ada9-e4a5cc16f456` |13320 /63753| Final19PASS |

HTTP servers/connections closed, synthetic PNG/scratch roots removed after boundary checks, final b15-storage-* directory count0. Only synthetic asset DB rows were provisioned inside these fresh fixtures; no real DB registration or object upload. SQL3 SHA256 remains `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`, `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`, `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd`.

## Independent review / operational boundary

Review actual-row provenance and nullable field failure, actor/RLS/key checks, no-network negatives, per-request lifetime/client proxy release/rollback, pre-/post-COMMIT cancellation distinctions and accepted B12 behavior. B14 trusted privateRoot/OS access control is a premise: external cleanup refusal is not a guarantee against an operator able to replace local roots/junctions. Service-role access still bypasses Storage RLS; application owner checks are mandatory.

Real private Storage bucket/ownership/RLS, immutable uploads, upload byte/type/hash verification, production asset registration, actual service credentials/config, deployment filesystem/budgets, API/Auth/readiness wiring and managed behavior remain absent/unverified. This adapter does not authorize cloud-create opening or SSL/restart/apply/provision. No B14 source or existing pool/Auth/SQL/package/env/Front code/3013/.next was modified.

Transfer: **B15 ready_review. Repo returns actual owner_id/MIME with owner/RLS checks; isolated request-local adapter feeds B14 strict metadata+real stream verifier without defaults/assertions. New actualPG+SDKfake19PASS, original B12PG20PASS, focused97PASS, lint/tsc0, SQL3 unchanged. Actual SHARE contention/cancel/timeout/late-audit and pre-COMMIT rollback proved; confirmed-COMMIT result preserved. All own clusters/server/scratch closed. B14-R local trust premise acknowledged; real Storage/upload/RLS/DB registration/API/managed/SSL readiness not claimed. Fixed-SHA independent review requested.**
