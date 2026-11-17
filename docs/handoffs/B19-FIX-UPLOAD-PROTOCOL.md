# B19-FIX — Snapshot relations, fingerprint binding and unknown input boundary

- Owner: Codex(Backend); priority Master `msg_4c3a7f3ff4c0`, review `27162629` against original `91c6dfc`.
- Status: **ready_review — mandatory F1/P1, F2/P1 and F3/P2 corrected; same-reviewer independent recheck requested**.
- Last local verification: **2026-11-17 22:42 KST (13:42 UTC)**. No provider access. Original B19 report/design/review/harness are preserved unchanged.
- Allowed changes: four existing upload protocol modules, existing focused test, this unique handoff only. B20 untracked work checkpoint retained, not included in this submission.

## F1 — Internal relation matrix, not only primitive shapes

`checkedModel` now checks object lifecycle, operation/claim, receipts, revocation events and current availability together. Internally contradictory snapshots fail INPUT before admission; this corrects the review defect and is not dismissed as coherent privileged forgery.

| Required rejection | Corrected binding / history |
| --- | --- |
| Latest failed reverify with revoked flipped false | Append retained `revocations` events bind failed operation, completed state revision/time/principal and historical authorizer set. Every failed reverify must have its event. State revisions form a complete unique sequence of successful receipts plus revocation events. `revoked` must equal whether a retained revocation lies after current receipt's committed state revision. Manual revocation is checked by the same rule. |
| Receipt issuer differs from recorded claimant | Operations record `claimedAt`, `claimVerifiers`, `completedAt`, `completedStateRevision` and retain committing worker/lease. Receipt verifier must equal recorded claimant, have been in the historical claim verifier set and match completion time. Current allowlist is **not** substituted for historical authorization; a valid receipt remains readable after removing its old issuer from today's allowlist. |
| Receipt issued after authority/lease or before claim | Completed success/failure must be at or after claim and strictly before stored lease and authorization end. Receipt verifiedAt equals completedAt. Lease cannot exceed authorizationUntil. Active publication/leased transitions also reject time before claim. |
| publication_reserved without publication | Any bound identity requires a corresponding durable publication record; unbound reserved identity cannot carry one. Initial operation/fence/barrier and exact identity digest are cross-checked. Historical stale reservation after reclaim can remain for reconciliation but gives no IO instruction. |
| Pending lease beyond authorization | All leased operations, including stored pending snapshots, check lease≤authorization and claimant/time/history consistency. |
| registered/ready plus initial closed | Registered requires closed=false, retained initial success, current highest successful receipt and complete state-revision history; unregistered states cannot carry receipts/media/current-ready/revocations. Failed/canceled initial requires closed=true. Cleanup has a recorded claimedAt and requires all capability horizons bounded/elapsed at that claim. |

Generation ordering additionally requires a new operation's expected state revision to include all prior completed generations. A successful newer receipt may clear prior revocation while preserving the event and R1; clearing only a boolean cannot. Failure records keep their committing claim metadata; cancellation has no receipt and explicitly clears active claim fields while recording completion.

Historical allowlist/event arrays are audit input facts, not signatures. Recomputing all mutually consistent records with authority is still outside this pure model's authentication boundary. This limitation does not exempt partial corruption or the six supplied contradictions, which now reject.

## F2 — Reconstructible original creation fingerprint, explicit version2

The unconnected v1 full-request fingerprint could not be recomputed from its stored fields. New ledgers explicitly require **fingerprintVersion=2**, `clientDigest`, `snapshotDigest`, original snapshot and composed fingerprint:

```text
clientDigest   = protocolDigest("creation-client", normalizedClient)
snapshotDigest = protocolDigest("creation-snapshot", ORIGINAL stored snapshot)
fingerprint    = protocolDigest("creation-request-v2",
                  { fingerprintVersion: 2, clientDigest, snapshotDigest })
```

Every ledger read/mutation validates the composite digest; pending/terminal snapshots additionally rehash the actual stored snapshot. Current menu/config/policy is never used to repair/reinterpret the original. Terminal proof retains result/digest/time/principal/historical registrar set, and must match the public result and authority lifetime. Retired entries require snapshot=null, retained version/digests/fingerprint and a retirement record distinguishing pending-expiry retirement from prior terminal retirement. Prior terminal proof is retained for the latter; removing it alone rejects. Minimal retired identity is never recycled.

Tests cover pending/terminal snapshot damage, changed retained client/snapshot digest, terminal result damage, version downgrade, retired proof removal, exact retry under changed current policy, and valid retirement/replay. This is a deliberate incompatible **pure model format** correction; there is no deployed ledger, automatic v1 adoption or data migration. Unkeyed digests remain content bindings, not authentication/encryption/privacy erasure.

## F3 — Descriptor preflight and sanitized exception boundary

Common `parse` now performs bounded plain-data/descriptor inspection **before Zod reads**. It rejects accessor/symbol/nonplain/cyclic/lossy data, oversized structures and sparse/extra-property arrays without invoking ordinary getters. All input-origin foreign exceptions in preflight/Zod normalize to `ProtocolError("INPUT")`. Canonical serialization uses the same preflight and error normalization; no foreign getter/Proxy detail escapes.

Original getter expectation and new nested receipt/context/creation getter controls assert **read count0**. A throwing Proxy inspection trap returns INPUT; its trap can execute, explicitly tested. This is a JSON/data boundary, not a JavaScript Proxy/server-authority sandbox. Existing plain JSON, trim normalization, exact Unicode strings, canonical key order/array order and detached frozen outputs remain valid.

## Exact verification and independent-harness regression

From repository root:

```text
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
git diff --check -- lib/storage/uploads tests/storage-upload-protocol.test.ts docs/handoffs/B19-FIX-UPLOAD-PROTOCOL.md
```

Focused suite **41 PASS**, preserving all original32 tests/expectations and the same64×24 bounded loop, plus9 new relation/binding/descriptor controls. Root tsc and targeted ESLint exit0; diff check clean. No Next typegen/build/shared.next mutation.

Original independent harness copied byte-for-byte to owned `D:/starwork/b19-fix-regression-20261117-2237/tests/b19-r-independent.test.ts`. Original `D:/starwork/b19-r-91c6dfc` fixture/source/config/expected assertions were **not modified**. Source/copy SHA256 both `A414F57D14924F2C8601F9C46BD312A20276B532AA9B1642A5805A782B45E3DA`. The existing repository config supplies the current source alias while CLI root/cwd point to the new isolated directory; its count artifact therefore cannot overwrite original review evidence.

```text
# cwd D:/starwork/b19-fix-regression-20261117-2237
node D:/starwork/dream-ai-studio/node_modules/vitest/vitest.mjs run --root D:/starwork/b19-fix-regression-20261117-2237 --config D:/starwork/dream-ai-studio/vitest.config.ts tests/b19-r-independent.test.ts
```

Unchanged independent suite **27 PASS /0 FAIL /0 skip**, including all original8 failed rejection expectations and positive controls. Its original bounded count audit still reports accepted660/rejected876=1,536. This duplicates the same loop coverage; do not sum it with the focused loop or present the steps as independent tests. These reruns are author regression evidence, **not** independent re-acceptance by the reviewer or executed DB/provider concurrency.

## B20 safe checkpoint and schema impact — incomplete, not accepted

Before the priority message, the owned B20 runner had finished and stopped its synthetic cluster. Root `tmp/b20-postgres-a8cdfd39-1efb-4d93-a0d9-f4a3b1bf72d9`, PID45528/loopback port65086. `cleanup-safe.json` records postmasterPidAbsent=true/listenerAbsent=true. No live transaction/process was left by that run. Evidence/logs retained; no managed environment, secret or bucket was accessed.

B20's three new paths remain untracked and excluded from this commit: unpublished draft SQL, dedicated schema test and local runner. Preliminary synthetic result10PASS/2FAIL is **not completion evidence**: test identifier allowlist erroneously disallows digits in `sha256`, stopping the R1 asset fixture; the following dependent test finds no receipt and fails. This helper defect was identified but not edited after the priority switch. Original SQL1~3/manifest/history/runner remain unchanged.

Protocol corrections materially affect that draft: historical claim/commit authorization/worker/time fields and immutable revocation/state-revision events are needed for F1; F2 requires explicit fingerprint version2, snapshot digest/composite binding and terminal/retirement proof metadata rather than the draft's old raw full-request fingerprint representation. Cross-row SQL validation must cover these relations without claiming constraints implement actual transition locks/fences. F3 affects the future JS executor's input boundary, not a new SQL authentication guarantee. **Do not accept or apply the B20 schema before protocol re-review and a separately authorized draft adjustment.** Existing draft is unfinished, unpublished, unregistered and unsuitable for operations.

## Transfer

Only protocol correction/test/new handoff changes are submitted. No IO/PG/SQL/Storage/Auth/API/worker/package/config/paid/deployment/3013 change; B20 artifacts and original test/review fixtures preserved. The isolated regression harness writes only its own count artifact and uses the existing dependency junction. No persistent service/scheduler or automatic polling.

Master transfer: **B19-FIX ready_review. F1 six internal contradictions now reject through recorded claim/commit history, receipt/lifecycle matrix and derived revocation/state revisions; historical allowlist removal remains valid. F2 explicit v2 client+snapshot digest composition verifies pending/terminal/retired bindings without today's config. F3 descriptor preflight gives ordinary getter reads0 and sanitized INPUT, without Proxy sandbox claim. Focused41PASS preserving original32/1,536 loop; unchanged independent27PASS including original8 failures, accepted660/rejected876 unchanged; tsc/lint/diffcheck clean. B20 cluster stopped, unfinished draft preserved and schema impact documented; no schema completion/operational claim. Last check22:42KST; same-reviewer recheck requested.**
