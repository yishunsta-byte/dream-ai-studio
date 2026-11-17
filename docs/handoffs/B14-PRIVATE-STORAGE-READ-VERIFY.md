# B14 — Private Storage read and byte verification

- Owner/task: Codex(Backend) / B14, Master `msg_9655d9b2c780`; DTO follow-up confirmed by `msg_2e6d54b19a52`.
- Status: **ready_review — isolated implementation/self-verification, no actual Supabase Storage connection or deployment readiness**.
- Last verification: **2026-11-17 21:06:47 KST**; shared HEAD before delivery `371d5cc255e98eb5d2264554643f81c499ad8114`.
- Only eight new paths: `lib/storage/supabase/{config,object-key,reader,errors,media}.ts`, `lib/services/postgres/asset-availability.ts`, `tests/storage-private-read.test.ts`, this report. B12/default API is not wired or changed.

## Existing policy / primary SDK evidence

Read installed `@supabase/supabase-js` **2.119.0** and bundled `@supabase/storage-js` **2.119.0** source/types. Its `StorageFileApi.download` creates a lazy builder; `BlobDownloadBuilder.asStream` / `StreamDownloadBuilder` return the HTTP response body stream. This exact installed implementation was exercised against native loopback HTTP, not a mocked SDK. The public [download reference](https://supabase.com/docs/reference/javascript/storage-from-download) documents private downloads; it did not expose the asStream detail in the fetched text, so installed source is the evidence for that API.

[Private bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) establish private access policies and service-key RLS bypass. **This is a trusted server service-role reader; service credentials bypass Storage RLS.** Actor/DB-owner/canonical-key validation is mandatory, not evidence that RLS was applied to the request. The configured service-role mode is a trusted server declaration, not a JWT authentication mechanism. Never expose its key/reader to a browser or accept configuration/asset authority from HTTP.

Read PLAN F1–F7/P7-2 and existing local upload/inspect implementation: UUID server names, non-public relative keys, actual magic-byte MIME, default2GB/file, SHA/size, image full decode≤40M pixels, video ffprobe/positive duration. B14 verifies the image/video subset needed by required productAssets. It does not implement Pro/TUS/browser direct upload, provider policies or all other library formats.

## Configuration and ownership contract

Explicit constructor input only: profile/projectUrl/projectRef/bucket/privateBucket/service-role credential, maxBytes, timeoutMs, maxConcurrent, private workRoot and ffprobePath. **No environment read, connection at import, implicit project/bucket/endpoint/key or SQLite/local-path fallback.** Values are snapshotted before validation; nested credential is copied/frozen. The server reader closes over configuration and does not return credentials in results.

- Managed profile: exact canonical HTTPS origin matching the explicitly supplied ref; no URL credentials, path, query/hash or alternate port. Synthetic profile: explicit HTTP127.0.0.1 port only. Synthetic mode is server test configuration, not an HTTP request option.
- Bucket ID is a strict single segment and privateBucket must be true. Each call additionally uses SDK getBucket and requires matching ID/public=false before downloading; no public or signed-URL download path is used.
- OwnedStorageAsset requires actual ownerId, UUIDv7 id, image/video kind, explicit supported MIME, canonical objectKey, positive safe size and lowercase SHA256. Reader requires branded verified actor and ownerId===actor.id before SDK/network/temp work.
- Exact immutable key format: **`<owner-uuid>/assets/<asset-uuidv7>/<sha256>.<canonical-extension>`**, with png/jpg/webp/mp4/mov/webm determined by the explicit allowed MIME. Key equality rejects alternate owner/id/hash/extension, arbitrary URL/bucket, percent/double encoding, traversal, separators, Unicode and suffix/query variants. Kind never supplies a missing MIME.
- Trusted credentials/config do not establish real bucket existence, IAM/RLS, database metadata provenance or immutable upload policy. Those remain deployment prerequisites.

## Reader / verification behavior

`createPrivateObjectReader(options).verify(actor, unknownAsset, signal?)` returns only immutable verified kind/MIME/size/SHA metadata. `postgresAssetAvailability(reader)(asset,actor,signal?)` returns true only after complete verification; missing/corrupt/invalid/foreign/type/private/limit failures return false. Authentication/network/config/temp/timeout/abort failures propagate fixed sanitized codes for an eventual server adapter to handle. No default success or metadata-only check.

| Phase | Actual behavior |
| --- | --- |
| Admission | Validate/snapshot actor and asset; pre-abort/invalid signal refused before network. Explicit per-reader maxConcurrent1..8, no unbounded wait queue; excess work fails unavailable. Reuse one server reader to share this admission limit. |
| Bounds | Explicit maxBytes1..2GB, timeout1..60000ms. Expected size must fit before network; actual bytes must fit both size and cap. Checks scratch free space before starting. No global disk reservation or quota guarantee for unrelated workloads. |
| HTTP | Installed SDK with session persistence/refresh/URL detection disabled and explicit token callback. Per-operation restricted fetch permits only exact bucket/object GETs, no redirects, no cache or transformed/signed/public URLs. Metadata bounded64KiB; non200 body canceled without reading/echoing provider messages. Content-Length, if present, must agree; unexpected content encoding refused. |
| Object stream | `.download(...).asStream()`, incremental SHA256/count, backpressured writes to an exclusive generated scratch file. No whole-object Blob/arrayBuffer. EOF count/hash must equal trusted DB metadata and hash-bearing key. Generic HTTP MIME is not trusted; actual bytes are inspected. |
| Media | file-type sniffs downloaded file; MIME must exactly equal explicit expected MIME. Sharp performs real image metadata/stats decode with40M-pixel cap. Video uses explicit ffprobe executable, local file/pipe protocols, bounded output and positive video duration. No tool path from request/env and no original user filename shell interpolation. |
| Completion | Success only after full stream, digest/size, media checks and cancellation check. Input/config changes during await cannot change approved metadata. Concurrent calls have separate controllers/files; one abort does not cancel another. No success cache or long-lived object lease. |
| Release | Finally aborts remaining HTTP work, cancels/releases stream reader, closes file, removes only generated realpath-checked child of injected private root, clears timer/listener and releases admission after cleanup. Cleanup failure fails closed. No global temp directory recursive deletion or trust/environment modification. |

Cancellation/timeout covers HTTP and stream; ffprobe receives signal/timeout. Sharp uses its native timeout, abort destroy and checks before/after decode. **Native image timing is second-granularity and filesystem I/O/cleanup is awaited to settle**; subsecond cancellation is not a guarantee that native work/OS I/O is already gone. No Promise.race leaves an untracked worker writing a deleted file. Full-object memory buffering is avoided, while decoded image memory remains bounded by the existing pixel policy and native library behavior. Scratch root must be non-served/access-restricted by the operator; file mode cannot prove Windows ACL configuration or Vercel disk suitability.

A mutation of bytes during a stream fails exact size/hash verification. After verified EOF, this reader cannot prevent later deletion, overwrite, bucket-policy change or DB transaction rollback. Hash-derived keys are a reader contract; actual immutable object policies, no-overwrite uploads and reliable DB registration must separately enforce lifecycle. A private-bucket check is a point-in-time observation, not a policy lock.

## Actual tests and checks

**46 new checks PASS** using the installed SDK + real native HTTP fake Storage bound only to127.0.0.1. Valid PNG generated locally; actual synthetic MP4 generated by existing explicit FFmpeg and inspected by ffprobe. No managed bucket/object/credential was used.

Coverage: supported PNG/video; generic HTTP content-type with correct byte sniff; malformed/cross-owner/id/hash/MIME/kind/size/key/bucket metadata with network0; path/percent/double-percent/URL variants; public bucket; oversize metadata;404/401/403; redirect refusal; lying size header; truncated/chunked/oversize/mutated/disconnected body; actual wrong/unsupported MIME and corrupt image;40M-pixel rejection; stalled headers; pre-abort/mid-stream abort; concurrent abort isolation; asset/config mutation/getters; admission limit/release; availability false versus auth failure.

An **8MiB+ chunked** object is generated incrementally, streamed and hashed without SDK Blob use. A test makes Response.blob throw, proving that buffering path is not used. This is evidence of the implementation path, not a measured2GB throughput/memory benchmark. Every success/failure checks generated scratch cleanup; test teardown closes owned HTTP connections/server and removes its boundary-verified synthetic work directory. Final b14-private-* directory count0.

Focused regression **97PASS /4files**, including new46 + existing B12 unit/connection/backend tests. Counts overlap with the standalone46. ESLint changed paths0 warnings/errors; original root tsc `--noEmit --incremental false` exit0. Published SQL3 hashes unchanged. No package update, build/typegen or `.next` change. Initial40/41 run failed only because a test generator requested invalid Sharp create.channels=1; corrected fixture to3, without changing rejection policy.

```powershell
node node_modules/vitest/vitest.mjs run tests/storage-private-read.test.ts tests/postgres/project-create.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts
node node_modules/eslint/bin/eslint.js lib/storage/supabase lib/services/postgres/asset-availability.ts tests/storage-private-read.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

## B12 integration gap / proposed B15 scope (not started)

Current B12 ProjectCreateAsset has id/kind/objectKey/SHA/size but **no ownerId or MIME**. This gateway accepts unknown metadata and validates the complete OwnedStorageAsset at runtime: feeding today's DTO directly fails closed. No `ownerId=actor.id`, MIME-from-kind inference, type assertion or always-true callback fills the gap. Master explicitly accepted this boundary in `msg_2e6d54b19a52`.

Suggested narrow next assignment paths: existing `lib/repo/postgres/project-create.ts` to select/return actual DB owner_id and MIME; new trusted `lib/services/postgres/project-create-storage.ts` adapter; focused adapter/PG+HTTP fake tests and a unique B15 handoff. Any required change to existing B12 contract belongs to that explicit assignment, not this commit. The adapter must keep repo owner predicate/RLS, compare returned owner to verified actor, preserve nullable/missing/corrupt MIME as rejection, and pass exact actual metadata to B14 validation.

Proposed B15 actual matrix: owner A database row + matching canonical fake object→true/create commit; B row under A→no object network; missing/null/corrupt MIME/owner/key→no network/fail closed; actual object size/hash/type mismatch→no create; Storage401/timeout→safe failure/all dependent DB writes rollback; B12 audit/stages/raw JSON and existing reads unchanged. Use new synthetic PG and HTTP fake only unless separately assigned otherwise. Do not create real bucket/policy or open create API as part of narrow adapter work.

## Review gate and remaining work

Independent review requested for credential/redirect boundaries, network0 validation, actual SDK stream use, byte/media verification, timeout/abort/resource release, cleanup target checks and DTO gap. **Real private bucket, Storage RLS/ownership, immutable uploads, TUS/Pro limits, asset DB registration, B12 wiring/readiness and actual deployment are absent/unverified.** Required productAssets remains required and cloud creation remains closed. No service key or real endpoint guessed/read/printed; real env untouched. No API/Auth/SQL/B3-B4-B5-B9/B12/schema/package/FrontT220/3013/.next/SSL operational change.

Transfer: **B14 ready_review. New server-only explicit-config private reader verifies branded actor + actual asset owner, canonical owner/id/hash key, actual SDK streamed bytes size/SHA/MIME/decode, bounded HTTP/temp/timeout/abort/concurrency and safe errors. Real fakeHTTP/new46PASS, focused97PASS, lint/tsc0; scratch/server clean. No real Storage or B12 wiring. B12 lacks ownerId/MIME; explicit future B15 repo/adapter and PG+fake negative matrix documented without inferred fields. Fixed-SHA independent review requested; production/StorageRLS/upload/registration readiness not claimed.**
