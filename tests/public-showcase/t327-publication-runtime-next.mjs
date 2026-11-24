/* global fetch, AbortSignal */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const [app] = process.argv.slice(2);
assert(app, "usage: node tests/public-showcase/t327-publication-runtime-next.mjs <isolated built app>");
const cover = "/media/public/neon-alley/1/cover.webp";
const actualTitle = "합성 완성본 neon-alley";
const sampleTitle = "NEON AFTER HOURS";
const keep = /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PATHEXT|COMSPEC)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

async function run(mode, verify) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = fork(resolve(app, "node_modules/next/dist/bin/next"), ["start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: app, execArgv: [], silent: true, windowsHide: true,
    env: { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", T327_FIXTURE: mode },
  });
  const exited = once(child, "exit");
  const events = [];
  let log = "";
  child.on("message", name => events.push(name));
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  async function until(predicate, label) {
    for (let tries = 0; tries < 300; tries++) {
      if (predicate()) return;
      assert(child.exitCode === null, `Next exited before ${label}\n${log}`);
      await delay(50);
    }
    assert.fail(`Timed out at ${label}\n${log}`);
  }
  const request = (path, init) => fetch(base + path, { ...init, signal: AbortSignal.timeout(20_000) });
  const command = (command, expectedVersion, generation, origin = base) => request("/api/admin/publications", {
    method: "POST", headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ requestId: randomUUID(), slug: "neon-alley", command, expectedVersion, generation, rightsConfirmed: command !== "revoke" }),
  });
  try {
    await until(() => log.includes("Ready in"), "Next startup");
    assert.deepEqual(events, []);
    assert.equal((await command("prepare", "0", null, "https://example.invalid")).status, 403);
    assert.deepEqual(events, []);
    await verify({ request, command, events, send: message => child.send(message), wait: name => until(() => events.includes(name), name) });
    process.stdout.write(`${mode}: ${events.join(", ")}\n`);
  } finally {
    child.kill();
    await exited;
  }
  await assert.rejects(fetch(base, { signal: AbortSignal.timeout(2_000) }));
}

async function firstRequests({ request }) {
  return Promise.all([
    request("/api/admin/publications?mode=verified"), request("/?mode=verified"),
    request(`${cover}?mode=verified`, { headers: { "x-showcase-mode": "active" } }), request(cover, { method: "HEAD" }),
    request("/admin"),
  ]);
}

async function checkInactive([admin, home, get, head, adminPage]) {
  assert.equal(admin.status, 200);
  assert.deepEqual(await admin.json(), { kind: "closed" });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert(html.includes(sampleTitle) && !html.includes(actualTitle));
  for (const result of [get, head]) {
    assert.equal(result.status, 404);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(await head.text(), "");
  assert.equal(adminPage.status, 200);
  assert((await adminPage.text()).includes("관리자 게시·철회 서버 기능이 아직 연결되지 않았어요"));
}

async function checkClosedWrite(command) {
  const response = await command("prepare", "0", null);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PUBLICATION_UNLINKED");
}

await run("missing", async (client) => {
  await checkInactive(await firstRequests(client));
  await checkClosedWrite(client.command);
  client.send("close");
  await client.wait("closed");
  assert.deepEqual(client.events, ["load", "closed"]);
});

await run("reader-error", async (client) => {
  const initial = firstRequests(client);
  await client.wait("admin-open");
  client.send("release");
  await checkInactive(await initial);
  await checkClosedWrite(client.command);
  client.send("close");
  await client.wait("closed");
  assert.deepEqual(client.events, ["load", "admin-open", "public-open", "admin-close", "closed"]);
});

await run("verified", async (client) => {
  const { request, command, events, send, wait } = client;
  const initial = firstRequests(client);
  await wait("admin-open");
  send("release");
  const [admin, home, get, head, adminPage] = await initial;
  assert.equal((await admin.json()).kind, "ok");
  assert.equal(home.status, 200);
  assert(!((await home.text()).includes(actualTitle)));
  assert.equal(get.status, 404);
  assert.equal(head.status, 404);
  assert.equal(adminPage.status, 200);
  assert((await adminPage.text()).includes(actualTitle));
  assert.deepEqual(events, ["load", "admin-open", "public-open"]);

  const prepare = await command("prepare", "0", null);
  assert.equal((await prepare.json()).status, "prepared");
  const publish = await command("complete", "1", "1");
  assert.equal((await publish.json()).status, "published");
  const [publicHome, publicGet, publicHead] = await Promise.all([request("/"), request(cover), request(cover, { method: "HEAD" })]);
  const html = await publicHome.text();
  assert(html.includes(actualTitle) && html.includes(cover));
  assert.equal(publicHome.headers.get("cache-control")?.includes("no-store"), true);
  assert.equal(publicGet.status, 200);
  assert.equal(publicGet.headers.get("content-type"), "image/webp");
  assert.equal(publicGet.headers.get("cache-control"), "no-store");
  assert.equal(publicHead.status, 200);
  assert.equal(await publicHead.text(), "");

  const revoke = await command("revoke", "2", "1");
  assert.equal((await revoke.json()).status, "revoked");
  assert(!((await (await request("/")).text()).includes(actualTitle)));
  assert.equal((await request(cover)).status, 404);
  assert.equal((await request(cover, { method: "HEAD" })).status, 404);
  send("close");
  await wait("closed");
  await checkInactive(await firstRequests(client));
  await checkClosedWrite(command);
  assert.deepEqual(events, ["load", "admin-open", "public-open", "admin-close", "public-close", "closed"]);
});
