import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Client } from "pg";
import sharp from "sharp";
import { fetchApprovedSnapshot } from "../../lib/public-showcase/showcase-source";
import { serveCover } from "../../lib/public-showcase/cover-source";
import { coverPath } from "../../lib/public-showcase/cover-path";
import { openIsolatedPublicationPublicReader } from "../../lib/public-showcase/publication-public-reader";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "win32");
assert.equal(process.argv.length, 2, "Only the fixed loopback PG17 fixture is supported");
const exec = promisify(execFile);
const keep = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "TEMP", "TMP"]);
const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key.toUpperCase()))), NODE_ENV: "test" };
for (const key of Object.keys(process.env)) {
  if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$|NEXT_PUBLIC_SUPABASE)/i.test(key)) delete process.env[key];
}
const { Client: PgClient } = (await import("pg")).default;
assert(process.env.SystemRoot);
const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const bin = fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin", import.meta.url));
const samePath = (first: string, second: string) => first.replaceAll("/", "\\").toLowerCase() === second.replaceAll("/", "\\").toLowerCase();
assert(samePath(await realpath(bin), bin));
function ps(script: string, values: Record<string, string>) {
  return exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script],
    { env: { ...env, ...values }, windowsHide: true, timeout: 25_000 });
}
const tools = (tool: string, args: string[], timeout = 30_000) => exec(join(bin, tool + ".exe"), args, { env, windowsHide: true, timeout });
for (const tool of ["postgres", "initdb", "pg_ctl"]) {
  const path = join(bin, tool + ".exe");
  assert(samePath(await realpath(path), path));
  await ps("$sig=Get-AuthenticodeSignature -LiteralPath $env:T298_TOOL; if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected binary signature' }", { T298_TOOL: path });
  assert.match((await tools(tool, ["--version"])).stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const sqlFiles = ["../fixtures/postgres/t253-showcase-publication.sql", "t293-admin-publication.sql", "t295-publication-rights.sql"];
const [t253, t293, candidate] = await Promise.all(sqlFiles.map(async file =>
  (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n")));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
assert.equal(hash(t253), "7b9a252ec3093df0c7e7b900555d081baa1e5a5a8a20a2f18ce27c7c03f2b46c");
assert.equal(hash(t293), "4c855c28d42b42f74283ed452e23f801bb23ac377723f2987a1a0ab81002f7ea");
assert.equal(hash(candidate), "9577cb43749f5edbd3cd1bafe774b3af5d88f10d1623c29f728d0ed18eb08216");
const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#485c61" } }).webp().toBuffer();
const sha = hash(image);
const ownerA = "10000000-0000-4000-8000-0000000000a1";

const db = "t253_" + randomUUID().replaceAll("-", "");
const bootstrap = "t293_bootstrap";
const password = randomBytes(32).toString("hex");
const listener = createServer();
await new Promise<void>((ok, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", ok); });
const address = listener.address();
assert(address && typeof address !== "string");
const { port } = address;
await new Promise<void>((ok, fail) => listener.close(error => error ? fail(error) : ok()));
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t298-"));
const data = join(root, "cluster");
const passfile = join(root, "bootstrap-password");
const clients = new Set<Client>();
let startAttempted = false;

async function start() {
  const log = await open(join(root, "startup.log"), "wx");
  try {
    const launcher = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(root, "postgres.log"), "-o",
      `-h 127.0.0.1 -p ${port} -c log_min_error_statement=panic`, "-w", "-t", "30", "start"],
    { env, windowsHide: true, stdio: ["ignore", log.fd, log.fd], timeout: 40_000 });
    await new Promise<void>((ok, fail) => {
      launcher.once("error", fail);
      launcher.once("exit", code => code === 0 ? ok() : fail(new Error("Owned PG17 start failed")));
    });
  } finally { await log.close(); }
}

async function checkListener() {
  const [pid, dir, , actualPort] = (await readFile(join(data, "postmaster.pid"), "utf8")).split(/\r?\n/);
  assert(samePath(dir, data) && Number(actualPort) === port && /^[1-9][0-9]*$/.test(pid));
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T298_PID)
  $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T298_PORT) -ErrorAction SilentlyContinue)
  if (!$p -or $p.ExecutablePath -ine $env:T298_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T298_DATA) -or
      $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T298_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T298_PID: pid, T298_PORT: String(port), T298_PG: join(bin, "postgres.exe"), T298_DATA: data });
}

async function connect(user = bootstrap, secret = password, database = db) {
  const client = new PgClient({ host: "127.0.0.1", port, database, user, password: secret, ssl: false,
    connectionTimeoutMillis: 5000, statement_timeout: 12_000 });
  await client.connect();
  clients.add(client);
  assert.deepEqual((await client.query(`SELECT current_database() db,current_setting('server_version_num') version,
    host(inet_server_addr()) host,inet_server_port() port,session_user login`)).rows[0],
  { db: database, version: "170012", host: "127.0.0.1", port, login: user });
  return client;
}

async function seed(admin: Client, slug: string, owner = ownerA) {
  const sourceId = randomUUID();
  const manifest = { sourceId, sourceRevision: "1", sourceSha: "a".repeat(64), rightsRef: "fixture-rights", coverSha: sha,
    coverBytes: image.length, display: { kind: "광고", title: slug, subtitle: "Synthetic only", creator: "Fixture",
      genre: "Design", format: "WebP", description: "Synthetic work", width: 8, height: 6 } };
  await admin.query("INSERT INTO t293.works VALUES($1,$2,$3)", [owner, slug, { ownerId: owner, slug }]);
  await admin.query("INSERT INTO t253_showcase.source_images VALUES($1,$2,1,$3,true)", [owner, sourceId, manifest.sourceSha]);
  return manifest;
}

async function verify(admin: Client, observer: Client, writer: Client, logins: Map<string, string>) {
  type Hold = { slug: string; arrivals: number; target: number; entered: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> };
  let hold: Hold | undefined;
  let reads = 0;
  let storage: "ready" | "unavailable" | "corrupt" = "ready";
  const listPassword = logins.get("t295_read_list")!;
  const filePassword = logins.get("t295_read_file")!;
  const options = { profile: "t295-loopback-fixture" as const, database: db, port, listPassword, filePassword, timeoutMs: 700,
    async readPrivateCover(key: string, { maxBytes, signal }: { maxBytes: number; signal: AbortSignal }) {
      signal.throwIfAborted();
      assert(key.endsWith(`${sha}.webp`));
      assert.equal(maxBytes, image.length);
      reads++;
      const blocked = hold;
      if (blocked && key.startsWith(`${blocked.slug}/`)) {
        if (++blocked.arrivals === blocked.target) blocked.entered.resolve();
        await blocked.release.promise;
        signal.throwIfAborted();
      }
      if (storage === "unavailable") throw new Error("internal private storage failure");
      const data = Buffer.from(image);
      if (storage === "corrupt") data[data.length - 1] ^= 1;
      return data;
    },
  };
  const inactive = await openIsolatedPublicationPublicReader({ ...options, listPassword: filePassword });
  assert.equal(inactive.showcaseSource.mode, "sample");
  assert.equal(inactive.coverSource.mode, "inactive");
  await admin.query("GRANT t295_file TO t295_read_list");
  try {
    const broadened = await openIsolatedPublicationPublicReader(options);
    assert.equal(broadened.showcaseSource.mode, "sample");
    assert.equal(broadened.coverSource.mode, "inactive");
  } finally { await admin.query("REVOKE t295_file FROM t295_read_list"); }

  const readers = await openIsolatedPublicationPublicReader(options);
  assert(readers.showcaseSource.mode === "active" && readers.showcaseSource.store);
  assert(readers.coverSource.mode === "active" && readers.coverSource.store);
  const list = readers.showcaseSource.store;
  const file = readers.coverSource.store;
  const caller = () => new AbortController().signal;
  const keys = (slug: string, generation: string) => `${slug}/${generation}/${sha}.webp`;
  const feed = async () => (await fetchApprovedSnapshot(list)).ids;
  const cover = (slug: string, generation: string, method = "GET") =>
    serveCover(new Request(`http://fixture.invalid${coverPath({ slug, generation })}`, { method }), readers.coverSource);
  const connectionState = async () => (await observer.query<{ pid: number; application_name: string }>(`SELECT pid,application_name
    FROM pg_stat_activity WHERE application_name IN ('t298-t295_read_list','t298-t295_read_file') ORDER BY application_name,pid`)).rows;

  async function write(command: "prepare" | "complete" | "revoke", slug: string, version: string, generation: string | null, ref: string | null) {
    await writer.query("BEGIN");
    try {
      await writer.query("SELECT set_config('t293.actor',$1,true)", [ownerA]);
      const { rows } = await writer.query<{ result: { status: string } }>("SELECT t295.apply($1,$2,$3,$4,$5,$6) result",
        [randomUUID(), command, slug, version, generation, ref]);
      await writer.query("COMMIT");
      assert.equal(rows[0].result.status, { prepare: "prepared", complete: "published", revoke: "revoked" }[command]);
    } catch (error) { await writer.query("ROLLBACK"); throw error; }
  }

  async function grant(slug: string, manifest: Awaited<ReturnType<typeof seed>>, expiry: string | null) {
    await admin.query("INSERT INTO t295.attestations VALUES($1,$2,$3,$4,$5,$6)",
      [ownerA, slug, manifest.rightsRef, manifest, expiry === null ? "perpetual" : "timed", expiry]);
  }

  try {
    const permanent = await seed(admin, "persistent");
    await grant("persistent", permanent, null);
    await write("prepare", "persistent", "0", null, permanent.rightsRef);
    await write("complete", "persistent", "1", "1", null);
    const timed = await seed(admin, "expires");
    const cutoff = (await admin.query<{ expiry: string }>("SELECT (clock_timestamp()+interval '3 seconds')::text AS expiry")).rows[0].expiry;
    await grant("expires", timed, cutoff);
    await write("prepare", "expires", "0", null, timed.rightsRef);
    await write("complete", "expires", "1", "1", null);
    assert.deepEqual(new Set(await feed()), new Set(["persistent", "expires"]));
    const response = await cover("expires", "1");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    assert.equal((await cover("expires", "1", "HEAD")).status, 200);
    const reused = await connectionState();
    assert.equal(reused.length, 2);
    assert.notEqual(reused[0].pid, reused[1].pid);
    await admin.query("SELECT pg_sleep_until($1::timestamptz+interval '5 milliseconds')", [cutoff]);
    assert.deepEqual(await feed(), ["persistent"]);
    assert.equal((await cover("expires", "1")).status, 404);
    assert.deepEqual(await connectionState(), reused);
    const before = reads;
    await assert.rejects(file.readObject(keys("expires", "1"), { maxBytes: image.length, signal: caller() }), { code: "permission" });
    assert.equal(reads, before);

    await write("revoke", "persistent", "2", "1", null);
    assert.deepEqual(await feed(), []);
    assert.equal((await cover("persistent", "1")).status, 404);
    await write("prepare", "persistent", "3", null, permanent.rightsRef);
    await write("complete", "persistent", "4", "4", null);
    assert.equal((await cover("persistent", "1")).status, 404);
    assert.equal((await cover("persistent", "4")).status, 200);
    for (const failure of ["unavailable", "corrupt"] as const) {
      storage = failure;
      const failed = await cover("persistent", "4");
      assert.equal(failed.status, 503);
      assert.equal(await failed.text(), "Service Unavailable");
    }
    storage = "ready";

    async function waitOnReadLock(role: "list" | "file") {
      for (let attempt = 0; attempt < 80; attempt++) {
        if ((await observer.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [`t298-t295_read_${role}`])).rowCount) return;
        await delay(5);
      }
      throw new Error("Expected blocked reader not observed");
    }
    for (const abort of [true, false]) {
      await admin.query("BEGIN");
      try {
        await admin.query("LOCK TABLE t253_showcase.slots IN ACCESS EXCLUSIVE MODE");
        const ctrl = new AbortController();
        const pending = assert.rejects(list.listApproved(ctrl.signal), { code: "timeout" });
        await waitOnReadLock("list");
        if (abort) ctrl.abort();
        await pending;
      } finally { await admin.query("ROLLBACK"); }
      assert.deepEqual(await feed(), ["persistent"]);
    }
    console.log("T295 roles, pooled fresh visibility, expiry/revoke generations, private bytes and cancelled/deadline reads passed");

    const raceReaders = await openIsolatedPublicationPublicReader({ ...options, timeoutMs: 5000 });
    assert(raceReaders.coverSource.mode === "active");
    async function heldResponses(slug: string, change: () => Promise<void>) {
      const blocked = { slug, arrivals: 0, target: 2, entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      hold = blocked;
      const requests = ["GET", "HEAD"].map(method => serveCover(new Request(`http://fixture.invalid${coverPath({ slug, generation: "1" })}`,
        { method }), raceReaders.coverSource));
      try {
        assert.equal(await Promise.race([blocked.entered.promise.then(() => "held"), ...requests.map(request => request.then(response => response.status))]), "held");
        await change();
      } finally { hold = undefined; blocked.release.resolve(); }
      for (const response of await Promise.all(requests)) {
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("content-type"), null);
        assert.equal(response.headers.get("content-length"), null);
        assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
    }
    try {
      const heldExpiry = await seed(admin, "held-expiry");
      const until = (await admin.query<{ expiry: string }>("SELECT (clock_timestamp()+interval '2 seconds')::text AS expiry")).rows[0].expiry;
      await grant("held-expiry", heldExpiry, until);
      await write("prepare", "held-expiry", "0", null, heldExpiry.rightsRef);
      await write("complete", "held-expiry", "1", "1", null);
      await heldResponses("held-expiry", async () => { await admin.query("SELECT pg_sleep_until($1::timestamptz+interval '5 milliseconds')", [until]); });

      const heldRevoke = await seed(admin, "held-revoke");
      await grant("held-revoke", heldRevoke, null);
      await write("prepare", "held-revoke", "0", null, heldRevoke.rightsRef);
      await write("complete", "held-revoke", "1", "1", null);
      await heldResponses("held-revoke", () => write("revoke", "held-revoke", "2", "1", null));

      const heldReplace = await seed(admin, "held-replace");
      await grant("held-replace", heldReplace, null);
      await write("prepare", "held-replace", "0", null, heldReplace.rightsRef);
      await write("complete", "held-replace", "1", "1", null);
      await write("prepare", "held-replace", "2", null, heldReplace.rightsRef);
      await heldResponses("held-replace", () => write("complete", "held-replace", "3", "3", null));
      assert.equal((await cover("held-replace", "3")).status, 200);
      console.log("Held GET and HEAD responses hid all bytes and image headers after expiry, revocation and replacement");

      for (const cancel of [true, false]) {
        const slug = "held-replace";
        const blocked = { slug, arrivals: 0, target: 1, entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
        const controller = new AbortController();
        hold = blocked;
        const pending = serveCover(new Request(`http://fixture.invalid${coverPath({ slug, generation: "3" })}`, { signal: controller.signal }),
          raceReaders.coverSource, 1200);
        try {
          assert.equal(await Promise.race([blocked.entered.promise.then(() => "held"), pending.then(response => response.status)]), "held");
          await admin.query("BEGIN");
          try {
            await admin.query("LOCK TABLE t253_showcase.slots IN ACCESS EXCLUSIVE MODE");
            blocked.release.resolve();
            await waitOnReadLock("file");
            if (cancel) controller.abort();
            const response = await pending;
            assert.equal(response.status, 503);
            assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
            assert.equal(response.headers.get("content-length"), null);
            assert.equal(await response.text(), "Service Unavailable");
          } finally { await admin.query("ROLLBACK"); }
        } finally { hold = undefined; blocked.release.resolve(); }
      }
      assert.equal((await cover("held-replace", "3")).status, 200);
      console.log("Actual PG17 final guard lock cancellation and deadline returned safe errors");
    } finally { await raceReaders.close(); }
  } finally { await readers.close(); }
}

try {
  await writeFile(passfile, password, { flag: "wx", mode: 0o600 });
  try { await tools("initdb", ["-D", data, "-U", bootstrap, "--pwfile=" + passfile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], 120_000); }
  finally { await unlink(passfile); }
  startAttempted = true;
  await start();
  await checkListener();
  const system = await connect(bootstrap, password, "postgres");
  assert(samePath((await system.query("SHOW data_directory")).rows[0].data_directory, data));
  await system.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
  const admin = await connect();
  await admin.query("BEGIN");
  for (const sql of [t253, t293, candidate]) await admin.query(sql);
  const logins = new Map<string, string>();
  for (const [user, role] of [["t293_actor_a", "t293_app"], ["t295_read_list", "t295_list"], ["t295_read_file", "t295_file"]]) {
    const secret = randomBytes(24).toString("hex");
    await admin.query(`CREATE ROLE ${user} LOGIN INHERIT NOBYPASSRLS PASSWORD '${secret}'; GRANT ${role} TO ${user}`);
    logins.set(user, secret);
  }
  await admin.query("INSERT INTO t253_showcase.publishers VALUES($1)", [ownerA]);
  await admin.query("COMMIT");
  await verify(admin, await connect(), await connect("t293_actor_a", logins.get("t293_actor_a")!), logins);
} finally {
  await Promise.allSettled([...clients].map(client => client.end()));
  const pidfile = join(data, "postmaster.pid");
  const exists = await access(pidfile).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
  if (startAttempted && exists) {
    await checkListener();
    await tools("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
  }
  await assert.rejects(access(pidfile), { code: "ENOENT" });
  if (startAttempted) await ps("if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T298_PORT) -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Unexpected leftover listener' }", { T298_PORT: String(port) });
  const cleanup = await realpath(root);
  assert(samePath(dirname(cleanup), temp) && basename(cleanup).startsWith("dream-t298-"));
  await rm(cleanup, { recursive: true, force: false });
  console.log("Owned PG17 listener and temporary cluster removed");
}
