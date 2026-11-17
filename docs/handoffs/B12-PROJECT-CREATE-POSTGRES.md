# B12 — Unwired PostgreSQL project creation

- Task/owner: B12 (C3 first part) / Codex(Backend); Master `msg_382d226c04aa`.
- Status: **ready_review — implementation and self-verification complete; independent review pending**.
- Pre-delivery shared HEAD: `6e3a9512304f0b62258bcbf39752c9dc1846a74f`. Only the six new B12 paths below belong to this change. Concurrent cloud UI WIP is excluded.
- DEC-SSL-01 boundary unchanged: no production settings/restart/managed write/runner/apply/provision. This task used only new owned synthetic PostgreSQL clusters.

## Scope and existing contract examined

Read existing SQLite `lib/services/projects.ts`, `lib/repo/projects.ts`, current POST `app/api/projects/route.ts`, menu schema/input validation/snapshot serialization, stages, existing project tests, and published PG SQL3. Existing create validates active menu, normalizes fields, checks referenced nonarchived assets/type/file presence and characters, then atomically inserts project, seven stages, links and project.create audit. The POST returns a newly generated ID; owner/email fields are not accepted inputs.

New paths:

- `lib/repo/postgres/project-create.ts`
- `lib/services/postgres/project-create.ts`
- `tests/postgres/project-create.test.ts`
- `tests/postgres/project-create-integration.test.ts`
- `tests/postgres/run-project-create-local.mjs`
- This report.

No existing pool/actor/Auth/adapter/API/UI/shared types/schema/SQL/package/fixture was edited. Creation only: no project save/CAS, worker, Storage implementation, migration/import, or API write activation.

## Equivalence and explicit boundary differences

| Existing behavior | B12 implementation |
| --- | --- |
| Active menu/config snapshot | Caller supplies the trusted server snapshot from validated menu config. Service schema-parses/clones it, checks menu ID and active availability. It never imports menu-file loader, SQLite, startup service or legacy project service. Snapshot must not originate from HTTP. |
| Title/goal/target/aspect/length and remaining fields | Reuses pure `validateProjectInputs`; same trim/numeric conversion/default checkboxes/array rules/unknown-field rejection. Bad actor and invalid input fail before connection. |
| Raw JSON | Uses existing `encodeJson(menuSnapshotSchema, ...)` and `encodeJson(jsonObject, ...)` once before awaits. Published PG TEXT columns retain exact serialized strings; no jsonb reserialization or new hash format/column. Tests compare exact bytes and SHA256 on readback. |
| File presence | Required trusted `assetAvailable(asset, verifiedActor)` dependency for non-link assets, after owner/archive/type validation. Receives frozen owner-scoped asset metadata/key/hash/size; only boolean true accepts. No default true, filesystem or Storage client fallback. Storage implementation remains unassigned; test callback uses synthetic availability only. |
| Reference ownership and archive state | Repo filters every lookup by tx.actorId, ID and archived_at IS NULL; RLS independently applies. FOR SHARE retains checked metadata against concurrent archive/delete until transaction end. Missing/foreign/archived references produce the same field error. |
| Initial project | UUIDv7; contentRevision1, null approved plan/timeline/archive defaults. PG schema requires explicit timestamps; one service UTC ISO time is used for project creation/update, intake approval and audit. No PG schema defaults were added. |
| Initial stages | intake approved, brief todo, remaining five locked. Intake approval timestamp set; all other nullable approval/note values remain defaults. No automatic plan/review approval. |
| Links | Assets preserve field-ID purpose; same asset can appear for distinct purposes. Character links use conflict-do-nothing to deduplicate across different character fields as SQLite does. No confirmed-only character policy added. |
| Audit | Existing literal actor **local-user**, action **project.create**, and detail `{menuId, templateVersion, contentRevision:1}` retained exactly. Verified user identity is separately owner_id; no request actor/email accepted. Audit ID is UUIDv7 and insertion is in the same transaction. This deliberately preserves the existing label rather than inventing a new audit policy. |
| Atomicity/errors | Existing `withActorTransaction` provides one client/BEGIN/dream_api/local verified actor/COMMIT or rollback. Locally issued immutable errors retain known validation fields/status only after healthy rollback; unknown SQL/storage errors become fixed PROJECT_CREATE_UNAVAILABLE503. No legacy error-class import. |

New server API: `postgresProjectCreate(explicitPool, { assetAvailable }).create(verifiedActor, menuId, inputs, trustedServerSnapshot) → Promise<UUIDv7>`. This adds no common interface. Only the existing actor brand is accepted; its constructor is a shape constructor, so the eventual server caller must still supply an Auth-verified user. This module does not resolve Auth or own/close the supplied process pool; the existing transaction helper releases its one client. Pool lifecycle remains the caller's responsibility.

Legacy outer `createProject` startup gating remains unchanged and is not imported into the new path. A future adapter must establish its assigned server readiness/verified Auth/config/storage dependencies; B12 does not claim that routing is ready or opened. Existing POST remains the SQLite implementation.

## Actual verification

| Run | Result |
| --- | --- |
| Dedicated B12 new cluster, final fixture | **20 PASS** =9 preconnection unit +11 actual integration cases (including four parameterized failure points). |
| Existing B4 suite, separate new cluster | **51 PASS**, three files: connection, project-read-backend, project-reads. No fixture/schema collision or existing cluster reuse. |
| Existing SQLite/create and request/backend/GET unit regression | **68 PASS**, five files including new nine unit cases. Counts overlap; do not add them as distinct coverage. |
| ESLint, five new TS/test/runner paths | exit0, no warnings. |
| Original root tsc, `--noEmit --incremental false` | exit0; no config changes/exclusions. |
| Published SQL3 SHA256 | unchanged; values below. |

Actual integration covers normal creation and B4 list/get DTO compatibility; normalized title/length/defaults; exact snapshot/input text+raw hashes; seven stages/approval timestamp; owner-scoped links/audit payload; A/B create/read isolation; foreign/missing/archived/wrong-type/unavailable assets; foreign/archived characters; per-purpose asset/duplicate character behavior; field/owner-injection rejection without DB writes; stage/link/character/audit insertion failure rolling back project and all dependents; caller mutation while storage callback awaits; storage error sanitation; repository/RLS refusal of another actor's resources/project insertion.

The initial run had9 integration failures because the synthetic fixture supplied an English usageRights value outside the real menu's select options. Corrected only fixture input to the existing allowed `직접 촬영`; validation/product rules were not weakened. Initial failure evidence is retained. The subsequent20PASS used the final service code, including strict true storage availability. No independent review is claimed.

Reproduction:

```powershell
node tests/postgres/run-project-create-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
node tests/postgres/run-project-create-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b4
node node_modules/vitest/vitest.mjs run tests/projects.test.ts tests/postgres/project-create.test.ts tests/postgres/project-read-backend.test.ts tests/postgres/project-read-request.test.ts tests/project-get-routes.test.ts
node node_modules/eslint/bin/eslint.js lib/repo/postgres/project-create.ts lib/services/postgres/project-create.ts tests/postgres/project-create.test.ts tests/postgres/project-create-integration.test.ts tests/postgres/run-project-create-local.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The new dedicated runner follows the existing signed-EDB/local-only provisioning pattern, strips inherited PG connection settings, verifies owned listener/PID, and supports only fixed B12/B4 suites. Uses full fsync initialization with120s bound; no installation/service/global setting change. Tests import the existing guarded empty `dream_test_*` fixture. No general DATABASE_URL or managed URL accepted. Existing fixture/runner files were not changed. Production Next build/typegen not run because shared `.next` is protected and no application route/UI wiring changed.

Owned evidence, all stopped (stop logs, pidfile absent, listener count0 verified):

| Directory under tmp | PID / port | Run |
| --- | --- | --- |
| `b12-postgres-f21cd782-7665-4cf5-9d4b-d40e27df8835` |73552 /49354| Initial fixture failure |
| `b12-postgres-16732d06-d0ff-40bf-8de2-53d70ee19a9a` |64572 /55848| B12 final20PASS |
| `b12-postgres-598b0459-dbdf-4301-ab86-46e654d178b5` |75760 /64840| B4 regression51PASS |

SQL3 raw hashes remain `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`, `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`, `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd`.

## Review request and remaining scope

Review verified-actor-only ownership, trusted snapshot/storage injection, exact legacy audit/initial-state contract, raw serialization, safe error retention and dependent-row atomic rollback. Actual Storage object availability/hash checking, managed SQL write/role behavior, production TLS enforcement, request/API integration, actor resolution/pool lifecycle wiring, remaining writes/CAS, files/worker/import and end-user flows remain **unimplemented or unverified** in this task. No assumption of managed readiness follows from synthetic PostgreSQL success. DEC-SSL-01 is not resolved by offline development.

Transfer: **B12 ready_review. New isolated create repo/service accepts verified actor + trusted server snapshot + required storage-availability callback; preserves validation/UUIDv7/raw snapshot-input text/seven stages/link purposes/legacy audit and one actor transaction. Actual new PG20PASS, separate existing B4 PG51PASS, focused68PASS, lint/tsc0, publishedSQL3 unchanged. Initial fixture enum failure corrected without product relaxation; all3 owned clusters stopped/listener0. Existing API/Auth/pool/SQL/package/WIP/3013/.next and managed environment untouched; fixed-SHA independent review requested.**
