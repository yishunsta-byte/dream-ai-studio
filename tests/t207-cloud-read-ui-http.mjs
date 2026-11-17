/* global process, console, Buffer, fetch, AbortSignal, setTimeout, URL */
// T-207 클라우드 읽기 전용 화면 실제 HTTP 검증기(B4-G 검증기 방식을 그대로 따른 별도 파일).
// 격리 사본 next build + next start, 실제 SDK + fake Auth + TLS PostgreSQL. 제품 소스·환경 파일·공유 .next는 바꾸지 않는다.
// --hold: 검증 뒤 서버를 띄워 둔 채 run.json에 주소를 남기고, root/stop 파일이 생기면 정리한다(브라우저 확인용).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { mkdir, readFile, writeFile, cp, open, appendFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv[2] !== "--bin" || !process.argv[3] || process.argv[4] !== "--openssl" || !process.argv[5]) throw new Error("Usage: node tests/t207-cloud-read-ui-http.mjs --bin <signed-pg-bin> --openssl <openssl.exe> [--hold]");
const bin = resolve(process.argv[3]), openssl = resolve(process.argv[5]);
const hold = process.argv[6] === "--hold";
const root = join(repo, "tmp", `t207-http-${randomUUID()}`), app = join(root, "app"), cluster = join(root, "cluster");
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
  console.log("T207 freezing source and copying dependencies");
  await command("git", ["rev-parse", "HEAD"], "base.txt");
  const base = (await readFile(join(root, "base.txt"), "utf8")).trim();
  await command("git", ["archive", "--format=tar", "-o", join(root, "source.tar"), base], "archive.log");
  await command("tar.exe", ["-xf", join(root, "source.tar"), "-C", app], "extract.log");
  const overlays = {};
  const t207 = ["lib/cloud/project-read-page.ts", "components/cloud/project-list-readonly.tsx", "components/cloud/project-detail-readonly.tsx",
    "app/(cloud)/layout.tsx", "app/(cloud)/cloud.module.css", "app/(cloud)/cloud/projects/(list)/page.tsx",
    "app/(cloud)/cloud/projects/[id]/page.tsx", "app/(cloud)/cloud/projects/[id]/not-found.tsx"];
  for (const path of t207) {
    const bytes = await readFile(join(repo, path));
    await mkdir(dirname(join(app, path)), { recursive: true }); await writeFile(join(app, path), bytes);
    overlays[path] = createHash("sha256").update(bytes).digest("hex");
  }
  // T-210: 작업 폴더에서 지운 파일은 고정 사본에서도 지운다(HEAD에 남아 있어도 검증 대상 소스와 같게).
  const removed = [];
  for (const path of ["app/(cloud)/cloud/projects/(list)/loading.tsx"]) {
    if (existsSync(join(repo, path))) continue;
    if (existsSync(join(app, path))) { await rm(join(app, path)); removed.push(path); }
  }
  await writeFile(join(root, "source.json"), JSON.stringify({ base, overlays, removed }, null, 2));
  await cp(join(repo, "node_modules"), join(app, "node_modules"), { recursive: true });
  const signature = "$ErrorActionPreference='Stop';foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe','createdb.exe')){$s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_T207_BIN $n);if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation'){throw 'Invalid EDB signature'};Write-Output ($n+': Valid EnterpriseDB')}";
  await command("powershell.exe", ["-NoProfile", "-Command", signature], "signatures.log", { env: { ...env, DREAM_T207_BIN: bin } });
  await writeFile(join(root, "openssl.cnf"), "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n");
  await command(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", join(root, "openssl.cnf"), "-keyout", join(root, "server.key"), "-out", join(root, "server.crt")], "certificate.log");
  await writeFile(join(root, "dummy-password.txt"), "t207-synthetic-admin");
  await command(join(bin, "initdb.exe"), ["-D", cluster, "-U", "dream_test_admin", `--pwfile=${join(root, "dummy-password.txt")}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log");
  const pgPort = await freePort();
  await appendFile(join(cluster, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${pgPort}\nssl=on\nssl_cert_file='${join(root, "server.crt").replaceAll("\\", "/")}'\nssl_key_file='${join(root, "server.key").replaceAll("\\", "/")}'\n`);
  await command(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-w", "start"], "start.log"); started = true;
  await command(join(bin, "createdb.exe"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "dream_test_admin", "dream_test_t207"], "createdb.log", { env: { ...env, PGPASSWORD: "t207-synthetic-admin" } });
  const ca = await readFile(join(root, "server.crt"), "utf8");
  admin = new Pool({ connectionString: `postgresql://dream_test_admin:t207-synthetic-admin@127.0.0.1:${pgPort}/dream_test_t207`, ssl: { ca, rejectUnauthorized: true } });
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [A, B]);
  for (const name of ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql"]) await admin.query(await readFile(join(app, "lib/db/postgres", name), "utf8"));
  await admin.query("CREATE ROLE dream_test_api_login LOGIN PASSWORD 't207-synthetic-api' NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; GRANT dream_api TO dream_test_api_login");
  const config = JSON.parse(await readFile(join(app, "docs/spec/menus.json"), "utf8")), menu = config.menus[0];
  const snapshot = JSON.stringify({ schemaVersion: config.schemaVersion, templateVersion: config.templateVersion, stages: config.stages, commonInputs: config.commonInputs, commonReview: config.commonReview, conditionalReview: config.conditionalReview, menu });
  const titles = { [PA]: "합성 A 프로젝트", [PB]: "합성 B 프로젝트" };
  for (const [owner, id] of [[A, PA], [B, PB]]) {
    await admin.query("INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'test','test','9:16',4,now(),now())", [owner, id, menu.id, config.templateVersion, snapshot, JSON.stringify({ secretInput: "합성 입력 원문" }), titles[id]]);
    for (const [index, stage] of config.stages.entries()) await admin.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status) VALUES($1,$2,$3,$4)", [owner, id, stage.id, index === 0 ? "approved" : index === 1 ? "todo" : "locked"]);
  }
  const users = { A: { id: A, email: "a@example.invalid" }, B: { id: B, email: "b@example.invalid" }, outside: { id: B, email: "outside@example.invalid" } };
  const tokens = new Map();
  const enc = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  function session(user) {
    const access = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-t207`;
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
      else if (choice === "expired") { status = 401; data = { code: "bad_jwt", msg: "synthetic expired after proxy" }; }
      else if (!user) { status = 401; data = { code: "bad_jwt", msg: "synthetic expired" }; }
      else { if (choice) user = users[choice]; data = { ...user, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }; }
    } else if (path === "/auth/v1/logout") { status = 204; data = null; }
    else { status = 404; data = { code: "unexpected_endpoint" }; }
    events.push({ path, status, owner: user?.id ?? null });
    res.writeHead(status, { "content-type": "application/json" }); res.end(data === null ? undefined : JSON.stringify(data));
  });
  await new Promise(resolveListen => fake.listen(0, "127.0.0.1", resolveListen));
  const authPort = fake.address().port, port = await freePort(), baseUrl = `http://127.0.0.1:${port}`;
  const apiUrl = `postgresql://dream_test_api_login:t207-synthetic-api@127.0.0.1:${pgPort}/dream_test_t207`;
  const runtime = join(root, "fake-runtime");
  const cloudEnv = { ...env, NEXT_TELEMETRY_DISABLED: "1", DREAM_AUTH_MODE: "supabase", DREAM_ALLOWED_EMAILS: "a@example.invalid,b@example.invalid", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public", DREAM_SITE_URL: baseUrl, DREAM_DATA_ROOT: runtime, DREAM_PROJECT_READ_BACKEND: "postgres", DATABASE_URL: apiUrl, NODE_EXTRA_CA_CERTS: join(root, "server.crt"), DREAM_T207_SERVER_SENTINEL: "synthetic-server-secret-never-in-response" };
  console.log("T207 production build in isolated copy");
  await command(process.execPath, [join(app, "node_modules/next/dist/bin/next"), "build"], "build.log", { cwd: app, env: { ...cloudEnv } });
  nextOutput = await open(join(root, "next.log"), "a");
  async function startNext(serverEnv) {
    next = spawn(process.execPath, [join(app, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: app, windowsHide: true, stdio: ["ignore", nextOutput.fd, nextOutput.fd], env: serverEnv });
    next.once("error", () => {});
    for (let attempt = 0; attempt < 120; attempt++) {
      try { const r = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(1000) }); if (r.status === 200) return; } catch { /* owned server startup */ }
      if (next.exitCode !== null) throw new Error("Isolated Next exited; inspect next.log");
      await delay(500);
    }
    throw new Error("isolated Next readiness");
  }
  async function stopNext() {
    if (!next || next.exitCode !== null) return;
    const exited = new Promise(resolveExit => next.once("exit", resolveExit));
    await command("taskkill.exe", ["/PID", String(next.pid), "/T", "/F"], "next-stop.log");
    await exited;
  }
  await startNext(cloudEnv);
  const pgPid = Number((await readFile(join(cluster, "postmaster.pid"), "utf8")).split(/\r?\n/)[0]);
  await writeFile(join(root, "run.json"), JSON.stringify({ root, appPid: next.pid, pgPid, ports: { app: port, postgres: pgPort, auth: authPort }, bind: "127.0.0.1", base, overlays }, null, 2));
  function jar() { const values = new Map(); return { header: () => [...values].map(([key, value]) => `${key}=${value}`).join("; "), take(response) { for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], i = pair.indexOf("="); values.set(pair.slice(0, i), pair.slice(i + 1)); } } }; }
  async function request(path, cookies) {
    const response = await fetch(baseUrl + path, { redirect: "manual", headers: cookies ? { cookie: cookies.header() } : {}, signal: AbortSignal.timeout(60000) });
    cookies?.take(response); const text = await response.text();
    assert(!text.includes("synthetic-server-secret-never-in-response")); assert(!text.includes(apiUrl)); assert(!text.includes("합성 입력 원문"));
    return { status: response.status, text, cache: response.headers.get("cache-control"), location: response.headers.get("location") };
  }
  const summary = reply => ({ status: reply.status, cache: reply.cache, location: reply.location });
  const userCalls = since => events.slice(since).filter(event => event.path === "/auth/v1/user").length;
  const jars = { A: jar(), B: jar() };
  for (const who of ["A", "B"]) assert.equal((await request(`/auth/callback?token_hash=${who}&type=recovery&next=%2F`, jars[who])).status, 307);
  const activity = async () => (await admin.query("SELECT pid,state_change::text,query_start::text FROM pg_stat_activity WHERE datname='dream_test_t207' AND usename='dream_test_api_login' ORDER BY pid")).rows;
  const missing = "00000000-0000-4000-8000-0000000000ff";
  for (const [who, id, other] of [["A", PA, PB], ["B", PB, PA], ["A", PA, PB]]) {
    let since = events.length;
    const list = await request("/cloud/projects", jars[who]);
    assert.equal(list.status, 200); assert(list.text.includes(titles[id])); assert(!list.text.includes(titles[other])); assert(list.text.includes(`/cloud/projects/${id}`));
    const listCalls = userCalls(since); since = events.length;
    const detail = await request(`/cloud/projects/${id}`, jars[who]);
    assert.equal(detail.status, 200); assert(detail.text.includes(titles[id])); assert(detail.text.includes("요구 확인"));
    const detailCalls = userCalls(since);
    assert.equal(detailCalls, 2, "detail: proxy1 + render1");
    const foreign = await request(`/cloud/projects/${other}`, jars[who]), absent = await request(`/cloud/projects/${missing}`, jars[who]), invalid = await request("/cloud/projects/not-a-uuid", jars[who]);
    for (const reply of [foreign, absent, invalid]) { assert.equal(reply.status, 404); assert(reply.text.includes("프로젝트를 찾을 수 없어요")); assert(!reply.text.includes(titles[other])); }
    observations.push({ name: `${who}-list-detail-foreign-absent-invalid`, listCalls, detailCalls, list: summary(list), detail: summary(detail), foreign: summary(foreign), absent: summary(absent), invalid: summary(invalid) });
  }
  const anonymous = await request(`/cloud/projects/${PA}`); assert.equal(anonymous.status, 307); assert.match(anonymous.location, /\/login\?next=/);
  const anonymousList = await request("/cloud/projects"); assert.equal(anonymousList.status, 307);
  observations.push({ name: "anonymous-proxy-redirect", detail: summary(anonymous), list: summary(anonymousList) });
  // T-210: proxy를 통과한 뒤 화면(RSC) 단계에서 거절되면 목록·단건 모두 실제 307·정확한 Location·no-store·Postgres 쿼리 0이어야 한다.
  for (const [name, choices, target] of [
    ["render-expired-401", ["A", "expired"], "/login?next=%2Fcloud%2Fprojects"],
    ["render-forbidden-403", ["A", "outside"], "/login?error=forbidden"],
    ["render-provider-503", ["A", ...Array(30).fill("server500")], "/login?error=unavailable"],
  ]) {
    for (const path of [`/cloud/projects/${PA}`, "/cloud/projects"]) {
      sequence = [...choices]; const before = await activity(), reply = await request(path, jars.A); sequence = [];
      assert.equal(reply.status, 307, `${name} ${path}`);
      assert.equal(reply.location, target, `${name} ${path} location`);
      assert.match(reply.cache ?? "", /no-store/, `${name} ${path} no-store`);
      assert(!reply.text.includes(titles[PA]));
      assert.deepEqual(await activity(), before, "denied render must not query Postgres");
      observations.push({ name: `${name}${path}`, ...summary(reply), postgresQueries: 0 });
    }
  }
  await admin.query("UPDATE dream.projects SET template_snapshot_json='{}' WHERE id=$1", [PB]);
  const corruptList = await request("/cloud/projects", jars.B), corruptDetail = await request(`/cloud/projects/${PB}`, jars.B);
  for (const reply of [corruptList, corruptDetail]) { assert.equal(reply.status, 200); assert(reply.text.includes("프로젝트를 불러오지 못했어요")); assert.equal((reply.text.match(/<h1[\s>]/g) ?? []).length, 1, "T-214: 불러오기 오류 화면도 h1 하나"); assert(!/DATABASE_URL|dream\.projects/i.test(reply.text)); }
  await admin.query("UPDATE dream.projects SET template_snapshot_json=$2 WHERE id=$1", [PB, snapshot]);
  const recovered = await request(`/cloud/projects/${PB}`, jars.B); assert.equal(recovered.status, 200); assert(recovered.text.includes(titles[PB]));
  observations.push({ name: "corrupt-snapshot-then-recover", list: summary(corruptList), detail: summary(corruptDetail), recovered: summary(recovered) });
  const legacy = await request("/", jars.B); assert(legacy.text.includes("클라우드 작업실을 준비하고 있어요")); assert(!legacy.text.includes(titles[PB]));
  observations.push({ name: "legacy-home-still-pending", ...summary(legacy) });
  for (const [token, user] of tokens) if (user.id === A) tokens.delete(token);
  const expired = await request(`/cloud/projects/${PA}`, jars.A); assert.equal(expired.status, 307); assert.match(expired.location, /\/login/);
  const stillB = await request("/cloud/projects", jars.B); assert.equal(stillB.status, 200); assert(stillB.text.includes(titles[PB]));
  observations.push({ name: "expired-A-B-preserved", expired: summary(expired), stillB: summary(stillB) });
  assert.equal(existsSync(runtime), false, "cloud pages must not create the local data root");
  const tls = (await admin.query("SELECT a.usename,s.ssl,s.version,s.cipher FROM pg_stat_ssl s JOIN pg_stat_activity a USING(pid) WHERE a.datname='dream_test_t207'")).rows;
  assert(tls.some(row => row.usename === "dream_test_api_login" && row.ssl));
  await writeFile(join(root, "tls.json"), JSON.stringify(tls));
  if (hold) {
    await writeFile(join(root, "hold.json"), JSON.stringify({ baseUrl, loginA: `${baseUrl}/auth/callback?token_hash=A&type=recovery&next=%2Fcloud%2Fprojects`, stop: join(root, "stop") }, null, 2));
    console.log(`T207 holding cloud server for browser checks: ${baseUrl}`);
    while (!existsSync(join(root, "stop"))) await delay(1000);
  }
  await stopNext();
  await startNext({ ...env, NEXT_TELEMETRY_DISABLED: "1", DREAM_DATA_ROOT: runtime });
  const localCloud = await request("/cloud/projects"), localDetail = await request(`/cloud/projects/${PA}`);
  for (const reply of [localCloud, localDetail]) { assert.equal(reply.status, 200); assert(reply.text.includes("이 PC에서는 기존 작업실을 써요")); assert(!reply.text.includes(titles[PA])); }
  const localHome = await request("/"); assert(!localHome.text.includes("클라우드 작업실을 준비하고 있어요"));
  observations.push({ name: "local-control", cloudList: summary(localCloud), cloudDetail: summary(localDetail), legacyHome: summary(localHome), legacyHomePending: false });
  await writeFile(join(root, "http-results.json"), JSON.stringify(observations, null, 2));
  await writeFile(join(root, "fake-events.json"), JSON.stringify(events, null, 2));
  console.log(`T207 actual HTTP observations passed: ${observations.length}`);
} finally {
  if (next && next.exitCode === null) {
    const exited = new Promise(resolveExit => next.once("exit", resolveExit));
    await command("taskkill.exe", ["/PID", String(next.pid), "/T", "/F"], "next-stop.log");
    await exited;
  }
  await nextOutput?.close();
  await admin?.end();
  if (fake) await new Promise(resolveClose => fake.close(resolveClose));
  if (started) await command(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
  console.log(`T207 evidence retained: ${root}`);
}
