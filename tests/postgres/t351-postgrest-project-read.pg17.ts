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
import { loadPostgresMigrationsV2 } from "../../lib/db/postgres/migration-manifest-v2";
import { projectDisplayState, stageOrder, type StageState } from "../../lib/domain/stages";
import { parseMenuConfig } from "../../lib/menus/parse";
import { snapshotForMenu } from "../../lib/menus/snapshot";
import { createProjectReadRequest } from "../../lib/services/postgres/project-read-request";

const release = "https://github.com/PostgREST/postgrest/releases/download/v16.6/postgrest-v16.6-windows-x86-64.zip";
const expectedSha = "77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea";
const host = "127.0.0.1";
const bootstrap = "t351_bootstrap";
const issuer = "https://t351.test.invalid/auth/v1";
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
    "$s=Get-AuthenticodeSignature -LiteralPath $env:T351_TOOL; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { exit 1 }"],
  { T351_TOOL: path });
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
    sub, role: "t349_authenticated", aud: "authenticated", iss: issuer, exp: Math.floor(Date.now() / 1000) + 180,
    ...override,
  })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
}

async function seed(admin: Client) {
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (const { sql } of await loadPostgresMigrationsV2(3)) await admin.query(sql);
  await admin.query(await readFile(new URL("./t349-project-https-read.sql", import.meta.url), "utf8"));
  await admin.query(`CREATE ROLE t351_gateway LOGIN NOINHERIT PASSWORD '${gatewayPassword}';
    CREATE ROLE t351_direct LOGIN NOINHERIT PASSWORD '${directPassword}';
    GRANT t349_authenticated,t349_anon TO t351_gateway WITH INHERIT FALSE, SET TRUE;
    GRANT dream_api TO t351_direct WITH INHERIT FALSE, SET TRUE;
    CREATE VIEW t349_api.session_state WITH (security_invoker=true) AS
      SELECT current_user AS db_role,session_user AS login,
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub' AS subject,
        current_setting('transaction_read_only') AS read_only;
    GRANT USAGE ON SCHEMA t349_api TO t349_anon;
    GRANT SELECT ON t349_api.session_state TO t349_authenticated,t349_anon`);
  await admin.query("INSERT INTO auth.users VALUES ($1),($2),($3)", [a, b, blocked]);
  await admin.query("INSERT INTO t349_private.approved_users VALUES ($1),($2)", [a, b]);
  const parsed = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
  assert(parsed.ok);
  const { config } = parsed;
  const menu = config.menus[0];
  const snapshot = JSON.stringify(snapshotForMenu(config, menu));
  const projects = [[a, first], [b, second], [b, another], [a, archived], [blocked, excluded]] as const;
  for (const [index, [owner, id]] of projects.entries()) {
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
      title,goal,target,aspect,length_sec,created_at,updated_at,archived_at)
      VALUES($1,$2,$3,$4,$5,'{"draft":true}',$6,'goal','target','9:16',5,$7::timestamptz,$7::timestamptz,
        CASE WHEN $8 THEN $7::timestamptz END)`,
    [owner, id, menu.id, config.templateVersion, snapshot, `Fixture ${index}`, `2026-01-0${index + 1}T08:09:10.123Z`, id === archived]);
    for (const [offset, stage] of stageOrder.entries()) await admin.query(
      "INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)",
      [owner, id, stage, offset === 0 ? "approved" : offset === 1 ? "todo" : "locked"]);
  }
  await admin.query(`INSERT INTO dream.jobs(owner_id,id,kind,input_snapshot_json,status,project_id,ref_type,ref_id,provider,idempotency_key,created_at,updated_at)
    VALUES($1,$2,'render','{}','running',$3,'project',$3,'local','t351-fixture',now(),now())`, [b, randomUUID(), second]);
}

const statesInOrder = <T extends { stage: string }>(states: T[]) => [...states].sort((left, right) => left.stage.localeCompare(right.stage));
type State = StageState & Record<string, unknown>;
type NativeList = { id: string; states: State[]; jobs: string[]; [key: string]: unknown };
type NativeDetail = { id: string; states: State[]; [key: string]: unknown };

async function verifyHttp(origin: string, direct: Pool, admin: Client) {
  const request = (path: string, jwt?: string, headers?: HeadersInit, method = "GET") => {
    const selected = new Headers(headers);
    if (jwt) selected.set("authorization", `Bearer ${jwt}`);
    return fetch(origin + path, { headers: selected, method, redirect: "error", signal: AbortSignal.timeout(4000) });
  };
  const expectError = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    const error = await response.json();
    assert.equal(error.code, code);
  };
  const tokenA = token(a);
  assert.deepEqual(await (await request("/session_state", tokenA)).json(),
    [{ db_role: "t349_authenticated", login: "t351_gateway", subject: a, read_only: "on" }]);
  assert.deepEqual(await (await request("/session_state")).json(),
    [{ db_role: "t349_anon", login: "t351_gateway", subject: null, read_only: "on" }]);
  assert.deepEqual(await (await request("/session_state", token(b))).json(),
    [{ db_role: "t349_authenticated", login: "t351_gateway", subject: b, read_only: "on" }]);

  const existingRead = (userId: string) => createProjectReadRequest({
    resolveAuth: async () => ({ kind: "verified", userId, email: "approved@t351.test.invalid" }),
    environment: () => ({ DREAM_AUTH_MODE: "supabase", DREAM_PROJECT_READ_BACKEND: "postgres",
      DATABASE_URL: "postgresql://synthetic:fixture@localhost:5432/unused" }),
    getPool: () => direct,
  });
  for (const [identity, ids] of [[a, [first]], [b, [another, second]]] as const) {
    const jwt = token(identity);
    const read = existingRead(identity);
    const list = await request("/project_list?order=updatedAt.desc,id.asc", jwt);
    assert.equal(list.status, 200);
    const rows = await list.json() as NativeList[];
    assert.deepEqual(rows.map(item => item.id), ids);
    const mapped = rows.map(({ jobs, states, ...row }) => ({
      ...row, states: statesInOrder(states), status: projectDisplayState(states, jobs),
      nextStage: stageOrder.find(stage => states.find(state => state.stage === stage)?.status !== "approved") ?? "export",
    }));
    const controlList = await read.list();
    assert.equal(controlList.status, 200);
    assert.equal(controlList.headers["cache-control"], "no-store");
    const expected = controlList.body.map(row => ({ ...row, states: statesInOrder(row.states) }));
    assert.deepEqual(mapped, expected);
    for (const id of ids) {
      const response = await request(`/project_detail?id=eq.${id}`, jwt);
      assert.equal(response.status, 200);
      const [{ id: returned, states, ...body }] = await response.json() as NativeDetail[];
      assert.equal(returned, id);
      const controlDetail = await read.get(id);
      assert.equal(controlDetail.status, 200);
      assert.equal(controlDetail.headers["cache-control"], "no-store");
      const expected = controlDetail.body;
      assert.deepEqual({ ...body, states: statesInOrder(states) }, { ...expected, states: statesInOrder(expected.states) });
    }
    assert.equal(list.headers.get("cache-control"), null);
  }

  const firstPage = await request("/project_list?order=updatedAt.desc,id.asc", token(b),
    { "range-unit": "items", range: "0-0", prefer: "count=exact" });
  assert.equal(firstPage.status, 206);
  assert.equal(firstPage.headers.get("content-range"), "0-0/2");
  assert.deepEqual((await firstPage.json() as NativeList[]).map(item => item.id), [another]);
  const nextPage = await request("/project_list?order=updatedAt.desc,id.asc", token(b),
    { "range-unit": "items", range: "1-1", prefer: "count=exact" });
  assert.equal(nextPage.headers.get("content-range"), "1-1/2");
  assert.deepEqual((await nextPage.json() as NativeList[]).map(item => item.id), [second]);

  for (const id of [second, archived, randomUUID()]) {
    const plural = await request(`/project_detail?id=eq.${id}`, tokenA);
    assert.equal(plural.status, 200);
    assert.deepEqual(await plural.json(), []);
    await expectError(await request(`/project_detail?id=eq.${id}`, tokenA,
      { accept: "application/vnd.pgrst.object+json" }), 406, "PGRST116");
    const app = await existingRead(a).get(id);
    assert.equal(app.status, 404);
    assert.equal(app.headers["cache-control"], "no-store");
  }
  const blockedList = await request("/project_list", token(blocked));
  assert.equal(blockedList.status, 200);
  assert.deepEqual(await blockedList.json(), []);
  await expectError(await request("/project_list"), 401, "42501");
  await expectError(await request("/project_list", tokenA + "x"), 401, "PGRST301");
  await expectError(await request("/project_list", token(a, { aud: "other" })), 401, "PGRST303");
  await expectError(await request("/project_list", token(a, { exp: 1 })), 401, "PGRST303");
  await expectError(await request("/project_list", token(a, { role: "dream_worker" })), 403, "42501");
  // This standalone configuration verifies the signing key and audience, and does not enforce an issuer.
  assert.equal((await request("/project_list", token(a, { iss: "https://other.test.invalid" }))).status, 200);
  assert.equal((await request("/project_list", token(a, { aud: undefined }))).status, 200);
  for (const profile of ["dream", "auth", "t349_private"]) {
    await expectError(await request("/project_list", tokenA, { "accept-profile": profile }), 406, "PGRST106");
  }
  await expectError(await request("/project_detail?id=eq.invalid", tokenA), 400, "22P02");
  await expectError(await request(`/project_list?id=eq.${first}`, tokenA, undefined, "DELETE"), 500, "55000");
  await admin.query("REVOKE SELECT ON t349_api.project_list FROM t349_authenticated");
  try { await expectError(await request("/project_list", tokenA), 403, "42501"); }
  finally { await admin.query("GRANT SELECT ON t349_api.project_list TO t349_authenticated"); }
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM dream.projects")).rows[0].n, 5);
  console.log("T351 PostgREST native JWT role, RLS, profiles, paging, errors, DTO parity and raw cache header passed");
}

const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t351-"));
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
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T351_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T351_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T351_EXE -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T351_DATA) -or
        $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T351_PID -or $s[0].LocalAddress -ne '127.0.0.1') { exit 1 }`],
  { T351_PID: lines[0], T351_PORT: String(port), T351_EXE: join(bin, "postgres.exe"), T351_DATA: data });
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
  const clientConfig = { host, port, database: "postgres", ssl: false as const, connectionTimeoutMillis: 4000, statement_timeout: 8000,
    application_name: "t351-owned", options: "-c search_path=pg_catalog" };
  control = new Client({ ...clientConfig, user: bootstrap, password: bootstrapPassword });
  await control.connect();
  await seed(control);
  direct = new Pool({ ...clientConfig, max: 1, user: "t351_direct", password: directPassword });

  apiPort = await allocatePort();
  const origin = `http://${host}:${apiPort}`;
  const child = spawn(executable, [], { windowsHide: true, cwd: root, stdio: ["ignore", "ignore", "pipe"], env: {
    ...env, Path: childPath, PGRST_DB_URI: `postgresql://t351_gateway:${gatewayPassword}@${host}:${port}/postgres?sslmode=disable`,
    PGRST_SERVER_HOST: host, PGRST_SERVER_PORT: String(apiPort), PGRST_DB_POOL: "1", PGRST_DB_CONFIG: "false",
    PGRST_DB_CHANNEL_ENABLED: "false", PGRST_DB_SCHEMAS: "t349_api", PGRST_DB_EXTRA_SEARCH_PATH: "", PGRST_DB_ANON_ROLE: "t349_anon",
    PGRST_JWT_SECRET: jwtSecret, PGRST_JWT_AUD: "authenticated",
  } });
  postgrest = child;
  let diagnostics = "";
  child.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
  postgrestExit = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    const result = await fetch(origin + "/session_state", { signal: AbortSignal.timeout(500) }).catch(() => undefined);
    if (result?.ok) { await result.arrayBuffer(); ready = true; break; }
    await result?.body?.cancel();
    await delay(100);
  }
  assert(ready, diagnostics.replaceAll(gatewayPassword, "[removed]").replaceAll(jwtSecret, "[removed]"));
  await run(ps, ["-NoProfile", "-NonInteractive", "-Command", `
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T351_PID)
    $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T351_PORT) -ErrorAction SilentlyContinue)
    if (!$p -or $p.ExecutablePath -ine $env:T351_EXE -or $s.Count -ne 1 -or
        $s[0].OwningProcess -ne [int]$env:T351_PID -or $s[0].LocalAddress -ne '127.0.0.1') { exit 1 }`],
  { T351_PID: String(child.pid), T351_PORT: String(apiPort), T351_EXE: executable });
  await verifyHttp(origin, direct, control);
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
      assert(samePath(dirname(verifiedRoot), temp) && basename(verifiedRoot).startsWith("dream-t351-"));
      await rm(verifiedRoot, { recursive: true, maxRetries: 4, retryDelay: 100 });
      await assert.rejects(access(verifiedRoot), { code: "ENOENT" });
      console.log("T351 owned listeners, processes, verified portable binary and scratch cluster removed");
    }
  }
}
