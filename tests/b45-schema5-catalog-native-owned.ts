// B45: explicit new owned Windows PG18.7 diagnostic only; no DSN/env files.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { loadPostgresMigrationsV3 } from "../lib/db/postgres/migration-manifest-v3";
import { readPostgresCatalogV3, postgresCatalogQueriesV3, type CatalogManagementBindingsV3 } from "../lib/db/postgres/migration-catalog-v3";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --conditions=react-server --import tsx tests/b45-schema5-catalog-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b45-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { NODE_ENV: "test" as const, SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B45_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
const backendPids: number[] = [];
let stage = "source verification", category = "none", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B45_ASSERT: ${label}`); };
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
const connect = async (database: string, user = "b45_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B45-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
    statement_timeout: 30000, query_timeout: 45000 });
  clients.add(c); c.on("error", () => undefined); await c.connect(); backendPids.push(Number((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid)); return c;
};
const close = async (c: Client) => { try { await c.end(); } finally { clients.delete(c); } };
// This finite recipe is fixed before native discovery. It is not learned from
// target dependency endpoints, nor expanded after an unknown endpoint failure.
const typeNames = ["bool", "bytea", "char", "name", "int8", "int2", "int4", "text", "oid", "float4", "float8", "bpchar", "varchar", "date", "time", "timestamp", "timestamptz", "interval", "numeric", "uuid", "json", "jsonb", "record", "cstring", "internal", "anyarray", "anyelement", "anynonarray", "anycompatible", "anycompatiblearray", "anycompatiblenonarray", "void", "trigger", "_text", "_int2", "_oid"];
const functionNames = ["record_in", "record_out", "record_recv", "record_send", "array_in", "array_out", "array_recv", "array_send", "array_typanalyze", "array_subscript_handler", "domain_in", "domain_recv", "int8out", "int8send", "textout", "textsend", "RI_FKey_check_ins", "RI_FKey_check_upd", "RI_FKey_restrict_del", "RI_FKey_noaction_del", "RI_FKey_cascade_del", "RI_FKey_setnull_del", "RI_FKey_setdefault_del", "RI_FKey_noaction_upd", "RI_FKey_restrict_upd", "RI_FKey_cascade_upd", "RI_FKey_setnull_upd", "RI_FKey_setdefault_upd", "transaction_timestamp", "clock_timestamp", "now", "length", "octet_length", "char_length", "lower", "upper", "btrim", "split_part", "substring", "strpos", "replace", "coalesce", "current_setting", "jsonb_typeof", "jsonb_array_length", "jsonb_object_keys", "jsonb_each", "jsonb_extract_path_text", "jsonb_build_object", "jsonb_build_array", "to_jsonb", "encode", "decode", "sha256", "convert_to", "uuid_extract_version", "uuid_extract_timestamp", "uuidv7", "floor", "ceil", "abs", "cardinality", "array_length", "array_position", "array_append", "array_to_string", "textregexeq", "textregexne", "texteq", "textne", "uuid_eq", "int8eq", "int8ge", "int8le", "int8gt", "int8lt", "int4eq", "int4ge", "int4le", "numeric_eq", "numeric_ge", "numeric_le"];
const operatorNames = ["=", "<>", "<", "<=", ">", ">=", "~", "!~", "||", "+", "-", "*", "/", "->", "->>", "?", "@>"];
const journalSql = "CREATE SCHEMA dream_migrations; REVOKE ALL ON SCHEMA dream_migrations FROM PUBLIC; CREATE TABLE dream_migrations.history(ordinal integer PRIMARY KEY CHECK(ordinal>0),id text NOT NULL UNIQUE,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()); REVOKE ALL ON TABLE dream_migrations.history FROM PUBLIC";
let firstNativeError: unknown, lastRows: unknown, projectionCalls = 0, migrationCommitted = false;
let ownedObserver: Client | undefined;
try {
  const pins = [["lib/db/postgres/migration-manifest-v3.ts", "0f6ece37635873b5655ee841e5318e6c9e8bb7cdb580653e8d80e4285a251698"], ["lib/db/postgres/migration-catalog-v3.ts", "87c2a8fd3fab7cec6edd84b4203de87b2580bbad3b43c9ffefdf900b2bc80ae0"], ["lib/db/postgres/drafts/0005_upload_reservation.sql", "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb"]] as const;
  for (const [path, hash] of pins) verify(sha(lf(await readFile(join(repo, path), "utf8"))) === hash, "fixed source " + path);
  const sources = await loadPostgresMigrationsV3(5);
  verify(sources.length === 5 && sources[4].checksum === "f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339", "P full identity");
  await save("sources.json", sources.map(({ sql, ...entry }) => ({ ...entry, actualBodySha: sha(sql) })));
  verify((await readFile(join(repo, "lib/db/postgres/migration-runner-v2.ts"), "utf8")).includes(JSON.stringify(journalSql)), "copied fixed journal prerequisite");
  await save("ownership.json", { task: "B45", root, cluster, bin, nonce: randomUUID(), source: "P", profile: "none" });
  console.log(`B45 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B45_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b45_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", 150000);
  const listener = createServer();
  port = await new Promise<number>((res, rej) => { listener.once("error", rej); listener.listen(0, "127.0.0.1", () => {
    const address = listener.address(); if (!address || typeof address === "string") return rej(new Error("No owned port"));
    listener.close(error => error ? rej(error) : res(address.port));
  }); });
  verify(port !== 3013, "never shared app port"); startAttempted = true;
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length_on_error=0 -c log_connections=off -c log_disconnections=off`, "-w", "start"], "start.log");
  const pidLines = (await readFile(join(cluster, "postmaster.pid"), "utf8")).trim().split(/\r?\n/);
  pid = Number(pidLines[0]); verify(resolve(pidLines[1]) === resolve(cluster) && Number(pidLines[3]) === port, "owned PID directory/port");
  await run(powershell, ["-NoProfile", "-Command", `$l=@(Get-NetTCPConnection -LocalPort ${port} -State Listen); if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1' -or $l[0].OwningProcess -ne ${pid}) { exit 1 }; Write-Output 'Owned loopback PID verified'`], "listener.log");
  await save("run.json", { root, cluster, bin, pid, port, address: "127.0.0.1" });
  stage = "owned prerequisite provisioning";
  const admin = await connect("postgres");
  await admin.query(`CREATE ROLE b45_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOREPLICATION PASSWORD '${password}'`);
  await admin.query('CREATE DATABASE "dream_test_B45" OWNER b45_migration TEMPLATE template0 ENCODING \'UTF8\'');
  const migration = await connect("dream_test_B45", "b45_migration"), observer = await connect("dream_test_B45"); ownedObserver = observer;
  const principalRows = (await observer.query("SELECT oid::text,rolname,rolsuper,rolcreaterole,rolinherit,rolbypassrls,rolcanlogin FROM pg_catalog.pg_roles WHERE rolname IN ('b45_migration','b45_bootstrap') ORDER BY rolname")).rows;
  const m = principalRows.find(r => r.rolname === "b45_migration"), b = principalRows.find(r => r.rolname === "b45_bootstrap");
  verify(m && b && !m.rolsuper && !m.rolbypassrls && m.rolcreaterole && !m.rolinherit && b.rolsuper && m.oid !== b.oid, "B36 actual M/B");
  await migration.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  stage = "explicit migration transaction";
  await migration.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await migration.query("SET LOCAL search_path=pg_catalog");
  await migration.query("SELECT pg_catalog.pg_advisory_xact_lock(1725031001,5)");
  await migration.query(journalSql);
  await migration.query("SELECT pg_catalog.set_config('dream.b27_migration_owner_oid',$1,true),pg_catalog.set_config('dream.b27_bootstrap_oid',$2,true),pg_catalog.set_config('dream.b27_expected_pg_major','18',true)", [m.oid, b.oid]);
  for (const entry of sources) {
    category = entry.id; await migration.query(entry.sql);
    await migration.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES($1,$2,$3)", [entry.ordinal, entry.id, entry.checksum]);
  }
  await migration.query("COMMIT"); migrationCommitted = true;
  const memberships = (await observer.query("SELECT oid::text,roleid::text,member::text,grantor::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE member=$1::oid OR roleid=$1::oid ORDER BY roleid", [m.oid])).rows;
  verify(memberships.length === 3 && memberships.every(r => r.member === m.oid && r.grantor === b.oid && r.admin_option && !r.inherit_option && !r.set_option), "exact three M admin-only automatic edges");
  await save("provisioning.json", { principalRows, memberships, migrationCommitted, source: "P full hash and loader-verified bodies", singleExplicitMigrationTransaction: true, journalRecipe: journalSql, authRecipe: "auth.users(id uuid PRIMARY KEY)", database: "dream_test_B45" });
  stage = "fixed allowlist native binding collection"; category = "bindings";
  await migration.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await migration.query("SET LOCAL search_path=pg_catalog");
  const role = async (name: string) => { const r = (await migration.query("SELECT oid::text AS \"nativeOid\",rolname AS name FROM pg_catalog.pg_roles WHERE rolname=$1", [name])).rows; verify(r.length === 1, "one fixed role " + name); return r[0]; };
  const externalFacts: CatalogManagementBindingsV3["externalFacts"] = [];
  const add = (cls: string, id: string, identity: unknown, subId = 0) => externalFacts.push({ endpoint: { class: cls, nativeOid: id, subId }, identity } as CatalogManagementBindingsV3["externalFacts"][number]);
  const typeRows = (await migration.query("SELECT t.oid::text,n.nspname AS schema,t.typname AS name FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='pg_catalog' AND t.typname=ANY($1::text[])", [typeNames])).rows;
  for (const r of typeRows) add("pg_type", r.oid, { kind: "type", schema: r.schema, name: r.name });
  const functionRows = (await migration.query("SELECT p.oid::text,n.nspname AS schema,p.proname AS name,(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',an.nspname,'name',at.typname) ORDER BY a.ord),'[]'::jsonb) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(id,ord) JOIN pg_catalog.pg_type at ON at.oid=a.id JOIN pg_catalog.pg_namespace an ON an.oid=at.typnamespace) AS args FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND p.proname=ANY($1::text[])", [functionNames])).rows;
  for (const r of functionRows) add("pg_proc", r.oid, { kind: "function", schema: r.schema, name: r.name, argumentTypes: r.args });
  const operatorRows = (await migration.query("SELECT o.oid::text,o.oprname AS name,l.typname AS left_name,r.typname AS right_name FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid=o.oprnamespace LEFT JOIN pg_catalog.pg_type l ON l.oid=o.oprleft LEFT JOIN pg_catalog.pg_type r ON r.oid=o.oprright WHERE n.nspname='pg_catalog' AND o.oprname=ANY($1::text[]) AND (o.oprleft=0 OR (l.typnamespace=n.oid AND l.typname=ANY($2::text[]))) AND (o.oprright=0 OR (r.typnamespace=n.oid AND r.typname=ANY($2::text[])))", [operatorNames, typeNames])).rows;
  for (const r of operatorRows) add("pg_operator", r.oid, { kind: "operator", schema: "pg_catalog", name: r.name, leftType: r.left_name ? { schema: "pg_catalog", name: r.left_name } : null, rightType: r.right_name ? { schema: "pg_catalog", name: r.right_name } : null });
  for (const r of (await migration.query("SELECT oid::text,nspname FROM pg_catalog.pg_namespace WHERE nspname IN ('pg_catalog','auth')")).rows) add("pg_namespace", r.oid, { kind: "schema", name: r.nspname });
  for (const r of (await migration.query("SELECT oid::text,lanname FROM pg_catalog.pg_language WHERE lanname IN ('sql','plpgsql','internal','c')")).rows) add("pg_language", r.oid, { kind: "language", name: r.lanname });
  for (const r of (await migration.query("SELECT c.oid::text,c.collname FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='pg_catalog' AND c.collname IN ('default','C','POSIX')")).rows) add("pg_collation", r.oid, { kind: "collation", schema: "pg_catalog", name: r.collname });
  for (const r of (await migration.query("SELECT o.oid::text,o.opcname FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace JOIN pg_catalog.pg_am a ON a.oid=o.opcmethod WHERE n.nspname='pg_catalog' AND a.amname='btree' AND o.opcname IN ('text_ops','uuid_ops','int8_ops','int4_ops','oid_ops','timestamptz_ops')")).rows) add("pg_opclass", r.oid, { kind: "opclass", schema: "pg_catalog", name: r.opcname });
  const auth = (await migration.query("SELECT c.oid::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users' AND c.relkind='r'")).rows; verify(auth.length === 1, "one auth.users");
  const authIdentity = { schema: "auth", name: "users" } as const;
  add("pg_class", auth[0].oid, { kind: "relation", ...authIdentity });
  const authColumn = (await migration.query("SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=$1::oid AND attnum=1 AND attname='id' AND atttypid='pg_catalog.uuid'::regtype AND NOT attisdropped", [auth[0].oid])).rows; verify(authColumn.length === 1, "fixed auth.users.id UUID column");
  add("pg_class", auth[0].oid, { kind: "column", relation: authIdentity, ordinal: 1, name: "id" }, 1);
  const authIndex = (await migration.query("SELECT i.indexrelid::text,c.relname FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=$1::oid AND c.relname='users_pkey' AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indkey::text='1'", [auth[0].oid])).rows; verify(authIndex.length === 1, "fixed auth.users primary index");
  add("pg_class", authIndex[0].indexrelid, { kind: "index", relation: authIdentity, name: "users_pkey" });
  // B45 exact Auth PK fact: the unchanged B44 discovery query, bound below
  // to the already approved relation/index, never learned from failed endpoints.
  const authPrimaryRows = (await migration.query("SELECT r.oid::text AS relation_oid,r.relowner::text AS relation_owner,r.relkind,r.relispartition,a.attnum,a.attname,a.atttypid::text AS type_oid,a.attnotnull,a.attisdropped,a.atttypmod,a.attndims,k.oid::text AS constraint_oid,k.conname,k.contype,k.conkey,k.conindid::text AS constraint_index,i.oid::text AS index_oid,i.relname AS index_name,i.relowner::text AS index_owner,x.indrelid::text AS index_parent,x.indkey::text AS index_key,x.indisprimary,x.indisunique,x.indisvalid,x.indisready,x.indislive FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=1 JOIN pg_catalog.pg_index x ON x.indrelid=r.oid AND x.indisprimary JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_constraint k ON k.conindid=x.indexrelid AND k.conrelid=r.oid WHERE n.nspname=$1 AND r.relname=$2", ["auth", "users"])).rows;
  verify(authPrimaryRows.length === 1, "one actual Auth PK constraint");
  const authPrimary = authPrimaryRows[0], uuidFact = typeRows.find(t => t.schema === "pg_catalog" && t.name === "uuid");
  verify(authPrimary.relation_oid === auth[0].oid && authPrimary.index_oid === authIndex[0].indexrelid && authPrimary.constraint_index === authIndex[0].indexrelid && authPrimary.index_parent === auth[0].oid, "Auth PK binds existing relation/index facts");
  verify(authPrimary.relation_owner === m.oid && authPrimary.index_owner === m.oid && authPrimary.relkind === "r" && !authPrimary.relispartition, "B44 prerequisite original relation/index owners M");
  verify(uuidFact && authPrimary.type_oid === uuidFact.oid && authPrimary.attnum === 1 && authPrimary.attname === "id" && authPrimary.attnotnull && !authPrimary.attisdropped && authPrimary.atttypmod === -1 && authPrimary.attndims === 0, "actual Auth id UUID column");
  verify(authPrimary.contype === "p" && JSON.stringify(authPrimary.conkey) === "[1]" && authPrimary.index_key === "1" && authPrimary.indisprimary && authPrimary.indisunique && authPrimary.indisvalid && authPrimary.indisready && authPrimary.indislive && authPrimary.index_name === authIndex[0].relname, "actual PK kind/key/index properties");
  add("pg_constraint", authPrimary.constraint_oid, { kind: "constraint", objectKind: "relation", object: authIdentity, name: authPrimary.conname });
  await save("exact-auth-primary-fact.json", { authPrimary, uuidFact, oldBindingFactCount: externalFacts.length - 1, newBindingFactCount: externalFacts.length, recipe: "B44 exact M-owned Auth UUID primary constraint", notAnExpectedCatalog: true });
  // End B45 exact Auth PK fact.
  const bindings: CatalogManagementBindingsV3 = { roleProfile: "none", migrationOwner: await role("b45_migration"), bootstrap: await role("b45_bootstrap"), api: await role("dream_api"), worker: await role("dream_worker"), issuer: await role("dream_upload_reserver"), apiLogin: null, workerLogin: null, externalFacts };
  await save("management-bindings.json", { bindings, recipe: { typeNames, functionNames, operatorNames }, note: "Native facts bound to fixed recipe; not expected catalog/Golden/provenance" });
  stage = "frozen actual catalog reader"; category = "context";
  const portAdapter = { async query(text: string, values: readonly unknown[]) {
    category = Object.entries(postgresCatalogQueriesV3).find(([, sql]) => sql === text)?.[0] ?? "context";
    projectionCalls++;
    try {
      const result = await migration.query(text, [...values]); lastRows = result.rows;
      facts.push({ category, rows: result.rows.length, jsonBytes: Buffer.byteLength(JSON.stringify(result.rows)), querySha: sha(text) });
      await save(`projection-${category}.json`, result.rows); await save("projection-trace.json", facts);
      return result;
    } catch (error) { firstNativeError = nativeError(error); throw error; }
  } };
  const observation = await readPostgresCatalogV3(portAdapter, bindings);
  await save("unvalidated-observation.json", observation);
  const counts = Object.fromEntries(Object.entries(observation.catalog).map(([name, rows]) => [name, rows.length]));
  verify(observation.counts.namedTriggers === 38 && projectionCalls === 15, "complete reader dispatch and named38 diagnostic");
  await save("final.json", { counts, triggerCounts: observation.counts, observationSha256: observation.observationSha256, descriptorVersion: observation.descriptorVersion, unvalidatedOnly: true, approval: false, expectedCatalog: false, projectionCalls, backendPids, migrationCommitted });
  await migration.query("ROLLBACK");
  completed = true; console.log("B45 all15 actual catalog SELECTs returned an unvalidated observation");
} catch (error) {
  const failure = { stage, category, projectionCalls, migrationCommitted, nativeError: firstNativeError ?? nativeError(error), decoderError: nativeError(error), lastReturnedRows: Array.isArray(lastRows) ? lastRows.length : null, noExpectationRelaxation: true };
  await save("first-failure.json", failure);
  // Safe evidence is native catalog metadata only, under ignored owned scratch.
  if (lastRows !== undefined) await save("last-returned-catalog-batch.json", lastRows);
  console.error(JSON.stringify(failure)); process.exitCode = 1;
} finally {
  if (ownedObserver) {
    await save("activity-before-cleanup.json", (await ownedObserver.query("SELECT pid,usename,application_name,state,backend_type FROM pg_catalog.pg_stat_activity WHERE datname='dream_test_B45' ORDER BY pid").catch(() => ({ rows: [] }))).rows);
  }
  for (const c of clients) { await c.query("ROLLBACK").catch(() => undefined); await close(c).catch(() => undefined); }
  let pidAbsent = false, listenerAbsent = false, processAbsent = false;
  try {
    if (startAttempted) await stopOwnedCluster();
    try { await access(join(cluster, "postmaster.pid")); } catch { pidAbsent = true; }
    if (port) { await run(powershell, ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output 'Owned port listener absent'`], "stopped-listener.log"); listenerAbsent = true; }
    if (pid) { await run(powershell, ["-NoProfile", "-Command", `if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 1 }; Write-Output 'Owned postmaster process absent'`], "stopped-process.log"); processAbsent = true; }
  } catch (error) { await save("cleanup-failure.json", nativeError(error)); process.exitCode = 1; }
  await save("cleanup-safe.json", { pid, port, backendPids, postmasterPidAbsent: pidAbsent, listenerAbsent, processAbsent, completed, projectionCalls, migrationCommitted });
  if (!completed || !pidAbsent || !listenerAbsent || !processAbsent) process.exitCode = 1;
  console.log(`B45 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent && processAbsent}`);
}
async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
