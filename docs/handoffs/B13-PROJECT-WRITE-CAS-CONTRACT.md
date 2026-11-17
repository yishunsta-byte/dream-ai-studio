# B13 — Project/stage write and CAS contract

- Task/owner: B13 / Codex(Backend); Master `msg_3bd5a0ccf554`.
- Status: **ready_review — design only, no implementation or new DB experiment**.
- Source read/check: 2026-11-17 **20:44:28 KST**; latest scope/acceptance messages checked **20:47:13 KST**. Source checkout then `2b64bb6181206a4764ff780294fd65ade8a9d771`.
- B12 fixed `83affcf` accepted within unwired server-create scope per Master `msg_f806fe42678b`; Storage priority `msg_5ffe5d8de143` incorporated. No B12 code change needed or made.
- Only this report may change. Auth/T213/B12/SQL3/package/3013/shared `.next`/managed environment untouched. DEC-SSL-01 and live operations remain separate and pending; no operational action inferred from this design.

## Recommendation and actual opening prerequisite

**One minimal CAS implementation candidate: PostgreSQL `planning.confirmBrief` parity only**, as an unwired server operation. It is the smallest existing post-create write and unlocks the prerequisite for later plan save. Do not add generic project metadata update, arbitrary workflow action dispatch, content-mutation callbacks, plan approval, or API opening to that task.

**Actual cloud-create opening priority is Storage first**, as Master has decided. Active shopping-shorts requires `productAssets` image/video, min1; B12's real Storage-backed `assetAvailable` is absent. Therefore normal C3 cloud creation cannot be opened yet. Never default the callback to true, weaken required fields, or use link-only substitution. Ownership-scoped Storage object access, immutable object/version policy, upload byte/type/size/hash verification, Storage RLS/access policy, and owner-bound DB asset registration must be implemented and independently checked in Master's separate Storage assignment before opening. No bucket/resource/upload implementation or new shared Storage interface is proposed in this report.

The brief candidate is independent offline work, not a substitute for that prerequisite. Master can schedule it after the Storage scope is assigned; this report does not start either implementation.

## Sources and authorization boundary

Read `lib/services/{projects,planning,workflow,production,timeline,editing,review,library,renders}.ts`, relevant exports/jobs call paths, matching project/workflow/planning/timeline/library repositories, workflow/timeline/production routes, pure stages/menu validation, `lib/db/timeline-data.ts`, published PostgreSQL SQL3, SQLite ownership/immutability rules and existing workflow/planning/timeline test assertions. PLAN §§5.1–5.3,6.1,11.2 establish the gates, snapshots, revision/invalidation and immutable-version behavior. Reading assertions is not rerunning those tests; B13 claims no test PASS.

Existing HTTP write routes call `requireApiAuth`, strict body schemas and startup wrappers; SQLite services access the local database without tenant owner predicates. PostgreSQL port must instead require server-verified actor, owner predicates and `dream_api` actor RLS inside the existing actor transaction. No owner/email supplied by HTTP may become authority. This report does not alter Auth, API, startup or pool lifecycle.

## Current service/function contract map

All SQLite `atomic`/save operations below use immediate transactions; nested service transactions participate through SQLite savepoints. PostgreSQL equivalents must flatten into one actor client transaction instead of nesting the existing non-nestable actor helper.

| Function / actual trigger and input→output | Checks / current revision condition | Transaction writes / follow-up read |
| --- | --- | --- |
| `projects.create`; POST menuId+inputs→UUIDv7 | Active menu, field validation, eligible reference/file checks; no expected revision on new row | Project revision1,7stages, project links, audit atomically. B12 already ports this unwired; B4 list/get compatibility measured. No generic title/inputs/project-link replacement service was found. |
| `planning.confirmBrief`; workflow `confirm-brief`, id/revision/acknowledged→`approved` | false acknowledgment rejects STAGE_LOCKED400; context has all7stages, expected safe revision equals current; intake approved; brief todo/in_progress→approved | Brief status only; plan locked→todo; stage.complete audit. **No revision increment, project updatedAt change, approval timestamp/revision assignment, file recheck or content invalidation**. B4 detail/list nextStage becomes plan in initial state. |
| `planning.save` + `workflow.createPlanDraft`; `save-plan`, id/revision/script/scenes→{id,version,revision} | Script1..20000;1..100scenes, each1..600sec,total≤7200; scene IDs unique and from project (archived rows may be reused); known/custom step; references unique and in project-linked eligible sets; files present; brief approved; expected revision current | New plan version=max+1; new/retained scene metadata, omitted active scenes archived; plan.draft through changeContent(plan); then plan request_approval. Stored steps retain full scene input including assetIds; scene DB row has character JSON but **no scene-assets relation/assetIds column**. Reads show new draft/history and needs_approval. Identical plan input still makes a new draft; no no-op rule here. |
| `workflow.changeContent`; trusted internal origin/action/mutation→revision | Context+revision+preceding stage; mutation=false returns same revision without audit/invalidation; increment must stay safe integer | Successful content mutation, revision+1, origin status in_progress, subsequent stages locked; clears their approval plan/revision/time fields. For plan origin only, project approvedPlanId=null and active scenes needsRecheck=true. One audit with previousRevision/contentRevision/origin (base keys win over extra detail). All rollback together. |
| `workflow.changeStage`; stage/action/revision→status | Pure transition+previous-stage guard; generic approve forbidden; plan/review complete forbidden; produce complete needs selected succeeded results/files and no recheck; export complete forbidden | Status plus next locked stage→todo, stage.action audit. Does not increment revision or automatically set approvedAt/revision. A generic port would pull in file/production dependencies; not recommended as the next minimal API. |
| `workflow.approvePlan` via planning.approve; id/planId/revision→planId | Latest draft of same project, current revision, nonblank script/steps/active scenes, plan needs_approval + previous stage | Draft becomes approved with scene-table snapshot+approvedAt; project and plan-stage approvedPlanId; produce todo; plan.approve audit. Revision unchanged. Approved source row preserved from then on. |
| `production.select`; project/scene/version/revision/expectedSelectedId→revision | Current revision+selection pointer; approved current plan; succeeded same-scene version/file | Same selection is no-op. Else changeContent(produce), selected pointer/recheck flag update; revision+1 and produce→export eligibility invalidated; old scene_versions unchanged. Binds both project revision and expected scene pointer. |
| `production.keep` / complete | keep checks same CAS/context and current result; complete uses strict produce completion guard | keep clears needsRecheck and logs only if needed, **no revision increment**; complete is stage-only. Neither replaces a result/history row. |
| `timeline.save` / restore; id/revision/expectedTimelineId/input or fromId→{revision,timelineId,timelineRevision,created} | Current revision AND pointer; produce approved; current scene/version/clip identity, schema/ranges/fonts/disclosures/audio rules; restore source same project, checked against today's rules | Canonical same JSON is no-op with no new row/audit/revision. Else immutable timeline row max+1/raw SHA256, point project, scene positions, changeContent(edit), timeline.save/restore audit. Restore inserts a new row, never modifies source. B4 get exposes updated revision/pointer; timeline read provides history/stale indicators. |
| `editing.save` / complete | Save adapts static view through timeline CAS; complete requires saved current timeline, no stale selections and revision match | Save uses timeline path; complete stage-only. P1 settings snapshots remain read-only. No separate mutable edit-settings writer should be recreated. |
| `review.update` / approve / get | Current revision, edit approved; item matches expected snapshot/conditional set; hold note required; approved review items cannot be edited through service; approve checks no stale timeline and all required pass | update changes revision-keyed item, may start review, review.item audit; no content increment. approve advances stages, sets approvedRevision/time and review.approve audit. `get` calls ensure and **can insert unchecked items**—not a pure B4 read operation. Public approve path also includes timeline-music conditional items; do not port only the lower-level approval helper and omit ensure/context. |
| `library.archive` / link / character | IDs/schema/reference/file checks; no project revision CAS | Library metadata/archive and library audit only; no project-link replacement or implicit project invalidation. Existing linked/history references remain. Character creation validates original image/video references. This is not a general project-assets edit contract. |
| `renders.request` / exports.request (later boundary) | Render compares revision+timeline pointer before async preparation and again inside immediate tx; active same input hash may deduplicate. Export checks approved plan/current review/selected files | Job+render/export+audit atomically, immutable inputs and completed artifacts preserved. No project content revision increment for enqueue. Full worker, file digest and artifact lifecycle excluded from next task. |

`maintenanceRepository.archiveProject` is a lower-level archive/updatedAt helper, not evidence of a current generic project input-edit/CAS contract. Do not invent inputs replacement or project link mutation semantics from its existence.

## Approval, history, raw/source-hash and rollback details

| Concern | Actual behavior to preserve / PG service responsibility |
| --- | --- |
| PLAN S3–S5 | Plan content change clears active approval pointer and marks retained active scenes for recheck; original approved plan/scene snapshot and generated versions stay. Produce/edit content change preserves approved plan but invalidates downstream eligibility. Old review rows/export manifests/files are not rewritten or deleted when revision advances. |
| Planning scene references | Eligibility is based on project_assets/project_characters, not merely any library row. `planningRepository.assets/characters` joins do not themselves exclude archived rows; current save filters file existence for non-links, while character membership is checked. This differs from new-project creation's nonarchived checks. A future port must characterize/archive cases and preserve actual rules, not silently tighten them. |
| Template/project inputs | Saved at creation. No current general edit function rewrites them. Brief confirmation must leave both raw TEXT values and hashes unchanged. No universal project source_hash column or source-hash CAS exists. |
| Timeline hash | New timeline serializes validated input with canonicalJson; timelineSha256 hashes exact stored UTF-8 JSON. Reader requires both canonical string equality and raw digest match. Equal semantic JSON with different bytes is not an equivalent saved row. PG trigger checks raw SHA but does not replace full schema/canonical/scene/disclosure checks. |
| P1 source proof | `checkP1MigratedRow` checks original settings snapshot, deterministic IDs, revision/time/aspect/text/clip/order. Correct digest alone is not provenance. Current helper requires SQLite; no blanket PG import/acceptance of p1-migration rows or data migration is authorized. |
| Render source/input hash | Render input includes timeline raw hash, tool/browser/composition source SHA and immutable asset/source metadata; render input itself has a raw digest. These do not become brief-confirmation tokens. File re-digests/worker source validation remain separate later work. |
| Failure rollback | Bad CAS/gate/reference, SQL constraint, dependency or late audit failure must leave business rows, stage/approval state, pointers, revision and audit exactly at baseline. No partial mutation before the authoritative CAS check. Actual COMMIT uncertainty cannot be represented as a successful rollback. |
| SQLite concurrency scope | Existing assertRevision is SELECT/check inside SQLite immediate serialization; repo update predicates generally contain ID only. Copying those predicates into concurrent PG transactions would not preserve the effective CAS boundary. |

## Published SQL support and gaps — no SQL change required for brief

`0001_schema.sql` already supplies owner-composite project/stage keys, stage/status checks, auth ownership FK, safe integer bounds, links and owner-bound FKs; plan version and timeline revision uniqueness. `0003_rls.sql` supplies owner policies and dream_api SELECT/INSERT/UPDATE/DELETE with restricted role rights. `0002_invariants.sql` prevents identity changes, revision decreases, wrong-project pointers, historical timeline/audit mutations, approved plan changes and completed artifact changes; it checks raw timeline/render digests and envelopes.

These triggers **do not** implement expected-revision equality, increment-by-exactly-one, automatic approval invalidation, pure workflow transitions, full timeline validation, JSON-contained reference ownership or row-lock ordering. Services must provide those. Generic raw actor-transaction SQL is a trusted server capability, not an untrusted request API.

Brief parity needs only existing projects/stage_states/activity_log; no new table, stage revision counter, enum, grant or published SQL edit. Later planning/content/timeline ports also have storage columns, but still need their service gates/CAS/provenance dependencies. SQL availability is not managed execution acceptance.

## Exact next minimal implementation proposal

Proposed new paths, **only if subsequently assigned**:

- `lib/repo/postgres/project-brief.ts`
- `lib/services/postgres/project-brief.ts`
- `tests/postgres/project-brief.test.ts`
- `tests/postgres/project-brief-integration.test.ts`
- `tests/postgres/run-project-brief-local.mjs`
- `docs/handoffs/B14-PROJECT-BRIEF-POSTGRES.md` (proposed next ID; Master owns final assignment).

Read/reuse unchanged pure stages helpers and existing actor transaction/pool contract; no new generic interfaces/callback mutation executor. Fixed operation takes verified actor/project ID/expected revision/boolean acknowledgment; returns approved status. No arbitrary stage/action, caller owner, config loader, filesystem, Storage call, Auth resolution or HTTP adapter. Preserve the legacy outer startup/readiness responsibility as an eventual adapter concern rather than importing SQLite startup code.

Transaction sequence:

1. Validate branded actor and safe caller values; false acknowledgment retains the existing STAGE_LOCKED400 outcome. Missing/cross-owner project is the same404.
2. Existing actor transaction; owner-scoped nonarchived project SELECT **FOR UPDATE**. Lock its seven stage rows in a fixed order. Validate complete stage set/statuses; compare actual revision using the existing rule. Never use B4's read-only transaction mode for this writer.
3. Run existing transitionStage for brief/complete/user (intake must be approved). Conditionally update brief using owner/project/stage/observed status; require one row. If next plan state was locked, update locked→todo with checked row count. Append the exact legacy `stage.complete` detail `{stage:'brief',status:'approved',contentRevision:current}` and local-user actor label/verified owner_id in the same tx.
4. Commit; preserve only locally issued safe domain errors on healthy rollback, sanitize unknown failures. Do not update project revision/updatedAt, approved metadata, inputs/snapshot, references or histories. Dispose/release via existing transaction helper.

The parent lock substitutes for SQLite's effective serialization at project granularity; fixed stage locking protects the observed transition rows. [PostgreSQL row locking](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS) specifies conflicting writers wait and locks end with the transaction. Every future stage/content writer must use a consistent parent→dependent order. This is a service protocol, not a claim that privileged external SQL cannot violate application rules.

Important race distinction: two brief confirmations with the same content revision do **not** race by incrementing that revision. First succeeds; second sees already-approved brief and follows existing INVALID_TRANSITION409 behavior, with one audit. A content writer that commits a newer revision first makes the waiting brief request stale→CONFLICT409. If brief succeeds first, a later content operation may still validly consume the unchanged revision; do not invent a mandatory loser or new revision increment for stage-only changes.

## Planned actual PostgreSQL verification matrix — not run in B13

| Case | Required observed result |
| --- | --- |
| B12-created project, true acknowledgment | approved brief, locked plan→todo, one exact audit; contentRevision/updatedAt/raw snapshot+inputs/hashes/approval fields unchanged. B4 list/get shows nextStage plan. |
| brief todo and in_progress; next plan already not locked | Existing pure transition behavior; change only rows legacy would change, no blanket stage reset. |
| false acknowledgment, stale/unsafe revision, missing/foreign/archived project, malformed seven-stage state | Existing safe400/409/404 classifications as applicable; zero business/audit changes and no owner leakage. |
| Unverified actor / disallowed ownership | Reject before connection; A cannot read/transition B, raw RLS comparison also rejects owner substitution. |
| Two connections, same project/same revision confirmations | Real lock contention; exactly one success/one already-approved transition failure, one audit, revision unchanged. No mock/sleep-only race proof. |
| Controlled content writer commits newer revision first | Waiting confirmation reads current locked row and rejects stale revision; no stage/audit partial changes. Reverse ordering preserves legitimate unchanged-revision semantics. |
| Different projects/owners | No project-global advisory lock; progress independent of another project's row lock; normal plain B4 reads remain available. |
| Failure on plan unlock UPDATE or late audit INSERT | Brief/plan/audit all rollback, revision/raw/history hashes unchanged; subsequent valid transaction still succeeds. |
| BEGIN/query/disconnect/COMMIT/ROLLBACK faults | No success after uncertain commit; existing helper release/destroy policy preserved; raw SQL/DSN/callback data not exposed. |
| Immutable/history regression | Approved plan, prior review/export/timeline/asset records unchanged; raw timeline hash/provenance not bypassed by stage operation; SQL3 hashes unchanged. |

Use a new signed-binary loopback dream_test_* cluster, synthetic Auth A/B, restricted login + existing SQL3, B12 creation with an explicitly synthetic availability callback only for fixture setup. Keep this distinct from real Storage support. Reuse B4 read regressions and focused pure workflow checks; do not connect/write managed service or run broad unrelated tests solely for this design.

## Remaining dependencies / decisions

No existing product-choice conflict requires a new user decision for the fixed brief candidate. Master already resolved required-asset retention and Storage-before-opening priority; obey it. B12 Storage-backed availability and upload/owner/RLS/immutable-object/DB registration acceptance remain open. Later planning schema extraction must avoid importing current planning.ts (which imports SQLite/files); later timeline/P1 helpers need a separately scoped non-SQLite provenance design. No extraction or shared-type change is made now.

B13 verification is source/PLAN/SQL/test-assertion review and report whitespace review only. No test, new database, browser, storage operation, scheduler, API activation, data migration or operational setting change was performed.

Transfer: **B13 ready_review. Current write/CAS/approval/history/hash/reference contracts mapped. Minimum existing CAS writer candidate is confirmBrief only: row-locked owner context + observed-stage update + exact audit, no revision/updatedAt increment or content invalidation. SQL3 already supports it; triggers are not automatic CAS. Exact six future paths and actual-PG race/rollback/read matrix proposed, no implementation started. Storage owner/immutable object/upload checks/RLS+DB asset registration remain mandatory before C3 creation opening; no always-true callback/link bypass. B12 scope PASS acknowledged, code unchanged; Master separately assigns Storage and any future brief work.**
