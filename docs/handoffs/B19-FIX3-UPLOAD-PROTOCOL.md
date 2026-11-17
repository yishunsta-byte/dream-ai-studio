# B19-FIX3 — Same-event closure and publication claim binding

- Owner: Codex(Backend); Master `msg_88642d1a5d7d` / `msg_a3a00a3a04c2`.
- Review: final R3 `ecfb2f05` against fixed `00fe68a`; full report read and original additional12 expectations preserved.
- Status: **ready_review — author regression complete, same-reviewer acceptance pending**.
- Last actual check: **2026-11-17 23:18:54 KST (14:18:54 UTC)**. No provider/SQL/worker execution in this fix.
- Only `schema.ts`, `state.ts`, existing focused test and this unique handoff change. Original reports/design, operation/receipt modules, reviewer fixtures and B20 untracked artifacts remain unchanged.

## Corrections and bounded duplicate-field audit

| Same retained fact | Required relationship now checked |
| --- | --- |
| First owner cancel and its initial canceled operation | closure.at=completedAt and closure.revision=completedRevision. Closure principal must be immutable owner, authorizers exactly the owner singleton. An early cancel with no operation remains valid and is not forced to invent a completion. |
| First verification failure and its initial failed operation | Existing time/worker/historical set/cause binding now also checks completion aggregate revision. It does not compare history against today's allowlist. |
| First closure caused by GC | closure time/revision equals cleanup claimedAt/claimedRevision. If that GC canceled a pending initial, its completion time/revision equals the same claim. Later GC after prior cancel/failure instead has a strictly later aggregate revision and preserves the first closure and old completion unchanged. |
| Terminal completion revision | New completedRevision is null for pending, present/bounded for terminal, at least its completed state revision and at most current aggregate revision. Later terminal generations cannot claim an earlier/same aggregate completion revision. State revision is still a distinct counter. |
| Publication and its contemporaneous claim | Publication keeps one copied claim snapshot (worker/fence/claim-time/lease-time/authorization/policy/historical set) at reservation. Its fence and immutable operation authority/policy match; reservedAt is inside **that** claim interval. This is one reservation snapshot, not a newly required full claim log. |
| Same fence current or canceled claim | Worker, claimedAt and historical set match; the publication's recorded lease can be shorter than the later retained lease because renewals extend it. Same-fence canceled history therefore cannot admit a reservation after its old lease, even if cancel itself happened later. |
| Older fence after reclaim | Old publication is validated against its own stored contemporaneous window, never the new claimant/time. Its stale fence remains historical and cannot issue fresh IO. Re-reservation captures the current claim if new work is authorized. |

`completedRevision`, cleanup `claimedRevision` and publication `claim` are the minimal added records used for these bindings. The shared claim schema also describes existing canceledClaim; its meaning is preserved. No operation completed-principal duplicate was invented: owner cancel uses owner authority, worker failure/receipt use their recorded claimant, and first GC closure retains its historical collector authorization. Existing actor checks and terminal replay order remain in place.

Normal leaseUntil5/publication at2/cancel at9 is explicitly valid. Changing only publication reservedAt to6 fails INPUT. Renewing the same lease to8 after the original reservation preserves its old interval5; a new reservation at6 after renewal instead records interval8 and is valid. Reclaim by a different verifier at6 can preserve the old fence1/publication at2 while cancel at21 records fence2 claim history. No snapshot-wide query-clock upper bound, new TTL, current-allowlist retroactivity or additional product policy is introduced.

## Exact regression evidence

```text
# repository root
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads/schema.ts lib/storage/uploads/state.ts tests/storage-upload-protocol.test.ts --max-warnings 0
git diff --check -- lib/storage/uploads/schema.ts lib/storage/uploads/state.ts tests/storage-upload-protocol.test.ts docs/handoffs/B19-FIX3-UPLOAD-PROTOCOL.md

# cwd D:/starwork/b19-fix-regression-20261117-2237
node D:/starwork/dream-ai-studio/node_modules/vitest/vitest.mjs run --root D:/starwork/b19-fix-regression-20261117-2237 --config D:/starwork/dream-ai-studio/vitest.config.ts tests/b19-r-independent.test.ts tests/b19-r2-additional.test.ts tests/b19-r3-additional.test.ts
```

- Focused **52 PASS**,0skip. Original47 retained as LF-normalized source prefix;5 appended tests cover time/revision/principal partial damage, repeated/early cancel, direct/follow-up GC, lease-expired cancel, renew/re-reservation, different-worker reclaim and historical publication metadata.
- Byte-unchanged original independent **27 PASS**, unchanged R2 **17 PASS**, unchanged R3 **12 PASS**, including its2 original failures. Combined CLI prints56; these sets overlap focused traces and are not added into a unique-coverage total. This is author rerun, not reviewer re-acceptance.
- Existing bounded audit remains **1,536=660 accepted+876 rejected**. Original21-state matrix and its142/240 rejection attempts,26 same-status/63 other positive controls remain within the preserved focused suite; no exhaustive-history/IO concurrency claim.
- Root tsc and targeted ESLint exit0; diff check clean. No typegen/build/shared.next change.

R3 harness source/copy SHA256 both `1DB112A43F387C47D06F5DE092865D2F3D585595505DF4B1785B9FBA3EAF61F3`; original27 and R2 copies retain previously recorded `A414F57D...` and `61670576...` hashes. Only copied into the owned regression root; original `D:/starwork/b19-r3-00fe68a`/earlier review archives, expectations and config were not modified. The existing repository config supplies current-source alias while root/cwd keep count artifacts outside original fixtures. No skip or softened rejection.

## B20 checkpoint and trust boundary

B20 stopped at its safe checkpoint before any new synthetic DB execution. The three original untracked draft/schema-test/local-runner paths remain incomplete, unstaged and excluded from this submission; no new owned PG/transaction/process exists. Prior PID45528/65086 was already stopped with absence evidence in FIX1. No managed/project/bucket/account/payment/deployment action occurred.

Future B20 mapping must include distinct operation completed aggregate revision, cleanup claimed aggregate revision and publication's contemporaneous claim/window; it must preserve first closure across later cancel/GC and distinguish same-fence renewal from a new fence. Those fields must be mapped/reviewed before any schema acceptance; current unfinished draft is not accepted by this fix. No published SQL1~3/history/manifest/runner change or real DDL occurred here.

These checks bind internally duplicated facts in an injected authoritative snapshot. They neither authenticate a coherently fabricated complete history nor implement DB linearization/CAS, byte/native proof, Storage RLS/immutability, quiescence or durability. A proposed snapshot is not COMMIT. Existing getter0/foreign-error normalization, fingerprint V2/retired IDs, terminal-first historical replay and irreversible cleanup remain intact.

Master transfer: **B19-FIX3 ready_review. R3-N1 initial cancel/fail/first-GC closure time+aggregate completion revision bound without overwriting old first closure. R3-N2 publication stores its contemporaneous claim and checks reservation inside that lease, preserving later expiry/renew/reclaim history. Original47 prefix retained, focused52PASS; unchanged independent27/17/12PASS including old2 failures; tsc/lint/diffcheck clean. No new policy/global-now limit or operational IO; B20 paused unfinished, field impacts recorded. Last check23:18:54KST, same-reviewer recheck requested.**
