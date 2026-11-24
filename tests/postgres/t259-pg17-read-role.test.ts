import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "@/app/api/projects/route";
import { GET as detail } from "@/app/api/projects/[id]/route";
import manage from "@/app/(cloud)/cloud/manage/page";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { stageOrder } from "@/lib/domain/stages";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { createProjectReadPoolManager } from "@/lib/services/postgres/project-read-pool";
import type { Pool } from "pg";

const test = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  getPool: vi.fn<(dsn: string) => Pool>(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("redirect"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: test.redirect }));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: test.user }, error: null }) } }),
}));
vi.mock("@/lib/services/postgres/project-read-pool", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/services/postgres/project-read-pool")>(),
  getProcessProjectReadPool: (dsn: string) => test.getPool(dsn),
}));
// GET shares a module with legacy POST. No SQLite creation is in scope.
vi.mock("@/lib/services/projects", () => ({
  createProject: () => { throw new Error("Legacy POST is outside this test"); },
  ProjectInputError: class extends Error {},
}));

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const PA = "10000000-0000-4000-8000-000000000010";
const PB = "10000000-0000-4000-8000-000000000020";
const PB2 = "10000000-0000-4000-8000-000000000021";
const archived = "10000000-0000-4000-8000-000000000011";
const absent = "10000000-0000-4000-8000-000000000099";
const apiDsn = process.env.T259_API_DSN;

async function getProject(id: string) {
  return detail(new Request("http://127.0.0.1/api/projects/" + id), { params: Promise.resolve({ id }) });
}

describe.skipIf(!apiDsn)("T259 app reads on owned PG17 with actual restricted API login", () => {
  let manager: ReturnType<typeof createProjectReadPoolManager> | undefined;
  let pool: Pool;
  function actor(id: string, key: "a" | "b") {
    test.user = { id, email: key + "@example.invalid" };
  }

  beforeAll(async () => {
    const target = new URL(apiDsn!);
    if (target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" ||
      target.port !== process.env.T259_API_PORT || !target.port || target.pathname !== "/dream_test_t259" ||
      target.username !== "dream_api_login" || !/^[a-f0-9]{64}$/.test(target.password) || target.search || target.hash) {
      throw new Error("Owned PG17 API target required");
    }
    vi.stubEnv("DREAM_AUTH_MODE", "supabase");
    vi.stubEnv("DREAM_PROJECT_READ_BACKEND", "postgres");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-only-auth-double");
    vi.stubEnv("DREAM_ALLOWED_EMAILS", "a@example.invalid,b@example.invalid");
    vi.stubEnv("DATABASE_URL", apiDsn);
    manager = createProjectReadPoolManager({ max: 1, localTestWithoutTls: true });
    pool = manager.get(apiDsn!);
    test.getPool.mockImplementation(dsn => {
      if (dsn !== apiDsn) throw new Error("Unexpected read DSN");
      return pool;
    });

    const { rows: [identity] } = await pool.query(`
      SELECT session_user AS login, current_user AS active, current_database() AS db,
        current_setting('server_version_num')::int AS version, host(inet_server_addr()) AS address,
        inet_server_port() AS port, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolinherit,
        has_database_privilege(current_database(),'CREATE') AS can_create,
        pg_has_role('dream_worker','SET') AS worker_set
      FROM pg_roles r WHERE rolname=session_user`);
    expect(identity).toEqual({
      login: "dream_api_login", active: "dream_api_login", db: "dream_test_t259", version: 170012,
      address: "127.0.0.1", port: Number(target.port), rolsuper: false, rolbypassrls: false,
      rolcreaterole: false, rolinherit: false, can_create: false, worker_set: false,
    });

    const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
    if (!parsed.ok) throw new Error("Fixture menu is invalid");
    const config = parsed.config;
    const menu = config.menus[0];
    const snapshot = JSON.stringify(snapshotForMenu(config, menu));
    const projects = [[A, PA, "A visible", false], [A, archived, "A archived", true],
      [B, PB, "B visible", false], [B, PB2, "B extra", false]] as const;
    for (const [owner, id, title, isArchived] of projects) {
      await withActorTransaction(pool, actorFromVerifiedUserId(owner), async tx => {
        await tx.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,
            inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at,archived_at)
          VALUES($1,$2,$3,$4,$5,'{}',$6,'local','local','9:16',4,now(),now(),CASE WHEN $7 THEN now() END)`,
        [owner, id, menu.id, config.templateVersion, snapshot, title, isArchived]);
        for (const [index, stage] of stageOrder.entries()) {
          await tx.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)",
            [owner, id, stage, index === 0 ? "approved" : index === 1 ? "todo" : "locked"]);
        }
      });
    }
  }, 15000);

  beforeEach(() => {
    test.user = null;
    test.getPool.mockClear();
    test.redirect.mockClear();
  });
  afterAll(async () => {
    await manager?.close();
    vi.unstubAllEnvs();
  });

  it("enforces RLS without owner predicates and uses the same clean backend for A and B", async () => {
    const identify = "SELECT pg_backend_pid() AS pid,current_user AS role,nullif(current_setting('dream.actor_id',true),'') AS actor";
    await expect(pool.query("SELECT id FROM dream.projects")).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("SET ROLE dream_worker")).rejects.toMatchObject({ code: "42501" });
    // Pool.query discards its client on an SQL error. Start the reuse check
    // after the expected denials have released those connections.
    const { rows: [before] } = await pool.query(identify);
    expect(before).toMatchObject({ role: "dream_api_login", actor: null });
    const raw = await pool.connect();
    try {
      await raw.query("BEGIN READ ONLY");
      try {
        await raw.query("SET LOCAL ROLE dream_api");
        expect((await raw.query("SELECT id FROM dream.projects")).rowCount).toBe(0);
      } finally {
        expect((await raw.query("ROLLBACK")).command).toBe("ROLLBACK");
      }
    } finally { raw.release(); }
    for (const [owner, ids] of [[A, [PA, archived]], [B, [PB, PB2]]] as const) {
      await withActorTransaction(pool, actorFromVerifiedUserId(owner), async tx => {
        expect((await tx.query(identify)).rows[0]).toEqual({ pid: before.pid, role: "dream_api", actor: owner });
        expect((await tx.query("SELECT id FROM dream.projects ORDER BY id")).rows.map(row => row.id)).toEqual(ids);
      }, { mode: "read-only-repeatable-read" });
      expect((await pool.query(identify)).rows[0]).toEqual(before);
    }
  });

  it.each([
    { user: A, key: "a", visible: [PA], foreign: PB, count: 1 },
    { user: B, key: "b", visible: [PB, PB2], foreign: PA, count: 2 },
  ] as const)("$key receives only self-owned GET data and management counts", async ({ user, key, visible, foreign, count }) => {
    actor(user, key);
    const response = await list(new Request("http://127.0.0.1/api/projects"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const rows = (await response.json()) as { id: string }[];
    expect(rows.map(row => row.id).sort()).toEqual(visible);
    const own = await getProject(visible[0]);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      project: { id: visible[0] },
      states: expect.arrayContaining([expect.objectContaining({ stage: "intake", status: "approved" })]),
    });
    const missing = await getProject(absent);
    const missingBody = await missing.json();
    expect(missing.status).toBe(404);
    expect(missingBody).toMatchObject({ code: "NOT_FOUND" });
    for (const id of [foreign, archived]) {
      const denied = await getProject(id);
      expect(denied.status).toBe(404);
      expect(denied.headers.get("cache-control")).toBe("no-store");
      expect(await denied.json()).toEqual(missingBody);
    }
    const markup = renderToStaticMarkup(await manage());
    expect(markup).toMatch(new RegExp("<strong[^>]*>" + count + "개</strong>"));
    expect(markup).toContain("목록 조회 시각");
    expect(markup).not.toContain(foreign);
  });

  it("returns 401 for anonymous GET and redirects management before reading the pool", async () => {
    const response = await list(new Request("http://127.0.0.1/api/projects"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    const params = { get params(): Promise<{ id: string }> { throw new Error("Anonymous params accessed"); } };
    const own = await detail(new Request("http://127.0.0.1/api/projects/" + PA), params);
    expect(own.status).toBe(401);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(await own.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(manage()).rejects.toMatchObject({ to: "/login?next=%2Fcloud%2Fmanage" });
    expect(test.getPool).not.toHaveBeenCalled();
  });
});
