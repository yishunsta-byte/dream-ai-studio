/* global AbortSignal, Buffer, Request, Response, URL, console, fetch, process, require */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive)$/i.test(name)));
const ref = "abcdefghijklmnopqrst";
const origin = `https://${ref}.supabase.co`;
const profile = "project_read";
const actor = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.invalid", aud: "authenticated", role: "authenticated" };
const id = "30000000-0000-4000-8000-000000000001";
const title = "T356 synthetic project";
const name = `sb-${ref}-auth-token`;
const refreshToken = "t356-synthetic-refresh";
const expires = Math.floor(Date.now() / 1000) + 3600;
const jwt = (exp, jti) => `header.${Buffer.from(JSON.stringify({
  sub: actor.id, aud: actor.aud, role: actor.role, iss: `${origin}/auth/v1`, exp, jti,
})).toString("base64url")}.signature`;
const oldToken = jwt(1, "old");
const token = jwt(expires, "renewed");
const expiredSession = { access_token: oldToken, refresh_token: refreshToken, expires_at: 1, expires_in: 3600, token_type: "bearer", user: actor };
const expiredCookie = `${name}=base64-${Buffer.from(JSON.stringify(expiredSession)).toString("base64url")}`;
const freshSession = { ...expiredSession, access_token: token, refresh_token: "t356-synthetic-renewed-refresh", expires_at: expires };
const row = {
  id, title, menuId: "shopping-shorts", menuLabel: "Synthetic menu", aspect: "9:16", lengthSec: 5,
  updatedAt: "2026-01-02T00:00:00.100Z", jobs: [],
  states: ["intake", "brief", "plan", "produce", "edit", "review", "export"].map((stage, index) => ({
    projectId: id, stage, status: index === 0 ? "approved" : "locked",
    approvedPlanId: null, approvedRevision: null, approvedAt: null, note: null,
  })),
};

// Loaded in the owned Next process. All non-loopback I/O terminates here.
function mockSupabaseFetch() {
  // The generated preload runs as CommonJS before Next initializes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { appendFileSync } = require("node:fs");
  const f = JSON.parse(process.env.T356_FIXTURE);
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return original(input, init);
    if (url.origin !== f.origin) throw new Error("Unexpected external fetch in T356");
    const request = new Request(input, init);
    const authorization = request.headers.get("authorization");
    const fresh = authorization === `Bearer ${f.freshSession.access_token}`;
    const event = { path: url.pathname, method: request.method, fresh, profile: request.headers.get("accept-profile") };
    appendFileSync(process.env.T356_EVENTS, JSON.stringify(event) + "\n");
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token" && request.method === "POST") {
      const valid = (await request.json()).refresh_token === f.refreshToken;
      return Response.json(valid ? f.freshSession : { message: "Invalid refresh" }, { status: valid ? 200 : 401 });
    }
    if (!fresh) return Response.json({ message: "Invalid session" }, { status: 401 });
    if (url.pathname === "/auth/v1/user" && request.method === "GET") return Response.json(f.actor);
    if (request.method !== "GET" || event.profile !== f.profile) throw new Error("Unexpected data request");
    const headers = { "content-profile": f.profile };
    if (url.pathname === "/rest/v1/project_list") {
      return Response.json([f.row], { headers: { ...headers, "content-range": "0-0/1" } });
    }
    if (url.pathname === "/rest/v1/project_detail") {
      return Response.json([], { headers: { ...headers, "content-range": "*/0" } });
    }
    throw new Error("Unexpected Supabase endpoint");
  };
}

async function loopbackPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

// Webpack's development entries must resolve the junction on the same Windows drive.
const temp = await realpath(join(repo, ".."));
const root = await mkdtemp(join(temp, "dream-t356-"));
const app = join(root, "app");
const modules = join(app, "node_modules");
const preload = join(root, "preload.cjs");
const start = join(app, "t356-start.cjs");
const events = join(root, "requests.ndjson");
const archive = join(root, "source.tar");
let linked = false;

async function runNext(variant, test) {
  await writeFile(events, "");
  const port = await loopbackPort();
  const child = spawn(process.execPath, ["--require", preload, start], {
    cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", DREAM_AUTH_MODE: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic_test_client_key",
      DREAM_ALLOWED_EMAILS: actor.email, DREAM_PROJECT_READ_BACKEND: "supabase-https",
      DREAM_PROJECT_HTTPS_REF: ref, DREAM_PROJECT_HTTPS_PROFILE: profile,
      T356_PORT: String(port), T356_EVENTS: events,
      T356_FIXTURE: JSON.stringify({ origin, profile, actor, refreshToken, freshSession, row }),
    },
  });
  let output = "";
  let spawnError;
  child.on("error", error => { spawnError = error; });
  const exited = new Promise(resolve => child.once("close", resolve));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-14000); });
  const http = (path, cookie) => fetch(`http://127.0.0.1:${port}${path}`, {
    headers: cookie ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(60000),
  });
  try {
    for (let attempt = 0; !output.includes("T356 READY"); attempt++) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, "Next exited during startup");
      assert.ok(attempt < 300, "Next did not become ready");
      await delay(100);
    }
    await test(http, async () => (await readFile(events, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
    console.log(`T356 actual Next HTTP passed (${variant})`);
  } catch (error) {
    console.error(output.replaceAll(token, "[fixture token]").replaceAll(oldToken, "[fixture token]"));
    throw error;
  } finally {
    child.kill();
    await exited;
  }
}

async function readList(http, cookie) {
  const response = await http("/api/projects", cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.ok(body.includes(title), body);
  assert.ok(!body.includes(token));
  return response;
}

async function verifyRefresh(http, takeEvents) {
  const response = await readList(http, expiredCookie);
  const cookies = response.headers.getSetCookie().map(value => value.split(";", 1)[0])
    .filter(value => (value.startsWith(`${name}=`) || value.startsWith(`${name}.`)) && !value.endsWith("="));
  assert.ok(cookies.length > 0, "Next did not serialize the refreshed session cookie");
  const cookie = cookies.join("; ");
  const nextResponse = await readList(http, cookie);
  assert.deepEqual(nextResponse.headers.getSetCookie(), []);
  const records = await takeEvents();
  assert.deepEqual(records.filter(event => event.path === "/auth/v1/token").map(event => event.method), ["POST"]);
  assert.equal(records.filter(event => event.path === "/rest/v1/project_list").length, 2);
  assert.ok(records.filter(event => event.path !== "/auth/v1/token").every(event => event.fresh));
  return cookie;
}

try {
  await mkdir(app);
  await exec("git", ["archive", "--format=tar", "-o", archive, "HEAD"], { cwd: repo, env });
  await exec("tar", ["-xf", archive, "-C", app], { env });
  for (const path of ["app/api/projects/route.ts", "app/api/projects/[id]/route.ts", "lib/cloud/project-read-page.ts", "lib/cloud/project-read-request.ts"]) {
    await copyFile(join(repo, path), join(app, path));
  }
  await symlink(join(repo, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
  linked = true;
  await writeFile(preload, `(${mockSupabaseFetch.toString()})();\n`);
  await writeFile(start, `
    const { createServer } = require("node:http");
    const port = Number(process.env.T356_PORT);
    const app = require("next")({ dev: true, dir: process.cwd(), webpack: true, hostname: "127.0.0.1", port });
    app.prepare().then(() => createServer(app.getRequestHandler()).listen(port, "127.0.0.1",
      () => console.log("T356 READY"))).catch(error => { console.error(error); process.exit(1); });
  `);
  await runNext("proxy", async (http, takeEvents) => {
    const cookie = await verifyRefresh(http, takeEvents);
    const detail = await http(`/api/projects/${id}`, cookie);
    assert.equal(detail.status, 404);
    assert.equal(detail.headers.get("cache-control"), "no-store");
    assert.equal((await detail.json()).code, "NOT_FOUND");
    const cloud = await http("/cloud/projects", cookie);
    assert.equal(cloud.status, 200);
    const html = await cloud.text();
    assert.ok(html.includes(title));
    assert.ok(!html.includes(token));
    assert.deepEqual(cloud.headers.getSetCookie(), []);
    const beforeAnonymous = await takeEvents();
    assert.equal(beforeAnonymous.filter(event => event.path === "/auth/v1/token").length, 1);
    assert.equal(beforeAnonymous.filter(event => event.path === "/rest/v1/project_list").length, 3);
    assert.equal(beforeAnonymous.filter(event => event.path === "/rest/v1/project_detail").length, 1);
    const anonymous = await http("/api/projects");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("cache-control"), "no-store");
    assert.equal((await anonymous.json()).code, "AUTH_REQUIRED");
    assert.deepEqual(await takeEvents(), beforeAnonymous);
  });
  await unlink(join(app, "proxy.ts"));
  assert.equal(await realpath(app), join(await realpath(root), "app"));
  await rm(join(app, ".next"), { recursive: true, force: true, maxRetries: 3 });
  await runNext("route", async (http, takeEvents) => {
    await verifyRefresh(http, takeEvents);
  });
} finally {
  if (linked) await unlink(modules);
  const resolved = await realpath(root);
  assert.equal(dirname(resolved), temp);
  assert.ok(basename(resolved).startsWith("dream-t356-"));
  await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}
