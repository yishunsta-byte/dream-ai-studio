/* global Buffer, URL, console, fetch */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import sharp from "sharp";
import { v7 } from "uuid";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types.ts";
import { createOwnedPrivateImageUpload } from "../../lib/services/postgres/private-image-upload.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const runner = new URL("../reference-analysis/managed-authority-generations.pg17.mjs", import.meta.url);
const source = (await readFile(runner, "utf8")).replaceAll("\r\n", "\n");
const blob = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
assert.equal(blob, "a121440d4716b4e01c9dad73341541bae73bb46d", "Review the T367 seam after a fixture change");
const seam = '  await bootstrap.query("CREATE DATABASE dream_test_t281 TEMPLATE template0");\n  const admin = await connect();\n  await seed(admin);\n  await exercise(admin);';
assert.equal(source.split(seam).length, 2);
const hook = registerHooks({
  load(url, context, next) {
    if (url !== runner.href) return next(url, context);
    return { format: "module", shortCircuit: true, source: source.replace(seam, `
      await bootstrap.query("CREATE DATABASE dream_test_t367 TEMPLATE template0");
      const admin = await connect(adminUser,"dream_test_t367");
      const { exercise } = await import("../postgres/t367-private-image-upload.pg17.mjs");
      await exercise(admin, sources.slice(0,4), manifest.slice(0,3), port, password);
    `) };
  },
});

function defer() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function storageFixture() {
  const objects = new Map(), handlers = new Set(), errors = [];
  const state = path => {
    if (!objects.has(path)) objects.set(path, { writes: new Set(), sealed: false });
    return objects.get(path);
  };
  const deletions = [];
  let held, heldDelete, refuseDelete = false, losePut = false, losePurge = false, purgeStarted, putCount = 0;
  const server = createServer((request, response) => {
    const work = (async () => {
      const url = new URL(request.url, "http://localhost");
      assert.match(url.pathname, /^\/t367-(incoming|private)\/[a-f0-9-]+\/(incoming|assets)\/[a-f0-9-]+\/[a-f0-9-]+(?:\.png)?$/);
      const object = state(url.pathname);
      if (request.method === "PUT") {
        if (object.sealed) { response.writeHead(409).end(); return; }
        const writer = defer();
        object.writes.add(writer.promise);
        try {
          const parts = [];
          for await (const chunk of request) parts.push(chunk);
          const data = Buffer.concat(parts);
          if (held && url.pathname.startsWith(held.prefix)) {
            const gate = held;
            held = undefined;
            gate.entered.resolve(url.pathname);
            await gate.release.promise;
          }
          if (object.bytes && !object.bytes.equals(data)) { response.writeHead(409).end(); return; }
          object.bytes = data;
          putCount++;
          if (losePut && url.pathname.startsWith("/t367-private/")) {
            losePut = false;
            response.destroy();
            return;
          }
          response.writeHead(200).end();
        } finally { object.writes.delete(writer.promise); writer.resolve(); }
      } else if (request.method === "GET") {
        if (!object.bytes) response.writeHead(404).end();
        else response.writeHead(200).end(object.bytes);
      } else if (request.method === "POST" && url.search === "?seal=1") {
        if (!object.bytes && object.writes.size === 0) { response.writeHead(404).end(); return; }
        object.sealed = true;
        await Promise.all(object.writes);
        response.writeHead(200).end("sealed");
      } else if (request.method === "DELETE") {
        deletions.push(url.pathname);
        if (refuseDelete) { refuseDelete = false; response.writeHead(503).end(); return; }
        if (heldDelete === url.pathname) {
          const gate = deleteGate;
          heldDelete = undefined;
          gate.entered.resolve();
          await gate.release.promise;
        }
        object.sealed = true;
        if (purgeStarted && url.pathname.startsWith(purgeStarted.prefix)) purgeStarted.entered.resolve();
        await Promise.all(object.writes);
        delete object.bytes;
        if (losePurge) { losePurge = false; response.destroy(); return; }
        response.writeHead(200).end("sealed-and-absent");
      } else response.writeHead(405).end();
    })().catch(error => { errors.push(error); response.writeHead(500).end(); });
    handlers.add(work);
    void work.then(() => handlers.delete(work));
  });
  let deleteGate;
  return {
    server, objects, errors, deletions,
    hold(prefix) {
      const gate = { prefix, entered: defer(), release: defer() };
      held = gate;
      return gate;
    },
    watchPurge(prefix) { const entered = defer(); purgeStarted = { prefix, entered }; return entered.promise; },
    holdDelete(path) {
      heldDelete = path;
      deleteGate = { entered: defer(), release: defer() };
      return deleteGate;
    },
    rejectNextDelete() { refuseDelete = true; },
    loseFinalPut() { losePut = true; },
    loseDelete() { losePurge = true; },
    changed() { return putCount; },
    async close() {
      held?.release.resolve();
      deleteGate?.release.resolve();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await Promise.all(handlers);
    },
  };
}

const file = name => readFile(new URL(`../../lib/db/postgres/private-image-upload/${name}.sql`, import.meta.url), "utf8");
const role = ["t367_ingest", "t367_verify", "t367_cleanup"];
const policy = "t367-local-png";
const actor = () => actorFromVerifiedUserId(randomUUID());
const failure = code => ({ code });

export async function exercise(admin, sources, manifest, port, password) {
  const [a, b, worker] = [actor(), actor(), actor()];
  const cfg = { host: "127.0.0.1", database: "dream_test_t367", port, password, max: 3, ssl: false, connectionTimeoutMillis: 3000 };
  const pools = {};
  const fixture = storageFixture();
  await new Promise((resolve, reject) => fixture.server.once("error", reject).listen(0, "127.0.0.1", resolve));
  try {
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
    await admin.query("INSERT INTO auth.users VALUES($1),($2),($3)", [a.id, b.id, worker.id]);
    for (const sql of sources) await admin.query(sql);
    await admin.query(`CREATE SCHEMA dream_migrations;
      CREATE TABLE dream_migrations.history(ordinal int PRIMARY KEY,id text UNIQUE NOT NULL,checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now());`);
    for (const [index, [id, hash]] of manifest.entries()) {
      await admin.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES($1,$2,$3)", [index + 1, id, hash]);
    }
    const baselineProject = v7();
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,
      goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,'fixture','1','{}','{}','preexisting','','','9:16',4,now(),now())`,
    [a.id, baselineProject]);
    const snapshot = async () => ({
      history: (await admin.query("SELECT * FROM dream_migrations.history ORDER BY ordinal")).rows,
      policies: (await admin.query("SELECT * FROM pg_policies WHERE schemaname='dream' ORDER BY tablename,policyname")).rows,
      grants: (await admin.query(`SELECT c.relname,a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.relnamespace='dream'::regnamespace ORDER BY 1,2,3,4`)).rows,
      columns: (await admin.query(`SELECT c.relname,m.attname,a.* FROM pg_class c JOIN pg_attribute m ON m.attrelid=c.oid
        CROSS JOIN LATERAL aclexplode(m.attacl) a WHERE c.relnamespace='dream'::regnamespace ORDER BY 1,2,3,4,5`)).rows,
    });
    const before = await snapshot();
    const install = await file("0001_install"), remove = await file("0001_remove");
    await assert.rejects(admin.query(install), /T367_OWNED_TARGET_OR_CONFLICT/);
    await admin.query("ROLLBACK; SELECT set_config('dream.t367_owned','on',false)");
    await admin.query("CREATE SCHEMA private_image_upload_v1");
    await assert.rejects(admin.query(install), /T367_OWNED_TARGET_OR_CONFLICT/);
    await admin.query("ROLLBACK; DROP SCHEMA private_image_upload_v1");
    await admin.query("ALTER TABLE dream.storage_objects DISABLE TRIGGER storage_guard");
    await assert.rejects(admin.query(install), /T367_SQL4_CATALOG/);
    await admin.query("ROLLBACK; ALTER TABLE dream.storage_objects ENABLE TRIGGER storage_guard");
    await admin.query(install);
    await assert.rejects(admin.query(install), /T367_OWNED_TARGET_OR_CONFLICT/);
    await admin.query("ROLLBACK");
    await admin.query(`CREATE ROLE t367_legacy LOGIN NOINHERIT PASSWORD '${password}';
      GRANT dream_api TO t367_legacy WITH INHERIT FALSE, SET TRUE`);
    for (const name of role) {
      await admin.query(`CREATE ROLE ${name}_login LOGIN NOINHERIT PASSWORD '${password}';
        GRANT ${name} TO ${name}_login WITH INHERIT FALSE, SET TRUE`);
      pools[name] = new Pool({ ...cfg, user: name + "_login" });
    }
    const legacy = new Pool({ ...cfg, user: "t367_legacy" });
    pools.legacy = legacy;
    const updateLegacy = async title => {
      const c = await legacy.connect();
      try {
        await c.query("BEGIN; SET LOCAL ROLE dream_api");
        await c.query("SELECT set_config('dream.actor_id',$1,true)", [a.id]);
        assert.equal((await c.query("UPDATE dream.projects SET title=$1 WHERE id=$2", [title, baselineProject])).rowCount, 1);
        await c.query("COMMIT");
      } finally { c.release(true); }
    };
    await updateLegacy("existing write after install");
    const openPolicy = async epoch => {
      const hash = sha(String(epoch));
      await admin.query("INSERT INTO dream.storage_policy_versions VALUES($1,$2,$3,clock_timestamp())", [policy, epoch, hash]);
      if (epoch === 1) await admin.query("INSERT INTO dream.storage_policies VALUES($1,1,$2,0,clock_timestamp())", [policy, hash]);
      else await admin.query("UPDATE dream.storage_policies SET epoch=$2,digest=$3,revision=revision+1 WHERE policy_id=$1", [policy, epoch, hash]);
    };
    await openPolicy(1);
    const oldObject = v7();
    await admin.query(`INSERT INTO dream.storage_objects(owner_id,id,reserved_asset_id,lifecycle,revision,barrier_fence,active_generation,created_at)
      VALUES($1,$2,$3,'reserved',0,0,0,clock_timestamp())`, [a.id, oldObject, v7()]);
    const checkRole = async (name, operation) => {
      const c = await pools[name].connect();
      try {
        await c.query(`BEGIN; SET LOCAL ROLE ${name}`);
        await c.query("SELECT set_config('dream.actor_id',$1,true)", [a.id]);
        await operation(c);
      } finally { await c.query("ROLLBACK"); c.release(); }
    };
    await checkRole("t367_ingest", c => assert.rejects(c.query("INSERT INTO dream.storage_verification_receipts(owner_id) VALUES($1)", [a.id]), { code: "42501" }));
    await checkRole("t367_cleanup", c => assert.rejects(c.query("UPDATE dream.storage_objects SET registered_asset_id=NULL"), { code: "42501" }));
    await checkRole("t367_verify", c => assert.rejects(c.query("INSERT INTO dream.storage_cleanup_claims(owner_id) VALUES($1)", [a.id]), { code: "42501" }));
    await checkRole("t367_verify", async c => {
      assert.equal((await c.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [oldObject])).rowCount, 0);
    });

    const api = createOwnedPrivateImageUpload(pools, "http://127.0.0.1:" + fixture.server.address().port, worker);
    const loseCommit = (name, statement) => {
      let remaining = 1;
      return {
        async connect() {
          let wrote = false;
          const client = await pools[name].connect();
          return new Proxy(client, {
            get(target, key) {
              if (key === "query") return async (sql, values) => {
                const out = await target.query(sql, values);
                if (sql.includes(statement)) wrote = true;
                if (sql === "COMMIT" && wrote && remaining-- > 0) throw Error("Synthetic lost COMMIT response");
                return out;
              };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
    };
    const disconnect = createOwnedPrivateImageUpload({ ...pools,
      t367_ingest: loseCommit("t367_ingest", "INSERT INTO dream.upload_intents"),
      t367_verify: loseCommit("t367_verify", "INSERT INTO dream.asset_receipt_state"),
    }, "http://127.0.0.1:" + fixture.server.address().port, worker);
    const png = await sharp({ create: { width: 12, height: 16, channels: 3, background: "#f36" } }).png().toBuffer();
    const expected = { size: png.length, sha256: sha(png) };
    const request = v7();
    await assert.rejects(disconnect.reserve(a, request, expected), failure("UNAVAILABLE"));
    const [one, two] = await Promise.all([api.reserve(a, request, expected), api.reserve(a, request, expected)]);
    assert.deepEqual(one, two);
    assert.deepEqual(Object.keys(one).sort(), ["assetId","requestId"]);
    assert.notEqual((await api.reserve(b, request, expected)).assetId, one.assetId);
    await assert.rejects(api.reserve(a, request, { ...expected, sha256: sha("different") }), failure("CONFLICT"));
    await assert.rejects(api.complete(b, v7()), failure("NOT_FOUND"));
    await assert.rejects(api.receive(a, request, Buffer.from("different")), failure("INVALID_IMAGE"));
    await assert.rejects(admin.query(remove), /T367_PENDING_STORAGE_WORK/);
    await admin.query("ROLLBACK");
    await api.receive(a, request, png);
    fixture.loseFinalPut();
    await assert.rejects(api.complete(a, request), failure("UNAVAILABLE"));
    fixture.loseDelete();
    await assert.rejects(disconnect.complete(a, request), failure("UNAVAILABLE"));
    assert.deepEqual(await Promise.all([api.complete(a, request), api.complete(a, request)]), [{ assetId: one.assetId }, { assetId: one.assetId }]);
    assert.deepEqual(await api.complete(a, request), { assetId: one.assetId });
    const registered = (await admin.query(`SELECT a.owner_id,a.width,a.height,a.sha256,s.status,r.generation,i.status AS intent,
      (SELECT count(*)::int FROM dream.storage_verification_receipts WHERE asset_id=a.id) AS records
      FROM dream.assets a JOIN dream.asset_receipt_state s ON s.asset_id=a.id
      JOIN dream.storage_verification_receipts r ON r.id=s.current_receipt_id
      JOIN dream.upload_intents i ON i.object_id=s.object_id WHERE a.id=$1`, [one.assetId])).rows[0];
    assert.deepEqual(registered, { owner_id: a.id, width: "12", height: "16", sha256: sha(png), status: "ready", generation: "1", intent: "succeeded", records: 1 });
    assert.equal(await api.cancel(a, request), "registered");
    await api.cancel(b, request);

    // A 503 before deleting leaves both sets of bytes and a pending outbox
    // entry. A policy rotation must not strand that incoming object.
    const stranded = v7();
    const strandedIds = await api.reserve(a, stranded, expected);
    await api.receive(a, stranded, png);
    fixture.rejectNextDelete();
    await assert.rejects(api.complete(a, stranded), failure("UNAVAILABLE"));
    const retained = (await admin.query(`SELECT o.lifecycle,o.object_key,i.incoming_key,x.status,x.revision,s.current_receipt_id
      FROM dream.upload_intents i JOIN dream.storage_objects o ON (o.owner_id,o.id)=(i.owner_id,i.object_id)
      JOIN dream.storage_outbox x ON (x.owner_id,x.object_id)=(o.owner_id,o.id) AND x.kind='reconcile'
      JOIN dream.asset_receipt_state s ON (s.owner_id,s.object_id)=(o.owner_id,o.id)
      WHERE i.owner_id=$1 AND i.request_id=$2`, [a.id, stranded])).rows[0];
    const stagingPath = "/t367-incoming/" + retained.incoming_key;
    const finalPath = "/t367-private/" + retained.object_key;
    assert.equal(retained.lifecycle, "registered");
    assert.equal(retained.status, "pending");
    assert.deepEqual(fixture.objects.get(stagingPath).bytes, png);
    assert.deepEqual(fixture.objects.get(finalPath).bytes, png);
    await assert.rejects(admin.query(remove), /T367_PENDING_STORAGE_WORK/);
    await admin.query("ROLLBACK");

    await openPolicy(2);
    await assert.rejects(api.complete(a, request), failure("CLOSED"));
    await assert.rejects(api.complete(a, stranded), failure("CLOSED"));
    const beforeRetries = fixture.deletions.length;
    await assert.rejects(api.cancel(b, stranded), failure("NOT_FOUND"));
    assert.equal(fixture.deletions.length, beforeRetries);

    const staged = fixture.holdDelete(stagingPath);
    const delayed = api.cancel(a, stranded);
    void delayed.catch(() => {});
    try {
      await Promise.race([
        staged.entered.promise,
        delayed.then(() => { throw Error("Registered cancellation skipped incoming cleanup"); }),
        delay(3000).then(() => { throw Error("Incoming cleanup did not begin"); }),
      ]);
      assert.equal(await api.cancel(a, stranded), "registered");
      assert.equal(fixture.objects.get(stagingPath).bytes, undefined);
    } finally { staged.release.resolve(); }
    assert.equal(await delayed, "registered");
    assert.equal(await api.cancel(a, stranded), "registered");
    assert.deepEqual(fixture.deletions.slice(beforeRetries), [stagingPath, stagingPath]);
    assert.deepEqual(fixture.objects.get(finalPath).bytes, png);
    assert.equal(fixture.objects.get(finalPath).sealed, false);
    await assert.rejects(api.complete(a, stranded), failure("CLOSED"));
    assert.deepEqual((await admin.query(`SELECT x.status,x.revision,s.current_receipt_id
      FROM dream.asset_receipt_state s JOIN dream.storage_outbox x ON (x.owner_id,x.object_id)=(s.owner_id,s.object_id)
      WHERE s.asset_id=$1 AND x.kind='reconcile'`, [strandedIds.assetId])).rows[0],
    { status: "done", revision: "1", current_receipt_id: retained.current_receipt_id });
    console.log("T367-F1 declined old evidence, retried overlapped incoming-only cleanup and kept final bytes");

    const bad = Buffer.from("bad real bytes, valid expected hash");
    const badId = v7();
    await api.reserve(a, badId, { size: bad.length, sha256: sha(bad) });
    await api.receive(a, badId, bad);
    await assert.rejects(api.complete(a, badId), failure("INVALID_IMAGE"));
    assert.equal(await api.cancel(a, badId), "tombstoned");

    const rival = v7();
    await api.reserve(a, rival, expected);
    await api.receive(a, rival, png);
    const gate = fixture.hold("/t367-private/");
    const completing = api.complete(a, rival);
    void completing.catch(() => {});
    try {
      const key = await Promise.race([gate.entered.promise, delay(3000).then(() => { throw Error("final PUT did not begin"); })]);
      const purging = fixture.watchPurge("/t367-private/");
      const cancelling = api.cancel(a, rival);
      void cancelling.catch(() => {});
      await Promise.race([purging, cancelling.then(() => { throw Error("cleanup completed before the writer drained"); }),
        delay(3000).then(() => { throw Error("purge did not begin"); })]);
      const pending = (await admin.query(`SELECT o.lifecycle FROM dream.storage_objects o JOIN dream.upload_intents i ON i.object_id=o.id
        WHERE i.request_id=$1`, [rival])).rows[0];
      assert.equal(pending.lifecycle, "cleanup_claimed");
      assert.equal(fixture.objects.get(key).sealed, true);
      gate.release.resolve();
      await assert.rejects(completing, error => ["CLOSED","UNAVAILABLE"].includes(error.code));
      assert.equal(await cancelling, "tombstoned");
      assert.equal(fixture.objects.get(key).bytes, undefined);
      const status = await fetch("http://127.0.0.1:" + fixture.server.address().port + key, { method: "PUT", body: Uint8Array.from(png) });
      assert.equal(status.status, 409);
      await status.body?.cancel();
    } finally { gate.release.resolve(); }
    await assert.rejects(api.complete(a, rival), failure("CLOSED"));
    const stale = v7();
    await api.reserve(a, stale, expected);
    await api.receive(a, stale, png);
    const rotation = fixture.hold("/t367-private/");
    const cutOff = api.complete(a, stale);
    void cutOff.catch(() => {});
    try {
      await Promise.race([rotation.entered.promise, delay(3000).then(() => { throw Error("final PUT did not begin"); })]);
      await openPolicy(3);
      rotation.release.resolve();
      await assert.rejects(cutOff, failure("CLOSED"));
    } finally { rotation.release.resolve(); }
    assert.equal(await api.cancel(a, stale), "tombstoned");
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM dream.assets")).rows[0].count, 2);
    assert.deepEqual(fixture.errors, []);
    assert.ok(fixture.changed() >= 5);
    console.log("T367 PG17 A/B reserve and replay, real PNG, current SQL4 evidence, late publication and cleanup passed");

    await admin.query(remove);
    await assert.rejects(admin.query(remove), /T367_OWNED_TARGET_OR_CONFLICT/);
    await admin.query("ROLLBACK");
    assert.deepEqual(await snapshot(), before);
    assert.equal((await admin.query("SELECT revision FROM dream.storage_objects WHERE id=$1", [oldObject])).rows[0].revision, "0");
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM dream.storage_verification_receipts")).rows[0].count, 2);
    assert.equal((await admin.query("SELECT title FROM dream.projects WHERE id=$1", [baselineProject])).rows[0].title, "existing write after install");
    await updateLegacy("existing write after removal");
    await assert.rejects(api.reserve(a, v7(), expected), failure("UNAVAILABLE"));
    console.log("T367 install abrogation, active-work refusal, SQL4 history/ACL and old writer after removal passed");
  } finally {
    await Promise.all(Object.values(pools).map(pool => pool.end()));
    await fixture.close();
  }
}

// The shared fixture calls back into this module once the owned cluster is running.
// A separate start module avoids a top-level await cycle.
export async function start() {
  try { await import(runner.href); }
  finally { hook.deregister(); }
}
