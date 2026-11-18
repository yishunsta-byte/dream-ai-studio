// B42: bounded ACL cause experiment in one new owned PG18.7 database only.
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
  throw new Error("Usage: node --conditions=react-server --import tsx tests/b42-column-acl-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b42-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B42_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const backendPids: number[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B42_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b42_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B42-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
    statement_timeout: 30000, query_timeout: 45000 });
  clients.add(c); c.on("error", () => undefined); await c.connect(); backendPids.push(Number((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid)); return c;
};
const close = async (c: Client) => { try { await c.end(); } finally { clients.delete(c); } };
const checks: unknown[] = [];
const tupleSql = "pg_catalog.jsonb_build_object('grantor',pg_catalog.jsonb_build_object('principalOid',a.grantor::text),'grantee',pg_catalog.jsonb_build_object('principalOid',a.grantee::text),'privilege',a.privilege_type,'grantable',a.is_grantable)";
const effective = "coalesce($1::aclitem[],$2::aclitem[])";
const oldExpression = `(SELECT coalesce(jsonb_agg(${tupleSql}),'[]'::jsonb) FROM pg_catalog.aclexplode(${effective}) a)`;
// Author's original 25-probe run tested this candidate before the product edit.
// This final fixed-pin replay additionally tests corrected generated columns;
// it was not natively rerun by the author after the source integration.
const candidateExpression = `CASE WHEN coalesce(pg_catalog.cardinality(${effective}),0)=0 THEN '[]'::jsonb ELSE ${oldExpression} END`;
try {
  verify(sha(lf(await readFile(join(repo, "lib/db/postgres/migration-catalog-v3.ts"), "utf8"))) === "aea12e9f90970637d22421904fa0b861f1dfda28c871c5bfffeca5f712640b1a", "fixed B42 product for independent replay");
  // The author's completed cause experiment used the original B40 query. This
  // final replay source is bound to the corrected product; recover that exact
  // old control by removing ONLY its one known guard, then require its SHA.
  const guard = "CASE WHEN coalesce(pg_catalog.cardinality(coalesce(a.attacl,'{}'::aclitem[])),0)=0 THEN '[]'::jsonb ELSE ";
  verify(postgresCatalogQueriesV3.columns.split(guard).length === 2, "one fixed column guard");
  const oldColumns = postgresCatalogQueriesV3.columns.replace(guard, "").replace(/(a[0-9]+\)) END\) AS catalog_row/, "$1) AS catalog_row");
  verify(sha(oldColumns) === "4d6ff67037656bdd98f2bc896bb13ec99949a75aa20379c6d84d2c3096bb6383", "exact original B40 columns control");
  verify(postgresCatalogQueriesV3.columns.includes("pg_catalog.aclexplode(coalesce(a.attacl,'{}'::aclitem[]))"), "actual old generated columns expression");
  await save("experiment-source.json", { productSha: "aea12e9f90970637d22421904fa0b861f1dfda28c871c5bfffeca5f712640b1a", oldColumnsSha: sha(oldColumns), fixedColumnsSha: sha(postgresCatalogQueriesV3.columns), oldExpression, candidateExpression, scope: "minimal synthetic ACL experiment; no P/schema5/full catalog execution" });
  console.log(`B42 owned evidence: ${root}`);
  stage = "signed portable verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B42_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7");
  await save("ownership.json", { task: "B42", root, cluster, bin, nonce: randomUUID() });
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b42_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", 150000);
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
  await save("run.json", { root, cluster, bin, pid, port, database: "dream_test_B42" });
  stage = "minimal synthetic setup";
  const admin = await connect("postgres");
  await admin.query(`CREATE ROLE b42_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${password}'; CREATE ROLE b42_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`);
  await admin.query('CREATE DATABASE "dream_test_B42" OWNER b42_owner TEMPLATE template0 ENCODING \'UTF8\'');
  const owner = await connect("dream_test_B42", "b42_owner");
  await owner.query("SET search_path=pg_catalog; CREATE SCHEMA dream; CREATE TABLE dream.acl_probe(c text)");
  const roles = (await owner.query("SELECT oid::text,rolname FROM pg_catalog.pg_roles WHERE rolname IN ('b42_owner','b42_reader') ORDER BY rolname")).rows;
  const ownerOid = roles.find(r => r.rolname === "b42_owner").oid, readerOid = roles.find(r => r.rolname === "b42_reader").oid;
  const column = async () => (await owner.query("SELECT a.attacl::text AS raw_acl,a.attacl IS NULL AS raw_is_null,pg_catalog.array_ndims(a.attacl) AS ndims,pg_catalog.cardinality(a.attacl) AS cardinality,a.attnum,a.attname,c.oid::text AS relation_oid,c.relowner::text AS owner_oid FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attname=$3 AND a.attnum>0", ["dream", "acl_probe", "c"])).rows[0];
  const initial = await column(); verify(initial.raw_is_null && initial.cardinality === null, "native new column attacl NULL");
  await owner.query("BEGIN");
  const probe = async (label: string, sql: string, values: unknown[], expectedCode?: string) => {
    await owner.query("SAVEPOINT acl_case");
    try {
      const result = await owner.query(sql, values);
      verify(!expectedCode, label + " expected SQL error");
      checks.push({ label, sqlSha: sha(sql), rows: result.rows }); await save("checks.json", checks);
      await owner.query("RELEASE SAVEPOINT acl_case"); return result.rows;
    } catch (error) {
      await owner.query("ROLLBACK TO SAVEPOINT acl_case"); await owner.query("RELEASE SAVEPOINT acl_case");
      const e = nativeError(error); checks.push({ label, error: e }); await save("checks.json", checks);
      if (!expectedCode || e.code !== expectedCode) throw error;
      return [];
    }
  };
  stage = "bounded NULL/empty ACL causal controls";
  await probe("original generated columns on native NULL attacl", oldColumns, [[], [], []], "22023");
  const fixedNull = await probe("fixed generated columns on native NULL attacl", postgresCatalogQueriesV3.columns, [[], [], []]);
  verify(fixedNull.length === 1 && fixedNull[0].catalog_row.acl.length === 0, "fixed product NULL column ACL");
  const directNull = await probe("direct aclexplode SQL NULL", "SELECT count(*)::integer AS tuples FROM pg_catalog.aclexplode($1::aclitem[])", [null]);
  verify(directNull[0].tuples === 0, "direct SQL NULL yields no tuples");
  await probe("direct aclexplode explicit empty", "SELECT count(*)::integer AS tuples FROM pg_catalog.aclexplode($1::aclitem[])", ["{}"], "22023");
  const metadata = await probe("NULL and empty dimensions", "SELECT $1::aclitem[] IS NULL AS null_acl_is_null,pg_catalog.array_ndims($1::aclitem[]) AS null_dims,pg_catalog.cardinality($1::aclitem[]) AS null_count,$2::aclitem[] IS NULL AS empty_is_null,pg_catalog.array_ndims($2::aclitem[]) AS empty_dims,pg_catalog.cardinality($2::aclitem[]) AS empty_count", [null, "{}"]);
  verify(metadata[0].null_acl_is_null && !metadata[0].empty_is_null && metadata[0].empty_count === 0, "native NULL/empty distinction");
  await probe("old NULL fallback creates invalid empty", `SELECT ${oldExpression} AS acl`, [initial.raw_acl, "{}"], "22023");
  await probe("old explicit empty", `SELECT ${oldExpression} AS acl`, ["{}", "{}"], "22023");
  for (const [label, value] of [["native NULL", initial.raw_acl], ["explicit empty", "{}"]]) {
    const r = await probe("candidate " + label, `SELECT ${candidateExpression} AS acl`, [value, "{}"]);
    verify(Array.isArray(r[0].acl) && r[0].acl.length === 0, "candidate empty tuples " + label);
  }
  stage = "actual column grants and grant option";
  await owner.query("GRANT SELECT(c) ON dream.acl_probe TO b42_reader WITH GRANT OPTION; GRANT UPDATE(c) ON dream.acl_probe TO PUBLIC");
  const granted = await column(); verify(!granted.raw_is_null && granted.cardinality > 0, "actual nonempty attacl");
  const actual = await probe("original generated columns nonempty grants", oldColumns, [[], [], []]);
  const fixedGrants = await probe("fixed generated columns nonempty grants", postgresCatalogQueriesV3.columns, [[], [], []]);
  const old = await probe("old complete grant tuples", `SELECT ${oldExpression} AS acl`, [granted.raw_acl, "{}"]);
  const candidate = await probe("candidate complete grant tuples", `SELECT ${candidateExpression} AS acl`, [granted.raw_acl, "{}"]);
  const sorted = (x: unknown[]) => x.map(v => JSON.stringify(v)).sort().join("\n");
  verify(sorted(old[0].acl) === sorted(candidate[0].acl) && sorted(actual[0].catalog_row.acl) === sorted(candidate[0].acl), "all grant tuples exactly preserved");
  verify(sorted(fixedGrants[0].catalog_row.acl) === sorted(candidate[0].acl), "fixed product retains all nonempty tuples");
  const tuples = candidate[0].acl as {grantor:{principalOid:string};grantee:{principalOid:string};privilege:string;grantable:boolean}[];
  verify(tuples.length === 2 && tuples.every(t => t.grantor.principalOid === ownerOid) && tuples.some(t => t.grantee.principalOid === readerOid && t.privilege === "SELECT" && t.grantable) && tuples.some(t => t.grantee.principalOid === "0" && t.privilege === "UPDATE" && !t.grantable), "PUBLIC and grant option/native grantor retained");
  await owner.query("REVOKE GRANT OPTION FOR SELECT(c) ON dream.acl_probe FROM b42_reader");
  const noOption = await column(), withoutOption = await probe("candidate after revoke grant option", `SELECT ${candidateExpression} AS acl`, [noOption.raw_acl, "{}"]);
  verify(withoutOption[0].acl.length === 2 && withoutOption[0].acl.every((r: {grantable:boolean}) => !r.grantable), "grant option removed without dropping tuples");
  await owner.query("REVOKE SELECT(c) ON dream.acl_probe FROM b42_reader; REVOKE UPDATE(c) ON dream.acl_probe FROM PUBLIC");
  const revoked = await column(), afterRevoke = await probe("candidate after revoke all", `SELECT ${candidateExpression} AS acl`, [revoked.raw_acl, "{}"]);
  verify(afterRevoke[0].acl.length === 0, "revoke returns no column tuples");
  stage = "default effective ACL versus explicit empty";
  for (const kind of ["n", "r", "f", "T"]) {
    const defaults = (await owner.query("SELECT pg_catalog.acldefault($1::\"char\",$2::oid)::text AS acl", [kind, ownerOid])).rows[0].acl;
    const original = await probe("old default " + kind, `SELECT ${oldExpression} AS acl`, [null, defaults]);
    const next = await probe("candidate default " + kind, `SELECT ${candidateExpression} AS acl`, [null, defaults]);
    verify(next[0].acl.length > 0 && sorted(original[0].acl) === sorted(next[0].acl), "default tuples unchanged " + kind);
    const explicit = await probe("candidate explicit empty overrides default " + kind, `SELECT ${candidateExpression} AS acl`, ["{}", defaults]);
    verify(explicit[0].acl.length === 0, "explicit empty is not default " + kind);
  }
  const preservedTable = (await owner.query("SELECT relacl IS NULL AS raw_is_null FROM pg_catalog.pg_class WHERE oid='dream.acl_probe'::regclass")).rows[0];
  verify(preservedTable.raw_is_null, "column grants/revokes did not overwrite relation raw NULL");
  await owner.query("ROLLBACK");
  await save("final.json", { causeConfirmed: true, initial, granted, noOption, revoked, roles, preservedTable, expectedErrors: checks.filter(c => Object.hasOwn(c as object, "error")).length, checks: checks.length, originalGeneratedColumnsExecuted: true, candidateExpressionOnly: false, correctedGeneratedColumnsExecuted: true, productEditedDuringExperiment: false, noPOrFullCatalogRun: true, backendPids });
  completed = true; console.log("B42 bounded ACL cause confirmed; candidate NULL/empty/default/nonempty behavior verified");
} catch (error) {
  await save("first-unexpected-failure.json", { stage, error: nativeError(error), checks });
  console.error(JSON.stringify({ stage, error: nativeError(error) })); process.exitCode = 1;
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
  console.log(`B42 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent && processAbsent}`);
}
async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
