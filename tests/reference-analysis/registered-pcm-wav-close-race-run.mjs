/* global Buffer, URL, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

assert.equal(process.argv.length, 2, "The PCM close race probe accepts no target arguments");
const pins = {
  "registered-pcm-wav-issuance-run.mjs": "2853c7c4f68bd3a8a166cefb9c4baccbb128f4a5",
  "registered-pcm-wav-issuance.pg17.ts": "37b791e4d95518064e0ac39c820121ce6f7bfd51",
  "registered-pcm-wav-issuance.fixture.sql": "645a6efc989f80b01bddd0efef8b15dd5210f91e",
  "registered-pcm-wav-restore.pg17.ts": "3886dc3492ef295cab8088af098ee8eeadaf266d",
};
for (const [file, expected] of Object.entries(pins)) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
  assert.equal(blob, expected, "Review the owned fixture before re-pinning " + file);
}
const runner = new URL("registered-pcm-wav-issuance-run.mjs", import.meta.url);
const probe = new URL("registered-pcm-wav-close-race.pg17.ts", import.meta.url);
const uploadFixture = new URL("../postgres/t367-private-image-upload.pg17.mjs", import.meta.url);
const restore = new URL("registered-pcm-wav-restore.pg17.ts", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === uploadFixture.href && specifier === "../reference-analysis/registered-pcm-wav-issuance.pg17.ts") {
      return next(probe.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const module = next(url, context);
    if (url !== restore.href) return module;
    assert.equal(module.format, "module");
    const source = String(module.source);
    assert.match(source, /function withBinding\(/);
    // Expose the exact test gate for this process. Its restore entry point is never called.
    return { ...module, source: source + "\nexport { withBinding };\n" };
  },
});
try { await import(runner.href); }
finally { hook.deregister(); }
