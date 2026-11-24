import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, rmdir } from "node:fs/promises";
import type { ClientRequest, ServerResponse } from "node:http";
import { createServer, request } from "node:https";
import { connect as connectSocket, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TLSSocket } from "node:tls";
import { promisify } from "node:util";
import { Client, type QueryResultRow } from "pg";
import { v7 } from "uuid";
import { verify as verifyIssuance } from "./registered-pcm-wav-issuance.pg17";

type Fixture = Parameters<typeof verifyIssuance>[0];
type Committed = { id: string; owner: string; project: string; asset: string; proof: object; previous: number; revision: number };
type Binding = { database: string; oid: string; generation: string; work: number };
type Tls = { cert: string; key: string; fingerprint: string };
const host = "127.0.0.1";
const egressDb = "dream_test_t319";
const stepSql = "SELECT rea_t320.send_step($1,$2,$3,$4) AS value";
const controlSql = "SELECT rea_t320.control_action($1,$2,$3,$4,$5) AS value";
const retrySql = "SELECT * FROM pcm_issuance.data_request($1,$2,$3,'issue',$4,$5,$6,$7,false)";
const readSql = "SELECT * FROM pcm_issuance.fence_proof()";
const unavailable = { outcome: "unavailable", revision: null, changed: false };
const exec = promisify(execFile);

async function first<T extends QueryResultRow = QueryResultRow>(client: Client, sql: string, values: unknown[] = []) {
  return (await client.query<T>(sql, values)).rows[0];
}
const value = async (client: Client, sql: string, values: unknown[] = []) => (await first(client, sql, values)).value;
const pid = (client: Client) => value(client, "SELECT pg_backend_pid() AS value");
async function within<T>(promise: Promise<T>, label: string) {
  const timeout = new AbortController();
  try {
    return await Promise.race([promise, delay(6500, undefined, { signal: timeout.signal }).then(() => {
      throw new Error("Timed out at " + label);
    })]);
  } finally {
    timeout.abort();
  }
}
async function certificate(root: string): Promise<Tls> {
  assert(process.env.ProgramFiles);
  const key = join(root, "key.pem");
  const cert = join(root, "cert.pem");
  await exec(join(process.env.ProgramFiles, "Git", "usr", "bin", "openssl.exe"),
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=PCM test",
      "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert], { windowsHide: true, timeout: 10_000 });
  const pem = await readFile(cert, "utf8");
  return { cert: pem, key: await readFile(key, "utf8"), fingerprint: new X509Certificate(pem).fingerprint256 };
}
function empty(res: ServerResponse, code: number) {
  res.writeHead(code, { "Connection": "close", "Content-Length": 0, "Cache-Control": "private, no-store" });
  res.end();
}
function transmission(commit: Committed) {
  return {
    id: v7(), owner: commit.owner, body: Buffer.from(JSON.stringify({ outcome: "issued", revision: commit.revision })),
    entered: Promise.withResolvers<void>(), start: Promise.withResolvers<void>(),
    mayQueue: Promise.withResolvers<void>(), locked: Promise.withResolvers<number>(),
    queued: Promise.withResolvers<void>(), tail: Promise.withResolvers<void>(),
    socketClosed: Promise.withResolvers<void>(), recordClose: Promise.withResolvers<void>(),
    terminal: Promise.withResolvers<string>(), queuedBytes: 0,
  };
}
type Transmission = ReturnType<typeof transmission>;

async function sender(tls: Tls, jobs: Map<string, Transmission>, connect: () => Promise<Client>) {
  const sockets = new Set<Socket>();
  const tasks = new Set<Promise<void>>();
  const faults: unknown[] = [];
  const listener = createServer({ key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" }, (req, res) => {
    const job = jobs.get(String(req.headers["x-fixture-permit"]));
    if (!(req.socket instanceof TLSSocket) || req.socket.remoteAddress !== host || req.socket.localAddress !== host ||
        req.method !== "POST" || req.url !== "/protected" || !job || req.headers["x-fixture-owner"] !== job.owner) {
      empty(res, 404);
      return;
    }
    req.resume();
    const socket = req.socket;
    const closed = Promise.withResolvers<void>();
    socket.once("close", () => closed.resolve());
    const task = (async () => {
      const db = await connect();
      const channel = v7();
      const step = (action: string) => value(db, stepSql, [action, job.id, job.owner, channel]);
      try {
        const entry = await step("consume");
        if (entry !== "starting") { empty(res, 409); return; }
        job.entered.resolve();
        await job.start.promise;
        let sent = false;
        let finished = false;
        res.once("finish", () => { finished = true; });
        await db.query("BEGIN");
        try {
          if (await step("before_write") === "ready" && !res.destroyed) {
            job.locked.resolve(await pid(db));
            await job.mayQueue.promise;
            if (!res.destroyed) {
              const half = Math.ceil(job.body.length / 2);
              const prefix = job.body.subarray(0, half);
              // Keep the T320 gate row locked across the actual first queue insertion.
              res.writeHead(200, { "Connection": "close", "Content-Length": job.body.length,
                "Cache-Control": "private, no-store", "Content-Type": "application/json" });
              res.write(prefix);
              job.queuedBytes += prefix.length;
              assert.equal(await step("first_report"), "sending");
              sent = true;
            }
          }
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        }
        if (sent) {
          job.queued.resolve();
          await Promise.race([job.tail.promise, closed.promise]);
          if (!res.destroyed && !socket.destroyed) {
            const tail = job.body.subarray(job.queuedBytes);
            res.end(tail);
            job.queuedBytes += tail.length;
          }
        } else if (!res.destroyed) {
          empty(res, 409);
        }
        await closed.promise;
        assert.equal(socket.writableLength, 0);
        job.socketClosed.resolve();
        await job.recordClose.promise;
        job.terminal.resolve(await step(sent && finished ? "closed_complete" : "closed_aborted"));
      } finally {
        await db.end();
      }
    })().catch(error => { faults.push(error); res.destroy(); });
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  });
  listener.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen({ host, port: 0 }, resolve);
  });
  const address = listener.address();
  assert(address && typeof address !== "string" && address.address === host);
  let stopped: Promise<void> | undefined;
  function stop() {
    stopped ??= new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    return stopped;
  }
  return { port: address.port, sockets, tasks, faults, stop };
}

function client(port: number, tls: Tls, job: Transmission, requests: Set<ClientRequest>) {
  const result = Promise.withResolvers<{ status: number | undefined; body: Buffer; verified: boolean; complete: boolean }>();
  const firstBytes = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  let status: number | undefined;
  let verified = false;
  let complete = false;
  let received = 0;
  const prefixLength = Math.ceil(job.body.length / 2);
  const req = request({ host, port, path: "/protected", method: "POST", ca: tls.cert, rejectUnauthorized: true, agent: false,
    headers: { "x-fixture-permit": job.id, "x-fixture-owner": job.owner } }, res => {
    status = res.statusCode;
    res.on("data", (bytes: Buffer) => {
      chunks.push(bytes);
      received += bytes.length;
      if (received >= prefixLength) firstBytes.resolve(Buffer.concat(chunks).subarray(0, prefixLength));
    });
    res.once("end", () => { complete = res.complete; });
    res.on("error", () => {});
  });
  requests.add(req);
  req.once("socket", socket => socket.once("secureConnect", () => {
    if (socket instanceof TLSSocket) verified = socket.authorized && socket.getPeerCertificate().fingerprint256 === tls.fingerprint;
  }));
  req.on("error", () => {});
  req.once("close", () => {
    requests.delete(req);
    result.resolve({ status, body: Buffer.concat(chunks), verified, complete });
  });
  req.end();
  return { result: result.promise, firstBytes: firstBytes.promise, abort: () => req.destroy() };
}

async function portRefused(port: number) {
  await assert.rejects(within(new Promise<void>((resolve, reject) => {
    const socket = connectSocket({ host, port });
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  }), "owned TLS port refused"), { code: "ECONNREFUSED" });
}

async function waitForDrainLock(admin: Client, waiter: number, holder: number) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await value(admin, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND query LIKE
      'SELECT rea_t320.control_action%' AND wait_event_type='Lock' AND $2::integer=ANY(pg_blocking_pids(pid))) AS value`,
    [waiter, holder])) return;
    await delay(20);
  }
  assert.fail("Expected drain to wait while the current sender holds the first-write lock");
}

export async function verify(fixture: Fixture) {
  await verifyIssuance(fixture);
  const { cfg, admin, a, b } = fixture;
  const adminUser = admin.user;
  assert(adminUser);
  assert.equal(cfg.host, host);
  assert.equal(cfg.database, "dream_test_t367");
  await admin.query(await readFile(new URL("registered-pcm-wav-write-fence.fixture.sql", import.meta.url), "utf8"));
  await admin.query("CREATE ROLE t319_bootstrap NOLOGIN SUPERUSER");
  await admin.query("CREATE DATABASE dream_test_t319 OWNER t319_bootstrap TEMPLATE template0");
  await admin.query("REVOKE CONNECT ON DATABASE dream_test_t319 FROM PUBLIC");
  const root = await mkdtemp(join(await realpath(tmpdir()), "dream-pcm-egress-"));
  const clients = new Set<Client>();
  const requests = new Set<ClientRequest>();
  const listeners: Awaited<ReturnType<typeof sender>>[] = [];
  const jobs = new Map<string, Transmission>();
  const pending: Promise<unknown>[] = [];
  async function connect(database: string, user: string, persistent = true) {
    const db = new Client({ ...cfg, database, user, application_name: "pcm-egress-fixture",
      statement_timeout: 10_000, connectionTimeoutMillis: 1500 });
    if (persistent) clients.add(db);
    await db.connect();
    return db;
  }

  try {
    const { quoted } = await first(admin, "SELECT quote_literal($1::text) AS quoted", [cfg.password]);
    for (const login of ["pcm_tls_old", "pcm_tls_next", "pcm_tls_fence", "pcm_tls_proof"]) {
      await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${quoted}`);
    }
    await admin.query(`GRANT CONNECT ON DATABASE dream_test_t319 TO pcm_tls_old,pcm_tls_next;
      GRANT pcm_fence_installer TO pcm_tls_fence WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
      GRANT pcm_fence_observer TO pcm_tls_proof WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    const [control, drainDb, inspector, installer, proofReader, issuer] = await Promise.all([
      connect(egressDb, adminUser), connect(egressDb, adminUser), connect(egressDb, adminUser),
      connect(cfg.database, "pcm_tls_fence"), connect(cfg.database, "pcm_tls_proof"),
      connect(cfg.database, "pcm_issuance_issuer_login"),
    ]);
    await control.query("SET ROLE t319_bootstrap; SET rea_t319.synthetic='on'; SET rea_t320.synthetic='on'");
    for (const sql of ["t319-egress-durable-control.sql", "t320-https-durable-egress.sql"]) {
      await control.query(await readFile(new URL(sql, import.meta.url), "utf8"));
    }
    await control.query(`RESET ROLE;
      GRANT USAGE ON SCHEMA rea_t320 TO pcm_tls_old,pcm_tls_next;
      GRANT EXECUTE ON FUNCTION rea_t320.send_step(text,uuid,uuid,uuid) TO pcm_tls_old,pcm_tls_next`);
    await installer.query("SET ROLE pcm_fence_installer");
    await proofReader.query("SET ROLE pcm_fence_observer");
    const tls = await certificate(root);
    const old = await sender(tls, jobs, () => connect(egressDb, "pcm_tls_old", false));
    listeners.push(old);
    const successor = await sender(tls, jobs, () => connect(egressDb, "pcm_tls_next", false));
    listeners.push(successor);
    const oldId = v7();
    const nextId = v7();
    const transition = v7();
    await control.query("INSERT INTO rea_t319.sender(boot_id,process_id) VALUES($1,$3),($2,$3)", [oldId, nextId, process.pid]);
    await control.query("INSERT INTO rea_t320.sender_login VALUES($1,'pcm_tls_old'),($2,'pcm_tls_next')", [oldId, nextId]);
    await control.query("INSERT INTO rea_t319.gate VALUES(true,1,$1,NULL)", [oldId]);
    await control.query("INSERT INTO rea_t320.actor(id) VALUES($1),($2)", [a.id, b.id]);
    const epoch = await value(control, controlSql, ["boot", null, null, null, null]);
    const act = (db: Client, action: string, owner: string | null = null, permit: string | null = null) =>
      value(db, controlSql, [action, epoch, owner, permit, nextId]);
    const binding = await first<Binding>(admin, `SELECT current_database() AS database,d.oid::text AS oid,
      c.restore_gen AS generation,c.work_number AS work FROM pg_database d CROSS JOIN pcm_issuance.control c
      WHERE d.datname=current_database() AND c.singleton`);
    await control.query(`CREATE TABLE pcm_closing (singleton boolean PRIMARY KEY CHECK(singleton),
      transition uuid NOT NULL, db_name text NOT NULL, db_oid text NOT NULL, generation text NOT NULL, work integer NOT NULL,
      state text NOT NULL CHECK(state IN ('active','draining','closed')))`);
    await control.query("INSERT INTO pcm_closing VALUES(true,$1,$2,$3,$4,$5,'active')",
      [transition, binding.database, binding.oid, binding.generation, binding.work]);
    const state = () => value(inspector, "SELECT state AS value FROM pcm_closing WHERE singleton");
    const status = (job: Transmission) => value(inspector, "SELECT rea_t319.status($1) AS value", [job.id]);
    const commitFor = (owner: string) => first<Committed>(admin, `SELECT r.request_id AS id,p.owner_id AS owner,p.project_id AS project,
        p.asset_id AS asset,p.proof,p.revision,(r.fingerprint->>'revision')::integer AS previous
      FROM pcm_issuance.pointer p JOIN pcm_issuance.requests r USING(restore_gen,owner_id)
      WHERE p.restore_gen=$1 AND p.owner_id=$2 AND p.state='issued' AND r.state='issued'
        AND r.result_revision=p.revision AND r.fingerprint->>'asset'=p.asset_id::text`, [binding.generation, owner]);
    const snapshot = () => first(admin, `SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY owner_id,project_id,asset_id) FROM pcm_issuance.pointer p WHERE restore_gen=$1) AS pointers,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM pcm_issuance.requests r WHERE restore_gen=$1) AS requests`, [binding.generation]);
    const retry = async (commit: Committed) => {
      await issuer.query("BEGIN; SET LOCAL ROLE pcm_issuance_issuer");
      try {
        await issuer.query("SELECT set_config('dream.actor_id',$1,true)", [commit.owner]);
        const result = await first(issuer, retrySql, [binding.generation, binding.work, commit.id, commit.project,
          commit.asset, commit.proof, commit.previous]);
        await issuer.query("COMMIT");
        return result;
      } catch (error) { await issuer.query("ROLLBACK"); throw error; }
    };
    const committedA = await commitFor(a.id);
    const committedB = await commitFor(b.id);
    const before = await snapshot();
    async function issue(commit: Committed) {
      const job = transmission(commit);
      assert.equal(await act(control, "issue", job.owner, job.id), "issued");
      jobs.set(job.id, job);
      return job;
    }
    const heldProducer = await issue(committedA);
    const heldTls = await issue(committedA);
    const complete = await issue(committedA);
    const lost = await issue(committedB);
    const heldClient = client(old.port, tls, heldTls, requests);
    await within(heldTls.entered.promise, "old TLS before first write");
    const lostClient = client(old.port, tls, lost, requests);
    lost.start.resolve();
    lost.mayQueue.resolve();
    await within(lost.queued.promise, "lost response started");
    const lostPrefix = await within(lostClient.firstBytes, "client received protected prefix");
    assert.deepEqual(lostPrefix, lost.body.subarray(0, lost.queuedBytes));
    lostClient.abort();
    const lostReply = await within(lostClient.result, "client closed an incomplete reply");
    assert(lostReply.verified && !lostReply.complete && lostReply.status === 200);
    assert.deepEqual(lostReply.body, lostPrefix);
    await within(lost.socketClosed.promise, "sender observed lost socket close");
    assert.equal((await status(lost)).state, "sending");
    assert.deepEqual(await retry(committedB), { outcome: "issued", revision: committedB.revision, changed: false });
    assert.deepEqual(await snapshot(), before);

    const finishClient = client(old.port, tls, complete, requests);
    complete.start.resolve();
    const holder = await within(complete.locked.promise, "gate lock before first protected byte");
    const drainPid = await pid(drainDb);
    const draining = (async () => {
      await drainDb.query("BEGIN");
      try {
        assert.equal(await act(drainDb, "drain"), "draining");
        assert.equal((await drainDb.query("UPDATE pcm_closing SET state='draining' WHERE singleton AND state='active'")).rowCount, 1);
        await drainDb.query("COMMIT");
      } catch (error) { await drainDb.query("ROLLBACK"); throw error; }
    })();
    pending.push(draining);
    void draining.catch(() => {});
    await waitForDrainLock(admin, drainPid, holder);
    assert.equal(complete.queuedBytes, 0);
    assert.equal(await state(), "active");
    complete.mayQueue.resolve();
    await within(complete.queued.promise, "sending recorded");
    assert.deepEqual(await within(finishClient.firstBytes, "client received first protected bytes"),
      complete.body.subarray(0, complete.queuedBytes));
    await draining;
    assert.equal(await state(), "draining");
    assert.equal(await act(control, "issue", a.id, v7()), "draining");
    assert.equal((await status(heldProducer)).state, "cancelled");

    const args = [transition, binding.database, binding.oid, binding.generation, binding.work];
    assert.equal(await value(installer, "SELECT pcm_issuance.fence_writes($1,$2,$3,$4,$5) AS value", args), "fenced");
    const closeProof = { ...binding, transition };
    assert.deepEqual(await first(proofReader, readSql), closeProof);
    const clearToClose = async () => !(await value(inspector, `SELECT EXISTS(SELECT 1 FROM rea_t319.permit
      WHERE generation=1 AND state IN ('prepared','starting','sending')) AS value`)) &&
      old.sockets.size === 0 && old.tasks.size === 0;
    assert.equal(await clearToClose(), false);
    assert.equal(await act(control, "activate"), "waiting_for_isolation");
    assert.equal(await state(), "draining");

    heldTls.start.resolve();
    const heldReply = await within(heldClient.result, "drain before TLS first write");
    assert.deepEqual(heldReply, { status: 409, body: Buffer.alloc(0), verified: true, complete: true });
    assert.equal(heldTls.queuedBytes, 0);
    await within(heldTls.socketClosed.promise, "zero-byte socket closed");
    heldTls.recordClose.resolve();
    assert.equal(await within(heldTls.terminal.promise, "zero-byte terminal evidence"), "cancelled");
    complete.tail.resolve();
    assert.deepEqual(await within(finishClient.result, "first sender drained the remainder"),
      { status: 200, body: complete.body, verified: true, complete: true });
    await within(complete.socketClosed.promise, "full response socket closed");
    assert.equal(await clearToClose(), false);
    assert.equal(await state(), "draining");
    assert.equal((await status(complete)).state, "sending");
    assert.equal((await status(lost)).state, "sending");
    complete.recordClose.resolve();
    assert.equal(await within(complete.terminal.promise, "full terminal evidence"), "finished");
    assert.equal(await clearToClose(), false);
    lost.recordClose.resolve();
    assert.equal(await within(lost.terminal.promise, "aborted terminal evidence"), "cancelled");
    await within(Promise.all([...old.tasks]), "old sender jobs finished");
    assert.equal(await clearToClose(), true);
    assert.equal(await act(control, "activate"), "waiting_for_isolation");
    await within(old.stop(), "owned old listener stopped");
    await portRefused(old.port);

    await control.query("BEGIN");
    try {
      assert.deepEqual(await first(proofReader, readSql), closeProof);
      assert.equal(await clearToClose(), true);
      assert.equal(await value(control, "SELECT rea_t319.terminate('isolated',1,$1,$2,NULL) AS value", [oldId, process.pid]), "isolated");
      assert.equal(await act(control, "activate"), "activated");
      assert.equal((await control.query(`UPDATE pcm_closing SET state='closed' WHERE singleton AND transition=$1
        AND state='draining' AND NOT EXISTS(SELECT 1 FROM rea_t319.permit WHERE generation=1 AND state IN ('prepared','starting','sending'))`,
      [transition])).rowCount, 1);
      await control.query("COMMIT");
    } catch (error) { await control.query("ROLLBACK"); throw error; }
    assert.equal(await state(), "closed");
    for (const job of [heldProducer, complete, lost]) {
      assert.deepEqual(await within(client(successor.port, tls, job, requests).result, "closed generation HTTPS replay"),
        { status: 409, body: Buffer.alloc(0), verified: true, complete: true });
    }
    assert.equal(heldProducer.queuedBytes, 0);
    assert.equal(heldTls.queuedBytes, 0);
    assert.deepEqual((await status(heldProducer)).events, ["prepared", "cancelled"]);
    assert.deepEqual((await status(heldTls)).events, ["prepared", "starting", "cancelled"]);
    assert.deepEqual((await status(complete)).events, ["prepared", "starting", "sending", "finished"]);
    assert.deepEqual((await status(lost)).events, ["prepared", "starting", "sending", "cancelled"]);
    assert.deepEqual(await retry(committedB), unavailable);
    assert.deepEqual(await snapshot(), before);
    assert.equal(requests.size, 0);
    console.log("Owned PCM HTTPS: close-first zero body, first write serialized, drained or aborted sockets terminal before final close, ledger unchanged");
  } finally {
    for (const job of jobs.values()) {
      job.start.resolve(); job.mayQueue.resolve(); job.tail.resolve(); job.recordClose.resolve();
    }
    for (const req of requests) req.destroy();
    for (const listener of listeners) {
      for (const socket of listener.sockets) socket.destroy();
      await listener.stop();
      await Promise.allSettled([...listener.tasks]);
    }
    await Promise.allSettled(pending);
    await Promise.allSettled(Array.from(clients, connection => connection.end()));
    await rm(join(root, "key.pem"), { force: true });
    await rm(join(root, "cert.pem"), { force: true });
    await rmdir(root);
  }
  for (const listener of listeners) {
    assert.deepEqual(listener.faults, []);
    assert.equal(listener.sockets.size, 0);
    assert.equal(listener.tasks.size, 0);
    await portRefused(listener.port);
  }
  assert.equal(await value(admin, `SELECT count(*)::integer AS value FROM pg_stat_activity
    WHERE application_name='pcm-egress-fixture'`), 0);
}
