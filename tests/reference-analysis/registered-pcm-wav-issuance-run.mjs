/* global Buffer, URL, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

assert.equal(process.argv.length, 2, "The PCM issuance probe accepts no database or auth target");
const pins = {
  "registered-pcm-wav-authority-run.mjs": "1f0739177a2313cf23cc41e7e79e4e6f559b8f48",
  "registered-pcm-wav-authority.pg17.ts": "61eca67d585bcb9d879b74001cfa91e71f84cb67",
  "registered-pcm-wav-authority.fixture.sql": "3f5cff1554d691f4b064e4d87caa13baa6321d2f",
};
const sources = new Map();
for (const [file, expected] of Object.entries(pins)) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
  assert.equal(blob, expected, "Review the owned authority fixture before re-pinning " + file);
  sources.set(file, source);
}
const name = "registered-pcm-wav-authority-run.mjs";
const runner = new URL(name, import.meta.url);
const source = sources.get(name);
const seam = "../reference-analysis/registered-pcm-wav-authority.pg17.ts";
assert.equal(source.split(seam).length, 2);
const hook = registerHooks({
  load(url, context, next) {
    if (url !== runner.href) return next(url, context);
    return { format: "module", shortCircuit: true,
      source: source.replace(seam, "../reference-analysis/registered-pcm-wav-issuance.pg17.ts") };
  },
});
try { await import(runner.href); }
finally { hook.deregister(); }
