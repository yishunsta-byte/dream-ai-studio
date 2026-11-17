import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { authDeniedResponse } from "@/lib/auth/api";
import { createProjectReadRequest } from "@/lib/services/postgres/project-read-request";
import { createProjectReadPoolManager } from "@/lib/services/postgres/project-read-pool";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ getUser: vi.fn(), user: null as null | { id: string; email: string } }));
vi.mock("@/lib/auth/server", () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => {
  state.getUser(); return { data: { user: state.user }, error: null };
} } }) }));
const A = "00000000-0000-4000-8000-000000000001";
const dsn = "postgresql://synthetic:dummy@example.invalid:5432/dream";
const env = { DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: dsn, DREAM_AUTH_MODE: "supabase" };
const verified = { kind: "verified", userId: A, email: "owner@example.invalid" } as const;
const keys = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"];
let saved: (string | undefined)[];
beforeEach(() => {
  saved = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]);
  Object.assign(process.env, { DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public", DREAM_ALLOWED_EMAILS: "owner@example.invalid" });
  state.user = { id: A, email: "owner@example.invalid" }; vi.clearAllMocks();
});
afterEach(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));

describe("B4-I request Auth and fail-closed boundaries", () => {
  it.each([
    { kind: "denied", status: 401, code: "AUTH_REQUIRED" },
    { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" },
    { kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" },
  ] as const)("$code exactly matches the Auth DTO before settings/pool access", async auth => {
    const environment = vi.fn(() => { throw new Error("must not read settings"); });
    const getPool = vi.fn(); const resolveAuth = vi.fn(async () => auth);
    const request = createProjectReadRequest({ resolveAuth, environment, getPool });
    const [reply, again] = await Promise.all([request.list(), request.get("unread-id")]);
    const original = authDeniedResponse(auth);
    expect(reply).toEqual({ status: original.status, body: await original.json(), headers: { "cache-control": "no-store" } });
    expect(again).toEqual(reply); expect(Object.isFrozen(reply.body)).toBe(true);
    expect(resolveAuth).toHaveBeenCalledOnce(); expect(environment).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "local" },
    { kind: "verified", userId: "not-verified-uuid", email: "owner@example.invalid" },
    { kind: "verified", userId: A, email: "" },
  ] as const)("local/malformed identity cannot produce an actor: $kind", async auth => {
    const environment = vi.fn(() => env), getPool = vi.fn();
    const reply = await createProjectReadRequest({ resolveAuth: async () => auth, environment, getPool }).list();
    expect(reply).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" } });
    expect(environment).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
  });
  it("a resolver throw is fixed AUTH_UNAVAILABLE, without driver/DSN details", async () => {
    const getPool = vi.fn();
    const reply = await createProjectReadRequest({ resolveAuth: async () => { throw new Error(dsn); }, getPool }).list();
    expect(reply).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" } });
    expect(JSON.stringify(reply)).not.toContain(dsn); expect(getPool).not.toHaveBeenCalled();
  });
  it("a denied request does not evaluate a lazy route params reader", async () => {
    const params = vi.fn(async () => { throw new Error("must not read params"); });
    const request = createProjectReadRequest({ resolveAuth: async () => ({ kind: "denied", status: 401, code: "AUTH_REQUIRED" }) });
    expect(await request.get(params)).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" } });
    expect(params).not.toHaveBeenCalled();
  });
  it.each([
    {}, { DREAM_PROJECT_READ_BACKEND: "sqlite" }, { DREAM_PROJECT_READ_BACKEND: "bad" },
    { DREAM_PROJECT_READ_BACKEND: "postgres" },
    { DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: "invalid", DREAM_AUTH_MODE: "supabase" },
    { DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: dsn, DREAM_AUTH_MODE: "off" },
    { VERCEL: "1" },
  ])("missing/SQLite/invalid/off configuration never falls back to a data source", async selection => {
    const getPool = vi.fn();
    const reply = await createProjectReadRequest({ resolveAuth: async () => verified, environment: () => selection, getPool }).list();
    expect(reply.status).toBe(503); expect(getPool).not.toHaveBeenCalled();
    expect(JSON.stringify(reply)).not.toContain(dsn);
  });
  it("the real T191 resolver calls getUser once for concurrent operations on one request", async () => {
    const connect = vi.fn(async () => { throw new Error("private driver contents"); });
    const getPool = vi.fn(() => ({ connect }) as unknown as Pick<Pool, "connect">);
    const request = createProjectReadRequest({ environment: () => env, getPool });
    const replies = await Promise.all([request.list(), request.get(A)]);
    expect(replies.every(reply => reply.status === 503)).toBe(true);
    expect(state.getUser).toHaveBeenCalledOnce(); expect(getPool).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledTimes(2);
    state.user = null;
    const expired = await createProjectReadRequest({ environment: () => env, getPool }).list();
    expect(expired).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" } });
    expect(state.getUser).toHaveBeenCalledTimes(2); expect(getPool).toHaveBeenCalledOnce();
  });
  it("an unknown pool failure is fixed 503, not a leaked internal 500", async () => {
    const reply = await createProjectReadRequest({ resolveAuth: async () => verified, environment: () => env,
      getPool: () => { throw Object.assign(new Error(dsn), { status: 500 }); } }).list();
    expect(reply).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" } });
    expect(JSON.stringify(reply)).not.toContain(dsn);
  });
  it("an invalid denied status/code pairing cannot become success", async () => {
    const reply = await createProjectReadRequest({ resolveAuth: async () => ({ kind: "denied", status: 200, code: "AUTH_REQUIRED" }) as unknown as ServerAuthResult }).list();
    expect(reply).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" } });
  });
});

describe("B4-I explicit server pool lifetime", () => {
  it("creates a lazy TLS pool once and rejects silent target rotation", async () => {
    const manager = createProjectReadPoolManager();
    const pool = manager.get(dsn);
    expect(pool.totalCount).toBe(0); expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
    expect(manager.get(dsn)).toBe(pool);
    expect(() => manager.get(dsn.replace("/dream", "/other"))).toThrow("PG_CONFIG");
    const first = manager.close(); expect(manager.close()).toBe(first); await first;
    expect(() => manager.get(dsn)).toThrow("PG_UNAVAILABLE");
  });
  it("close before first use is terminal without creating a pool", async () => {
    const manager = createProjectReadPoolManager(); await manager.close();
    expect(() => manager.get(dsn)).toThrow("PG_UNAVAILABLE");
  });
  it("the process pool survives a server module reload without user/request cache", async () => {
    const first = await import("@/lib/services/postgres/project-read-pool");
    const pool = first.getProcessProjectReadPool(dsn);
    expect(pool.totalCount).toBe(0);
    vi.resetModules();
    const reloaded = await import("@/lib/services/postgres/project-read-pool");
    expect(reloaded.getProcessProjectReadPool(dsn)).toBe(pool);
    await reloaded.closeProcessProjectReadPool();
    expect(() => first.getProcessProjectReadPool(dsn)).toThrow("PG_UNAVAILABLE");
  });
});
