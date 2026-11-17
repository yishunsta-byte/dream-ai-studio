import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { A, B, syntheticPostgresFixture } from "./fixture";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { postgresProjectCreate } from "@/lib/services/postgres/project-create";
import { postgresProjectReads } from "@/lib/services/postgres/project-reads";
import { postgresProjectCreateRepository } from "@/lib/repo/postgres/project-create";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu, menuSnapshotSchema } from "@/lib/menus/snapshot";
import { encodeJson, jsonObject } from "@/lib/db/json";
import { validateProjectInputs } from "@/lib/menus/inputs";
import type { z } from "zod";
vi.mock("server-only", () => ({}));
const actorA = actorFromVerifiedUserId(A), actorB = actorFromVerifiedUserId(B);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
describe.skipIf(process.env.DREAM_PG_INTEGRATION !== "1")("B12 actual PostgreSQL project creation", () => {
  let fixture: Awaited<ReturnType<typeof syntheticPostgresFixture>>, snapshot: z.infer<typeof menuSnapshotSchema>;
  const imageA = v7(), imageB = v7(), missing = v7(), archived = v7(), audio = v7(), link = v7(), charA = v7(), charB = v7();
  const available = new Set([imageA, imageB, audio]);
  const storage = vi.fn((asset: { id: string }) => available.has(asset.id));
  const values = (asset = imageA) => ({ title: "  Synthetic project  ", goal: "Product introduction", target: "Synthetic audience", aspect: "9:16", lengthSec: "30", productName: "Synthetic product", productAssets: [asset], facts: "Verified synthetic fact", usageRights: "직접 촬영" });
  beforeAll(async () => {
    fixture = await syntheticPostgresFixture();
    const config = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
    if (!config.ok) throw new Error("Synthetic menu config invalid");
    snapshot = snapshotForMenu(config.config, config.config.menus.find(m => m.id === "shopping-shorts")!);
    for (const [owner, id, kind, isArchived] of [[A, imageA, "image", false], [B, imageB, "image", false], [A, missing, "image", false], [A, archived, "image", true], [A, audio, "audio", false], [A, link, "link", false]] as const) {
      await fixture.admin.query(`INSERT INTO dream.assets(owner_id,id,kind,title,role,origin,file_path,mime,size_bytes,sha256,source_url,archived_at,created_at)
        VALUES($1,$2,$3,'Synthetic asset','original',$4,$5,$6,$7,$8,$9,$10,now())`, [owner, id, kind, kind === "link" ? "link" : "upload", kind === "link" ? null : `${owner}/library/${id}`, kind === "link" ? null : "synthetic/fixture", kind === "link" ? null : 12, kind === "link" ? null : "a".repeat(64), kind === "link" ? "https://example.invalid/synthetic" : null, isArchived ? new Date() : null]);
    }
    for (const [owner, id] of [[A, charA], [B, charB]]) await fixture.admin.query("INSERT INTO dream.characters(owner_id,id,name,description,locked_json,ref_asset_ids_json,voice_profile_json,status,created_at) VALUES($1,$2,'Synthetic character','Synthetic','{}','[]','{}','unconfirmed',now())", [owner, id]);
  });
  afterAll(async () => { await fixture?.close(); });
  const service = () => postgresProjectCreate(fixture.pool, { assetAvailable: storage });
  const counts = async () => (await fixture.admin.query("SELECT (SELECT count(*)::int FROM dream.projects) AS projects,(SELECT count(*)::int FROM dream.stage_states) AS stages,(SELECT count(*)::int FROM dream.project_assets) AS assets,(SELECT count(*)::int FROM dream.project_characters) AS characters,(SELECT count(*)::int FROM dream.activity_log) AS logs")).rows[0];

  it("creates atomic project/stages/asset/audit and retains B4 list/get DTO and raw hashes", async () => {
    const input = values(), checked = validateProjectInputs(snapshot, input); if (!checked.ok) throw new Error("Synthetic input invalid");
    const expectedSnapshot = encodeJson(menuSnapshotSchema, snapshot), expectedInputs = encodeJson(jsonObject, checked.values);
    const id = await service().create(actorA, snapshot.menu.id, input, snapshot);
    expect(id).toMatch(/^[a-f0-9-]{14}7/);
    const reads = postgresProjectReads(fixture.pool), detail = await reads.get(actorA, id);
    expect(detail.project).toMatchObject({ id, title: "Synthetic project", contentRevision: 1, approvedPlanId: null, currentTimelineRevId: null, archivedAt: null, lengthSec: 30 });
    expect(detail.project.templateSnapshotJson).toBe(expectedSnapshot); expect(detail.project.inputsJson).toBe(expectedInputs);
    expect(digest(detail.project.templateSnapshotJson)).toBe(digest(expectedSnapshot)); expect(digest(detail.project.inputsJson)).toBe(digest(expectedInputs));
    expect(detail.states).toHaveLength(7); expect(detail.states.find(s => s.stage === "intake")).toMatchObject({ status: "approved", approvedAt: detail.project.createdAt });
    expect(detail.states.find(s => s.stage === "brief")?.status).toBe("todo"); expect(detail.states.filter(s => s.status === "locked")).toHaveLength(5);
    expect((await reads.list(actorA)).find(p => p.id === id)).toMatchObject({ title: "Synthetic project", status: "queued", nextStage: "brief", menuLabel: snapshot.menu.label });
    expect((await fixture.admin.query("SELECT owner_id,actor,action,detail_json FROM dream.activity_log WHERE project_id=$1", [id])).rows).toEqual([{ owner_id: A, actor: "local-user", action: "project.create", detail_json: JSON.stringify({ menuId: snapshot.menu.id, templateVersion: snapshot.templateVersion, contentRevision: 1 }) }]);
    expect((await fixture.admin.query("SELECT owner_id,asset_id,purpose FROM dream.project_assets WHERE project_id=$1", [id])).rows).toEqual([{ owner_id: A, asset_id: imageA, purpose: "productAssets" }]);
  });
  it("A/B creation remains isolated and foreign IDs match missing errors", async () => {
    const id = await service().create(actorB, snapshot.menu.id, values(imageB), snapshot);
    await expect(postgresProjectReads(fixture.pool).get(actorA, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await postgresProjectReads(fixture.pool).list(actorB)).map(p => p.id)).toEqual([id]);
    const before = await counts();storage.mockClear();
    for (const asset of [imageB, v7(), archived, missing, audio, link]) {
      await expect(service().create(actorA, snapshot.menu.id, values(asset), snapshot)).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400, errors: { productAssets: expect.any(String) } });
      expect(await counts()).toEqual(before);
    }
    expect(storage.mock.calls.map(([asset]) => asset.id)).not.toContain(imageB);
  });
  it("handles character links and per-purpose asset links like the legacy contract", async () => {
    const custom = structuredClone(snapshot);
    custom.menu.inputs.push({ id: "syntheticCharacters", label: "Characters", type: "characters", required: false }, { id: "syntheticCharactersAgain", label: "Characters again", type: "characters", required: false }, { id: "syntheticReferences", label: "References", type: "assets", required: false });
    const id = await service().create(actorA, custom.menu.id, { ...values(), syntheticCharacters: [charA], syntheticCharactersAgain: [charA], syntheticReferences: [imageA, link] }, custom);
    expect((await fixture.admin.query("SELECT count(*)::int AS n FROM dream.project_characters WHERE project_id=$1", [id])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("SELECT count(*)::int AS n FROM dream.project_assets WHERE project_id=$1", [id])).rows[0].n).toBe(3);
    const before = await counts();
    await expect(service().create(actorA, custom.menu.id, { ...values(), syntheticCharacters: [charB] }, custom)).rejects.toMatchObject({ code: "INVALID_INPUT", errors: { syntheticCharacters: expect.any(String) } });
    expect(await counts()).toEqual(before);
    await fixture.admin.query("UPDATE dream.characters SET archived_at=now() WHERE id=$1", [charA]);
    try { await expect(service().create(actorA, custom.menu.id, { ...values(), syntheticCharacters: [charA] }, custom)).rejects.toMatchObject({ code: "INVALID_INPUT" }); }
    finally { await fixture.admin.query("UPDATE dream.characters SET archived_at=NULL WHERE id=$1", [charA]); }
    expect(await counts()).toEqual(before);
  });
  it("field validation/unknown owner fields create no database rows", async () => {
    const before = await counts();
    for (const bad of [{ ...values(), title: " " }, { ...values(), ownerId: B }, { ...values(), productAssets: [imageA, imageA] }, { ...values(), lengthSec: 1e10 }]) {
      await expect(service().create(actorA, snapshot.menu.id, bad, snapshot)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(await counts()).toEqual(before);
    }
  });
  it.each(["stage_states", "project_assets", "project_characters", "activity_log"])("a middle %s insert failure rolls back every dependent row", async table => {
    const custom = structuredClone(snapshot);custom.menu.inputs.push({ id: "syntheticCharacters", label: "Characters", type: "characters", required: false });
    const before = await counts();
    await fixture.admin.query(`CREATE FUNCTION public.b12_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private synthetic failure'; END $$; CREATE TRIGGER b12_fail BEFORE INSERT ON dream.${table} FOR EACH ROW EXECUTE FUNCTION public.b12_fail()`);
    try {
      await expect(service().create(actorA, custom.menu.id, { ...values(), syntheticCharacters: [charA] }, custom)).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE", message: "PROJECT_CREATE_UNAVAILABLE", status: 503 });
      expect(await counts()).toEqual(before);
    } finally { await fixture.admin.query(`DROP TRIGGER b12_fail ON dream.${table}; DROP FUNCTION public.b12_fail()`); }
  });
  it("snapshot/inputs cannot be mutated by the caller while storage availability awaits", async () => {
    const custom = structuredClone(snapshot), input = values();const rawSnapshot = encodeJson(menuSnapshotSchema, custom);
    const delayed = postgresProjectCreate(fixture.pool, { assetAvailable: async () => { custom.menu.label = "mutated";custom.templateVersion = "mutated";input.title = "mutated";input.productAssets.length = 0;return true; } });
    const id = await delayed.create(actorA, snapshot.menu.id, input, custom), detail = await postgresProjectReads(fixture.pool).get(actorA, id);
    expect(detail.project.title).toBe("Synthetic project"); expect(detail.project.templateSnapshotJson).toBe(rawSnapshot); expect(detail.inputs.productAssets).toEqual([imageA]);
  });
  it("storage policy failures are sanitized and leave no writes", async () => {
    const before = await counts();
    await expect(postgresProjectCreate(fixture.pool, { assetAvailable: () => { throw new Error("private storage key or DSN"); } }).create(actorA, snapshot.menu.id, values(), snapshot)).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE", message: "PROJECT_CREATE_UNAVAILABLE" });
    expect(await counts()).toEqual(before);
  });
  it("repository cannot select or insert another owner's references under actor A", async () => {
    await withActorTransaction(fixture.pool, actorA, async tx => {
      const repo = postgresProjectCreateRepository(tx);expect(await repo.asset(imageB)).toBeUndefined();expect(await repo.character(charB)).toBe(false);
    });
    const before = await counts();const id = v7();
    await expect(withActorTransaction(fixture.pool, actorA, async tx => {
      await tx.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,'x','x','{}','{}','x','x','x','9:16',30,now(),now())", [B, id]);
    })).rejects.toMatchObject({ code: "PG_TRANSACTION" });
    expect(await counts()).toEqual(before);
  });
});
