/* global Buffer, URL, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

assert.equal(process.argv.length, 2, "This fixture does not accept a database or auth target");
const runner = new URL("../postgres/t367-private-image-upload.pg17.mjs", import.meta.url);
const auth = new URL("../../lib/auth/resolve.ts", import.meta.url);
const source = (await readFile(runner, "utf8")).replaceAll("\r\n", "\n");
const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
assert.equal(blob, "4a5db2dc79593b32515f9aabab37c3a830a35c76", "Review the owned test seam if the fixture changes");
const seam = '    const legacy = new Pool({ ...cfg, user: "t367_legacy" });';
assert.equal(source.split(seam).length, 2);
const hook = registerHooks({
  load(url, context, next) {
    if (url === auth.href) return {
      format: "module", shortCircuit: true,
      source: `
        import { AsyncLocalStorage } from "node:async_hooks";
        const auth = new AsyncLocalStorage();
        export const withFixtureAuth = (result, run) => auth.run(result, run);
        export const resolveServerAuth = async () => auth.getStore() ?? { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
      `,
    };
    if (url === runner.href) return { format: "module", shortCircuit: true, source: source.replace(seam, `
      return await (await import("../reference-analysis/registered-pcm-wav-authority.pg17.ts")).verify({
        admin,cfg,a,b,baselineProject,storagePort:fixture.server.address().port
      });
      ${seam}
    `) };
    return next(url, context);
  },
});
try {
  const { start } = await import(runner.href);
  await start();
} finally { hook.deregister(); }
