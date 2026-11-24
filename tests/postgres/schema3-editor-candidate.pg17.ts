import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const runner = new URL("./t358-project-https-read-schema.pg17.ts", import.meta.url);
const source = readFileSync(runner, "utf8").replaceAll("\r\n", "\n");
const gitBlob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
assert.equal(gitBlob, "b692f16f2ce75ec41ce00c1119ae7c54b8c8d092", "The owned T358 fixture changed");
const seam = "  await runPostgresMigrationsV2({";
assert.equal(source.split(seam).length, 2);

const checkCandidate = `  const { schema3EditorCandidate } = await import("../../scripts/postgres/schema3-editor-candidate.ts");
  const { rows: [identity] } = await admin.query("SELECT oid::int AS oid FROM pg_database WHERE datname=current_database()");
  const editorTarget = { projectRef: "q361syntheticlocalxx", database, databaseOid: identity.oid, owner: bootstrap,
    port, serverVersion: 170012, ending: "rollback" };
  const rehearsal = await schema3EditorCandidate(editorTarget);
  async function absent() {
    const { rows: [row] } = await admin.query("SELECT to_regnamespace('dream') AS base,to_regnamespace('dream_migrations') AS history,to_regrole('dream_api') AS api,to_regrole('dream_worker') AS worker");
    assert.deepEqual(row, { base: null, history: null, api: null, worker: null });
  }
  async function rejected(sql, failure) {
    try { await assert.rejects(admin.query(sql), failure); }
    finally { await admin.query("ROLLBACK"); }
  }
  const result = await admin.query(rehearsal);
  assert.equal(result.at(-1).command, "ROLLBACK");
  assert.deepEqual(result.at(-2).rows, [{ schema_version: 3, verified_history_rows: 3, requested_ending: "rollback" }]);
  await absent();

  await admin.query("ALTER ROLE t358_owner CREATEROLE; GRANT REFERENCES ON auth.users TO t358_owner");
  const limited = await schema3EditorCandidate({ ...editorTarget, owner: "t358_owner" });
  await admin.query("SET SESSION AUTHORIZATION t358_owner");
  try { assert.equal((await admin.query(limited)).at(-1).command, "ROLLBACK"); }
  finally {
    await admin.query("ROLLBACK; RESET SESSION AUTHORIZATION");
    await admin.query("ALTER ROLE t358_owner NOCREATEROLE; REVOKE REFERENCES ON auth.users FROM t358_owner");
  }
  await absent();
  await rejected(await schema3EditorCandidate({ ...editorTarget, databaseOid: identity.oid + 1 }), /target mismatch/);
  await absent();

  const tampered = rehearsal.replace("CREATE ROLE dream_api NOLOGIN", "CREATE ROLE dream_api  NOLOGIN");
  assert.notEqual(tampered, rehearsal);
  await rejected(tampered, /body checksum mismatch: 0003_rls/);
  await absent();

  await admin.query("ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon");
  try { await rejected(rehearsal, /catalog mismatch: relations/); }
  finally { await admin.query("ALTER DEFAULT PRIVILEGES REVOKE SELECT ON TABLES FROM anon"); }
  await absent();

  const committed = await schema3EditorCandidate({ ...editorTarget, ending: "commit" });
  assert.equal((await admin.query(committed)).at(-1).command, "COMMIT");
  await rejected(committed, /requires a fresh database state/);
  const cli = await runPostgresMigrationsV2({
    version: 3, mode: "apply", target, expectedTargetHash: targetHash,
    expectedApprovalHash: postgresMigrationApprovalHashV2(3, targetHash, "apply"),
  });
  assert.deepEqual([cli.fromVersion, cli.applied, cli.pending], [3, 0, 0]);
  console.log("PG17 Editor candidate: rollback, non-superuser, target, body hash, catalog drift, commit, repeat refusal and CLI compatibility passed");
`;
const start = source.indexOf(seam);
const ending = "\n  });";
const end = source.indexOf(ending, start);
assert.ok(end > start);
const applied = source.slice(0, start) + checkCandidate + source.slice(end + ending.length);
const hook = registerHooks({
  load(url, context, next) {
    if (url !== runner.href) return next(url, context);
    return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(applied) };
  },
});
try { await import(runner.href); }
finally { hook.deregister(); }
