# B49-R2 cleanup witness specification amendment

2026-11-18 ? CX-RECOVERY-01 ? Master msg_a76754607031. Responds to **F49-1/2/3** in independent review **8a0fd34b4aa4c99b1e89e94e5d03175c6bf03081**. Original B49 report f76cbf8 and original17-case fixture/result are unchanged. **Exactly one new tracked report; only new ignored pure-model artifacts. No actual provider/storage implementation, OS/network/process query, native experiment or process operation.**

**Specification and synthetic-model changes are ready for independent review.** The amended contract rejects the thirteen independent counterexample conditions and adds ownership, schema, ordering and committed-history requirements. Historical cause remains unproven; first B48-R guard stays FAIL, later absence stays separate, and independent B48 A/B pair remains incomplete. Neither new expectations nor simulated ACKs authorize a native run or change the original evidence.

## Scope and source-line correction

The original facts remain: first guard saved35560 absentfalse, later queries no35560 row; original identity/start/path/exact first lookup time were not collected and cannot be restored. Source-confirmed timing correction is unchanged in substance: process checks then listener query then aggregate at then PID-file check. Correct original cleanup-os.ps1 line numbers are **8 processChecks;9 listeners;10 ordered result/at then Test-Path;11 write;12 print;13 guard/throw**. Earlier B49 references were one low. No original script/report was edited to apply this correction.

The earlier17 cases verified selected branches and an **in-memory retained-list barrier** only. Their original hashes/results and limitations remain historical. They did not prove full probe schema validation, trusted-inventory completeness or durable persistence. The new model is separately named and stored; it does not relabel those17 cases as stronger validation.

## F49-1: adapter boundary and mandatory normalized probe schema

A future implementation has three distinct boundaries: authorized immutable source/ownership inputs; provider adapters that retain native safe output/errors and a versioned normalization profile; a verifier that accepts only complete, internally consistent records. An adapter saying absent does not bypass verification. Unknown/missing/contradictory input is blocked and its original safe evidence must be committed as a rejection when storage is available; storage failure follows the blocked/quarantined contract below.

A normalized probe has **all** fields below. No unknown top-level probe fields are accepted by the pure model. Status/reason strings are enums, booleans are actual booleans, integer fields exclude booleans/floats/coercion. Raw error details remain separate from normalized classification.

|Required fields|Type and invariant|
|---|---|
|attempt, sample, host, source, inputSet, clockOrigin|Nonempty bound identities; exact match to the same sample and approved inputs/source/origin. source is a lowercase64-hex SHA256; inputSet binds the expected input-hash map.|
|seq|Exact nonnegative integer, complete contiguous sequence0..N-1 in prescribed order.|
|kind, provider, target|Exact prescribed probe tuple. process uses positive integer PID and separate CIM/GetProcess records; listener uses approved port/TCP; pidfile uses exact owned cluster/postmaster.pid path/File. No missing/duplicate targets or substitute provider.|
|begin, end|Exact nonnegative integer monotonic nanoseconds, same origin as sample, begin?end and enclosed by sample. Sequential next.begin?previous.end.|
|utcBegin, utcEnd|Offset-bearing ISO timestamps around that individual call, not a later aggregate label; retained separately from monotonic values.|
|status, providerCompleted, outcome|status absent/present/error; providerCompleted exact boolean; outcome completed-empty/recognized-no-match/completed-rows/query-failed. Consistency rules below.|
|rowCount, rows|Exact integer count?0 and array; rowCount equals rows.length. Preserve bounded safe success rows.|
|errors|Required object with all three arrays query,nonTerminating,identity; omitted channels are not empty channels. Any unclassified query/property error blocks absence.|
|rawErrorRecords|Required array retaining provider-native terminating/nonterminating record data and classification provenance. An empty array asserts none were captured; capture completeness is a separate obligation.|
|absenceReason|Explicit recognized provider/profile reason for absence; null for present/error. Unknown reason cannot pass.|
|identityReadStatus|Enum not-applicable/complete/partial/error. Conditions below; never inferred from a missing field.|
|details|Required profile, nativeOutcome and captureComplete fields; approved profile and outcome agree, captureComplete must be boolean true. Native details are retained even when normalization fails.|

**Absence acceptance candidate:** all required fields validate; providerCompleted=true; outcome completed-empty or recognized-no-match under an approved versioned profile; rowCount=rows.length=0; identityReadStatus=not-applicable; errors.query/nonTerminating/identity all empty. A completed-empty outcome has no raw error records. A recognized-no-match may retain only the exact profile-approved provider no-match ErrorRecord(s), separately classified **known absence**, with no other error in any channel. This handles a provider's no-such-PID error without erasing its raw error. It never treats a generic access failure/timeout as no match. Unknown provider codes or an unsupported profile block.

not-applicable is valid only for a successfully empty/recognized-no-match result: no current process exists to supply new identity metadata. The complete startup baseline is still mandatory for that PID. Partial/error identity status, property errors, a positive row, inconsistent count, missing error field or raw unclassified error cannot become absence. A present record retains its row and metadata; matching original identity, different/reused identity, incomplete identity or provider disagreement all block the scenario gate. Reused PID is evidence for review, never authority to kill/reclaim that process or silently PASS. The pure model may return one blocked reason rather than diagnose a historical cause.

The pure model's only approved profile is **pure-fixture-v2**. Its reasons and fake no-match codes are explicitly synthetic, including fixture-GetProcess-not-found. These are not asserted real Windows FullyQualifiedErrorIds. An actual provider profile, safe raw capture and missing/error mapping must be independently implemented and verified in a separately authorized bounded gate. No actual adapter is installed here. Schema consistency cannot prove that an unimplemented/dishonest adapter captured every real error; that remains an implementation and review obligation.

## F49-2: trusted owned inventory, exact booleans and baseline preconditions

The verifier takes an **independently approved authority** and separately frozen source receipts, not an inventory declared solely by the sample. The authority is held by the controller and binds task, scenario, fresh attempt ID, execution host, canonical owned root/cluster, port, source SHA, monotonic origin, adapter profile and planned client slots from the approved task recipe. For the B48 recipe the planned slots are admin/migration/observer; a future approved task can explicitly define another plan. A sample cannot omit a slot by declaring a smaller expectedPids array. Authority/registry trust and canonical filesystem ownership validation must be implemented by the future controller; a sample's self-assertion is insufficient.

Required frozen input set: **run, clients, receipt, baselines**. Before parsing for a real witness, hash each original file's exact bytes against the authority's independently pinned hashes. Preserve those bytes. Parsed fields must agree on task/scenario/attempt/host/root/cluster/port/source and match the approved authority. inputSet is a deterministic digest of that input-hash map. A cross-attempt/root/port/PID, wrong host/source, missing receipt or mismatched hash is insufficient/error and blocks A?B; no expectation learning or automatic repinning.

|Owned input|Required check before any absence is accepted|
|---|---|
|run|Nonempty positive integer postmaster PID, exact approved binding/host/root/cluster/port/source; exact integer port1..65535.|
|clients|Approved planned slots are nonempty and unique; collectionComplete exactly true; each slot has a collected=true receipt and positive integer PID. Collected slot set/count equals planned slots. A planned-but-not-collected client blocks; do not shrink the plan to observed rows.|
|derived inventory|Postmaster followed by planned collected-client PIDs, nonempty, positive, unique; duplicates and empty universe rejected. No set-only comparison that discards duplicates.|
|receipt|Present, completed exactly boolean true, postmaster PID equals run.pid with exact integer type; backendPids exact ordered collected-client list, no omissions/additions/duplicates/coercion. Producer completion is distinct from OS absence.|
|baselines|captured exactly true, phase startup-before-cleanup, offset-bearing acquisition UTC, identities mapping keys exactly the derived PID strings with no extras/holes. Each record has exact PID/host/startUtc/path/status/errors; complete status, nonempty image path, valid UTC creation/start time, no retrieval errors. Every identity start precedes acquisition and acquisition precedes the sample.|
|sample flags and coverage|startupIdentityCaptured and receiptCompleted exactly true and consistent with validated inputs; expectedPids equals the full derived ordered inventory, never its replacement. Probe plan contains both prescribed providers for every derived PID plus owned listener/file targets.|

Missing baseline, access denied, partial baseline, wrong path/host, omitted expected client, string false/true flags, boolean PID, PID reuse ambiguity or input binding failure cannot pass even if every declared probe says absent. Do not populate old35560's baseline from a later no-row read or fabricate an acquisition time. Newly collecting baselines would require a future run assignment.

For synthetic testing only, each fixture receipt is serialized deterministically and that fixture serialization is the hashed input blob. Some structural cases deliberately bind malformed blobs **before** freezing their synthetic authority, to test schema checks independently of the digest check; an extra case tampers with a blob **after** freezing the authority and must fail the hash check. This fixture builder is not a production repair/repinning path. The model does not replace hashing actual original byte files with reserialization in a real verifier.

## F49-3: complete sample time/binding and durable first-failure contract

A sample requires: attempt/sample IDs, index,purpose,host,source,inputSet,clockOrigin,unit,begin,end,utcBegin,utcEnd,generatedUtc,utcClockState,expectedPids,exact flags and probes. No missing/unknown sample fields. The sample and every probe share one immutable attempt/sample/source/input/host/origin. Sample IDs and event ordinals cannot collide. Monotonic values are exact nonnegative integer **nanoseconds since the attempt's recorded clock origin**, not UTC ticks, PIDs or inferred historical values. Sample begin?all probe bounds?sample end; each probe begin?end; prescribed sequential end?next begin; contiguous unique sequence and full target/provider coverage. Later current-state samples cannot precede the preceding sample's end.

UTC remains separate. Every timestamp has an offset; probe UTC bounds and sample/generated bounds must be consistent when utcClockState=stable. The amended conservative model blocks changed/unknown UTC clock state rather than inventing a monotonic relation from UTC or suppressing a clock change. Real implementation must record actual uncertainty/clock-change evidence. Missing origin/unit/bounds, mixed attempt/sample, overlap/reversal, missing/duplicate sequence or out-of-sample intervals block. Providers sampled at different times can legitimately differ; such disagreement still preserves the first discrepancy and stops the gate.

**Durable state is more than a two-item list.** A future storage/controller implementation must satisfy these transitions and preconditions:

|State/transition|Required behavior|
|---|---|
|UNOPENED?RESERVED|Create a fresh attempt and initial sample reservation under exclusive create/no-overwrite. Bind approved authority/input/source and gate identity in an independently retained registry/control receipt **before live observation**. Failure/ambiguous acknowledgment quarantines the ID; no silent reopen or reuse.|
|RESERVED?CANDIDATE|Validate complete input and sample; build an immutable safe evidence event containing original normalized/native safe payload, candidate or rejection decision, authority digest, controlled ordinal, previous-head digest, requested sample identity and purpose. No PASS/B readiness yet. A validly bound malformed sample can be committed as a rejection, not discarded.|
|CANDIDATE?COMMITTED|Serialize safely; create exclusive event; write/flush and commit it together with compare-and-swap of expected prior control head/index. Verify exact event digest and a trusted committer ACK, including exact boolean exclusive/durable success. Bind ACK to the full event (and hence attempt/authority/input/source/ordinal/previous head), not a caller's generic true flag. Only complete acknowledged commit may advance control.|
|Any serialization/create/write/flush/ACK/control failure|No PASS. Preserve available safe evidence and failure; retain a fault/quarantine marker in the independent control path. If even that control path is unavailable, declare state unavailable/unknown and block. Do not claim the failed write is durably saved. The pre-observation reservation stays consumed; no new sample can be substituted for lost pending evidence. Reconciliation requires Master.|
|First rejected committed event|Set firstFailure to its immutable event hash once. Append later observations with new IDs/ordinals and purpose current-state. Do not replace the first event, clear its failure, reuse its sample ID or reinterpret a later absence as the initial gate.|
|Load/recovery validation|Require trusted latest registry/control watermark and full hash-linked ledger: exact count/head, unique complete controlled ordinals, attempt/authority binding, valid commit ACK per event, recomputed firstFailure matching retained control. Missing/truncated/empty-after-history ledger, lost/unknown control, duplicate attempt or corrupted ACK blocks; do not reconstruct an empty trusted control from whatever events remain.|
|Model next-step readiness|Only a complete committed first-gate absence event, valid current control/history, no pending/fault/unavailable state and no firstFailure. The model conservatively requires exactly that one event; a later current-state record is never the replacement gate. Actual next native execution still needs the separate Master authorization.|

Attempt registry/control must be independently retained with anti-rollback guarantees appropriate to the eventual backend. Hash chaining a local file alone does not detect rollback of both ledger and its supposedly trusted anchor. Losing that trusted watermark is insufficient evidence, not permission to reset history. Actual exclusive-create/atomicity/flush/crash recovery/control watermark guarantees are mandatory future implementation acceptance criteria, **not proved by the pure model**.

The new SimulatedJournal represents these states with independent control and event-list objects, a consumed reservation/pending-event hash, append-only event/ACK records and a sticky firstFailure/fault. Its ACK outcomes are injected booleans; it does not call a filesystem committer. Rejection events retain the submitted sample. Malformed purpose/index/initial reservation or duplicate sample submissions become rejection candidates under controlled ordinals when a valid control/history exists. Invalid history/duplicate attempts/storage faults close/quarantine the gate. A pending payload lost or altered cannot be replaced by a new absence proposal. At most one initial-gate reservation is usable; no automatic provider retry or B invocation exists. Any real additional sample/retry needs a Master plan that preserves first failure.

## Independently stated expectations and pure validation results

Own new ignored directory **tmp/b49-r2-witness-spec** contains model.py, checks.py, validation-cases.json, results.json and preservation-before.json. Only synthetic dictionaries, deterministic timestamps/order units and own fixture-file I/O are used; no actual clocks/providers/processes/network/DB or persistence backend. Command: `python tmp/b49-r2-witness-spec/checks.py`.

Expected safety booleans are declared before calling the classifier and full expected validation inputs are written to validation-cases.json before execution. Assertions compare **PASS versus blocked**, not the model's own diagnostic branch strings. The thirteen independent review conditions are translated into the new complete representation while retaining their original defect; their names/requirements are matched against the unchanged independent adversarial-results.json. These are independently supplied requirements evaluated by the author model, not an independent review of this amendment.

|Independent condition|Expected|Actual|
|---|---|---|
|identity baseline map empty|must not pass|blocked|
|identity baseline missing path|must not pass|blocked|
|startup flag is a truthy false string|must not pass|blocked|
|absent probe carries partial identity status|must not pass|blocked|
|separate identity property error|must not pass|blocked|
|absent probe contains a positive row|must not pass|blocked|
|nonterminating error collection|must not pass|blocked|
|unknown no-match classification|must not pass|blocked|
|empty expected PID universe|must not pass|blocked|
|duplicate expected PID inventory|must not pass|blocked|
|producer flag is a truthy false string|must not pass|blocked|
|provider calls have overlapping/reversed sequence|must not pass|blocked|
|probe is outside sample range|must not pass|blocked|

The original exact legacy13 dictionaries are also rejected because they do not satisfy the new mandatory schema; those extra13 rejection checks are recorded separately and **do not substitute** for the thirteen translated, otherwise-complete counterexamples above.

Core totals: **132/132 validation checks** and **29/29 state-transition checks** match fixed expectations (161 checks total), plus13 legacy-shape rejection checks. Validation includes2 allowed synthetic absence candidates,13 independent conditions,44 probe/row/error boundaries,36 time/binding boundaries and37 inventory/baseline boundaries. No other validation input passes.

Additional boundaries include every missing probe/sample field; wrong row count/type, positive row in absent output, missing error channel, unknown/no-match raw error, error-to-empty result, listener/file errors, reused/missing-identity process, missing client in both declared list/probes, planned-versus-collected discrepancy, empty/duplicate inventory, string flags, boolean/float/zero PID, input/receipt/baseline/host/root/port/source mismatch, late/error baseline, clock changes, invalid bounds/origin/unit and mixed/duplicate probe identity.

State cases include empty/uncommitted ledger, candidate before ACK, all six injected storage stages failing (serialization/create/write/flush/ACK/control ACK), duplicate attempt, duplicate sample, failed reservation/reopen, truncation, lost registry/control, missing/forged ACK, numeric1 instead of boolean true, duplicate event, altered history, first failure overwritten with a recomputed local hash, pending loss/modification, wrong commit hash and invalid-purpose rejection persistence. A committed first rejection followed by a committed current-state absence retains the original event and firstFailure unchanged. **Only the complete synthetic absence plus injected valid durable ACK reaches model readiness; all28 other state cases block.** This is a transition-contract check, not real durable-I/O or provider-cause reproduction.

Development correction in the **new** fixture builder: its initial rebinding helper accidentally restored a deliberately omitted inputSet field, causing one expected rejection assertion to fail. Missing-field/binding cases now disable rebinding, retaining the omission. The full suite was then rerun. Additional type boundaries use exact boolean checks for ACKs (Python True must not equal integer1 for acceptance) and exact integer input ports. No original model/input was changed or rerun in place. Pure fixture repetitions are not native experiments.

|New artifact|SHA256|
|---|---|
|model.py|958de29ec54a24553124fb4fa4fafb78510c99eb404b5f887933201a7dce6b43|
|checks.py|2e4e2543e89792efc397818ebc54fe8c61f9dbc254d87a0580aacef46e3ad8e1|
|validation-cases.json|af59a589e46ece91367b6c2deed71ed1e6aabe5411f489312d2f91a2d5580421|
|results.json|925771de9fa1a5592f80a433e1debf0853746d1f9f2ccdff4f4666d9a18e5b8b|
|preservation-before.json|4594da5d3f942bebe242f7f3d85eb8a479526cd20efd21918e0a212bf2fb2ba0|

## Preservation, limits and return

Original13 nonsecret incident files, the original17-case script/result/manifest, both B49/B49-R reports and independent adversarial script/result were byte-hashed before/after: **20/20 unchanged** (full path/hash manifest in own scratch). Original model hashes remain cb7e05d0?32a/c881c24c?4098; original diagnosis and first guard are not overwritten. Source line+1 corrections exist only here. The fixed independent13 counterexamples still document old model gaps, not a real OS witness accepting malformed evidence.

This amendment is an implementation **contract** and pure safety model. It does not supply actual provider classification, trusted inventory acquisition, host/canonical-path verification, authoritative registry provisioning, durable storage/anti-rollback, OS time capture or any recovered historical identity. Actual implementation and separate independent validation remain required. No operating-system absence/PID reuse/exit race or old cause was reproduced.

Only this new report is tracked. Original scripts/evidence/native roots/fixtures/source, B48 author's diagnostic scope and independent pair-incomplete status, Master2document WIP/shared index, T122/T137 reports, deployed5148/preview50963/Ego54/55/shared3013.next, accounts/mail/product/runtime/Golden paths remain protected. No live/native/target-process operation, build/install/deploy, new agent/window/worktree or external account action.

Master copyable return: B49-R2 F49-1 schema/row/errors/recognizedabsence; F49-2 trustedplanned+collected inventory/uniquePID/fullbaseline/exactbool/inputbinding; F49-3 sameattempt samplebounds/order and exclusive commit/ACK/antirollback-history/stickyfirstfailure contracts amended in this new report. Source lines corrected8/9/10/11/12/13. New puremodel132validation+29state PASS, independent13conditions allblocked; legacy13shape checks separate, old17retained-list limitation preserved; original20hashes unchanged. SyntheticACK/persistence model is not real provider/backend acceptance or native authorization. First OSguardFAIL/causeunproven/B48independentpair incomplete remain. Fixed report ready for independent specification review; next implementation/experiment needs separate Master assignment.
