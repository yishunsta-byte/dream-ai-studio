/* global Buffer, URL, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import ts from "typescript";

assert.equal(process.argv.length, 2, "The PCM uncertain egress probe accepts no target arguments");
const pins = {
  "registered-pcm-wav-egress-run.mjs": "2c66c6cd48076f1ad7cc4ebcb499e3460d66efc4",
  "registered-pcm-wav-egress.pg17.ts": "7273f4059d81970b9d8a01020d5d353f127ec53d",
};
const sources = new Map();
for (const [file, expected] of Object.entries(pins)) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
  assert.equal(blob, expected, "Review the owned HTTPS fixture before re-pinning " + file);
  sources.set(file, source);
}
const file = "registered-pcm-wav-egress.pg17.ts";
const probe = new URL(file, import.meta.url);
const runner = new URL("registered-pcm-wav-egress-run.mjs", import.meta.url);
const original = sources.get(file);
const commit = '          await db.query("COMMIT");';
const begin = "    const heldProducer = await issue(committedA);";
const end = "  } finally {\n    for (const job of jobs.values()) {";
for (const seam of [commit, begin, end]) assert.equal(original.split(seam).length, 2);
assert(original.indexOf(begin) < original.indexOf(end));
const setup = original.slice(0, original.indexOf(begin)).replace(commit, `          if (!await interceptCommit(job, db, socket, closed.promise)) {
            await db.query("COMMIT");
          }`);
const source = `import { exerciseUncertain, interceptCommit } from "./registered-pcm-wav-egress-uncertain.pg17.ts";
${setup}
    await exerciseUncertain({ admin, control, inspector, installer, proofReader, old, successor, requests, tls,
      state, status, act, issue, retry, snapshot, before, committedA, committedB, closeArgs: [transition,
      binding.database, binding.oid, binding.generation, binding.work], closeProof: { ...binding, transition }, oldId,
      connectClient: client, checkRefused: portRefused });
${original.slice(original.indexOf(end))}`;
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  fileName: file,
}).outputText;
const hook = registerHooks({
  load(url, context, next) {
    if (url === probe.href) return { format: "module", shortCircuit: true, source: compiled };
    return next(url, context);
  },
});
try { await import(runner.href); }
finally { hook.deregister(); }
