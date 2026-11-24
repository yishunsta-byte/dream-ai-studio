/* global AbortSignal, Buffer, URL, fetch, process, console */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { enableOwnedReadTls } from "./private-project-reopen-http.mjs";

const run = promisify(execFile);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const listen = server => new Promise((done, reject) => server.once("error", reject).listen(0, "127.0.0.1", done));
const close = server => new Promise(done => { server.closeAllConnections(); server.close(done); });

async function withNext(app, env, check) {
  const child = spawn(process.execPath, ["start.cjs"], { cwd: app, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((done, reject) => { child.once("close", done); child.once("error", reject); });
  let ready;
  let log = "";
  child.stdout.on("data", data => {
    log = (log + data).slice(-4000);
    ready ??= log.match(/QUEUE READY (\d+)/)?.[1];
  });
  child.stderr.resume();
  try {
    for (let i = 0; !ready && i < 400 && child.exitCode === null; i++) await delay(100);
    assert.ok(ready, "Isolated Next server failed to start");
    await check("http://127.0.0.1:" + ready);
  } finally { child.kill(); await exited; }
}

export async function verifyAdminQueueHttp({ admin, cfg, a, b, worker, first, foreign, dbState, before }) {
  const users = new Map();
  function session(id, email) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = "header." + Buffer.from(JSON.stringify({ sub: id, exp })).toString("base64url") + "." + randomBytes(16).toString("hex");
    const user = { id, email, role: "authenticated", aud: "authenticated" };
    users.set("Bearer " + token, user);
    return "sb-127-auth-token=base64-" + Buffer.from(JSON.stringify({
      access_token: token, refresh_token: "local-refresh", token_type: "bearer", expires_at: exp, user,
    })).toString("base64url");
  }
  const auth = createServer((request, response) => {
    const user = request.url === "/auth/v1/user" ? users.get(request.headers.authorization) : undefined;
    response.writeHead(user ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify(user ?? { message: "unauthorized" }));
  });
  const parent = await realpath(join(repo, ".."));
  const root = await mkdtemp(join(parent, "dream-admin-queue-http-"));
  const app = join(root, "app"), modules = join(app, "node_modules");
  let linked = false;
  try {
    await listen(auth);
    await mkdir(app);
    const archive = join(root, "source.tar");
    await run("git", ["archive", "--format=tar", "-o", archive, "HEAD"], { cwd: repo });
    await run("tar", ["-xf", archive, "-C", app]);
    const browser = process.env.ADMIN_CONSOLE_VERIFY_BROWSER === "1";
    const queueBrowser = process.env.ADMIN_QUEUE_VERIFY_BROWSER === "1";
    const paths = ["app/api/admin/render-queue/route.ts", "lib/services/postgres/admin-render-queue-http.ts"];
    if (browser) paths.push("components/admin/admin-hub.tsx", "components/admin/admin-navigation.tsx",
      "components/admin/admin-projects.tsx", "components/admin/admin-project-console.tsx",
      "components/admin/admin.module.css", "components/cloud/project-detail-readonly.tsx",
      "components/cloud/admin-project-heading-focus.tsx");
    if (queueBrowser) paths.push("components/admin/admin-hub.tsx", "components/admin/admin-navigation.tsx",
      "components/admin/admin-render-queue.tsx", "components/admin/admin.module.css");
    for (const file of new Set(paths)) {
      await mkdir(dirname(join(app, file)), { recursive: true });
      await copyFile(join(repo, file), join(app, file));
    }
    await symlink(join(repo, "node_modules"), modules, "junction");
    linked = true;
    await writeFile(join(app, "start.cjs"), `
      const next=require("next")({dev:true,webpack:true,hostname:"127.0.0.1"});
      next.prepare().then(()=>{const server=require("node:http").createServer(next.getRequestHandler());
        server.listen(0,"127.0.0.1",()=>console.log("QUEUE READY "+server.address().port));});
    `);
    const tls = await enableOwnedReadTls(admin, cfg, root);
    const dsn = new URL(tls.DATABASE_URL);
    dsn.username = "admin_queue_test_login";
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive)$/i.test(name))),
      NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", DREAM_AUTH_MODE: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + auth.address().port, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic",
      DREAM_ALLOWED_EMAILS: "allowed@example.invalid", DREAM_PROJECT_READ_BACKEND: "postgres" };
    const owner = session(a.id, "allowed@example.invalid"), other = session(b.id, "allowed@example.invalid");
    const denied = session(a.id, "denied@example.invalid"), empty = session(worker.id, "allowed@example.invalid");
    async function get(origin, cookie, status, suffix = "") {
      const response = await fetch(origin + "/api/admin/render-queue" + suffix,
        { headers: cookie ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, status, await response.clone().text());
      // The existing proxy may return the denied response before the route is reached.
      assert.match(response.headers.get("cache-control"), status >= 400 && status <= 403 ? /no-store/ : /^private, no-store$/);
      return response.json();
    }
    const verifyQueueBrowser = queueBrowser
      ? (await import("../admin/admin-render-queue-browser.mjs")).verifyAdminRenderQueueBrowser
      : null;
    await withNext(app, env, async origin => {
      assert.equal((await get(origin, null, 401)).code, "AUTH_REQUIRED");
      assert.equal((await get(origin, denied, 403)).code, "AUTH_FORBIDDEN");
      assert.equal((await get(origin, owner, 503)).code, "ADMIN_RENDER_QUEUE_UNAVAILABLE");
      await verifyQueueBrowser?.({ admin, origin, root, owner, other, empty, denied, connected: false });
    });
    await withNext(app, { ...env, ...tls, DATABASE_URL: dsn.href }, async origin => {
      assert.deepEqual(await get(origin, owner, 200, "?ownerId=" + b.id), first.body);
      assert.deepEqual((await get(origin, other, 200)).jobs.map(job => job.jobId), [foreign.id]);
      assert.deepEqual(await get(origin, empty, 200), { jobs: [] });
      const post = await fetch(origin + "/api/admin/render-queue", { method: "POST", headers: { cookie: owner } });
      assert.equal(post.status, 405);
      const { rows } = await admin.query(`SELECT ssl FROM pg_stat_ssl s JOIN pg_stat_activity a USING(pid)
        WHERE a.usename='admin_queue_test_login' AND a.application_name='dream-backend'`);
      assert.ok(rows.length && rows.every(row => row.ssl));
      await verifyQueueBrowser?.({ admin, origin, root, owner, other, empty, denied, connected: true });
    });
    assert.deepEqual(await dbState(), before);
    console.log("Admin render queue HTTP: 401/403/503/200, TLS, owner scope, empty, and zero writes passed");
    if (browser) {
      const { verifyAdminConsole } = await import("../admin/admin-console-browser.mjs");
      await withNext(app, { ...env, ...tls, DATABASE_URL: dsn.href }, async origin => {
        await verifyAdminConsole({ admin, actor: a, origin, root, cookie: owner });
        const missing = await fetch(origin + "/cloud/projects/018fe8cc-32ba-705b-88ac-451e22b9efcc#admin-project-heading",
          { headers: { cookie: owner } });
        assert.equal(missing.status, 404);
      });
    }
  } finally {
    await close(auth);
    if (linked) await unlink(modules);
    const owned = await realpath(root);
    assert.equal(dirname(owned), parent);
    assert.ok(basename(owned).startsWith("dream-admin-queue-http-"));
    await rm(owned, { recursive: true, force: true, maxRetries: 4 });
  }
}
