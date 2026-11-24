import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { readRegisteredReferenceAuthority } from "../../lib/reference-analysis/registered-authority";

vi.mock("server-only", () => ({}));

const owner = "10000000-0000-4000-8000-000000000061";
const other = "10000000-0000-4000-8000-000000000062";
const projectId = "10000000-0000-4000-8000-000000000063";
const assetId = "019b8b74-3f10-7137-8265-68b11d809f0c";
const sha256 = "a".repeat(64);
const objectKey = owner + "/assets/" + assetId + "/" + sha256 + ".mp4";
const selection = { projectId, assetId };
const approved = { kind: "verified", userId: owner, email: "owner@example.invalid" } as const;
const env = { DREAM_PROJECT_READ_BACKEND: "postgres", DREAM_AUTH_MODE: "supabase",
  DATABASE_URL: "postgresql://synthetic:dummy@example.invalid:5432/dream" };
const observed = { status: "observed", analysisAuthority: "unavailable", registration: {
  media: "video", mime: "video/mp4", sizeBytes: 80, registeredSha256: sha256, storageGeneration: 2,
} };
const hidden = { status: "unavailable", reason: "not_visible" };

describe("server-only registered REA authority observation", () => {
  let db: Database.Database;
  let auth: ServerAuthResult;
  let query: ReturnType<typeof vi.fn>;
  let getPool: ReturnType<typeof vi.fn<(connectionString: string) => Pick<Pool, "connect">>>;
  let resolveAuth: ReturnType<typeof vi.fn<() => Promise<ServerAuthResult>>>;

  beforeEach(() => {
    db = new Database(":memory:");
    auth = approved;
    db.exec(`
      ATTACH DATABASE ':memory:' AS dream;
      CREATE TABLE dream.projects (owner_id TEXT, id TEXT, archived_at TEXT);
      CREATE TABLE dream.assets (owner_id TEXT, id TEXT, kind TEXT, mime TEXT, file_path TEXT,
        sha256 TEXT, size_bytes INTEGER, archived_at TEXT, is_mock INTEGER);
      CREATE TABLE dream.project_assets (owner_id TEXT, project_id TEXT, asset_id TEXT, purpose TEXT);
      CREATE TABLE dream.asset_receipt_state (owner_id TEXT, asset_id TEXT, object_id TEXT, current_receipt_id TEXT, status TEXT);
      CREATE TABLE dream.storage_objects (owner_id TEXT, id TEXT, registered_asset_id TEXT, lifecycle TEXT,
        object_key TEXT, sha256 TEXT, size_bytes INTEGER, kind TEXT, mime TEXT, identity_digest TEXT, active_generation INTEGER);
      CREATE TABLE dream.storage_verification_receipts (owner_id TEXT, id TEXT, object_id TEXT, asset_id TEXT,
        identity_digest TEXT, generation INTEGER, verified_at TEXT, not_after TEXT);
    `);
    db.prepare("INSERT INTO dream.projects VALUES (?, ?, NULL)").run(owner, projectId);
    db.prepare("INSERT INTO dream.assets VALUES (?, ?, 'video', 'video/mp4', ?, ?, 80, NULL, 0)")
      .run(owner, assetId, objectKey, sha256);
    db.prepare("INSERT INTO dream.project_assets VALUES (?, ?, ?, 'input')").run(owner, projectId, assetId);
    db.prepare("INSERT INTO dream.asset_receipt_state VALUES (?, ?, 'object', 'receipt', 'ready')").run(owner, assetId);
    db.prepare(`INSERT INTO dream.storage_objects VALUES
      (?, 'object', ?, 'registered', ?, ?, 80, 'video', 'video/mp4', 'identity', 2)`).run(owner, assetId, objectKey, sha256);
    db.prepare(`INSERT INTO dream.storage_verification_receipts VALUES
      (?, 'receipt', 'object', ?, 'identity', 2, '2000-01-01 00:00:00', '2099-01-01 00:00:00')`).run(owner, assetId);

    // Executes the adapter's production SELECT against local relations. The PG client/role handshake is a test double.
    query = vi.fn(async (sql: string, values: string[] = []) => {
      if (sql.startsWith("SELECT a.owner_id")) {
        const rows = db.prepare(sql).all({ "1": values[0], "2": values[1], "3": values[2] }) as Record<string, unknown>[];
        return { rows: rows.map(row => ({ ...row, size_bytes: String(row.size_bytes), storage_generation: String(row.storage_generation) })) };
      }
      return { command: sql.split(" ")[0] };
    });
    const client = Object.assign(new EventEmitter(), { query, release: vi.fn() });
    getPool = vi.fn(() => ({ connect: async () => client }) as unknown as Pick<Pool, "connect">);
    resolveAuth = vi.fn(async () => auth);
  });
  afterEach(() => { db.close(); });
  const read = (input: unknown = selection) => readRegisteredReferenceAuthority(input, { resolveAuth, getPool, environment: () => env });

  it("observes an owned, linked ready registered asset and matching receipt in an actor-scoped read only transaction", async () => {
    db.prepare("INSERT INTO dream.project_assets VALUES (?, ?, ?, 'another-input')").run(owner, projectId, assetId);
    expect(await read()).toEqual(observed);
    expect(JSON.stringify(await read())).not.toMatch(/object_key|filePath|ownerId|sourceGeneration|linkGeneration|permissionGeneration|restoreGeneration/);
    expect(query.mock.calls.slice(0, 5)).toEqual([
      ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"], ["SET LOCAL ROLE dream_api"],
      ["SELECT set_config('dream.actor_id', $1, true)", [owner]],
      [expect.stringContaining("SELECT a.owner_id"), [owner, projectId, assetId]], ["COMMIT"],
    ]);
  });

  it("closes unauthenticated, forbidden, local and malformed identities before reading configuration", async () => {
    const environment = vi.fn(() => env);
    for (const [decision, reason] of [
      [{ kind: "denied", code: "AUTH_REQUIRED", status: 401 }, "authentication_required"],
      [{ kind: "denied", code: "AUTH_FORBIDDEN", status: 403 }, "authentication_denied"],
      [{ kind: "denied", code: "AUTH_UNAVAILABLE", status: 503 }, "authentication_unavailable"],
      [{ kind: "local" }, "local_ownership_unavailable"],
      [{ kind: "verified", userId: "wrong", email: approved.email }, "authentication_unavailable"],
    ] as const) {
      auth = decision;
      expect(await readRegisteredReferenceAuthority(selection, { resolveAuth, getPool, environment }))
        .toEqual({ status: "unavailable", reason });
    }
    expect(environment).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
  });

  it("closes local data and rejects caller-supplied authority fields even with an authenticated actor", async () => {
    expect(await readRegisteredReferenceAuthority(selection, {
      resolveAuth, getPool, environment: () => ({ DREAM_PROJECT_READ_BACKEND: "sqlite" }),
    })).toEqual({ status: "unavailable", reason: "local_ownership_unavailable" });
    expect(await read({ ...selection, ownerId: other, sourceGeneration: "fake" }))
      .toEqual({ status: "unavailable", reason: "invalid_selection" });
    expect(getPool).not.toHaveBeenCalled();
  });

  it("conceals cross-owner, unlinked, and absent assets with the same result", async () => {
    auth = { ...approved, userId: other };
    expect(await read()).toEqual(hidden);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT a.owner_id"), [other, projectId, assetId]);
    auth = approved;
    const absent = "019b8b74-3f10-7137-8265-68b11d809f0d";
    expect(await read({ ...selection, assetId: absent })).toEqual(hidden);
    db.prepare("UPDATE dream.project_assets SET owner_id = ?").run(other);
    expect(await read()).toEqual(hidden);
  });

  it("detects link removal and observes a relink without certifying its continuity", async () => {
    expect(await read()).toEqual(observed);
    db.exec("DELETE FROM dream.project_assets");
    expect(await read()).toEqual(hidden);
    db.prepare("INSERT INTO dream.project_assets VALUES (?, ?, ?, 'input')").run(owner, projectId, assetId);
    expect(await read()).toEqual(observed);
    expect(resolveAuth).toHaveBeenCalledTimes(3);
  });

  it("rejects storage revocation, asset and project archive, and expired or superseded receipts", async () => {
    expect(await read()).toEqual(observed);
    for (const [reject, reset] of [
      ["UPDATE dream.asset_receipt_state SET status = 'revoked'", "UPDATE dream.asset_receipt_state SET status = 'ready'"],
      ["UPDATE dream.assets SET archived_at = '2000-01-01'", "UPDATE dream.assets SET archived_at = NULL"],
      ["UPDATE dream.projects SET archived_at = '2000-01-01'", "UPDATE dream.projects SET archived_at = NULL"],
      ["UPDATE dream.storage_verification_receipts SET not_after = '2000-01-02'", "UPDATE dream.storage_verification_receipts SET not_after = '2099-01-01'"],
      ["UPDATE dream.storage_objects SET active_generation = 3", "UPDATE dream.storage_objects SET active_generation = 2"],
    ]) {
      db.exec(reject);
      expect(await read()).toEqual(hidden);
      db.exec(reset);
    }
    auth = { kind: "denied", code: "AUTH_FORBIDDEN", status: 403 };
    expect(await read()).toEqual({ status: "unavailable", reason: "authentication_denied" });
  });

  it("rejects mismatched registration and unsafe object keys", async () => {
    db.exec("UPDATE dream.storage_objects SET sha256 = 'bad'");
    expect(await read()).toEqual(hidden);
    db.prepare("UPDATE dream.storage_objects SET sha256 = ?, object_key = 'private/path.mp4'").run(sha256);
    db.exec("UPDATE dream.assets SET file_path = 'private/path.mp4'");
    expect(await read()).toEqual(hidden);
  });

  it("closes a schema without receipt tables without retrying against base assets or SQLite", async () => {
    db.exec("DROP TABLE dream.asset_receipt_state");
    expect(await read()).toEqual({ status: "unavailable", reason: "managed_unavailable" });
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("SELECT a.owner_id"))).toHaveLength(1);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(getPool).toHaveBeenCalledOnce();
  });
});
