import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { createAdminPublicationHttp } from "../../lib/public-showcase/admin-publication-http";
import { COVER_MAX_BYTES, serveCover } from "../../lib/public-showcase/cover-source";
import { loadPublicationRuntimeOptions } from "../../lib/public-showcase/publication-runtime-config";
import { createSealedPublicationRuntime } from "../../lib/public-showcase/publication-sealed-runtime";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import { evidence, post, syntheticCover, verified, work } from "../admin/publication-http-fixture";
import { runT341DelegatedPublicationInstaller } from "./t341-publication-delegated-installer.pg17";

type Options = NonNullable<Parameters<typeof createSealedPublicationRuntime>[0]>;
type Runtime = ReturnType<typeof createSealedPublicationRuntime>;
type Active = Extract<Awaited<ReturnType<Runtime["get"]>>, { mode: "active" }>;
const slug = "t342-sealed";
const coverPath = `/media/public/${slug}/1/cover.webp`;
const bucket = "publication-covers-private";
const bucketPath = `/storage/v1/bucket/${bucket}`;
const credential = "t342-local-private-cover";

export async function runT342PublicationSealedRuntime(control: Client, fixture: Parameters<typeof runT341DelegatedPublicationInstaller>[1]) {
  assert.equal(loadPublicationRuntimeOptions(), undefined);
  const image = await syntheticCover();
  const objectPath = `/storage/v1/object/${bucket}/${slug}/1/${image.sha}.webp`;
  const requests: string[] = [];
  let beforeCoverReply: (() => Promise<unknown>) | undefined;
  const storage = createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.method !== "GET" || req.headers.apikey !== credential || req.headers.authorization !== `Bearer ${credential}`) {
      res.writeHead(403).end();
    } else if (req.url === bucketPath) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: bucket, name: bucket, public: false }));
    } else if (req.url === objectPath) {
      const send = () => res.writeHead(200, { "content-type": "application/octet-stream" }).end(image.bytes);
      if (beforeCoverReply) void beforeCoverReply().then(send, () => res.destroy());
      else send();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => { storage.once("error", reject); storage.listen(0, "127.0.0.1", resolve); });

  async function assertNoSessions() {
    for (let attempt = 0; ; attempt++) {
      const { rows: [row] } = await control.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE application_name IN ('dream-backend','dream-publication-seal','dream-publication-revalidation')`);
      if (row.n === 0) return;
      assert(attempt < 20, "Publication session left open");
      await delay(50);
    }
  }
  const command = (command: "prepare" | "complete" | "revoke", expectedVersion: string, generation: string | null) => ({
    requestId: randomUUID(), slug, command, expectedVersion, generation, rightsConfirmed: command !== "revoke",
  });
  const admin = (runtime: Runtime, actor: string) => createAdminPublicationHttp({
    store: async () => (await runtime.get()).adminStore, resolveAuth: async () => verified(actor), env: {},
  });
  const cover = async (runtime: Runtime) => serveCover(new Request(`https://test.invalid${coverPath}`), (await runtime.get()).coverSource);
  const feed = async (runtime: Runtime) => loadShowcaseFeed((await runtime.get()).showcaseSource);

  async function assertInactive(runtime: Runtime, actor: string) {
    const requestCount = requests.length;
    try {
      const providers = await runtime.get();
      assert.equal(providers.mode, "inactive");
      assert.equal(providers.adminStore, null);
      assert.deepEqual(await (await admin(runtime, actor).handleGet()).json(), { kind: "closed" });
      assert.equal((await admin(runtime, actor).handlePost(post(JSON.stringify(command("prepare", "0", null))))).status, 503);
      assert.equal((await feed(runtime)).state, "sample");
      assert(!(await feed(runtime)).works.some(entry => entry.image?.src === coverPath));
      assert.equal((await cover(runtime)).status, 404);
      assert.equal(requests.length, requestCount);
    } finally { await runtime.close(); }
    await assertNoSessions();
  }

  async function waitForRead(applicationName = "dream-publication-seal") {
    for (let elapsed = 0; elapsed < 3000; elapsed += 25) {
      await control.query("SELECT pg_stat_clear_snapshot()");
      const { rows: [row] } = await control.query(`SELECT
        (SELECT count(*)::int FROM pg_stat_activity WHERE application_name=$1) AS verifiers,
        EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'
          AND query LIKE 'WITH ns AS%') AS blocked,
        EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='dream-backend') AS opened`, [applicationName]);
      if (row.blocked) {
        assert.equal(row.verifiers, 1);
        assert.equal(row.opened, false);
        return;
      }
      await delay(25);
    }
    assert.fail("The verifier did not reach the controlled catalog read");
  }

  const running: { runtime: Runtime; bundle: Active }[] = [];
  try {
    const address = storage.address();
    assert(address && typeof address !== "string");
    let sealedOptions: Options | undefined;
    await runT341DelegatedPublicationInstaller(control, fixture, async (phase, context) => {
      const { actor, database, plan, verifierConnectionString, work: approval } = context;
      const server = { database, adminActorId: actor, rightsReader: { schema: "t295", name: "rights_state" },
        storage: { profile: "synthetic", projectUrl: `http://127.0.0.1:${address.port}`, projectRef: "abcdefghijklmnopqrst",
          credential: { mode: "service-role", key: credential }, timeoutMs: 1000, maxBytes: COVER_MAX_BYTES, maxConcurrent: 1 } } satisfies Options["server"];
      const config = { server, plan, work: approval, verifierConnectionString } satisfies Options;
      const verify = (options?: Options) => createSealedPublicationRuntime(options);

      if (phase !== "sealed") {
        await assertInactive(verify(config), actor);
        return;
      }
      sealedOptions = config;

      await assertInactive(verify(), actor);
      const wrongPassword = new URL(verifierConnectionString);
      wrongPassword.password = "wrong-synthetic-password";
      const badList = new URL(database.logins.list.connectionString);
      badList.password = "wrong-synthetic-list-password";
      const { rows: [{ oid: otherOid }] } = await control.query<{ oid: string }>(
        "SELECT oid::text FROM pg_database WHERE datname='postgres'");
      assert.notEqual(otherOid, plan.target.databaseOid);
      for (const invalid of [
        { ...config, server: { ...server, database: { ...database, approvedDatabaseOid: otherOid } } },
        { ...config, plan: { ...plan, target: { ...plan.target, databaseOid: otherOid } } },
        { ...config, verifierConnectionString: wrongPassword.href },
        { ...config, verifierConnectionString: verifierConnectionString.replace(`/${database.target.database}`, "/postgres") },
        { ...config, server: { ...server, database: { ...database, target: { ...database.target, systemIdentifier: "1" } } } },
        { ...config, server: { ...server, database: { ...database, ca: undefined } } },
        { ...config, server: { ...server, rightsReader: { schema: "t293", name: "rights_state" } } },
        { ...config, server: { ...server, database: { ...database, logins: { ...database.logins, cover: database.logins.list } } } },
        { ...config, server: { ...server, database: { ...database,
          logins: { ...database.logins, list: { ...database.logins.list, connectionString: badList.href } } } } },
        { ...config, server: { ...server, storage: { ...server.storage, projectUrl: server.storage.projectUrl + "/extra" } } },
      ]) await assertInactive(verify(invalid), actor);

      const explicitlyPinned = verify({ ...config,
        server: { ...server, database: { ...database, approvedDatabaseOid: plan.target.databaseOid } } });
      try {
        assert.equal((await explicitlyPinned.get()).mode, "active");
        assert.equal(requests.length, 0);
      } finally { await explicitlyPinned.close(); }
      await assertNoSessions();

      const { rows: [first] } = await control.query("SELECT source_sha256 FROM t_publication_install.history");
      const corrupt = () => control.query("UPDATE t_publication_install.history SET source_sha256=repeat('0',64)");
      const restore = () => control.query("UPDATE t_publication_install.history SET source_sha256=$1", [first.source_sha256]);
      await corrupt();
      try { await assertInactive(verify(config), actor); }
      finally { await restore(); }

      // The first READ ONLY transaction has a snapshot before this history change. The
      // read after assembly must see the new commit and discard both opened handles.
      const raced = verify(config);
      await control.query("BEGIN");
      let pending: Promise<Awaited<ReturnType<Runtime["get"]>>[]> | undefined;
      try {
        await control.query("LOCK TABLE t293.actor_bindings IN ACCESS EXCLUSIVE MODE");
        pending = Promise.all([raced.get(), raced.get()]);
        await waitForRead();
        await corrupt();
        await control.query("COMMIT");
        assert((await pending).every(state => state.mode === "inactive"));
        await assertInactive(raced, actor);
      } finally {
        if (control.getTransactionStatus() !== "I") await control.query("ROLLBACK");
        await pending;
        await raced.close();
        await restore();
      }

      const stopped = verify(config);
      await control.query("BEGIN");
      try {
        await control.query("LOCK TABLE t293.actor_bindings IN ACCESS EXCLUSIVE MODE");
        const starting = stopped.get();
        await waitForRead();
        const stopping = stopped.close();
        await control.query("ROLLBACK");
        await stopping;
        assert.equal((await starting).mode, "inactive");
      } finally {
        if (control.getTransactionStatus() !== "I") await control.query("ROLLBACK");
        await stopped.close();
      }
      await assertInactive(stopped, actor);

      const item = work(actor, slug, 92);
      const proof = evidence(item, "1", image);
      const manifest = { sourceId: item.artifact.id, sourceRevision: item.artifact.revision, sourceSha: item.artifact.sha,
        rightsRef: proof.rights.reference, display: item.display, coverSha: image.sha, coverBytes: image.bytes.length };
      await control.query("INSERT INTO t293.works VALUES ($1,$2,$3)", [actor, slug, item]);
      await control.query("INSERT INTO t293.evidence VALUES ($1,$2,$3)", [actor, slug, proof]);
      await control.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,$3,$4,true)", [actor, item.artifact.id, item.artifact.revision, item.artifact.sha]);
      await control.query("INSERT INTO t295.attestations VALUES ($1,$2,$3,$4,'perpetual',NULL)", [actor, slug, proof.rights.reference, manifest]);

      const runtime = verify(config);
      try {
        const [one, two] = await Promise.all([runtime.get(), runtime.get()]);
        assert.equal(one.mode, "active");
        assert.equal(one, two);
        await assertNoSessions();
        assert.equal(requests.length, 0);
        const apply = async (request: ReturnType<typeof command>) => {
          const response = await admin(runtime, actor).handlePost(post(JSON.stringify(request)));
          assert.equal(response.status, 200);
          const text = await response.text();
          for (const value of [credential, verifierConnectionString, objectPath]) assert(!text.includes(value));
          return JSON.parse(text);
        };
        assert.equal((await apply(command("prepare", "0", null))).status, "prepared");
        assert.equal((await cover(runtime)).status, 404);
        assert.equal(requests.length, 0);
        assert.equal((await apply(command("complete", "1", "1"))).status, "published");
        assert((await feed(runtime)).works.some(entry => entry.image?.src === coverPath));
        const published = await cover(runtime);
        assert.equal(published.status, 200);
        assert.equal(published.headers.get("content-type"), "image/webp");
        assert.deepEqual(Buffer.from(await published.arrayBuffer()), image.bytes);
        assert.deepEqual(requests, [bucketPath, objectPath, bucketPath, objectPath]);

        const duringDownload = verify(config);
        try {
          assert.equal((await duringDownload.get()).mode, "active");
          const { rows: [{ installed }] } = await control.query("SELECT installed_at::text AS installed FROM t_publication_install.history");
          try {
            beforeCoverReply = () => control.query("UPDATE t_publication_install.history SET installed_at=installed_at+interval '1 second'");
            const unavailable = await cover(duringDownload);
            assert.equal(unavailable.status, 503);
            assert.equal(await unavailable.text(), "Service Unavailable");
            assert.equal((await duringDownload.get()).mode, "inactive");
          } finally {
            beforeCoverReply = undefined;
            await control.query("UPDATE t_publication_install.history SET installed_at=$1::timestamptz", [installed]);
          }
        } finally { await duringDownload.close(); }
        assert.deepEqual(requests.slice(4), [bucketPath, objectPath]);

        assert.equal((await apply(command("revoke", "2", "1"))).status, "revoked");
        assert(!(await feed(runtime)).works.some(entry => entry.image?.src === coverPath));
        assert.equal((await cover(runtime)).status, 404);
        assert.equal(requests.length, 6);
      } finally { await runtime.close(); }
      await assertNoSessions();
      for (const scenario of ["history", "permissions", "verifier", "shutdown"]) {
        const runtime = verify(config);
        try {
          const bundle = await runtime.get();
          assert.equal(bundle.mode, "active", scenario);
          running.push({ runtime, bundle });
        } catch (error) {
          await runtime.close();
          throw error;
        }
      }
    });
    assert(sealedOptions);
    const actor = sealedOptions.server.adminActorId;
    await assertInactive(createSealedPublicationRuntime(sealedOptions), actor);

    // These handles were admitted under the installation lock. Normal requests still
    // work after the lock is released, using a separate runtime read-only session.
    const [history, permissions, verifier, shutdown] = running;
    assert.equal((await feed(history.runtime)).state, "empty");
    assert.equal((await cover(history.runtime)).status, 404);
    const source = history.bundle.showcaseSource;
    assert(source.mode === "active" && source.store);
    const store = source.store;
    const signal = new AbortController();
    const canceled = new AbortController();
    await control.query("BEGIN");
    try {
      await control.query("LOCK TABLE t293.actor_bindings IN ACCESS EXCLUSIVE MODE");
      const first = store.listApproved(signal.signal);
      const second = store.listApproved(canceled.signal);
      const secondRejected = assert.rejects(second, { name: "AbortError" });
      await waitForRead("dream-publication-revalidation");
      canceled.abort();
      await secondRejected;
      await waitForRead("dream-publication-revalidation");
      await control.query("ROLLBACK");
      await first;
    } finally {
      if (control.getTransactionStatus() !== "I") await control.query("ROLLBACK");
    }
    assert.equal((await history.runtime.get()).mode, "active");
    await assertNoSessions();

    const object = history.bundle.coverSource;
    assert(object.mode === "active" && object.store);
    const admitted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const inFlight = history.bundle.adminStore.transaction(async () => {
      admitted.resolve();
      await release.promise;
    });
    const joined = assert.rejects(inFlight);
    const { rows: [{ installed }] } = await control.query("SELECT installed_at::text AS installed FROM t_publication_install.history");
    const requestCount = requests.length;
    try {
      await Promise.race([admitted.promise, inFlight.then(() => assert.fail("Admin operation ended before admission"))]);
      await control.query("UPDATE t_publication_install.history SET installed_at=installed_at+interval '1 second'");
      await assert.rejects(object.store.readObject(`${slug}/1/${image.sha}.webp`, { maxBytes: COVER_MAX_BYTES, signal: signal.signal }));
      assert.equal((await history.runtime.get()).mode, "inactive");
      await assert.rejects(store.listApproved(signal.signal));
      await assert.rejects(history.bundle.adminStore.transaction(async () => assert.fail("Cached writer reached SQL")));
      assert.equal(requests.length, requestCount);
    } finally {
      release.resolve();
      await control.query("UPDATE t_publication_install.history SET installed_at=$1::timestamptz", [installed]);
      await joined;
      await history.runtime.close();
    }
    await assertInactive(history.runtime, actor);

    await control.query(`GRANT CREATE ON DATABASE ${fixture.database} TO t341_installer`);
    try {
      await assert.rejects(permissions.bundle.adminStore.transaction(async () => assert.fail("Writer entered with installer grants")));
      await assertInactive(permissions.runtime, actor);
    } finally { await control.query(`REVOKE CREATE ON DATABASE ${fixture.database} FROM t341_installer`); }

    await control.query("ALTER ROLE t341_observer NOLOGIN");
    try {
      const unavailable = await feed(verifier.runtime);
      assert.equal(unavailable.state, "unavailable");
      await assertInactive(verifier.runtime, actor);
    } finally { await control.query("ALTER ROLE t341_observer LOGIN"); }

    await control.query("BEGIN");
    try {
      await control.query("LOCK TABLE t293.actor_bindings IN ACCESS EXCLUSIVE MODE");
      const checking = feed(shutdown.runtime);
      await waitForRead("dream-publication-revalidation");
      await shutdown.bundle.close();
      assert.equal((await checking).state, "unavailable");
      await control.query("ROLLBACK");
    } finally {
      if (control.getTransactionStatus() !== "I") await control.query("ROLLBACK");
    }
    await assertInactive(shutdown.runtime, actor);
  } finally {
    await Promise.allSettled(running.map(({ runtime }) => runtime.close()));
    storage.closeAllConnections();
    await new Promise<void>((resolve, reject) => storage.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(storage.listening, false);
  console.log("T342 sealed startup, fail-closed drift and cleanup, admin/public flow and private cover passed");
  console.log("T344 post-lock request revalidation, coalescing, cancellation, drift and cleanup passed");
}
