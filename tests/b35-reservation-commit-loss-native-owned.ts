// B35: explicit owned Windows PG18.7 fixture only. Never reads .env or a DSN.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { decodeUploadReservation, encodeUploadReservation } from "../lib/db/postgres/upload-reservation-codec";
import { canonicalJson } from "../lib/storage/uploads/receipt";
import { reserveUpload } from "../lib/storage/uploads/state";
import { postgresUploadReservations, type ServerReservationDependencies } from "../lib/services/postgres/upload-reservations";
import { actorFromVerifiedUserId } from "../lib/db/postgres/types";
import { snapshotReservationRequest } from "../lib/storage/uploads/reservation-client";
import type { ReservationAttemptResult } from "../lib/db/postgres/reservation-outcome";

// Frame payloads exist only transiently for transparent forwarding. Never log or
// persist socket data, startup/auth/SCRAM messages, SQL payloads or credentials.
class CommitLossProxy {
  private server = createServer(socket => this.accept(socket));
  private sockets = new Set<Socket>();
  private heldResolve!: () => void;
  private heldReject!: (error: Error) => void;
  private held = new Promise<void>((resolve, reject) => { this.heldResolve = resolve; this.heldReject = reject; });
  private pair?: { client: Socket; upstream: Socket };
  private closed = false;
  readonly events: { event: string; at: number }[] = [];
  accepts = 0; clientCommits = 0; heldCommitCompletes = 0; heldReady = 0; forwardedCommitAcks = 0;
  partialHeaders = 0; partialBodies = 0; dropped = false; failed = false; port = 0;
  constructor(private primaryPort: number) { void this.held.catch(() => {}); }
  private event(event: string) { this.events.push({ event, at: Date.now() }); }
  private fail() { this.failed = true; this.event("proxy-framing-or-socket-failure"); this.heldReject(new Error("B35_PROXY_FAILURE")); this.drop(); }
  async listen() {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("B35_PROXY_LISTEN_TIMEOUT")), 3000);
      const failed = () => { clearTimeout(timer); reject(new Error("B35_PROXY_LISTEN_FAILED")); };
      this.server.once("error", failed);
      this.server.listen(0, "127.0.0.1", () => { clearTimeout(timer); this.server.removeListener("error", failed); resolve(); });
    });
    this.server.on("error", () => this.fail());
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("B35_PROXY_ADDRESS");
    this.port = address.port; this.event("owned-loopback-proxy-listening");
  }
  private accept(client: Socket) {
    this.accepts++; this.event("owned-adapter-connection-accepted");
    if (this.accepts !== 1) { client.destroy(); this.fail(); return; }
    const upstream = createConnection({ host: "127.0.0.1", port: this.primaryPort });
    this.pair = { client, upstream };
    for (const socket of [client, upstream]) {
      this.sockets.add(socket); socket.on("error", () => { if (!this.dropped) this.fail(); });
      socket.once("close", () => { this.sockets.delete(socket); this.event(socket === client ? "client-socket-closed" : "primary-socket-closed"); });
    }
    client.once("end", () => upstream.end()); upstream.once("end", () => client.end());
    client.once("close", () => upstream.destroy()); upstream.once("close", () => client.destroy());
    const forward = (target: Socket, source: Socket, frame: Buffer) => {
      if (!target.write(frame)) { source.pause(); target.once("drain", () => { if (!source.destroyed) source.resume(); }); }
    };
    let frontend = Buffer.alloc(0), backend = Buffer.alloc(0), startup = true, blocking = false;
    const parse = (direction: "frontend" | "backend", fragment: Buffer) => {
      if (this.dropped) return;
      let pending = Buffer.concat([direction === "frontend" ? frontend : backend, fragment]);
      for (;;) {
        const startupFrame = direction === "frontend" && startup;
        const header = startupFrame ? 4 : 5;
        if (pending.length < header) { if (pending.length) this.partialHeaders++; break; }
        const length = pending.readInt32BE(startupFrame ? 0 : 1), total = length + (startupFrame ? 0 : 1);
        if (length < (startupFrame ? 8 : 4) || total > 1048576) { this.fail(); return; }
        if (pending.length < total) { this.partialBodies++; break; }
        const frame = pending.subarray(0, total); pending = pending.subarray(total);
        if (startupFrame) {
          if (frame.readInt32BE(4) !== 196608) { this.fail(); return; }
          startup = false; forward(upstream, client, frame); continue;
        }
        const type = frame[0], payload = frame.subarray(5);
        if (direction === "frontend") {
          // Fixed real pg COMMIT uses simple Query Q; compare only a fully framed
          // exact command, never a byte-chunk string search or auth inspection.
          if (type === 81 && payload.equals(Buffer.from("COMMIT\0"))) {
            this.clientCommits++; this.event("client-COMMIT-frame-forwarded");
            if (this.clientCommits !== 1) { this.fail(); return; }
          }
          forward(upstream, client, frame);
        } else {
          if (this.clientCommits === 1 && type === 67 && payload.equals(Buffer.from("COMMIT\0"))) {
            blocking = true; this.heldCommitCompletes++; this.event("server-COMMIT-command-complete-withheld");
          } else if (blocking && type === 90 && payload.length === 1 && payload[0] === 73) {
            this.heldReady++; this.event("server-idle-ReadyForQuery-withheld"); this.heldResolve();
          } else if (!blocking) {
            if (type === 67 && payload.equals(Buffer.from("COMMIT\0"))) this.forwardedCommitAcks++;
            forward(client, upstream, frame);
          }
        }
      }
      if (direction === "frontend") frontend = pending; else backend = pending;
    };
    // Exercise buffering with deliberate 7-byte input fragments as well as the
    // arbitrary OS chunk boundaries. No framing assertion depends on TCP layout.
    client.on("data", chunk => { if (!Buffer.isBuffer(chunk)) { this.fail(); return; } for (let at = 0; at < chunk.length; at += 7) parse("frontend", chunk.subarray(at, at + 7)); });
    upstream.on("data", chunk => { if (!Buffer.isBuffer(chunk)) { this.fail(); return; } for (let at = 0; at < chunk.length; at += 7) parse("backend", chunk.subarray(at, at + 7)); });
  }
  async waitHeld() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([this.held, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("B35_NO_COMMIT_ACK_INTERCEPTED")), 8000); })]); }
    finally { clearTimeout(timer); }
  }
  drop() {
    if (this.dropped) return;
    this.dropped = true; this.event("owned-proxy-pair-destroy-requested");
    this.pair?.client.destroy(); this.pair?.upstream.destroy();
  }
  async close() {
    if (this.closed) return;
    this.drop();
    if (this.server.listening) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("B35_PROXY_CLOSE_TIMEOUT")), 3000);
      this.server.close(error => { clearTimeout(timer); if (error) reject(new Error("B35_PROXY_CLOSE_FAILED")); else resolve(); });
    });
    if (this.sockets.size !== 0) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("B35_PROXY_SOCKET_CLOSE_TIMEOUT")), 3000);
      for (const socket of this.sockets) socket.once("close", () => { if (this.sockets.size === 0) { clearTimeout(timer); resolve(); } });
    });
    this.closed = true; this.event("owned-proxy-listener-and-sockets-closed");
  }
  summary() { return { port: this.port, accepts: this.accepts, clientCommits: this.clientCommits, heldCommitCompletes: this.heldCommitCompletes, heldReady: this.heldReady, forwardedCommitAcks: this.forwardedCommitAcks, partialHeaders: this.partialHeaders, partialBodies: this.partialBodies, dropped: this.dropped, failed: this.failed, remainingSockets: this.sockets.size, listening: this.server.listening, events: this.events }; }
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --conditions=react-server --import tsx tests/b35-reservation-commit-loss-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b35-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B35_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B35_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b35_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B35-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
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
let proxy: CommitLossProxy | undefined;
let pendingAttempt: Promise<ReservationAttemptResult> | undefined;
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
  await writeFile(join(root, "fuse-only.diff"), `--- fixed-fbfc48c.sql\n+++ B35-owned-derived.sql\n@@ -5 +5 @@\n-${fuse}\n+\n`);
  await save("derivation.json", { sourceCommit: "fbfc48c95264eaf37826f943b5e35e9fe67fa616", originalSha: sha(sql5),
    derivedSha: sha(derived), removedStatement: fuse, removedAt: fuseAt, removedLength: fuse.length,
    exactOneStatementOnly: true, lineCountPreserved: true, executionScope: "this owned B35 cluster only" });
  verify(sha(derived) === "16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e", "approved derived hash");
  await save("ownership.json", { task: "B35", root, cluster, bin, nonce: randomUUID() });
  console.log(`B35 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B35_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b35_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`,
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
  await admin.query(`CREATE ROLE b35_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  const database = "dream_test_b35_adapter";
  await admin.query("CREATE DATABASE dream_test_b35_adapter OWNER b35_migration TEMPLATE template0 ENCODING 'UTF8'");
  const migration = await connect(database, "b35_migration"), observer = await connect(database);
  observationClient = observer;
  const roleOid = async (name: string) => Number((await observer.query("SELECT oid FROM pg_roles WHERE rolname=$1", [name])).rows[0]?.oid);
  const migrationOid = await roleOid("b35_migration"), rootOid = await roleOid("b35_bootstrap");
  verify(migrationOid && rootOid, "native provisioner OIDs");
  stage = "full SQL1-5 setup";
  await migration.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (let n = 0; n < baseline.length; n++) { activeSource = { text: baseline[n], label: src[n][0], offset: 0 }; await migration.query(baseline[n]); }
  await migration.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false),set_config('dream.b27_bootstrap_oid',$2,false),set_config('dream.b27_expected_pg_major','18',false)", [String(migrationOid), String(rootOid)]);
  activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: 0 }; await migration.query(derived); activeSource = undefined;
  await close(migration);
  for (const login of ["b35_api_a"]) await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'; GRANT dream_api TO ${login} WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002", worker = "00000000-0000-4000-8000-000000000003";
  await observer.query("INSERT INTO auth.users(id) VALUES($1),($2),($3)", [owner, other, worker]);
  const body = { bodyVersion: 1, collectors: [worker], incomingBucket: "synthetic-incoming", intentTtlMs: 120000, issueEnvelopeMs: 90000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3, maxPreparationAgeMs: 30000, policyManagers: [worker], providerMaxBytes: 1048576, verifiers: [worker] };
  const rawBody = canonicalJson(body), digest = sha("B35-owned-synthetic-policy-1");
  await observer.query("INSERT INTO dream.storage_policy_versions VALUES('asset-upload',1,$1,clock_timestamp())", [digest]);
  await observer.query("INSERT INTO dream_reservation.upload_policy_versions VALUES('asset-upload',1,$1,$2,$3)", [digest, rawBody, sha(`upload-policy-body:v1\n${rawBody}`)]);
  await observer.query("INSERT INTO dream.storage_policies VALUES('asset-upload',1,$1,0,clock_timestamp())", [digest]);
  const functions = (await observer.query("SELECT p.oid,p.proowner,n.nspowner,p.proname,p.prosecdef,p.provolatile,p.proconfig,p.proacl,n.nspacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN(to_regprocedure('dream_reservation.read_upload_seed_v1(uuid,text)'),to_regprocedure('dream_reservation.reserve_upload_v1(uuid,text,text)')) ORDER BY p.proname")).rows;
  const target: ServerReservationDependencies["target"] = { schemaVersion: 5, sql5Sha256: "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb", serverMajor: 18, loginOid: await roleOid("b35_api_a"), apiRoleOid: await roleOid("dream_api"), apiMembershipGrantorOid: rootOid, issuerRoleOid: await roleOid("dream_upload_reserver"), migrationOwnerOid: migrationOid, bootstrapOid: rootOid, readSeedFunctionOid: Number(functions.find(f => f.proname === "read_upload_seed_v1")?.oid), reserveUploadFunctionOid: Number(functions.find(f => f.proname === "reserve_upload_v1")?.oid), provenanceId: "B35-owned-" + root.split("b35-native-")[1], scope: "owned-synthetic" };
  const roles = (await observer.query("SELECT oid,rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolinherit FROM pg_roles WHERE rolname LIKE 'b35_%' OR rolname IN ('dream_api','dream_worker','dream_upload_reserver') ORDER BY oid")).rows;
  const memberships = (await observer.query("SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member")).rows;
  await save("synthetic-provisioning.json", { target, roles, functions, memberships, policy: { rawBody, digest }, provenance: "trusted bootstrap created this synthetic cluster; NOT production attestation" });
  const connection = (user: string) => ({ connectionString: `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`, localTestWithoutTls: true });
  const limits = { statementTimeoutMs: 2000, lockTimeoutMs: 1000, idleTimeoutMs: 4000, attemptDeadlineMs: 10000, cleanupDeadlineMs: 3000 };
  let n = 100, generated = 0;
  const uid = (v: number) => `019b9000-0000-7000-8000-${v.toString(16).padStart(12, "0")}`;
  const dependencies: ServerReservationDependencies = { connection: connection("b35_api_a"), target, limits, nextRecordId: () => { generated++; return uid(++n); } };
  const service = postgresUploadReservations(dependencies), actor = actorFromVerifiedUserId(owner);
  const input = { requestId: uid(4), clientJson: '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1024}' };
  const counts = async () => (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests)::text AS requests,(SELECT count(*) FROM dream.storage_objects)::text AS objects,(SELECT count(*) FROM dream.upload_intents)::text AS intents,(SELECT count(*) FROM dream.storage_capability_issues)::text AS capabilities,(SELECT count(*) FROM dream.storage_outbox)::text AS outbox")).rows[0];
  const activity = async () => (await observer.query("SELECT pid,usename,application_name,state,backend_type FROM pg_stat_activity WHERE datname=$1 ORDER BY pid", [database])).rows;
  const closed = async (label: string) => { const rows = await activity(); await save(label + "-activity.json", rows); verify(!rows.some(r => r.application_name === "dream-backend"), label + " no adapter connection remains"); return rows; };
  const audit = async () => lf(await readFile(join(root, "postgres.log"), "utf8"));
  // Secret-bearing provisioning completes before statement logging is enabled.
  await admin.query("ALTER SYSTEM SET log_line_prefix='%m [%p] %a %u@%d '");
  await admin.query("ALTER SYSTEM SET log_error_verbosity='verbose'");
  await admin.query("ALTER SYSTEM SET log_parameter_max_length='0'");
  await admin.query("ALTER SYSTEM SET log_parameter_max_length_on_error='0'");
  await admin.query("ALTER SYSTEM SET log_statement='all'");
  await admin.query("ALTER SYSTEM SET log_disconnections='on'");
  await admin.query("SELECT pg_reload_conf()");
  const auditControl = await connect(database); await auditControl.query("SELECT 1 AS b35_audit_ready"); await close(auditControl);
  verify((await audit()).includes("b35_audit_ready"), "server statement audit enabled before adapter");
  verify((await observer.query("SHOW log_parameter_max_length")).rows[0].log_parameter_max_length === "0", "no bind payload logging");
  await save("before-adapter.json", { counts: await counts(), activity: await activity() });
  proxy = new CommitLossProxy(port); await proxy.listen();
  verify(proxy.port !== port && proxy.port !== 3013, "separate ephemeral loopback proxy");
  await run(powershell, ["-NoProfile", "-Command", `$l=@(Get-NetTCPConnection -LocalPort ${proxy.port} -State Listen); if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1' -or $l[0].OwningProcess -ne ${process.pid}) { exit 1 }; Write-Output 'Owned loopback proxy listener verified'`], "proxy-listener.log");
  await save("proxy-ownership.json", { nodePid: process.pid, proxyPort: proxy.port, primaryPid: pid, primaryPort: port, address: "127.0.0.1" });
  const proxyConnection = { ...connection("b35_api_a"), connectionString: `postgresql://b35_api_a:${password}@127.0.0.1:${proxy.port}/${database}` };
  const losingService = postgresUploadReservations({ ...dependencies, connection: proxyConnection });
  const retryIdentity = snapshotReservationRequest(input);
  let originalReturned = false;
  const started = performance.now();
  stage = "actual COMMIT dispatched and native command completion intercepted";
  pendingAttempt = losingService.reserve(actor, input).then(result => { originalReturned = true; return result; });
  await proxy.waitHeld();
  verify(!proxy.failed && proxy.accepts === 1 && proxy.clientCommits === 1 && proxy.heldCommitCompletes === 1 && proxy.heldReady === 1 && proxy.forwardedCommitAcks === 0, "exact framed COMMIT/CommandComplete/idle ReadyForQuery withheld");
  verify(proxy.partialHeaders > 0 && proxy.partialBodies > 0 && !originalReturned && generated === 3, "fragmented framing with actual adapter still waiting and three IDs only");
  await save("proxy-ack-held.json", proxy.summary());
  stage = "authoritative observer sees committed triple while adapter has no ACK";
  const observerClock = (await observer.query("SELECT pg_backend_pid() AS observer_pid,(extract(epoch FROM clock_timestamp())*1000)::text AS observed_at_ms,pg_is_in_recovery() AS recovery")).rows[0];
  verify(observerClock.recovery === false, "separate authoritative primary observer");
  const stored = (await observer.query("SELECT to_jsonb(h) AS ledger,i.request_json FROM dream_reservation.upload_requests h JOIN dream.upload_intents i ON (i.owner_id,i.request_id,i.id,i.object_id)=(h.owner_id,h.request_id,h.intent_id,h.object_id) WHERE h.owner_id=$1 AND h.request_id=$2", [owner, input.requestId])).rows[0];
  verify(stored !== undefined, "actual committed ledger/intent visible before connection drop");
  const raw = stored.request_json, original = JSON.parse(raw), model = reserveUpload(original.reservation, { principalId: owner, now: original.reservedAt, expectedRevision: 0 });
  const encoded = encodeUploadReservation({ model, requestJson: raw });
  const object = (await observer.query(encoded.selectObject.text, [...encoded.selectObject.values])).rows[0], intent = (await observer.query(encoded.selectIntent.text, [...encoded.selectIntent.values])).rows[0];
  const decoded = decodeUploadReservation({ object, intent });
  const committedCounts = await counts(), heldActivity = await activity();
  verify(committedCounts.requests === "1" && committedCounts.objects === "1" && committedCounts.intents === "1" && committedCounts.capabilities === "0" && committedCounts.outbox === "0", "actual committed single triple before ACK delivery/drop");
  verify(heldActivity.filter(row => row.application_name === "dream-backend").length === 1 && heldActivity.some(row => row.application_name === "dream-backend" && row.state === "idle" && row.usename === "b35_api_a"), "actual restricted backend idle after commit while proxy withholds ACK");
  verify(!originalReturned && !proxy.dropped && performance.now() - started < limits.attemptDeadlineMs, "observer proof precedes drop, public result and external attempt deadline");
  await save("before-drop-committed.json", { observerClock, observedAt: Date.now(), adapterReturned: originalReturned, proxy: proxy.summary(), stored, object, intent, decoded, counts: committedCounts, activity: heldActivity });
  facts.push({ stage, primaryCommitted: true, adapterCommitAcknowledgementDelivered: false });
  stage = "drop only owned proxy pair and observe real driver unknown outcome";
  proxy.drop();
  const unknown = await pendingAttempt;
  verify(unknown.kind === "failure" && unknown.commit === "unknown" && unknown.reason === "OUTCOME_UNKNOWN" && unknown.identity.requestId === input.requestId && unknown.identity.clientDigest === retryIdentity.client.clientDigest, "real lost COMMIT ACK yields safe same-key unknown identity");
  verify(performance.now() - started < limits.attemptDeadlineMs, "actual socket failure observed before attempt timeout");
  const frozenUnknown = JSON.stringify(unknown);
  verify(Object.isFrozen(unknown) && proxy.accepts === 1 && generated === 3, "unknown immutable and no internal retry or extra IDs");
  await proxy.close(); await closed("after-loss");
  await save("unknown-result.json", { result: unknown, at: Date.now(), elapsedMs: performance.now() - started, generated, proxy: proxy.summary() });
  facts.push({ stage, result: unknown });
  stage = "explicit original-key primary reconciliation returns original replay";
  // The direct-primary service above has not been invoked. This is the caller's
  // explicit fresh attempt, not an adapter retry and not a new request identity.
  const replay = await service.reserve(actor, input);
  verify(replay.kind === "success" && replay.commit === "confirmed" && replay.cleanup === "ok" && replay.record.origin === "replayed", "explicit same-key primary reconciliation succeeds as replay");
  if (replay.kind !== "success") throw new Error("B35 unreachable closed reconcile");
  verify(generated === 3 && proxy.accepts === 1 && canonicalJson(await counts()) === canonicalJson(committedCounts), "reconcile allocates zero new IDs and preserves exactly one triple");
  const r = replay.record.reservation;
  verify(r.requestId === encoded.requestId && r.objectId === model.objectId && r.assetId === model.assetId && r.intentId === model.intentId && r.reservedAt === model.reservedAt && r.authorizationUntil === model.intentExpiresAt && r.issueEnvelopeUntil === model.issueEnvelopeUntil && r.maxBytes === encoded.maxBytes && r.policyEpoch === model.policyEpoch && r.policyDigest === model.policyDigest, "all ten original replay DTO bindings");
  const afterObject = (await observer.query(encoded.selectObject.text, [...encoded.selectObject.values])).rows[0], afterIntent = (await observer.query(encoded.selectIntent.text, [...encoded.selectIntent.values])).rows[0];
  const afterDecoded = decodeUploadReservation({ object: afterObject, intent: afterIntent });
  verify(replay.record.rawSha === decoded.rawSha && replay.record.fingerprint === decoded.fingerprint && canonicalJson(afterDecoded) === canonicalJson(decoded) && afterDecoded.requestJson === raw, "native raw/hash/model unchanged after actual loss and explicit replay");
  verify(!replay.record.issuanceAuthorized && JSON.stringify(unknown) === frozenUnknown, "no issuance authority and old unknown not retrospectively mutated");
  const finalActivity = await closed("after-reconciliation");
  await save("reconcile-result.json", { result: replay, at: Date.now(), generated, afterDecoded, counts: await counts(), activity: finalActivity });
  facts.push({ stage, result: replay, generated });
  for (const [path, expected] of modulePins) verify(sha(lf(await readFile(join(repo, path), "utf8"))) === expected, "unchanged fixed adapter " + path);
  verify(sha(lf(await readFile(join(repo, "lib/db/postgres/drafts/0005_upload_reservation.sql"), "utf8"))) === sha(sql5), "original fused SQL5 unchanged");
  await save("checks.json", facts); await save("proxy-final.json", proxy.summary()); completed = true;
  console.log("B35 actual COMMIT response loss and explicit same-key primary reconciliation PASS");
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
  if (proxy) {
    try {
      await proxy.close();
      await run(powershell, ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${proxy.port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output 'Owned proxy listener absent'`], "proxy-stopped-listener.log");
    } catch (error) { await save("proxy-cleanup-failure.json", nativeError(error)); process.exitCode = 1; }
    await save("proxy-final.json", proxy.summary());
  }
  if (pendingAttempt) await pendingAttempt.catch(() => undefined);
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
  console.log(`B35 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent}`);
}

async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
