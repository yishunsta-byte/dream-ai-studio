# B50-FIX2 non-trapping native byte prototype validation

2026-11-18 ? CX-RECOVERY-01 ? Master msg_d1d3bd4fb037 ? responds to remaining **F50-2 P2** in independent review **81629f70830388680f4380bc47c86603f1a680ab**, fixed baseline **5ff7f573f93866cd3bc9fac63b2914d1de1c6dc9**. F50-1's accepted canonical-integer contract remains unchanged.

**Author fix/self-validation ready_review; separate independent re-review requested.** Exactly existing helper/test plus this new report. Original B50/FIX/review reports and diagnostics remain immutable; no native/provider/backend or runtime integration.

## Remaining path and bounded change

The former rawBytes checks used `value instanceof Uint8Array` and `buffer instanceof ArrayBuffer`. A genuine non-Proxy native object can have a Proxy as its prototype; instanceof then walks that chain and executes getPrototypeOf. Earlier direct isProxy checks on the object itself did not cover that case. Independent byte-prototype rejection still executed a trap, and the backing-buffer case returned a candidate after one trap. Those original diagnostics are preserved, not retroactively marked passing.

Removed both **untrusted instanceof** operations. The byte-input validation order is now:

1. Native Node util.types.isProxy rejects a Proxy root.
2. Native util.types.isUint8Array checks the genuine byte-view brand without a prototype-chain walk.
3. Read only its **immediate** prototype; accept exactly local Uint8Array.prototype or Buffer.prototype. A returned custom/Proxy/revoked-proxy prototype reference is compared directly and rejected, without examining that prototype's properties or traversing it.
4. Only after this gate, use native typed-array length/buffer accessors to retrieve internal byte length and backing buffer, not user getters/iterators.
5. Native util.types.isArrayBuffer rejects shared/non-ArrayBuffer backing without instanceof. Read only the genuine backing buffer's immediate prototype and require exact local ArrayBuffer.prototype.
6. Retain byte-length/own-property bounds and copy indexed bytes before original-byte hashing.

**Documented conservative policy:** custom byte prototypes, subclasses, shared backing and custom backing-buffer prototypes (ordinary, transparent/throwing Proxy or revoked Proxy) are unsupported and rejected. Cross-realm prototype substitutions are also outside this exact-local-prototype contract. Normal local Buffer and Uint8Array with ordinary ArrayBuffer backing remain supported. The code does not normalize or repair supplied prototypes. Immediate-prototype retrieval on a genuine non-Proxy native object returns a reference; it does not call that returned prototype's hooks. No caller code is invoked to decide the brand.

Failures remain structured input-text-free blocked results. New byte-prototype and backing-prototype issues use `run.bytePrototype` and `run.backingPrototype` for the run fixture (corresponding input name for other receipts). Root Proxy guards, getter0 handling, subclass/shared rejection, strict schema, exact source-byte pins, JSON duplicate/UTF8 guards and F50-1 canonical numeric token validation are maintained. Node util was already explicitly allowed; no dependencies/config were added.

## Regression and actual verification

Added **9 tests** without changing existing206 expectations:

- Six matrix cases: genuine native byte view versus genuine backing ArrayBuffer, each with transparent/throwing/revoked Proxy as immediate prototype. The fixtures copy valid original bytes into an unpooled unshared buffer, confirm the old run pin before introducing the prototype, and retain that same pin. Each asserts the exact structured rejection path and **zero trap calls before and after the verifier**. Exact paths distinguish native immediate-prototype rejection from a later revoked-proxy exception caught by the outer handler.
- Two ordinary-custom-prototype cases, byte and backing, both rejected under the conservative policy.
- One positive control covering all original receipt buffers and then all ordinary Uint8Array copies with unchanged pins; both remain absence candidates. Existing shared/subclass/root/nested/getter/numeric controls still run.

Final commands:

```text
node node_modules/vitest/vitest.mjs run tests/postgres/cleanup-witness-verifier.test.ts tests/postgres/schema5-catalog.test.ts
node node_modules/typescript/bin/tsc --ignoreConfig --types node --noEmit --target ES2022 --lib ESNext,DOM --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict tests/helpers/cleanup-witness-verifier.ts tests/postgres/cleanup-witness-verifier.test.ts
node node_modules/eslint/bin/eslint.js tests/helpers/cleanup-witness-verifier.ts tests/postgres/cleanup-witness-verifier.test.ts --max-warnings 0
```

**455/455 tests PASS**: verifier215 (prior206+new9), unchanged catalog240. Scoped strict TypeScript/import graph exit0; scoped ESLint exit0/zero warnings. Prior13 independent conditions, correctly pinned fractional/exponent/unsafe-token regressions, duplicate JSON/string controls, native root/nested Proxy36 matrix, nanosecond timestamps and immutable candidate controls remain passing. No full-project/build/native/provider/persistence guarantee is claimed.

## Preservation and unchanged API scope

Ignored own manifest `tmp/b50-fix2-byte-prototype/preservation-before.json`, SHA **25790cecb479b201c8c931ac9215aa844cdb9eacc352e3580be1c1d4bd450d5c**, verifies **102/102 protected files unchanged**: previous91 protected artifacts plus prior FIX/R2 reports and new independent review evidence. Intentionally edited helper/test are excluded from that immutable-working-file set; their previous bytes remain fixed in5ff7f57. No original source-review evidence/output was overwritten or rerun in place.

The only product-path search match remains the dedicated test importing the helper. No runtime import, actual provider, live OS/network/DB query, target-process operation, native experiment, package/lock/config, build/deploy/install, account/mail action, Golden promotion or new agent/window/worktree. Master TEAM/plan WIP/shared index and T122/T137 reports are preserved.

The API still returns **synthetic-only absence_candidate or structured blocked**. It does not authenticate authority, acquire actual host/path/process evidence, implement history/CAS/storage/ACK or authorize B. Old B48 guard FAIL/cause unknown/independent pair incomplete remain historical. F50-1 still explicitly rejects decimal/exponent/negative/-0 forms in receipt bytes even when mathematically integral; this fix changes no numeric expectation.

|Changed implementation file|SHA256 (working bytes)|
|---|---|
|tests/helpers/cleanup-witness-verifier.ts|227dfc966af6ed9508d92724f473ed4d7cbfb27a622beae27a1bd30844c247b7|
|tests/postgres/cleanup-witness-verifier.test.ts|4702ae97ca00acbbf86c3e118113b3efefbd1e7f3b66fe480f1c55c48c8c9956|

Master copyable return: B50-FIX2 residual F50-2 ready_review. rawBytes untrusted instanceof removed; native view/backing brands and immediate exact prototypes checked in non-trapping order, custom/proxy backing rejected. Six genuine byte/backing transparent-throwing-revoked cases allblocked/exactpaths/trap0; normalBuffer/Uint8 controls retained. New215+catalog240=455PASS/scopedtype/lint0, original102hashes unchanged and prior numeric/13conditions preserved. Exactly helper/test/newFIX2report; no provider/history/storage/B-permission/product/native expansion. Separate Tester re-review requested.
