import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectMigrationTarget, type MigrationTarget } from "@/lib/db/postgres/migration-target";
import { runPostgresMigrations } from "@/lib/db/postgres/migration-runner";
import { runMigrationCli } from "../../scripts/postgres/migrate";
const mocks = vi.hoisted(() => ({ createPool: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/postgres/connection", () => ({ createPostgresPool: mocks.createPool }));
const ref = "abcdefghijklmnopqrst", host = "aws-0-test-region-1.pooler.supabase.com";
const target: MigrationTarget = Object.freeze({ connectionString: `postgresql://owner.${ref}:dummy-only@${host}:5432/postgres`, profile: "managed-session-staging", projectRef: ref,
  sessionHost: host, sessionPort: "5432", sessionDatabase: "postgres", sessionUsername: `owner.${ref}`, sessionRole: "owner" });
const hash = (t: MigrationTarget = target) => inspectMigrationTarget(t).targetHash;
const cliEnv = { DREAM_PG_MIGRATION_URL: target.connectionString, DREAM_PG_MIGRATION_PROFILE: target.profile, DREAM_PG_MIGRATION_PROJECT_REF: ref,
  DREAM_PG_MIGRATION_SESSION_HOST: host, DREAM_PG_MIGRATION_SESSION_PORT: "5432", DREAM_PG_MIGRATION_SESSION_DATABASE: "postgres",
  DREAM_PG_MIGRATION_SESSION_USERNAME: `owner.${ref}`, DREAM_PG_MIGRATION_SESSION_ROLE: "owner", DREAM_PG_MIGRATION_TARGET_HASH: hash(), DREAM_PG_MIGRATION_CA: "unit-ca" };

describe("B9 session target approval binding (no network)", () => {
  it("keeps provider routing identity separate from actual database role", () => {
    expect(inspectMigrationTarget(target)).toMatchObject({ username: "owner", database: "postgres", port: 5432 });
    expect(hash({ ...target, connectionString: target.connectionString.replace("dummy-only", "rotated") })).toBe(hash());
    expect(hash({ ...target, profile: "managed-session-live" })).not.toBe(hash());
  });
  it.each(["sessionHost", "sessionPort", "sessionDatabase", "sessionUsername", "sessionRole", "projectRef"] as const)("requires explicit %s", key => {
    expect(() => hash({ ...target, [key]: undefined })).toThrow("MIGRATION_TARGET");
  });
  it.each([
    { sessionHost: "aws-1-other.pooler.supabase.com" }, { sessionPort: "6543" }, { sessionDatabase: "other" },
    { sessionUsername: `other.${ref}` }, { sessionRole: "other" }, { projectRef: "zyxwvutsrqponmlkjihg" },
    { connectionString: target.connectionString.replace(":5432/", ":6543/"), sessionPort: "6543" },
    { connectionString: `${target.connectionString}?sslmode=no-verify` }, { connectionString: `${target.connectionString}#fragment` },
    { connectionString: target.connectionString.replace(host, `${host}.evil.invalid`), sessionHost: `${host}.evil.invalid` },
    { connectionString: target.connectionString.replace(host, `db.${ref}.supabase.co`), sessionHost: `db.${ref}.supabase.co` },
    { profile: "managed-session" }, { profile: "managed-transaction-live" }, { sessionRole: "role.with.dot" },
  ])("rejects mismatched approval/mode/host/query: %j", change => {
    expect(() => hash({ ...target, ...change } as MigrationTarget)).toThrow("MIGRATION_TARGET");
  });
  it("does not reclassify a pooler as managed direct or change old fingerprints", () => {
    expect(() => hash({ ...target, profile: "managed-staging" })).toThrow("MIGRATION_TARGET");
    const direct = { connectionString: `postgresql://owner:dummy@db.${ref}.supabase.co:5432/postgres`, profile: "managed-staging" as const, projectRef: ref };
    expect(inspectMigrationTarget(direct).username).toBe("owner");
    expect(() => hash({ ...direct, connectionString: target.connectionString })).toThrow("MIGRATION_TARGET");
  });
  it("every approved endpoint and role/ref change changes the binding", () => {
    const otherRef = "zyxwvutsrqponmlkjihg", otherHost = "aws-1-test-region-1.pooler.supabase.com";
    for (const t of [
      { ...target, connectionString: target.connectionString.replace(host, otherHost), sessionHost: otherHost },
      { ...target, connectionString: target.connectionString.replace("/postgres", "/other"), sessionDatabase: "other" },
      { ...target, connectionString: target.connectionString.replace(`owner.${ref}`, `admin.${ref}`), sessionUsername: `admin.${ref}`, sessionRole: "admin" },
      { ...target, connectionString: target.connectionString.replace(ref, otherRef), projectRef: otherRef, sessionUsername: `owner.${otherRef}` },
    ]) expect(hash(t)).not.toBe(hash());
  });
});

describe("B9 session runner contract (mocked transport, not managed execution)", () => {
  let client: EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let pool: { connect: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  let identity: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    identity = { database: "postgres", port: 5432, version: 170012, username: "owner", active: "owner", rolsuper: false, rolcreaterole: true, can_create: true };
    client = Object.assign(new EventEmitter(), { release: vi.fn(), query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT current_database()")) return { rows: [identity] };
      if (sql.startsWith("SELECT a.attnotnull")) return { rows: [{ attnotnull: true, uuid: true, unique_id: true }] };
      if (sql.startsWith("SELECT has_schema_privilege")) return { rows: [{ ok: true }] };
      if (sql.startsWith("SELECT to_regnamespace")) return { rows: [{ dream: null, journal: null, history: null }] };
      return { rows: [], command: sql === "COMMIT" ? "COMMIT" : sql };
    }) });
    pool = { connect: vi.fn(async () => client), end: vi.fn(async () => {}) }; mocks.createPool.mockReturnValue(pool);
  });
  const run = (t: MigrationTarget = target, ca: string | undefined = "unit-ca") => runPostgresMigrations({ target: t, expectedTargetHash: hash(t), mode: "dry-run", ca });
  it("owns one TLS-configured pool from the immutable approved target and maps role.ref", async () => {
    const mutable = { ...target }; const pending = run(mutable);
    mutable.connectionString = mutable.connectionString.replace(host, "evil.invalid"); mutable.sessionRole = "other";
    expect(await pending).toMatchObject({ targetHash: hash(), applied: 0, pending: 3 });
    expect(mocks.createPool).toHaveBeenCalledExactlyOnceWith({ connectionString: target.connectionString, max: 1, ca: "unit-ca" });
    expect(client.query.mock.calls[0][0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(client.query.mock.calls.some(([sql]) => /CREATE |INSERT |pg_advisory/.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledWith(false); expect(pool.end).toHaveBeenCalledOnce();
  });
  it.each(["username", "active", "database", "port"])("rejects actual %s mismatch and rolls back/closes", async key => {
    identity[key] = key === "port" ? 6543 : "unexpected";
    await expect(run()).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(client.query).toHaveBeenCalledWith("ROLLBACK"); expect(pool.end).toHaveBeenCalledOnce();
  });
  it.each([undefined, "", "   "])("requires process-local CA before creating pool (%s)", async ca => {
    await expect(runPostgresMigrations({ target, expectedTargetHash: hash(), mode: "dry-run", ca })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(mocks.createPool).not.toHaveBeenCalled();
  });
  it("does not accept the other environment label's approved hash", async () => {
    await expect(runPostgresMigrations({ target: { ...target, profile: "managed-session-live" }, expectedTargetHash: hash(), mode: "apply", ca: "unit-ca" })).rejects.toMatchObject({ code: "MIGRATION_TARGET" });
    expect(mocks.createPool).not.toHaveBeenCalled();
  });
  it("supports explicit live only with its own independently supplied binding/hash", async () => {
    const live = { ...target, profile: "managed-session-live" as const };
    expect(await run(live)).toMatchObject({ targetHash: hash(live), applied: 0, pending: 3 });
    expect(pool.end).toHaveBeenCalledOnce();
  });
  it("CLI binds explicit fields and emits only safe fingerprint/results/errors", async () => {
    const lines: string[] = [];
    expect(await runMigrationCli(["fingerprint"], cliEnv, s => lines.push(s))).toBe(0);
    expect(JSON.parse(lines[0])).toEqual({ targetHash: hash() });
    expect(await runMigrationCli(["dry-run"], cliEnv, s => lines.push(s))).toBe(0);
    expect(await runMigrationCli(["apply"], { ...cliEnv, DREAM_PG_MIGRATION_SESSION_ROLE: undefined }, s => lines.push(s))).toBe(1);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ error: "MIGRATION_TARGET" });
    expect(lines.join()).not.toContain("dummy-only"); expect(lines.join()).not.toContain(host); expect(lines.join()).not.toContain(`owner.${ref}`);
  });
  it("driver errors remain safe and the owned pool closes on connection failure", async () => {
    pool.connect.mockRejectedValueOnce(new Error(`sensitive ${target.connectionString}`));
    const lines: string[] = []; expect(await runMigrationCli(["dry-run"], cliEnv, s => lines.push(s))).toBe(1);
    expect(lines).toEqual(['{"error":"MIGRATION_FAILED"}']); expect(pool.end).toHaveBeenCalledOnce();
  });
});
