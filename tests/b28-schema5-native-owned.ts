// B28: explicit owned Windows PG18.7 fixture only. Never reads .env or a DSN.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { encodeUploadReservation } from "../lib/db/postgres/upload-reservation-codec";
import { canonicalJson } from "../lib/storage/uploads/receipt";
import { reserveUpload } from "../lib/storage/uploads/state";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --import tsx tests/b28-schema5-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b28-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B28_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B28_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b28_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B28-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
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
  await writeFile(join(root, "fuse-only.diff"), `--- fixed-fbfc48c.sql\n+++ B28-owned-derived.sql\n@@ -5 +5 @@\n-${fuse}\n+\n`);
  await save("derivation.json", { sourceCommit: "fbfc48c95264eaf37826f943b5e35e9fe67fa616", originalSha: sha(sql5),
    derivedSha: sha(derived), removedStatement: fuse, removedAt: fuseAt, removedLength: fuse.length,
    exactOneStatementOnly: true, lineCountPreserved: true, executionScope: "this owned B28 cluster only" });
  await save("ownership.json", { task: "B28", root, cluster, bin, nonce: randomUUID() });
  console.log(`B28 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B28_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b28_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`,
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
  await admin.query(`CREATE ROLE b28_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  await admin.query(`CREATE ROLE b28_other_login LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEROLE PASSWORD '${password}'`);
  const principals = (await admin.query("SELECT oid,rolname,rolsuper,rolcreaterole FROM pg_roles WHERE rolname IN ('b28_bootstrap','b28_migration') ORDER BY rolname")).rows;
  await save("principals.json", principals);
  const migrationOid = principals.find(p => p.rolname === "b28_migration")?.oid;
  const rootOid = principals.find(p => p.rolname === "b28_bootstrap")?.oid;
  verify(migrationOid && rootOid, "native management and bootstrap OIDs");
  const inventoryAt = derived.indexOf("DO $inventory$"); verify(inventoryAt > 0, "fixed inventory boundary");
  const prefix = derived.slice(0, inventoryAt), suffix = derived.slice(inventoryAt);
  verify(prefix + suffix === derived, "split execution preserves entire derivative");
  const expectedNegative = new Set(["schema-default-create", "schema-default-usage", "schema-grant-option", "schema-missing-api", "schema-wrong-owner", "schema-grantor-chain"]);
  const cases = ["positive", ...expectedNegative];
  for (const name of cases) {
    stage = `${name}: baseline`;
    console.log(`B28 ${stage}`);
    await admin.query("CREATE DATABASE b28_fixture OWNER b28_migration TEMPLATE template0 ENCODING 'UTF8'");
    const migration = await connect("b28_fixture", "b28_migration");
    const caseAdmin = await connect("b28_fixture");
    let expectedFailure = false;
    try {
      await migration.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
      for (let n = 0; n < baseline.length; n++) {
        activeSource = { text: baseline[n], label: src[n][0], offset: 0 };
        await migration.query(baseline[n]);
      }
      activeSource = undefined;
      await migration.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false),set_config('dream.b27_bootstrap_oid',$2,false),set_config('dream.b27_expected_pg_major','18',false)", [String(migrationOid), String(rootOid)]);
      const identity = (await migration.query("SELECT current_user,session_user,current_user::regrole::oid AS current_oid,current_setting('createrole_self_grant') AS self_grant,version() AS version")).rows[0];
      verify(identity.current_user === "b28_migration" && !principals.find(p => p.rolname === "b28_migration")?.rolsuper, "actual non-superuser migration login");
      if (name === "positive") {
        stage = "positive: original fuse"; activeSource = { text: sql5, label: "sql5-original.sql", offset: 0 };
        let error: unknown;
        try { await migration.query(sql5); } catch (e) { error = e; }
        verify(error && (error as { code?: string }).code === "P0001" && (error as Error).message === "B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED", "original fuse is first native failure");
        await migration.query("ROLLBACK");
        const absent = (await caseAdmin.query("SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dream_upload_reserver') AS role_absent,NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='dream_reservation') AS schema_absent")).rows[0];
        verify(absent.role_absent && absent.schema_absent, "original fuse leaves no new role/schema");
        facts.push({ case: name, check: "original fuse", expectedError: nativeError(error), ...absent });
      }
      if (name === "schema-default-create" || name === "schema-default-usage") {
        await migration.query(`ALTER DEFAULT PRIVILEGES GRANT ${name.endsWith("create") ? "CREATE" : "USAGE"} ON SCHEMAS TO b28_other_login`);
      }
      if (name === "schema-wrong-owner" || name === "schema-grantor-chain") {
        await admin.query("GRANT b28_other_login TO b28_migration WITH INHERIT FALSE, SET TRUE");
        await caseAdmin.query("GRANT CREATE ON DATABASE b28_fixture TO b28_other_login");
      }
      stage = `${name}: SQL5 prefix`; activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: 0 };
      await migration.query(prefix);
      if (name === "schema-grant-option") await migration.query("GRANT USAGE ON SCHEMA dream_reservation TO dream_api WITH GRANT OPTION");
      if (name === "schema-missing-api") await migration.query("REVOKE USAGE ON SCHEMA dream_reservation FROM dream_api");
      if (name === "schema-wrong-owner") await migration.query("ALTER SCHEMA dream_reservation OWNER TO b28_other_login");
      if (name === "schema-grantor-chain") {
        await migration.query("GRANT USAGE ON SCHEMA dream_reservation TO b28_other_login WITH GRANT OPTION; SET ROLE b28_other_login; GRANT USAGE ON SCHEMA dream_reservation TO dream_api; RESET ROLE");
      }
      const namespaceBefore = (await migration.query("SELECT n.oid,n.nspowner,a.* FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='dream_reservation' ORDER BY a.grantee,a.grantor,a.privilege_type")).rows;
      const membersBefore = (await migration.query("SELECT * FROM pg_auth_members WHERE roleid='dream_upload_reserver'::regrole OR member='dream_upload_reserver'::regrole")).rows;
      stage = `${name}: SQL5 native inventory`; activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: inventoryAt };
      let error: unknown;
      try { await migration.query(suffix); } catch (e) { error = e; }
      if (name === "positive") {
        if (error) throw error;
        verify(namespaceBefore.length === 4 && membersBefore.length === 1, "positive exact schema ACL and role edge");
        const counts = (await caseAdmin.query("SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('dream','dream_reservation') AND c.relkind='r') AS tables,(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dream_reservation' AND p.prosecdef) AS definers")).rows[0];
        verify(Number(counts.tables) === 32 && Number(counts.definers) === 2, "full SQL1-5 committed table/definer counts");
        facts.push({ case: name, identity, namespaceBefore, membersBefore, counts, committed: true });
        await save("positive-catalog.json", facts.at(-1));
        stage = "positive: restricted fresh insert and deferred context"; activeSource = undefined;
        await freshInsertProbe(caseAdmin, password, port, facts);
      } else {
        verify(error && (error as { code?: string }).code === "P0001" && (error as Error).message === (name === "schema-wrong-owner" ? "B27_SCHEMA_OWNER" : "B27_SCHEMA_ACL"), `${name} exact native rejection`);
        await migration.query("ROLLBACK");
        const rollback = (await caseAdmin.query("SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dream_upload_reserver') AS role_absent,NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='dream_reservation') AS schema_absent,NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='upload_intents_reservation_binding') AS unique_absent,NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid NOT IN(SELECT oid FROM pg_roles)) AS no_dangling_edge")).rows[0];
        verify(Object.values(rollback).every(v => v === true), `${name} atomic rollback`);
        facts.push({ case: name, identity, namespaceBefore, membersBefore, expectedError: nativeError(error), rollback,
          note: name === "schema-grantor-chain" ? "Grantor-chain negative also has an extra grantee; not isolated grantor-only proof" : undefined });
        expectedFailure = true;
      }
      await save("checks.json", facts);
    } catch (error) {
      await save("first-native-failure.json", { stage, error: nativeError(error), activeSource: activeSource?.label });
      throw error;
    } finally {
      await migration.query("ROLLBACK").catch(() => undefined);
      await close(migration); await close(caseAdmin);
      await admin.query("DROP DATABASE b28_fixture");
      await admin.query("DROP ROLE IF EXISTS dream_upload_reserver; DROP ROLE IF EXISTS dream_api; DROP ROLE IF EXISTS dream_worker");
      if (name === "schema-wrong-owner" || name === "schema-grantor-chain") await admin.query("REVOKE b28_other_login FROM b28_migration");
    }
    verify(name === "positive" || expectedFailure, `${name} executed negative`);
  }
  await close(admin); completed = true;
  console.log(`B28 native checks complete: ${facts.length} recorded results`);
} catch (error) {
  const e = nativeError(error); let location: unknown;
  const position = Number((error as { position?: string }).position);
  if (activeSource && position > 0) {
    const at = activeSource.offset + position - 1;
    const line = activeSource.text.slice(0, at).split("\n").length;
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
  console.log(`B28 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent}`);
}

async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}

async function freshInsertProbe(admin: Client, pw: string, ownedPort: number, results: unknown[]) {
  const owner = "00000000-0000-4000-8000-000000000001", worker = "00000000-0000-4000-8000-000000000002";
  const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
  const body = { bodyVersion: 1, collectors: [worker], incomingBucket: "synthetic-incoming", intentTtlMs: 60000,
    issueEnvelopeMs: 30000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3,
    maxPreparationAgeMs: 30000, policyManagers: [owner], providerMaxBytes: 1048576, verifiers: [worker] };
  const rawBody = canonicalJson(body), digest = "b".repeat(64);
  // Approved local synthetic fixtures only, not a policy administration executor.
  await admin.query("INSERT INTO auth.users(id) VALUES($1),($2)", [owner, worker]);
  await admin.query("INSERT INTO dream.storage_policy_versions VALUES('asset-upload',7,$1,clock_timestamp())", [digest]);
  await admin.query("INSERT INTO dream.storage_policies VALUES('asset-upload',7,$1,0,clock_timestamp())", [digest]);
  await admin.query("INSERT INTO dream_reservation.upload_policy_versions VALUES('asset-upload',7,$1,$2,$3)", [digest, rawBody, sha(`upload-policy-body:v1\n${rawBody}`)]);
  await admin.query(`CREATE ROLE b28_api_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${pw}'; GRANT dream_api TO b28_api_login WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  await admin.query("CREATE FUNCTION public.b28_deferred_witness() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'B28_EVENT role=% session=%',current_user::regrole::oid,session_user::regrole::oid; RETURN NULL; END $$; REVOKE ALL ON FUNCTION public.b28_deferred_witness() FROM PUBLIC; CREATE CONSTRAINT TRIGGER b28_deferred_witness AFTER INSERT ON dream.storage_objects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.b28_deferred_witness()");
  const api = new Client({ host: "127.0.0.1", port: ownedPort, database: "b28_fixture", user: "b28_api_login", password: pw,
    ssl: false, options: "", application_name: "B28-restricted-native", connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  clients.add(api); await api.connect();
  const notices: string[] = []; api.on("notice", n => notices.push(n.message ?? ""));
  try {
    await api.query("BEGIN; SET LOCAL ROLE dream_api");
    await api.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
    const client = '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}';
    const seed = (await api.query("SELECT dream_reservation.read_upload_seed_v1($1,$2) AS result", [uid(4), client])).rows[0].result;
    verify(seed.tag === "seed", `native seed tag=${String(seed.tag)}`);
    const reservation = { ownerId: owner, objectId: uid(1), assetId: uid(2), intentId: uid(3),
      intentExpiresAt: seed.now + body.intentTtlMs, issueEnvelopeUntil: seed.now + body.issueEnvelopeMs,
      maxIssues: body.maxIssues, verifiers: body.verifiers, collectors: body.collectors, policyManagers: body.policyManagers,
      policyEpoch: 7, policyDigest: digest, incoming: { bucket: body.incomingBucket, key: `${owner}/incoming/${uid(1)}/${uid(3)}`, providerVersion: null } };
    const model = reserveUpload(reservation, { principalId: owner, now: seed.now, expectedRevision: 0 });
    const envelope = JSON.stringify({ codecVersion: 1, requestId: uid(4), maxBytes: 1024, reservedAt: seed.now, reservation });
    const codec = encodeUploadReservation({ model, requestJson: envelope });
    const staged = (await api.query("SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS result", [uid(4), client, envelope])).rows[0].result;
    verify(staged.tag === "staged" && staged.commitConfirmed === false && staged.issuanceAuthorized === false, `native reserve tag=${String(staged.tag)}`);
    const commit = await api.query("COMMIT"); verify(commit.command === "COMMIT", "native fresh confirmed COMMIT");
    const ids = (await admin.query("SELECT 'dream_upload_reserver'::regrole::oid AS issuer,'b28_api_login'::regrole::oid AS login")).rows[0];
    verify(notices.includes(`B28_EVENT role=${ids.issuer} session=${ids.login}`), "actual queued-event role and restricted session");
    const rows = (await admin.query("SELECT i.request_fingerprint,i.request_raw_sha,(SELECT count(*) FROM dream_reservation.upload_requests) AS requests,(SELECT count(*) FROM dream.storage_objects) AS objects,(SELECT count(*) FROM dream.upload_intents) AS intents FROM dream.upload_intents i")).rows[0];
    verify(Number(rows.requests) === 1 && Number(rows.objects) === 1 && Number(rows.intents) === 1
      && rows.request_fingerprint === codec.fingerprint && rows.request_raw_sha === codec.rawSha, "native triple and B25 exact hashes");
    results.push({ check: "fresh native triple", fixtureOnly: true, staged, confirmedCommit: true, notices, ids, rows,
      noB3OrAuthOrConcurrencyOrLostCommitClaim: true });
  } finally { await api.query("ROLLBACK").catch(() => undefined); await close(api); }
  // Login owns no objects; remove before the fixture database is destroyed.
  await admin.query("DROP ROLE b28_api_login");
}
