import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { loadPostgresMigrations, postgresMigrationManifest } from "@/lib/db/postgres/migration-manifest";
import { inspectMigrationTarget } from "@/lib/db/postgres/migration-target";
import { runPostgresMigrations } from "@/lib/db/postgres/migration-runner";
import { postgresProvisionTemplate } from "@/lib/db/postgres/provision-template";
import { runMigrationCli } from "../../scripts/postgres/migrate";
vi.mock("server-only", () => ({}));
const connectionString = "postgresql://dream_test_admin:dummy-password@127.0.0.1:54321/dream_test_b5";
const target = { connectionString, profile: "synthetic" as const };

describe("B5 locked source and safe targets", () => {
  it("loads only the three canonical sources without nested outer transactions", async () => {
    const sources = await loadPostgresMigrations();
    expect(sources.map(row => row.id)).toEqual(postgresMigrationManifest.map(row => row.id));
    for (const row of sources) { expect(row.sql).not.toMatch(/^BEGIN;/); expect(row.sql).not.toMatch(/COMMIT;\s*$/); }
    expect(sources[1].sql).toContain("BEGIN\n");
  });
  it("SQL comment/checksum tampering fails before any connection", async () => {
    const dir = join(process.cwd(), "tmp", `b5-manifest-${randomUUID()}`); await mkdir(dir, { recursive: true });
    for (const entry of postgresMigrationManifest) await writeFile(join(dir, entry.file), await readFile(new URL(`../../lib/db/postgres/${entry.file}`, import.meta.url)));
    await writeFile(join(dir, postgresMigrationManifest[1].file), "-- changed source");
    const connect = vi.fn();
    await expect(runPostgresMigrations({ pool: { connect } as unknown as Pick<Pool, "connect">, target,
      expectedTargetHash: inspectMigrationTarget(target).targetHash, mode: "apply", sourceRoot: pathToFileURL(`${dir}/`) })).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(connect).not.toHaveBeenCalled();
  });
  it("target fingerprint excludes passwords while fixing host/port/database/operator", () => {
    const result = inspectMigrationTarget(target);
    expect(result.targetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(inspectMigrationTarget({ ...target, connectionString: connectionString.replace("dummy-password", "other-password") }).targetHash).toBe(result.targetHash);
    expect(inspectMigrationTarget({ ...target, connectionString: connectionString.replace("54321", "54322") }).targetHash).not.toBe(result.targetHash);
  });
  it.each(["postgresql://user:secret@example.invalid:5432/dream_test_b5", "postgresql://user:secret@127.0.0.1:5432/production", `${connectionString}?sslmode=no-verify`])("synthetic profile rejects wrong targets", uri => {
    expect(() => inspectMigrationTarget({ connectionString: uri, profile: "synthetic" })).toThrow("MIGRATION_TARGET");
  });
  it("managed profile has no project default and requires matching direct host/ref", () => {
    const ref = "abcdefghijklmnopqrst";
    expect(() => inspectMigrationTarget({ connectionString: "postgresql://owner:secret@db.wrong.supabase.co:5432/postgres", profile: "managed-staging", projectRef: ref })).toThrow("MIGRATION_TARGET");
    expect(inspectMigrationTarget({ connectionString: `postgresql://owner:secret@db.${ref}.supabase.co:5432/postgres`, profile: "managed-staging", projectRef: ref }).targetHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("wrong expected target hash refuses before connecting", async () => {
    const connect = vi.fn();
    await expect(runPostgresMigrations({ pool: { connect } as unknown as Pick<Pool, "connect">, target, expectedTargetHash: "a".repeat(64), mode: "apply" })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(connect).not.toHaveBeenCalled();
  });
});
describe("B5 CLI and password-free provision output", () => {
  it("fingerprint emits only a safe hash and never a DSN/operator name", async () => {
    const lines: string[] = [];
    expect(await runMigrationCli(["fingerprint"], { DREAM_PG_MIGRATION_URL: connectionString, DREAM_PG_MIGRATION_PROFILE: "synthetic" }, line => lines.push(line))).toBe(0);
    expect(JSON.parse(lines[0])).toEqual({ targetHash: inspectMigrationTarget(target).targetHash });
    expect(lines.join()).not.toContain("dummy-password"); expect(lines.join()).not.toContain("dream_test_admin");
  });
  it.each([{ args: ["apply", connectionString] }, { args: ["unknown"] }, { args: ["apply"] }])("no inline secret/unknown flags or implicit production fallback", async ({ args }) => {
    const lines: string[] = [];
    expect(await runMigrationCli(args, { DATABASE_URL: connectionString }, line => lines.push(line))).toBe(1);
    expect(lines).toEqual([JSON.stringify({ error: "MIGRATION_TARGET" })]);
  });
  it("provision template has no supplied password and fails on existing logins", () => {
    const sql = postgresProvisionTemplate();
    expect(sql).toContain("PASSWORD NULL"); expect(sql).not.toContain("dummy-password");
    expect(sql).toContain("Existing login must be reviewed separately");
    expect(sql).toContain("WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
    expect(sql).not.toMatch(/ALTER ROLE|DROP /);
  });
});
