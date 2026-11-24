/* global Buffer, URL, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

assert.equal(process.argv.length, 2, "The PCM restore probe accepts no target arguments");
const pins = {
  "registered-pcm-wav-issuance-run.mjs": "2853c7c4f68bd3a8a166cefb9c4baccbb128f4a5",
  "registered-pcm-wav-issuance.pg17.ts": "37b791e4d95518064e0ac39c820121ce6f7bfd51",
  "registered-pcm-wav-issuance.fixture.sql": "645a6efc989f80b01bddd0efef8b15dd5210f91e",
};
for (const [file, expected] of Object.entries(pins)) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
  assert.equal(blob, expected, "Review the owned issuance fixture before re-pinning " + file);
}
const runner = new URL("registered-pcm-wav-issuance-run.mjs", import.meta.url);
const probe = new URL("registered-pcm-wav-restore.pg17.ts", import.meta.url);
const uploadFixture = new URL("../postgres/t367-private-image-upload.pg17.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === uploadFixture.href && specifier === "../reference-analysis/registered-pcm-wav-issuance.pg17.ts") {
      return next(probe.href, context);
    }
    return next(specifier, context);
  },
});
try { await import(runner.href); }
finally { hook.deregister(); }
