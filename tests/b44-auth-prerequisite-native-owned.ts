// B44: minimal owned Auth primary prerequisite facts only; no P/full reader.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { postgresCatalogQueriesV3 } from "../lib/db/postgres/migration-catalog-v3";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --conditions=react-server --import tsx tests/b44-auth-prerequisite-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b44-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B44_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const backendPids: number[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B44_ASSERT: ${label}`); };
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
  for (const key of ["message", "code", "position", "schema", "table", "constraint", "routine"]) {
    if (e[key] !== undefined) result[key] = String(e[key]).replaceAll(password, "[synthetic-secret-redacted]");
  }
  return result;
};
const connect = async (database: string, user = "b44_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B44-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
    statement_timeout: 30000, query_timeout: 45000 });
  clients.add(c); c.on("error", () => undefined); await c.connect(); backendPids.push(Number((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid)); return c;
};
const close = async (c: Client) => { try { await c.end(); } finally { clients.delete(c); } };
try {
  verify(sha(lf(await readFile(join(repo, "lib/db/postgres/migration-catalog-v3.ts"), "utf8"))) === "87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0", "fixed B44 observation source");
  console.log(`B44 owned evidence: ${root}`);
  await save("source.json", { catalogSha: "87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0", constraintsQuerySha: sha(postgresCatalogQueriesV3.constraints), indexesQuerySha: sha(postgresCatalogQueriesV3.indexes), noPOrFullReader: true });
  stage = "signed portable verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B44_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7");
  await save("ownership.json", { task: "B44", root, cluster, bin, nonce: randomUUID() });
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b44_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", 150000);
  const listener = createServer();
  port = await new Promise<number>((res, rej) => { listener.once("error", rej); listener.listen(0, "127.0.0.1", () => {
    const address = listener.address(); if (!address || typeof address === "string") return rej(new Error("No owned port"));
    listener.close(error => error ? rej(error) : res(address.port));
  }); });
  verify(port !== 3013, "not shared port"); startAttempted = true;
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length_on_error=0 -c log_connections=off -c log_disconnections=off`, "-w", "start"], "start.log");
  const pidLines = (await readFile(join(cluster, "postmaster.pid"), "utf8")).trim().split(/\r?\n/);
  pid = Number(pidLines[0]); verify(resolve(pidLines[1]) === resolve(cluster) && Number(pidLines[3]) === port, "owned directory/port/PID");
  await run(powershell, ["-NoProfile", "-Command", `$l=@(Get-NetTCPConnection -LocalPort ${port} -State Listen); if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1' -or $l[0].OwningProcess -ne ${pid}) { exit 1 }; Write-Output 'Owned loopback PID verified'`], "listener.log");
  await save("run.json", { root, cluster, bin, pid, port, database: "dream_test_B44" });
  stage = "minimal Auth prerequisite setup";
  const admin = await connect("postgres");
  await admin.query(`CREATE ROLE b44_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB NOINHERIT NOREPLICATION PASSWORD '${password}'`);
  await admin.query('CREATE DATABASE "dream_test_B44" OWNER b44_migration TEMPLATE template0 ENCODING \'UTF8\'');
  const owner = await connect("dream_test_B44", "b44_migration");
  const m = (await owner.query("SELECT oid::text,rolname,rolsuper,rolcreaterole,rolinherit,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user")).rows[0];
  verify(!m.rolsuper && m.rolcreaterole && !m.rolinherit && !m.rolbypassrls, "actual M role recipe");
  await owner.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog");
  stage = "fixed Auth native fact discovery";
  const discovered = (await owner.query("SELECT r.oid::text AS relation_oid,r.relowner::text AS relation_owner,r.relkind,r.relispartition,a.attnum,a.attname,a.atttypid::text AS type_oid,a.attnotnull,a.attisdropped,a.atttypmod,a.attndims,k.oid::text AS constraint_oid,k.conname,k.contype,k.conkey,k.conindid::text AS constraint_index,i.oid::text AS index_oid,i.relname AS index_name,i.relowner::text AS index_owner,x.indrelid::text AS index_parent,x.indkey::text AS index_key,x.indisprimary,x.indisunique,x.indisvalid,x.indisready,x.indislive FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=1 JOIN pg_catalog.pg_index x ON x.indrelid=r.oid AND x.indisprimary JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_constraint k ON k.conindid=x.indexrelid AND k.conrelid=r.oid WHERE n.nspname=$1 AND r.relname=$2", ["auth", "users"])).rows;
  verify(discovered.length === 1, "one observed Auth primary owner constraint"); const facts = discovered[0];
  verify(facts.relation_owner === m.oid && facts.index_owner === m.oid && facts.relkind === "r" && !facts.relispartition, "actual prerequisite owner M, not fictional constraint owner");
  verify(facts.attnum === 1 && facts.attname === "id" && facts.attnotnull && !facts.attisdropped && facts.atttypmod === -1 && facts.attndims === 0, "native id column");
  const uuid = (await owner.query("SELECT t.oid::text,n.nspname,t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname=$2", ["pg_catalog", "uuid"])).rows;
  verify(uuid.length === 1 && facts.type_oid === uuid[0].oid && facts.contype === "p" && JSON.stringify(facts.conkey) === "[1]" && facts.constraint_index === facts.index_oid && facts.index_parent === facts.relation_oid && facts.index_key === "1", "native UUID PK exact key/index links");
  verify(facts.indisprimary && facts.indisunique && facts.indisvalid && facts.indisready && facts.indislive, "native index flags");
  const values = [[m.oid], [facts.relation_oid], [facts.index_oid]];
  stage = "actual fixed prerequisite projections";
  const constraintRows = (await owner.query(postgresCatalogQueriesV3.constraints, values)).rows;
  const indexRows = (await owner.query(postgresCatalogQueriesV3.indexes, values)).rows;
  await save("projection-constraints.json", constraintRows); await save("projection-indexes.json", indexRows);
  verify(constraintRows.length === 1 && indexRows.length === 1, "only exact external prerequisite rows");
  const c = constraintRows[0].catalog_row, i = indexRows[0].catalog_row;
  verify(c.scope === "external-prerequisite" && c.nativeOid === facts.constraint_oid && c.identity.name === facts.conname && c.identity.object.nativeOid === facts.relation_oid && c.kind === "p", "actual typed PK observation");
  verify(c.prerequisite.relationOwner.principalOid === m.oid && c.prerequisite.indexOwner.principalOid === m.oid && c.prerequisite.column.type.nativeOid === uuid[0].oid && c.prerequisite.column.type.name === "uuid", "projection observed owner/type proof");
  verify(c.prerequisite.indexConstraints.length === 1 && c.prerequisite.indexConstraints[0].nativeOid === c.nativeOid && c.supportingIndex.nativeOid === i.nativeOid && c.prerequisite.index.nativeOid === i.nativeOid && i.nativeOid === facts.index_oid, "observed constraint/index mutual linkage");
  verify(JSON.stringify(c.keyColumns) === "[1]" && JSON.stringify(i.keyColumns) === "[1]" && i.primary && i.unique && i.valid && i.ready && i.live && i.immediate && i.relation.nativeOid === facts.relation_oid, "observed fixed projections exact key and flags");
  stage = "exact internal prerequisite dependency";
  const dependency = (await owner.query("SELECT d.classid::regclass::text AS class,d.objid::text AS native_oid,d.objsubid,d.refclassid::regclass::text AS referenced_class,d.refobjid::text AS referenced_oid,d.refobjsubid,d.deptype FROM pg_catalog.pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=$1::oid AND d.refclassid='pg_constraint'::regclass AND d.refobjid=$2::oid", [facts.index_oid, facts.constraint_oid])).rows;
  verify(dependency.length === 1 && dependency[0].deptype === "i" && dependency[0].objsubid === 0 && dependency[0].refobjsubid === 0, "exact internal dependency retained");
  const auth = { schema: "auth", name: "users" };
  const externalFacts = [
    { endpoint: { class: "pg_class", nativeOid: facts.relation_oid, subId: 0 }, identity: { kind: "relation", ...auth } },
    { endpoint: { class: "pg_class", nativeOid: facts.relation_oid, subId: 1 }, identity: { kind: "column", relation: auth, ordinal: 1, name: "id" } },
    { endpoint: { class: "pg_class", nativeOid: facts.index_oid, subId: 0 }, identity: { kind: "index", relation: auth, name: facts.index_name } },
    { endpoint: { class: "pg_constraint", nativeOid: facts.constraint_oid, subId: 0 }, identity: { kind: "constraint", objectKind: "relation", object: auth, name: facts.conname } },
  ];
  await save("actual-prerequisite-facts.json", { m, facts, uuid: uuid[0], dependency, externalFacts, ownerScope: "owned recipe auth relation/index owner M only", constraintHasNoIndependentOwnerColumn: true, noFullReader: true, noP: true });
  await owner.query("ROLLBACK"); completed = true;
  console.log("B44 observed exact Auth UUID primary constraint/index/type/owner/dependency facts; no full catalog run");
} catch (error) {
  await save("first-failure.json", { stage, error: nativeError(error) }); console.error(JSON.stringify({ stage, error: nativeError(error) })); process.exitCode = 1;
} finally {
  for (const c of clients) { await c.query("ROLLBACK").catch(() => undefined); await close(c).catch(() => undefined); }
  let pidAbsent = false, listenerAbsent = false, processAbsent = false;
  try {
    if (startAttempted) await stopOwnedCluster();
    try { await access(join(cluster, "postmaster.pid")); } catch { pidAbsent = true; }
    if (port) { await run(powershell, ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output 'Owned port listener absent'`], "stopped-listener.log"); listenerAbsent = true; }
    if (pid) { await run(powershell, ["-NoProfile", "-Command", `if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 1 }; Write-Output 'Owned postmaster process absent'`], "stopped-process.log"); processAbsent = true; }
  } catch (error) { await save("cleanup-failure.json", nativeError(error)); process.exitCode = 1; }
  await save("cleanup-safe.json", { pid, port, backendPids, postmasterPidAbsent: pidAbsent, listenerAbsent, processAbsent, completed });
  if (!completed || !pidAbsent || !listenerAbsent || !processAbsent) process.exitCode = 1;
  console.log(`B44 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent && processAbsent}`);
}
async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
