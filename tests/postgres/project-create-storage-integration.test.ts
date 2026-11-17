import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import sharp from "sharp";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { A, B, syntheticPostgresFixture } from "./fixture";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { postgresProjectCreateRepository } from "@/lib/repo/postgres/project-create";
import { postgresProjectCreateWithStorage } from "@/lib/services/postgres/project-create-storage";
import { postgresProjectReads } from "@/lib/services/postgres/project-reads";
import { createPrivateObjectReader, type PrivateObjectReader } from "@/lib/storage/supabase/reader";
import { privateObjectKey } from "@/lib/storage/supabase/object-key";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu, menuSnapshotSchema } from "@/lib/menus/snapshot";
import { validateProjectInputs } from "@/lib/menus/inputs";
import { encodeJson, jsonObject } from "@/lib/db/json";
import type { z } from "zod";
vi.mock("server-only", () => ({}));
const actorA = actorFromVerifiedUserId(A), actorB = actorFromVerifiedUserId(B), good = v7(), foreign = v7(), badMime = v7(), badKey = v7(), badSize = v7(), badHash = v7(), badType = v7(), link = v7();
const digest = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
describe.skipIf(process.env.DREAM_PG_INTEGRATION !== "1")("B15 actual PG + installed SDK HTTP Storage adapter", () => {
  let fixture: Awaited<ReturnType<typeof syntheticPostgresFixture>>, snapshot: z.infer<typeof menuSnapshotSchema>, png: Buffer, root: string, reader: PrivateObjectReader;
  let mode = "ok", started: (() => void) | undefined, requests = 0;const downloads: string[] = [];
  const server = createServer((req, res) => {
    requests++;
    if (req.url === "/storage/v1/bucket/b15-private") { res.writeHead(200, { "content-type": "application/json" });res.end(JSON.stringify({ id: "b15-private", public: false }));return; }
    if (!req.url?.startsWith("/storage/v1/object/b15-private/")) { res.writeHead(404);res.end();return; }
    downloads.push(req.url);started?.();
    if (["404", "401"].includes(mode)) { res.writeHead(Number(mode));res.end("private Storage key/message must not escape");return; }
    if (mode === "wait") { res.writeHead(200);res.write(png.subarray(0, 1));const timer = setTimeout(() => res.end(png.subarray(1)), 1000);res.once("close", () => clearTimeout(timer));return; }
    res.writeHead(200, { "content-type": "application/octet-stream" });res.end(png);
  });
  const inputs = (assetId = good) => ({ title: " B15 synthetic ", goal: "Synthetic", target: "Synthetic", aspect: "9:16", lengthSec: 30, productName: "Synthetic", productAssets: [assetId], facts: "Synthetic", usageRights: "직접 촬영" });
  const create = (pool: Pick<Pool, "connect"> = fixture.pool, timeout = 3000) => postgresProjectCreateWithStorage(pool, reader, { ioTimeoutMs: timeout });
  const counts = async () => (await fixture.admin.query("SELECT (SELECT count(*)::int FROM dream.projects) AS projects,(SELECT count(*)::int FROM dream.stage_states) AS stages,(SELECT count(*)::int FROM dream.project_assets) AS links,(SELECT count(*)::int FROM dream.activity_log) AS audit")).rows[0];
  const scratchClean = async () => expect(await readdir(join(root, "work"))).toEqual([]);
  beforeAll(async () => {
    fixture = await syntheticPostgresFixture();root = await mkdtemp(join(await realpath(resolve("tmp")), "b15-storage-"));await mkdir(join(root, "work"));
    png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));if (!parsed.ok) throw new Error("Synthetic config invalid");snapshot = snapshotForMenu(parsed.config, parsed.config.menus[0]);
    for (const [ownerId, id] of [[A, good], [B, foreign], [A, badMime], [A, badKey], [A, badSize], [A, badHash], [A, badType]] as const) {
      const sha256 = id === badHash ? "b".repeat(64) : digest(png), mime = id === badType ? "image/jpeg" : "image/png";
      const objectKey = privateObjectKey({ ownerId, id, sha256, mime });
      await fixture.admin.query("INSERT INTO dream.assets(owner_id,id,kind,title,role,origin,file_path,mime,size_bytes,sha256,created_at) VALUES($1,$2,'image','Synthetic','original','upload',$3,$4,$5,$6,now())", [ownerId, id, id === badKey ? `${ownerId}/noncanonical/${id}` : objectKey, id === badMime ? "image/not-real" : mime, png.length + (id === badSize ? 1 : 0), sha256]);
    }
    await fixture.admin.query("INSERT INTO dream.assets(owner_id,id,kind,title,role,origin,source_url,created_at) VALUES($1,$2,'link','Synthetic','original','link','https://example.invalid',now())", [A, link]);
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));const address = server.address();if (!address || typeof address === "string") throw new Error("Loopback required");
    reader = createPrivateObjectReader({ profile: "synthetic", projectUrl: `http://127.0.0.1:${address.port}`, projectRef: "abcdefghijklmnopqrst", bucket: "b15-private", privateBucket: true, credential: { mode: "service-role", key: "b15-unit-only-credential" }, maxBytes: 1024 * 1024, timeoutMs: 5000, maxConcurrent: 2, workRoot: join(root, "work"), ffprobePath: resolve(".tools/ffmpeg/ffprobe.exe") });
  });
  beforeEach(() => { mode = "ok";downloads.length = 0;started = undefined;requests = 0; });
  afterAll(async () => {
    server.closeAllConnections();await new Promise<void>(done => server.close(() => done()));await fixture?.close();
    const actual = await realpath(root);if (dirname(actual) !== await realpath(resolve("tmp"))) throw new Error("Owned boundary failed");await rm(actual, { recursive: true });
  });
  it("uses actual owner_id and MIME from the owner-filtered row, then creates B4-compatible content", async () => {
    await withActorTransaction(fixture.pool, actorA, async tx => { expect(await postgresProjectCreateRepository(tx).asset(good)).toMatchObject({ ownerId: A, mime: "image/png", id: good }); });
    const values = inputs(), valid = validateProjectInputs(snapshot, values);if (!valid.ok) throw new Error("Input invalid");
    const id = await create().create(actorA, snapshot.menu.id, values, snapshot), detail = await postgresProjectReads(fixture.pool).get(actorA, id);
    expect(downloads).toHaveLength(1);expect(detail.project.title).toBe("B15 synthetic");expect(detail.states).toHaveLength(7);
    expect((await postgresProjectReads(fixture.pool).list(actorA)).find(p => p.id === id)).toMatchObject({ nextStage: "brief", status: "queued" });
    expect(digest(detail.project.templateSnapshotJson)).toBe(digest(encodeJson(menuSnapshotSchema, snapshot)));expect(digest(detail.project.inputsJson)).toBe(digest(encodeJson(jsonObject, valid.values)));
    expect((await fixture.admin.query("SELECT count(*)::int AS n FROM dream.project_assets WHERE project_id=$1 AND owner_id=$2", [id, A])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("SELECT actor,action,detail_json FROM dream.activity_log WHERE project_id=$1", [id])).rows[0]).toEqual({ actor: "local-user", action: "project.create", detail_json: JSON.stringify({ menuId: snapshot.menu.id, templateVersion: snapshot.templateVersion, contentRevision: 1 }) });await scratchClean();
  });
  it("foreign/missing/corrupt MIME/noncanonical key refuse before object network", async () => {
    const before = await counts();
    for (const id of [foreign, v7(), badMime, badKey]) await expect(create().create(actorA, snapshot.menu.id, inputs(id), snapshot)).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(downloads).toEqual([]);expect(requests).toBe(0);expect(await counts()).toEqual(before);
    const id = await create().create(actorB, snapshot.menu.id, inputs(foreign), snapshot);await expect(postgresProjectReads(fixture.pool).get(actorA, id)).rejects.toMatchObject({ code: "NOT_FOUND" });await scratchClean();
  });
  it.each(["null-mime", "missing-mime", "missing-owner", "wrong-owner"])("driver-row corruption fails closed (%s); impossible DB null/owner violations are not synthesized as valid rows", async fault => {
    const before = await counts();
    const pool = { async connect() { const client = await fixture.pool.connect();return new Proxy(client, { get(target, prop) {
      if (prop === "query") return async (sql: string, values?: unknown[]) => { const result = await target.query(sql, values);
        if (sql.startsWith("SELECT owner_id,id,kind,mime")) { const row = result.rows[0];if (fault === "null-mime") row.mime = null;else if (fault === "missing-mime") delete row.mime;else if (fault === "missing-owner") delete row.owner_id;else row.owner_id = B; }return result; };
      const value = Reflect.get(target, prop);return typeof value === "function" ? value.bind(target) : value;
    } }); } };
    await expect(create(pool).create(actorA, snapshot.menu.id, inputs(), snapshot)).rejects.toHaveProperty("code");expect(downloads).toEqual([]);expect(requests).toBe(0);expect(await counts()).toEqual(before);await scratchClean();
  });
  it.each([badSize, badHash, badType])("byte size/hash/type mismatch rolls back (%s)", async id => {
    const before = await counts();await expect(create().create(actorA, snapshot.menu.id, inputs(id), snapshot)).rejects.toMatchObject({ code: "INVALID_INPUT" });expect(await counts()).toEqual(before);await scratchClean();
  });
  it.each(["404", "401"])("Storage %s maps safe error without writes", async status => {
    mode = status;const before = await counts();
    try { await create().create(actorA, snapshot.menu.id, inputs(), snapshot);throw new Error("Expected rejection"); }
    catch (e) { expect(e).toMatchObject({ code: status === "404" ? "INVALID_INPUT" : "PROJECT_CREATE_UNAVAILABLE" });expect(String(e)).not.toContain("private Storage");expect(String(e)).not.toContain("credential"); }
    expect(await counts()).toEqual(before);await scratchClean();
  });
  it("IO budget expires after SHARE lock, aborts network, rolls back and releases the row", async () => {
    mode = "wait";const before = await counts(), began = new Promise<void>(done => { started = done; });
    const pending = create(fixture.pool, 300).create(actorA, snapshot.menu.id, inputs(), snapshot);void pending.catch(() => {});await began;
    await expect(pending).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE" });expect(downloads).toHaveLength(1);
    const client = await fixture.admin.connect();try { await client.query("BEGIN");await client.query("SELECT id FROM dream.assets WHERE id=$1 FOR UPDATE NOWAIT", [good]); }finally { await client.query("ROLLBACK");client.release(); }
    expect(await counts()).toEqual(before);await scratchClean();
  });
  it("a real competing UPDATE waits for SHARE lock and proceeds after request abort", async () => {
    mode = "wait";const controller = new AbortController(), startedIO = new Promise<void>(done => { started = done; }), before = await counts();
    const pending = create().create(actorA, snapshot.menu.id, inputs(), snapshot, controller.signal);void pending.catch(() => {});await startedIO;
    const other = await fixture.admin.connect();const update = other.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1", [good]);void update.catch(() => {});
    try {
      await vi.waitFor(async () => expect((await fixture.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'UPDATE dream.assets SET archived_at=now()%' AND wait_event_type='Lock'")).rows[0].n).toBe(1));
      controller.abort();await expect(pending).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE" });await update;
    } finally { controller.abort();await pending.catch(() => {});await update;other.release();await fixture.admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1", [good]); }
    expect(await counts()).toEqual(before);await scratchClean();
  });
  it("late audit failure rolls back project/stages/links after successful object verification", async () => {
    const before = await counts();await fixture.admin.query("CREATE FUNCTION public.b15_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL secret'; END $$; CREATE TRIGGER b15_fail BEFORE INSERT ON dream.activity_log FOR EACH ROW EXECUTE FUNCTION public.b15_fail()");
    try { await expect(create().create(actorA, snapshot.menu.id, inputs(), snapshot)).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE", message: "PROJECT_CREATE_UNAVAILABLE" });expect(downloads).toHaveLength(1);expect(await counts()).toEqual(before); }
    finally { await fixture.admin.query("DROP TRIGGER b15_fail ON dream.activity_log; DROP FUNCTION public.b15_fail()"); }await scratchClean();
  });
  it("one shared adapter keeps request cancellation isolated between concurrent creates", async () => {
    mode = "wait";const controller = new AbortController();let starts = 0;const both = new Promise<void>(done => { started = () => { if (++starts === 2) done(); }; });
    const service = create(), canceled = service.create(actorA, snapshot.menu.id, inputs(), snapshot, controller.signal), kept = service.create(actorB, snapshot.menu.id, inputs(foreign), snapshot);void canceled.catch(() => {});void kept.catch(() => {});
    await both;controller.abort();await expect(canceled).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE" });const id = await kept;
    expect((await postgresProjectReads(fixture.pool).get(actorB, id)).project.id).toBe(id);await scratchClean();
  });
  it("cancellation after audit but before COMMIT still rolls back; no post-commit false failure", async () => {
    for (const cancelAt of ["audit", "commit"]) {
      const controller = new AbortController(), before = await counts();
      const pool = { async connect() { const client = await fixture.pool.connect();return new Proxy(client, { get(target, prop) {
        if (prop === "query") return async (sql: string, values?: unknown[]) => { const result = await target.query(sql, values);if ((cancelAt === "audit" && sql.startsWith("INSERT INTO dream.activity_log")) || (cancelAt === "commit" && sql === "COMMIT")) controller.abort();return result; };
        const value = Reflect.get(target, prop);return typeof value === "function" ? value.bind(target) : value;
      } }); } };
      const pending = create(pool).create(actorA, snapshot.menu.id, inputs(), snapshot, controller.signal);
      if (cancelAt === "audit") { await expect(pending).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE" });expect(await counts()).toEqual(before); }
      else { const id = await pending;expect((await postgresProjectReads(fixture.pool).get(actorA, id)).project.id).toBe(id); }
    }await scratchClean();
  });
  it("legacy link skip remains; a link never substitutes for required product image", async () => {
    const custom = structuredClone(snapshot);custom.menu.inputs.push({ id: "extraReference", label: "Reference", type: "assets", required: false });
    const id = await create().create(actorA, snapshot.menu.id, { ...inputs(), extraReference: [link] }, custom);expect(downloads).toHaveLength(1);
    expect((await fixture.admin.query("SELECT count(*)::int AS n FROM dream.project_assets WHERE project_id=$1", [id])).rows[0].n).toBe(2);
    const before = downloads.length;await expect(create().create(actorA, snapshot.menu.id, inputs(link), snapshot)).rejects.toMatchObject({ code: "INVALID_INPUT" });expect(downloads).toHaveLength(before);await scratchClean();
  });
  it("configuration budget is explicit and bounded without opening a connection", () => {
    for (const ioTimeoutMs of [0, 10001, NaN]) expect(() => postgresProjectCreateWithStorage(fixture.pool, reader, { ioTimeoutMs })).toThrow("STORAGE_CONFIG");
  });
  it("pre-aborted request does not acquire a PG client or contact Storage", async () => {
    const controller = new AbortController();controller.abort();const connect = vi.spyOn(fixture.pool, "connect");
    try { await expect(create().create(actorA, snapshot.menu.id, inputs(), snapshot, controller.signal)).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE" });expect(connect).not.toHaveBeenCalled();expect(requests).toBe(0); }
    finally { connect.mockRestore(); }
  });
});
