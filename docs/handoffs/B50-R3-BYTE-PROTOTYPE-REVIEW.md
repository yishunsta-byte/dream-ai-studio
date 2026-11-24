# B50-R3 byte-prototype independent final review

2026-11-18 · Codex(Tester) · Master msg_43c909f1d4ce; accepted msg_a31258c1b674. Fixed **012c9bed5c5143ee50e3425a79f014b4f09073e4**, exactly helper/test/new FIX2 report, compared with5ff7f57 and original independent residual finding **81629f70830388680f4380bc47c86603f1a680ab**.

**PASS within the pure synthetic test-helper scope. The remaining F50-2 prototype-trap finding is resolved; F50-1 remains resolved under its approved canonical-number contract. No required issue remains from this bounded re-review.** This does not approve an actual provider, real process absence, persistence/history/CAS/ACK backend or B execution. B48 original guard remains FAIL/cause unproven/independent pair incomplete. Historical failed diagnostic outputs retain their original results.

## Fixed source and non-trapping validation order

Helper working-byte SHA **227dfc966af6ed9508d92724f473ed4d7cbfb27a622beae27a1bd30844c247b7**, test **4702ae97ca00acbbf86c3e118113b3efefbd1e7f3b66fe480f1c55c48c8c9956** match the fixed report. All three current file texts match012c9be. The helper changes only the raw-byte brand/prototype checks; source comparison confirms the JSON/numeric scanner section is byte-identical to the accepted F50-1 fix. Test diff adds9 cases without relaxing existing206 expectations.

The former `value instanceof Uint8Array` and `buffer instanceof ArrayBuffer` are removed. Validation now rejects a Proxy root via native types.isProxy, confirms a genuine native Uint8Array via types.isUint8Array, then compares its immediate prototype directly with local Uint8Array.prototype or Buffer.prototype before reading native typed-array internal accessors. The retrieved backing buffer is checked by native types.isArrayBuffer and direct immediate-prototype equality with local ArrayBuffer.prototype. Neither check traverses or reads the returned custom prototype object. Only then are length/own-key limits checked and indexed bytes copied for hashing.

This matches the documented conservative policy: custom/proxy/revoked/subclass byte prototypes and custom backing prototypes are unsupported, as are shared backing and cross-realm prototype substitutions. Ordinary local Buffer/Uint8Array with ordinary ArrayBuffer backing remain supported. No prototype is repaired to pass. Remaining instanceof expressions apply only to internal Rejected error classification; the reviewed byte validation no longer walks an untrusted input prototype chain. Root/nested Proxy prechecks and descriptor-based accessor rejection remain in place.

## Original failures and independent regression evidence

The two original81629f7 reproduction scripts were copied to own scratch with only output paths changed, verified by reversing those substitutions. Against012c9be:

|Original residual reproduction|Actual result|Caller traps|
|---|---|---:|
|Native byte immediate prototype Proxy|blocked / run.bytePrototype|0|
|Native backing ArrayBuffer immediate prototype Proxy|blocked / run.backingPrototype|0|

Original diagnostic files under tmp/b50r2-review-5ff7f57 were never rerun in place or overwritten. Their prior trap1 and backing candidate outcomes remain preserved.

An additional independent **12-case** check confirms six byte/backing × transparent/throwing/revoked prototype cases return the exact structured rejection code/path with zero caller traps, plus six controls: all normal Buffer inputs candidate, all normal Uint8Array copies candidate, shared backing blocked, subclass blocked, ordinary custom byte prototype blocked and ordinary custom backing prototype blocked. The six hostile cases retain valid original bytes/pins and use local counters only; no actual I/O is attempted. Exact rejection paths distinguish the native guard from a later revoked-prototype exception or caller-thrown error being caught.

The original B50-R13 diagnostics were also copied with only the output path changed: **13/13 expected outcomes** now hold, including correct rejection of both pinned fractional tokens, zero root authority/sample/bundle traps, accessor nonexecution and hash mismatch before JSON parsing. Separate copied **17 numeric/string/duplicate controls** all meet expectations: normal canonical101 and consistently bound MAX_SAFE_INTEGER remain candidates, unsupported decimals/exponents/negative/-0 and unsafe values reject, other receipt numeric fields follow the same grammar, numeric-looking escaped strings remain opaque and escaped duplicate keys reject. These are separately reported groups, not a claim of a new OS/provider or storage implementation.

F50-1's supported receipt-byte grammar remains `0|[1-9][0-9]*` with exact BigInt bound<=9007199254740991 before JSON.parse, after exact original-byte hashing. The approved exclusion of decimal/exponent/-0/negative forms remains explicit even when mathematically integral. The verifier does not rewrite source bytes, reconstruct lexemes lost before JavaScript-value arguments, authenticate controller authority or acquire real identities.

## Actual checks, preservation and scope

Reproduced **455/455 tests PASS** across two files (verifier215 + unchanged catalog240), scoped strict TypeScript/import graph exit0 and scoped ESLint max-warnings0 exit0. Used author commands and native integration switches process-local0. No whole-project type/full-suite/build/native validation was needed or run. Import search still finds only the dedicated test importing the helper; no product/runtime wiring. Imports remain existing zod plus Node crypto/util, with no I/O/current-clock/environment/provider operation in the helper.

Preservation manifest **tmp/b50-fix2-byte-prototype/preservation-before.json** SHA **25790cecb479b201c8c931ac9215aa844cdb9eacc352e3580be1c1d4bd450d5c** matches; **102/102 protected files** match before/after. Intentionally edited helper/test remain fixed historically in5ff7f57 rather than being misclassified as unchanged current files. Original B48/B49/B50 reports, scripts, diagnostics and native roots were not modified or executed.

Own ignored **tmp/b50r3-review-012c9be** contains preflight.mjs/preflight.json, copied fixture.ts, original-prototype-fixed.ts/results, original13-fixed.ts/results, boundaries.ts/boundary-results.json and matrix.ts/matrix-results.json. Commands were `node tmp/b50r3-review-012c9be/preflight.mjs` and `node --import tsx` for those copied/independent .ts files. The preflight records exact source identities,102 protected hashes, copy inverse comparisons and unchanged numeric scanner. Matrix and boundary scripts assert their outcomes; original diagnostic copies retain actual returned outputs separately.

Only this new tracked report and own ignored scratch were written. No live OS/network/DB/provider query, target-process start/stop, native A/B run, product fix, package/config, build/deploy/install, account/mail/password, Golden/state/runtime action or new agent/window/worktree. Master TEAM/plan WIP/shared index, T122/T137, production5148/preview50963/Ego54/55/shared3013/.next remain protected.

Master copyable return: B50-R3 fixed012c9be pure test-helper scopedPASS, residual F50-2 resolved and F50-1 unchanged. Original two prototype cases now exactblocked/trap0; independent six transparent/throwing/revoked plus six normal/custom/shared/subclass controls pass. Original13 and extra17 controls expected,215+catalog240=455/type/lintPASS;102hashes/fixedsources preserved, runtimeimport0. No actual provider/history/CAS/storage/B-permission acceptance or native authorization; oldB48guardFAIL/causeunproven/pairincomplete unchanged. No required follow-up from this bounded review; any later implementation/experiment needs separate Master assignment.
