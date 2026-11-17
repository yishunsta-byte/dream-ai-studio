// B34: explicit owned Windows PG18.7 fixture only. Never reads .env or a DSN.
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
import { postgresUploadReservations, type ServerReservationDependencies } from "../lib/services/postgres/upload-reservations";
import { actorFromVerifiedUserId, type VerifiedActor } from "../lib/db/postgres/types";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --conditions=react-server --import tsx tests/b34-reservation-adapter-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b34-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B34_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B34_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b34_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B34-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
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
let observationClient: Client | undefined;
const modulePins = [
  ["lib/storage/uploads/reservation-client.ts", "aa41815bbabd7929c36e90a39afac53fcc3b8d89ecd1e764b495bb6ea1330b5f"],
  ["lib/db/postgres/reservation-replies.ts", "fb95fb3642ff8b078eb05751698fce2250478fa5b1d9bb5c93df45d611b47667"],
  ["lib/db/postgres/reservation-outcome.ts", "72cb855ca664e382fc81e461b2e7d8a0b23e35c174398a48b74a01b1bdf8f30d"],
  ["lib/db/postgres/reservation-attempt.ts", "72a3118bd21c0e6edfb5cc2b44eaaba988273c7733e594193c1be05479af550e"],
  ["lib/repo/postgres/upload-reservations.ts", "0d532fb3af10e33155e0cc5c0fcd675acf27f7f56261b3efb3df24cffb626069"],
  ["lib/services/postgres/upload-reservations.ts", "9cc0cd6720604fcb163a896442a91a591a7439737be9fae85b77497619b441b5"],
] as const;
try {
  const moduleEvidence = [];
  for (const [path, expected] of modulePins) {
    const actual = sha(lf(await readFile(join(repo, path), "utf8")));
    verify(actual === expected, "fixed5f97f00 module hash " + path); moduleEvidence.push({ path, expected, actual });
  }
  await save("adapter-source-pins.json", { fixedCommit: "5f97f007abd2272dff265f19d229e14ab609c7c3", modules: moduleEvidence });
  const baseline: string[] = [];
  for (const [name, expected] of src) {
    const text = lf(await readFile(join(repo, "lib/db/postgres", name), "utf8"));
    verify(sha(text) === expected, `${name} protected source hash`); baseline.push(text);
  }
  sql5 = lf(await readFile(join(repo, "lib/db/postgres/drafts/0005_upload_reservation.sql"), "utf8"));
  verify(sha(sql5) === "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb", "fixed fbfc48c SQL5 hash");
  verify(sql5.split(fuse).length === 2, "one exact known fuse");
  const fuseAt = sql5.indexOf(fuse);
  verify(fuse.length === 87 && fuseAt === 252, "approved exact fuse offset/length");
  derived = sql5.slice(0, fuseAt) + sql5.slice(fuseAt + fuse.length);
  verify(derived.slice(0, fuseAt) + fuse + derived.slice(fuseAt) === sql5, "fuse-only exact derivation");
  await writeFile(join(root, "sql5-original.sql"), sql5);
  await writeFile(join(root, "sql5-fuse-only-derived.sql"), derived);
  await writeFile(join(root, "fuse-only.diff"), `--- fixed-fbfc48c.sql\n+++ B34-owned-derived.sql\n@@ -5 +5 @@\n-${fuse}\n+\n`);
  await save("derivation.json", { sourceCommit: "fbfc48c95264eaf37826f943b5e35e9fe67fa616", originalSha: sha(sql5),
    derivedSha: sha(derived), removedStatement: fuse, removedAt: fuseAt, removedLength: fuse.length,
    exactOneStatementOnly: true, lineCountPreserved: true, executionScope: "this owned B34 cluster only" });
  verify(sha(derived) === "16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e", "approved derived hash");
  await save("ownership.json", { task: "B34", root, cluster, bin, nonce: randomUUID() });
  console.log(`B34 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B34_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b34_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`,
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
  await admin.query(`CREATE ROLE b34_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  const database = "dream_test_b34_adapter";
  await admin.query("CREATE DATABASE dream_test_b34_adapter OWNER b34_migration TEMPLATE template0 ENCODING 'UTF8'");
  const migration = await connect(database, "b34_migration"), observer = await connect(database);
  observationClient = observer;
  const roleOid = async (name: string) => Number((await observer.query("SELECT oid FROM pg_roles WHERE rolname=$1", [name])).rows[0]?.oid);
  const migrationOid = await roleOid("b34_migration"), rootOid = await roleOid("b34_bootstrap");
  verify(migrationOid && rootOid, "native provisioner OIDs");
  stage = "full SQL1-5 setup";
  await migration.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (let n = 0; n < baseline.length; n++) { activeSource = { text: baseline[n], label: src[n][0], offset: 0 }; await migration.query(baseline[n]); }
  await migration.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false),set_config('dream.b27_bootstrap_oid',$2,false),set_config('dream.b27_expected_pg_major','18',false)", [String(migrationOid), String(rootOid)]);
  activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: 0 }; await migration.query(derived); activeSource = undefined;
  await close(migration);
  for (const login of ["b34_api_a", "b34_api_b"]) await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'; GRANT dream_api TO ${login} WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002", worker = "00000000-0000-4000-8000-000000000003";
  await observer.query("INSERT INTO auth.users(id) VALUES($1),($2),($3)", [owner, other, worker]);
  const body = { bodyVersion: 1, collectors: [worker], incomingBucket: "synthetic-incoming", intentTtlMs: 120000, issueEnvelopeMs: 90000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3, maxPreparationAgeMs: 30000, policyManagers: [worker], providerMaxBytes: 1048576, verifiers: [worker] };
  const rawBody = canonicalJson(body), digest = sha("B34-owned-synthetic-policy-1");
  await observer.query("INSERT INTO dream.storage_policy_versions VALUES('asset-upload',1,$1,clock_timestamp())", [digest]);
  await observer.query("INSERT INTO dream_reservation.upload_policy_versions VALUES('asset-upload',1,$1,$2,$3)", [digest, rawBody, sha(`upload-policy-body:v1\n${rawBody}`)]);
  await observer.query("INSERT INTO dream.storage_policies VALUES('asset-upload',1,$1,0,clock_timestamp())", [digest]);
  const functions = (await observer.query("SELECT p.oid,p.proowner,n.nspowner,p.proname,p.prosecdef,p.provolatile,p.proconfig,p.proacl,n.nspacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN(to_regprocedure('dream_reservation.read_upload_seed_v1(uuid,text)'),to_regprocedure('dream_reservation.reserve_upload_v1(uuid,text,text)')) ORDER BY p.proname")).rows;
  const target: ServerReservationDependencies["target"] = { schemaVersion: 5, sql5Sha256: "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb", serverMajor: 18, loginOid: await roleOid("b34_api_a"), apiRoleOid: await roleOid("dream_api"), apiMembershipGrantorOid: rootOid, issuerRoleOid: await roleOid("dream_upload_reserver"), migrationOwnerOid: migrationOid, bootstrapOid: rootOid, readSeedFunctionOid: Number(functions.find(f => f.proname === "read_upload_seed_v1")?.oid), reserveUploadFunctionOid: Number(functions.find(f => f.proname === "reserve_upload_v1")?.oid), provenanceId: "B34-owned-" + root.split("b34-native-")[1], scope: "owned-synthetic" };
  const roles = (await observer.query("SELECT oid,rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolinherit FROM pg_roles WHERE rolname LIKE 'b34_%' OR rolname IN ('dream_api','dream_worker','dream_upload_reserver') ORDER BY oid")).rows;
  const memberships = (await observer.query("SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member")).rows;
  await save("synthetic-provisioning.json", { target, roles, functions, memberships, policy: { rawBody, digest }, provenance: "trusted bootstrap created this synthetic cluster; NOT production attestation" });
  const connection = (user: string) => ({ connectionString: `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`, localTestWithoutTls: true });
  const limits = { statementTimeoutMs: 2000, lockTimeoutMs: 1000, idleTimeoutMs: 4000, attemptDeadlineMs: 10000, cleanupDeadlineMs: 3000 };
  let n = 100, generated = 0;
  const uid = (v: number) => `019b9000-0000-7000-8000-${v.toString(16).padStart(12, "0")}`;
  const dependencies: ServerReservationDependencies = { connection: connection("b34_api_a"), target, limits, nextRecordId: () => { generated++; return uid(++n); } };
  const service = postgresUploadReservations(dependencies), actor = actorFromVerifiedUserId(owner);
  const input = { requestId: uid(4), clientJson: '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}' };
  const counts = async () => (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests)::text AS requests,(SELECT count(*) FROM dream.storage_objects)::text AS objects,(SELECT count(*) FROM dream.upload_intents)::text AS intents,(SELECT count(*) FROM dream.storage_capability_issues)::text AS capabilities,(SELECT count(*) FROM dream.storage_outbox)::text AS outbox")).rows[0];
  const activity = async () => (await observer.query("SELECT pid,usename,application_name,state,backend_type FROM pg_stat_activity WHERE datname=$1 ORDER BY pid", [database])).rows;
  const closed = async (label: string) => { const rows = await activity(); await save(label + "-activity.json", rows); verify(!rows.some(r => r.application_name === "dream-backend"), label + " no adapter connection remains"); return rows; };
  const audit = async () => lf(await readFile(join(root, "postgres.log"), "utf8"));
  // Secret-bearing provisioning completes before statement logging is enabled.
  await admin.query("ALTER SYSTEM SET log_line_prefix='%m [%p] %a %u@%d '");
  await admin.query("ALTER SYSTEM SET log_error_verbosity='verbose'");
  await admin.query("ALTER SYSTEM SET log_statement='all'");
  await admin.query("ALTER SYSTEM SET log_connections='all'");
  await admin.query("ALTER SYSTEM SET log_disconnections='on'");
  await admin.query("SELECT pg_reload_conf()");
  const auditControl = await connect(database); await auditControl.query("SELECT 1 AS b34_audit_ready"); await close(auditControl);
  verify((await audit()).includes("b34_audit_ready"), "server statement audit enabled before adapter");
  await save("before-adapter.json", { counts: await counts(), activity: await activity() });
  stage = "actual adapter new admission";
  const admitted = await service.reserve(actor, input); facts.push({ stage, result: admitted, generated }); await save("checks.json", facts);
  verify(admitted.kind === "success" && admitted.commit === "confirmed" && admitted.cleanup === "ok", "real adapter new admission confirmed success");
  if (admitted.kind !== "success") throw new Error("B34 unreachable closed result");
  verify(generated === 3 && admitted.record.origin === "created" && !admitted.record.issuanceAuthorized, "new admission exactly three IDs/no issuance");
  const firstCounts = await counts(); verify(firstCounts.requests === "1" && firstCounts.objects === "1" && firstCounts.intents === "1" && firstCounts.capabilities === "0" && firstCounts.outbox === "0", "one actual committed triple only");
  await closed("admission");
  stage = "actual native B25 envelope/hash/model binding";
  const stored = (await observer.query("SELECT to_jsonb(h) AS ledger,i.request_json FROM dream_reservation.upload_requests h JOIN dream.upload_intents i ON (i.owner_id,i.request_id,i.id,i.object_id)=(h.owner_id,h.request_id,h.intent_id,h.object_id) WHERE h.owner_id=$1 AND h.request_id=$2", [owner, input.requestId])).rows[0];
  const raw = stored.request_json, original = JSON.parse(raw), model = reserveUpload(original.reservation, { principalId: owner, now: original.reservedAt, expectedRevision: 0 });
  const encoded = encodeUploadReservation({ model, requestJson: raw });
  const object = (await observer.query(encoded.selectObject.text, [...encoded.selectObject.values])).rows[0], intent = (await observer.query(encoded.selectIntent.text, [...encoded.selectIntent.values])).rows[0];
  const decoded = decodeUploadReservation({ object, intent });
  verify(decoded.rawSha === admitted.record.rawSha && decoded.fingerprint === admitted.record.fingerprint && decoded.requestJson === raw && canonicalJson(decoded.model) === canonicalJson(model), "actual stored B25 exact raw/hash/model");
  const r = admitted.record.reservation;
  verify(r.requestId === encoded.requestId && r.objectId === model.objectId && r.assetId === model.assetId && r.intentId === model.intentId && r.reservedAt === model.reservedAt && r.authorizationUntil === model.intentExpiresAt && r.issueEnvelopeUntil === model.issueEnvelopeUntil && r.maxBytes === encoded.maxBytes && r.policyEpoch === model.policyEpoch && r.policyDigest === model.policyDigest, "all ten returned DTO bindings");
  await save("native-triple-b25.json", { stored, object, intent, decoded, returned: admitted, counts: firstCounts }); facts.push({ stage, pass: true });
  stage = "same-key replay without ID generation";
  const replay = await service.reserve(actor, input); verify(replay.kind === "success" && replay.record.origin === "replayed" && generated === 3 && canonicalJson(replay.record.reservation) === canonicalJson(admitted.record.reservation) && replay.record.fingerprint === admitted.record.fingerprint && replay.record.rawSha === admitted.record.rawSha, "original replay no fresh ID/authority");
  verify(canonicalJson(await counts()) === canonicalJson(firstCounts), "replay writes zero triples"); await closed("replay"); facts.push({ stage, result: replay, generated });
  stage = "changed payload conflicts without writes";
  const conflict = await service.reserve(actor, { ...input, clientJson: input.clientJson.replace("1024", "2048") }); verify(conflict.kind === "failure" && conflict.commit === "not-applied" && conflict.reason === "CLIENT_CONFLICT" && conflict.cleanup === "ok", "real closed payload conflict");
  verify(canonicalJson(await counts()) === canonicalJson(firstCounts) && generated === 3, "conflict writes0/IDs0"); await closed("conflict"); facts.push({ stage, result: conflict });
  stage = "other owner same-key isolation";
  const foreign = postgresUploadReservations({ ...dependencies, connection: connection("b34_api_b"), target: { ...target, loginOid: await roleOid("b34_api_b") } });
  const otherResult = await foreign.reserve(actorFromVerifiedUserId(other), input);
  verify(otherResult.kind === "success" && otherResult.record.origin === "created" && otherResult.record.reservation.objectId !== r.objectId && otherResult.record.reservation.intentId !== r.intentId && !canonicalJson(otherResult).includes(r.objectId) && !canonicalJson(otherResult).includes(r.intentId), "foreign owner sees own admission not original history");
  const ownerCounts = (await observer.query("SELECT owner_id::text,count(*)::text AS count FROM dream_reservation.upload_requests GROUP BY owner_id ORDER BY owner_id")).rows;
  verify(ownerCounts.length === 2 && ownerCounts.every(row => row.count === "1"), "one isolated ledger per synthetic owner"); await closed("foreign"); facts.push({ stage, result: otherResult, ownerCounts });
  const finalCounts = await counts();
  stage = "closed management credential and wrong function identity controls";
  for (const [label, deps] of [["management", { ...dependencies, connection: connection("b34_bootstrap") }], ["wrong-function-OID", { ...dependencies, target: { ...target, readSeedFunctionOid: target.reserveUploadFunctionOid, reserveUploadFunctionOid: target.readSeedFunctionOid } }]] as const) {
    const response = await postgresUploadReservations(deps).reserve(actor, input);
    verify(response.kind === "failure" && response.commit === "not-applied" && response.reason === "CONFIGURATION_REJECTED" && response.cleanup === "ok", label + " closed before entry");
    verify(canonicalJson(await counts()) === canonicalJson(finalCounts), label + " writes0"); await closed(label); facts.push({ stage: label, result: response });
  }
  stage = "approved runtime and unverified actor remain preconnect closed";
  const auditBefore = await audit();
  const disabled = await postgresUploadReservations({ ...dependencies, target: { ...target, scope: "approved-runtime" } }).reserve(actor, input);
  let getterReads = 0;
  const unauth = await service.reserve({ id: owner } as VerifiedActor, { get requestId() { getterReads++; return input.requestId; } });
  verify(disabled.kind === "failure" && disabled.reason === "DISABLED" && unauth.kind === "failure" && unauth.reason === "AUTH_REQUIRED" && getterReads === 0, "disabled and unverified actor closed");
  const auditAfter = await audit();
  verify(auditAfter.slice(auditBefore.length).split("\n").every(line => !line.includes("dream-backend")), "no adapter connection/SQL for disabled or invalid actor");
  const finalActivity = await closed("final");
  await save("final.json", { counts: await counts(), ownerCounts, generated, disabled, unauth, getterReads, finalActivity, adapterSessionsAbsent: true, serverStillRunning: pid, remainingOwnedObserverSessionsAreNotAdapterLeaks: true });
  for (const [path, expected] of modulePins) verify(sha(lf(await readFile(join(repo, path), "utf8"))) === expected, "adapter source preserved " + path);
  verify(sha(lf(await readFile(join(repo, "lib/db/postgres/drafts/0005_upload_reservation.sql"), "utf8"))) === sha(sql5), "original fused SQL5 preserved");
  await save("checks.json", facts); completed = true;
  console.log(`B34 normal native foundation complete: ${facts.length} checks`);
} catch (error) {
  const e = nativeError(error); let location: unknown;
  const position = Number((error as { position?: string }).position);
  if (activeSource && position > 0) {
    const at = activeSource.offset + position - 1, line = activeSource.text.slice(0, at).split("\n").length;
    location = { source: activeSource.label, line, position: at + 1, context: activeSource.text.split("\n").slice(Math.max(0, line - 3), line + 2) };
  }
  if (observationClient) {
    try { await save("failure-native-counts.json", (await observationClient.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests)::text AS requests,(SELECT count(*) FROM dream.storage_objects)::text AS objects,(SELECT count(*) FROM dream.upload_intents)::text AS intents")).rows); } catch { /* keep primary failure */ }
  }
  await save("checks-at-first-failure.json", facts); await save("first-failure.json", { stage, error: e, location, nativeStatementsWereNotRelaxed: true });
  console.error(JSON.stringify({ stage, firstFailure: e, location })); process.exitCode = 1;
} finally {
  const nativeLog = await readFile(join(root, "postgres.log"), "utf8").catch(() => "");
  await writeFile(join(root, "native-server-redacted.log"), nativeLog.replaceAll(password, "[synthetic-secret-redacted]"));
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
  console.log(`B34 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent}`);
}

async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
