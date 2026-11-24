# B50-R2 exact numbers and Proxy fix re-review

2026-11-18 · Codex(Tester) · Master msg_78ebab7b60f5; accepted msg_13b082d71f4a. Fixed **5ff7f573f93866cd3bc9fac63b2914d1de1c6dc9**, exactly existing helper/test plus new B50-FIX report. Compared against original0229328 and independent review3f43ef2; no source or original test expectation was changed by Tester.

**F50-1 PASS within the approved canonical-integer contract. F50-2 partially fixed; P2 residual caller-trap execution in rawBytes requires changes.** All446 author tests and scoped type/lint pass; original13 independent diagnostics now behave as expected. Two additional native-byte/prototype cases reveal an untested `instanceof` traversal. No actual provider/OS/storage behavior is implicated; the helper remains test support only. B48 original guard FAIL/cause unproven/independent pair incomplete remain unchanged.

## Fixed scope and preservation

Current helper working-byte SHA **1bab45bcd4c28eec8e8b92be05095f5318906ef5c65386506947bf27d8cb296a**, test **dc9e4cf8529ff69077e86746bd7ae1d9a72cf395771a14ed7e388f2e401a69aa** and all three file texts match fixed5ff7f57. Preservation manifest **tmp/b50-fix-exact-proxy/preservation-before.json** SHA **76d0a7391a0f0939704c4760fe4034920f6716a7b9ae6a7c15c39b7c439bee02** matches; **91/91** protected files match before/after. Original helper/test history remains fixed in0229328; those intentionally changed current files are not claimed immutable.

Import search again finds only the dedicated test importing this helper, with no runtime/product wiring. The added node:util is an existing builtin; no dependency/config changes. The output remains only structured blocked or synthetic absence_candidate, with no provider/CAS/storage/history/ACK/readiness/B permission API. Authority authenticity, actual source acquisition, host/path ownership and durable lifecycle guarantees remain caller/future implementation obligations.

## F50-1 resolved: explicit supported grammar before numeric conversion

Fatal UTF8 decoding and unchanged exact original-byte hash comparison precede token verification. Numeric token validation now occurs before whole-document JSON.parse. It requires `0|[1-9][0-9]*`, length<=16 and exact BigInt upper bound9007199254740991. Length rejection short-circuits large BigInt construction. Duplicate decoded-key checks and strict final JSON parsing remain. Quoted string contents are separate tokens and are not numerically rewritten.

The Master-approved grammar deliberately excludes decimals, exponents, negatives and -0, including mathematically integral101.0/101e0/1.01e2. This narrower contract is documented, rather than silently pretending to support general lossless JSON numbers. It applies to the four receipt byte inputs; source lexemes already lost before JavaScript authority/sample arguments reach this API cannot be recovered here. No input is canonicalized or repinned by the verifier.

Original correctly pinned101.000000000000000001 and1010000000000000000001e-19 cases now return blocked/invalid_input_json/run.numericToken. Normal101 remains a candidate. Independent additional checks also confirm exact matching MAX_SAFE_INTEGER ownership remains a candidate, unsupported exact-integral forms and unsafe values block, malformed JSON still blocks, other clients/receipt/baselines numeric fields use the same restriction, numeric-looking escaped string contents remain opaque, and escaped duplicate keys remain rejected. Hash mismatch still precedes malformed-token parsing. No required numeric-boundary issue remains in this review.

## F50-2 residual · P2 · instanceof traverses a Proxy prototype below a non-Proxy byte value

Location: **tests/helpers/cleanup-witness-verifier.ts:125–126**. The native isProxy guards correctly reject actual Proxy values before reflection at plain roots/nested objects, byte-bundle root and individual byte-container root. Original authority/sample/bundle proxies now all block with zero traps, and the author36 transparent/throwing/revoked regressions pass. Those guards do not cover an actual native typed array/ArrayBuffer whose prototype chain contains a Proxy.

`rawBytes` still evaluates `value instanceof Uint8Array` before checking the value's exact immediate prototype, then `buffer instanceof ArrayBuffer`. Ordinary instanceof walks the object's prototype chain and can invoke a Proxy's getPrototypeOf trap. The containing byte array or ArrayBuffer is itself genuine and non-Proxy, so types.isProxy(value) does not catch this path.

Independent reproduction uses valid original bytes and unchanged pins. A local trap only increments a counter and returns the expected builtin prototype; no actual I/O is performed:

```ts
const bytes = new Uint8Array(validRunBytes);
let calls = 0;
const proto = new Proxy({}, {
  getPrototypeOf() { calls++; return ArrayBuffer.prototype; }
});
Object.setPrototypeOf(bytes.buffer, proto);
// Pass bytes as the otherwise unchanged run byte container.
```

|Modified native value|Caller traps|Observed|
|---|---:|---|
|Byte array immediate prototype is Proxy returning Uint8Array.prototype|1|blocked, but caller code already executed|
|Backing ArrayBuffer immediate prototype is Proxy returning ArrayBuffer.prototype|1|absence_candidate after caller code executed|

The first case proves even an eventual blocked result is not a nonexecution guarantee. The second reproduces accepted input after callback execution despite the new direct Proxy guards. This is the same F50-2 pure unknown-input/nonexecution boundary, not a request for a new provider/backend feature. It does not show production wiring or authority forgery.

**Required bounded fix:** avoid prototype-walking instanceof for untrusted byte values/backing buffers. Reject unsupported immediate byte prototypes before any chain traversal and use non-trapping native brand checks/accessors for backing buffer kind, or reject unsupported backing prototypes without walking their chains. Do not invoke caller code to decide their type. Add byte-prototype/backing-buffer-prototype regressions with transparent and throwing traps, plus revoked-prototype error handling; assert zero caller trap calls and structured non-leaking output. Custom byte prototypes must remain rejected under the existing byte-container contract. A genuine backing ArrayBuffer may be safely copied or rejected according to a documented policy, but acceptance must not execute its prototype hooks. Retain normal Buffer/Uint8Array, subclass/shared/proxy rejection, byte hashing and both numeric fixes.

## Actual independent validation and artifacts

Reproduced **446/446 tests PASS** (verifier206 + catalog240), scoped strict TypeScript/import graph exit0 and scoped ESLint max-warnings0 exit0 using author commands. Native integration switches were process-local0. Diff inspection confirms existing139 test expectations were not relaxed; new cases were appended. No unrelated full-project/build validation was needed or run.

Original13 diagnostics were copied to own scratch with **only their output-file path changed**, verified by exact inverse comparison. The copied fixture builder is unchanged. Against fixed5ff7f57, the original13 now all meet their expected results, including zero original root Proxy trap calls. Old diagnostic outputs in tmp/b50r-review-0229328 were never overwritten or reclassified. Additional independent17 numeric/string/duplicate controls all match expectations. Separately, the two prototype diagnostics above expose the residual and are not reported as PASS.

Own ignored **tmp/b50r2-review-5ff7f57** retains preflight.mjs/preflight.json, fixture.ts, original13-fixed.ts/original13-fixed-results.json, boundaries.ts/boundary-results.json and prototype.ts/prototype-results.json. Commands: `node tmp/b50r2-review-5ff7f57/preflight.mjs`; `node --import tsx tmp/b50r2-review-5ff7f57/original13-fixed.ts`; same prefix for boundaries.ts and prototype.ts. Prototype.ts is a diagnostic recorder, not an all-green regression test; its nonzero counters and candidate output are preserved as returned.

Final recheck preserves all91 original protected hashes and fixed source hashes. Only this new tracked report and own ignored scratch were written. No original script/model/evidence/native root was executed or edited; no live OS/network/DB/provider query, target-process operation, native A/B rerun, product implementation, package/config, build/deploy/install, account/mail/password, Golden/state/runtime action or new agent/window/worktree. Master TEAM/plan WIP/shared index, T122/T137, production5148/preview50963/Ego54/55/shared3013/.next remain protected.

Master copyable return: B50-R2 fixed5ff7f57 F50-1 canonical exact-number fix PASS, original13 now expected/roots trap0, extra17 controls PASS, author206+catalog240/type/lint PASS. F50-2 remains P2 in rawBytes125–126: native nonProxy byte/buffer with Proxy in prototype chain executes getPrototypeOf once via instanceof; byte case blocks after execution, backing-buffer case returns absence_candidate. Need bounded non-trapping brand/order fix plus prototype-chain regression, no backend expansion.91hashes/source preserved, no source edits/live/native operation. B48 historical guardFAIL/pairincomplete and actual provider/history/CAS/storage/B authorization boundaries unchanged.
