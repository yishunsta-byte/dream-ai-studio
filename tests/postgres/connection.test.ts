import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "@/lib/db/postgres/connection";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, type ActorTransaction } from "@/lib/db/postgres/types";
import { postgresProjectsRepository } from "@/lib/repo/postgres/projects";

vi.mock("server-only", () => ({}));
const actor = actorFromVerifiedUserId("00000000-0000-4000-8000-000000000001");
function fake(failAt?: string, rollbackFails = false) {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (sql: string) => {
      if (sql === failAt || (rollbackFails && sql === "ROLLBACK")) throw new Error("postgresql://private:password@private/production");
      return { command: sql === "COMMIT" ? "COMMIT" : "SELECT", rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  });
  return { client, pool: { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pick<Pool, "connect"> };
}
describe("B3 transaction failure/control paths (driver doubles, not database evidence)", () => {
  it.each(["BEGIN", "SET LOCAL ROLE dream_api", "SELECT set_config('dream.actor_id', $1, true)", "COMMIT"])("%s failure never exposes driver secrets and releases once", async failAt => {
    const { pool, client } = fake(failAt);
    await expect(withActorTransaction(pool, actor, () => 1)).rejects.toMatchObject({ message: "PG_TRANSACTION", code: "PG_TRANSACTION" });
    expect(client.release).toHaveBeenCalledTimes(1);
    if (failAt === "BEGIN" || failAt === "COMMIT") expect(client.release).toHaveBeenCalledWith(true);
    if (failAt !== "BEGIN") expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
  it("failed ROLLBACK destroys the connection", async () => {
    const { pool, client } = fake(undefined, true);
    await expect(withActorTransaction(pool, actor, () => { throw new Error("private operation"); })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("callback failure rolls back and can release a healthy client", async () => {
    const { pool, client } = fake();
    await expect(withActorTransaction(pool, actor, () => { throw new Error("private operation"); })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("acquire failure is sanitized", async () => {
    const pool = { connect: vi.fn(async () => { throw new Error("private DSN"); }) } as unknown as Pick<Pool, "connect">;
    await expect(withActorTransaction(pool, actor, () => 1)).rejects.toMatchObject({ message: "PG_UNAVAILABLE" });
  });
  it("waits for a fire-and-forget query before COMMIT and closes the escaped tx", async () => {
    const { pool, client } = fake();
    let finish!: () => void;
    let escaped!: ActorTransaction;
    const base = client.query.getMockImplementation()!;
    client.query.mockImplementation(sql => sql === "pending" ? new Promise(resolve => { finish = () => resolve({ command: "SELECT", rows: [], rowCount: 0 }); }) : base(sql));
    const operation = withActorTransaction(pool, actor, tx => { escaped = tx; void tx.query("pending"); });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    finish(); await operation;
    await expect(escaped.query("late")).rejects.toMatchObject({ code: "TX_CLOSED" });
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("late");
  });
  it("connection error while checked out forces discard", async () => {
    const { pool, client } = fake();
    await expect(withActorTransaction(pool, actor, () => { client.emit("error", new Error("private")); })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("an escaped tx cannot be called from outside its active callback context", async () => {
    const { pool, client } = fake();
    let escaped!: ActorTransaction;
    let finish!: () => void;
    const operation = withActorTransaction(pool, actor, async tx => {
      escaped = tx;
      await new Promise<void>(resolve => { finish = resolve; });
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(escaped.query("outside context")).rejects.toMatchObject({ code: "TX_CLOSED" });
    finish(); await operation;
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("outside context");
  });
});
describe("B3 explicit configuration and DTO boundaries", () => {
  it.each(["", "not a DSN", "postgresql://user@host/db?sslmode=no-verify", "postgresql://user@host/db#secret", "postgresql://user@host:5432/db", "postgresql://user:synthetic@host/db"])("refuses missing/overriding configuration", connectionString => {
    expect(() => createPostgresPool({ connectionString })).toThrow("PG_CONFIG");
  });
  it("rejects TLS bypass outside named loopback test databases", () => {
    expect(() => createPostgresPool({ connectionString: "postgresql://user@example.invalid/dream_test_db", localTestWithoutTls: true })).toThrow("PG_CONFIG");
    expect(() => createPostgresPool({ connectionString: "postgresql://user@127.0.0.1/production", localTestWithoutTls: true })).toThrow("PG_CONFIG");
  });
  it("pool creation is lazy and remote TLS verifies certificates", async () => {
    const pool = createPostgresPool({ connectionString: "postgresql://user:synthetic@example.invalid:5432/dream" });
    expect(pool.totalCount).toBe(0);
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
    await pool.end();
  });
  it("actor constructor refuses malformed identities", () => {
    expect(() => actorFromVerifiedUserId("request-owner")).toThrow("ACTOR_REQUIRED");
  });
  it("unsafe bigint DTO conversion fails instead of rounding", async () => {
    const row = { id: "x", menu_id: "x", template_version: "1", template_snapshot_json: "{}", inputs_json: "{}", title: "x", goal: "x", target: "x", aspect: "9:16", length_sec: "9007199254740992" };
    const tx = { actorId: actor.id, query: vi.fn(async () => ({ rows: [row] })) } as unknown as ActorTransaction;
    await expect(postgresProjectsRepository(tx).list()).rejects.toMatchObject({ code: "PG_DATA" });
  });
});
