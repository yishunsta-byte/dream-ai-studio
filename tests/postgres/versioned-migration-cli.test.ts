import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as runner from "@/lib/db/postgres/migration-runner-v2";
import * as connection from "@/lib/db/postgres/connection";
import { PostgresMigrationError } from "@/lib/db/postgres/migration-manifest";
import { postgresMigrationManifestsV2 } from "@/lib/db/postgres/migration-manifest-v2";
import { inspectMigrationTarget, type MigrationTarget } from "@/lib/db/postgres/migration-target";
import { parseVersionedMigrationCliArgs, runVersionedMigrationCli } from "../../scripts/postgres/migrate-v2";
vi.mock("server-only", () => ({}));
afterEach(() => vi.restoreAllMocks());
const canary = "B24_SYNTHETIC_DO_NOT_PRINT", offlineUri = `postgresql://dream_test_admin:${canary}@127.0.0.1:1/dream_test_b24`;
const envFor = (uri = offlineUri) => ({ DREAM_PG_MIGRATION_URL: uri, DREAM_PG_MIGRATION_PROFILE: "synthetic" });
function reviewedEnv(version: 3 | 4, mode: "apply" | "dry-run", uri = offlineUri) {
  const env = envFor(uri), hash = inspectMigrationTarget({ connectionString: uri, profile: "synthetic" }).targetHash;
  return { ...env, DREAM_PG_MIGRATION_TARGET_HASH: hash, DREAM_PG_MIGRATION_APPROVAL_HASH: runner.postgresMigrationApprovalHashV2(version, hash, mode) };
}
const argsFor = (command: "apply" | "dry-run" | "fingerprint", version: 3 | 4, mode?: "apply" | "dry-run") => [command, "--schema", String(version), ...(command === "fingerprint" ? ["--mode", mode!] : [])];
function mockSuccess() {
  return vi.spyOn(runner, "runPostgresMigrationsV2").mockImplementation(async value => Object.freeze({ targetHash: value.expectedTargetHash,
    approvalHash: value.expectedApprovalHash, schemaVersion: value.version, fromVersion: null, mode: value.mode,
    applied: value.mode === "apply" ? value.version : 0, pending: value.mode === "apply" ? 0 : value.version,
    manifest: Object.freeze(postgresMigrationManifestsV2[value.version].map(({ id, checksum }) => Object.freeze({ id, checksum }))) }));
}
describe("B24 strict syntax and redacted environment adapter", () => {
  it.each([
    ["apply", "--schema", "3"], ["apply", "--schema", "4"], ["dry-run", "--schema", "3"], ["dry-run", "--schema", "4"],
    ["fingerprint", "--schema", "3", "--mode", "apply"], ["fingerprint", "--schema", "4", "--mode", "dry-run"],
  ])("accepts only canonical complete command %s %s %s", (...args) => { expect(Object.isFrozen(parseVersionedMigrationCliArgs(args))).toBe(true); });
  it.each([
    [], ["latest"], ["apply"], ["apply", "4"], ["apply", "--schema"], ["apply", "--schema=4"],
    ["apply", "--schema", "4", "--schema", "4"], ["apply", "--schema", "4", "--mode", "apply"],
    ["fingerprint", "--schema", "4"], ["fingerprint", "--mode", "apply", "--schema", "4"],
    ["fingerprint", "--schema", "4", "--mode", "latest"], ["fingerprint", "--schema", "4", "--mode", "apply", "extra"],
    ["provision-template", "--schema", "4"], ["apply", "--schema", "4", "--url", offlineUri],
    ["apply", "--schema", "4", "--ca", canary], ["apply", "--schema", "4", "--password", canary],
  ])("rejects missing/duplicate/extra/secret syntax without echo: %s", async (...args) => {
    const invoke = mockSuccess(), lines: string[] = [];
    expect(await runVersionedMigrationCli(args, envFor(), line => lines.push(line))).toBe(1);
    expect(lines).toEqual(['{"error":"MIGRATION_TARGET"}']); expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["2", "5", "latest", "04", "4.0", " 4", "+3"])("rejects noncanonical schema %s", async version => {
    const invoke = mockSuccess(), lines: string[] = [];
    expect(await runVersionedMigrationCli(["apply", "--schema", version], envFor(), line => lines.push(line))).toBe(1);
    expect(lines).toEqual(['{"error":"MIGRATION_SOURCE"}']); expect(invoke).not.toHaveBeenCalled();
  });
  it("fingerprint verifies fixed sources offline and snapshots argv/environment without approvals", async () => {
    const invoke = mockSuccess(), pool = vi.spyOn(connection, "createPostgresPool"), env = { ...envFor(), DREAM_PG_MIGRATION_CA: canary };
    const args = argsFor("fingerprint", 4, "apply"), lines: string[] = [], expected = reviewedEnv(4, "apply");
    const work = runVersionedMigrationCli(args, env, line => lines.push(line)); args[4] = "dry-run"; env.DREAM_PG_MIGRATION_URL = "invalid"; env.DREAM_PG_MIGRATION_PROFILE = "invalid";
    expect(await work).toBe(0); expect(invoke).not.toHaveBeenCalled(); expect(pool).not.toHaveBeenCalled();
    expect(JSON.parse(lines[0])).toMatchObject({ command: "fingerprint", schemaVersion: 4, mode: "apply", targetHash: expected.DREAM_PG_MIGRATION_TARGET_HASH, approvalHash: expected.DREAM_PG_MIGRATION_APPROVAL_HASH });
    expect(lines[0]).not.toContain(canary); expect(lines[0]).not.toContain("dream_test_admin");
  });
  it.each(["DREAM_PG_MIGRATION_TARGET_HASH", "DREAM_PG_MIGRATION_APPROVAL_HASH"])("does not generate missing execution approval %s", async key => {
    const invoke = mockSuccess(), env: Record<string, string | undefined> = reviewedEnv(4, "apply"); delete env[key]; const lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("apply", 4), env, line => lines.push(line))).toBe(1); expect(invoke).not.toHaveBeenCalled(); expect(lines).toEqual(['{"error":"MIGRATION_TARGET"}']);
  });
  it("forwards exact reviewed hashes/target/CA once and freezes target", async () => {
    const invoke = mockSuccess(), env = { ...reviewedEnv(3, "dry-run"), DREAM_PG_MIGRATION_CA: canary }, lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("dry-run", 3), env, line => lines.push(line))).toBe(0);
    const input = invoke.mock.calls[0][0]; expect(invoke).toHaveBeenCalledOnce(); expect(input).toMatchObject({ version: 3, mode: "dry-run", expectedTargetHash: env.DREAM_PG_MIGRATION_TARGET_HASH, expectedApprovalHash: env.DREAM_PG_MIGRATION_APPROVAL_HASH, ca: canary });
    expect(input.target.connectionString).toBe(offlineUri); expect(Object.isFrozen(input.target)).toBe(true); expect(lines[0]).not.toContain(canary);
  });
  it("execution retains original environment after the runner await begins", async () => {
    const invoke = mockSuccess(), env = { ...reviewedEnv(4, "apply"), DREAM_PG_MIGRATION_CA: canary }, original = { ...env }, lines: string[] = [];
    const work = runVersionedMigrationCli(argsFor("apply", 4), env, line => lines.push(line));
    env.DREAM_PG_MIGRATION_URL = "invalid"; env.DREAM_PG_MIGRATION_TARGET_HASH = "0".repeat(64); env.DREAM_PG_MIGRATION_APPROVAL_HASH = "0".repeat(64); env.DREAM_PG_MIGRATION_CA = "changed";
    expect(await work).toBe(0); expect(invoke.mock.calls[0][0]).toMatchObject({ target: { connectionString: original.DREAM_PG_MIGRATION_URL }, expectedTargetHash: original.DREAM_PG_MIGRATION_TARGET_HASH, expectedApprovalHash: original.DREAM_PG_MIGRATION_APPROVAL_HASH, ca: canary });
    expect(JSON.parse(lines[0]).approvalHash).toBe(original.DREAM_PG_MIGRATION_APPROVAL_HASH);
  });
  it("projects only safe fields and treats manifest key order as semantic data", async () => {
    const invoke = mockSuccess(), good = invoke.getMockImplementation()!;
    invoke.mockImplementation(async input => { const value = await good(input); return { ...value, privateDriver: canary, manifest: value.manifest.map(entry => ({ checksum: entry.checksum, id: entry.id, password: canary })) }; });
    const lines: string[] = []; expect(await runVersionedMigrationCli(argsFor("apply", 4), reviewedEnv(4, "apply"), line => lines.push(line))).toBe(0);
    expect(lines[0]).not.toMatch(/password|privateDriver|B24_SYNTHETIC/); expect(invoke).toHaveBeenCalledOnce();
  });
  it("invalid runner result never becomes success or triggers automatic retry", async () => {
    const invoke = mockSuccess(), good = invoke.getMockImplementation()!; invoke.mockImplementation(async input => ({ ...await good(input), applied: 7 }));
    const lines: string[] = []; expect(await runVersionedMigrationCli(argsFor("apply", 4), reviewedEnv(4, "apply"), line => lines.push(line))).toBe(1);
    expect(lines).toEqual(['{"error":"MIGRATION_FAILED","outcome":"unknown"}']); expect(invoke).toHaveBeenCalledOnce();
  });
  it("keeps session/ref/role/port metadata exact without inferring it from routing username", async () => {
    const invoke = mockSuccess(), ref = "abcdefghijklmnopqrst", role = "migration_owner", host = "aws-0-ap-northeast-2.pooler.supabase.com";
    const target: MigrationTarget = { connectionString: `postgresql://${role}.${ref}:${canary}@${host}:5432/postgres`, profile: "managed-session-staging", projectRef: ref,
      sessionHost: host, sessionPort: "5432", sessionDatabase: "postgres", sessionUsername: `${role}.${ref}`, sessionRole: role };
    const hash = inspectMigrationTarget(target).targetHash;
    const env = { DREAM_PG_MIGRATION_URL: target.connectionString, DREAM_PG_MIGRATION_PROFILE: target.profile, DREAM_PG_MIGRATION_PROJECT_REF: ref,
      DREAM_PG_MIGRATION_SESSION_HOST: host, DREAM_PG_MIGRATION_SESSION_PORT: "5432", DREAM_PG_MIGRATION_SESSION_DATABASE: "postgres", DREAM_PG_MIGRATION_SESSION_USERNAME: `${role}.${ref}`, DREAM_PG_MIGRATION_SESSION_ROLE: role,
      DREAM_PG_MIGRATION_CA: canary, DREAM_PG_MIGRATION_TARGET_HASH: hash, DREAM_PG_MIGRATION_APPROVAL_HASH: runner.postgresMigrationApprovalHashV2(4, hash, "apply") };
    const lines: string[] = []; expect(await runVersionedMigrationCli(argsFor("apply", 4), env, line => lines.push(line))).toBe(0);
    expect(invoke.mock.calls[0][0].target).toEqual(target); expect(lines[0]).not.toMatch(/pooler|migration_owner|B24_SYNTHETIC/);
  });
  it("never falls back to general DATABASE_URL or inherited environment values", async () => {
    const invoke = mockSuccess(), lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("fingerprint", 4, "apply"), { DATABASE_URL: offlineUri, DREAM_PG_MIGRATION_PROFILE: "synthetic" }, line => lines.push(line))).toBe(1);
    expect(invoke).not.toHaveBeenCalled(); expect(lines).toEqual(['{"error":"MIGRATION_TARGET"}']);
  });
  it("rejects environment accessors without invoking them", async () => {
    const invoke = mockSuccess(), env = envFor(), getter = vi.fn(() => { throw Error(canary); });
    Object.defineProperty(env, "DREAM_PG_MIGRATION_URL", { get: getter }); const lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("apply", 4), env, line => lines.push(line))).toBe(1); expect(getter).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled(); expect(lines[0]).not.toContain(canary);
  });
  it.each(["not-applied", "unknown", "committed"] as const)("preserves redacted failure outcome %s with nonzero exit and one attempt", async outcome => {
    const invoke = vi.spyOn(runner, "runPostgresMigrationsV2").mockRejectedValue(new runner.PostgresMigrationFailureV2(outcome)); const lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("apply", 4), reviewedEnv(4, "apply"), line => lines.push(line))).toBe(1);
    expect(lines).toEqual([JSON.stringify({ error: "MIGRATION_FAILED", outcome })]); expect(invoke).toHaveBeenCalledOnce();
  });
  it("never serializes raw driver errors, cause or unrecognized result fields", async () => {
    const invoke = vi.spyOn(runner, "runPostgresMigrationsV2").mockRejectedValue(Object.assign(Error(canary), { cause: { password: canary }, code: "23514" })); const lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("apply", 4), reviewedEnv(4, "apply"), line => lines.push(line))).toBe(1);
    expect(lines).toEqual(['{"error":"MIGRATION_FAILED","outcome":"unknown"}']); expect(invoke).toHaveBeenCalledOnce();
  });
  it("known catalog errors retain closed code without raw details", async () => {
    vi.spyOn(runner, "runPostgresMigrationsV2").mockRejectedValue(new PostgresMigrationError("MIGRATION_STATE")); const lines: string[] = [];
    expect(await runVersionedMigrationCli(argsFor("apply", 4), reviewedEnv(4, "apply"), line => lines.push(line))).toBe(1); expect(lines).toEqual(['{"error":"MIGRATION_STATE"}']);
  });
  it("broken output never reruns an operation or retries the writer", async () => {
    const invoke = mockSuccess(), output = vi.fn(() => { throw Error(canary); });
    expect(await runVersionedMigrationCli(argsFor("apply", 4), reviewedEnv(4, "apply"), output)).toBe(1); expect(invoke).toHaveBeenCalledOnce(); expect(output).toHaveBeenCalledOnce();
  });
});

describe.skipIf(process.env.DREAM_PG_B24_SCHEMA_TEST !== "1")("B24 actual owned CLI child processes", () => {
  let admin: Pool, uri: string;
  const owner = "00000000-0000-4000-8000-000000000001";
  beforeAll(async () => {
    uri = process.env.DREAM_PG_TEST_ADMIN_URL ?? ""; const u = new URL(uri);
    if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || !u.port || u.username !== "dream_test_admin" || !/^\/dream_test_[a-z0-9_]+$/.test(u.pathname) || u.search || u.hash) throw Error("Owned fresh synthetic target required");
    admin = new Pool({ connectionString: uri, max: 3 });
    expect((await admin.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('auth') AS auth")).rows[0]).toEqual({ dream: null, auth: null });
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)"); await admin.query("INSERT INTO auth.users VALUES($1)", [owner]);
  });
  beforeEach(async () => {
    await admin.query("DROP EVENT TRIGGER IF EXISTS b24_fail; DROP FUNCTION IF EXISTS public.b24_fail(); DROP SCHEMA IF EXISTS dream CASCADE; DROP SCHEMA IF EXISTS dream_migrations CASCADE; DROP ROLE IF EXISTS dream_api_login; DROP ROLE IF EXISTS dream_worker_login; DROP ROLE IF EXISTS dream_api; DROP ROLE IF EXISTS dream_worker");
  });
  afterAll(async () => { await admin?.end(); });
  async function child(label: string, args: string[], env: Record<string, string | undefined>, importing = false) {
    const clean = { ...process.env };
    for (const key of Object.keys(clean)) if (key.startsWith("PG") || key.startsWith("DREAM_PG_MIGRATION_") || key === "NODE_OPTIONS") delete clean[key];
    Object.assign(clean, { DATABASE_URL: `postgresql://unapproved:${canary}@invalid.example:5432/not_allowed` }, env);
    const argv = ["--conditions=react-server", "--import", "tsx", ...(importing ? ["--input-type=module", "-e", "await import('./scripts/postgres/migrate-v2.ts')"] : ["scripts/postgres/migrate-v2.ts", ...args])];
    const result = await new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
      const processChild = spawn(process.execPath, argv, { cwd: process.cwd(), env: clean, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [], stderr: Buffer[] = []; let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; processChild.kill(); }, 15000);
      processChild.stdout.on("data", data => stdout.push(Buffer.from(data))); processChild.stderr.on("data", data => stderr.push(Buffer.from(data)));
      processChild.once("error", () => { clearTimeout(timer); reject(Error("Owned CLI child launch failed")); });
      processChild.once("close", code => { clearTimeout(timer); resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), timedOut }); });
    });
    await appendFile(join(process.env.DREAM_PG_B24_EVIDENCE_ROOT!, "child-output.jsonl"), JSON.stringify({ label, ...result }) + "\n");
    expect(result.timedOut).toBe(false); expect(result.stdout + result.stderr).not.toContain(canary);
    expect(result.stdout + result.stderr).not.toContain("b3-synthetic-admin-only"); expect(result.stdout + result.stderr).not.toContain(uri);
    expect(result.stderr).toBe("");
    if (!importing) expect(result.stdout.trim().split("\n")).toHaveLength(1);
    return { ...result, record: importing ? null : JSON.parse(result.stdout) };
  }
  async function fresh() {
    expect((await admin.query("SELECT to_regnamespace('dream') AS dream,to_regnamespace('dream_migrations') AS history")).rows[0]).toEqual({ dream: null, history: null });
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('dream_api','dream_worker')")).rows[0].n).toBe(0);
  }
  it.each([[3, "apply"], [3, "dry-run"], [4, "apply"], [4, "dry-run"]] as const)("offline fingerprint schema%s mode%s succeeds with unreachable port/no DB", async (version, mode) => {
    const value = await child(`fingerprint-${version}-${mode}`, argsFor("fingerprint", version, mode), envFor());
    expect(value.code).toBe(0); expect(value.record).toMatchObject({ command: "fingerprint", schemaVersion: version, mode, approvalHash: reviewedEnv(version, mode).DREAM_PG_MIGRATION_APPROVAL_HASH }); await fresh();
  }, 30000);
  it("import alone emits nothing and does not execute with bad environment", async () => {
    const value = await child("import-only", [], { DREAM_PG_MIGRATION_URL: canary, DREAM_PG_MIGRATION_PROFILE: "invalid" }, true);
    expect(value.code).toBe(0); expect(value.stdout).toBe(""); await fresh();
  });
  it("actual readonly dry-run has pending4 and no DDL/history/roles", async () => {
    const value = await child("dry-run-fresh4", argsFor("dry-run", 4), reviewedEnv(4, "dry-run", uri));
    expect(value.code).toBe(0); expect(value.record).toMatchObject({ mode: "dry-run", pending: 4, applied: 0, fromVersion: null }); await fresh();
  });
  it("actual fresh3→upgrade4 and zero reapply preserve existing history/data", async () => {
    expect((await child("fresh3", argsFor("apply", 3), reviewedEnv(3, "apply", uri))).record).toMatchObject({ applied: 3, pending: 0 });
    const before = (await admin.query("SELECT ordinal,id,checksum,applied_at FROM dream_migrations.history ORDER BY ordinal")).rows;
    await admin.query("INSERT INTO dream.settings VALUES($1,'keep',$2)", [owner, ' {"original":true} ']);
    expect((await child("plan-upgrade4", argsFor("dry-run", 4), reviewedEnv(4, "dry-run", uri))).record).toMatchObject({ pending: 1, applied: 0 });
    expect((await child("upgrade4", argsFor("apply", 4), reviewedEnv(4, "apply", uri))).record).toMatchObject({ applied: 1, fromVersion: 3 });
    expect((await child("repeat4", argsFor("apply", 4), reviewedEnv(4, "apply", uri))).record).toMatchObject({ applied: 0, fromVersion: 4 });
    expect((await admin.query("SELECT ordinal,id,checksum,applied_at FROM dream_migrations.history ORDER BY ordinal")).rows.slice(0, 3)).toEqual(before);
    expect((await admin.query("SELECT value_json FROM dream.settings WHERE key='keep'")).rows[0].value_json).toBe(' {"original":true} ');
  }, 30000);
  it("actual fresh4 succeeds and downgrade3 returns nonzero STATE", async () => {
    const first = await child("fresh4", argsFor("apply", 4), { ...reviewedEnv(4, "apply", uri), DREAM_PG_MIGRATION_CA: canary }); expect(first.code).toBe(0); expect(first.record).toMatchObject({ applied: 4 });
    const rejected = await child("reject-downgrade3", argsFor("apply", 3), reviewedEnv(3, "apply", uri)); expect(rejected.code).toBe(1); expect(rejected.record).toEqual({ error: "MIGRATION_STATE" });
  }, 30000);
  it("fingerprint output never self-authorizes later apply without explicit environment approval", async () => {
    expect((await child("review-information-only", argsFor("fingerprint", 4, "apply"), envFor(uri))).code).toBe(0);
    const value = await child("no-self-approval", argsFor("apply", 4), envFor(uri)); expect(value.code).toBe(1); expect(value.record).toEqual({ error: "MIGRATION_TARGET" }); await fresh();
  }, 30000);
  it("dry-run binding cannot write, wrong target hash cannot connect and DATABASE_URL never falls back", async () => {
    for (const [label, env] of [["wrong-action", reviewedEnv(4, "dry-run", uri)], ["wrong-target", { ...reviewedEnv(4, "apply", uri), DREAM_PG_MIGRATION_TARGET_HASH: "0".repeat(64) }], ["no-specific-url", { DREAM_PG_MIGRATION_PROFILE: "synthetic", DATABASE_URL: uri }]] as const) {
      const value = await child(label, argsFor("apply", 4), env); expect(value.code).toBe(1); expect(value.record).toEqual({ error: "MIGRATION_TARGET" });
    }
    await fresh();
  }, 30000);
  it("rejected secret-looking arguments are not echoed by raw child streams", async () => {
    const value = await child("forbidden-url-argument", ["apply", "--schema", "4", "--url", offlineUri], envFor(uri)); expect(value.code).toBe(1); expect(value.record).toEqual({ error: "MIGRATION_TARGET" }); await fresh();
  });
  it("real child partial history rejection leaves the original incorrect history untouched", async () => {
    await child("partial-setup3", argsFor("apply", 3), reviewedEnv(3, "apply", uri)); await admin.query("DELETE FROM dream_migrations.history WHERE ordinal=3");
    const value = await child("reject-partial", argsFor("apply", 4), reviewedEnv(4, "apply", uri)); expect(value.code).toBe(1); expect(value.record).toEqual({ error: "MIGRATION_HISTORY" });
    expect((await admin.query("SELECT count(*)::int AS n FROM dream_migrations.history")).rows[0].n).toBe(2);
  }, 30000);
  it("real child mid-SQL4 failure reports not-applied and rolls back all prefix/history/roles", async () => {
    await admin.query("CREATE FUNCTION public.b24_fail() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF to_regclass('dream.storage_verification_runs') IS NOT NULL THEN RAISE EXCEPTION 'synthetic child failure'; END IF; END $$; CREATE EVENT TRIGGER b24_fail ON ddl_command_start WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.b24_fail()");
    const value = await child("atomic-child-rollback", argsFor("apply", 4), reviewedEnv(4, "apply", uri)); expect(value.code).toBe(1); expect(value.record).toEqual({ error: "MIGRATION_FAILED", outcome: "not-applied" }); await fresh();
  });
  it("failed child connection closes and redacts native driver error", async () => {
    const value = await child("connection-refused", argsFor("dry-run", 4), reviewedEnv(4, "dry-run")); expect(value.code).toBe(1); expect(value.record).toEqual({ error: "MIGRATION_FAILED", outcome: "not-applied" });
  });
});
