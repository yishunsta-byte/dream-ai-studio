// B46: minimal owned policy dependency multiplicity experiment; no P/full reader.
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
  throw new Error("Usage: node --conditions=react-server --import tsx tests/b46-policy-dependency-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b46-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B46_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const backendPids: number[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B46_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b46_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B46-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
    statement_timeout: 30000, query_timeout: 45000 });
  clients.add(c); c.on("error", () => undefined); await c.connect(); backendPids.push(Number((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid)); return c;
};
const close = async (c: Client) => { try { await c.end(); } finally { clients.delete(c); } };
type NativeEndpoint = { class: string; nativeOid: string; subId: number };
type NativeDependency = { dependent: NativeEndpoint; referenced: NativeEndpoint; dependencyType: string };
const edgeKey = (d: NativeDependency) => JSON.stringify([d.dependent.class, d.dependent.nativeOid, d.dependent.subId, d.referenced.class, d.referenced.nativeOid, d.referenced.subId, d.dependencyType]);
const groupNative = (rows: NativeDependency[]) => {
  verify(rows.length <= 10000, "bounded dependency input");
  const groups = new Map<string, { row: NativeDependency; multiplicity: number }>();
  for (const row of rows) {
    const key = edgeKey(row), previous = groups.get(key);
    if (previous) previous.multiplicity++; else groups.set(key, { row, multiplicity: 1 });
  }
  const result = [...groups.values()];
  verify(result.every(g => Number.isSafeInteger(g.multiplicity) && g.multiplicity > 0 && g.multiplicity <= 10000) && result.reduce((sum, g) => sum + g.multiplicity, 0) === rows.length, "exact positive bounded quantity conservation");
  return result;
};
try {
  const originalSource = lf(await readFile(join(repo, "lib/db/postgres/migration-catalog-v3.ts"), "utf8"));
  verify(sha(originalSource) === "97ccf4f241dcbf5c572a314d61d10f488891977929cadc71e55c216374354e14", "fixed descriptor4 source for independent replay");
  verify(originalSource.includes("need(new Set(keys).size === keys.length);"), "historical uniqueness condition retained for other categories");
  verify(sha(postgresCatalogQueriesV3.dependencies) === "425c37731ce1444d0398adf6808f788fd6a5d40c8dd8138d7829e94d08d5e9ff", "exact unchanged dependency SELECT control");
  await save("source.json", { productSha: sha(originalSource), dependencyQuerySha: sha(postgresCatalogQueriesV3.dependencies), sourceScope: "descriptor4 independent replay; same bounded native subset", noP: true, noFullReader: true });
  console.log(`B46 owned evidence: ${root}`);
  stage = "signed portable verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B46_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7");
  await save("ownership.json", { task: "B46", root, cluster, bin, nonce: randomUUID() });
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b46_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", 150000);
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
  await save("run.json", { root, cluster, bin, pid, port, database: "dream_test_B46" });
  stage = "minimal policy matrix setup";
  const admin = await connect("postgres");
  await admin.query(`CREATE ROLE b46_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${password}'`);
  await admin.query('CREATE DATABASE "dream_test_B46" OWNER b46_owner TEMPLATE template0 ENCODING \'UTF8\'');
  const owner = await connect("dream_test_B46", "b46_owner");
  await owner.query("CREATE SCHEMA dream; CREATE TABLE dream.policy_probe(owner_id uuid,other_id uuid); CREATE FUNCTION dream.actor_id() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'; CREATE FUNCTION dream.other_actor_id() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'; ALTER TABLE dream.policy_probe ENABLE ROW LEVEL SECURITY");
  await owner.query("CREATE POLICY using_only ON dream.policy_probe FOR SELECT USING(owner_id=(SELECT dream.actor_id())); CREATE POLICY check_only ON dream.policy_probe FOR INSERT WITH CHECK(owner_id=(SELECT dream.actor_id())); CREATE POLICY both_same ON dream.policy_probe FOR ALL USING(owner_id=(SELECT dream.actor_id())) WITH CHECK(owner_id=(SELECT dream.actor_id())); CREATE POLICY both_different ON dream.policy_probe FOR ALL USING(owner_id=(SELECT dream.actor_id())) WITH CHECK(other_id=(SELECT dream.other_actor_id()))");
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog");
  const policies = (await owner.query("SELECT p.oid::text,p.polname,pg_catalog.pg_get_expr(p.polqual,p.polrelid,false) AS using_expression,pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,false) AS check_expression FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 ORDER BY p.polname", ["dream", "policy_probe"])).rows;
  verify(policies.length === 4, "four explicit policy cases"); const policyIds = policies.map(p => p.oid);
  const functions = (await owner.query("SELECT p.oid::text,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname IN ('actor_id','other_actor_id') ORDER BY p.proname", ["dream"])).rows;
  verify(functions.length === 2, "two distinct observed actor functions");
  stage = "physical base dependency versus unchanged collector";
  const base = (await owner.query("SELECT d.ctid::text AS diagnostic_ctid,d.classid::regclass::text AS class,d.objid::text AS native_oid,d.objsubid,d.refclassid::regclass::text AS referenced_class,d.refobjid::text AS referenced_oid,d.refobjsubid,d.deptype FROM pg_catalog.pg_depend d WHERE d.classid='pg_policy'::regclass AND d.objid=ANY($1::oid[]) ORDER BY d.objid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype,d.ctid", [policyIds])).rows;
  const nativeRows: NativeDependency[] = base.map(r => ({ dependent: { class: r.class, nativeOid: r.native_oid, subId: r.objsubid }, referenced: { class: r.referenced_class, nativeOid: r.referenced_oid, subId: r.refobjsubid }, dependencyType: r.deptype }));
  const projectedAll = (await owner.query(postgresCatalogQueriesV3.dependencies, [[], [], []])).rows;
  const projected: NativeDependency[] = projectedAll.map(r => r.catalog_row).filter(r => r.dependent.class === "pg_policy" && policyIds.includes(r.dependent.nativeOid));
  const bag = (rows: NativeDependency[]) => groupNative(rows).map(g => JSON.stringify([edgeKey(g.row), g.multiplicity])).sort();
  verify(JSON.stringify(bag(projected)) === JSON.stringify(bag(nativeRows)), "collector policy subset equals physical base multiset");
  await save("physical-pg-depend.json", base); await save("projection-dependencies.json", projectedAll); await save("observed-policy-function-matrix.json", { policies, functions });
  const actor = functions.find(f => f.proname === "actor_id")!.oid, otherActor = functions.find(f => f.proname === "other_actor_id")!.oid;
  const functionCount = (name: string, functionOid: string) => {
    const policyOid = policies.find(p => p.polname === name)!.oid;
    return base.filter(r => r.native_oid === policyOid && r.referenced_class === "pg_proc" && r.referenced_oid === functionOid && r.deptype === "n");
  };
  verify(functionCount("using_only", actor).length === 1 && functionCount("check_only", actor).length === 1 && functionCount("both_same", actor).length === 2, "USING/CHECK physical multiplicity controls");
  verify(functionCount("both_different", actor).length === 1 && functionCount("both_different", otherActor).length === 1, "different expressions retain distinct native endpoints");
  const same = functionCount("both_same", actor); verify(new Set(same.map(r => r.diagnostic_ctid)).size === 2, "two distinct physical tuples for one exact native dependency");
  // CTIDs are diagnostics only: edgeKey/group rows never include them.
  const oldWouldAccept = new Set(projected.map(edgeKey)).size === projected.length;
  verify(!oldWouldAccept, "original all-row unique guard rejects actual policy dependency bag");
  const counted = groupNative(projected);
  verify(counted.reduce((sum, g) => sum + g.multiplicity, 0) === projected.length, "candidate conserves every physical row");
  const samePolicyId = policies.find(p => p.polname === "both_same")!.oid;
  verify(counted.some(g => g.row.dependent.nativeOid === samePolicyId && g.row.referenced.class === "pg_proc" && g.row.referenced.nativeOid === actor && g.multiplicity === 2), "same native edge explicitly represented with multiplicity2");
  await save("final.json", { physicalCauseConfirmed: true, policies, functions, basePolicyRows: nativeRows.length, projectedPolicyRows: projected.length, distinctNativeEdges: counted.length, exactProjectionMultisetMatch: true, oldWouldAccept, candidateCountedNativeRows: counted, physicalSameActorRows: same, ctidDiagnosticOnly: true, countedQuantity: counted.reduce((sum,g)=>sum+g.multiplicity,0), noFullDecoderOrReader: true, noP: true, backendPids });
  await owner.query("ROLLBACK"); completed = true;
  console.log("B46 physical policy dependency multiplicity confirmed; collector preserves exact multiset; candidate count conserves rows");
} catch (error) {
  await save("first-unexpected-failure.json", { stage, error: nativeError(error) }); console.error(JSON.stringify({ stage, error: nativeError(error) })); process.exitCode = 1;
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
  console.log(`B46 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent && processAbsent}`);
}
async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
