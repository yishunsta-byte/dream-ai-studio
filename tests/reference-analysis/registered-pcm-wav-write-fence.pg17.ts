import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Client, type QueryResultRow } from "pg";
import { v7 } from "uuid";
import { verify as verifyIssuance } from "./registered-pcm-wav-issuance.pg17";

type Fixture = Parameters<typeof verifyIssuance>[0];
type Binding = { database: string; oid: string; generation: string; work: number };
type Transition = Binding & { transition: string };
type Proof = { registrationGeneration: number; approvalGeneration: number; sha256: string; sizeBytes: number };
type Input = { id: string; owner: string; project: string; asset: string; revision: number; proof: Proof };
const externalDatabase = "dream_test_pcm_fence_control";
const commitLock = 98236711;
const requestSql = "SELECT * FROM pcm_issuance.data_request($1,$2,$3,'issue',$4,$5,$6,$7,$8)";
const fenceSql = "SELECT pcm_issuance.fence_writes($1,$2,$3,$4,$5) AS outcome";
const inspectSql = "SELECT * FROM pcm_issuance.fence_proof()";
const controlRow = `SELECT db_name AS database,db_oid AS oid,generation,work,transition_id::text AS transition,state
  FROM pcm_fence_control.binding WHERE singleton`;
const reserved = { outcome: "reserved", revision: null, changed: false };
const unavailable = { outcome: "unavailable", revision: null, changed: false };
const issued = (revision: number) => ({ outcome: "issued", revision, changed: true });

async function first<T extends QueryResultRow = QueryResultRow>(client: Client, sql: string, bindings: unknown[] = []) {
  return (await client.query<T>(sql, bindings)).rows[0];
}
const pid = async (client: Client) => (await first(client, "SELECT pg_backend_pid() AS pid")).pid as number;
const transitionArgs = (change: Transition) => [change.transition, change.database, change.oid, change.generation, change.work];
const sameTransition = (actual: Transition | undefined, expected: Transition) => !!actual &&
  actual.database === expected.database && actual.oid === expected.oid && actual.generation === expected.generation &&
  actual.work === expected.work && actual.transition === expected.transition;

async function applyClose(control: Client, reader: Client, change: Transition) {
  await control.query("BEGIN");
  let committed = false;
  try {
    const current = await first<Transition & { state: string }>(control, controlRow + " FOR UPDATE");
    if (!sameTransition(current, change) || !["draining", "closed"].includes(current.state)) return "conflict";
    const observed = await first<Transition>(reader, inspectSql).catch(() => undefined);
    if (!sameTransition(observed, change)) return "pending";
    if (current.state === "closed") return "already_closed";
    const saved = await control.query(`UPDATE pcm_fence_control.binding SET state='closed' WHERE singleton
      AND state='draining' AND transition_id=$1 AND db_name=$2 AND db_oid=$3 AND generation=$4 AND work=$5`, transitionArgs(change));
    assert.equal(saved.rowCount, 1);
    await control.query("COMMIT");
    committed = true;
    return "closed";
  } finally {
    if (!committed) await control.query("ROLLBACK");
  }
}

async function blocked(admin: Client, waiter: number, blocker: number, prefix: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const status = await first(admin, `SELECT query,wait_event_type,$2::integer=ANY(pg_blocking_pids(pid)) AS blocked
      FROM pg_stat_activity WHERE pid=$1 AND application_name='pcm-write-fence-fixture'`, [waiter, blocker]);
    if (status?.blocked && status.wait_event_type === "Lock" && status.query.startsWith(prefix)) return;
    await delay(20);
  }
  assert.fail(`Expected the owned backend to wait at ${prefix}`);
}

async function refreshedInput(admin: Client, owner: string, revision: number): Promise<Input> {
  const row = await first<{ project: string; asset: string }>(admin,
    "SELECT project_id AS project,asset_id AS asset FROM pcm_fixture.approvals WHERE owner_id=$1 AND active", [owner]);
  const { asset, project } = row;
  await admin.query("BEGIN");
  try {
    await admin.query("SELECT pcm_issuance.scope_lock($1,$2,$3)", [owner, project, asset]);
    assert.equal((await admin.query(`UPDATE pcm_fixture.registrations SET generation=generation+1
      WHERE (owner_id,asset_id)=($1,$2)`, [owner, asset])).rowCount, 1);
    const { proof } = await first<{ proof: Proof }>(admin, `UPDATE pcm_fixture.approvals g
      SET generation=g.generation+1,registration_generation=r.generation
      FROM pcm_fixture.registrations r WHERE (g.owner_id,g.project_id,g.asset_id)=($1,$2,$3)
        AND g.active AND (r.owner_id,r.asset_id)=(g.owner_id,g.asset_id)
      RETURNING jsonb_build_object('registrationGeneration',r.generation,'approvalGeneration',g.generation,
        'sha256',r.sha256,'sizeBytes',r.size_bytes) AS proof`, [owner, project, asset]);
    await admin.query("COMMIT");
    return { id: v7(), owner, project, asset, proof, revision };
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

export async function verify(fixture: Fixture) {
  await verifyIssuance(fixture);
  const { admin, cfg, a, b } = fixture;
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.database, "dream_test_t367");
  const adminUser = admin.user;
  assert(adminUser);
  await admin.query(await readFile(new URL("registered-pcm-wav-write-fence.fixture.sql", import.meta.url), "utf8"));
  await admin.query("CREATE DATABASE dream_test_pcm_fence_control TEMPLATE template0");
  await admin.query("REVOKE CONNECT ON DATABASE dream_test_pcm_fence_control FROM PUBLIC");
  const { quoted } = await first(admin, "SELECT quote_literal($1::text) AS quoted", [cfg.password]);
  for (const role of ["pcm_fence_installer", "pcm_fence_observer"]) {
    await admin.query(`CREATE ROLE ${role}_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${quoted}`);
    await admin.query(`GRANT ${role} TO ${role}_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  }
  const clients = new Set<Client>();
  const jobs: Promise<unknown>[] = [];
  function start<T>(job: Promise<T>) {
    jobs.push(job);
    void job.catch(() => {});
    return job;
  }
  async function connect(database: string, user: string) {
    const client = new Client({ ...cfg, database, user, application_name: "pcm-write-fence-fixture", statement_timeout: 12_000 });
    clients.add(client);
    await client.connect();
    return client;
  }
  async function begin(client: Client, input: Input, hold = false) {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL ROLE pcm_issuance_issuer");
    await client.query("SELECT set_config('dream.actor_id',$1,true)", [input.owner]);
    if (hold) await client.query("SET LOCAL pcm_issuance.hold_commit='on'");
  }
  const submit = (client: Client, bind: Binding, input: Input, reserve = false) => first(client, requestSql,
    [bind.generation, bind.work, input.id, input.project, input.asset, input.proof, input.revision, reserve]);
  async function call(client: Client, bind: Binding, input: Input, reserve = false) {
    await begin(client, input);
    try {
      const result = await submit(client, bind, input, reserve);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  const snapshot = (binding: Binding) => first(admin, `SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY owner_id,project_id,asset_id) FROM pcm_issuance.pointer p WHERE restore_gen=$1) AS pointers,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM pcm_issuance.requests r WHERE restore_gen=$1) AS requests`, [binding.generation]);

  try {
    const outer = () => connect(externalDatabase, adminUser);
    const issuer = () => connect(cfg.database, "pcm_issuance_issuer_login");
    const [coordinator, replacement, controlCheck, installer, reader, dataA, dataB, late] = await Promise.all([
      outer(), outer(), outer(), connect(cfg.database, "pcm_fence_installer_login"),
      connect(cfg.database, "pcm_fence_observer_login"), issuer(), issuer(), issuer(),
    ]);
    await installer.query("SET ROLE pcm_fence_installer");
    await reader.query("SET ROLE pcm_fence_observer");
    await assert.rejects(installer.query("UPDATE pcm_issuance.pointer SET revision=200"), { code: "42501" });
    await assert.rejects(reader.query(fenceSql, [v7(), cfg.database, "0", "restore-1", 2]), { code: "42501" });
    await late.query("SET ROLE pcm_issuance_issuer");
    await assert.rejects(late.query("SELECT * FROM pcm_issuance.request(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)"), { code: "42501" });
    await assert.rejects(late.query("UPDATE pcm_issuance.control SET close_id=NULL"), { code: "42501" });
    await late.query("RESET ROLE");
    const binding = await first<Binding>(admin, `SELECT current_database() AS database,d.oid::text AS oid,
      c.restore_gen AS generation,c.work_number AS work FROM pg_database d CROSS JOIN pcm_issuance.control c
      WHERE d.datname=current_database() AND c.singleton`);
    const close = { ...binding, transition: v7() };
    await coordinator.query(`CREATE SCHEMA pcm_fence_control;
      CREATE TABLE pcm_fence_control.binding(singleton boolean PRIMARY KEY CHECK(singleton),db_name text NOT NULL,
        db_oid text NOT NULL,generation text NOT NULL,work integer NOT NULL,transition_id uuid,
        state text NOT NULL CHECK(state IN ('active','draining','closed')),
        CHECK((state='active')=(transition_id IS NULL)))`);
    await coordinator.query("INSERT INTO pcm_fence_control.binding VALUES(true,$1,$2,$3,$4,NULL,'active')",
      [binding.database, binding.oid, binding.generation, binding.work]);
    const admits = async () => (await first(controlCheck, `SELECT EXISTS(SELECT 1 FROM pcm_fence_control.binding
      WHERE singleton AND state='active' AND db_name=$1 AND db_oid=$2 AND generation=$3 AND work=$4) AS admitted`,
    [binding.database, binding.oid, binding.generation, binding.work])).admitted;
    assert.equal(await admits(), true);
    assert.equal((await first(installer, fenceSql, transitionArgs({ ...close, oid: "0" }))).outcome, "conflict");
    assert.equal(await first(reader, inspectSql), undefined);
    const inputA = await refreshedInput(admin, a.id, 4);
    const inputB = await refreshedInput(admin, b.id, 1);
    assert.deepEqual(await call(dataA, { ...binding, work: binding.work + 1 }, inputA, true), unavailable);
    assert.deepEqual(await call(dataA, { ...binding, generation: "other-generation" }, inputA, true), unavailable);
    assert.deepEqual(await call(dataA, binding, inputA, true), reserved);
    assert.deepEqual(await call(dataB, binding, inputB, true), reserved);

    const before = await snapshot(binding);
    const [adminPid, coordinatorPid, installerPid, aPid, bPid, latePid] = await Promise.all([
      pid(admin), pid(coordinator), pid(installer), pid(dataA), pid(dataB), pid(late),
    ]);
    await admin.query("SELECT pg_advisory_lock($1)", [commitLock]);
    await begin(dataA, inputA, true);
    await begin(dataB, inputB, true);
    assert.deepEqual(await submit(dataA, binding, inputA), issued(5));
    assert.deepEqual(await submit(dataB, binding, inputB), issued(2));
    const commitA = start(dataA.query("COMMIT"));
    const commitB = start(dataB.query("COMMIT"));
    await blocked(admin, aPid, adminPid, "COMMIT");
    await blocked(admin, bPid, adminPid, "COMMIT");
    assert.deepEqual(await snapshot(binding), before);

    assert.equal((await coordinator.query(`UPDATE pcm_fence_control.binding SET state='draining',transition_id=$1
      WHERE singleton AND state='active' AND db_name=$2 AND db_oid=$3 AND generation=$4 AND work=$5`, transitionArgs(close))).rowCount, 1);
    const controlErrors: Error[] = [];
    coordinator.on("error", error => controlErrors.push(error));
    assert.equal((await first(admin, "SELECT pg_terminate_backend($1,3000) AS stopped", [coordinatorPid])).stopped, true);
    assert.equal(await applyClose(replacement, reader, close), "pending");
    assert.equal((await first(controlCheck, controlRow)).state, "draining");
    assert.equal(await admits(), false);
    assert.equal(await applyClose(replacement, reader, { ...close, transition: v7() }), "conflict");
    assert.equal(await applyClose(replacement, controlCheck, close), "pending"); // A different actual database cannot attest this target.
    assert.deepEqual(await snapshot(binding), before);

    await installer.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const staging = start(first(installer, fenceSql, transitionArgs(close)));
    assert.equal((await first(admin, "SELECT pg_cancel_backend($1) AS cancelled", [bPid])).cancelled, true);
    await assert.rejects(commitB, { code: "57014" });
    await blocked(admin, installerPid, aPid, "SELECT pcm_issuance.fence_writes");
    assert.equal(await applyClose(replacement, reader, close), "pending");
    assert.equal((await first(controlCheck, controlRow)).state, "draining");
    assert.equal((await first(admin, "SELECT pg_advisory_unlock($1) AS unlocked", [commitLock])).unlocked, true);
    await commitA;
    assert.deepEqual(await staging, { outcome: "fenced" });
    const drained = await snapshot(binding);
    assert.equal(drained.pointers.find((p: { owner_id: string }) => p.owner_id === a.id).revision, 5);
    assert.equal(drained.requests.find((r: { request_id: string }) => r.request_id === inputA.id).result_revision, 5);
    assert.equal(drained.requests.find((r: { request_id: string }) => r.request_id === inputB.id).state, "reserved");
    assert.deepEqual(drained.pointers.find((p: { owner_id: string }) => p.owner_id === b.id),
      before.pointers.find((p: { owner_id: string }) => p.owner_id === b.id));

    await begin(late, inputB);
    const queuedOld = start(submit(late, binding, inputB));
    await blocked(admin, latePid, installerPid, requestSql);
    assert.equal(await first(reader, inspectSql), undefined);
    assert.equal(await applyClose(replacement, reader, close), "pending");
    // The harness waits for the real target commit but gives the coordinator no reply from the installer.
    await installer.query("COMMIT");
    await installer.end();
    clients.delete(installer);
    assert.deepEqual(await queuedOld, unavailable);
    await late.query("COMMIT");
    assert.equal((await first(controlCheck, controlRow)).state, "draining");
    assert.equal(await applyClose(replacement, controlCheck, close), "pending");
    assert.deepEqual(await first(reader, inspectSql), close);
    const targetVersion = await first(admin, "SELECT xmin::text FROM pcm_issuance.control WHERE singleton");
    const repeatInstaller = await connect(cfg.database, "pcm_fence_installer_login");
    await repeatInstaller.query("SET ROLE pcm_fence_installer");
    assert.deepEqual(await first(repeatInstaller, fenceSql, transitionArgs(close)), { outcome: "already_fenced" });
    assert.deepEqual(await first(repeatInstaller, fenceSql, transitionArgs({ ...close, transition: v7() })), { outcome: "conflict" });
    assert.deepEqual(await first(admin, "SELECT xmin::text FROM pcm_issuance.control WHERE singleton"), targetVersion);
    assert.equal(await applyClose(replacement, reader, close), "closed");
    const closed = await first(controlCheck, controlRow);
    assert.equal(closed.state, "closed");
    const version = await first(controlCheck, "SELECT xmin::text FROM pcm_fence_control.binding");
    assert.equal(await applyClose(replacement, reader, close), "already_closed");
    assert.equal(await admits(), false);
    assert.deepEqual(await first(controlCheck, "SELECT xmin::text FROM pcm_fence_control.binding"), version);
    for (const input of [inputA, inputB, { ...inputB, id: v7() }]) {
      assert.deepEqual(await call(dataA, binding, input), unavailable);
      assert.deepEqual(await call(dataA, binding, input, true), unavailable);
    }
    assert.deepEqual(await call(dataA, { ...binding, work: binding.work + 1 }, inputA), unavailable);
    assert.deepEqual(await call(dataA, { ...binding, generation: "other-generation" }, inputA), unavailable);
    assert.deepEqual(await snapshot(binding), drained);
    assert(controlErrors.length > 0);
    console.log("PCM write fence: durable drain, real commit/cancel, verified target fence before close, lost reply recovered, stale writes zero");
  } finally {
    await admin.query("SELECT pg_advisory_unlock_all()");
    await Promise.allSettled(jobs);
    await Promise.allSettled(Array.from(clients, client => client.end()));
  }
  assert.equal((await first(admin, `SELECT count(*)::integer AS count FROM pg_stat_activity
    WHERE application_name='pcm-write-fence-fixture'`)).count, 0);
}
