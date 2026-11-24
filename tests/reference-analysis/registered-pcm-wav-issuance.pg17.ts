import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { v7 } from "uuid";
import { verify as verifyRegistration } from "./registered-pcm-wav-authority.pg17";

type Fixture = Parameters<typeof verifyRegistration>[0];
type Target = { owner: string; project: string; asset: string };
type Proof = { registrationGeneration: number; approvalGeneration: number; sha256: string; sizeBytes: number };
type Command = { key: string; target: Target; proof: Proof; revision: number; operation: "issue" | "revoke"; work: number };
const outcome = (name: string, revision: number | null = null, changed = false) => ({ outcome: name, revision, changed });
const command = (target: Target, proof: Proof, revision: number, operation: Command["operation"] = "issue"): Command =>
  ({ key: v7(), target, proof, revision, operation, work: 1 });
const first = async (client: Client, sql: string, values: unknown[] = []) => (await client.query(sql, values)).rows[0];
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function verify(fixture: Fixture) {
  await verifyRegistration(fixture);
  const { admin, cfg, a, b } = fixture;
  await admin.query(await readFile(new URL("registered-pcm-wav-issuance.fixture.sql", import.meta.url), "utf8"));
  const { quoted } = await first(admin, "SELECT quote_literal($1::text) AS quoted", [cfg.password]);
  const roles = ["pcm_issuance_issuer", "pcm_issuance_reader"] as const;
  for (const role of roles) {
    await admin.query(`CREATE ROLE ${role}_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${quoted}`);
    await admin.query(`GRANT ${role} TO ${role}_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  }
  const makeClient = (role: typeof roles[number]) => new Client({ ...cfg, user: role + "_login",
    application_name: "pcm-issuance-fixture" });
  const issuer = makeClient(roles[0]);
  const retry = makeClient(roles[0]);
  const reader = makeClient(roles[1]);
  const clients = [issuer, retry, reader];
  const launch = "SELECT * FROM pcm_issuance.request($1,$2,$3,$4,$5,$6,$7,$8)";
  const submit = (client: Client, input: Command, reserve = false) => first(client, launch, [
    input.key, input.work, input.operation, input.target.project, input.target.asset, input.proof, input.revision, reserve,
  ]);
  const begin = async (client: Client, owner: string, role: typeof roles[number]) => {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query(`SET LOCAL ROLE ${role}; SET LOCAL statement_timeout='10s'`);
    await client.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
  };
  async function scoped<T>(client: Client, owner: string, role: typeof roles[number], run: () => Promise<T>) {
    await begin(client, owner, role);
    try {
      const result = await run();
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  const send = (input: Command, reserve = false, owner = input.target.owner) =>
    scoped(retry, owner, roles[0], () => submit(retry, input, reserve));
  const observe = (input: Command, owner = input.target.owner) =>
    scoped(retry, owner, roles[0], () => first(retry, "SELECT * FROM pcm_issuance.observe($1)", [input.key]));
  const read = (target: Target, owner = target.owner) => scoped(reader, owner, roles[1], () => first(reader,
    "SELECT * FROM pcm_issuance.read_current($1,$2)", [target.project, target.asset]));
  const approval = async (owner: string): Promise<Target> => {
    const row = await first(admin, "SELECT project_id,asset_id FROM pcm_fixture.approvals WHERE owner_id=$1", [owner]);
    assert(row);
    return { owner, project: row.project_id, asset: row.asset_id };
  };
  const getProof = async (target: Target): Promise<Proof> => {
    const result = await first(admin, `SELECT r.generation AS "registrationGeneration",g.generation AS "approvalGeneration",
        r.sha256,r.size_bytes AS "sizeBytes" FROM pcm_fixture.registrations r JOIN pcm_fixture.approvals g USING (owner_id,asset_id)
        WHERE (r.owner_id,g.project_id,r.asset_id)=($1,$2,$3)`, [target.owner, target.project, target.asset]);
    assert(result);
    return result as Proof;
  };
  async function changeProof(target: Target, advance: boolean, approve: boolean) {
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT pcm_issuance.scope_lock($1,$2,$3)", [target.owner, target.project, target.asset]);
      if (advance) await admin.query("UPDATE pcm_fixture.registrations SET generation=generation+1 WHERE owner_id=$1 AND asset_id=$2",
        [target.owner, target.asset]);
      if (approve) await admin.query(`UPDATE pcm_fixture.approvals g SET active=true,generation=g.generation+1,registration_generation=r.generation
        FROM pcm_fixture.registrations r WHERE (g.owner_id,g.project_id,g.asset_id)=($1,$2,$3)
        AND (r.owner_id,r.asset_id)=(g.owner_id,g.asset_id)`, [target.owner, target.project, target.asset]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    return getProof(target);
  }
  const snapshot = (input: Command) => first(admin, `SELECT
    (SELECT to_jsonb(row) FROM (SELECT revision,state,proof FROM pcm_issuance.pointer
      WHERE (owner_id,project_id,asset_id)=($1,$2,$3)) row) AS pointer,
    (SELECT to_jsonb(row) FROM (SELECT state,result_revision FROM pcm_issuance.requests WHERE request_id=$4) row) AS ledger`,
  [input.target.owner, input.target.project, input.target.asset, input.key]);
  const backend = async (client: Client) => (await first(client, "SELECT pg_backend_pid() AS pid")).pid as number;
  async function blocked(waiter: number, blocker: number, query: string) {
    for (let attempt = 0; attempt < 160; attempt++) {
      const row = await first(admin, `SELECT query,wait_event_type,$2::int=ANY(pg_blocking_pids(pid)) AS blocked
        FROM pg_stat_activity WHERE pid=$1 AND application_name='pcm-issuance-fixture'`, [waiter, blocker]);
      if (row?.blocked && row.wait_event_type === "Lock" && row.query.startsWith(query)) return;
      await delay(20);
    }
    assert.fail("Expected the fixture backend to wait for the designated transaction");
  }
  const sameBytes = async (target: Target, proof: Proof) => {
    const row = await read(target);
    assert(row);
    assert.deepEqual(row.proof, proof);
    assert.equal(row.content.length, proof.sizeBytes);
    assert.equal(digest(row.content), proof.sha256);
  };

  try {
    await Promise.all(clients.map(client => client.connect()));
    const [adminPid, issuerPid, retryPid] = await Promise.all([backend(admin), backend(issuer), backend(retry)]);
    const targetA = await approval(a.id);
    const targetB = await approval(b.id);
    const initialA = await changeProof(targetA, false, true);
    const initialB = await getProof(targetB);
    const issueA = command(targetA, initialA, 0);
    const issueB = command(targetB, initialB, 0);
    assert.equal(await read(targetA), undefined);
    assert.deepEqual(await send(issueA), outcome("reservation_required"));
    await scoped(retry, targetA.owner, roles[0], async () => {
      assert.deepEqual(await submit(retry, issueA, true), outcome("reserved"));
      assert.deepEqual(await submit(retry, issueA), outcome("reservation_required"));
    });
    for (const input of [issueA, issueB]) {
      assert.deepEqual(await send(input, true), outcome("reserved"));
      assert.deepEqual(await send(input), outcome("issued", 1, true));
      await sameBytes(input.target, input.proof);
    }
    assert.equal(await read(targetA, b.id), undefined);
    assert.equal(await observe(issueA, b.id), undefined);
    assert.deepEqual(await send(issueA, false, b.id), outcome("unavailable"));
    assert.deepEqual(await send({ ...issueB, key: issueA.key }), outcome("unavailable"));
    assert.deepEqual(await send({ ...issueA, proof: { ...initialA, sizeBytes: 46 } }), outcome("conflict"));
    assert.deepEqual(await send({ ...issueA, work: 99 }), outcome("unavailable"));
    await assert.rejects(scoped(retry, a.id, roles[0], () => retry.query("UPDATE pcm_issuance.pointer SET revision=10")), { code: "42501" });
    await assert.rejects(scoped(retry, a.id, roles[0], () => retry.query("DELETE FROM pcm_issuance.requests")), { code: "42501" });
    await assert.rejects(scoped(reader, a.id, roles[1], () => submit(reader, issueA)), { code: "42501" });
    await assert.rejects(scoped(reader, a.id, roles[1], () => reader.query("SELECT content FROM local_wav.files")), { code: "42501" });

    const late = command(targetA, initialA, 1);
    const revoke = command(targetA, initialA, 1, "revoke");
    for (const input of [late, revoke]) assert.deepEqual(await send(input, true), outcome("reserved"));
    assert.deepEqual(await send(revoke), outcome("revoked", 2, true));
    assert.deepEqual(await send(revoke), outcome("revoked", 2));
    assert.deepEqual(await snapshot(revoke), { pointer: { revision: 2, state: "revoked", proof: initialA },
      ledger: { state: "revoked", result_revision: 2 } });
    assert.equal(await read(targetA), undefined);
    assert.deepEqual(await send(late), outcome("stale_pointer"));
    const old = command(targetA, initialA, 2);
    assert.deepEqual(await send(old, true), outcome("reserved"));
    assert.deepEqual(await send(old), outcome("renewal_requires_new_verification"));
    assert.deepEqual(await send(issueA), outcome("issued", 1));
    assert.equal(await read(targetA), undefined); // A replayed completion is not new authority.
    await sameBytes(targetB, initialB);

    const unapproved = await changeProof(targetA, true, false);
    const invalid = command(targetA, unapproved, 2);
    assert.deepEqual(await send(invalid, true), outcome("reserved"));
    assert.deepEqual(await send(invalid), outcome("stale_evidence"));
    const current = await changeProof(targetA, false, true);
    assert.equal(current.sha256, initialA.sha256);
    assert(current.registrationGeneration > initialA.registrationGeneration);
    assert(current.approvalGeneration > initialA.approvalGeneration);
    const wrongSha = command(targetA, { ...current, sha256: "0".repeat(64) }, 2);
    assert.deepEqual(await send(wrongSha, true), outcome("reserved"));
    assert.deepEqual(await send(wrongSha), outcome("stale_evidence"));
    assert.equal(await read(targetA), undefined);

    async function holdCommit(input: Command, revision: number, cancel: boolean) {
      assert.deepEqual(await send(input, true), outcome("reserved"));
      const before = await snapshot(input);
      assert.deepEqual(before.ledger, { state: "reserved", result_revision: null });
      await admin.query("SELECT pg_advisory_lock(98236711)");
      let commit: Promise<unknown> | undefined;
      let replay: Promise<unknown> | undefined;
      try {
        await begin(issuer, targetA.owner, roles[0]);
        await issuer.query("SET LOCAL pcm_issuance.hold_commit='on'");
        assert.deepEqual(await submit(issuer, input), outcome("issued", revision, true));
        commit = issuer.query("COMMIT");
        void commit.catch(() => {});
        await blocked(issuerPid, adminPid, "COMMIT");
        assert.deepEqual(await snapshot(input), before);
        assert.deepEqual(await observe(input), { state: "reserved", revision: null });
        assert.equal(await read(targetA), undefined);
        if (cancel) {
          assert.equal((await first(admin, "SELECT pg_cancel_backend($1) AS cancelled", [issuerPid])).cancelled, true);
          await assert.rejects(commit, { code: "57014" });
          assert.deepEqual(await snapshot(input), before);
          assert.deepEqual(await send(input), outcome("issued", revision, true));
        } else {
          replay = send(input);
          void replay.catch(() => {});
          await blocked(retryPid, issuerPid, launch);
          await admin.query("SELECT pg_advisory_unlock(98236711)");
          // Synchronize the test with the original connection without delivering its acknowledgement.
          await commit;
          assert.deepEqual(await replay, outcome("issued", revision));
        }
        assert.deepEqual(await send(input), outcome("issued", revision));
        assert.deepEqual(await snapshot(input), { pointer: { revision, state: "issued", proof: input.proof },
          ledger: { state: "issued", result_revision: revision } });
      } finally {
        await admin.query("SELECT pg_advisory_unlock_all()");
        await Promise.allSettled([commit, replay]);
      }
    }
    const lostAcknowledgement = command(targetA, current, 2);
    await holdCommit(lostAcknowledgement, 3, false);
    await sameBytes(targetA, current);
    const renewed = await changeProof(targetA, true, true);
    await holdCommit(command(targetA, renewed, 3), 4, true);
    await sameBytes(targetA, renewed);
    await sameBytes(targetB, initialB);
    await admin.query("UPDATE pcm_issuance.control SET work_number=2 WHERE singleton");
    assert.deepEqual(await send(lostAcknowledgement), outcome("unavailable"));
    assert.deepEqual(await send({ ...lostAcknowledgement, work: 2 }), outcome("issued", 3));
    await sameBytes(targetA, renewed);
    console.log("Owned PG17 PCM issuance: real registered bytes, approval/revocation CAS, owner/role isolation, pending and cancelled COMMIT reconciled once");
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
  }
  assert.equal(Number((await first(admin, "SELECT count(*) AS count FROM pg_stat_activity WHERE application_name='pcm-issuance-fixture'")).count), 0);
}
