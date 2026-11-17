import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { selectProjectReadBackend } from "@/lib/services/postgres/project-read-backend";
import { isProjectReadError, projectReadError, projectReadFailure } from "@/lib/services/postgres/project-read-errors";
import { postgresProjectReads } from "@/lib/services/postgres/project-reads";
import { actorFromVerifiedUserId, type VerifiedActor } from "@/lib/db/postgres/types";
vi.mock("server-only", () => ({}));
const dsn = "postgresql://synthetic:dummy@example.invalid:5432/dream";
const actor = actorFromVerifiedUserId("00000000-0000-4000-8000-000000000001");

describe("B4-S pure backend selection", () => {
  it.each(["off", "supabase"] as const)("local default/sqlite preserve local mode with Auth %s", mode => {
    expect(selectProjectReadBackend({}, mode)).toEqual({ backend: "sqlite" });
    expect(selectProjectReadBackend({ DREAM_PROJECT_READ_BACKEND: "sqlite", DATABASE_URL: "must-not-read-as-fallback" }, mode)).toEqual({ backend: "sqlite" });
  });
  it.each([undefined, "sqlite", "unknown", "", "POSTGRES"])("Vercel does not select SQLite or an invalid backend: %s", backend => {
    expect(() => selectProjectReadBackend({ VERCEL: "1", DREAM_PROJECT_READ_BACKEND: backend }, "supabase")).toThrow(projectReadError("PROJECT_READ_UNAVAILABLE"));
  });
  it.each([undefined, "", "not-a-dsn", "postgresql://user@host/db", `${dsn}?sslmode=no-verify`])("postgres refuses absent/invalid DSN: %s", DATABASE_URL => {
    expect(() => selectProjectReadBackend({ DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL }, "supabase")).toThrow(projectReadError("PROJECT_READ_UNAVAILABLE"));
  });
  it("postgres with Auth off fails without inventing a local actor", () => {
    expect(() => selectProjectReadBackend({ DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: dsn }, "off")).toThrow(projectReadError("AUTH_UNAVAILABLE"));
  });
  it.each([undefined, "1"])("explicit postgres only returns configuration (Vercel=%s)", VERCEL => {
    expect(selectProjectReadBackend({ VERCEL, DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: dsn }, "supabase")).toEqual({ backend: "postgres", connectionString: dsn });
  });
});
describe("B4-S safe errors and unwired service boundaries", () => {
  it("only issued immutable domain errors retain public status/code", () => {
    const missing = projectReadError("NOT_FOUND");
    expect(Object.isFrozen(missing)).toBe(true);
    expect(isProjectReadError(missing)).toBe(true);
    expect(projectReadFailure(missing)).toEqual({ status: 404, body: { code: "NOT_FOUND", error: "프로젝트를 찾을 수 없어요." }, headers: { "cache-control": "no-store" } });
    expect(isProjectReadError(Object.assign(Object.create(Object.getPrototypeOf(missing)), { code: "NOT_FOUND", message: dsn, status: 200 }))).toBe(false);
  });
  it.each([new Error(dsn), { code: "NOT_FOUND", status: 500, message: dsn }, null])("unknown errors become a fixed 503 without internal text", error => {
    const result = projectReadFailure(error);
    expect(result.status).toBe(503);
    expect(result.body.code).toBe("PROJECT_READ_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain(dsn);
  });
  it("no actor rejects before any connection and does not accept a bare UUID", async () => {
    const pool = { connect: vi.fn() } as unknown as Pick<Pool, "connect">;
    const service = postgresProjectReads(pool);
    await expect(service.list({ id: actor.id } as VerifiedActor)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    await expect(service.get(undefined as unknown as VerifiedActor, "invalid")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("invalid project ID rejects before connection", async () => {
    const pool = { connect: vi.fn() } as unknown as Pick<Pool, "connect">;
    await expect(postgresProjectReads(pool).get(actor, "' OR true--")).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("driver acquisition error cannot trigger SQLite or expose internal 500 details", async () => {
    const pool = { connect: vi.fn(async () => { throw Object.assign(new Error(dsn), { status: 500 }); }) } as unknown as Pick<Pool, "connect">;
    try { await postgresProjectReads(pool).list(actor); throw new Error("expected failure"); }
    catch (error) {
      const failure = projectReadFailure(error);
      expect(failure.status).toBe(503); expect(failure.body.code).toBe("PROJECT_READ_UNAVAILABLE");
      expect(JSON.stringify(failure)).not.toContain(dsn);
    }
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
});
