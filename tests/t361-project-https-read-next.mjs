/* global AbortSignal, Buffer, Headers, Request, Response, URL, console, fetch, process, require */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createSocket } from "node:net";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive)$/i.test(key)));
const host = "127.0.0.1";
const ref = "q361syntheticlocalxx";
const appOrigin = `https://${ref}.supabase.co`;
const profile = "project_read";
const publicKey = "sb_publishable_t361_synthetic_test_client";
const t356Commit = "633c10b1948dd364cbb977f7e8269d0a9b23979b";
const allowedViews = new Set(["/rest/v1/project_list", "/rest/v1/project_detail"]);

// In the isolated Next child, replace only the transport for this canonical
// synthetic origin. It is never resolved or contacted. The socket destination
// is fixed to the test listener and the TLS peer must match its own certificate.
function installLoopbackTransport() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { request } = require("node:https");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs");
  const { source, app, port, cert } = JSON.parse(process.env.T361_TRANSPORT);
  const ca = readFileSync(cert);
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === app) return original(input, init);
    if (url.origin !== source) return Promise.reject(new Error("Unexpected outbound fetch in T361 Next"));
    const incoming = new Request(input, init);
    if (incoming.method !== "GET") return Promise.reject(new Error("Unexpected upstream method in T361 Next"));
    return new Promise((resolve, reject) => {
      const outbound = request({
        hostname: "127.0.0.1", port, ca, rejectUnauthorized: true, minVersion: "TLSv1.2", agent: false,
        method: "GET", path: url.pathname + url.search, headers: Object.fromEntries(incoming.headers),
        signal: AbortSignal.any([incoming.signal, AbortSignal.timeout(15000)]),
      }, response => {
        const parts = [];
        response.on("data", part => parts.push(part));
        response.once("error", reject);
        response.once("end", () => {
          const headers = new Headers();
          for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          resolve(new Response(Buffer.concat(parts), { status: response.statusCode, headers }));
        });
      });
      outbound.once("error", reject);
      outbound.end();
    });
  };
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, host, resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function portAvailable(port) {
  const socket = createSocket();
  await listen(socket, port);
  await close(socket);
}

async function ephemeralPort() {
  const socket = createSocket();
  const port = await listen(socket);
  await close(socket);
  return port;
}

function actors(fixture) {
  return [fixture.ids.a, fixture.ids.b].map((id, index) => {
    const email = `t361-owner-${index}@example.invalid`;
    const token = fixture.sign(id, appOrigin + "/auth/v1");
    const user = { id, email, aud: "authenticated", role: "authenticated" };
    const session = {
      access_token: token, refresh_token: "t361-unused-synthetic-refresh", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 900, expires_in: 900, user,
    };
    return { user, token, cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` };
  });
}

function createGateway(tls, postgrest, users, events, errors, scenario) {
  const origin = new URL(postgrest);
  assert.equal(origin.protocol, "http:");
  assert.equal(origin.hostname, host);
  assert.equal(origin.pathname, "/");
  assert.ok(origin.port && !origin.search && !origin.hash && !origin.username && !origin.password);
  const gateway = createHttpsServer(tls, async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, host);
      assert.match(request.socket.getProtocol(), /^TLSv1\.[23]$/);
      const url = new URL(request.url, "https://loopback.invalid");
      assert.equal(url.origin, "https://loopback.invalid");
      assert.equal(request.method, "GET");
      assert.equal(request.headers.apikey, publicKey);
      const actor = users.find(({ token }) => request.headers.authorization === `Bearer ${token}`);
      if (url.pathname === "/auth/v1/user" && !url.search) {
        const user = scenario?.authUser?.(actor?.user, request.headers) ?? actor?.user;
        const result = Response.json(user ?? { message: "Unknown synthetic session" }, { status: user ? 200 : 401 });
        events.push({ kind: "auth", actor: actor?.user.id, returned: user?.id, status: result.status });
        response.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      assert.ok(allowedViews.has(url.pathname));
      assert.ok(actor);
      assert.ok((scenario?.profiles ?? [profile]).includes(request.headers["accept-profile"]));
      assert.equal(request.headers.prefer, "count=exact");
      const target = new URL(url.pathname.slice("/rest/v1".length) + url.search, origin);
      assert.equal(target.origin, origin.origin);
      const upstream = await scenario?.dataResponse?.(target) ?? await fetch(target, {
        headers: { authorization: request.headers.authorization, "accept-profile": request.headers["accept-profile"], prefer: request.headers.prefer },
        redirect: "error", signal: AbortSignal.timeout(8000),
      });
      const headers = {};
      for (const key of ["content-type", "content-profile", "content-range", "cache-control"]) {
        if (upstream.headers.has(key)) headers[key] = upstream.headers.get(key);
      }
      scenario?.dataHeaders?.(headers);
      const body = Buffer.from(await upstream.arrayBuffer());
      const failureCode = upstream.status === 406 ? JSON.parse(body.toString("utf8")).code : undefined;
      events.push({ kind: "data", actor: actor.user.id, status: upstream.status, path: target.pathname,
        range: headers["content-range"], profile: headers["content-profile"], failureCode });
      response.writeHead(upstream.status, headers).end(body);
    } catch (error) {
      errors.push(error);
      response.writeHead(502, { "content-type": "application/json" }).end("{}");
    }
  });
  return gateway;
}

async function runNext(paths, tlsPort, users, backend, test, settings = {}) {
  const port = await ephemeralPort();
  const app = `http://${host}:${port}`;
  const child = spawn(process.execPath, ["--require", paths.preload, paths.start], {
    cwd: paths.app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: appOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
      DREAM_ALLOWED_EMAILS: users.map(({ user }) => user.email).join(","), DREAM_PROJECT_READ_BACKEND: backend,
      ...(backend === "supabase-https" && { DREAM_PROJECT_HTTPS_REF: ref, DREAM_PROJECT_HTTPS_PROFILE: profile }),
      ...settings,
      T361_APP_PORT: String(port), T361_TRANSPORT: JSON.stringify({ source: appOrigin, app, port: tlsPort, cert: paths.cert }),
    },
  });
  let output = "";
  let spawnError;
  child.once("error", error => { spawnError = error; });
  const exited = new Promise(resolve => child.once("close", resolve));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-14000); });
  try {
    for (let attempt = 0; !output.includes("T361 READY"); attempt++) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, "Next exited before startup");
      assert.ok(attempt < 300, "Next startup timed out");
      await delay(100);
    }
    await test((path, actor, init) => fetch(app + path, {
      ...init, headers: { ...init?.headers, ...(actor && { cookie: actor.cookie }) },
      redirect: "manual", signal: AbortSignal.timeout(60000),
    }), app);
  } catch (error) {
    for (const actor of users) output = output.replaceAll(actor.token, "[synthetic token]").replaceAll(actor.cookie, "[synthetic cookie]");
    console.error(output);
    throw error;
  } finally {
    child.kill();
    await exited;
    await portAvailable(port);
  }
}

async function api(http, path, actor, status, code) {
  const response = await http(path, actor);
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get("cache-control"), "no-store", path);
  const body = await response.text();
  if (actor) assert.ok(!body.includes(actor.token), "credential leaked into API response");
  const json = JSON.parse(body);
  if (code) assert.equal(json.code, code, path);
  return json;
}

const orderedStates = ({ states, ...row }) => ({
  ...row, states: [...states].sort((left, right) => left.stage.localeCompare(right.stage)),
});
const dataOnly = events => events.filter(event => event.kind === "data");
const readEvidence = (events, actor, path, range) => assert.ok(dataOnly(events).some(event =>
  event.status === 200 && event.path === path && event.actor === actor.user.id && event.profile === profile && event.range === range));

async function html(http, path, actor) {
  const response = await http(path, actor);
  assert.equal(response.status, 200, path);
  const text = await response.text();
  assert.ok(!text.includes(actor.token), "credential leaked into rendered HTML");
  return text;
}

async function verifyEnabled(http, users, fixture, events) {
  const [alice, bob] = users;
  const { first, second, another, archived } = fixture.ids;
  const listPath = "/api/projects";
  const detailPath = id => `${listPath}/${id}`;
  const readList = who => api(http, listPath, who, 200);
  const readDetail = (who, id) => api(http, detailPath(id), who, 200);

  const before = dataOnly(events).length;
  await api(http, listPath, undefined, 401, "AUTH_REQUIRED");
  assert.equal(dataOnly(events).length, before);
  for (const [actor, owned] of [[alice, [first]], [bob, [another, second]]]) {
    const list = await readList(actor);
    assert.deepEqual(list.map(item => item.id), owned);
    const existing = await fixture.readBaseline(actor.user.id);
    assert.equal(existing.status, 200);
    assert.deepEqual(list.map(orderedStates), existing.body.map(orderedStates));
    for (const id of owned) {
      const detail = await readDetail(actor, id);
      const reference = await fixture.readBaseline(actor.user.id, id);
      assert.equal(reference.status, 200);
      assert.deepEqual(orderedStates(detail), orderedStates(reference.body));
    }
  }
  for (const [actor, id] of [[alice, second], [alice, archived], [bob, first]]) {
    await api(http, detailPath(id), actor, 404, "NOT_FOUND");
  }
  readEvidence(events, alice, "/project_list", "0-0/1");
  readEvidence(events, bob, "/project_list", "0-1/2");
  readEvidence(events, alice, "/project_detail", "0-0/1");
  readEvidence(events, bob, "/project_detail", "*/0");
  const shownForA = await html(http, "/cloud/projects", alice);
  assert.ok(shownForA.includes("T358 existing writer after install") && !shownForA.includes("Fixture 1") && !shownForA.includes("Fixture 2"));
  assert.ok((await html(http, `/cloud/projects/${second}`, bob)).includes("Fixture 1"));
  for (const [actor, count] of [[alice, 1], [bob, 2]]) {
    const manage = await html(http, "/cloud/manage", actor);
    assert.match(manage, new RegExp(`표시 목록 <strong[^>]*>${count}(?:<!-- -->)?개</strong>`));
  }

  await fixture.update();
  assert.equal((await readList(alice))[0].title, "T361 updated in existing writer");
  assert.deepEqual((await readList(bob)).map(orderedStates), (await fixture.readBaseline(bob.user.id)).body.map(orderedStates));
  const beforeRevoke = events.length;
  await fixture.revoke();
  assert.deepEqual(await readList(alice), []);
  await api(http, detailPath(first), alice, 404, "NOT_FOUND");
  assert.deepEqual((await readList(bob)).map(item => item.id), [another, second]);
  assert.ok((await html(http, "/cloud/manage", alice)).includes("이번에 불러온 목록에 프로젝트가 없어요."));
  readEvidence(events.slice(beforeRevoke), alice, "/project_list", "*/0");
  readEvidence(events.slice(beforeRevoke), alice, "/project_detail", "*/0");
  assert.ok(events.slice(beforeRevoke).some(event => event.kind === "auth" && event.actor === alice.user.id && event.status === 200));
  await fixture.reapprove();
  assert.deepEqual((await readList(alice)).map(item => item.id), [first]);
  await fixture.remove();
  const beforeFailure = events.length;
  await api(http, listPath, bob, 503, "PROJECT_READ_UNAVAILABLE");
  assert.ok(dataOnly(events.slice(beforeFailure)).some(event => event.status >= 400));
  console.log("T361 Next and HTTPS gateway: native DTO and headers, A/B isolation, revocation, existing writes and dropped-schema 503 passed");
}

export async function verifyStack(fixture, scenario) {
  assert.equal(ref.length, 20);
  const temp = await realpath(join(repo, "..")); // Next's Windows junction must stay on the same drive.
  const root = await mkdtemp(join(temp, "dream-t361-"));
  const app = join(root, "app");
  const paths = { app, cert: join(root, "loopback.pem"), preload: join(root, "transport.cjs"), start: join(app, "t361-start.cjs") };
  const key = join(root, "loopback-key.pem");
  const sslConfig = join(root, "req.cnf");
  const archive = join(root, "source.tar");
  const modules = join(app, "node_modules");
  const events = [];
  const errors = [];
  let gateway;
  let tlsPort;
  let linked = false;
  try {
    await mkdir(app);
    await exec("git", ["archive", "--format=tar", "-o", archive, scenario?.commit ?? t356Commit], { cwd: repo, env });
    await exec("tar", ["-xf", archive, "-C", app], { env });
    await scenario?.prepareApp(app);
    await symlink(join(repo, "node_modules"), modules, "junction");
    linked = true;
    await writeFile(paths.preload, `(${installLoopbackTransport.toString()})();\n`);
    await writeFile(paths.start, `
      const { createServer } = require("node:http");
      const port = Number(process.env.T361_APP_PORT);
      const app = require("next")({ dev: true, dir: process.cwd(), webpack: true, hostname: "127.0.0.1", port });
      app.prepare().then(() => createServer(app.getRequestHandler()).listen(port, "127.0.0.1",
        () => console.log("T361 READY"))).catch(error => { console.error(error); process.exit(1); });
    `);
    assert.ok(process.env.ProgramFiles);
    const openssl = join(process.env.ProgramFiles, "Git", "usr", "bin", "openssl.exe");
    await writeFile(sslConfig, "[req]\ndistinguished_name=dn\n[dn]\n");
    await exec(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "1", "-config", sslConfig,
      "-subj", "/CN=T361 owned loopback", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", paths.cert],
    { env, windowsHide: true, timeout: 10000 });
    const users = actors(fixture);
    gateway = createGateway({ cert: await readFile(paths.cert), key: await readFile(key), minVersion: "TLSv1.2" },
      fixture.origin, users, events, errors, scenario);
    tlsPort = await listen(gateway);
    await assert.rejects(fetch(`https://${host}:${tlsPort}/auth/v1/user`, { signal: AbortSignal.timeout(5000) }),
      error => error.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT");
    const start = (backend, test, settings) => runNext(paths, tlsPort, users, backend, test, settings);
    if (scenario) {
      await scenario.verify({ start, users, fixture, events });
      await fixture.remove();
    } else {
      await start("supabase-https", http => verifyEnabled(http, users, fixture, events));
      await start("disabled", async http => {
        const before = events.length;
        await api(http, "/api/projects", users[1], 503, "PROJECT_READ_UNAVAILABLE");
        await api(http, `/api/projects/${fixture.ids.second}`, users[1], 503, "PROJECT_READ_UNAVAILABLE");
        assert.ok((await html(http, "/cloud/manage", users[1])).includes("관리 정보를 불러오지 못했어요"));
        assert.equal(dataOnly(events.slice(before)).length, 0);
        assert.ok(events.slice(before).some(event => event.kind === "auth" && event.status === 200));
      });
      console.log("T361 product disabled: API 503/no-store and cloud unavailable with zero Data API requests passed");
    }
    assert.deepEqual(errors, []);
  } finally {
    if (gateway?.listening) {
      await close(gateway);
      await portAvailable(tlsPort);
    }
    if (linked) await unlink(modules);
    const resolved = await realpath(root);
    assert.equal(dirname(resolved), temp);
    assert.ok(basename(resolved).startsWith("dream-t361-"));
    await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
