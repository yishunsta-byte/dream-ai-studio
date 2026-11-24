# B49-R3 independent specification re-review

2026-11-18 · Codex(Tester) · Master msg_f5abeed95edb; accepted msg_a8b7512f6377. Fixed amendment **e41a6a3b9046fe153dc5ac2818d3ebecfe48ad45**, `docs/handoffs/B49-R2-CLEANUP-WITNESS-SPEC.md`, reviewed in full against F49-1/2/3 from **8a0fd34b4aa4c99b1e89e94e5d03175c6bf03081**.

**PASS for the amended specification and pure model only. F49-1/2/3 are resolved within that scope; no required amendment remains from this review.** This accepts neither an actual provider adapter nor durable backend implementation. It does not prove a historical cause, actual process absence, PID reuse, filesystem atomicity or crash recovery. B48's original first guard remains FAIL and independent A/B pair remains incomplete, with own B unexecuted. No native run is authorized by this PASS.

## Frozen inputs and exact replay

The current R2 report matches fixed e41a6a3 text. Original20 nonsecret file hashes match the frozen preservation-before.json manifest, including incident inputs, original17-case fixture/result/manifest, B49/B49-R reports and independent counterexample script/result. Original files were read only. The corrected original script references8 processChecks/9 listeners/10 aggregate at then Test-Path/11 write/12 print/13 throw match the preserved script. This corrects references without changing the old report or recovering missing timestamps.

|Fixed new artifact|Independently verified SHA256|
|---|---|
|model.py|958de29ec54a24553124fb4fa4fafb78510c99eb404b5f887933201a7dce6b43|
|checks.py|2e4e2543e89792efc397818ebc54fe8c61f9dbc254d87a0580aacef46e3ad8e1|
|validation-cases.json|af59a589e46ece91367b6c2deed71ed1e6aabe5411f489312d2f91a2d5580421|
|results.json|925771de9fa1a5592f80a433e1debf0853746d1f9f2ccdff4f4666d9a18e5b8b|
|preservation-before.json|4594da5d3f942bebe242f7f3d85eb8a479526cd20efd21918e0a212bf2fb2ba0|

Exact model/check bytes were copied to own ignored scratch; the unchanged checks.py ran only against those copies. Its relative legacy-input dependency was also copied to an equivalent own scratch directory. Replay reproduced **132/132 validation checks,29/29 state checks and13/13 separate legacy-shape rejections**. Reproduced validation-cases.json and results.json match the fixed hashes above byte-for-byte. These totals are distinct; the legacy13 are not counted as semantic translations or independent implementation validation.

## Resolution of the three findings

**F49-1 resolved.** The amended contract defines an exact probe schema, provider normalization boundary and approved profile. The model requires explicit row counts/rows, three error channels, retained raw errors, complete capture, exact booleans, recognized absence reason and not-applicable identity status only for successful empty/no-match results. Partial/property/query errors, contradictory positive rows, unknown fields/reasons and missing channels block. Raw no-match records are permitted only under the explicit synthetic profile/code; they are not asserted Windows error identifiers. A real provider classification and proof of capture completeness remain future obligations, expressly distinguished from this model.

**F49-2 resolved.** Controller-approved authority and pinned inputs are distinct from the sample. Nonempty unique planned client slots, complete collection receipts, positive unique owned PIDs, exact ordered producer coverage, complete per-PID baseline/host/acquisition metadata and exact boolean types are enforced before absence. Declaring a smaller sample inventory does not reduce the approved plan. Input hashes and task/scenario/attempt/host/root/cluster/port/source bindings are checked. Empty/missing baseline or metadata cannot be masked by startupIdentityCaptured=true. Synthetic pre-freeze rebinding is explicitly a fixture construction technique; the separately tested post-freeze tamper is rejected. Real original-byte hashing, trustworthy source authority, canonical ownership and baseline acquisition are still implementation requirements.

**F49-3 resolved.** Sample/probe identities, origin/unit, enclosing bounds, prescribed sequence and provider/target coverage are checked. The model blocks UTC changed/unknown state and does not use aggregate at to reconstruct old query times. SimulatedJournal separately models reservation, pending event hash, controlled event ordinal/prior head, exact injected commit ACKs, trusted control watermark, sticky firstFailure and history validation. Failed commit/control stages, duplicate attempts, missing history/anchor/ACK and altered pending evidence block readiness. A committed later absence does not replace the first rejection. The report now accurately labels the old17-case barrier as an in-memory retained-list test and states the new backend/anti-rollback acceptance obligations separately.

The journal's model readiness requires exactly one committed first-gate absence and valid retained control/history. `validate(...).pass=true` alone is only a candidate. Its injected durable/exclusive ACK flags stand in for a trusted committer; they do not prove real compare-and-swap, concurrent-writer exclusion, flush durability, anti-rollback storage or crash recovery. This boundary is explicit in the amended specification and matches the source.

## Independent semantic translation and boundary checks

The13 translated cases have the same names and retained defect conditions as the original independent counterexamples. We independently checked each condition, valid pinned synthetic input hashes, complete sample field sets and complete probe field sets before observing rejection. The missing-baseline-path case intentionally removes that baseline member; empty inventory intentionally removes its process probes, as in the original condition. They are not merely legacy dictionaries rejected for lacking the entire new schema. In particular, malformed pre-bound baseline inputs reach baseline validation rather than relying on an incidental input-hash mismatch. All13 translated conditions block; the separate complete positive control passes.

Additional independently stated expectations exercised **27 validation cases** (one complete positive control plus26 rejections) and **8 state cases** (one readiness positive control plus7 blocked outcomes). These are additional bounded checks, not a new actual adapter or persistence implementation:

- Authority/profile and exact-type boundaries: numeric1 for authority/provider/capture/baseline/client/producer true flags; boolean receipt PID and floating sample/target PIDs; wrong baseline PID and baseline retrieval errors; post-freeze input tampering.
- Probe/time boundaries: unknown error field, missing error channel, hidden raw access error, recognized-no-match without its required raw classification, positive file row marked absent, partial listener metadata, mixed sample identity, boolean sequence, negative/overlapping/out-of-sample monotonic intervals, missing baseline UTC offset and missing clock state.
- State boundaries: injected valid commit permits model readiness; numeric ACK, control ACK failure, stale proposal/commit hash, lost history with retained watermark, lost anchor and committed identity error block. A first committed rejection followed by a new committed current-state absence retains the original event and firstFailure byte-equivalent in the synthetic structure and remains blocked.

All additional expectations matched. They target the requested schema/authority/profile/type/order/commit/history boundaries without expanding the task into a production witness, cryptographic trust service or live experiment. No new must-fix mismatch between the amended contract and its stated pure-model scope was found.

## Evidence, preservation and limits

Own ignored **tmp/b49r3-review-e41a6a3** contains preflight.mjs/preflight.json; byte-identical source copies and replay artifacts under b49-r2-witness-spec; a copied legacy dependency under b49r-review-f76cbf8; independent.py/independent-results.json retaining complete extra inputs, outcomes,13 translation checks and synthetic state records. Commands were `node tmp/b49r3-review-e41a6a3/preflight.mjs`, `python tmp/b49r3-review-e41a6a3/b49-r2-witness-spec/checks.py`, and `python tmp/b49r3-review-e41a6a3/independent.py`. Independent.py loads only inert base/binding fixture definitions for its extra tests, without editing or rerunning author files in place.

Final offline preservation recheck confirms original20 and all five new author artifact hashes unchanged. Only this new tracked report and own ignored scratch were written. No old witness/script/native root was executed or edited; no live OS/network/DB/provider query, target-process start/stop, product implementation, package/config change, build/deploy, agent/window/worktree, account/mail/password or Golden/state/runtime action occurred. Production5148/preview50963/Ego54/55/shared3013/.next/shared index and unrelated T122/T137 reports remain protected. Whole-project tests/type/lint/build were unnecessary and not run for this document/pure-model review.

Master copyable return: B49-R3 e41a6a3 specification/pure-model PASS; F49-1/2/3 resolved within scope. Five fixed artifact hashes and original20 preserved; exact-copy132validation+29state+legacy13 replay with output hashes af59/9257 match. Independent13 semantic translations retain defects with complete schema/pinned input hashes and all block; extra27validation+8state expectations match. No actual provider/host/path acquisition or durable backend/CAS/antirollback/crash guarantee accepted; implementation and any native run require separate Master assignment. Original B48 guardFAIL/causeunproven/pairincomplete remain unchanged.
