import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { access, appendFile, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, Pool, type QueryResultRow } from "pg";
import { loadPostgresMigrationsV2 } from "../../lib/db/postgres/migration-manifest-v2";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import { projectDisplayState, stageOrder, type StageState } from "../../lib/domain/stages";
import { parseMenuConfig } from "../../lib/menus/parse";
import { snapshotForMenu } from "../../lib/menus/snapshot";
import { postgresProjectReads } from "../../lib/services/postgres/project-reads";

const exec = promisify(execFile);
const host = "127.0.0.1";
const bootstrap = "t349_bootstrap";
const database = `t349_${randomBytes(12).toString("hex")}`;
const issuer = "https://t349.test.invalid/auth/v1";
const origin = "https://t349.test.invalid";
const jwtKey = randomBytes(32);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [a, b, blocked] = Array.from({ length: 3 }, () => randomUUID());
const [one, two, extra, archived, hidden] = Array.from({ length: 5 }, () => randomUUID());
const allowed = new Set<string>([a, b]);
type Claims = { sub: string; role: "authenticated"; aud: string; iss: string; exp: number };
type State = StageState & Record<string, unknown>;
type ListRow = { id: string; jobs: string[]; states: State[]; [key: string]: unknown };
type Detail = { id: string; project: Record<string, unknown>; snapshot: unknown; inputs: unknown; states: State[] };

function sign(payload: object) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.${createHmac("sha256", jwtKey).update(`${header}.${body}`).digest("base64url")}`;
}

function decode(header: string | null): Claims | undefined {
  if (!header?.startsWith("Bearer ")) return;
  const parts = header.slice(7).split(".");
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return;
  const [head, body, signature] = parts;
  try {
    const expected = createHmac("sha256", jwtKey).update(`${head}.${body}`).digest();
    const received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return;
    const metadata = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (metadata.alg === "HS256" && claims.role === "authenticated" && claims.iss === issuer && claims.aud === "authenticated" &&
      typeof claims.sub === "string" && uuid.test(claims.sub) && Number.isSafeInteger(claims.exp) &&
      claims.exp > Math.floor(Date.now() / 1000)) return claims;
  } catch { return; }
}

const claims = (sub: string) => ({ sub, iss: issuer, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 300 }) as const;
const sortStates = <T extends { stage: string }>(states: T[]) => [...states].sort((left, right) => left.stage.localeCompare(right.stage));
const json = (value: unknown, status: number) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

async function probe(admin: Client, pool: Pool, direct: Pool) {
  const approvedMigrations = await loadPostgresMigrationsV2(3);
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (const { sql } of approvedMigrations) await admin.query(sql);
  await admin.query(await readFile(new URL("./t349-project-https-read.sql", import.meta.url), "utf8"));
  const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
  assert(parsed.ok);
  const config = parsed.config;
  const menu = config.menus[0];
  const snapshot = JSON.stringify(snapshotForMenu(config, menu));
  await admin.query("INSERT INTO auth.users VALUES ($1),($2),($3)", [a, b, blocked]);
  await admin.query("INSERT INTO t349_private.approved_users VALUES ($1),($2)", [a, b]);
  const rows = [[a, one, false], [b, two, false], [b, extra, false], [a, archived, true], [blocked, hidden, false]] as const;
  for (const [index, [owner, id, archived]] of rows.entries()) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,
      inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at,archived_at)
      VALUES($1,$2,$3,$4,$5,'{"draft":true}',$6,'goal','target','9:16',5,$7::timestamptz,$7::timestamptz,
        CASE WHEN $8 THEN $7::timestamptz END)`,
    [owner, id, menu.id, config.templateVersion, snapshot, `Fixture ${index}`, `2026-01-0${index + 1}T08:09:10.123Z`, archived]);
    for (const [offset, stage] of stageOrder.entries()) await admin.query(
      "INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)",
      [owner, id, stage, offset === 0 ? "approved" : offset === 1 ? "todo" : "locked"]);
  }
  await admin.query(`INSERT INTO dream.jobs(owner_id,id,kind,input_snapshot_json,status,project_id,ref_type,ref_id,provider,idempotency_key,created_at,updated_at)
    VALUES($1,$2,'render','{}','running',$3,'project',$3,'local','t349-fixture',now(),now())`, [b, randomUUID(), two]);
  await admin.query(`GRANT t349_authenticated,t349_anon TO t349_gateway WITH INHERIT FALSE, SET TRUE;
    GRANT dream_api TO t349_direct WITH INHERIT FALSE, SET TRUE`);

  let reads = 0;
  async function sql<T extends QueryResultRow>(identity: Claims | undefined, text: string, args: unknown[] = [], writable = false) {
    const client = await pool.connect();
    try {
      await client.query(writable ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query(identity ? "SET LOCAL ROLE t349_authenticated" : "SET LOCAL ROLE t349_anon");
      await client.query("SELECT set_config('request.jwt.claims',$1,true)", [identity ? JSON.stringify(identity) : "{}"]);
      const result = await client.query<T>(text, args);
      await client.query("ROLLBACK");
      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async function dataApi(request: Request) {
    const url = new URL(request.url);
    const user = decode(request.headers.get("authorization"));
    if (url.origin !== origin || request.headers.get("accept-profile") !== "t349_api") return json({ code: "NOT_FOUND" }, 404);
    if (request.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    if (!user) return json({ code: "AUTH_REQUIRED" }, 401);
    if (!allowed.has(user.sub)) return json({ code: "AUTH_FORBIDDEN" }, 403);
    try {
      if (url.pathname === "/rest/v1/project_list" && url.search === "") {
        reads++;
        const rows = await sql<ListRow>(user, 'SELECT * FROM t349_api.project_list ORDER BY "updatedAt" DESC');
        return json(rows.map(({ jobs, states, ...row }) => ({ ...row, lengthSec: Number(row.lengthSec),
          states, status: projectDisplayState(states, jobs),
          nextStage: stageOrder.find(stage => states.find(state => state.stage === stage)?.status !== "approved") ?? "export" })), 200);
      }
      if (url.pathname === "/rest/v1/project_detail") {
        const id = url.searchParams.get("id");
        if (!id || !uuid.test(id) || [...url.searchParams].length !== 1) return json({ code: "INVALID_INPUT" }, 400);
        reads++;
        const [result] = await sql<Detail>(user, "SELECT * FROM t349_api.project_detail WHERE id=$1", [id]);
        if (!result) return json({ code: "NOT_FOUND" }, 404);
        const { project, snapshot, inputs, states } = result;
        return json({ project, snapshot, inputs, states }, 200);
      }
      return json({ code: "NOT_FOUND" }, 404);
    } catch {
      return json({ code: "PROJECT_READ_UNAVAILABLE" }, 503);
    }
  }
  const request = (path: string, token?: string, profile = "t349_api", method = "GET") =>
    dataApi(new Request(origin + path, { method, headers: {
      "accept-profile": profile, ...(token && { authorization: `Bearer ${token}` }),
    } }));
  const assertStatus = async (result: Promise<Response>, status: number, code: string) => {
    const response = await result;
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { code });
  };

  const readModel = postgresProjectReads(direct);
  for (const [identity, ids] of [[a, [one]], [b, [extra, two]]] as const) {
    const token = sign(claims(identity));
    const own = actorFromVerifiedUserId(identity);
    const response = await request("/rest/v1/project_list", token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const actual = await response.json() as ListRow[];
    assert.deepEqual(actual.map(row => row.id), ids);
    const expected = await readModel.list(own);
    assert.deepEqual(actual.map(row => ({ ...row, states: sortStates(row.states) })),
      expected.map(row => ({ ...row, states: sortStates(row.states) })));
    for (const id of ids) {
      const detail = await request(`/rest/v1/project_detail?id=${id}`, token);
      assert.equal(detail.status, 200);
      assert.equal(detail.headers.get("cache-control"), "no-store");
      const actual = await detail.json() as Omit<Detail, "id">;
      const expected = await readModel.get(own, id);
      assert.deepEqual({ ...actual, states: sortStates(actual.states) }, { ...expected, states: sortStates(expected.states) });
    }
  }

  const approvedToken = sign(claims(a));
  for (const id of [two, archived, randomUUID()]) await assertStatus(
    request(`/rest/v1/project_detail?id=${id}`, approvedToken), 404, "NOT_FOUND");
  const before = reads;
  await assertStatus(request("/rest/v1/project_list", sign(claims(blocked))), 403, "AUTH_FORBIDDEN");
  await assertStatus(request("/rest/v1/project_list"), 401, "AUTH_REQUIRED");
  for (const invalid of [approvedToken + "x", sign({ ...claims(a), role: "dream_worker" }),
    sign({ ...claims(a), iss: "https://untrusted.invalid" }), sign({ ...claims(a), aud: "untrusted" }),
    sign({ ...claims(a), exp: 1 })]) {
    await assertStatus(request("/rest/v1/project_list", invalid), 401, "AUTH_REQUIRED");
  }
  await assertStatus(request("/rest/v1/project_list", approvedToken, "dream"), 404, "NOT_FOUND");
  await assertStatus(request("/rest/v1/project_list", approvedToken, "auth"), 404, "NOT_FOUND");
  await assertStatus(request("/rest/v1/project_list", approvedToken, "t349_private"), 404, "NOT_FOUND");
  await assertStatus(request("/rest/v1/project_list", approvedToken, "t349_api", "POST"), 405, "METHOD_NOT_ALLOWED");
  assert.equal(reads, before);

  assert.deepEqual(await sql(claims(blocked), "SELECT id FROM t349_api.project_list"), []);
  const [context] = await sql(claims(a), `SELECT current_user AS role, current_setting('transaction_read_only') AS read_only,
    has_schema_privilege('dream','USAGE') AS foundation, has_schema_privilege('auth','USAGE') AS auth,
    pg_has_role('dream_api','MEMBER') AS api_role, pg_has_role('dream_worker','MEMBER') AS worker_role,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('dream','t349_api','t349_private') AND c.relkind IN ('r','v') AND
        (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(c.oid,'INSERT,UPDATE'))) AS writable`);
  assert.deepEqual(context, { role: "t349_authenticated", read_only: "on", foundation: false, auth: false,
    api_role: false, worker_role: false, writable: false });
  const denied = { code: "42501" };
  await assert.rejects(sql(undefined, "SELECT id FROM t349_api.project_list"), denied);
  for (const statement of ["SELECT title FROM dream.projects", "SELECT id FROM auth.users", "SELECT id FROM t349_private.approved_users",
    "SET ROLE dream_api", "SET ROLE dream_worker"]) {
    await assert.rejects(sql(claims(a), statement, [], true), denied);
  }
  for (const statement of ["UPDATE t349_api.project_list SET title='forbidden'",
    "DELETE FROM t349_api.project_detail", "INSERT INTO t349_api.project_list(title) VALUES ('forbidden')"]) {
    await assert.rejects(sql(claims(a), statement, [], true), (error: unknown) => {
      assert(error instanceof Error && "code" in error);
      return error.code === "42501" || error.code === "55000";
    });
  }
  // The same pool has no persistent impersonation after the operation.
  assert.deepEqual((await pool.query("SELECT current_user AS role,nullif(current_setting('request.jwt.claims',true),'') AS claims")).rows,
    [{ role: "t349_gateway", claims: null }]);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM dream.projects")).rows[0].n, rows.length);
  await admin.query("REVOKE SELECT ON t349_api.project_list FROM t349_authenticated");
  try { await assertStatus(request("/rest/v1/project_list", approvedToken), 503, "PROJECT_READ_UNAVAILABLE"); }
  finally { await admin.query("GRANT SELECT ON t349_api.project_list TO t349_authenticated"); }
}

assert(process.platform === "win32" && process.argv.length === 2, "Use the existing Windows PG17 fixture binaries without target arguments");
const systemRoot = process.env.SystemRoot;
assert(systemRoot);
const samePath = (left: string, right: string) => left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP)$/i.test(key))), NODE_ENV: "test" };
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const run = (name: string, args: string[], extra: Readonly<Record<string, string>> = {}) =>
  execFileAsync(join(bin, name), args, extra);
const execFileAsync = (path: string, args: string[], extra: Readonly<Record<string, string>> = {}) =>
  exec(path, args, { env: { ...env, ...extra }, windowsHide: true, timeout: 90_000 });
const ps = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
assert(samePath(await realpath(bin), bin));
for (const tool of ["postgres.exe", "initdb.exe", "pg_ctl.exe"]) {
  const path = join(bin, tool);
  assert(samePath(await realpath(path), path));
  await execFileAsync(ps, ["-NoProfile", "-NonInteractive", "-Command",
    "$s=Get-AuthenticodeSignature -LiteralPath $env:T349_TOOL; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { exit 1 }"],
  { T349_TOOL: path });
  assert.match((await run(tool, ["--version"])).stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}
const freePort = createServer();
await new Promise<void>((resolve, reject) => { freePort.once("error", reject); freePort.listen(0, host, resolve); });
const address = freePort.address();
assert(address && typeof address !== "string");
const { port } = address;
await new Promise<void>((resolve, reject) => freePort.close(error => error ? reject(error) : resolve()));
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t349-"));
const data = join(root, "cluster");
const pidfile = join(data, "postmaster.pid");
const pwd = join(root, "bootstrap-password");
const secret = () => randomBytes(24).toString("hex");
const [bootstrapPassword, gatewayPassword, directPassword] = [secret(), secret(), secret()];
const connection = { host, port, database, ssl: false as const, connectionTimeoutMillis: 5000,
  statement_timeout: 8000, options: "-c search_path=pg_catalog", application_name: "t349-owned" };
const clients: Client[] = [];
async function openAdmin(db: string) {
  const client = new Client({ ...connection, database: db, user: bootstrap, password: bootstrapPassword });
  clients.push(client);
  await client.connect();
  return client;
}

async function verifyOwnedListener() {
  const lines = (await readFile(pidfile, "utf8")).split(/\r?\n/);
  assert(/^[1-9][0-9]+$/.test(lines[0]) && samePath(lines[1], data) && Number(lines[3]) === port);
  await execFileAsync(ps, ["-NoProfile", "-NonInteractive", "-Command", `
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T349_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T349_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T349_EXE -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T349_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T349_PID -or $s[0].LocalAddress -ne '127.0.0.1') { exit 1 }`],
  { T349_PID: lines[0], T349_PORT: String(port), T349_EXE: join(bin, "postgres.exe"), T349_DATA: data });
}
try {
  await writeFile(pwd, bootstrapPassword, { flag: "wx" });
  try { await run("initdb.exe", ["-D", data, "-U", bootstrap, `--pwfile=${pwd}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]); }
  finally { await unlink(pwd); }
  await appendFile(join(data, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${port}\n`);
  await writeFile(join(data, "pg_hba.conf"), "host all all 127.0.0.1/32 scram-sha-256\n");
  const log = await open(join(root, "launcher.log"), "a");
  try {
    const child = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-w", "-t", "30", "start"],
      { env, windowsHide: true, timeout: 40_000, stdio: ["ignore", log.fd, log.fd] });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Owned PG17 startup failed")));
    });
  } finally { await log.close(); }
  await verifyOwnedListener();
  const control = await openAdmin("postgres");
  await control.query(`CREATE DATABASE ${database}`);
  await control.query(`CREATE ROLE t349_gateway LOGIN NOINHERIT PASSWORD '${gatewayPassword}';
    CREATE ROLE t349_direct LOGIN NOINHERIT PASSWORD '${directPassword}'`);
  const admin = await openAdmin(database);
  const gateway = new Pool({ ...connection, max: 1, user: "t349_gateway", password: gatewayPassword });
  const direct = new Pool({ ...connection, max: 1, user: "t349_direct", password: directPassword });
  try { await probe(admin, gateway, direct); }
  finally { await Promise.all([gateway.end(), direct.end()]); }
  console.log("T349 real PG17 RLS/ACL and synthetic JWT mock HTTP cases passed");
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  const running = await access(pidfile).then(() => true, (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return false;
    throw err;
  });
  if (running) {
    await verifyOwnedListener();
    await run("pg_ctl.exe", ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
    await assert.rejects(access(pidfile), { code: "ENOENT" });
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port });
      socket.setTimeout(2000, () => socket.destroy(new Error("Loopback cleanup timed out")));
      socket.once("connect", () => { socket.destroy(); reject(new Error("Owned listener still open")); });
      socket.once("error", (err: NodeJS.ErrnoException) => err.code === "ECONNREFUSED" ? resolve() : reject(err));
    });
  }
  const resolvedRoot = await realpath(root);
  assert(samePath(dirname(resolvedRoot), temp) && basename(resolvedRoot).startsWith("dream-t349-"));
  await rm(resolvedRoot, { recursive: true, maxRetries: 4, retryDelay: 100 });
  console.log("T349 owned listener, connections and cluster removed");
}
