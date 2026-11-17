import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId, type VerifiedActor } from "@/lib/db/postgres/types";
import { postgresProjectCreate, isProjectCreateError } from "@/lib/services/postgres/project-create";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu, type menuSnapshotSchema } from "@/lib/menus/snapshot";
import type { z } from "zod";
vi.mock("server-only", () => ({}));
let snapshot: z.infer<typeof menuSnapshotSchema>;
const actor = actorFromVerifiedUserId("00000000-0000-4000-8000-000000000001");
beforeAll(async () => {
  const result = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
  if (!result.ok) throw new Error("Synthetic menu config invalid");
  snapshot = snapshotForMenu(result.config, result.config.menus.find(m => m.id === "shopping-shorts")!);
});
describe("B12 creation rejects invalid request before any connection", () => {
  it.each([null, "owner@email.invalid", { id: actor.id }])("requires branded verified actor (%j)", async value => {
    const pool = { connect: vi.fn() };
    await expect(postgresProjectCreate(pool, { assetAvailable: () => true }).create(value as VerifiedActor, "shopping-shorts", {}, snapshot)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each([{ title: "" }, { title: "ok", owner: actor.id }, { apiKey: "never-store" }, null])("validates inputs with existing rules (%j)", async input => {
    const pool = { connect: vi.fn() };
    try { await postgresProjectCreate(pool, { assetAvailable: () => true }).create(actor, "shopping-shorts", input, snapshot); throw new Error("Expected validation error"); }
    catch (e) { expect(isProjectCreateError(e)).toBe(true); expect(e).toMatchObject({ code: "INVALID_INPUT", status: 400 }); }
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("rejects menu mismatch/inactive menu and invalid server snapshot", async () => {
    const pool = { connect: vi.fn() }, service = postgresProjectCreate(pool, { assetAvailable: () => true });
    await expect(service.create(actor, "other", {}, snapshot)).rejects.toMatchObject({ code: "STAGE_LOCKED", status: 409 });
    await expect(service.create(actor, "shopping-shorts", {}, { ...snapshot, menu: { ...snapshot.menu, availability: "skeleton" } })).rejects.toMatchObject({ code: "STAGE_LOCKED" });
    await expect(service.create(actor, "shopping-shorts", {}, {})).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE", status: 503 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("does not accept caller-forged domain errors", () => {
    expect(isProjectCreateError(Object.assign(new Error("private driver detail"), { code: "INVALID_INPUT", status: 400 }))).toBe(false);
  });
});
