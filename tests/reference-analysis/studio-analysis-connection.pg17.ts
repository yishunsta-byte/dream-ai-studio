import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readdir, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import type { Client } from "pg";
import sharp from "sharp";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { createIsolatedStudioAnalysisConnection, studioAnalysisConnection } from "../../lib/reference-analysis/studio-analysis-connection";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";
import { createIsolatedStudioMaterialsGet } from "../../lib/reference-analysis/studio-protected-materials-get";

type Selection = Readonly<{ projectId: string; assetId: string }>;
type ConnectionOptions = NonNullable<Parameters<typeof createIsolatedStudioAnalysisConnection>[0]>;
type Fixture = Readonly<{
  admin: Client;
  root: string;
  options: ConnectionOptions["authority"] & { bucket: string };
  images: Map<string, Buffer>;
  ownerA: string;
  ownerB: string;
  selectA: Selection;
  selectB: Selection;
  ownerPermission: (client: Client, owner: string, allowed: boolean) => Promise<void>;
  scopePermission: (client: Client, owner: string, project: string, asset: string, allowed: boolean) => Promise<void>;
}>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function makeImages(assetA: string, assetB: string) {
  const image = (background: string) => sharp({ create: { width: 16, height: 16, channels: 3, background } }).png().toBuffer();
  return new Map([[assetA, await image("#ff0000")], [assetB, await image("#0000ff")]]);
}

const failure = (reason: string) => ({ schemaVersion: 1, status: "unavailable", reason });
const authenticated = (userId: string) => ({ kind: "verified", userId, email: "synthetic@example.invalid" }) as const;

export async function verifyConnection({ admin, root, options, images, ownerA, ownerB, selectA, selectB,
  ownerPermission, scopePermission }: Fixture) {
  const workRoot = join(await realpath(root), "studio-analysis-files");
  await mkdir(workRoot);
  const bucket = options.bucket;
  const credential = "synthetic-t307-storage-key";
  const objects = new Map([[ownerA, selectA.assetId], [ownerB, selectB.assetId]].map(([owner, id]) => {
    const bytes = images.get(id)!;
    return [`/storage/v1/object/${bucket}/${owner}/assets/${id}/${sha256(bytes)}.png`, bytes];
  }));
  let downloads = 0;
  let alter: "bytes" | "registration" | undefined;
  let transportError: unknown;
  const server = createServer((request, response) => {
    const handle = async () => {
      if (request.method !== "GET" || request.headers.authorization !== `Bearer ${credential}` || request.headers.apikey !== credential) {
        response.writeHead(403).end();
        return;
      }
      if (request.url === `/storage/v1/bucket/${bucket}`) {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: bucket, name: bucket, public: false }));
        return;
      }
      const bytes = objects.get(request.url ?? "");
      if (!bytes) { response.writeHead(404).end(); return; }
      downloads++;
      if (alter === "registration") await admin.query("UPDATE rea_t307.asset_witness SET source_generation='source-replaced' WHERE asset_id=$1", [selectA.assetId]);
      const data = Buffer.from(bytes);
      if (alter === "bytes") data[data.length - 1] ^= 1;
      response.writeHead(200, { "content-length": data.length }).end(data);
    };
    void handle().catch(error => { transportError = error; response.destroy(); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const storage = { profile: "synthetic", projectUrl: origin, projectRef: "abcdefghijklmnopqrst", bucket, privateBucket: true,
    credential: { mode: "service-role", key: credential }, maxBytes: 1_048_576, timeoutMs: 2750, maxConcurrent: 2,
    workRoot, ffprobePath: join(workRoot, "unused-ffprobe.exe") } as const;
  let auth: ServerAuthResult = authenticated(ownerA);
  const wire: { pending?: ServerAuthResult; onAuth?: () => Promise<void> } = {};
  const resolveAuth = async () => {
    await wire.onAuth?.();
    const pinned = wire.pending;
    wire.pending = undefined;
    return pinned ?? auth;
  };
  const request = (selection: Selection) => new Request(origin + "/api/studio/reference-analysis", {
    method: "POST", headers: { origin, host: new URL(origin).host, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(selection),
  });
  const materialsRequest = () => new Request(origin + "/fixture/materials");

  let connection: Awaited<ReturnType<typeof createIsolatedStudioAnalysisConnection>>;
  try {
    assert.equal(studioAnalysisConnection, undefined);
    assert.equal(await createIsolatedStudioAnalysisConnection(), undefined);
    assert.equal(await createIsolatedStudioAnalysisConnection({ authority: options, storage: { ...storage, projectUrl: "https://other.invalid" }, resolveAuth }), undefined);
    const disconnected = await createStudioAnalysisPost({ resolveAuth })(request(selectA));
    assert.equal(disconnected.status, 503);
    assert.deepEqual(await disconnected.json(), failure("analysis_unavailable"));
    const disconnectedList = await createIsolatedStudioMaterialsGet({ resolveAuth })(materialsRequest());
    assert.equal(disconnectedList.status, 503);
    assert.equal(disconnectedList.headers.get("cache-control"), "private, no-store");

    connection = await createIsolatedStudioAnalysisConnection({ authority: options, storage, resolveAuth });
    assert(connection);
    const load = connection.loadMaterials;
    const post = createStudioAnalysisPost(connection.post);
    async function response(selection: Selection, status = 200) {
      const reply = await post(request(selection));
      assert.equal(reply.status, status);
      assert.equal(reply.headers.get("cache-control"), "no-store");
      return reply.json();
    }
    assert.deepEqual(await load(), { kind: "connected", materials: [] });
    assert.deepEqual(await response(selectA), failure("source_unavailable"));
    assert.equal(downloads, 0);
    for (const [id, selection] of [[ownerA, selectA], [ownerB, selectB]] as const) {
      await ownerPermission(admin, id, true);
      await scopePermission(admin, id, selection.projectId, selection.assetId, true);
    }
    for (const [id, own, other, palette] of [[ownerA, selectA, selectB, "#e02020"], [ownerB, selectB, selectA, "#2020e0"]] as const) {
      auth = authenticated(id);
      assert.deepEqual(await load(), { kind: "connected", materials: [{ ...own, label: `등록 이미지 · ${own.assetId.slice(-8)}` }] });
      const before: number = downloads;
      assert.deepEqual(await response(other), failure("source_unavailable"));
      assert.equal(downloads, before);
      const ready = await response(own);
      assert.equal(ready.status, "ready");
      assert.equal(ready.media, "image");
      assert(JSON.stringify(ready).includes(palette));
      assert.deepEqual(Object.keys(ready).sort(), ["media", "proposals", "schemaVersion", "status"]);
      assert(!JSON.stringify(ready).includes(sha256(images.get(own.assetId)!)));
      assert.equal(downloads, before + 1);
    }
    const beforeDenied = downloads;
    auth = { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" };
    assert.deepEqual(await load(), auth);
    assert.equal((await response(selectB, 403)).code, "AUTH_FORBIDDEN");
    auth = authenticated(ownerB);
    wire.pending = authenticated(ownerA);
    assert.deepEqual(await response(selectB), failure("source_unavailable"));
    assert.equal(downloads, beforeDenied);

    auth = authenticated(ownerA);
    const unregistered = { ...selectA, assetId: "10000000-0000-7000-8000-0000000000ff" };
    assert.deepEqual(await response(unregistered), failure("source_unavailable"));
    await scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, false);
    assert.deepEqual(await load(), { kind: "connected", materials: [] });
    assert.deepEqual(await response(selectA), failure("source_unavailable"));
    assert.equal(downloads, beforeDenied);
    await scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, true);
    alter = "bytes";
    assert.deepEqual(await response(selectA), failure("source_unavailable"));
    alter = "registration";
    assert.deepEqual(await response(selectA), failure("source_unavailable"));
    assert.equal((await admin.query("SELECT source_generation FROM rea_t307.asset_witness WHERE asset_id=$1",
      [selectA.assetId])).rows[0]?.source_generation, "source-replaced");
    assert.equal(downloads, beforeDenied + 2);
    assert.equal(transportError, undefined);
    assert.deepEqual(await readdir(workRoot), []);

    async function checkList(status: number, body: unknown) {
      const reply = await connection!.getMaterials(materialsRequest());
      assert.equal(reply.status, status);
      assert.equal(reply.headers.get("cache-control"), "private, no-store");
      if (status === 200) assert.deepEqual(await reply.json(), body);
      else assert.equal((await reply.json()).code, body);
    }
    function changeAtRecheck(change: () => Promise<unknown>) {
      let calls = 0;
      wire.onAuth = async () => {
        if (++calls === 2) {
          wire.onAuth = undefined;
          await change();
        }
      };
    }
    auth = { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
    await checkList(401, "AUTH_REQUIRED");
    auth = { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" };
    await checkList(403, "AUTH_FORBIDDEN");
    for (const [id, own] of [[ownerA, selectA], [ownerB, selectB]] as const) {
      auth = authenticated(id);
      await checkList(200, { materials: [{ ...own, label: `등록 이미지 · ${own.assetId.slice(-8)}` }] });
    }
    auth = authenticated(ownerA);
    changeAtRecheck(() => scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, false));
    await checkList(200, { materials: [] });
    await checkList(200, { materials: [] });
    await scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, true);
    changeAtRecheck(() => admin.query("UPDATE rea_t307.asset_witness SET source_generation='source-after-list' WHERE asset_id=$1", [selectA.assetId]));
    await checkList(200, { materials: [] });
    await checkList(200, { materials: [{ ...selectA, label: `등록 이미지 · ${selectA.assetId.slice(-8)}` }] });
    assert.equal(downloads, beforeDenied + 2);

    await connection.close();
    assert.deepEqual(await load(), { kind: "unavailable" });
    assert.deepEqual(await response(selectA), failure("source_unavailable"));
    await checkList(503, "STUDIO_MATERIALS_UNAVAILABLE");
    console.log("PG17 protected list: 401/403/503, empty/success, current owner, revocation and generation changes passed; storage calls unchanged");
    console.log("PG17 assembled analysis: owner A/B, auth switch/denial, unconfigured, unregistered, revoked, bytes mismatch, current witness change, and cleanup passed");
  } finally {
    try { await connection?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
    }
  }
}
