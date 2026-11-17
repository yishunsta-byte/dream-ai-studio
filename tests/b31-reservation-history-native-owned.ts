// B31: explicit owned Windows PG18.7 fixture only. Never reads .env or a DSN.
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
  throw new Error("Usage: node --import tsx tests/b31-reservation-history-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b31-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B31_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B31_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b31_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B31-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
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
  await writeFile(join(root, "fuse-only.diff"), `--- fixed-fbfc48c.sql\n+++ B31-owned-derived.sql\n@@ -5 +5 @@\n-${fuse}\n+\n`);
  await save("derivation.json", { sourceCommit: "fbfc48c95264eaf37826f943b5e35e9fe67fa616", originalSha: sha(sql5),
    derivedSha: sha(derived), removedStatement: fuse, removedAt: fuseAt, removedLength: fuse.length,
    exactOneStatementOnly: true, lineCountPreserved: true, executionScope: "this owned B31 cluster only" });
  await save("ownership.json", { task: "B31", root, cluster, bin, nonce: randomUUID() });
  console.log(`B31 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B31_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b31_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`,
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
  await admin.query(`CREATE ROLE b31_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  await admin.query("CREATE DATABASE b31_fixture OWNER b31_migration TEMPLATE template0 ENCODING 'UTF8'");
  const migration = await connect("b31_fixture", "b31_migration"), observer = await connect("b31_fixture");
  const principals = (await admin.query("SELECT oid,rolname,rolsuper FROM pg_roles WHERE rolname IN ('b31_bootstrap','b31_migration') ORDER BY rolname")).rows;
  const migrationOid = principals.find(p => p.rolname === "b31_migration")?.oid, rootOid = principals.find(p => p.rolname === "b31_bootstrap")?.oid;
  verify(migrationOid && rootOid, "native migration/root OIDs"); await save("principals.json", principals);
  stage = "full SQL1-5 setup"; console.log(`B31 ${stage}`);
  await migration.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (let n = 0; n < baseline.length; n++) { activeSource = { text: baseline[n], label: src[n][0], offset: 0 }; await migration.query(baseline[n]); }
  await migration.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false),set_config('dream.b27_bootstrap_oid',$2,false),set_config('dream.b27_expected_pg_major','18',false)", [String(migrationOid), String(rootOid)]);
  activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: 0 }; await migration.query(derived); activeSource = undefined;
  await close(migration);
  const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
  const worker1 = "00000000-0000-4000-8000-000000000003", worker2 = "00000000-0000-4000-8000-000000000004";
  await observer.query("INSERT INTO auth.users(id) VALUES($1),($2),($3),($4)", [owner, other, worker1, worker2]);
  for (const login of ["b31_api_a", "b31_api_b"]) await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'; GRANT dream_api TO ${login} WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  const api = await connect("b31_fixture", "b31_api_a"), foreignApi = await connect("b31_fixture", "b31_api_b");
  const identitySql = "SELECT current_user,session_user,pg_backend_pid() AS pid,current_user::regrole::oid AS oid,r.rolsuper,r.rolbypassrls,r.rolcreaterole FROM pg_roles r WHERE r.oid=current_user::regrole";
  const apiIdentity = (await api.query(identitySql)).rows[0], foreignIdentity = (await foreignApi.query(identitySql)).rows[0];
  verify(apiIdentity.oid !== foreignIdentity.oid && apiIdentity.pid !== foreignIdentity.pid, "independent restricted logins/backends");
  for (const i of [apiIdentity, foreignIdentity]) verify(!i.rolsuper && !i.rolbypassrls && !i.rolcreaterole, "native restricted flags");
  await save("runtime-identities.json", { apiIdentity, foreignIdentity });
  const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
  const client = '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}';
  const changedClient = '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":2048}';
  const events: unknown[] = [];
  const tx = async (c: Client, actor: string, text: string, values: unknown[]) => {
    await c.query("BEGIN; SET LOCAL ROLE dream_api"); await c.query("SELECT set_config('dream.actor_id',$1,true)", [actor]);
    try {
      const result = (await c.query(text, values)).rows[0].value;
      // Even a caller that commits a closed rejection must not retain partial rows.
      verify((await c.query("COMMIT")).command === "COMMIT", "actual entry transaction COMMIT");
      events.push({ kind: "entry-return-then-COMMIT", actor, result }); await save("events.json", events); return result;
    } catch (error) { await c.query("ROLLBACK").catch(() => undefined); throw error; }
  };
  let epoch = 0;
  const installPolicy = async (short: boolean, next: boolean) => {
    epoch++;
    const body = { bodyVersion: 1, collectors: [next ? worker2 : worker1], incomingBucket: "synthetic-incoming",
      intentTtlMs: short ? 800 : 120000, issueEnvelopeMs: short ? 500 : 90000,
      keyRule: "owner/incoming/object/intent:v1", maxBytes: next ? 4096 : 1048576, maxIssues: next ? 1 : 3,
      maxPreparationAgeMs: 30000, policyManagers: [next ? worker2 : worker1], providerMaxBytes: 1048576,
      verifiers: [next ? worker2 : worker1] };
    const rawBody = canonicalJson(body), digest = sha(`B31-synthetic-policy-${epoch}`);
    await observer.query("INSERT INTO dream.storage_policy_versions VALUES('asset-upload',$1,$2,clock_timestamp())", [epoch, digest]);
    await observer.query("INSERT INTO dream_reservation.upload_policy_versions VALUES('asset-upload',$1,$2,$3,$4)", [epoch, digest, rawBody, sha(`upload-policy-body:v1\n${rawBody}`)]);
    if (epoch === 1) await observer.query("INSERT INTO dream.storage_policies VALUES('asset-upload',$1,$2,0,clock_timestamp())", [epoch, digest]);
    else verify((await observer.query("UPDATE dream.storage_policies SET epoch=$1,digest=$2,revision=revision+1,updated_at=clock_timestamp() WHERE policy_id='asset-upload'", [epoch, digest])).rowCount === 1, "normal guarded policy advance");
    const native = (await observer.query("SELECT p.*,v.body_json,v.body_digest FROM dream.storage_policies p JOIN dream_reservation.upload_policy_versions v ON (v.policy_id,v.epoch,v.digest)=(p.policy_id,p.epoch,p.digest) WHERE p.policy_id='asset-upload'")).rows[0];
    verify(Number(native.epoch) === epoch && native.digest === digest && native.body_json === rawBody, "actual guarded current pointer/body");
    events.push({ kind: "synthetic-guarded-policy-installed", native }); return { epoch, digest, body, native };
  };
  const observeClock = async (authorizationUntil: number, issueUntil: number) => (await observer.query(
    "WITH observation AS MATERIALIZED (SELECT extract(epoch FROM clock_timestamp())*1000 AS ms) SELECT ms::text AS now_ms,ms>$1::numeric AND ms>$2::numeric AS after_both,ms<$1::numeric AND ms<$2::numeric AS before_both FROM observation",
    [String(authorizationUntil), String(issueUntil)])).rows[0];
  const snapshot = async (request: string) => (await observer.query("SELECT to_jsonb(h) AS ledger,to_jsonb(i) AS intent,to_jsonb(o) AS object FROM dream_reservation.upload_requests h JOIN dream.upload_intents i ON (i.owner_id,i.request_id,i.id,i.object_id)=(h.owner_id,h.request_id,h.intent_id,h.object_id) JOIN dream.storage_objects o ON (o.owner_id,o.id)=(h.owner_id,h.object_id) WHERE h.owner_id=$1 AND h.request_id=$2", [owner, request])).rows[0];
  const modes = ["expiry-only", "policy-only", "expiry-and-policy"] as const;
  for (let index = 0; index < modes.length; index++) {
    stage = modes[index]; console.log(`B31 history: ${stage}`);
    const originalPolicy = await installPolicy(modes[index] !== "policy-only", false);
    const base = (index + 1) * 100, request = uid(base + 4);
    // Seed/build/stage share one actual transaction; no fake clock or metadata UPDATE.
    await api.query("BEGIN; SET LOCAL ROLE dream_api"); await api.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
    const seed = (await api.query("SELECT dream_reservation.read_upload_seed_v1($1,$2) AS value", [request, client])).rows[0].value;
    verify(seed.tag === "seed", "normal original seed");
    const reservation = { ownerId: owner, objectId: uid(base + 1), assetId: uid(base + 2), intentId: uid(base + 3),
      intentExpiresAt: seed.now + originalPolicy.body.intentTtlMs, issueEnvelopeUntil: seed.now + originalPolicy.body.issueEnvelopeMs,
      maxIssues: originalPolicy.body.maxIssues, verifiers: originalPolicy.body.verifiers, collectors: originalPolicy.body.collectors,
      policyManagers: originalPolicy.body.policyManagers, policyEpoch: originalPolicy.epoch, policyDigest: originalPolicy.digest,
      incoming: { bucket: originalPolicy.body.incomingBucket, key: `${owner}/incoming/${uid(base + 1)}/${uid(base + 3)}`, providerVersion: null } };
    const model = reserveUpload(reservation, { principalId: owner, now: seed.now, expectedRevision: 0 });
    const requestValue = { codecVersion: 1, requestId: request, maxBytes: 1024, reservedAt: seed.now, reservation };
    const raw = ` \n${JSON.stringify(requestValue, null, 2)}\t `, codec = encodeUploadReservation({ model, requestJson: raw });
    const staged = (await api.query("SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [request, client, raw])).rows[0].value;
    verify(staged.tag === "staged" && staged.commitConfirmed === false && staged.issuanceAuthorized === false, "original provisional return");
    verify((await api.query("COMMIT")).command === "COMMIT", "original actual COMMIT");
    const before = await snapshot(request), beforeHash = sha(canonicalJson(before));
    verify(before.intent.request_json === raw && before.intent.request_fingerprint === codec.fingerprint && before.intent.request_raw_sha === codec.rawSha, "original committed native raw/hash");
    const atCreation = await observeClock(reservation.intentExpiresAt, reservation.issueEnvelopeUntil);
    await save("active-case.json", { case: modes[index], request, originalPolicy, raw, staged, before, atCreation });
    verify(atCreation.before_both, "original reservation committed while both windows still valid");
    let currentPolicy = originalPolicy;
    if (modes[index] !== "expiry-only") currentPolicy = await installPolicy(false, true);
    const observations: unknown[] = [];
    if (modes[index] !== "policy-only") {
      const deadline = performance.now() + 5000;
      let expired = false;
      while (performance.now() < deadline) {
        const observation = await observeClock(reservation.intentExpiresAt, reservation.issueEnvelopeUntil);
        observations.push(observation);
        if (observation.after_both) { expired = true; break; }
        await new Promise(res => setTimeout(res, 25)); // scheduling only, not expiry evidence
      }
      verify(expired, "DB clock actually crossed both original deadlines within five seconds");
    } else {
      const observation = await observeClock(reservation.intentExpiresAt, reservation.issueEnvelopeUntil);
      observations.push(observation); verify(observation.before_both, "policy-only test before expiry");
    }
    await save("active-case.json", { case: modes[index], request, originalPolicy, currentPolicy, raw, staged, before, atCreation, observations });
    const readReplay = await tx(api, owner, "SELECT dream_reservation.read_upload_seed_v1($1,$2) AS value", [request, client]);
    const reserveReplay = await tx(api, owner, "SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [request, client, raw]);
    for (const response of [readReplay, reserveReplay]) verify(response.tag === "replay" && response.issuanceAuthorized === false
      && canonicalJson(response.reservation) === canonicalJson(staged.reservation) && response.originalEnvelope === raw
      && response.reservation.policyEpoch === originalPolicy.epoch && response.reservation.policyDigest === originalPolicy.digest,
      "history returns exact original snapshot/result with no new authority");
    const changedRead = await tx(api, owner, "SELECT dream_reservation.read_upload_seed_v1($1,$2) AS value", [request, changedClient]);
    const changedReserve = await tx(api, owner, "SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [request, changedClient, raw]);
    for (const response of [changedRead, changedReserve]) verify(canonicalJson(response) === '{"tag":"CONFLICT"}', "changed payload conflicts even after expiry/policy change, without exposing history");
    const foreignRead = await tx(foreignApi, other, "SELECT dream_reservation.read_upload_seed_v1($1,$2) AS value", [request, client]);
    const foreignReserve = await tx(foreignApi, other, "SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [request, client, raw]);
    verify(foreignRead.tag === "seed" && foreignRead.ownerId === other && foreignRead.reservation === undefined
      && foreignRead.originalEnvelope === undefined && !canonicalJson(foreignRead).includes(reservation.objectId)
      && !canonicalJson(foreignRead).includes(reservation.intentId), "other owner sees own seed, not original result/IDs/raw");
    verify(canonicalJson(foreignReserve) === '{"tag":"INPUT"}', "foreign original proposal denied with closed generic tag");
    const newRequest = uid(base + 14);
    const staleReservation = { ...reservation, objectId: uid(base + 11), assetId: uid(base + 12), intentId: uid(base + 13),
      incoming: { ...reservation.incoming, key: `${owner}/incoming/${uid(base + 11)}/${uid(base + 13)}` } };
    const stale = { ...requestValue, requestId: newRequest, reservation: staleReservation };
    await save("stale-proposal.json", { case: modes[index], request, newRequest, stale });
    // Fresh key/IDs/target bindings are valid. Only the original time/policy facts stay stale.
    const staleResult = await tx(api, owner, "SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [newRequest, client, JSON.stringify(stale)]);
    const expectedStale = modes[index] === "expiry-only" ? "STALE_SEED" : "INPUT";
    verify(canonicalJson(staleResult) === canonicalJson({ tag: expectedStale }), "first actual fresh guard: expiry after latch vs current-policy envelope binding before latch");
    const after = await snapshot(request), afterHash = sha(canonicalJson(after));
    verify(afterHash === beforeHash && canonicalJson(after) === canonicalJson(before), "all original ledger/intent/object fields byte-text/semantic state unchanged");
    const objectRow = (await observer.query(codec.selectObject.text, [...codec.selectObject.values])).rows[0];
    const intentRow = (await observer.query(codec.selectIntent.text, [...codec.selectIntent.values])).rows[0];
    const decoded = decodeUploadReservation({ object: objectRow, intent: intentRow });
    verify(canonicalJson(decoded.model) === canonicalJson(model) && decoded.requestJson === raw && decoded.rawSha === codec.rawSha && decoded.fingerprint === codec.fingerprint,
      "original pristine data remains exact B25 roundtrip after historical replay");
    const counts = (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests WHERE owner_id=$1 AND request_id=$3) AS original_requests,(SELECT count(*) FROM dream.upload_intents WHERE owner_id=$1 AND request_id=$3) AS original_intents,(SELECT count(*) FROM dream_reservation.upload_requests WHERE owner_id=$2 AND request_id=$3) AS other_owner_requests,(SELECT count(*) FROM dream_reservation.upload_requests WHERE owner_id=$1 AND request_id=$4) AS stale_requests,(SELECT count(*) FROM dream.storage_objects WHERE id=ANY($5::uuid[])) AS stale_objects,(SELECT count(*) FROM dream.upload_intents WHERE id=$6) AS stale_intents,(SELECT count(*) FROM dream.storage_capability_issues) AS capabilities,(SELECT count(*) FROM dream.storage_outbox) AS outbox", [owner, other, request, newRequest, [staleReservation.objectId], staleReservation.intentId])).rows[0];
    verify(Number(counts.original_requests) === 1 && Number(counts.original_intents) === 1 && Object.entries(counts).filter(([key]) => !key.startsWith("original_")).every(([, value]) => Number(value) === 0), "no other-owner/fresh stale/capability/outbox writes even after committing rejection tags");
    const finalClock = await observeClock(reservation.intentExpiresAt, reservation.issueEnvelopeUntil);
    verify(modes[index] === "policy-only" ? finalClock.before_both : finalClock.after_both, "history case condition still true after all checks");
    const result = { case: modes[index], originalPolicy, currentPolicy, request, newRequest, raw, staged, originalCommitConfirmed: true,
      originalDeadlines: { authorizationUntil: reservation.intentExpiresAt, issueUntil: reservation.issueEnvelopeUntil }, atCreation,
      observations, finalClock, readReplay, reserveReplay, changedRead, changedReserve, foreignRead, foreignReserve,
      staleProposal: stale, staleResult, staleGuard: expectedStale === "STALE_SEED" ? "post-latch DB clock expiry exception, caught as STALE_SEED" : "whole-envelope binding to current policy before latch/time check",
      before, after, beforeHash, afterHash, nativeB25Roundtrip: true, counts };
    facts.push(result); await save(`${modes[index]}-result.json`, result); await save("checks.json", facts); await save("events.json", events);
  }
  const totals = (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests) AS requests,(SELECT count(*) FROM dream.storage_objects) AS objects,(SELECT count(*) FROM dream.upload_intents) AS intents,(SELECT count(*) FROM dream.storage_capability_issues) AS capabilities,(SELECT count(*) FROM dream.storage_outbox) AS outbox")).rows[0];
  verify(Number(totals.requests) === 3 && Number(totals.objects) === 3 && Number(totals.intents) === 3 && Number(totals.capabilities) === 0 && Number(totals.outbox) === 0, "three original triples only");
  await save("totals.json", totals); await close(api); await close(foreignApi); await close(observer); await close(admin); completed = true;
  console.log(`B31 history complete: ${facts.length} PASS`);
} catch (error) {
  const e = nativeError(error); let location: unknown;
  const position = Number((error as { position?: string }).position);
  if (activeSource && position > 0) {
    const at = activeSource.offset + position - 1, line = activeSource.text.slice(0, at).split("\n").length;
    location = { source: activeSource.label, line, position: at + 1, context: activeSource.text.split("\n").slice(Math.max(0, line - 3), line + 2) };
  }
  await save("checks-at-first-failure.json", facts); await save("first-failure.json", { stage, error: e, location, nativeStatementsWereNotRelaxed: true });
  console.error(JSON.stringify({ stage, firstFailure: e, location })); process.exitCode = 1;
} finally {
  for (const c of clients) { await c.query("ROLLBACK").catch(() => undefined); await close(c).catch(() => undefined); }
  let pidAbsent = false, listenerAbsent = false;
  try {
    if (startAttempted) await stopOwnedCluster();
    try { await access(join(cluster, "postmaster.pid")); } catch { pidAbsent = true; }
    if (port) {
      await run(powershell, ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output 'Owned port listener absent'`], "stopped-listener.log"); listenerAbsent = true;
    }
  } catch (error) { await save("cleanup-failure.json", nativeError(error)); process.exitCode = 1; }
  await save("cleanup-safe.json", { pid, port, postmasterPidAbsent: pidAbsent, listenerAbsent, completed });
  if (!completed || !pidAbsent || !listenerAbsent) process.exitCode = 1;
  console.log(`B31 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent}`);
}

async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
