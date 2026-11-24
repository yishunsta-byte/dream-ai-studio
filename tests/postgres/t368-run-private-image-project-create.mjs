/* global Buffer, URL */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const runner = new URL("./t367-private-image-upload.pg17.mjs", import.meta.url);
const source = (await readFile(runner, "utf8")).replaceAll("\r\n", "\n");
const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
assert.equal(blob, "4a5db2dc79593b32515f9aabab37c3a830a35c76", "Review the T368 seam after a fixture change");
const seam = "    const request = v7();\n    await assert.rejects(disconnect.reserve(a, request, expected), failure(\"UNAVAILABLE\"));";
assert.equal(source.split(seam).length, 2);
const hook = registerHooks({
  load(url, context, next) {
    if (url !== runner.href) return next(url, context);
    return { format: "module", shortCircuit: true, source: source.replace(seam, `
      const { verifyProjects } = await import("./t368-private-image-project-create.pg17.mjs");
      return await verifyProjects({ admin,cfg,api,a,b,worker,fixture,png,expected,openPolicy,updateLegacy,
        removeUpload: () => admin.query(remove) });
      ${seam}
    `) };
  },
});
try {
  const { start } = await import(runner.href);
  await start();
} finally { hook.deregister(); }
