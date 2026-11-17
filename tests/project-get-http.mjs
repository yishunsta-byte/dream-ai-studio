/* global process, console, Buffer, fetch, AbortSignal, setTimeout, URL */
// Isolated Next dev + real SDK/fake Auth + TLS PostgreSQL. No product source,
// environment file, service registration or shared .next is modified.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { mkdir, readFile, writeFile, cp, open, appendFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv[2] !== "--bin" || !process.argv[3] || process.argv[4] !== "--openssl" || !process.argv[5]) throw new Error("Usage: node tests/project-get-http.mjs --bin <signed-pg-bin> --openssl <openssl.exe>");
const bin = resolve(process.argv[3]), openssl = resolve(process.argv[5]);
const root = join(repo, "tmp", `b4g-http-${randomUUID()}`), app = join(root, "app"), cluster = join(root, "cluster");
await mkdir(app, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(PG|DREAM_|VERCEL|NEXT_PUBLIC_SUPABASE|SUPABASE|DATABASE_URL|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED)/.test(key)) delete env[key];
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function freePort() {
  const server = netServer();
  return new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePort(port)); }); });
}
async function command(exe, args, log, options = {}) {
  const output = await open(join(root, log), "a");
  try {
    return await new Promise((resolveCommand, reject) => {
      const child = spawn(exe, args, { cwd: repo, env, windowsHide: true, stdio: ["ignore", output.fd, output.fd], ...options });
      child.once("error", () => reject(new Error(`Test command failed; inspect ${log}`)));
      child.once("exit", code => code === 0 ? resolveCommand() : reject(new Error(`Test command exit ${code}; inspect ${log}`)));
    });
  } finally { await output.close(); }
}
let started = false, next, nextOutput, admin, fake;
let events = [], sequence = [];
const observations = [];
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const PA = "00000000-0000-4000-8000-000000000010", PB = "00000000-0000-4000-8000-000000000020";
try {
  console.log("B4-G freezing source and copying dependencies");
  await command("git", ["rev-parse", "HEAD"], "base.txt");
  const base = (await readFile(join(root, "base.txt"), "utf8")).trim();
  await command("git", ["archive", "--format=tar", "-o", join(root, "source.tar"), base], "archive.log");
  await command("tar.exe", ["-xf", join(root, "source.tar"), "-C", app], "extract.log");
  const overlays = {};
  for (const path of ["app/api/projects/route.ts", "app/api/projects/[id]/route.ts"]) {
    const bytes = await readFile(join(repo, path));
    await mkdir(dirname(join(app, path)), { recursive: true }); await writeFile(join(app, path), bytes);
    overlays[path] = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(join(root, "source.json"), JSON.stringify({ base, overlays }, null, 2));
  await cp(join(repo, "node_modules"), join(app, "node_modules"), { recursive: true });
  const signature = "$ErrorActionPreference='Stop';foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe','createdb.exe')){$s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B4G_BIN $n);if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation'){throw 'Invalid EDB signature'};Write-Output ($n+': Valid EnterpriseDB')}";
  await command("powershell.exe", ["-NoProfile", "-Command", signature], "signatures.log", { env: { ...env, DREAM_B4G_BIN: bin } });
  await writeFile(join(root, "openssl.cnf"), "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n");
  await command(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", join(root, "openssl.cnf"), "-keyout", join(root, "server.key"), "-out", join(root, "server.crt")], "certificate.log");
  await writeFile(join(root, "dummy-password.txt"), "b4g-synthetic-admin");
  await command(join(bin, "initdb.exe"), ["-D", cluster, "-U", "dream_test_admin", `--pwfile=${join(root, "dummy-password.txt")}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log");
  const pgPort = await freePort();
  await appendFile(join(cluster, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${pgPort}\nssl=on\nssl_cert_file='${join(root, "server.crt").replaceAll("\\", "/")}'\nssl_key_file='${join(root, "server.key").replaceAll("\\", "/")}'\n`);
  await command(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-w", "start"], "start.log"); started = true;
  await command(join(bin, "createdb.exe"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "dream_test_admin", "dream_test_b4g"], "createdb.log", { env: { ...env, PGPASSWORD: "b4g-synthetic-admin" } });
  const ca = await readFile(join(root, "server.crt"), "utf8");
  admin = new Pool({ connectionString: `postgresql://dream_test_admin:b4g-synthetic-admin@127.0.0.1:${pgPort}/dream_test_b4g`, ssl: { ca, rejectUnauthorized: true } });
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  for (const name of ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql"]) await admin.query(await readFile(join(app, "lib/db/postgres", name), "utf8"));
  await admin.query("CREATE ROLE dream_test_api_login LOGIN PASSWORD 'b4g-synthetic-api' NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; GRANT dream_api TO dream_test_api_login");
  const config = JSON.parse(await readFile(join(app, "docs/spec/menus.json"), "utf8")), menu = config.menus[0];
  const snapshot = JSON.stringify({ schemaVersion: config.schemaVersion, templateVersion: config.templateVersion, stages: config.stages, commonInputs: config.commonInputs, commonReview: config.commonReview, conditionalReview: config.conditionalReview, menu });
  for (const [owner, id] of [[A, PA], [B, PB]]) {
    await admin.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'{}','Synthetic HTTP','test','test','9:16',4,now(),now())", [owner, id, menu.id, config.templateVersion, snapshot]);
    for (const [index, stage] of config.stages.entries()) await admin.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)", [owner, id, stage.id, index === 0 ? "approved" : index === 1 ? "todo" : "locked"]);
  }
  const users = { A: { id: A, email: "a@example.invalid" }, B: { id: B, email: "b@example.invalid" }, outside: { id: B, email: "outside@example.invalid" } };
  const tokens = new Map();
  const enc = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  function session(user) {
    const access = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-b4g`;
    tokens.set(access, user);
    return { access_token: access, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user: { ...user, aud: "authenticated", role: "authenticated", created_at: "2026-11-17T00:00:00Z", app_metadata: {}, user_metadata: {} } };
  }
  fake = httpServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* synthetic invalid input */ }
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    let status = 200, data;
    let user = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    const choice = path === "/auth/v1/user" && sequence.length ? sequence.shift() : undefined;
    if (path === "/auth/v1/verify") data = session(users[body.token_hash] ?? users.A);
    else if (path === "/auth/v1/user") {
      if (choice === "server500") { status = 500; data = { code: "unexpected_failure", msg: "synthetic outage" }; }
      else if (!user) { status = 401; data = { code: "bad_jwt", msg: "synthetic expired" }; }
      else { if (choice) user = users[choice]; data = { ...user, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }; }
    } else if (path === "/auth/v1/logout") { status = 204; data = null; }
    else { status = 404; data = { code: "unexpected_endpoint" }; }
    events.push({ path, status, owner: user?.id ?? null });
    res.writeHead(status, { "content-type": "application/json" }); res.end(data === null ? undefined : JSON.stringify(data));
  });
  await new Promise(resolveListen => fake.listen(0, "127.0.0.1", resolveListen));
  const authPort = fake.address().port, port = await freePort(), baseUrl = `http://127.0.0.1:${port}`;
  const apiUrl = `postgresql://dream_test_api_login:b4g-synthetic-api@127.0.0.1:${pgPort}/dream_test_b4g`;
  nextOutput = await open(join(root, "next.log"), "a");
  next = spawn(process.execPath, [join(app, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: app, windowsHide: true, stdio: ["ignore", nextOutput.fd, nextOutput.fd], env: { ...env, NEXT_TELEMETRY_DISABLED: "1", DREAM_AUTH_MODE: "supabase", DREAM_ALLOWED_EMAILS: "a@example.invalid,b@example.invalid", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public", DREAM_SITE_URL: baseUrl, DREAM_DATA_ROOT: join(root, "fake-runtime"), DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: apiUrl, NODE_EXTRA_CA_CERTS: join(root, "server.crt"), DREAM_B4G_SERVER_SENTINEL: "synthetic-server-secret-never-in-response" },
  });
  next.once("error", () => {});
  const pgPid = Number((await readFile(join(cluster, "postmaster.pid"), "utf8")).split(/\r?\n/)[0]);
  await writeFile(join(root, "run.json"), JSON.stringify({ root, appPid: next.pid, pgPid, ports: { app: port, postgres: pgPort, auth: authPort }, bind: "127.0.0.1", base, overlays }, null, 2));
  console.log("B4-G waiting for isolated Next server");
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const r = await fetch(`${baseUrl}/api/projects`, { signal: AbortSignal.timeout(1000) }); if (r.status === 401) { ready = true; break; } } catch { /* owned server startup */ }
    if (next.exitCode !== null) throw new Error("Isolated Next exited; inspect next.log");
    await delay(500);
  }
  assert(ready, "isolated Next readiness");
  function jar() { const values = new Map(); return { header: () => [...values].map(([key, value]) => `${key}=${value}`).join("; "), take(response) { for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], i = pair.indexOf("="); values.set(pair.slice(0, i), pair.slice(i + 1)); } } }; }
  async function request(path, cookies, headers = {}) {
    const response = await fetch(baseUrl + path, { redirect: "manual", headers: { ...(cookies ? { cookie: cookies.header() } : {}), ...headers }, signal: AbortSignal.timeout(60000) });
    cookies?.take(response); const text = await response.text();
    assert(!text.includes("synthetic-server-secret-never-in-response")); assert(!text.includes(apiUrl));
    let body; try { body = JSON.parse(text); } catch { body = null; }
    return { status: response.status, body, cache: response.headers.get("cache-control"), location: response.headers.get("location") };
  }
  const jars = { A: jar(), B: jar() };
  for (const who of ["A", "B"]) assert.equal((await request(`/auth/callback?token_hash=${who}&type=recovery&next=%2F`, jars[who])).status, 307);
  const activity = async () => (await admin.query("SELECT pid,state_change::text,query_start::text FROM pg_stat_activity WHERE datname='dream_test_b4g' AND usename='dream_test_api_login' ORDER BY pid")).rows;
  for (const [who, id, other] of [["A", PA, PB], ["B", PB, PA], ["A", PA, PB]]) {
    const before = events.length, list = await request(`/api/projects?owner_id=${users[who === "A" ? "B" : "A"].id}`, jars[who], { "x-owner-id": users[who === "A" ? "B" : "A"].id });
    assert.equal(list.status, 200); assert.deepEqual(list.body.map(row => row.id), [id]); assert.equal(list.cache, "no-store");
    assert.equal(events.slice(before).filter(event => event.path === "/auth/v1/user").length, 2); // proxy1 + handler1
    const detail = await request(`/api/projects/${id}`, jars[who]); assert.equal(detail.status, 200); assert.equal(detail.body.project.id, id);
    const foreign = await request(`/api/projects/${other}`, jars[who]); assert.equal(foreign.status, 404); assert.equal(foreign.body.code, "NOT_FOUND");
    observations.push({ name: `${who}-real-list-get-isolated`, userCalls: 2, list, detail, foreign });
  }
  const active = await activity(); assert(active.length > 0);
  for (const [name, choices, cookies, status, code] of [
    ["anonymous", [], undefined, 401, "AUTH_REQUIRED"],
    ["handler-forbidden", ["A", "outside"], jars.A, 403, "AUTH_FORBIDDEN"],
    ["handler-provider503", ["A", ...Array(30).fill("server500")], jars.A, 503, "AUTH_UNAVAILABLE"],
  ]) {
    sequence = [...choices]; const before = await activity(), reply = await request(`/api/projects/${PA}`, cookies); sequence = [];
    assert.equal(reply.status, status); assert.equal(reply.body.code, code); assert.equal(reply.cache, "no-store");
    assert.deepEqual(await activity(), before); observations.push({ name, reply, postgresQueries: 0 });
  }
  const invalid = await request("/api/projects/not-a-uuid", jars.B); assert.equal(invalid.status, 400); assert.equal(invalid.body.code, "INVALID_INPUT");
  await admin.query("UPDATE dream.projects SET template_snapshot_json='{}' WHERE id=$1", [PB]);
  const corrupt = await request(`/api/projects/${PB}`, jars.B); assert.equal(corrupt.status, 503); assert.equal(corrupt.body.code, "PROJECT_READ_UNAVAILABLE");
  await admin.query("UPDATE dream.projects SET template_snapshot_json=$2 WHERE id=$1", [PB, snapshot]);
  for (const [token, user] of tokens) if (user.id === A) tokens.delete(token);
  const expired = await request("/api/projects", jars.A); assert.equal(expired.status, 401); assert.equal(expired.body.code, "AUTH_REQUIRED");
  assert.equal((await request("/api/projects", jars.B)).status, 200);
  observations.push({ name: "invalid-corrupt-expired-A-B-preserved", invalid, corrupt, expired });
  await writeFile(join(root, "http-results.json"), JSON.stringify(observations, null, 2));
  await writeFile(join(root, "fake-events.json"), JSON.stringify(events, null, 2));
  const tls = (await admin.query("SELECT a.usename,s.ssl,s.version,s.cipher FROM pg_stat_ssl s JOIN pg_stat_activity a USING(pid) WHERE a.datname='dream_test_b4g'")).rows;
  assert(tls.some(row => row.usename === "dream_test_api_login" && row.ssl));
  await writeFile(join(root, "tls.json"), JSON.stringify(tls));
  console.log(`B4-G actual HTTP observations passed: ${observations.length}`);
} finally {
  if (next && next.exitCode === null) {
    const exited = new Promise(resolveExit => next.once("exit", resolveExit));
    // Next dev owns a server child on Windows; stop only this recorded tree.
    await command("taskkill.exe", ["/PID", String(next.pid), "/T", "/F"], "next-stop.log");
    await exited;
  }
  await nextOutput?.close();
  await admin?.end();
  if (fake) await new Promise(resolveClose => fake.close(resolveClose));
  if (started) await command(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
  console.log(`B4-G evidence retained: ${root}`);
}
