# B25 — reserved upload persistence codec

Status: ready_review; independent B25 acceptance pending. Backend sole author, assignment `msg_308e164bc1cf`. Confirmed2026-11-18 02:39 KST (2026-11-17 17:39 UTC).
Accepted inputs: frozen B19 reserve/checkedModel and accepted SQL4/source/catalog/v2 runner. No change to those inputs is authorized.

Allowed new paths recorded before implementation:

- `lib/db/postgres/upload-reservation-codec.ts`
- `tests/postgres/upload-reservation-codec.test.ts`
- `tests/postgres/run-upload-reservation-local.mjs`
- `docs/handoffs/B25-UPLOAD-RESERVATION-CODEC.md`

Scope: pure pristine-reserved-only codec, fixed parameterized insert/select specifications and strict decoder. No environment/Auth/provider/DB connection, statement execution, role/grant/transition executor/API/Storage capability. Only an owned signed PG18.7 test harness executes inserts using synthetic admin. Existing SQL1–4/v1/B19/state/runner/CLI/runtime/package/.next/3013 and real managed/SSL/Storage/paid/deploy resources are protected. No new agent/window/worktree.

Mapping decision: SQL4 has no dedicated reservation policy/authorizer/incoming-version columns. A closed version1 server reservation envelope in immutable `upload_intents.request_json` will preserve those values and exact raw request bytes; other columns must match it. This is not a browser request validator or proof of trusted policy/auth/provider facts. Owner/authorizer UUIDs keep B19's general lowercase UUID contract; object/asset/intent/request records require UUIDv7. Exact epoch milliseconds use fixed UTC SQL expressions and text projections, avoiding Date, timezone dependence, double precision epoch conversion and submillisecond rounding. Supported pristine models are rederived with the existing reserveUpload and compared to checkedModel.

Master confirmed that mapping and the general Auth UUID contract in `msg_5cf79835e218`. This was not authority to change the schema, original model, live policy or operating scope.

## Pure codec contract

`encodeUploadReservation({model,requestJson})` accepts only those two keys. It validates detached plain data with the accepted parser, runs `checkedModel`, and rederives a pristine initial reservation using the existing `reserveUpload`. The full checked model must equal that reconstruction; lifecycle reserved alone is insufficient (e.g. an evolved reserved model with a capability issue rejects). No caller-owned object is frozen/mutated. Output and nested model/SQL-parameter snapshots are immutable.

The immutable text field contains a new explicit **server reservation envelope**, not an adopted browser POST:

```text
{
  codecVersion: 1,
  requestId: lowercase UUIDv7,
  maxBytes: positive integer <= 2147483648,
  reservedAt: nonnegative safe integer epoch milliseconds,
  reservation: {
    ownerId, objectId, assetId, intentId,
    intentExpiresAt, issueEnvelopeUntil, maxIssues,
    verifiers, collectors, policyManagers,
    policyEpoch, policyDigest,
    incoming: {bucket,key,providerVersion}
  }
}
```

The reservation fields are exactly the accepted B19 reserve input. Auth owner/authority identifiers retain lowercase general UUIDs, while object/asset/intent/request use UUIDv7. Policy epoch/digest, ordered authority arrays (including accepted duplicate entries), opaque nullable incoming provider version, expiry and issue envelope survive in the raw immutable envelope because SQL4 has no dedicated columns for all of them. No unknown/partial snapshot is guessed or defaulted.

The given request string's exact UTF-8 encoding is preserved; it is never replaced by reserialized JSON. This does not attest that an upstream transport decoder preserved original network bytes. A bounded scanner precedes JSON.parse to reject duplicate decoded keys and lossy numeric lexemes, including a fractional token that JavaScript would round to the otherwise matching1000ms. Wire v1 numbers must be unsigned base10 integer tokens, within MAX_SAFE_INTEGER; fractional/exponent/negative-zero encodings reject instead of silently rounding. Whitespace/key ordering/valid string escapes remain acceptable. The snapshot must satisfy reserveUpload's owner-data relationship, issue envelope before expiry, safe counters and schema bounds. Negative zero in a model also rejects rather than losing its sign in DB integers.

`request_fingerprint = protocolDigest('upload-reservation-request', parsedEnvelope)` uses the existing canonical sorted-key JSON/domain v1 convention. It binds request id, maxBytes, reservation time and the original policy/reservation snapshot. `request_raw_sha = SHA256(exact requestJson UTF-8)` matches SQL4's raw hash CHECK. Formatting-only variants retain equal semantic fingerprint but different exact raw hashes. Neither digest is a signature, trusted policy proof, authenticated actor or byte-verification receipt. This codec-specific versioned fingerprint does not change B19 creation/verification protocol hashes.

## Mapping and fixed SQL specifications

The encoder returns fixed object/intent INSERT and owner-bound SELECT specifications (`text`, readonly `values`). It performs **no query execution** and imports no pg/pool/connection/environment/Auth/provider API. Hashing/Buffer validation are deterministic memory operations. User values appear only as parameters; all identifiers, columns, flags, null groups and expressions are fixed. There is no upsert, conflict adoption, grant, new role, token, presigned URL, outbox or transition executor.

| Facts | Mapping |
| --- | --- |
| Owner/object/reserved asset |storage_objects.owner_id/id/reserved_asset_id; registered asset and all final identity/publication/cleanup fields explicitly null.|
| Pristine object state |lifecycle reserved, revision/barrier/generation0, initial_closed false; explicit created_at from reservedAt.|
| Intent/request identity |upload_intents owner/id/object_id/request_id match the same original model/envelope.|
| Request evidence |request_json exact text; request_fingerprint semantic domain hash; request_raw_sha exact UTF-8 hash.|
| Incoming |exact bucket/key columns; nullable providerVersion remains in immutable envelope, with no provider attestation.|
| Limits/time |max_bytes from envelope; max_issues, authorization_until and issue_envelope_until from model; issue_count0/status open/revision0 and matching created_at.|
| Policy/authorizers |original epoch/digest/three ordered arrays in the immutable envelope. No live storage_policy_versions admission or FK is invented.|

Timestamps accept the full nonnegative JS safe-integer millisecond range, including9007199254740991. SQL splits a bigint millisecond parameter into integer days and remainder under86400000, adds those to timestamp1970-01-01, then applies explicit UTC. No Date, ISO-year limitation or floating epoch-seconds conversion is used. Remainder-to-microsecond arithmetic stays below2^53. Native roundtrips below establish the actual supported range on PG18.7.

The fixed SELECT projections cast bigints/UUIDs to text and return `(extract(epoch FROM timestamp)*1000)::text` aliases ending `_ms`. They deliberately preserve fractional digits until validation; no bigint cast rounds microseconds away. `decodeUploadReservation({object,intent})` requires **both complete projected rows**, exact pristine null/flag/state groups and matching metadata/hash/key/owner/IDs/size/times. It reconstructs the model from the original envelope, checks every split fact, and returns detached immutable unbranded data. Ordinary `SELECT *` Date rows, missing/unknown fields, numbers where text is required, nonzero fractional milliseconds, negative/infinite/unsafe epoch values and evolved rows reject.

To encode a decoded result again, explicitly pass `{model:decoded.model,requestJson:decoded.requestJson}`; do not submit the decoder's diagnostic/hash fields as extra encoder input. That roundtrip reproduces the same insert parameter values and raw request. SQL execution requires a separately authorized caller/transaction/search path/least-privilege design; returning parameterized specifications confers no permission.

## Trust boundary and unsupported representations

The owner context passed internally to reserveUpload is a **reconstruction from persisted data**, not a verified authenticated actor. A caller must separately authorize the real owner and trusted server policy. Validated/raw DB data is not branded as VerifiedActor or proven provider state. A fully coherent malicious rewrite with recomputed unkeyed hashes cannot be distinguished from genuine data by this codec; authorized storage, actor/live-policy checks and transactional admission are future responsibilities.

Supported losslessness concerns the declared pristine model and envelope/data fields, not arbitrary JS object identity/prototypes or arbitrary JSON wire syntax. Reject rather than repair: evolved models, wire versions other than1, unknown snapshots, negative-zero/fractional/exponent numeric tokens, unsafe integers, oversized/beyond existing canonical JSON bounds, NUL/unpaired-surrogate strings and malformed UTF-8-equivalent data. NUL/unpaired surrogates are incompatible with this direct SQL4 JSONB-checked envelope representation, even where a raw B19 string schema alone could accept them. Full MAX_SAFE integer times/epoch0 and normal Unicode text **are** proved supported. No original B19/SQL contract was altered to make an unrepresentable case pass.

The snapshot is permanent initial reservation data. Current policy refresh, idempotent lookup/replay using the original snapshot, lease/fence/CAS/outbox execution and capability issuance are not implemented. `maxBytes` is a stored reservation ceiling, not permission to bypass the actual provider plan's upload limit or evidence of uploaded bytes.

## Actual verification

Final exact command:

```text
node tests/postgres/run-upload-reservation-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin
```

**86PASS /0skip**, exit0, start2026-11-18 02:36:07 KST,806ms. New suite composition:74 pure cases +12 actual PG cases; no repeated assertions/runs are summed as extra tests.

| Actual PG case | Evidence |
| --- | --- |
| Accepted schema setup |Only accepted v2 fixed schema4 is initialized on a fresh owned cluster.|
| Parameterized insert/select/decode |Committed reservation model/policy/incoming/raw text roundtrip; reencode matches params; native SQL SHA256 equals codec rawSha.|
| MAX_SAFE time in UTC/New_York/Auckland |Three distinct native row pairs preserve reservedAt MAX_SAFE−2, issue boundary MAX_SAFE−1, expiry MAX_SAFE with exact numeric text; no JS Date.|
| Epoch0/DST session |0/1/2ms UTC boundaries survive New_York session timezone.|
| Hostile opaque text |Quoted SQL-looking/newline/Korean provider text remains JSON parameter data; existing assets table remains.|
| Mid-insert cross-owner FK |Object insert succeeds, intent references another owner with a separately consistent incoming owner key, then FK23503; whole new object reservation rolls back.|
| Native constraints |Missing Auth owner23503, false raw hash23514 and >2GiB ceiling23514 reject before durable rows.|
| Native sub-ms time |Test-only1µs timestamp insertion is represented in exact projection and rejected by decoder, never rounded.|
| API role unchanged |Executing the spec as dream_api is42501; no codec grant/bypass appears.|
| Max policy metadata/min byte limit |MAX_SAFE policy epoch,100 entries in each preserved authority array, byte ceiling1 and exact raw text roundtrip.|
| Permanent owner/request uniqueness |Same owner's existing request id with a new object/intent rejects23505, rolls new object back and keeps original raw reservation unchanged.|

Pure cases cover raw/hash/fingerprint preservation; original model immutability; array order/duplicates; nullable opaque provider version; parameterization; safe maximum time; mismatched model owner/IDs/policy/time/authority; invalid metadata and missing snapshots; capability-evolved reserved state; malformed/partial/duplicate/unsafe JSON; NUL/surrogate/negative-zero/getters; mismatched, partial, unknown, wrongly typed, null or nonreserved DB projections.

Focused original-model regression:

```text
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts tests/postgres/upload-reservation-codec.test.ts
```

**130PASS /12skip**, exit0: original B19 **56PASS** unchanged + new codec pure74. Twelve DB cases need the owned runner and all passed there. Pure74 overlaps86 and is not added again. Other accepted real PG matrices were not rerun for this new pure module.

TypeScript and targeted ESLint exit0, final warnings0:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/upload-reservation-codec.ts tests/postgres/upload-reservation-codec.test.ts tests/postgres/run-upload-reservation-local.mjs --max-warnings 0
```

Iteration facts: initial pure57PASS/4FAIL had the harness passing its diagnostic `request` alongside the strict encoder's two allowed keys. Fixed the harness to project explicit model/requestJson, retaining strict rejection. Initial lint found one unused type, removed. First owned run70PASS/1FAIL expected cross-owner FK but hit owner/key CHECK first; adjusted the invalid fixture's incoming key to its changed owner so the intended FK is isolated, preserving23503 expectation. No product validation/DB constraint was disabled or expected failure inverted.

## Owned resources and submission

| Root under tmp/ | Result / cleanup |
| --- | --- |
| `b25-postgres-a7b3c11d-4531-4d84-9611-6380fdb871fb` |First70PASS/1 fixture FAIL; both cleanup flags true.|
| `b25-postgres-33c229b7-533c-4d28-82c9-7a7ab7e884b4` |Final86PASS; PID36164,127.0.0.1:52935, database dream_test_b3; postmasterPidAbsent=true/listenerAbsent=true.|

Both owned signed EnterpriseDB PG18.7/Windows/UTF-8 clusters stopped; no owned process/listener/transaction remains. Evidence retained, no recursive deletion. Native actual compatibility is only this environment; other server/node/locale/provider/managed environments are unverified. No live Auth/provider/managed/SSL/Storage operation, binary install, .next/3013/build/deploy/paid or new agent/window/worktree.

Codec canonical LF UTF-8 SHA256: **`761f416fd90640e557ff978613dee274c3e9e47f4331946d072186a9e16133b2`**. Only the four declared new paths change; original SQL1–4/v1/B19/state/runner/CLI/runtime/package and parallel Design WIP remain protected. Request independent B25 review of the fixed commit, wire trust boundary, exact time mapping and actual DB evidence. Passing a test-admin roundtrip is not production reservation transaction/least-privilege/IO authorization or Storage readiness.

Master handoff: B25 reserved-only pure codec is ready_review;86 new cases and original B19 56 regression pass, TypeScript/ESLint pass and both owned clusters stopped. Review the four-file commit; real reservation transaction, actor/live-policy checks, least privilege and external capability issuance remain separate work.
