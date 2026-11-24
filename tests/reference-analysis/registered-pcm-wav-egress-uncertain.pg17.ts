import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ClientRequest } from "node:http";
import type { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";

type Committed = { id: string; owner: string; revision: number };
type Transmission = {
  id: string; body: Buffer; queuedBytes: number;
  start: PromiseWithResolvers<void>; mayQueue: PromiseWithResolvers<void>; queued: PromiseWithResolvers<void>;
  tail: PromiseWithResolvers<void>; recordClose: PromiseWithResolvers<void>; terminal: PromiseWithResolvers<string>;
};
type Reply = { status: number | undefined; body: Buffer; verified: boolean; complete: boolean };
type Listener = { port: number; sockets: Set<Socket>; tasks: Set<Promise<void>>; faults: unknown[]; stop: () => Promise<void> };
type Context = {
  admin: Client; control: Client; inspector: Client; installer: Client; proofReader: Client;
  old: Listener; successor: Listener; requests: Set<ClientRequest>; tls: { cert: string; key: string; fingerprint: string };
  state: () => Promise<string>; status: (job: Transmission) => Promise<{ state: string; events: string[] }>;
  act: (db: Client, action: string, owner?: string, permit?: string) => Promise<string>;
  issue: (commit: Committed) => Promise<Transmission>; retry: (commit: Committed) => Promise<unknown>;
  snapshot: () => Promise<unknown>; before: unknown; committedA: Committed; committedB: Committed;
  closeArgs: [string, string, string, string, number]; closeProof: object; oldId: string;
  connectClient: (port: number, tls: Context["tls"], job: Transmission, requests: Set<ClientRequest>) =>
    { result: Promise<Reply>; firstBytes: Promise<Buffer> };
  checkRefused: (port: number) => Promise<void>;
};

function interrupted(commit: boolean) {
  return {
    commit,
    ready: Promise.withResolvers<{ db: Client; socket: Socket; closed: Promise<void> }>(),
    proceed: Promise.withResolvers<void>(), settled: Promise.withResolvers<void>(),
    deliver: Promise.withResolvers<void>(), error: Promise.withResolvers<Error>(),
    dbErrors: [] as Error[],
  };
}
type Interruption = ReturnType<typeof interrupted>;
const interruptions = new WeakMap<Transmission, Interruption>();

export async function interceptCommit(job: Transmission, db: Client, socket: Socket, closed: Promise<void>) {
  const plan = interruptions.get(job);
  if (!plan) return false;
  db.on("error", error => plan.dbErrors.push(error));
  plan.ready.resolve({ db, socket, closed });
  await plan.proceed.promise;
  if (plan.commit) await db.query("COMMIT");
  plan.settled.resolve();
  await plan.deliver.promise;
  try {
    // The first probe withholds the real success from the sender and loses its connection.
    // The second loses its connection while the first report is still uncommitted.
    await db.query(plan.commit ? "SELECT 1" : "COMMIT");
  } catch (error) {
    assert(error instanceof Error);
    plan.error.resolve(error);
    throw error;
  }
  assert.fail("Expected the owned ledger connection to be gone");
}

async function within<T>(promise: Promise<T>, label: string) {
  const timeout = new AbortController();
  try {
    return await Promise.race([promise, delay(6500, undefined, { signal: timeout.signal }).then(() => {
      throw new Error("Timed out at " + label);
    })]);
  } finally { timeout.abort(); }
}

const emptyReply = { status: 409, body: Buffer.alloc(0), verified: true, complete: true };
const unavailable = { outcome: "unavailable", revision: null, changed: false };

export async function exerciseUncertain(f: Context) {
  const { admin, control, inspector, installer, proofReader, old, successor, requests, tls, state, status,
    act, issue, retry, snapshot, before, closeArgs, closeProof, oldId, connectClient, checkRefused } = f;
  const plans: Interruption[] = [];
  const open = (port: number, job: Transmission) => connectClient(port, tls, job, requests);
  const permitState = async (job: Transmission) => {
    const { state, events } = await status(job);
    return { state, events };
  };
  try {
    const positives = [];
    for (const [didCommit, source] of [[true, f.committedA], [false, f.committedB]] as const) {
      const permit = await issue(source);
      const plan = interrupted(didCommit);
      plans.push(plan);
      interruptions.set(permit, plan);
      const original = open(old.port, permit);
      permit.start.resolve();
      permit.mayQueue.resolve();
      const upstream = await within(plan.ready.promise, "first report before COMMIT");
      const prefix = await within(original.firstBytes, "actual first protected TLS bytes");
      assert.equal(prefix.length, Math.ceil(permit.body.length / 2));
      assert.deepEqual(prefix, permit.body.subarray(0, permit.queuedBytes));
      assert.equal((await status(permit)).state, "starting");
      const { rows: [backend] } = await upstream.db.query("SELECT pg_backend_pid() AS id");
      plan.proceed.resolve();
      await within(plan.settled.promise, didCommit ? "server committed before acknowledgement loss" : "uncommitted first report");
      assert.equal((await status(permit)).state, didCommit ? "sending" : "starting");
      const { rows: [terminated] } = await admin.query(`SELECT pg_terminate_backend(pid,3000) AS stopped FROM pg_stat_activity
        WHERE pid=$1 AND datname='dream_test_t319' AND usename='pcm_tls_old' AND application_name='pcm-egress-fixture'`, [backend.id]);
      assert.equal(terminated?.stopped, true);
      assert(!upstream.socket.destroyed);
      const previous = await permitState(permit);
      assert.deepEqual(previous.events, didCommit ? ["prepared", "starting", "sending"] : ["prepared", "starting"]);
      assert.deepEqual(await within(open(old.port, permit).result, "same permit replay while active"), emptyReply);
      assert.deepEqual(await permitState(permit), previous);
      assert.deepEqual(await retry(source), { outcome: "issued", revision: source.revision, changed: false });
      assert.deepEqual(await snapshot(), before);

      // The fixed candidate can mint a new permit for the same business result before drain.
      const fresh = await issue(source);
      assert.notEqual(fresh.id, permit.id);
      const duplicate = open(old.port, fresh);
      fresh.start.resolve();
      fresh.mayQueue.resolve();
      await within(fresh.queued.promise, "fresh permit for the same committed request started");
      fresh.tail.resolve();
      fresh.recordClose.resolve();
      assert.deepEqual(await within(duplicate.result, "same logical request returned with a fresh permit"),
        { status: 200, body: permit.body, verified: true, complete: true });
      assert.equal(await within(fresh.terminal.promise, "fresh permit terminal"), "finished");
      assert.deepEqual(await snapshot(), before);
      positives.push({ source, permit, fresh, plan, original, prefix, upstream, previous });
    }
    console.log("PCM uncertain first write: committed first report versus rolled-back report; same permit zero, fresh permit for same issuance sends");

    await control.query("BEGIN");
    try {
      assert.equal(await act(control, "drain"), "draining");
      assert.equal((await control.query("UPDATE pcm_closing SET state='draining' WHERE singleton AND state='active'")).rowCount, 1);
      await control.query("COMMIT");
    } catch (error) { await control.query("ROLLBACK"); throw error; }
    const { rows: [fenced] } = await installer.query("SELECT pcm_issuance.fence_writes($1,$2,$3,$4,$5) AS value", closeArgs);
    assert.equal(fenced.value, "fenced");
    assert.deepEqual((await proofReader.query("SELECT * FROM pcm_issuance.fence_proof()")).rows[0], closeProof);
    assert.equal(await state(), "draining");
    assert.equal(await act(control, "activate"), "waiting_for_isolation");
    assert(old.sockets.size >= positives.length);
    assert(positives.every(({ upstream }) => !upstream.socket.destroyed));
    for (const { source, original, permit, plan, prefix, upstream, previous } of positives) {
      assert.deepEqual(await within(open(old.port, permit).result, "draining permit replay"), emptyReply);
      assert.equal(await act(control, "issue", source.owner, randomUUID()), "draining");
      plan.deliver.resolve();
      const error = await within(plan.error.promise, "sender observed lost database connection");
      assert.match(error.message, /connection|terminated|queryable/i);
      assert(plan.dbErrors.length > 0);
      await within(upstream.closed, "old sender observed real HTTPS socket close");
      assert.equal(upstream.socket.writableLength, 0);
      assert.deepEqual(await within(original.result, "client observed response abort"), {
        status: 200, body: prefix, verified: true, complete: false,
      });
      assert.deepEqual(await permitState(permit), previous);
      assert.equal(await act(control, "activate"), "waiting_for_isolation");
      assert.equal(await state(), "draining");
    }
    await within(Promise.all([...old.tasks]), "sender jobs ended");
    assert.equal(old.sockets.size, 0);
    assert.equal(old.tasks.size, 0);
    assert.equal(old.faults.length, 2);
    for (const error of old.faults) {
      assert(error instanceof Error);
      assert.match(error.message, /connection|terminated|queryable/i);
    }
    old.faults.length = 0; // The pinned teardown continues to detect unexpected faults.
    await within(old.stop(), "old sender listener stopped");
    await checkRefused(old.port);
    assert.equal(await act(control, "activate"), "waiting_for_isolation");
    assert.equal(await state(), "draining");

    await control.query("BEGIN");
    try {
      assert.deepEqual((await proofReader.query("SELECT * FROM pcm_issuance.fence_proof()")).rows[0], closeProof);
      const { rows: [isolated] } = await control.query(
        "SELECT rea_t319.terminate('isolated',1,$1,$2,NULL) AS value", [oldId, process.pid]);
      assert.equal(isolated.value, "isolated");
      assert.equal(await act(control, "activate"), "activated");
      assert.equal((await control.query(`UPDATE pcm_closing SET state='closed' WHERE singleton AND state='draining' AND transition=$1
        AND NOT EXISTS(SELECT 1 FROM rea_t319.permit WHERE generation=1 AND state IN ('prepared','starting','sending'))`,
      [closeArgs[0]])).rowCount, 1);
      await control.query("COMMIT");
    } catch (error) { await control.query("ROLLBACK"); throw error; }
    assert.equal(await state(), "closed");
    for (const { source, permit, fresh, previous } of positives) {
      assert.deepEqual(await permitState(permit), { state: "isolated", events: [...previous.events, "isolated"] });
      assert.deepEqual(await within(open(successor.port, permit).result, "original permit after final close"), emptyReply);
      assert.deepEqual(await within(open(successor.port, fresh).result, "replacement permit after final close"), emptyReply);
      assert.deepEqual(await retry(source), unavailable);
    }
    assert.equal((await inspector.query("SELECT count(*)::integer AS count FROM rea_t319.permit WHERE generation=1 AND state IN ('starting','sending')")).rows[0].count, 0);
    assert.deepEqual(await snapshot(), before);
    assert.equal(requests.size, 0);
    console.log("PCM uncertain first write: actual socket close and isolation were required before final close; all old replays zero afterwards and issuance rows unchanged");
  } finally {
    for (const plan of plans) {
      plan.proceed.resolve();
      plan.deliver.resolve();
    }
  }
}
