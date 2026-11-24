/* global Buffer, URL, process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import ts from "typescript";

assert.equal(process.argv.length, 2, "The PCM one-shot probe accepts no target arguments");
const pins = {
  "registered-pcm-wav-egress-run.mjs": "2c66c6cd48076f1ad7cc4ebcb499e3460d66efc4",
  "registered-pcm-wav-egress.pg17.ts": "7273f4059d81970b9d8a01020d5d353f127ec53d",
  "registered-pcm-wav-egress-uncertain.pg17.ts": "6ff47ca2ee1cd473cc3896a7ac525f330ddf43a0",
};
const sources = new Map();
for (const [file, expected] of Object.entries(pins)) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
  assert.equal(blob, expected, "Review the owned HTTPS fixture before re-pinning " + file);
  sources.set(file, source);
}
const file = "registered-pcm-wav-egress.pg17.ts";
const uncertainty = "registered-pcm-wav-egress-uncertain.pg17.ts";
const original = sources.get(file);
const begin = "    const heldProducer = await issue(committedA);";
const end = "  } finally {\n    for (const job of jobs.values()) {";
const step = 'const stepSql = "SELECT rea_t320.send_step($1,$2,$3,$4) AS value";';
const stepCall = "stepSql, [action, job.id, job.owner, channel]";
const commit = '          await db.query("COMMIT");';
for (const seam of [begin, end, step, stepCall, commit]) assert.equal(original.split(seam).length, 2);
assert(original.indexOf(begin) < original.indexOf(end));
const setup = original.slice(0, original.indexOf(begin))
  .replace(step, 'const stepSql = "SELECT rea_t320.pcm_send_step($1,$2,$3,$4,$5) AS value";')
  .replace(stepCall, "stepSql, [action, job.id, job.owner, channel, digestBody(job.body)]")
  .replace(commit, `          if (!await interceptCommit(job, db, socket, closed.promise)) {
            await db.query("COMMIT");
          }`);
const probeSource = `import { interceptCommit } from "./${uncertainty}";
import { digestBody, exerciseOnce } from "./registered-pcm-wav-one-shot.pg17.ts";
${setup}
    await exerciseOnce({ admin, control, inspector, installer, proofReader, issuer, old, successor, requests,
      tls, state, status, act, retry, snapshot, committedA, committedB, binding, closeProof: { ...binding, transition },
      oldId, openClient: client, checkRefused: portRefused, connect, jobs, epoch, transmission, password: cfg.password });
${original.slice(original.indexOf(end))}`;
const compile = (name, source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext }, fileName: name,
}).outputText;
const modules = new Map([
  [new URL(file, import.meta.url).href, compile(file, probeSource)],
  [new URL(uncertainty, import.meta.url).href, compile(uncertainty, sources.get(uncertainty) + "\nexport { interrupted, interruptions };\n")],
]);
const hook = registerHooks({
  load(url, context, next) {
    if (modules.has(url)) return { format: "module", shortCircuit: true, source: modules.get(url) };
    return next(url, context);
  },
});
try { await import(new URL("registered-pcm-wav-egress-run.mjs", import.meta.url).href); }
finally { hook.deregister(); }
