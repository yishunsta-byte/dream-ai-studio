import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ClientRequest } from "node:http";
import type { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";

type Committed = { id: string; owner: string; project: string; asset: string; proof: object; previous: number; revision: number };
type Transmission = {
  id: string; body: Buffer; queuedBytes: number;
  start: PromiseWithResolvers<void>; mayQueue: PromiseWithResolvers<void>; queued: PromiseWithResolvers<void>;
  tail: PromiseWithResolvers<void>; recordClose: PromiseWithResolvers<void>; terminal: PromiseWithResolvers<string>;
};
type Listener = { port: number; sockets: Set<Socket>; tasks: Set<Promise<void>>; faults: unknown[]; stop: () => Promise<void> };
type Interrupt = {
  ready: PromiseWithResolvers<{ db: Client; socket: Socket; closed: Promise<void> }>;
  proceed: PromiseWithResolvers<void>; settled: PromiseWithResolvers<void>; deliver: PromiseWithResolvers<void>;
  error: PromiseWithResolvers<Error>; dbErrors: Error[];
};
type Context = {
  admin: Client; control: Client; inspector: Client; installer: Client; proofReader: Client; issuer: Client;
  old: Listener; successor: Listener; requests: Set<ClientRequest>; tls: { cert: string; key: string; fingerprint: string };
  state: () => Promise<string>; status: (job: Transmission) => Promise<{ state: string; events: string[] }>;
  act: (db: Client, action: string) => Promise<string>; retry: (commit: Committed) => Promise<unknown>;
  snapshot: () => Promise<unknown>; committedA: Committed; committedB: Committed;
  binding: { database: string; oid: string; generation: string; work: number };
  closeProof: Context["binding"] & { transition: string }; oldId: string; jobs: Map<string, Transmission>; epoch: string; password: string;
  transmission: (commit: Committed) => Transmission; checkRefused: (port: number) => Promise<void>;
  connect: (database: string, user: string) => Promise<Client>;
  openClient: (port: number, tls: Context["tls"], job: Transmission, requests: Set<ClientRequest>) =>
    { result: Promise<{ status: number | undefined; body: Buffer; verified: boolean; complete: boolean }>; firstBytes: Promise<Buffer> };
};

const emptyReply = { status: 409, body: Buffer.alloc(0), verified: true, complete: true };
const unavailable = { outcome: "unavailable", revision: null, changed: false };
const reserved = { outcome: "reserved", revision: null, changed: false };
const issueSql = "SELECT rea_t320.pcm_issue($1,$2,$3,$4,$5,$6,$7,$8) AS value";
export const digestBody = (body: Buffer) => createHash("sha256").update(body).digest("hex");

async function within<T>(promise: Promise<T>, label: string) {
  const timeout = new AbortController();
  try {
    return await Promise.race([promise, delay(6500, undefined, { signal: timeout.signal }).then(() => {
      throw new Error("Timed out at " + label);
    })]);
  } finally { timeout.abort(); }
}

async function nextCommit(f: Context, previous: Committed): Promise<Committed> {
  const { admin, issuer, binding } = f;
  const { owner, project, asset } = previous;
  await admin.query("BEGIN");
  let proof: object;
  try {
    await admin.query("SELECT pcm_issuance.scope_lock($1,$2,$3)", [owner, project, asset]);
    assert.equal((await admin.query(`UPDATE pcm_fixture.registrations SET generation=generation+1
      WHERE (owner_id,asset_id)=($1,$2)`, [owner, asset])).rowCount, 1);
    const current = await admin.query(`UPDATE pcm_fixture.approvals g SET
      generation=g.generation+1,registration_generation=r.generation FROM pcm_fixture.registrations r
      WHERE (g.owner_id,g.project_id,g.asset_id)=($1,$2,$3) AND g.active AND (r.owner_id,r.asset_id)=(g.owner_id,g.asset_id)
      RETURNING jsonb_build_object('registrationGeneration',r.generation,'approvalGeneration',g.generation,
        'sha256',r.sha256,'sizeBytes',r.size_bytes) AS proof`, [owner, project, asset]);
    assert.equal(current.rowCount, 1);
    proof = current.rows[0].proof;
    await admin.query("COMMIT");
  } catch (error) { await admin.query("ROLLBACK"); throw error; }
  const id = randomUUID();
  const revision = previous.revision + 1;
  for (const reserve of [true, false]) {
    await issuer.query("BEGIN; SET LOCAL ROLE pcm_issuance_issuer");
    try {
      await issuer.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
      const { rows: [outcome] } = await issuer.query("SELECT * FROM pcm_issuance.data_request($1,$2,$3,'issue',$4,$5,$6,$7,$8)",
        [binding.generation, binding.work, id, project, asset, proof, previous.revision, reserve]);
      assert.deepEqual(outcome, reserve ? reserved : { outcome: "issued", revision, changed: true });
      await issuer.query("COMMIT");
    } catch (error) { await issuer.query("ROLLBACK"); throw error; }
  }
  return { id, owner, project, asset, proof, previous: previous.revision, revision };
}

export async function exerciseOnce(f: Context) {
  const { admin, control, inspector, installer, proofReader, old, successor, closeProof, status, state, act,
    binding, transmission, snapshot, retry, jobs, epoch, oldId } = f;
  const plans: Interrupt[] = [];
  const { interrupted, interruptions } = await import(new URL("registered-pcm-wav-egress-uncertain.pg17.ts", import.meta.url).href) as
    { interrupted: (commit: boolean) => Interrupt; interruptions: WeakMap<Transmission, Interrupt> };
  const open = (listener: Listener, job: Transmission) => f.openClient(listener.port, f.tls, job, f.requests);
  const store = randomUUID();
  const scope = { store, generation: binding.generation };
  const expected = (source: Committed) => digestBody(transmission(source).body);
  const authority = (source: Committed) => [store, binding.generation, source.owner, source.id, source.revision, expected(source)];
  async function authorize(source: Committed) {
    const { rows } = await admin.query(`SELECT result_revision FROM pcm_issuance.requests
      WHERE restore_gen=$1 AND owner_id=$2 AND request_id=$3 AND state='issued'`, [binding.generation, source.owner, source.id]);
    assert.deepEqual(rows, [{ result_revision: source.revision }]);
    await control.query("INSERT INTO rea_t320.pcm_committed_result VALUES($1,$2,$3,$4,$5,$6,1)", authority(source));
  }
  const permitState = async (job: Transmission) => {
    const { state, events } = await status(job);
    return { state, events };
  };

  try {
    await control.query(await readFile(new URL("registered-pcm-wav-one-shot.fixture.sql", import.meta.url), "utf8"));
    const password = (await admin.query("SELECT quote_literal($1::text) AS quoted", [f.password])).rows[0].quoted;
    await admin.query(`CREATE ROLE pcm_tls_admission LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${password};
      GRANT CONNECT ON DATABASE dream_test_t319 TO pcm_tls_admission`);
    await control.query(`GRANT USAGE ON SCHEMA rea_t320 TO pcm_tls_admission;
      GRANT EXECUTE ON FUNCTION rea_t320.pcm_issue(uuid,text,uuid,uuid,integer,text,uuid,bigint) TO pcm_tls_admission`);
    const [admission, contender, senderLogin] = await Promise.all([
      f.connect("dream_test_t319", "pcm_tls_admission"), f.connect("dream_test_t319", "pcm_tls_admission"),
      f.connect("dream_test_t319", "pcm_tls_old"),
    ]);
    await assert.rejects(admission.query("SELECT rea_t320.control_action('issue',NULL,NULL,NULL,NULL)"), { code: "42501" });
    await assert.rejects(admission.query("SELECT * FROM rea_t320.pcm_send_intent"), { code: "42501" });
    await assert.rejects(senderLogin.query("SELECT rea_t320.send_step('consume',NULL,NULL,NULL)"), { code: "42501" });
    const issue = async (source: Committed, job = transmission(source), db = admission, overrides = {}) => {
      const values = { ...scope, owner: source.owner, request: source.id, revision: source.revision,
        digest: digestBody(job.body), epoch, ...overrides };
      const { rows: [row] } = await db.query(issueSql, [values.store, values.generation, values.owner, values.request,
        values.revision, values.digest, job.id, values.epoch]);
      if (row.value === "issued") jobs.set(job.id, job);
      return row.value as string;
    };
    const full = async (job: Transmission) => {
      const response = open(old, job);
      job.start.resolve(); job.mayQueue.resolve();
      await within(job.queued.promise, "normal TLS send started");
      job.tail.resolve(); job.recordClose.resolve();
      assert.deepEqual(await within(response.result, "complete validated response"),
        { status: 200, body: job.body, verified: true, complete: true });
      assert.equal(await within(job.terminal.promise, "normal send terminal"), "finished");
    };
    const source = f.committedA;
    await authorize(source);
    for (const overrides of [
      { store: randomUUID() }, { generation: "old" }, { owner: f.committedB.owner }, { request: randomUUID() },
      { revision: source.revision + 1 }, { digest: "0".repeat(64) },
    ]) assert.equal(await issue(source, undefined, admission, overrides), "unavailable");
    assert.equal(await issue(source, undefined, admission, { epoch: "0" }), "stale_controller");
    const contenders = [transmission(source), transmission(source)];
    const verdicts = await Promise.all([issue(source, contenders[0]), issue(source, contenders[1], contender)]);
    assert.deepEqual([...verdicts].sort(), ["duplicate_request", "issued"]);
    const winner = contenders[verdicts.indexOf("issued")];
    const correctBody = winner.body;
    winner.body = Buffer.from("incorrect digest");
    assert.deepEqual(await within(open(old, winner).result, "wrong body on valid permit"), emptyReply);
    assert.equal((await status(winner)).state, "prepared");
    winner.body = correctBody;
    await full(winner);
    assert.equal(await issue(source), "duplicate_request");
    assert.deepEqual(await within(open(old, winner).result, "same successful permit"), emptyReply);
    const separate = await nextCommit(f, source);
    assert.notEqual(separate.id, source.id);
    assert.equal(separate.owner, source.owner);
    await authorize(separate);
    const separateJob = transmission(separate);
    assert.equal(await issue(separate, separateJob), "issued");
    await full(separateJob);

    const a = await nextCommit(f, separate);
    const retiredUnsent = f.committedB;
    await authorize(retiredUnsent);
    const b = await nextCommit(f, retiredUnsent);
    await Promise.all([authorize(a), authorize(b)]);
    const issuedState = await snapshot();
    const affected = [];
    for (const [willCommit, current] of [[true, a], [false, b]] as const) {
      const job = transmission(current);
      assert.equal(await issue(current, job), "issued");
      const { rows: [intent] } = await inspector.query(`SELECT request_id,permit_id,revision,digest
        FROM rea_t320.pcm_send_intent WHERE owner_id=$1 AND request_id=$2`, [current.owner, current.id]);
      assert.deepEqual(intent, { request_id: current.id, permit_id: job.id, revision: current.revision, digest: expected(current) });
      assert.deepEqual(await permitState(job), { state: "prepared", events: ["prepared"] });
      const plan = interrupted(willCommit);
      plans.push(plan);
      interruptions.set(job, plan);
      const original = open(old, job);
      job.start.resolve(); job.mayQueue.resolve();
      const upstream = await within(plan.ready.promise, "uncommitted first report after actual enqueue");
      const prefix = await within(original.firstBytes, "verified first protected bytes");
      assert.deepEqual(prefix, job.body.subarray(0, Math.ceil(job.body.length / 2)));
      assert.equal((await status(job)).state, "starting");
      const { rows: [backend] } = await upstream.db.query("SELECT pg_backend_pid() AS id");
      plan.proceed.resolve();
      await within(plan.settled.promise, "configured first report outcome");
      assert.equal((await status(job)).state, willCommit ? "sending" : "starting");
      const { rows: [terminated] } = await admin.query(`SELECT pg_terminate_backend(pid,3000) AS stopped FROM pg_stat_activity
        WHERE pid=$1 AND datname='dream_test_t319' AND usename='pcm_tls_old' AND application_name='pcm-egress-fixture'`, [backend.id]);
      assert.equal(terminated.stopped, true);
      const previous = await permitState(job);
      assert.deepEqual(previous.events, willCommit ? ["prepared", "starting", "sending"] : ["prepared", "starting"]);
      const replacement = transmission(current);
      assert.deepEqual(await retry(current), { outcome: "issued", revision: current.revision, changed: false });
      assert.equal(await issue(current, replacement), "duplicate_request");
      assert(!jobs.has(replacement.id));
      assert.equal((await inspector.query("SELECT 1 FROM rea_t319.permit WHERE id=$1", [replacement.id])).rowCount, 0);
      assert.deepEqual(await within(open(old, replacement).result, "unissued replacement over HTTPS"), { ...emptyReply, status: 404 });
      assert.deepEqual(await within(open(old, job).result, "same permit after first-write uncertainty"), emptyReply);
      assert.deepEqual(await permitState(job), previous);
      assert.deepEqual(await snapshot(), issuedState);
      affected.push({ current, job, original, plan, prefix, upstream, previous });
    }

    const intents = async () => (await inspector.query(`SELECT store_id,restoration,owner_id,request_id,permit_id,revision,digest
      FROM rea_t320.pcm_send_intent ORDER BY request_id`)).rows;
    const beforeClose = await intents();
    assert.equal(beforeClose.length, 4);
    assert.equal((await inspector.query("SELECT count(*)::integer AS count FROM rea_t319.permit")).rows[0].count, 4);
    assert(beforeClose.every(row => row.store_id === store && row.restoration === binding.generation));
    await control.query("BEGIN");
    try {
      assert.equal(await act(control, "drain"), "draining");
      assert.equal((await control.query("UPDATE pcm_closing SET state='draining' WHERE singleton AND state='active'")).rowCount, 1);
      await control.query("COMMIT");
    } catch (error) { await control.query("ROLLBACK"); throw error; }
    const args = [closeProof.transition, binding.database, binding.oid, binding.generation, binding.work];
    assert.equal((await installer.query("SELECT pcm_issuance.fence_writes($1,$2,$3,$4,$5) AS value", args)).rows[0].value, "fenced");
    assert.equal(await act(control, "activate"), "waiting_for_isolation");
    assert.equal(await state(), "draining");
    assert(affected.every(({ upstream }) => !upstream.socket.destroyed));
    assert.equal(await issue(retiredUnsent), "draining");
    for (const { current, job, upstream, plan, original, previous, prefix } of affected) {
      assert.equal(await issue(current), "draining");
      plan.deliver.resolve();
      assert.match((await within(plan.error.promise, "sender connection failure")).message, /connection|terminated|queryable/i);
      assert(plan.dbErrors.length > 0);
      await within(upstream.closed, "actual HTTPS sender socket closure");
      assert.equal(upstream.socket.writableLength, 0);
      assert.deepEqual(await within(original.result, "client observed incomplete response"),
        { status: 200, body: prefix, verified: true, complete: false });
      assert.deepEqual(await permitState(job), previous);
      assert.equal(await act(control, "activate"), "waiting_for_isolation");
    }
    await within(Promise.all([...old.tasks]), "old sender jobs ended");
    assert.equal(old.tasks.size, 0);
    assert.equal(old.sockets.size, 0);
    assert.equal(old.faults.length, 2);
    for (const error of old.faults) { assert(error instanceof Error); assert.match(error.message, /connection|terminated|queryable/i); }
    old.faults.length = 0;
    await within(old.stop(), "old listener stopped");
    await f.checkRefused(old.port);
    assert.equal(await act(control, "activate"), "waiting_for_isolation");
    assert.equal(await state(), "draining");
    await control.query("BEGIN");
    try {
      assert.deepEqual((await proofReader.query("SELECT * FROM pcm_issuance.fence_proof()")).rows[0], closeProof);
      const isolated = await control.query("SELECT rea_t319.terminate('isolated',1,$1,$2,NULL) AS value", [oldId, process.pid]);
      assert.equal(isolated.rows[0].value, "isolated");
      assert.equal(await act(control, "activate"), "activated");
      assert.equal((await control.query("UPDATE pcm_closing SET state='closed' WHERE singleton AND state='draining'")).rowCount, 1);
      await control.query("COMMIT");
    } catch (error) { await control.query("ROLLBACK"); throw error; }
    assert.equal(await state(), "closed");
    for (const { current, job, previous } of affected) {
      assert.deepEqual(await permitState(job), { state: "isolated", events: [...previous.events, "isolated"] });
      assert.deepEqual(await within(open(successor, job).result, "old intent after final close"), emptyReply);
      assert.equal(await issue(current), "unavailable");
      assert.deepEqual(await retry(current), unavailable);
    }
    assert.equal(await issue(retiredUnsent), "unavailable");
    assert.deepEqual(await intents(), beforeClose);
    assert.deepEqual(await snapshot(), issuedState);
    assert.equal(f.requests.size, 0);
    console.log("Owned PCM one-shot HTTPS: one intent per scoped request and digest, normal separate request sent, uncertain replacements denied, isolation confirmed, issuance rows unchanged");
  } finally {
    for (const plan of plans) { plan.proceed.resolve(); plan.deliver.resolve(); }
  }
}
