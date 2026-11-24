# B50-FIX exact numeric tokens and non-trapping Proxy rejection

2026-11-18 ? CX-RECOVERY-01 ? Master msg_f64c9c8043ae; canonical grammar choice accepted msg_4ed2511ce824. Responds to **F50-1/2** in fixed independent review **3f43ef247f15c9dfc640a2c6a2dc33e861bed0de**, original implementation **02293287957f0703d2f4e3c74a82bc47dde739ea**.

**Author fix and self-verification ready_review; separate Tester re-review requested.** Changed only existing helper/test and this new report. Original B50/R reports, independent diagnostic outputs and earlier evidence are immutable. No native/provider/persistence implementation or live experiment.

## F50-1: explicit canonical integer grammar before JSON.parse

Original-byte SHA256 comparison remains before parsing each of the four supplied receipt byte snapshots. After fatal UTF-8 decoding, the existing JSON token scan now checks each original numeric token **before whole-document JSON.parse**. It accepts only canonical nonnegative decimal integer tokens:

```text
0 | [1-9][0-9]*
exact value <= 9007199254740991
```

The scan rejects noncanonical tokens, then checks length<=16 and the exact **BigInt(token)** upper bound. It never uses Number(token)/binary64 rounding as the exactness criterion. Short-circuit length checking avoids constructing arbitrarily large BigInts within the existing byte limit. Only after lexical checks and decoded duplicate-key checks does JSON.parse construct the object for unchanged strict schemas/ownership validation. Strict JSON syntax still rejects malformed numeric forms such as leading zeros, plus signs, incomplete exponents and trailing decimal points.

**Deliberately narrower supported contract:** decimal forms, exponent forms, negative numbers and -0 are unsupported even when their mathematical value is an exact integer (101.0,101e0,1.01e2 included). Both independent counterexample tokens101.000000000000000001 and1010000000000000000001e-19 are blocked with invalid_input_json/run.numericToken despite correct raw-byte pins and otherwise complete fixtures. This prevents the original noninteger?101 rounding acceptance without implementing a general lossless decimal/exponent parser. Zero is lexically supported, but still cannot be a positive PID. MAX_SAFE_INTEGER is supported exactly when all owned input/baseline/probe identities agree; larger values reject.

The restriction applies to numeric tokens in all four receipt JSON byte inputs, not only run.pid. Quoted numeric-looking strings are unchanged. Authority/sample are already supplied as JavaScript values, so their existing exact safe-integer/type validation remains; this API cannot recover source lexemes discarded by a caller before those values were supplied. Unknown provider profiles remain closed. No actual input is rewritten, canonicalized or repaired to satisfy a pin.

Tests correctly freeze the actual altered byte hash and update the explicit inputSet binding **before** verification, so these regressions reach the lexical guard instead of relying on a hash mismatch. Independent BigInt quotient/remainder controls confirm the two fractional remainders. Other tests retain hash-mismatch-before-token-check, escaped duplicate keys, strict UTF8/BOM/JSON rejection, original normal candidate controls and nanosecond UTC behavior.

## F50-2: native brand check before unknown-object reflection

Added the explicitly allowed existing Node builtin **node:util types.isProxy**. It rejects Proxy values without invoking user traps, including revoked Proxy values. The check is placed:

- At the start of the recursive plain-data snapshot function, before prototype/descriptor/symbol/array inspection. This covers authority/sample roots and every nested object/array.
- Before any inspection of the four-member byte-input bundle, including Array.isArray/prototype/descriptors.
- At the start of each individual byte-container validator, before typed-array accessors or reflection.

No callback is evaluated to decide whether a value is a Proxy. Accessors remain rejected via descriptors without getter execution; byte subclasses/shared backing remain rejected. Candidate evidence is still deep-frozen and isolated from input mutations. Structured blocked results expose only bounded code/path, not input text or thrown caller messages. Imports are existing zod, node:crypto and node:util; no package/lockfile change.

Regression matrix has **36 cases**: transparent/throwing/revoked modes across authority root, sample root, byte-bundle root, nested profile/slot-array/pin-map, probe-array/probe-object/error-object/rows-array/expected-PID-array and individual byte container. Every case asserts the exact proxy rejection code/path and **zero** trap calls. Exact path assertions also distinguish native brand rejection from a revoked Proxy simply throwing during reflection. Normal Buffer/Uint8Array controls still yield synthetic candidates; getter0/shared/subclass protections remain.

## Actual checks and maintained boundary

```text
node node_modules/vitest/vitest.mjs run tests/postgres/cleanup-witness-verifier.test.ts tests/postgres/schema5-catalog.test.ts
node node_modules/typescript/bin/tsc --ignoreConfig --types node --noEmit --target ES2022 --lib ESNext,DOM --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict tests/helpers/cleanup-witness-verifier.ts tests/postgres/cleanup-witness-verifier.test.ts
node node_modules/eslint/bin/eslint.js tests/helpers/cleanup-witness-verifier.ts tests/postgres/cleanup-witness-verifier.test.ts --max-warnings 0
```

**446/446 PASS:** verifier206 (original139 plus67 new regressions/controls), unchanged catalog240. Scoped strict TypeScript/import graph exit0; ESLint exit0/zero warnings. New67 comprise30 numeric/grammar controls,36 Proxy positions/modes and1 combined byte-positive/subclass/shared control. Existing test expectations were not relaxed; only regression cases were added. No whole-project/full-suite/build/native result is claimed.

The public result contract is unchanged: absence_candidate with synthetic-test-only scope or structured blocked. No real provider, I/O/clock/environment read, history/CAS/storage/ACK/readiness or B execution-permission API. These fixes address raw-byte numeric exactness and caller-code nonexecution at the pure unknown-input boundary; they do not authenticate a controller, acquire real identities, prove durable OS absence, recover the old cause or complete B48 independent pair.

Repository import search still finds this helper only in the dedicated test; no product/runtime wiring. Original B48 first guard FAIL and pair-incomplete status remain historical. No live OS/network/DB query, process operation, native rerun, account/mail/password action, install/build/deploy or new agent/window/worktree.

## Preservation and fixed files

Before/after raw-byte preservation manifest **tmp/b50-fix-exact-proxy/preservation-before.json**, SHA **76d0a7391a0f0939704c4760fe4034920f6716a7b9ae6a7c15c39b7c439bee02**, verifies **91/91 protected reports/artifacts unchanged**: B49 original20+accepted model5, B48 original54+pair artifact, B50 author/reviewer reports and original reviewer scripts/diagnostic outputs. The intentionally changed helper/test are excluded from that immutable-working-file set; their original bytes remain fixed in0229328. This distinction avoids claiming the fixed source files were unchanged. No original failure output was overwritten/reclassified as a passing run.

Concurrent Master TEAM/plan edits, existing T122/T137 reports, shared index, production5148/preview50963/Ego54/55/shared3013.next and all original native roots remain protected. Exactly helper/test/new FIX report are selected for commit.

|Changed implementation file|SHA256 (working bytes)|
|---|---|
|tests/helpers/cleanup-witness-verifier.ts|1bab45bcd4c28eec8e8b92be05095f5318906ef5c65386506947bf27d8cb296a|
|tests/postgres/cleanup-witness-verifier.test.ts|dc9e4cf8529ff69077e86746bd7ae1d9a72cf395771a14ed7e388f2e401a69aa|

Master copyable return: B50-FIX F50-1/2 ready_review. Raw bytehash-beforeparse preserved; canonical nonnegative safe-integer lexeme grammar+BigInt bound blocks both exact pinned fractional tokens, decimal/exponent/-0/negative explicitly unsupported, numeric strings unchanged. Native Node util Proxy brand rejection precedes root/nested/bundle/bytes reflection;36 transparent/throwing/revoked regressions allblocked/trap0. New206+catalog240=446PASS/scopedtype/lint0;91protectedhashes unchanged. Exactly helper/test/newFIX report; no provider/history/storage/B-permission/product/native expansion. Separate Tester re-review requested.
