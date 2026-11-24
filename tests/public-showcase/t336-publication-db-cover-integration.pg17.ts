import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { createAdminPublicationHttp } from "../../lib/public-showcase/admin-publication-http";
import { COVER_MAX_BYTES, serveCover } from "../../lib/public-showcase/cover-source";
import { createPublicationRuntime } from "../../lib/public-showcase/publication-runtime";
import { createPublicationServerConfig } from "../../lib/public-showcase/publication-server-config";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import { evidence, post, syntheticCover, verified, work } from "../admin/publication-http-fixture";

type Options = NonNullable<Parameters<typeof createPublicationServerConfig>[0]>;
const owner = "10000000-0000-4000-8000-0000000000a1";
const other = "10000000-0000-4000-8000-0000000000b1";
const bucket = "publication-covers-private";
const slug = "t336-integrated";
const bucketPath = `/storage/v1/bucket/${bucket}`;
const credential = "t336-synthetic-cover-credential";
const providerBody = "t336-private-provider-payload";

export async function runT336PublicationIntegration(control: Client, database: Options["database"]) {
  const image = await syntheticCover();
  const item = work(owner, slug, 66);
  const proof = evidence(item, "1", image);
  const key = proof.cover.objectKey;
  const objectPath = `/storage/v1/object/${bucket}/${key}`;
  const coverPath = `/media/public/${slug}/1/cover.webp`;
  const requests: { path: string; method: string; authorized: boolean }[] = [];
  let mode: "ok" | "public" | "storage-failure" | "corrupt" | "stall" = "ok";
  let revokeDuringRead: (() => Promise<void>) | undefined;
  let closedStream: (() => void) | undefined;
  const server = createServer((req, res) => {
    const authorized = req.headers.apikey === credential && req.headers.authorization === `Bearer ${credential}`;
    requests.push({ path: req.url ?? "", method: req.method ?? "", authorized });
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.method !== "GET" || !authorized) return reply(403, { message: providerBody });
    if (req.url === bucketPath) return reply(200, { id: bucket, name: bucket, public: mode === "public" });
    if (req.url !== objectPath) return reply(404, { message: providerBody });
    if (mode === "storage-failure") return reply(503, { message: providerBody });
    res.writeHead(200, { "content-type": "application/octet-stream", "transfer-encoding": "chunked" });
    if (mode === "stall") {
      res.once("close", () => closedStream?.());
      res.write(image.bytes.subarray(0, 8));
      return;
    }
    const send = () => {
      const bytes = Buffer.from(image.bytes);
      if (mode === "corrupt") bytes[bytes.length - 1] ^= 1;
      res.write(bytes.subarray(0, 10));
      res.end(bytes.subarray(10));
    };
    if (revokeDuringRead) {
      const revoke = revokeDuringRead;
      revokeDuringRead = undefined;
      void revoke().then(send, () => res.destroy());
    } else send();
  });

  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const projectUrl = `http://127.0.0.1:${address.port}`;
    // Extra input fields simulate accidental legacy configuration. The composition is bound to the top-level actor and fixed bucket.
    const storage = { profile: "synthetic" as const, projectUrl, projectRef: "abcdefghijklmnopqrst",
      credential: { mode: "service-role" as const, key: credential }, timeoutMs: 1000, maxBytes: COVER_MAX_BYTES, maxConcurrent: 1,
      adminActorId: other, bucket: "unapproved-bucket" };
    const config = { database, adminActorId: owner.toUpperCase(), rightsReader: { schema: "t332", name: "rights_state" }, storage } satisfies Options;
    const nonPublic = [credential, providerBody, key, projectUrl, bucket, ...Object.values(database.logins).map(login => new URL(login.connectionString).password)];
    const assertPrivate = (value: string) => {
      for (const sealed of nonPublic) assert(!value.includes(sealed), "Cover response exposed server data");
    };
    const request = (command: "prepare" | "complete" | "revoke", expectedVersion: string, generation: string | null) => ({
      requestId: randomUUID(), slug, command, expectedVersion, generation, rightsConfirmed: command !== "revoke",
    });
    assert.equal(createPublicationServerConfig(), undefined);
    for (const invalid of [
      { ...config, storage: { ...storage, projectUrl: projectUrl + "/other" } },
      { ...config, adminActorId: other },
      { ...config, database: { ...database, logins: { ...database.logins, list: database.logins.cover, cover: database.logins.list } } },
    ]) {
      const unavailable = createPublicationRuntime(() => createPublicationServerConfig(invalid));
      try { assert.equal((await unavailable.get()).mode, "inactive"); }
      finally { await unavailable.close(); }
      assert.equal(requests.length, 0);
    }

    const manifest = { sourceId: item.artifact.id, sourceRevision: item.artifact.revision, sourceSha: item.artifact.sha,
      rightsRef: proof.rights.reference, display: item.display, coverSha: image.sha, coverBytes: image.bytes.length };
    const publisher = await control.query("INSERT INTO t253_showcase.publishers VALUES ($1) ON CONFLICT DO NOTHING", [owner]);
    try {
      await control.query("INSERT INTO t293.works VALUES ($1,$2,$3)", [owner, slug, item]);
      await control.query("INSERT INTO t293.evidence VALUES ($1,$2,$3)", [owner, slug, proof]);
      await control.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,$3,$4,true)", [owner, item.artifact.id, item.artifact.revision, item.artifact.sha]);
      await control.query("INSERT INTO t295.attestations VALUES ($1,$2,$3,$4,'perpetual',NULL)", [owner, slug, proof.rights.reference, manifest]);
      const verifiedConfig = createPublicationServerConfig(config);
      assert(verifiedConfig);
      storage.credential.key = "value-changed-after-server-approval";
      const runtime = createPublicationRuntime(() => verifiedConfig);
      try {
        const connected = await runtime.get();
        assert.equal(connected.mode, "active");
        assert.equal(requests.length, 0);
        const admin = (actor = owner) => createAdminPublicationHttp({ store: () => connected.adminStore, env: {}, resolveAuth: async () => verified(actor) });
        const apply = async (command: ReturnType<typeof request>, actor = owner) => {
          const response = await admin(actor).handlePost(post(JSON.stringify(command)));
          assert.equal(response.status, 200);
          const text = await response.text();
          assertPrivate(text);
          return JSON.parse(text);
        };
        const feed = async () => {
          const result = await loadShowcaseFeed(connected.showcaseSource);
          assertPrivate(JSON.stringify(result));
          return result;
        };
        const cover = async (method = "GET") => {
          const response = await serveCover(new Request(`https://test.invalid${coverPath}`, { method }), connected.coverSource);
          assert.equal(response.headers.get("cache-control"), "no-store");
          assertPrivate(JSON.stringify([...response.headers]));
          return response;
        };
        const hidden = async () => {
          assert(!(await feed()).works.some(entry => entry.image?.src === coverPath));
          assert.equal((await cover()).status, 404);
        };
        const prepare = request("prepare", "0", null);
        assert.deepEqual(await apply(prepare, other), { status: "denied" });
        assert.deepEqual(await apply(prepare), { status: "prepared", version: "1", generation: "1" });
        await hidden();
        assert.equal(requests.length, 0);

        const complete = request("complete", "1", "1");
        mode = "public";
        assert.deepEqual(await apply(complete), { status: "unavailable" });
        assert.deepEqual(requests.map(req => req.path), [bucketPath]);
        mode = "storage-failure";
        assert.deepEqual(await apply(complete), { status: "unavailable" });
        await hidden();
        const { rows: [uncommitted] } = await control.query(`SELECT (SELECT state->>'revision' FROM t293.works WHERE slug=$1) AS revision,
          (SELECT count(*)::int FROM t293.app_requests WHERE request_id=$2) AS ledger,
          (SELECT count(*)::int FROM t293.audit WHERE request_id=$2) AS audit,
          (SELECT count(*)::int FROM t295.requests WHERE request_id=$2) AS publication`, [slug, complete.requestId]);
        assert.deepEqual(uncommitted, { revision: "1", ledger: 0, audit: 0, publication: 0 });

        mode = "ok";
        assert.deepEqual(await apply(complete), { status: "published", version: "2", generation: "1" });
        assert((await feed()).works.some(entry => entry.image?.src === coverPath));
        const ok = await cover();
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get("content-type"), "image/webp");
        assert.deepEqual(Buffer.from(await ok.arrayBuffer()), image.bytes);
        const head = await cover("HEAD");
        assert.equal(head.status, 200);
        assert.equal(await head.text(), "");

        mode = "corrupt";
        const corrupt = await cover();
        assert.equal(corrupt.status, 503);
        assertPrivate(await corrupt.text());
        mode = "stall";
        const socketClosed = Promise.withResolvers<void>();
        closedStream = socketClosed.resolve;
        const stalled = await cover();
        assert.equal(stalled.status, 503);
        await Promise.race([socketClosed.promise, delay(3000, undefined, { ref: false }).then(() => assert.fail("Storage response remained open"))]);
        mode = "ok";
        const restored = await cover();
        assert.equal(restored.status, 200);
        await restored.arrayBuffer();

        revokeDuringRead = async () => {
          assert.deepEqual(await apply(request("revoke", "2", "1")), { status: "revoked", version: "3", generation: "1" });
        };
        assert.equal((await cover()).status, 404);
        await hidden();
        const readCount = requests.length;
        await control.query("REVOKE t295_file FROM t328_cover");
        try {
          const unavailable = await cover();
          assert.equal(unavailable.status, 503);
          assertPrivate(await unavailable.text());
          const queue = await admin().handleGet();
          const text = await queue.text();
          assertPrivate(text);
          assert.deepEqual(JSON.parse(text), { kind: "failed" });
          assert.equal((await feed()).state, "unavailable");
          assert.equal(requests.length, readCount);
        } finally { await control.query("GRANT t295_file TO t328_cover"); }
        assert(requests.every(req => req.method === "GET" && req.authorized && [bucketPath, objectPath].includes(req.path)));
      } finally { await runtime.close(); }
      const sessions = await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='dream-backend'");
      assert.equal(sessions.rows[0].n, 0);
    } finally {
      if (publisher.rowCount === 1) await control.query("DELETE FROM t253_showcase.publishers WHERE actor=$1", [owner]);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
  }
  console.log("T336 composed actor, PostgreSQL publish/withdraw, private Storage SDK, integrity, partial failures and cleanup passed");
}
