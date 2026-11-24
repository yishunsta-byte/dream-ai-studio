import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, type QueryResultRow } from "pg";
import { v7 } from "uuid";
import { inspectPcmWav } from "../../lib/services/postgres/pcm-wav";
import { verify as verifyIssuance } from "./registered-pcm-wav-issuance.pg17";

type Fixture = Parameters<typeof verifyIssuance>[0];
type Binding = { database: string; oid: string; generation: string; work: number };
type Target = { owner: string; project: string; asset: string };
type Proof = { registrationGeneration: number; approvalGeneration: number; sha256: string; sizeBytes: number };
type Selection = Target & { proof: Proof; content: Buffer };
type Request = { id: string; binding: Binding; target: Target; proof: Proof; revision: number };
const sourceDb = "dream_test_t367";
const restoredDb = "dream_test_pcm_restore";
const controlDb = "dream_test_pcm_restore_control";
const roles = { issuer: "pcm_issuance_issuer", reader: "pcm_issuance_reader" } as const;
const restoredLogins = { issuer: "pcm_restore_issuer_login", reader: "pcm_restore_reader_login" } as const;
const unavailable = Object.freeze({ outcome: "unavailable", revision: null, changed: false });
const exec = promisify(execFile);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const result = (outcome: string, revision: number | null = null, changed = false) => ({ outcome, revision, changed });
async function first<T extends QueryResultRow = QueryResultRow>(client: Client, sql: string, values: unknown[] = []) {
  return (await client.query<T>(sql, values)).rows[0];
}

function restoreTool() {
  const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin/", import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "TEMP", "TMP"].includes(key.toUpperCase())));
  const checksums = {
    pg_dump: "64539be632194750c9846f3a22056ffd15500310d9aefae6a46fc5b48fdd9928",
    pg_restore: "ea7e1d1855f720d0593cb1683b38e12e215dd26302decb2759aaf7972bc52382",
  } as const;
  return async (tool: keyof typeof checksums, args: string[], password: string) => {
    const path = join(bin, tool + ".exe");
    assert.equal((await realpath(path)).toLowerCase(), path.toLowerCase(), "Linked restore tool denied");
    assert.equal(sha(await readFile(path)), checksums[tool], "Fixed PG17.12 backup binary");
    await exec(path, ["-w", ...args], {
      env: { ...env, NODE_ENV: "test", PGPASSWORD: password },
      windowsHide: true,
      timeout: 30_000,
    });
  };
}

const identity = `SELECT current_database() AS database,
  (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
const bindingSql = `SELECT db_name AS database,db_oid AS oid,generation,work
  FROM external_control.binding WHERE singleton AND state='active' FOR SHARE`;
const targetIdentity = `SELECT i.*,c.restore_gen AS generation,c.work_number AS work
  FROM (${identity}) i CROSS JOIN pcm_issuance.control c WHERE c.singleton`;
const sameBinding = (actual: Binding | undefined, requested: Binding) => !!actual &&
  actual.database === requested.database && actual.oid === requested.oid &&
  actual.generation === requested.generation && actual.work === requested.work;

// This server-side fixture gate holds the external decision stable through the data transaction.
async function withBinding<T>(
  control: Client, data: Client, role: keyof typeof roles, binding: Binding, owner: string, action: () => Promise<T>,
) {
  await control.query("BEGIN");
  try {
    if (!sameBinding(await first<Binding>(control, bindingSql), binding)) return undefined;
    await data.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    let committed = false;
    try {
      const connected = await first<Pick<Binding, "database" | "oid">>(data, identity);
      if (connected?.database !== binding.database || connected.oid !== binding.oid) return undefined;
      await data.query(`SET LOCAL ROLE ${roles[role]}`);
      if (!sameBinding(await first<Binding>(data, targetIdentity), binding)) return undefined;
      await data.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
      const output = await action();
      await data.query("COMMIT");
      committed = true;
      return output;
    } finally {
      // Also clears the transaction on an identity mismatch or a failed command.
      if (!committed) await data.query("ROLLBACK");
    }
  } finally {
    await control.query("ROLLBACK");
  }
}

const selectionSql = `SELECT p.owner_id AS owner,p.project_id AS project,p.asset_id AS asset,p.proof,w.content
  FROM pcm_issuance.pointer p JOIN local_wav.files w USING(owner_id,asset_id)
  WHERE p.restore_gen=$1 AND p.owner_id=$2 AND p.state='issued'`;
const historical = (client: Client, generation: string) => first(client, `SELECT
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY owner_id,project_id,asset_id)
    FROM pcm_issuance.pointer p WHERE restore_gen=$1) AS pointers,
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY request_id)
    FROM pcm_issuance.requests l WHERE restore_gen=$1) AS requests`, [generation]);
const liveApproval = (client: Client, target: Target) => first(client, `SELECT active,generation,registration_generation
  FROM pcm_fixture.approvals WHERE (owner_id,project_id,asset_id)=($1,$2,$3)`, [target.owner,target.project,target.asset]);
const reapprove = (client: Client, proof: Selection, generation: number) => client.query(`UPDATE pcm_fixture.approvals
  SET active=true,generation=generation+1,registration_generation=$4
  WHERE (owner_id,project_id,asset_id)=($1,$2,$3) AND NOT active`, [proof.owner,proof.project,proof.asset,generation]);

export async function verify(fixture: Fixture) {
  await verifyIssuance(fixture);
  const { admin, cfg, a, b } = fixture;
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.database, sourceDb);
  assert.equal(cfg.ssl, false);
  const pg = await first(admin, `SELECT host(inet_server_addr()) AS address,inet_server_port() AS port,
    current_setting('dream.t367_owned',true) AS owned,current_setting('server_version_num') AS version`);
  assert.deepEqual(pg, { address: cfg.host, port: cfg.port, owned: "on", version: "170012" });
  assert(admin.user);
  const runTool = restoreTool();
  const root = await mkdtemp(join(await realpath(tmpdir()), "dream-pcm-restore-"));
  const archive = join(root, "fixture.dump");
  const clients = new Set<Client>();
  function client(database: string, user = admin.user, password = cfg.password) {
    const connection = new Client({ ...cfg, database, user, password, statement_timeout: 8000, application_name: "pcm-restore-fixture" });
    clients.add(connection);
    return connection;
  }
  const toolTarget = ["-h", cfg.host, "-p", String(cfg.port), "-U", admin.user];
  try {
    await admin.query("CREATE DATABASE dream_test_pcm_restore TEMPLATE template0");
    await admin.query("CREATE DATABASE dream_test_pcm_restore_control TEMPLATE template0");
    await admin.query("REVOKE CONNECT ON DATABASE dream_test_pcm_restore,dream_test_pcm_restore_control FROM PUBLIC");
    const restored = client(restoredDb);
    const controller = client(controlDb);
    await Promise.all([restored.connect(), controller.connect()]);
    await admin.query("GRANT SELECT ON pcm_issuance.control TO pcm_issuance_reader,pcm_issuance_issuer");
    const old = await first<Binding>(admin, targetIdentity);
    const restoredIdentity = await first<Pick<Binding,"database" | "oid">>(restored, identity);
    assert.notEqual(old.oid, restoredIdentity.oid);
    const next = { ...restoredIdentity, generation: randomUUID(), work: old.work + 1 };
    await controller.query(`CREATE SCHEMA external_control;
      CREATE TABLE external_control.binding(singleton boolean PRIMARY KEY CHECK(singleton),db_name text NOT NULL,
        db_oid text NOT NULL,generation text NOT NULL,work integer NOT NULL,
        state text NOT NULL CHECK(state IN ('closed','preparing','active')))`);
    await controller.query("INSERT INTO external_control.binding VALUES(true,$1,$2,$3,$4,'active')",
      [old.database,old.oid,old.generation,old.work]);

    const oldReader = client(sourceDb, "pcm_issuance_reader_login");
    const oldIssuer = client(sourceDb, "pcm_issuance_issuer_login");
    await Promise.all([oldReader.connect(), oldIssuer.connect()]);
    const aFile = await first<Selection>(admin, selectionSql, [old.generation,a.id]);
    const bFile = await first<Selection>(admin, selectionSql, [old.generation,b.id]);
    const request = (target: Target, proof: Proof, binding: Binding, revision = 0): Request =>
      ({ id: v7(), target, proof, binding, revision });
    const read = (data: Client, binding: Binding, target: Target, owner = target.owner) =>
      withBinding(controller, data, "reader", binding, owner, () => first(data,
        "SELECT * FROM pcm_issuance.read_current($1,$2)", [target.project,target.asset]));
    const observe = (data: Client, binding: Binding, input: Request) =>
      withBinding(controller, data, "issuer", binding, input.target.owner, () => first(data,
        "SELECT * FROM pcm_issuance.observe($1)", [input.id]));
    const send = async (data: Client, input: Request, reserve = false) =>
      (await withBinding(controller, data, "issuer", input.binding, input.target.owner, () => first(data,
        "SELECT * FROM pcm_issuance.request($1,$2,'issue',$3,$4,$5,$6,$7)",
        [input.id,input.binding.work,input.target.project,input.target.asset,input.proof,input.revision,reserve]))) ?? unavailable;

    const confirmedId = await first(admin, `SELECT request_id FROM pcm_issuance.requests
      WHERE restore_gen=$1 AND owner_id=$2 AND state='issued' AND result_revision=4`, [old.generation,a.id]);
    const confirmed = { ...request(aFile,aFile.proof,old,3), id: confirmedId.request_id as string };
    const pending = request(aFile,aFile.proof,old,4);
    assert.deepEqual(await read(oldReader,old,aFile), { proof:aFile.proof, content:aFile.content });
    assert.deepEqual(await read(oldReader,old,bFile), { proof:bFile.proof, content:bFile.content });
    assert.deepEqual(await observe(oldIssuer,old,confirmed), { state:"issued", revision:4 });
    assert.deepEqual(await send(oldIssuer,confirmed), result("issued",4));
    assert.deepEqual(await send(oldIssuer,pending,true), result("reserved"));
    const history = await historical(admin,old.generation);

    await runTool("pg_dump", [...toolTarget, "-Fc", "-d", sourceDb, "-f", archive], cfg.password);
    await runTool("pg_restore", [...toolTarget, "--single-transaction", "--exit-on-error", "-d", restoredDb, archive], cfg.password);
    assert.deepEqual(await historical(restored,old.generation), history);
    assert.deepEqual(await first<Selection>(restored,selectionSql,[old.generation,a.id]), aFile);
    assert.deepEqual(await first<Selection>(restored,selectionSql,[old.generation,b.id]), bFile);
    assert.equal((await liveApproval(restored,bFile)).active, true);
    // Source withdraws B after the backup. The restored approval still says active.
    assert.equal((await admin.query(`UPDATE pcm_fixture.approvals SET active=false,generation=generation+1
      WHERE owner_id=$1 AND asset_id=$2 AND active`, [bFile.owner,bFile.asset])).rowCount, 1);
    assert.equal(await read(oldReader,old,bFile), undefined);
    assert.equal((await liveApproval(restored,bFile)).active, true);

    const password = randomBytes(24).toString("hex");
    const { quoted } = await first(restored, "SELECT quote_literal($1::text) AS quoted", [password]);
    for (const key of ["issuer","reader"] as const) {
      await restored.query(`CREATE ROLE ${restoredLogins[key]} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${quoted}`);
      await restored.query(`GRANT CONNECT ON DATABASE dream_test_pcm_restore TO ${restoredLogins[key]}`);
    }
    const reader = client(restoredDb,restoredLogins.reader,password);
    const issuer = client(restoredDb,restoredLogins.issuer,password);
    await Promise.all([reader.connect(), issuer.connect()]);
    await assert.rejects(client(restoredDb,"pcm_issuance_issuer_login").connect(), { code:"42501" });
    await assert.rejects(client(controlDb,restoredLogins.issuer,password).connect(), { code:"42501" });
    await assert.rejects(reader.query("SET ROLE pcm_issuance_reader"), { code:"42501" });
    await assert.rejects(issuer.query("SET ROLE pcm_issuance_issuer"), { code:"42501" });
    const restoredOld = { ...old, ...restoredIdentity };
    assert.equal(await read(reader,old,aFile), undefined); // External source pin passes, actual DB identity fails.
    assert.equal(await read(reader,restoredOld,aFile), undefined); // No external binding for the restored database.
    assert.equal(await observe(issuer,old,confirmed), undefined);
    assert.deepEqual(await send(issuer,pending), unavailable);
    assert.deepEqual(await historical(restored,old.generation), history);

    assert.equal((await controller.query(`UPDATE external_control.binding SET state='closed'
      WHERE singleton AND state='active' AND db_oid=$1 AND generation=$2 AND work=$3`, [old.oid,old.generation,old.work])).rowCount, 1);
    assert.equal(await read(oldReader,old,aFile), undefined);
    assert.deepEqual(await send(oldIssuer,pending), unavailable);
    await Promise.all([oldReader.end(),oldIssuer.end()]);
    clients.delete(oldReader);
    clients.delete(oldIssuer);
    await admin.query("ALTER ROLE pcm_issuance_reader_login NOLOGIN; ALTER ROLE pcm_issuance_issuer_login NOLOGIN");
    await assert.rejects(client(sourceDb,"pcm_issuance_issuer_login").connect(), { code:"28000" });
    assert.equal((await controller.query(`UPDATE external_control.binding SET db_name=$1,db_oid=$2,generation=$3,work=$4,state='preparing'
      WHERE singleton AND state='closed' AND generation=$5`, [next.database,next.oid,next.generation,next.work,old.generation])).rowCount, 1);
    await restored.query("BEGIN");
    try {
      assert.equal((await restored.query(`UPDATE pcm_issuance.control SET restore_gen=$1,work_number=$2
        WHERE singleton AND restore_gen=$3 AND work_number=$4`, [next.generation,next.work,old.generation,old.work])).rowCount, 1);
      assert.equal((await restored.query("UPDATE pcm_fixture.approvals SET active=false WHERE active")).rowCount, 2);
      for (const key of ["issuer","reader"] as const) {
        await restored.query(`GRANT ${roles[key]} TO ${restoredLogins[key]} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
      }
      await restored.query("COMMIT");
    } catch (error) {
      await restored.query("ROLLBACK");
      throw error;
    }
    assert.equal(await read(reader,next,aFile), undefined);
    assert.deepEqual(await send(issuer,request(aFile,aFile.proof,next),true), unavailable);

    assert.equal((await controller.query(`UPDATE external_control.binding SET state='active'
      WHERE singleton AND state='preparing' AND db_oid=$1 AND generation=$2 AND work=$3`, [next.oid,next.generation,next.work])).rowCount, 1);
    for (const input of [confirmed,pending]) {
      assert.equal(await observe(issuer,next,input), undefined);
      assert.deepEqual(await send(issuer,input,true), unavailable);
      assert.deepEqual(await send(issuer,input), unavailable);
      assert.deepEqual(await send(issuer,{ ...input,binding:next }), result("reservation_required"));
    }
    assert.deepEqual(await send(issuer,{ ...pending,binding:{ ...next,work:old.work } },true), unavailable);
    assert.deepEqual(await historical(restored,next.generation), { pointers:null,requests:null });
    assert.deepEqual(await historical(restored,old.generation), history);
    assert.equal(await read(reader,next,aFile), undefined);
    assert.equal(await read(reader,next,bFile), undefined);

    const stale = request(aFile,aFile.proof,next);
    assert.deepEqual(await send(issuer,stale,true), result("reserved"));
    assert.deepEqual(await send(issuer,stale), result("stale_evidence"));
    const { content, digest } = await first(restored,"SELECT content,digest FROM local_wav.files WHERE (owner_id,asset_id)=($1,$2)",
      [aFile.owner,aFile.asset]);
    assert.deepEqual(inspectPcmWav(content), { channels:1,sampleRate:8000,frames:1000 });
    assert.deepEqual(content,aFile.content);
    assert.equal(sha(content),aFile.proof.sha256);
    assert.equal(digest,aFile.proof.sha256);
    const reg = await first(restored,`UPDATE pcm_fixture.registrations SET generation=generation+1
      WHERE (owner_id,asset_id,generation,sha256,size_bytes)=($1,$2,$3,$4,$5) RETURNING generation`,
    [aFile.owner,aFile.asset,aFile.proof.registrationGeneration,digest,content.length]);
    assert.equal(reg.generation,aFile.proof.registrationGeneration+1);
    assert.equal(await read(reader,next,aFile), undefined);
    const freshProof = { ...aFile.proof, registrationGeneration:reg.generation, approvalGeneration:aFile.proof.approvalGeneration+1 };
    const beforeApproval = request(aFile,freshProof,next);
    assert.deepEqual(await send(issuer,beforeApproval,true), result("reserved"));
    assert.deepEqual(await send(issuer,beforeApproval), result("stale_evidence"));
    assert.equal((await reapprove(restored,aFile,reg.generation)).rowCount, 1);
    assert.deepEqual(await send(issuer,stale), result("stale_evidence"));
    assert.equal(await read(reader,next,aFile), undefined);
    const fresh = request(aFile,freshProof,next);
    assert.deepEqual(await send(issuer,fresh,true), result("reserved"));
    assert.deepEqual(await send(issuer,fresh), result("issued",1,true));
    assert.deepEqual(await send(issuer,fresh), result("issued",1));
    assert.deepEqual(await read(reader,next,aFile), { proof:freshProof,content:aFile.content });
    assert.equal(await read(reader,next,aFile,bFile.owner), undefined);
    assert.equal(await read(reader,next,bFile), undefined);
    assert.deepEqual(await observe(issuer,next,fresh), { state:"issued",revision:1 });
    assert.equal(await observe(issuer,next,confirmed), undefined);
    assert.deepEqual(await send(issuer,pending), unavailable);
    assert.deepEqual(await historical(restored,old.generation), history);
    const current = await historical(restored,next.generation);
    assert.equal(current.pointers.length, 1);
    assert.equal(current.requests.filter((row: { state: string }) => row.state === "issued").length, 1);
    // Closing the external binding blocks an otherwise-current local proof and replay.
    await controller.query("UPDATE external_control.binding SET state='closed' WHERE singleton");
    assert.equal(await read(reader,next,aFile), undefined);
    assert.equal(await observe(issuer,next,fresh), undefined);
    assert.deepEqual(await send(issuer,fresh), unavailable);
    assert.deepEqual(await historical(restored,next.generation), current);
    console.log("Owned PG17 PCM restore: actual archive, rollback of approval in backup, external database and work fence, fresh verification and approval, historical no-op");
  } finally {
    await Promise.allSettled(Array.from(clients, connection => connection.end()));
    await unlink(archive).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(root);
  }
  assert.equal((await first(admin, "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name='pcm-restore-fixture'")).count, 0);
}
