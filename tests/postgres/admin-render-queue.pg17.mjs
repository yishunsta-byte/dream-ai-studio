/* global Buffer, URL */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

// Reuse the owned, signed PG17 fixture to seed SQL1–4 on a loopback test DB.
// The pinned seam sits after the schema and users exist, before unrelated upload exercises.
const runner = new URL("./t367-private-image-upload.pg17.mjs", import.meta.url);
const source = (await readFile(runner, "utf8")).replaceAll("\r\n", "\n");
const hash = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
assert.equal(hash, "4a5db2dc79593b32515f9aabab37c3a830a35c76");
const seam = "    const snapshot = async () => ({";
assert.equal(source.split(seam).length, 2);
const hook = registerHooks({
  load(url, context, next) {
    if (url !== runner.href) return next(url, context);
    return { format: "module", shortCircuit: true, source: source.replace(seam,
      '    return await (await import("./admin-render-queue-fixture.mjs")).verify({ admin, cfg, a, b, worker, baselineProject });\n' + seam) };
  },
});
try {
  const { start } = await import(runner.href);
  await start();
} finally { hook.deregister(); }
