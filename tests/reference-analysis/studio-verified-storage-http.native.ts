import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createConnection, createServer as createPortServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import sharp from "sharp";

assert.equal(process.argv.length, 2, "Owned loopback fixture only");
const exec = promisify(execFile);
const workspace = await realpath(process.cwd());
const base = "4f26134";
const temp = join(workspace, "tmp");
await mkdir(temp, { recursive: true });
assert.equal(await realpath(temp), temp); // Keep webpack and its dependency junction on the same volume.
const root = await realpath(await mkdtemp(join(temp, "dream-t305-")));
const sources = join(root, "app-copy");
const workRoot = join(root, "download");
const deps = join(sources, "node_modules");
const pagePath = "/cloud/reference-analysis";
const apiPath = "/api/studio/reference-analysis";
const connection = "lib/reference-analysis/studio-analysis-connection.ts";
const ownerA = "10000000-0000-4000-8000-0000000000a1";
const ownerB = "10000000-0000-4000-8000-0000000000b1";
const invalidResultAsset = "10000000-0000-7000-8000-0000000000f1";
const diagnostic = "t305-f1-private-result-diagnostic";
const storageKey = "t305-fixture-storage-credential";
const anonKey = "t305-fixture-anon-key";
const bucket = "t305-private";
type Entry = Awaited<ReturnType<typeof sample>>;
const records: Entry[] = [];
const visits = { lists: 0, authority: 0, objects: [] as string[] };
const empty = (reason: string) => ({ schemaVersion: 1, status: "unavailable", reason });
let hold: { started: PromiseWithResolvers<void>; closed: PromiseWithResolvers<void>; response?: ServerResponse } | undefined;
let revokeAfterDownload = false;
let next: ChildProcess | undefined;
let output = "";

async function sample(ownerId: string, tail: string, label: string, background: string) {
  const projectId = `10000000-0000-4000-8000-0000000000${tail}2`;
  const assetId = `10000000-0000-7000-8000-0000000000${tail}3`;
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `${ownerId}/assets/${assetId}/${sha256}.png`;
  const selection = { projectId, assetId };
  return { ownerId, label, email: `${tail}@example.invalid`, token: `t305-user-${tail}`, active: true, bytes, objectKey, selection,
    proof: { status: "authorized", ownerId, ...selection, linkActive: true, ownerEnabled: true, scopeEnabled: true,
      storeId: "fixture-store", restoreGeneration: "restore-1", linkGeneration: "1", ownerPermissionGeneration: "1",
      scopePermissionGeneration: "1", sourceGeneration: "source-1", storageGeneration: "1", verifiedStorageGeneration: "1",
      asset: { ownerId, id: assetId, sha256, sizeBytes: bytes.length, kind: "image", mime: "image/png", objectKey } } };
}

const send = (response: ServerResponse, value: unknown, status = 200) =>
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  if (url.pathname === "/auth/v1/user") {
    const user = records.find(record => request.headers.authorization === `Bearer ${record.token}`);
    if (!user) { send(response, { code: "session_not_found" }, 401); return; }
    send(response, { id: user.ownerId, email: user.email, aud: "authenticated" });
    return;
  }
  if (url.pathname.startsWith("/storage/v1/")) {
    if (request.headers.authorization !== `Bearer ${storageKey}` || request.headers.apikey !== storageKey) { send(response, {}, 403); return; }
    if (url.pathname === `/storage/v1/bucket/${bucket}`) { send(response, { id: bucket, name: bucket, public: false }); return; }
    const item = records.find(record => url.pathname === `/storage/v1/object/${bucket}/${record.objectKey}`);
    if (!item) { send(response, {}, 404); return; }
    visits.objects.push(item.ownerId);
    if (revokeAfterDownload) { item.active = false; revokeAfterDownload = false; }
    response.writeHead(200, { "content-length": item.bytes.length }).end(item.bytes);
    return;
  }
  const owned = records.filter(record => record.active && record.ownerId === url.searchParams.get("owner"));
  if (url.pathname === "/fixture/list") {
    visits.lists++;
    send(response, owned.map(record => ({ ownerId: record.ownerId, ...record.selection, label: record.label, registration: "current", analysisAllowed: true })));
  } else if (url.pathname === "/fixture/authority") {
    visits.authority++;
    const control = hold;
    if (control && !control.response && visits.objects.length === 1) {
      control.response = response;
      response.once("close", () => control.closed.resolve());
      control.started.resolve();
      return;
    }
    send(response, owned.find(record => record.selection.projectId === url.searchParams.get("project") &&
      record.selection.assetId === url.searchParams.get("asset"))?.proof ?? null);
  } else send(response, {}, 404);
});

async function listen(listener: typeof server | ReturnType<typeof createPortServer>) {
  await new Promise<void>((ok, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", ok); });
  const address = listener.address();
  assert(address && typeof address !== "string");
  return address.port;
}

function accepting(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result: boolean) => { socket.destroy(); resolve(result); };
    socket.setTimeout(100, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function until(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(35);
  }
  throw new Error("Owned loopback condition timed out");
}

function cookie(entry: Entry) {
  const session = { access_token: entry.token, refresh_token: "synthetic-unused", expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600, token_type: "bearer", user: { id: entry.ownerId, email: entry.email } };
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

async function stop(port: number) {
  const child = next;
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(ok => child.once("exit", () => ok()));
    if (process.platform === "win32") {
      assert(child.pid);
      const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      await exec(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15000 });
    } else child.kill("SIGTERM");
    await exited;
  }
  await until(async () => !await accepting(port));
  next = undefined;
}

const portServer = createPortServer();
let port = 0;
let linked = false;
try {
  records.push(await sample(ownerA, "a", "T305 A 등록 이미지", "#ff0000"), await sample(ownerB, "b", "T305 B 등록 이미지", "#0000ff"));
  const backendPort = await listen(server);
  const backend = `http://127.0.0.1:${backendPort}`;
  port = await listen(portServer);
  await new Promise<void>(ok => portServer.close(() => ok()));
  const origin = `http://127.0.0.1:${port}`;
  await mkdir(sources);
  await mkdir(workRoot);
  const archive = join(root, "head.tar");
  await exec("git", ["archive", "--format=tar", "-o", archive, base], { cwd: workspace, windowsHide: true });
  await exec(process.platform === "win32" ? "tar.exe" : "tar", ["-xf", archive, "-C", sources], { windowsHide: true });
  for (const file of [connection, "lib/reference-analysis/studio-analysis-http.ts", "lib/reference-analysis/studio-analysis-result-dto.ts",
    "components/reference-analysis/studio-registered-analysis-provider.ts"]) {
    await copyFile(join(workspace, file), join(sources, file));
  }
  await symlink(join(workspace, "node_modules"), deps, process.platform === "win32" ? "junction" : "dir");
  linked = true;
  const cleanConnection = await readFile(join(sources, connection), "utf8");
  assert(cleanConnection.includes("export const studioAnalysisConnection = createStudioAnalysisConnection();"));
  const storage = { profile: "synthetic", projectUrl: backend, projectRef: "abcdefghijklmnopqrst", bucket, privateBucket: true,
    credential: { mode: "service-role", key: storageKey }, maxBytes: 1_048_576, timeoutMs: 2500, maxConcurrent: 1, workRoot,
    ffprobePath: join(workspace, ".tools", "ffmpeg", process.platform === "win32" ? "ffprobe.exe" : "ffprobe") };
  const fixtureAuthority = `
import { AsyncLocalStorage } from "node:async_hooks";
import { resolveServerAuth } from "../auth/resolve";
import type { VerifiedActor } from "../db/postgres/types";
import { createIsolatedVerifiedStorageAnalysis } from "./studio-verified-storage-analysis";
const scope = new AsyncLocalStorage<string>();
const backend = ${JSON.stringify(backend)};
const run = createIsolatedVerifiedStorageAnalysis({
  storage: ${JSON.stringify(storage)},
  async resolveAuth() {
    const auth = await resolveServerAuth();
    return auth.kind === "verified" && auth.userId === scope.getStore()
      ? auth : { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
  },
  async readAuthority(actor, selection, signal) {
    const query = new URLSearchParams({ owner: actor.id, project: selection.projectId, asset: selection.assetId });
    const response = await fetch(backend + "/fixture/authority?" + query, { signal, cache: "no-store" });
    return response.json();
  },
});
async function listAnalyzableMaterials(actor: VerifiedActor) {
  const response = await fetch(backend + "/fixture/list?owner=" + actor.id, { cache: "no-store" });
  return response.json();
}
`;
  const allow = new Set(["SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATH", "TEMP", "TMP"]);
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allow.has(key.toUpperCase()))),
    NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", DREAM_AUTH_MODE: "supabase", DREAM_SITE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: backend, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, DREAM_ALLOWED_EMAILS: records.map(record => record.email).join(",") };

  async function start(full: boolean) {
    await writeFile(join(sources, connection), cleanConnection.replace("export const studioAnalysisConnection = createStudioAnalysisConnection();",
      fixtureAuthority + (full ? `export const studioAnalysisConnection = createStudioAnalysisConnection({ listAnalyzableMaterials,
        async analyzeRegisteredSource(actor, selected, signal) {
          if (selected.assetId === ${JSON.stringify(invalidResultAsset)}) return {
            schemaVersion: 1, status: "unavailable", reason: "source_unavailable", diagnostic: ${JSON.stringify(diagnostic)},
          };
          return scope.run(actor.id, () => run(selected, signal));
        } });`
        : "export const studioAnalysisConnection = createStudioAnalysisConnection({ listAnalyzableMaterials });")));
    output = "";
    next = spawn(process.execPath, [join(deps, "next", "dist", "bin", "next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
      { cwd: sources, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const channel of [next.stdout, next.stderr]) channel?.on("data", chunk => { output = (output + String(chunk)).slice(-12000); });
    await until(() => accepting(port), 30_000);
  }

  const page = (entry: Entry) => fetch(origin + pagePath, { headers: { cookie: cookie(entry) }, signal: AbortSignal.timeout(45_000) });
  const post = (entry: Entry, input: unknown = entry.selection, signal?: AbortSignal) => fetch(origin + apiPath, {
    method: "POST", headers: { cookie: cookie(entry), origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: typeof input === "string" ? input : JSON.stringify(input), signal: signal ?? AbortSignal.timeout(45_000),
  });
  const [a, b] = records;

  await start(false);
  const disconnected = await page(a);
  assert.equal(disconnected.status, 200);
  assert.match(await disconnected.text(), /분석 공급자가 아직 연결되지 않았어요/);
  const closed = await post(a);
  assert.equal(closed.status, 503);
  assert.deepEqual(await closed.json(), empty("analysis_unavailable"));
  assert.deepEqual(visits, { lists: 0, authority: 0, objects: [] });
  await stop(port);

  await start(true);
  const anonymous = await fetch(origin + pagePath, { redirect: "manual", signal: AbortSignal.timeout(45_000) });
  assert.equal(anonymous.status, 307);
  for (const [self, other] of [[a, b], [b, a], [a, b]]) {
    const html = await page(self);
    assert.equal(html.status, 200);
    assert.match(html.headers.get("cache-control") ?? "", /no-store/);
    const body = await html.text();
    assert(body.includes(self.label) && !body.includes(other.label));
    const response = await post(self, self.selection);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.status, "ready");
    assert.equal(result.media, "image");
    assert.match(JSON.stringify(result), /creative_proposal/);
    for (const privateValue of [self.objectKey, self.ownerId, self.email, workRoot, self.proof.asset.sha256]) {
      assert(!JSON.stringify(result).includes(privateValue));
    }
  }
  assert.deepEqual(visits.objects, [ownerA, ownerB, ownerA]);
  const crossSite = await fetch(origin + apiPath, { method: "POST", headers: { cookie: cookie(a), origin: "http://invalid.example",
    "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: JSON.stringify(a.selection), signal: AbortSignal.timeout(5000) });
  assert.equal(crossSite.status, 403);
  assert.deepEqual(await (await post(a, b.selection)).json(), empty("source_unavailable"));
  assert.equal((await post(a, JSON.stringify(a.selection).padEnd(1025, " "))).status, 413);
  assert.deepEqual(await (await post(a, { ...a.selection, path: "forged" })).json(), empty("invalid_selection"));
  assert.equal(visits.objects.length, 3);
  const unsafe = await post(a, { ...a.selection, assetId: invalidResultAsset });
  assert.equal(unsafe.status, 503);
  assert.equal(unsafe.headers.get("cache-control"), "no-store");
  const raw = await unsafe.text();
  assert(!raw.includes(diagnostic));
  assert.deepEqual(JSON.parse(raw), empty("analysis_unavailable"));
  assert(!output.includes(diagnostic));
  assert.equal(visits.objects.length, 3);

  revokeAfterDownload = true;
  assert.deepEqual(await (await post(a)).json(), empty("source_unavailable"));
  assert.equal(visits.objects.length, 4);
  assert(!(await (await page(a)).text()).includes(a.label));
  assert.deepEqual(await readdir(workRoot), []);
  a.active = true;

  visits.objects.length = 0;
  const held = { started: Promise.withResolvers<void>(), closed: Promise.withResolvers<void>() };
  hold = held;
  const controller = new AbortController();
  const pending = post(a, a.selection, controller.signal);
  const aborted = assert.rejects(pending, { name: "AbortError" });
  await Promise.race([held.started.promise, pending.then(() => { throw new Error("Analysis completed before cancellation test"); })]);
  assert.equal((await readdir(workRoot)).length, 1);
  controller.abort();
  await aborted;
  await Promise.race([held.closed.promise, delay(5000).then(() => { throw new Error("Authority connection stayed open"); })]);
  hold = undefined;
  await until(async () => (await readdir(workRoot)).length === 0);
  assert.equal((await (await post(a)).json()).status, "ready");
  assert.deepEqual(visits.objects, [ownerA, ownerA]);
  console.log("Actual Next GET and POST: partial configuration, A/B/A, public response validation, single object GET, revocation, abort and cleanup passed");
} catch (error) {
  if (output) console.error(output);
  throw error;
} finally {
  await stop(port);
  if (server.listening) { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); }
  if (linked) { assert((await lstat(deps)).isSymbolicLink()); await rm(deps); }
  const owned = await realpath(root);
  assert.equal(dirname(owned), temp);
  assert(basename(owned).startsWith("dream-t305-"));
  await rm(owned, { recursive: true });
  console.log("Owned Next listener and temporary source removed");
}
