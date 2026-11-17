// B29: explicit owned Windows PG18.7 fixture only. Never reads .env or a DSN.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { decodeUploadReservation, encodeUploadReservation } from "../lib/db/postgres/upload-reservation-codec";
import { canonicalJson } from "../lib/storage/uploads/receipt";
import { reserveUpload } from "../lib/storage/uploads/state";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --import tsx tests/b29-reservation-races-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b29-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B29_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B29_ASSERT: ${label}`); };
const run = async (exe: string, args: string[], name: string, timeout = 60000) => {
  try {
    const out = await exec(exe, args, { cwd: repo, env: childEnv, windowsHide: true, timeout, maxBuffer: 4 * 1024 ** 2 });
    await writeFile(join(root, name), out.stdout + out.stderr); return out.stdout;
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string };
    await writeFile(join(root, name), (e.stdout ?? "") + (e.stderr ?? "")); throw error;
  }
};
const nativeError = (error: unknown) => {
  const e = error as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const key of ["message", "code", "detail", "hint", "where", "position", "internalPosition", "internalQuery", "schema", "table", "constraint", "routine"]) {
    if (e[key] !== undefined) result[key] = String(e[key]).replaceAll(password, "[synthetic-secret-redacted]");
  }
  return result;
};
const connect = async (database: string, user = "b29_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B29-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
    statement_timeout: 30000, query_timeout: 45000 });
  clients.add(c); await c.connect(); return c;
};
const close = async (c: Client) => { try { await c.end(); } finally { clients.delete(c); } };
const src = [
  ["0001_schema.sql", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification.sql", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
] as const;
const fuse = "DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;";
let activeSource: { text: string; label: string; offset: number } | undefined;
let sql5: string, derived: string;
try {
  const baseline: string[] = [];
  for (const [name, expected] of src) {
    const text = lf(await readFile(join(repo, "lib/db/postgres", name), "utf8"));
    verify(sha(text) === expected, `${name} protected source hash`); baseline.push(text);
  }
  sql5 = lf(await readFile(join(repo, "lib/db/postgres/drafts/0005_upload_reservation.sql"), "utf8"));
  verify(sha(sql5) === "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb", "fixed fbfc48c SQL5 hash");
  verify(sql5.split(fuse).length === 2, "one exact known fuse");
  const fuseAt = sql5.indexOf(fuse);
  derived = sql5.slice(0, fuseAt) + sql5.slice(fuseAt + fuse.length);
  verify(derived.slice(0, fuseAt) + fuse + derived.slice(fuseAt) === sql5, "fuse-only exact derivation");
  await writeFile(join(root, "sql5-original.sql"), sql5);
  await writeFile(join(root, "sql5-fuse-only-derived.sql"), derived);
  await writeFile(join(root, "fuse-only.diff"), `--- fixed-fbfc48c.sql\n+++ B29-owned-derived.sql\n@@ -5 +5 @@\n-${fuse}\n+\n`);
  await save("derivation.json", { sourceCommit: "fbfc48c95264eaf37826f943b5e35e9fe67fa616", originalSha: sha(sql5),
    derivedSha: sha(derived), removedStatement: fuse, removedAt: fuseAt, removedLength: fuse.length,
    exactOneStatementOnly: true, lineCountPreserved: true, executionScope: "this owned B29 cluster only" });
  await save("ownership.json", { task: "B29", root, cluster, bin, nonce: randomUUID() });
  console.log(`B29 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B29_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b29_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`,
    "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", 150000);
  const listener = createServer();
  port = await new Promise<number>((res, rej) => { listener.once("error", rej); listener.listen(0, "127.0.0.1", () => {
    const address = listener.address(); if (!address || typeof address === "string") return rej(new Error("No owned port"));
    listener.close(error => error ? rej(error) : res(address.port));
  }); });
  verify(port !== 3013, "never shared app port"); startAttempted = true;
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], "start.log");
  const pidLines = (await readFile(join(cluster, "postmaster.pid"), "utf8")).trim().split(/\r?\n/);
  pid = Number(pidLines[0]);
  verify(resolve(pidLines[1]) === resolve(cluster) && Number(pidLines[3]) === port, "owned PID directory and port");
  await run(powershell, ["-NoProfile", "-Command", `$l=@(Get-NetTCPConnection -LocalPort ${port} -State Listen); if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1' -or $l[0].OwningProcess -ne ${pid}) { exit 1 }; Write-Output 'Owned loopback PID verified'`], "listener.log");
  await save("run.json", { root, cluster, bin, pid, port, address: "127.0.0.1", sourceSha: sha(sql5), derivedSha: sha(derived) });

  const admin = await connect("postgres");
  await admin.query(`CREATE ROLE b29_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  await admin.query("CREATE DATABASE b29_fixture OWNER b29_migration TEMPLATE template0 ENCODING 'UTF8'");
  const migration = await connect("b29_fixture", "b29_migration");
  const observer = await connect("b29_fixture");
  const principals = (await admin.query("SELECT oid,rolname,rolsuper,rolcreaterole FROM pg_roles WHERE rolname IN ('b29_bootstrap','b29_migration') ORDER BY rolname")).rows;
  const migrationOid = principals.find(p => p.rolname === "b29_migration")?.oid;
  const rootOid = principals.find(p => p.rolname === "b29_bootstrap")?.oid;
  verify(migrationOid && rootOid, "native migration and bootstrap OIDs");
  await save("principals.json", principals);
  stage = "full SQL1-4 baseline";
  console.log(`B29 ${stage}`);
  await migration.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (let n = 0; n < baseline.length; n++) {
    activeSource = { text: baseline[n], label: src[n][0], offset: 0 };
    await migration.query(baseline[n]);
  }
  await migration.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false),set_config('dream.b27_bootstrap_oid',$2,false),set_config('dream.b27_expected_pg_major','18',false)", [String(migrationOid), String(rootOid)]);
  stage = "fixed fuse-only SQL5 apply";
  activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: 0 };
  await migration.query(derived); await close(migration); activeSource = undefined;
  const owner = "00000000-0000-4000-8000-000000000001", worker = "00000000-0000-4000-8000-000000000002";
  const body = { bodyVersion: 1, collectors: [worker], incomingBucket: "synthetic-incoming", intentTtlMs: 120000,
    issueEnvelopeMs: 90000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3,
    maxPreparationAgeMs: 60000, policyManagers: [owner], providerMaxBytes: 1048576, verifiers: [worker] };
  const rawBody = canonicalJson(body), digest = "b".repeat(64);
  await observer.query("INSERT INTO auth.users(id) VALUES($1),($2)", [owner, worker]);
  await observer.query("INSERT INTO dream.storage_policy_versions VALUES('asset-upload',7,$1,clock_timestamp())", [digest]);
  await observer.query("INSERT INTO dream.storage_policies VALUES('asset-upload',7,$1,0,clock_timestamp())", [digest]);
  await observer.query("INSERT INTO dream_reservation.upload_policy_versions VALUES('asset-upload',7,$1,$2,$3)", [digest, rawBody, sha(`upload-policy-body:v1\n${rawBody}`)]);
  for (const login of ["b29_api_a", "b29_api_b"]) {
    await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'; GRANT dream_api TO ${login} WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  }
  await save("synthetic-fixture.json", { owner, worker, body, digest, adminSeedOnly: true, noOperationalPolicyApproval: true });
  const modes = ["same-payload-commit", "different-payload-commit", "winner-rollback"] as const;
  for (let index = 0; index < modes.length; index++) {
    stage = modes[index]; console.log(`B29 race: ${stage}`);
    const winner = await connect("b29_fixture", "b29_api_a");
    const loser = await connect("b29_fixture", "b29_api_b");
    const clock = () => performance.now();
    const events: { action: string; ms: number; value?: unknown }[] = [];
    let pending: Promise<{ result?: Record<string, unknown>; error?: unknown }> | undefined;
    let settled = false;
    try {
      const identitySql = "SELECT pg_backend_pid() AS pid,current_user,session_user,current_user::regrole::oid AS login_oid,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolinherit FROM pg_roles r WHERE r.oid=current_user::regrole";
      const winnerIdentity = (await winner.query(identitySql)).rows[0];
      const loserIdentity = (await loser.query(identitySql)).rows[0];
      verify(winnerIdentity.pid !== loserIdentity.pid && winnerIdentity.login_oid !== loserIdentity.login_oid, "two distinct backends and restricted logins");
      for (const identity of [winnerIdentity, loserIdentity]) verify(!identity.rolsuper && !identity.rolbypassrls && !identity.rolcreaterole && !identity.rolinherit, "actual restricted flags");
      for (const c of [winner, loser]) {
        await c.query("BEGIN; SET LOCAL ROLE dream_api");
        await c.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
        verify((await c.query("SELECT current_user AS role,current_setting('transaction_isolation') AS isolation")).rows[0].role === "dream_api", "API role before bounded entry");
      }
      const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
      const base = (index + 1) * 20, requestId = uid(base + 19);
      const clientA = '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}';
      const clientB = modes[index] === "different-payload-commit"
        ? '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":2048}' : clientA;
      const propose = async (c: Client, client: string, idBase: number, bytes: number) => {
        const seed = (await c.query("SELECT dream_reservation.read_upload_seed_v1($1,$2) AS result", [requestId, client])).rows[0].result;
        verify(seed.tag === "seed", `fresh seed got ${String(seed.tag)}`);
        const reservation = { ownerId: owner, objectId: uid(idBase), assetId: uid(idBase + 1), intentId: uid(idBase + 2),
          intentExpiresAt: seed.now + body.intentTtlMs, issueEnvelopeUntil: seed.now + body.issueEnvelopeMs,
          maxIssues: body.maxIssues, verifiers: body.verifiers, collectors: body.collectors, policyManagers: body.policyManagers,
          policyEpoch: 7, policyDigest: digest,
          incoming: { bucket: body.incomingBucket, key: `${owner}/incoming/${uid(idBase)}/${uid(idBase + 2)}`, providerVersion: null } };
        const model = reserveUpload(reservation, { principalId: owner, now: seed.now, expectedRevision: 0 });
        const raw = ` \n${JSON.stringify({ codecVersion: 1, requestId, maxBytes: bytes, reservedAt: seed.now, reservation }, null, 2)}\t `;
        return { client, seed, codec: encodeUploadReservation({ model, requestJson: raw }) };
      };
      const a = await propose(winner, clientA, base + 1, 1024);
      const b = await propose(loser, clientB, base + 5, clientB === clientA ? 1024 : 2048);
      verify(a.codec.model.objectId !== b.codec.model.objectId && a.codec.model.assetId !== b.codec.model.assetId
        && a.codec.model.intentId !== b.codec.model.intentId && a.codec.rawSha !== b.codec.rawSha
        && a.codec.fingerprint !== b.codec.fingerprint, "different proposed identities and raw/server fingerprints");
      const entry = "SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS result";
      const stagedA = (await winner.query(entry, [requestId, a.client, a.codec.requestJson])).rows[0].result;
      verify(stagedA.tag === "staged" && stagedA.commitConfirmed === false && stagedA.issuanceAuthorized === false, "winner stages without confirming commit/capability");
      events.push({ action: "winner-staged", ms: clock(), value: stagedA });
      events.push({ action: "loser-query-start", ms: clock() });
      // Attach rejection immediately; cleanup releases winner first if probing fails.
      pending = loser.query(entry, [requestId, b.client, b.codec.requestJson]).then(r => {
        settled = true; events.push({ action: "loser-return", ms: clock(), value: r.rows[0].result });
        return { result: r.rows[0].result as Record<string, unknown> };
      }, error => { settled = true; events.push({ action: "loser-error", ms: clock(), value: nativeError(error) }); return { error }; });
      const samples: unknown[] = [];
      let blocked = false;
      const deadline = clock() + 7000;
      while (clock() < deadline && !settled) {
        const rows = (await observer.query("SELECT pid,usename,state,wait_event_type,wait_event,backend_xid::text,xact_start::text,query_start::text,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=ANY($1::integer[]) ORDER BY pid", [[winnerIdentity.pid, loserIdentity.pid]])).rows;
        samples.push({ ms: clock(), rows });
        const w = rows.find(r => r.pid === winnerIdentity.pid), l = rows.find(r => r.pid === loserIdentity.pid);
        if (w?.state === "idle in transaction" && w.xact_start && l?.state === "active" && l.xact_start
          && l.wait_event_type === "Lock" && l.blockers.includes(winnerIdentity.pid)) { blocked = true; break; }
        await new Promise(res => setTimeout(res, 25)); // scheduling only; never evidence of blocking
      }
      await save(`${modes[index]}-blocked.json`, { winnerIdentity, loserIdentity, blocked, settledBeforeRelease: settled, samples });
      verify(blocked && !settled, "native pg_blocking_pids plus Lock wait observed before releasing winner");
      const beforeRelease = (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests WHERE owner_id=$1 AND request_id=$2) AS requests,(SELECT count(*) FROM dream.upload_intents WHERE owner_id=$1 AND request_id=$2) AS intents", [owner, requestId])).rows[0];
      verify(Number(beforeRelease.requests) === 0 && Number(beforeRelease.intents) === 0, "observer cannot see either uncommitted reservation");
      events.push({ action: "native-block-confirmed", ms: clock() });
      const commandA = modes[index] === "winner-rollback" ? "ROLLBACK" : "COMMIT";
      const releaseAt = clock(); events.push({ action: `winner-${commandA}-start`, ms: releaseAt });
      const finalizedA = await winner.query(commandA);
      verify(finalizedA.command === commandA, "actual winner finalization command");
      events.push({ action: `winner-${commandA}-confirmed`, ms: clock() });
      const resolved = await pending;
      if (resolved.error) throw resolved.error;
      const responseB = resolved.result;
      verify(responseB && events.find(e => e.action === "loser-return")!.ms >= releaseAt, "loser returned only after release began");
      const expectedTag = modes[index] === "winner-rollback" ? "staged" : modes[index] === "same-payload-commit" ? "replay" : "CONFLICT";
      verify(responseB?.tag === expectedTag, `${modes[index]} actual loser tag ${String(responseB?.tag)}`);
      if (expectedTag !== "CONFLICT") verify(responseB?.issuanceAuthorized === false, "loser cannot issue capabilities");
      if (expectedTag === "replay") verify(canonicalJson(responseB?.reservation) === canonicalJson(stagedA.reservation)
        && responseB?.originalEnvelope === a.codec.requestJson, "loser replay is exact original winner snapshot, not proposed replacement");
      if (expectedTag === "staged") {
        verify(responseB?.commitConfirmed === false, "new loser stage remains provisional");
        const hidden = (await observer.query("SELECT count(*) AS n FROM dream_reservation.upload_requests WHERE owner_id=$1 AND request_id=$2", [owner, requestId])).rows[0];
        verify(Number(hidden.n) === 0, "rollback successor not visible before its own commit");
      }
      const commandB = expectedTag === "CONFLICT" ? "ROLLBACK" : "COMMIT";
      events.push({ action: `loser-${commandB}-start`, ms: clock() });
      const finalizedB = await loser.query(commandB); verify(finalizedB.command === commandB, "actual loser finalization command");
      events.push({ action: `loser-${commandB}-confirmed`, ms: clock() });
      const expected = commandA === "ROLLBACK" ? b : a, rejected = expected === a ? b : a;
      const durable = (await observer.query("SELECT h.owner_id,h.request_id,h.client_json,h.client_digest,h.object_id,h.intent_id,h.reservation_fingerprint,h.reservation_raw_sha,h.result_json,i.request_json,i.request_fingerprint,i.request_raw_sha,o.reserved_asset_id FROM dream_reservation.upload_requests h JOIN dream.upload_intents i ON (i.owner_id,i.request_id,i.id,i.object_id)=(h.owner_id,h.request_id,h.intent_id,h.object_id) JOIN dream.storage_objects o ON (o.owner_id,o.id)=(h.owner_id,h.object_id) WHERE h.owner_id=$1 AND h.request_id=$2", [owner, requestId])).rows;
      verify(durable.length === 1, "one durable owner/request triple join");
      const row = durable[0];
      verify(row.object_id === expected.codec.model.objectId && row.intent_id === expected.codec.model.intentId
        && row.reserved_asset_id === expected.codec.model.assetId && row.client_json === expected.client
        && row.client_digest === sha(`upload-reservation-client:v1\n${expected.client}`)
        && row.request_json === expected.codec.requestJson && row.request_fingerprint === expected.codec.fingerprint
        && row.reservation_fingerprint === expected.codec.fingerprint && row.request_raw_sha === expected.codec.rawSha
        && row.reservation_raw_sha === expected.codec.rawSha, "durable IDs/client/server raw hashes match selected original proposal");
      const counts = (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests WHERE owner_id=$1 AND request_id=$2) AS requests,(SELECT count(*) FROM dream.upload_intents WHERE owner_id=$1 AND request_id=$2) AS intents,(SELECT count(*) FROM dream.storage_objects WHERE owner_id=$1 AND id=ANY($3::uuid[])) AS candidate_objects,(SELECT count(*) FROM dream.storage_objects WHERE owner_id=$1 AND id=$4) AS rejected_objects,(SELECT count(*) FROM dream.upload_intents WHERE owner_id=$1 AND id=$5) AS rejected_intents,(SELECT count(*) FROM dream.storage_capability_issues) AS capabilities,(SELECT count(*) FROM dream.storage_outbox) AS outbox", [owner, requestId, [a.codec.model.objectId, b.codec.model.objectId], rejected.codec.model.objectId, rejected.codec.model.intentId])).rows[0];
      verify(Number(counts.requests) === 1 && Number(counts.intents) === 1 && Number(counts.candidate_objects) === 1
        && Number(counts.rejected_objects) === 0 && Number(counts.rejected_intents) === 0
        && Number(counts.capabilities) === 0 && Number(counts.outbox) === 0, "exact triple and no rejected candidate/capability/outbox writes");
      const objectRow = (await observer.query(expected.codec.selectObject.text, [...expected.codec.selectObject.values])).rows[0];
      const intentRow = (await observer.query(expected.codec.selectIntent.text, [...expected.codec.selectIntent.values])).rows[0];
      const decoded = decodeUploadReservation({ object: objectRow, intent: intentRow });
      verify(canonicalJson(decoded.model) === canonicalJson(expected.codec.model) && decoded.requestJson === expected.codec.requestJson
        && decoded.fingerprint === expected.codec.fingerprint && decoded.rawSha === expected.codec.rawSha, "native committed B25 whole-row projection roundtrip");
      const result = { case: modes[index], requestId, winnerIdentity, loserIdentity, events, observedNativeBlock: true,
        winner: { client: a.client, originalEnvelope: a.codec.requestJson, rawSha: a.codec.rawSha, fingerprint: a.codec.fingerprint,
          stagedReturn: stagedA, actualFinalization: finalizedA.command },
        loser: { client: b.client, proposedEnvelope: b.codec.requestJson, rawSha: b.codec.rawSha, fingerprint: b.codec.fingerprint,
          return: responseB, actualFinalization: finalizedB.command }, beforeRelease, durable, counts,
        durableProposal: expected === a ? "winner-original" : "waiter-original", nativeB25Roundtrip: true };
      facts.push(result); await save(`${modes[index]}-result.json`, result); await save("checks.json", facts);
    } finally {
      // Release the blocker first; never queue ROLLBACK behind an unresolved waiter.
      await winner.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending;
      await loser.query("ROLLBACK").catch(() => undefined);
      await close(winner); await close(loser);
    }
  }
  const totals = (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests) AS requests,(SELECT count(*) FROM dream.storage_objects) AS objects,(SELECT count(*) FROM dream.upload_intents) AS intents,(SELECT count(*) FROM dream.storage_capability_issues) AS capabilities")).rows[0];
  verify(Number(totals.requests) === 3 && Number(totals.objects) === 3 && Number(totals.intents) === 3 && Number(totals.capabilities) === 0, "three races leave three original triples only");
  await save("totals.json", totals); await close(observer); await close(admin); completed = true;
  console.log(`B29 three native blocking races complete: ${facts.length} PASS`);
} catch (error) {
  const e = nativeError(error); let location: unknown;
  const position = Number((error as { position?: string }).position);
  if (activeSource && position > 0) {
    const at = activeSource.offset + position - 1, line = activeSource.text.slice(0, at).split("\n").length;
    location = { source: activeSource.label, line, position: at + 1,
      context: activeSource.text.split("\n").slice(Math.max(0, line - 3), line + 2) };
  }
  await save("first-failure.json", { stage, error: e, location, nativeStatementsWereNotRelaxed: true });
  console.error(JSON.stringify({ stage, firstFailure: e, location })); process.exitCode = 1;
} finally {
  for (const c of clients) await close(c).catch(() => undefined);
  let pidAbsent = false, listenerAbsent = false;
  try {
    if (startAttempted) await stopOwnedCluster();
    try { await access(join(cluster, "postmaster.pid")); } catch { pidAbsent = true; }
    if (port) {
      await run(powershell, ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output 'Owned port listener absent'`], "stopped-listener.log");
      listenerAbsent = true;
    }
  } catch (error) { await save("cleanup-failure.json", nativeError(error)); process.exitCode = 1; }
  await save("cleanup-safe.json", { pid, port, postmasterPidAbsent: pidAbsent, listenerAbsent, completed });
  if (!completed || !pidAbsent || !listenerAbsent) process.exitCode = 1;
  console.log(`B29 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent}`);
}

async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
