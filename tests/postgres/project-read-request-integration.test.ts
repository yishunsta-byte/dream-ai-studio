import { readFile } from "node:fs/promises";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { createProjectReadRequest } from "@/lib/services/postgres/project-read-request";
import { createProjectReadPoolManager } from "@/lib/services/postgres/project-read-pool";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { stageOrder } from "@/lib/domain/stages";
import { A, B, PA, PB, syntheticPostgresFixture } from "./fixture";
vi.mock("server-only", () => ({}));

describe.skipIf(process.env.DREAM_PG_INTEGRATION !== "1")("B4-I fake verified resolver + actual pg driver", () => {
  let fixture: Awaited<ReturnType<typeof syntheticPostgresFixture>>;
  let manager: ReturnType<typeof createProjectReadPoolManager>;
  let connectionString: string;
  let env: Record<string, string>;
  beforeAll(async () => {
    fixture = await syntheticPostgresFixture();
    const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
    if (!parsed.ok) throw new Error("Synthetic menu invalid");
    const config = parsed.config, menu = config.menus[0];
    for (const [owner, id] of [[A, PA], [B, PB]]) {
      await withActorTransaction(fixture.pool, actorFromVerifiedUserId(owner), async tx => {
        await tx.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'{}','Synthetic adapter','test','test','9:16',4,now(),now())", [owner, id, menu.id, config.templateVersion, JSON.stringify(snapshotForMenu(config, menu))]);
        for (const [index, stage] of stageOrder.entries()) await tx.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)", [owner, id, stage, index === 0 ? "approved" : index === 1 ? "todo" : "locked"]);
      });
    }
    const target = new URL(process.env.DREAM_PG_TEST_ADMIN_URL!);
    target.username = "dream_test_api_login"; target.password = "b3-synthetic-api-only";
    connectionString = target.toString();
    env = { DREAM_PROJECT_READ_BACKEND: "postgres", DREAM_AUTH_MODE: "supabase", DATABASE_URL: connectionString };
    manager = createProjectReadPoolManager({ max: 1, localTestWithoutTls: true });
  });
  afterAll(async () => { await manager?.close(); await fixture?.close(); });
  function request(auth: ServerAuthResult) {
    const resolveAuth = vi.fn(async () => auth);
    const getPool = vi.fn((dsn: string) => manager.get(dsn));
    const environment = vi.fn(() => env);
    return { adapter: createProjectReadRequest({ resolveAuth, getPool, environment }), resolveAuth, getPool, environment };
  }
  const verified = (id: string) => ({ kind: "verified", userId: id, email: "synthetic@example.invalid" } as const);

  it("one request Auth decision serves concurrent real list/get without extra resolution", async () => {
    const current = request(verified(A));
    const params = vi.fn(async () => PA);
    const [list, detail] = await Promise.all([current.adapter.list(), current.adapter.get(params)]);
    expect(list.status).toBe(200); expect(detail.status).toBe(200);
    if (list.status !== 200 || detail.status !== 200) throw new Error("Expected real successful DTOs");
    expect(list.body.map(row => row.id)).toEqual([PA]); expect(detail.body.project.id).toBe(PA);
    expect(current.resolveAuth).toHaveBeenCalledOnce(); expect(current.getPool).toHaveBeenCalledOnce(); expect(current.environment).toHaveBeenCalledOnce();
    expect(params).toHaveBeenCalledOnce();
    expect(list.headers).toEqual({ "cache-control": "no-store" });
  });
  it("same size-one process pool serves a different verified actor without leaking prior actor", async () => {
    const pool = manager.get(connectionString);
    const before = await pool.connect();
    const pid = (await before.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; before.release();
    const current = request(verified(B));
    const list = await current.adapter.list();
    expect(list.status).toBe(200); if (list.status !== 200) throw new Error("Expected B list");
    expect(list.body.map(row => row.id)).toEqual([PB]);
    expect(await current.adapter.get(PA)).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    const after = await pool.connect();
    try {
      expect((await after.query("SELECT pg_backend_pid() AS pid,current_user AS role,nullif(current_setting('dream.actor_id',true),'') AS actor")).rows[0]).toEqual({ pid, role: "dream_test_api_login", actor: null });
    } finally { after.release(); }
    expect(current.resolveAuth).toHaveBeenCalledOnce();
  });
  it.each([
    { kind: "denied", status: 401, code: "AUTH_REQUIRED" },
    { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" },
    { kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" },
  ] as const)("$code never opens a pool client or anonymous query", async auth => {
    const connect = vi.spyOn(manager.get(connectionString), "connect");
    try {
      const current = request(auth);
      expect(await current.adapter.list()).toMatchObject({ status: auth.status, body: { code: auth.code } });
      expect(current.environment).not.toHaveBeenCalled(); expect(current.getPool).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
    } finally { connect.mockRestore(); }
  });
  it("local/config-off/missing backend and missing DSN cannot access real DB", async () => {
    const local = request({ kind: "local" });
    expect(await local.adapter.list()).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" } });
    expect(local.getPool).not.toHaveBeenCalled();
    for (const invalid of [
      { ...env, DREAM_PROJECT_READ_BACKEND: "sqlite" }, { ...env, DATABASE_URL: "" },
      { ...env, DREAM_AUTH_MODE: "off" }, { VERCEL: "1" },
    ]) {
      const getPool = vi.fn((dsn: string) => manager.get(dsn));
      const adapter = createProjectReadRequest({ resolveAuth: async () => verified(A), getPool, environment: () => invalid });
      expect((await adapter.list()).status).toBe(503); expect(getPool).not.toHaveBeenCalled();
    }
  });
  it("expired next request is independently denied after a successful request", async () => {
    expect((await request(verified(A)).adapter.get(PA)).status).toBe(200);
    const expired = request({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    expect((await expired.adapter.get(PA)).status).toBe(401); expect(expired.getPool).not.toHaveBeenCalled();
  });
  it("unknown SQL/data failure becomes a safe 503 response without driver or DSN details", async () => {
    await fixture.admin.query("UPDATE dream.projects SET template_snapshot_json='{}' WHERE id=$1", [PA]);
    const current = request(verified(A));
    const reply = await current.adapter.get(PA);
    expect(reply).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" } });
    expect(JSON.stringify(reply)).not.toContain(connectionString);
    expect(JSON.stringify(reply)).not.toContain("SELECT");
  });
});
