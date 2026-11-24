import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

// Reuse the reviewed T358 runner's owned processes, SQL, roles, verification
// and cleanup without an extension point in the checked-in fixture.
const runner = new URL("./t358-project-https-read-schema.pg17.ts", import.meta.url);
const source = readFileSync(runner, "utf8").replaceAll("\r\n", "\n");
const gitBlob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
// df696b6 only adds an opt-in T362 catalog check after the existing seam.
assert.equal(gitBlob, "b692f16f2ce75ec41ce00c1119ae7c54b8c8d092", "T358 fixture changed; review the T361 seam");
const seam = "  await checkRemoval(control, direct);";
assert.equal(source.split(seam).length, 2);
const combined = source.replace(seam, `
  const { verifyStack } = await import("../t361-project-https-read-next.mjs");
  const { createProjectReadRequest } = await import("../../lib/services/postgres/project-read-request");
  const admin = process.env.T361_ADMIN_PROJECT_READ === "1"
    ? (await import("../admin/admin-project-https-read-next.mjs")).adminProjectReadScenario : undefined;
  await verifyStack({
    origin,
    ids: { a, b, first, second, another, archived },
    legacyDatabaseUrl: \`postgresql://t358_direct:\${directPassword}@\${host}:\${port}/\${database}\`,
    countLegacyReadSessions: async () => Number((await control.query(
      "SELECT count(*) FROM pg_stat_activity WHERE application_name='dream-backend'"
    )).rows[0].count),
    sign: (id, iss) => token(id, { iss, exp: Math.floor(Date.now() / 1000) + 900 }),
    readBaseline: (userId, projectId) => {
      const read = createProjectReadRequest({
        resolveAuth: async () => ({ kind: "verified", userId, email: "approved@t361.test.invalid" }),
        environment: () => ({
          DREAM_AUTH_MODE: "supabase", DREAM_PROJECT_READ_BACKEND: "postgres",
          DATABASE_URL: "postgresql://synthetic:unused@127.0.0.1:5432/dream_test_unused",
        }),
        getPool: () => direct,
      });
      return projectId ? read.get(projectId) : read.list();
    },
    update: () => existingWrites(direct, "T361 updated in existing writer", "running"),
    revoke: () => asInstaller(control, () => control.query(
      "DELETE FROM project_read_private.approved_users WHERE id=$1", [a])),
    reapprove: () => asInstaller(control, () => control.query(
      "INSERT INTO project_read_private.approved_users VALUES ($1)", [a])),
    remove: async () => {
      afterWrites = await baseRows(control);
      await checkRemoval(control, direct);
    },
  }, admin);
`);
const hook = registerHooks({
  load(url, context, next) {
    if (url !== runner.href) return next(url, context);
    return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(combined) };
  },
});
try {
  await import(runner.href);
} finally {
  hook.deregister();
}
