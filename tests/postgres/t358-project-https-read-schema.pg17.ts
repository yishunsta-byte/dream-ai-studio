import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { access, appendFile, mkdtemp, open, readdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { inspectMigrationTarget } from "../../lib/db/postgres/migration-target";
import { postgresMigrationApprovalHashV2, runPostgresMigrationsV2 } from "../../lib/db/postgres/migration-runner-v2";
import { stageOrder } from "../../lib/domain/stages";
import { parseMenuConfig } from "../../lib/menus/parse";
import { snapshotForMenu } from "../../lib/menus/snapshot";


const release = "https://github.com/PostgREST/postgrest/releases/download/v16.6/postgrest-v16.6-windows-x86-64.zip";
const expectedSha = "77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea";
const host = "127.0.0.1";
const bootstrap = "t358_bootstrap";
const database = "dream_test_t358";
const issuer = "https://t358.test.invalid/auth/v1";
const secret = () => randomBytes(24).toString("hex");
const [a, b, blocked, first, second, another, archived, excluded] = Array.from({ length: 8 }, () => randomUUID());
const [bootstrapPassword, gatewayPassword, directPassword, jwtSecret] = [secret(), secret(), secret(), secret()];
const samePath = (left: string, right: string) => left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
const exec = promisify(execFile);
assert(process.platform === "win32" && process.arch === "x64" && process.argv.length === 2);
const systemRoot = process.env.SystemRoot;
assert(systemRoot);
const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP)$/i.test(key))), NODE_ENV: "test" };
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const ps = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const tar = join(systemRoot, "System32", "tar.exe");
const run = (path: string, args: string[], extra: Readonly<Record<string, string>> = {}) =>
  exec(path, args, { env: { ...env, ...extra }, windowsHide: true, timeout: 90_000 });
assert(samePath(await realpath(bin), bin));
for (const tool of ["postgres.exe", "initdb.exe", "pg_ctl.exe"]) {
  const path = join(bin, tool);
  assert(samePath(await realpath(path), path));
  await run(ps, ["-NoProfile", "-NonInteractive", "-Command",
    "$s=Get-AuthenticodeSignature -LiteralPath $env:T358_TOOL; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { exit 1 }"],
  { T358_TOOL: path });
  assert.match((await run(path, ["--version"])).stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

async function allocatePort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, host, resolve); });
  const address = socket.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function refuseConnection(port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(2000, () => socket.destroy(new Error("Loopback cleanup timed out")));
    socket.once("connect", () => { socket.destroy(); reject(new Error("Owned listener still open")); });
    socket.once("error", (error: NodeJS.ErrnoException) => error.code === "ECONNREFUSED" ? resolve() : reject(error));
  });
}

function token(sub: string, override: object = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub, role: "authenticated", aud: "authenticated", iss: issuer, exp: Math.floor(Date.now() / 1000) + 180,
    ...override,
  })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
}

const install = await readFile(new URL("../../lib/db/postgres/project-https-read/0001_install.sql", import.meta.url), "utf8");
const remove = await readFile(new URL("../../lib/db/postgres/project-https-read/0001_remove.sql", import.meta.url), "utf8");
const relationFilter = "n.nspname = 'dream' AND c.relname IN ('projects','stage_states','jobs')";
let before: Awaited<ReturnType<typeof baseState>>;
let afterWrites: Awaited<ReturnType<typeof baseRows>>;

async function asInstaller<T>(admin: Client, operation: () => Promise<T>) {
  await admin.query("SET ROLE t358_owner");
  try { return await operation(); }
  finally { await admin.query("ROLLBACK; RESET ROLE"); }
}

async function baseRows(admin: Client) {
  const queries = [
    "SELECT * FROM dream.projects ORDER BY id", "SELECT * FROM dream.jobs ORDER BY id",
    "SELECT * FROM dream.stage_states ORDER BY project_id,stage",
  ];
  const rows = [];
  for (const query of queries) rows.push((await admin.query(query)).rows);
  return rows;
}

async function baseState(admin: Client) {
  return {
    history: (await admin.query("SELECT * FROM dream_migrations.history ORDER BY ordinal")).rows,
    tableAcl: (await admin.query(`SELECT c.relname,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE ${relationFilter} ORDER BY 1`)).rows,
    columnAcl: (await admin.query(`SELECT c.relname,a.attname,grants.*
      FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
      CROSS JOIN LATERAL aclexplode(a.attacl) AS grants
      WHERE ${relationFilter} AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3,4,5`)).rows,
    policies: (await admin.query("SELECT * FROM pg_policies WHERE schemaname='dream' ORDER BY tablename,policyname")).rows,
    triggers: (await admin.query(`SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
      WHERE ${relationFilter} ORDER BY 1,2`)).rows,
  };
}

async function seed(admin: Client) {
  await admin.query(`CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
    CREATE ROLE anon NOLOGIN NOBYPASSRLS;
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${gatewayPassword}';
    CREATE ROLE t358_direct LOGIN NOINHERIT PASSWORD '${directPassword}';
    CREATE ROLE t358_owner NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
      SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,t358_owner;
    GRANT USAGE ON SCHEMA auth TO authenticated,t358_owner;
    GRANT CREATE ON DATABASE ${database} TO t358_owner;
    GRANT authenticated,anon TO authenticator WITH INHERIT FALSE, SET TRUE;`);
  const target = { profile: "synthetic" as const,
    connectionString: `postgresql://${bootstrap}:${bootstrapPassword}@${host}:${port}/${database}` };
  const { targetHash } = inspectMigrationTarget(target);
  await runPostgresMigrationsV2({
    version: 3, mode: "apply", target, expectedTargetHash: targetHash,
    expectedApprovalHash: postgresMigrationApprovalHashV2(3, targetHash, "apply"),
  });
  await admin.query(`GRANT dream_api,dream_worker TO t358_direct WITH INHERIT FALSE, SET TRUE;
    GRANT USAGE ON SCHEMA dream TO t358_owner;
    ALTER TABLE dream.projects OWNER TO t358_owner;
    ALTER TABLE dream.stage_states OWNER TO t358_owner;
    ALTER TABLE dream.jobs OWNER TO t358_owner`);
  await admin.query("INSERT INTO auth.users VALUES ($1),($2),($3)", [a, b, blocked]);
  const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
  assert(parsed.ok);
  const { config } = parsed;
  const menu = config.menus[0];
  const snapshot = JSON.stringify(snapshotForMenu(config, menu));
  for (const [index, [owner, id]] of [[a, first], [b, second], [b, another], [a, archived], [blocked, excluded]].entries()) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
      title,goal,target,aspect,length_sec,created_at,updated_at,archived_at)
      VALUES($1,$2,$3,$4,$5,'{"draft":true}',$6,'goal','target','9:16',5,$7::timestamptz,$7::timestamptz,
        CASE WHEN $8 THEN $7::timestamptz END)`,
    [owner, id, menu.id, config.templateVersion, snapshot, `Fixture ${index}`, `2026-01-0${index + 1}T08:09:10.123Z`, id === archived]);
    for (const [offset, stage] of stageOrder.entries()) await admin.query(
      "INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)",
      [owner, id, stage, offset === 0 ? "approved" : "locked"]);
  }
  await admin.query(`INSERT INTO dream.jobs(owner_id,id,kind,input_snapshot_json,status,project_id,ref_type,ref_id,provider,idempotency_key,created_at,updated_at)
    VALUES($1,$2,'render','{}','running',$3,'project',$3,'local','t358-fixture',now(),now())`, [b, randomUUID(), second]);
}

async function checkInstallation(admin: Client) {
  before = await baseState(admin);
  assert.equal(before.history.length, 3);
  const dataBefore = await baseRows(admin);
  const absent = async () => {
    assert.equal((await admin.query("SELECT to_regnamespace('project_read') AS api")).rows[0].api, null);
    assert.equal((await admin.query("SELECT to_regnamespace('project_read_private') AS internal")).rows[0].internal, null);
    assert.deepEqual(await baseState(admin), before);
    assert.deepEqual(await baseRows(admin), dataBefore);
  };
  const apply = () => asInstaller(admin, () => admin.query(install));
  await admin.query("CREATE SCHEMA project_read_private; CREATE TABLE project_read_private.unrelated(id int)");
  await assert.rejects(apply, /namespace already exists/);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM project_read_private.unrelated")).rows[0].n, 0);
  await admin.query("DROP TABLE project_read_private.unrelated; DROP SCHEMA project_read_private");
  await absent();
  await admin.query("CREATE POLICY project_https_read_v1 ON dream.jobs FOR SELECT TO dream_api USING (false)");
  await assert.rejects(apply, /policies on jobs/);
  await admin.query("DROP POLICY project_https_read_v1 ON dream.jobs");
  await admin.query("CREATE POLICY existing_public_read ON dream.projects FOR SELECT TO PUBLIC USING (true)");
  await assert.rejects(apply, /policies on projects/);
  await admin.query("DROP POLICY existing_public_read ON dream.projects");
  await absent();
  await admin.query("ALTER TABLE dream.projects NO FORCE ROW LEVEL SECURITY");
  await assert.rejects(apply, /table owner, RLS or policies/);
  await admin.query("ALTER TABLE dream.projects FORCE ROW LEVEL SECURITY");
  await admin.query("ALTER TABLE dream.projects ALTER COLUMN title TYPE varchar");
  await assert.rejects(apply, /incompatible columns on projects/);
  await admin.query("ALTER TABLE dream.projects ALTER COLUMN title TYPE text");
  await absent();
  await admin.query("ALTER ROLE authenticated LOGIN");
  await assert.rejects(apply, /unsafe browser role membership/);
  await admin.query("ALTER ROLE authenticated NOLOGIN");
  await asInstaller(admin, () => admin.query("GRANT SELECT (title) ON dream.projects TO authenticated"));
  await assert.rejects(apply, /existing browser grants/);
  assert.equal((await admin.query("SELECT has_column_privilege('authenticated','dream.projects','title','SELECT') AS allowed")).rows[0].allowed, true);
  await asInstaller(admin, () => admin.query("REVOKE SELECT (title) ON dream.projects FROM authenticated"));
  await asInstaller(admin, () => admin.query("ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon"));
  await assert.rejects(apply, /unexpected effective or default grants/);
  await asInstaller(admin, () => admin.query("ALTER DEFAULT PRIVILEGES REVOKE SELECT ON TABLES FROM anon"));
  await absent();

  await apply();
  await assert.rejects(apply, /namespace already exists/);
  assert.deepEqual(await baseRows(admin), dataBefore);
  assert.deepEqual((await baseState(admin)).history, before.history);
  const grants = await admin.query(`SELECT c.relname,array_agg(a.attname::text ORDER BY a.attname::text) AS columns
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE ${relationFilter} AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege('authenticated',c.oid,a.attnum,'SELECT') GROUP BY c.relname ORDER BY c.relname`);
  assert.deepEqual(grants.rows.map(({ relname, columns }) => [relname, columns]), [
    ["jobs", ["project_id", "status"]],
    ["projects", "approved_plan_id archived_at aspect content_revision created_at current_timeline_rev_id goal id inputs_json length_sec menu_id target template_snapshot_json template_version title updated_at".split(" ")],
    ["stage_states", "approved_at approved_plan_id approved_revision note project_id stage status".split(" ")],
  ]);
  const verified = await admin.query(`SELECT
    has_schema_privilege('authenticated','project_read','USAGE') AS profile,
    has_schema_privilege('authenticated','project_read_private','USAGE') AS approval,
    has_schema_privilege('authenticated','dream','USAGE') AS dream,
    has_table_privilege('authenticated','project_read.project_list','INSERT,UPDATE,DELETE') AS view_write,
    has_table_privilege('authenticated','dream.projects','SELECT,INSERT,UPDATE,DELETE') AS table_grant`);
  assert.deepEqual(verified.rows, [{ profile: true, approval: false, dream: false, view_write: false, table_grant: false }]);
  const gateway = new Client({ host, port, database, user: "authenticator", password: gatewayPassword,
    ssl: false, connectionTimeoutMillis: 4000, statement_timeout: 5000 });
  await gateway.connect();
  try {
    await gateway.query("SET ROLE authenticated");
    for (const query of [
      "SELECT * FROM dream.projects", "SELECT * FROM project_read_private.approved_users",
      "SELECT * FROM project_read_private.project_data", "SET ROLE dream_api", "SET ROLE dream_worker",
    ]) await assert.rejects(gateway.query(query), { code: "42501" });
    for (const query of [
      "INSERT INTO project_read.project_list (title) VALUES ('disallowed')",
      "UPDATE project_read.project_list SET title='disallowed'", "DELETE FROM project_read.project_list",
    ]) await assert.rejects(gateway.query(query), { code: "55000" });
  } finally { await gateway.end(); }
  await asInstaller(admin, () => admin.query("INSERT INTO project_read_private.approved_users VALUES ($1),($2)", [a, b]));
  console.log("T358 preconditions, partial objects, atomic failure, columns, schema ACL and explicit approval passed");
}

async function existingWrites(direct: Pool, title: string, jobStatus: string) {
  const client = await direct.connect();
  try {
    await client.query("BEGIN; SET LOCAL ROLE dream_api");
    await client.query("SELECT set_config('dream.actor_id',$1,true)", [a]);
    assert.equal((await client.query("UPDATE dream.projects SET title=$1 WHERE id=$2", [title, first])).rowCount, 1);
    assert.equal((await client.query("UPDATE dream.projects SET title=$1 WHERE id=$2", [title, second])).rowCount, 0);
    assert.equal((await client.query("UPDATE dream.stage_states SET note=$1 WHERE project_id=$2 AND stage='intake'", [title, first])).rowCount, 1);
    await client.query("SET LOCAL ROLE dream_worker");
    assert.equal((await client.query("UPDATE dream.jobs SET status=$1 WHERE project_id=$2", [jobStatus, second])).rowCount, 1);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function verifyHttp(origin: string, direct: Pool, admin: Client) {
  const request = (path: string, jwt?: string, profile = "project_read", method = "GET", headers: HeadersInit = {}, body?: string) => {
    const signed = new Headers(headers);
    signed.set(method === "GET" ? "accept-profile" : "content-profile", profile);
    if (jwt) signed.set("authorization", `Bearer ${jwt}`);
    return fetch(origin + path, { method, headers: signed, body, redirect: "error", signal: AbortSignal.timeout(5000) });
  };
  const getJson = async (path: string, jwt: string, headers?: HeadersInit, status = 200) => {
    const response = await request(path, jwt, "project_read", "GET", headers);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-profile"), "project_read");
    return { response, rows: await response.json() };
  };
  const ids = (rows: { id: string }[]) => rows.map(row => row.id);
  const alice = token(a);
  await existingWrites(direct, "T358 existing writer after install", "succeeded");
  const list = await getJson("/project_list", alice);
  assert.deepEqual(ids(list.rows), [first]);
  assert.deepEqual(Object.keys(list.rows[0]).sort(), ["aspect","id","jobs","lengthSec","menuId","menuLabel","states","title","updatedAt"]);
  assert.equal(list.rows[0].title, "T358 existing writer after install");
  assert.ok(list.rows[0].states.some((state: { note: string | null }) => state.note === list.rows[0].title));
  assert.equal(list.rows[0].updatedAt, "2026-01-01T08:09:10.123Z");
  const detail = (await getJson(`/project_detail?id=eq.${first}`, alice)).rows[0];
  assert.deepEqual(detail.inputs, { draft: true });
  assert.equal(detail.snapshot.menu.label, list.rows[0].menuLabel);
  assert.equal(detail.project.title, list.rows[0].title);
  assert.equal(Object.hasOwn(detail.project, "ownerId"), false);
  assert.deepEqual(detail.states, list.rows[0].states);
  const page = await getJson("/project_list?order=updatedAt.desc,id.asc", token(b), { range: "0-0", "range-unit": "items", prefer: "count=exact" }, 206);
  assert.deepEqual(ids(page.rows), [another]);
  assert.equal(page.response.headers.get("content-range"), "0-0/2");
  const bob = await getJson("/project_list?order=updatedAt.desc,id.asc", token(b));
  assert.deepEqual(ids(bob.rows), [another, second]);
  assert.deepEqual(bob.rows[1].jobs, ["succeeded"]);
  for (const hidden of [second, archived, excluded, randomUUID()]) {
    const result = await getJson(`/project_detail?id=eq.${hidden}`, alice, { prefer: "count=exact" });
    assert.deepEqual(result.rows, []);
    assert.equal(result.response.headers.get("content-range"), "*/0");
  }
  assert.deepEqual((await getJson("/project_list", token(blocked))).rows, []);
  assert.deepEqual((await getJson(`/project_detail?id=eq.${excluded}`, token(blocked))).rows, []);
  for (const profile of ["dream", "auth", "project_read_private"]) {
    const response = await request("/project_list", alice, profile);
    assert.equal(response.status, 406);
    assert.equal((await response.json()).code, "PGRST106");
  }
  const anonymous = await request("/project_list");
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, "42501");
  assert.equal((await request("/project_list", alice + "x")).status, 401);
  const dataBeforeDeniedWrites = await baseRows(admin);
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await request(`/project_list?id=eq.${first}`, alice, "project_read", method,
      { "content-type": "application/json" }, method === "DELETE" ? undefined : '{"title":"disallowed"}');
    assert.ok(response.status >= 400);
    await response.body?.cancel();
  }
  assert.deepEqual(await baseRows(admin), dataBeforeDeniedWrites);
  await asInstaller(admin, () => admin.query("DELETE FROM project_read_private.approved_users WHERE id=$1", [a]));
  assert.deepEqual((await getJson("/project_list", alice)).rows, []);
  assert.deepEqual((await getJson(`/project_detail?id=eq.${first}`, alice)).rows, []);
  assert.deepEqual(ids((await getJson("/project_list?order=updatedAt.desc,id.asc", token(b))).rows), [another, second]);
  await asInstaller(admin, () => admin.query("INSERT INTO project_read_private.approved_users VALUES ($1)", [a]));
  assert.deepEqual(ids((await getJson("/project_list", alice)).rows), [first]);
  afterWrites = await baseRows(admin);
  console.log("T358 native PostgREST profiles, signed owner reads, raw DTO, paging, forbidden DML and live approval revocation passed");
}

async function checkRemoval(admin: Client, direct: Pool) {
  const withdraw = () => asInstaller(admin, () => admin.query(remove));
  await asInstaller(admin, () => admin.query("COMMENT ON VIEW project_read.project_detail IS NULL"));
  await assert.rejects(withdraw, /candidate objects or policies are incomplete/);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM project_read_private.approved_users")).rows[0].n, 2);
  await asInstaller(admin, () => admin.query("COMMENT ON VIEW project_read.project_detail IS 'Dream project HTTPS read candidate v1 relation'"));
  await asInstaller(admin, () => admin.query("CREATE TABLE project_read.operator_owned (id int)"));
  await assert.rejects(withdraw, { code: "2BP01" });
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM project_read_private.approved_users")).rows[0].n, 2);
  assert.equal((await admin.query("SELECT to_regclass('project_read.project_detail') IS NOT NULL AS intact")).rows[0].intact, true);
  await asInstaller(admin, () => admin.query("DROP TABLE project_read.operator_owned"));
  await withdraw();
  await assert.rejects(withdraw, /version markers missing/);
  assert.deepEqual(await baseRows(admin), afterWrites);
  assert.deepEqual(await baseState(admin), before);
  assert.deepEqual((await admin.query("SELECT to_regnamespace('project_read') AS api,to_regnamespace('project_read_private') AS internal")).rows,
    [{ api: null, internal: null }]);
  await existingWrites(direct, "T358 existing writer after removal", "running");
  assert.equal((await admin.query("SELECT title FROM dream.projects WHERE id=$1", [first])).rows[0].title, "T358 existing writer after removal");
  assert.deepEqual(await baseState(admin), before);
  await asInstaller(admin, () => admin.query(install));
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM project_read_private.approved_users")).rows[0].n, 0);
  await withdraw();
  assert.deepEqual(await baseState(admin), before);
  console.log("T358 atomic RESTRICT removal, clean reinstall, unchanged base history/policies/ACL/rows and existing writes passed");
}

const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t358-"));
const data = join(root, "cluster");
const pidfile = join(data, "postmaster.pid");
const passwordFile = join(root, "bootstrap-password");
const port = await allocatePort();
let apiPort: number | undefined;
let postgrest: ChildProcess | undefined;
let postgrestExit: Promise<void> | undefined;
let control: Client | undefined;
let direct: Pool | undefined;

async function verifyOwnedPg() {
  const lines = (await readFile(pidfile, "utf8")).split(/\r?\n/);
  assert(/^[1-9][0-9]+$/.test(lines[0]) && samePath(lines[1], data) && Number(lines[3]) === port);
  await run(ps, ["-NoProfile", "-NonInteractive", "-Command", `
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T358_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T358_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T358_EXE -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T358_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T358_PID -or $s[0].LocalAddress -ne '127.0.0.1') { exit 1 }`],
  { T358_PID: lines[0], T358_PORT: String(port), T358_EXE: join(bin, "postgres.exe"), T358_DATA: data });
}

try {
  const archive = join(root, "postgrest.zip");
  const response = await fetch(release, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedSha);
  await writeFile(archive, bytes, { flag: "wx" });
  const entries = (await run(tar, ["-tf", archive])).stdout.trim().split(/\r?\n/);
  assert(entries.every(entry => /^[a-z0-9_./-]+$/i.test(entry) && !entry.startsWith("/") && !entry.split("/").includes("..")));
  await run(tar, ["-xf", archive, "-C", root]);
  const executable = await realpath(join(root, "postgrest.exe"));
  assert(samePath(dirname(executable), root) && (await readdir(root)).includes("postgrest.exe"));
  const childPath = `${root};${bin};${join(systemRoot, "System32")}`;
  assert.match((await run(executable, ["--version"], { Path: childPath })).stdout.trim(), /PostgREST 16\.6/);
  await writeFile(passwordFile, bootstrapPassword, { flag: "wx" });
  try { await run(join(bin, "initdb.exe"), ["-D", data, "-U", bootstrap, `--pwfile=${passwordFile}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]); }
  finally { await unlink(passwordFile); }
  await appendFile(join(data, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${port}\n`);
  await writeFile(join(data, "pg_hba.conf"), "host all all 127.0.0.1/32 scram-sha-256\n");
  const log = await open(join(root, "launcher.log"), "a");
  try {
    const child = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-w", "-t", "30", "start"],
      { env, windowsHide: true, timeout: 40000, stdio: ["ignore", log.fd, log.fd] });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Owned PG17 startup failed")));
    });
  } finally { await log.close(); }
  await verifyOwnedPg();
  const clientConfig = { host, port, database, ssl: false as const, connectionTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: "t358-owned", options: "-c search_path=pg_catalog" };
  const maintenance = new Client({ ...clientConfig, database: "postgres", user: bootstrap, password: bootstrapPassword });
  try {
    await maintenance.connect();
    await maintenance.query(`CREATE DATABASE ${database}`);
  } finally { await maintenance.end(); }
  control = new Client({ ...clientConfig, user: bootstrap, password: bootstrapPassword });
  await control.connect();
  await seed(control);
  await checkInstallation(control);
  direct = new Pool({ ...clientConfig, max: 1, user: "t358_direct", password: directPassword });

  apiPort = await allocatePort();
  const origin = `http://${host}:${apiPort}`;
  const child = spawn(executable, [], { windowsHide: true, cwd: root, stdio: ["ignore", "ignore", "pipe"], env: {
    ...env, Path: childPath, PGRST_DB_URI: `postgresql://authenticator:${gatewayPassword}@${host}:${port}/${database}?sslmode=disable`,
    PGRST_SERVER_HOST: host, PGRST_SERVER_PORT: String(apiPort), PGRST_DB_POOL: "1", PGRST_DB_CONFIG: "false",
    PGRST_DB_CHANNEL_ENABLED: "false", PGRST_DB_SCHEMAS: "project_read", PGRST_DB_EXTRA_SEARCH_PATH: "", PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: jwtSecret, PGRST_JWT_AUD: "authenticated",
  } });
  postgrest = child;
  let diagnostics = "";
  child.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
  postgrestExit = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    const result = await fetch(origin + "/project_list", { headers: { authorization: "Bearer " + token(a) }, signal: AbortSignal.timeout(500) }).catch(() => undefined);
    if (result?.ok) { await result.arrayBuffer(); ready = true; break; }
    await result?.body?.cancel();
    await delay(100);
  }
  assert(ready, diagnostics.replaceAll(gatewayPassword, "[removed]").replaceAll(jwtSecret, "[removed]"));
  await run(ps, ["-NoProfile", "-NonInteractive", "-Command", `
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T358_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T358_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T358_EXE -or $s.Count -ne 1 -or
        $s[0].OwningProcess -ne [int]$env:T358_PID -or $s[0].LocalAddress -ne '127.0.0.1') { exit 1 }`],
  { T358_PID: String(child.pid), T358_PORT: String(apiPort), T358_EXE: executable });
  await verifyHttp(origin, direct, control);
  await checkRemoval(control, direct);
  if (process.env.T362_VERIFY_CATALOG === "1") {
    const catalogClient = control;
    await asInstaller(catalogClient, () => catalogClient.query(install));
    const { verifyCatalogChecks } = await import("./t362-catalog-checks.pg17");
    await verifyCatalogChecks(catalogClient);
  }
} finally {
  try {
    if (postgrest) {
      if (postgrest.pid && postgrest.exitCode === null) postgrest.kill();
      await postgrestExit;
      if (apiPort) await refuseConnection(apiPort);
    }
  } finally {
    try { await Promise.all([direct?.end(), control?.end()]); }
    finally {
      const pgStarted = await access(pidfile).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (pgStarted) {
        await verifyOwnedPg();
        await run(join(bin, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
        await assert.rejects(access(pidfile), { code: "ENOENT" });
        await refuseConnection(port);
      }
      const verifiedRoot = await realpath(root);
      assert(samePath(dirname(verifiedRoot), temp) && basename(verifiedRoot).startsWith("dream-t358-"));
      await rm(verifiedRoot, { recursive: true, maxRetries: 4, retryDelay: 100 });
      await assert.rejects(access(verifiedRoot), { code: "ENOENT" });
      console.log("T358 owned listeners, processes, verified portable binary and scratch cluster removed");
    }
  }
}
