import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Client, type QueryResultRow } from "pg";
import { v7 } from "uuid";
import { verify as verifyIssuance } from "./registered-pcm-wav-issuance.pg17";

type Fixture = Parameters<typeof verifyIssuance>[0];
type Binding = { database: string; oid: string; generation: string; work: number };
type Proof = { registrationGeneration: number; approvalGeneration: number; sha256: string; sizeBytes: number };
type Target = { owner: string; project: string; asset: string };
type Input = { id: string; target: Target; proof: Proof; revision: number };
type Outcome = { outcome: string; revision: number | null; changed: boolean };
type Gate = <T>(control: Client, data: Client, role: "issuer", binding: Binding, owner: string,
  query: () => Promise<T>) => Promise<T | undefined>;
const controlDatabase = "dream_test_pcm_close_control";
const commitLock = 98236711;
const issueSql = "SELECT * FROM pcm_issuance.request($1,$2,'issue',$3,$4,$5,$6,$7)";
const closeSql = `UPDATE external_control.binding SET state='closed'
  WHERE singleton AND state='active' AND db_oid=$1 AND generation=$2 AND work=$3`;
const unavailable = { outcome: "unavailable", revision: null, changed: false };
const reserved = { outcome: "reserved", revision: null, changed: false };
const issued = (revision: number, changed: boolean): Outcome => ({ outcome: "issued", revision, changed });

async function first<T extends QueryResultRow = QueryResultRow>(client: Client, sql: string, values: unknown[] = []) {
  return (await client.query<T>(sql, values)).rows[0];
}
const pid = async (client: Client) => (await first(client, "SELECT pg_backend_pid() AS pid")).pid as number;
const selection = (admin: Client, owner: string) => first<Target>(admin, `SELECT owner_id AS owner,project_id AS project,
  asset_id AS asset FROM pcm_fixture.approvals WHERE owner_id=$1`, [owner]);
const snapshot = (admin: Client, binding: Binding, input: Input) => first(admin, `SELECT
  (SELECT to_jsonb(p) FROM pcm_issuance.pointer p WHERE (restore_gen,owner_id,project_id,asset_id)=($1,$2,$3,$4)) AS pointer,
  (SELECT to_jsonb(r) FROM pcm_issuance.requests r WHERE (restore_gen,request_id)=($1,$5)) AS request`,
  [binding.generation, input.target.owner, input.target.project, input.target.asset, input.id]);

async function waitForLock(admin: Client, waiter: number, blocker: number, prefix: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const activity = await first(admin, `SELECT query,wait_event_type,$2::integer=ANY(pg_blocking_pids(pid)) AS blocked
      FROM pg_stat_activity WHERE pid=$1 AND application_name='pcm-close-race-fixture'`, [waiter, blocker]);
    if (activity?.blocked && activity.wait_event_type === "Lock" && activity.query.startsWith(prefix)) return;
    await delay(20);
  }
  assert.fail(`Expected the dedicated fixture backend to wait at ${prefix}`);
}

async function newInput(admin: Client, target: Target, revision: number): Promise<Input> {
  const ids = [target.owner, target.project, target.asset];
  await admin.query("BEGIN");
  try {
    await admin.query("SELECT pcm_issuance.scope_lock($1,$2,$3)", ids);
    assert.equal((await admin.query(`UPDATE pcm_fixture.registrations SET generation=generation+1
      WHERE (owner_id,asset_id)=($1,$2)`, [target.owner, target.asset])).rowCount, 1);
    const { proof } = await first<{ proof: Proof }>(admin, `UPDATE pcm_fixture.approvals g
      SET generation=g.generation+1,registration_generation=r.generation
      FROM pcm_fixture.registrations r
      WHERE (g.owner_id,g.project_id,g.asset_id)=($1,$2,$3)
        AND g.active AND (r.owner_id,r.asset_id)=(g.owner_id,g.asset_id)
      RETURNING jsonb_build_object('registrationGeneration',r.generation,'approvalGeneration',g.generation,
        'sha256',r.sha256,'sizeBytes',r.size_bytes) AS proof`, ids);
    await admin.query("COMMIT");
    return { id: v7(), target, proof, revision };
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

export async function verify(fixture: Fixture) {
  await verifyIssuance(fixture);
  const { withBinding } = await import(new URL("registered-pcm-wav-restore.pg17.ts", import.meta.url).href) as { withBinding: Gate };
  const { admin, cfg, a, b } = fixture;
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.database, "dream_test_t367");
  const adminUser = admin.user;
  assert(adminUser);
  const owned = await first(admin, `SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,
    current_setting('dream.t367_owned',true) AS marker, current_setting('server_version_num') AS version`);
  assert.deepEqual(owned, { host: cfg.host, port: cfg.port, marker: "on", version: "170012" });
  await admin.query("CREATE DATABASE dream_test_pcm_close_control TEMPLATE template0");
  await admin.query("REVOKE CONNECT ON DATABASE dream_test_pcm_close_control FROM PUBLIC");
  await admin.query("GRANT SELECT ON pcm_issuance.control TO pcm_issuance_issuer");

  const clients = new Set<Client>();
  const jobs: Promise<unknown>[] = [];
  const responsePermit = Promise.withResolvers<void>();
  const events: string[] = [];
  function start<T>(job: Promise<T>) {
    jobs.push(job);
    void job.catch(() => {});
    return job;
  }
  async function connect(database: string, user: string) {
    const client = new Client({ ...cfg, database, user, application_name: "pcm-close-race-fixture", statement_timeout: 12_000 });
    clients.add(client);
    await client.connect();
    return client;
  }

  try {
    const control = () => connect(controlDatabase, adminUser);
    const data = () => connect(cfg.database, "pcm_issuance_issuer_login");
    const [external, close, gateA, gateB, guardObserver, dataA, dataB, observer] = await Promise.all([
      control(), control(), control(), control(), control(), data(), data(), data(),
    ]);
    await external.query(`CREATE SCHEMA external_control;
      CREATE TABLE external_control.binding (singleton boolean PRIMARY KEY CHECK(singleton),db_name text NOT NULL,
        db_oid text NOT NULL,generation text NOT NULL,work integer NOT NULL,state text NOT NULL CHECK(state IN ('active','closed')))`);
    const old = await first<Binding>(admin, `SELECT current_database() AS database,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,restore_gen AS generation,work_number AS work
      FROM pcm_issuance.control WHERE singleton`);
    await external.query("INSERT INTO external_control.binding VALUES(true,$1,$2,$3,$4,'active')",
      [old.database, old.oid, old.generation, old.work]);
    const submit = async (gate: Client, client: Client, binding: Binding, input: Input, reserve = false, hold = false) =>
      (await withBinding(gate, client, "issuer", binding, input.target.owner, async () => {
        if (hold) await client.query("SET LOCAL pcm_issuance.hold_commit='on'");
        return first<Outcome>(client, issueSql,
          [input.id, binding.work, input.target.project, input.target.asset, input.proof, input.revision, reserve]);
      })) ?? unavailable;
    const observe = (binding: Binding, input: Input) =>
      withBinding(guardObserver, observer, "issuer", binding, input.target.owner, () =>
        first(observer, "SELECT * FROM pcm_issuance.observe($1)", [input.id]));
    const closeBinding = async (binding: Binding) => {
      assert.equal((await close.query(closeSql, [binding.oid, binding.generation, binding.work])).rowCount, 1);
      assert.equal((await first(external, "SELECT state FROM external_control.binding WHERE singleton")).state, "closed");
    };
    const [adminPid, closePid, gateAPid, dataAPid, dataBPid] = await Promise.all([
      pid(admin), pid(close), pid(gateA), pid(dataA), pid(dataB),
    ]);
    const [targetA, targetB] = await Promise.all([selection(admin, a.id), selection(admin, b.id)]);
    const beforeClose = await newInput(admin, targetA, 4);
    assert.deepEqual(await submit(gateA, dataA, old, beforeClose, true), reserved);
    assert.deepEqual(await submit(gateA, dataA, old, beforeClose), issued(5, true));
    assert.deepEqual(await submit(gateA, dataA, old, beforeClose), issued(5, false));
    events.push("success before close");

    const committed = await newInput(admin, targetA, 5);
    const cancelled = await newInput(admin, targetB, 1);
    assert.deepEqual(await submit(gateA, dataA, old, committed, true), reserved);
    assert.deepEqual(await submit(gateB, dataB, old, cancelled, true), reserved);
    const beforeCommit = await snapshot(admin, old, committed);
    const beforeCancel = await snapshot(admin, old, cancelled);
    await admin.query("SELECT pg_advisory_lock($1)", [commitLock]);
    const completed = start(submit(gateA, dataA, old, committed, false, true));
    const delivered = start(completed.then(async output => {
      // Model the caller that holds a completed response before it returns the success.
      await responsePermit.promise;
      events.push("delayed success returned");
      return output;
    }));
    const interrupted = start(submit(gateB, dataB, old, cancelled, false, true));
    await waitForLock(admin, dataAPid, adminPid, "COMMIT");
    await waitForLock(admin, dataBPid, adminPid, "COMMIT");
    assert.deepEqual(await snapshot(admin, old, committed), beforeCommit);
    assert.deepEqual(await snapshot(admin, old, cancelled), beforeCancel);
    assert.deepEqual(await observe(old, cancelled), { state: "reserved", revision: null });

    const closing = start(closeBinding(old));
    assert.equal((await first(admin, "SELECT pg_cancel_backend($1) AS cancelled", [dataBPid])).cancelled, true);
    await assert.rejects(interrupted, { code: "57014" });
    await waitForLock(admin, closePid, gateAPid, "UPDATE external_control.binding");
    assert.equal((await first(external, "SELECT state FROM external_control.binding WHERE singleton")).state, "active");
    assert.deepEqual(await snapshot(admin, old, cancelled), beforeCancel);
    assert.equal((await first(admin, "SELECT pg_advisory_unlock($1) AS unlocked", [commitLock])).unlocked, true);
    assert.deepEqual(await completed, issued(6, true));
    await closing;
    events.push("close confirmed");
    const afterCommit = await snapshot(admin, old, committed);
    assert.equal(afterCommit.pointer.revision, 6);
    assert.equal(afterCommit.request.result_revision, 6);
    assert.equal(afterCommit.request.state, "issued");

    for (const input of [beforeClose, committed, cancelled]) {
      assert.equal(await observe(old, input), undefined);
      assert.deepEqual(await submit(gateA, dataA, old, input, true), unavailable);
      assert.deepEqual(await submit(gateA, dataA, old, input), unavailable);
    }
    responsePermit.resolve();
    assert.deepEqual(await delivered, issued(6, true));
    assert.deepEqual(events, ["success before close", "close confirmed", "delayed success returned"]);
    assert.deepEqual(await snapshot(admin, old, committed), afterCommit);
    assert.deepEqual(await snapshot(admin, old, cancelled), beforeCancel);
    console.log("PCM close race: live control lock drains COMMIT; cancelled attempt and post-close retries are no-op");
    console.log("PCM gap reproduced: a committed success held by the caller returned after close");

    // A separate synthetic generation tests loss of the controller connection mid-COMMIT.
    const next = { ...old, generation: v7(), work: old.work + 1 };
    assert.equal((await admin.query("UPDATE pcm_issuance.control SET restore_gen=$1,work_number=$2 WHERE singleton",
      [next.generation, next.work])).rowCount, 1);
    assert.equal((await external.query(`UPDATE external_control.binding SET generation=$1,work=$2,state='active'
      WHERE singleton AND state='closed' AND generation=$3`, [next.generation, next.work, old.generation])).rowCount, 1);
    const disconnected = await newInput(admin, targetB, 0);
    const lostGate = await control();
    const lostPid = await pid(lostGate);
    const controlErrors: Error[] = [];
    lostGate.on("error", error => controlErrors.push(error));
    assert.deepEqual(await submit(lostGate, dataB, next, disconnected, true), reserved);
    const beforeLoss = await snapshot(admin, next, disconnected);
    assert.equal(beforeLoss.pointer, null);
    assert.equal(beforeLoss.request.state, "reserved");
    await admin.query("SELECT pg_advisory_lock($1)", [commitLock]);
    const lost = start(submit(lostGate, dataB, next, disconnected, false, true));
    await waitForLock(admin, dataBPid, adminPid, "COMMIT");
    assert.equal((await first(admin, "SELECT pg_terminate_backend($1,3000) AS stopped", [lostPid])).stopped, true);
    await closeBinding(next);
    await waitForLock(admin, dataBPid, adminPid, "COMMIT");
    assert.deepEqual(await snapshot(admin, next, disconnected), beforeLoss);
    assert.equal((await first(admin, "SELECT pg_advisory_unlock($1) AS unlocked", [commitLock])).unlocked, true);
    await assert.rejects(lost, /connection|queryable/i);
    assert(controlErrors.length > 0);
    const afterLoss = await snapshot(admin, next, disconnected);
    assert.equal(afterLoss.pointer.revision, 1);
    assert.equal(afterLoss.request.state, "issued");
    assert.equal(afterLoss.request.result_revision, 1);
    assert.equal(await observe(next, disconnected), undefined);
    assert.deepEqual(await submit(gateB, dataB, next, disconnected), unavailable);
    assert.deepEqual(await snapshot(admin, next, disconnected), afterLoss);
    console.log("PCM gap reproduced: lost external lock allowed an already-open data COMMIT after close, while the caller saw an error");
  } finally {
    responsePermit.resolve();
    await admin.query("SELECT pg_advisory_unlock_all()");
    await Promise.allSettled(jobs);
    await Promise.allSettled(Array.from(clients, client => client.end()));
  }
  assert.equal((await first(admin, `SELECT count(*)::integer AS count FROM pg_stat_activity
    WHERE application_name='pcm-close-race-fixture'`)).count, 0);
}
