import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
type Connection = import("pg").Client;
type Outcome = { status: string; version?: string; generation?: string };
type Manifest = {
  sourceId: string; sourceRevision: string; sourceSha: string; rightsRef: string;
  coverSha: string; coverBytes: number;
  display: { kind: string; title: string; subtitle: string; creator: string; genre: string;
    format: string; description: string; width: number; height: number };
};
const owner = "10000000-0000-0000-0000-000000000001";
const other = "10000000-0000-0000-0000-000000000002";
const stranger = "10000000-0000-0000-0000-000000000003";
const manifest: Manifest = {
  sourceId: randomUUID(), sourceRevision: "1", sourceSha: "a".repeat(64), rightsRef: "synthetic-rights",
  coverSha: "b".repeat(64), coverBytes: 1024,
  display: { kind: "여행", title: "Synthetic cover", subtitle: "Test preview", creator: "Fixture",
    genre: "Nature", format: "WebP", description: "Synthetic display only", width: 640, height: 480 },
};

async function loopbackPort() {
  const server = createServer();
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok()));
  return address.port;
}

async function assertListenerAbsent(port: number) {
  await new Promise<void>((ok, fail) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(3000, () => socket.destroy(new Error("Loopback shutdown check timed out")));
    socket.once("connect", () => socket.destroy(new Error("Loopback listener remains at the owned port")));
    socket.once("error", (error: NodeJS.ErrnoException) => error.code === "ECONNREFUSED" ? ok() : fail(error));
  });
}

async function main() {
  assert(process.platform === "win32", "This owned-cluster fixture uses Windows PG17 binaries");
  assert(process.argv.length === 4 && process.argv[2] === "--bin" && isAbsolute(process.argv[3]),
    "Supply an absolute local PG17 bin directory with --bin");
  // Sanitize the Node process before loading pg and the environment passed to its child tools.
  for (const name of Object.keys(process.env)) {
    if (/^(PG|NODE_PG_FORCE_NATIVE$)/i.test(name)) delete process.env[name];
  }
  const { Client } = (await import("pg")).default;
  const bin = await realpath(process.argv[3]);
  const env = { ...process.env };
  const tools = ["postgres", "initdb", "pg_ctl"] as const;
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await run(powershell, ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:T253_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Untrusted T253 binary' } }"],
  { env: { ...env, T253_BIN: bin }, timeout: 20000, windowsHide: true });
  const versions = await Promise.all(tools.map(async tool => {
    const { stdout } = await run(join(bin, tool + ".exe"), ["--version"], { env, timeout: 10000, windowsHide: true });
    const version = /\(PostgreSQL\) (17\.\d+)(?:\s|$)/.exec(stdout)?.[1];
    assert(version, "All binaries must be PostgreSQL 17");
    return version;
  }));
  assert(versions.every(version => version === versions[0]), "Mixed PG versions");
  const token = randomUUID().replaceAll("-", "");
  const db = "t253_" + token;
  const tmp = await realpath(resolve("tmp"));
  assert.equal(tmp.toLowerCase(), resolve("tmp").toLowerCase(), "Use the repository's non-linked tmp directory");
  const root = join(tmp, db);
  const data = join(root, "data");
  await mkdir(root);
  const port = await loopbackPort();
  const password = randomBytes(32).toString("hex");
  const passwordFile = join(root, "init-password.txt");
  const sql = await readFile(new URL("./fixtures/postgres/t253-showcase-publication.sql", import.meta.url), "utf8");
  const connections: Connection[] = [];
  let started = false;
  async function local(tool: typeof tools[number], args: string[]) {
    await run(join(bin, tool + ".exe"), args, { env, timeout: 90000, windowsHide: true });
  }
  async function connect(database: string) {
    const client = new Client({ host: "127.0.0.1", port, database, user: "t253_bootstrap", password,
      ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    await client.connect();
    connections.push(client);
    const { rows: [identity] } = await client.query(
      "SELECT current_database() db,current_setting('server_version_num')::integer version,current_setting('data_directory') dir,host(inet_server_addr()) addr,inet_server_port() port,current_setting('transaction_isolation') isolation");
    assert.equal(identity.db, database);
    assert.equal(Math.floor(identity.version / 10000), 17);
    assert.equal((await realpath(identity.dir)).toLowerCase(), (await realpath(data)).toLowerCase());
    assert.equal(identity.addr, "127.0.0.1");
    assert.equal(identity.port, port);
    assert.equal(identity.isolation, "read committed");
    return client;
  }
  const checks: string[] = [];
  const lockWaits: { slug: string; version: string; generation: string; blockerPid: number; waiterPid: number }[] = [];
  async function check(name: string, fn: () => Promise<void>) {
    await fn();
    checks.push(name);
  }
  try {
    await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    try {
      await local("initdb", ["-D", data, "-U", "t253_bootstrap", "--pwfile=" + passwordFile,
        "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
    } finally {
      await rm(passwordFile, { force: true });
    }
    started = true; // A start timeout can still leave our own postmaster running.
    await local("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o",
      `-h 127.0.0.1 -p ${port} -c log_min_error_statement=panic`, "-w", "start"]);
    const bootstrap = await connect("postgres");
    await bootstrap.query(`CREATE DATABASE "${db}"`);
    const admin = await connect(db);
    await check("DDL rollback then install beside a preexisting schema", async () => {
      await admin.query("BEGIN");
      await admin.query(sql);
      assert.notEqual((await admin.query("SELECT to_regnamespace('t253_showcase') AS fixture")).rows[0].fixture, null);
      await admin.query("ROLLBACK");
      assert.equal((await admin.query("SELECT to_regnamespace('t253_showcase') AS fixture")).rows[0].fixture, null);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM pg_roles WHERE rolname IN
        ('t253_list','t253_file','t253_publish','t253_list_owner','t253_file_owner','t253_write_owner')`)).rows[0].n, 0);
      await admin.query("CREATE SCHEMA existing_fixture; CREATE TABLE existing_fixture.keep(id int); INSERT INTO existing_fixture.keep VALUES (17)");
      await admin.query("BEGIN");
      await admin.query(sql);
      await admin.query("COMMIT");
      assert.equal((await admin.query("SELECT id FROM existing_fixture.keep")).rows[0].id, 17);
    });
    await admin.query("INSERT INTO t253_showcase.publishers VALUES ($1),($2)", [owner, other]);
    await admin.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,1,$3,true)", [owner, manifest.sourceId, manifest.sourceSha]);
    const a = await connect(db);
    const b = await connect(db);
    const reader = await connect(db);
    await a.query("SET ROLE t253_publish");
    await b.query("SET ROLE t253_publish");
    async function actor(client: Connection, id: string) {
      await client.query("SELECT set_config('t253.actor',$1,false)", [id]); // Fixed synthetic identity only.
    }
    await actor(a, owner);
    await actor(b, owner);
    const key = () => randomUUID();
    async function apply(client: Connection, action: string, slug: string, version: string,
      generation: string | null = null, payload: Manifest | null = null, id = key()): Promise<Outcome> {
      const { rows } = await client.query(
        "SELECT t253_showcase.apply_command($1,$2,$3,$4,$5,$6) AS value",
        [id, action, slug, version, generation, payload]);
      assert.equal(rows.length, 1);
      return rows[0].value;
    }
    const prepare = (slug: string, version = "0", id = key()) => apply(a, "prepare", slug, version, null, manifest, id);
    const complete = (client: Connection, slug: string, version: string, generation: string, id = key()) =>
      apply(client, "complete", slug, version, generation, manifest, id);
    const revoke = (client: Connection, slug: string, version: string, generation: string, id = key()) =>
      apply(client, "revoke", slug, version, generation, null, id);
    async function list() {
      await reader.query("SET ROLE t253_list");
      return (await reader.query("SELECT t253_showcase.list_approved() AS value")).rows[0].value;
    }
    async function file(slug: string, generation: string) {
      await reader.query("SET ROLE t253_file");
      return (await reader.query("SELECT * FROM t253_showcase.find_cover($1,$2)", [slug, generation])).rows;
    }
    const denied = { code: "42501" };
    const invalid = { code: "22023" };
    await check("isolated roles, exact projection and forced RLS", async () => {
      assert.deepEqual((await list()).rows, []);
      for (const sql of [
        "SELECT * FROM t253_showcase.slots", "SELECT * FROM t253_showcase.source_images",
        "SELECT * FROM t253_showcase.find_cover('example',1)", "DELETE FROM t253_showcase.slots",
        "SELECT t253_showcase.apply_command(NULL,'revoke','example',1,1,NULL)",
      ]) await assert.rejects(reader.query(sql), denied);
      await file("example", "1");
      for (const sql of [
        "SELECT t253_showcase.list_approved()", "SELECT * FROM t253_showcase.requests",
        "SELECT object_key FROM t253_showcase.slots", "UPDATE t253_showcase.slots SET version=0",
        "SELECT t253_showcase.apply_command(NULL,'revoke','example',1,1,NULL)",
      ]) await assert.rejects(reader.query(sql), denied);
      await reader.query("SET ROLE t253_list_owner");
      await assert.rejects(reader.query("SELECT object_key FROM t253_showcase.slots"), denied);
      await reader.query("SET ROLE t253_file_owner");
      await assert.rejects(reader.query("SELECT active_display FROM t253_showcase.slots"), denied);
      await assert.rejects(a.query("SELECT * FROM t253_showcase.slots"), denied);
      await assert.rejects(a.query("SELECT t253_showcase.list_approved()"), denied);
      await assert.rejects(a.query("SELECT * FROM t253_showcase.find_cover('example',1)"), denied);
      for (const role of ["anon", "authenticated", "authenticator"]) {
        await admin.query(`CREATE ROLE ${role} NOLOGIN`);
        await reader.query(`SET ROLE ${role}`);
        await assert.rejects(reader.query("SELECT t253_showcase.list_approved()"), denied);
        await assert.rejects(reader.query("SELECT * FROM t253_showcase.find_cover('example',1)"), denied);
        await assert.rejects(reader.query("SELECT t253_showcase.apply_command(NULL,'revoke','example',1,1,NULL)"), denied);
      }
    });
    await check("publisher allowlist and source ownership", async () => {
      await actor(b, stranger);
      await assert.rejects(apply(b, "prepare", "foreign", "0", null, manifest), denied);
      await actor(b, other);
      assert.equal((await apply(b, "prepare", "foreign", "0", null, manifest)).status, "source-unavailable");
      assert.equal((await admin.query("SELECT count(*)::int n FROM t253_showcase.slots WHERE slug='foreign'")).rows[0].n, 0);
      await actor(b, owner);
      await assert.rejects(apply(a, "prepare", "private", "0", null, manifest), invalid);
    });
    await check("nested display accepts allowed keys and rejects an extra key before mutation", async () => {
      const slug = "display-schema";
      const extraDisplay = { ...manifest, display: { ...manifest.display, extraLabel: "Unexpected" } };
      const invalidDisplay = { code: "22023", message: "invalid manifest bounds" };
      const prepareId = key();
      await assert.rejects(apply(a, "prepare", slug, "0", null, extraDisplay, prepareId), invalidDisplay);
      assert.deepEqual(await prepare(slug, "0", prepareId), { status: "prepared", version: "1", generation: "1" });
      const completeId = key();
      await assert.rejects(apply(b, "complete", slug, "1", "1", extraDisplay, completeId), invalidDisplay);
      assert.deepEqual(await file(slug, "1"), []);
      assert.deepEqual(await complete(b, slug, "1", "1", completeId), { status: "published", version: "2", generation: "1" });
      assert.equal((await file(slug, "1")).length, 1);
      assert.equal((await revoke(a, slug, "2", "1")).status, "revoked");
    });
    await check("same-ID replay, changed fingerprint and exact file/list projections", async () => {
      const prepareId = key();
      const prepared = await prepare("example", "0", prepareId);
      assert.deepEqual(prepared, { status: "prepared", version: "1", generation: "1" });
      assert.deepEqual(await prepare("example", "0", prepareId), prepared);
      for (const changed of [
        { ...manifest, coverSha: "c".repeat(64) }, { ...manifest, rightsRef: "changed" },
        { ...manifest, display: { ...manifest.display, title: "Changed" } },
      ]) await assert.rejects(apply(a, "prepare", "example", "0", null, changed, prepareId), invalid);
      assert.deepEqual(await file("example", "1"), []);
      assert.deepEqual((await list()).rows, []);
      const completeId = key();
      const published = await complete(a, "example", "1", "1", completeId);
      assert.deepEqual(published, { status: "published", version: "2", generation: "1" });
      assert.deepEqual(await complete(b, "example", "1", "1", completeId), published);
      const [image] = await file("example", "1");
      assert.deepEqual(image, { object_key: "example/1/" + manifest.coverSha + ".webp",
        mime: "image/webp", size_bytes: 1024, sha: manifest.coverSha });
      const { rows } = await list();
      assert.deepEqual(Object.keys(rows[0]).sort(), ["approvedMs", "display", "generation", "slug"]);
      assert.deepEqual(rows[0].display, manifest.display);
      assert.match(rows[0].approvedMs, /^\d+$/);
      await actor(b, other);
      assert.equal((await revoke(b, "example", "2", "1")).status, "conflict");
      assert.equal((await file("example", "1")).length, 1);
      await actor(b, owner);
    });
    const blockerPid = (await a.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    const waiterPid = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    assert.notEqual(blockerPid, waiterPid);
    async function observePrepared(client: Connection, slug: string) {
      // Test-only inspection on each physical connection before restoring its publish role.
      await client.query("RESET ROLE");
      try {
        const { rows } = await client.query(
          "SELECT version::text,pending_generation::text,active_generation::text FROM t253_showcase.slots WHERE slug=$1", [slug]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].active_generation, null);
        return { version: String(rows[0].version), generation: String(rows[0].pending_generation) };
      } finally {
        await client.query("SET ROLE t253_publish");
      }
    }
    type Observation = { version: string; generation: string };
    async function race(slug: string, first: (seen: Observation) => Promise<Outcome>,
      second: (seen: Observation) => Promise<Outcome>,
      firstStatus: string, secondStatus: string) {
      const [firstSeen, secondSeen] = await Promise.all([observePrepared(a, slug), observePrepared(b, slug)]);
      assert.deepEqual(firstSeen, { version: "1", generation: "1" });
      assert.deepEqual(firstSeen, secondSeen);
      await a.query("BEGIN");
      let waiter: Promise<Outcome> | undefined;
      try {
        assert.equal((await first(firstSeen)).status, firstStatus);
        waiter = second(secondSeen);
        // Attach a rejection handler before polling so an early failure cannot go unhandled.
        void waiter.catch(() => {});
        let blocked = false;
        for (let i = 0; i < 80 && !blocked; i++) {
          blocked = (await admin.query("SELECT $1::integer = ANY(pg_blocking_pids($2)) AS blocked",
            [blockerPid, waiterPid])).rows[0].blocked;
          if (!blocked) await setTimeout(25);
        }
        assert(blocked, "Second physical connection must wait on the first");
        lockWaits.push({ slug, ...secondSeen, blockerPid, waiterPid });
        await a.query("COMMIT");
        assert.equal((await waiter).status, secondStatus);
      } finally {
        await a.query("ROLLBACK");
        await waiter?.catch(() => {});
      }
    }
    await check("prepared then revoke first, delayed completion stays private", async () => {
      assert.equal((await prepare("revoked-first")).status, "prepared");
      await race("revoked-first", seen => revoke(a, "revoked-first", seen.version, seen.generation),
        seen => complete(b, "revoked-first", seen.version, seen.generation), "revoked", "conflict");
      assert.deepEqual(await file("revoked-first", "1"), []);
      assert(!(await list()).rows.some((row: { slug: string }) => row.slug === "revoked-first"));
    });
    await check("completion first, same observation can revoke that generation and replay cannot reopen", async () => {
      await prepare("published-first");
      const id = key();
      const revokeId = key();
      await race("published-first", seen => complete(a, "published-first", seen.version, seen.generation, id),
        seen => revoke(b, "published-first", seen.version, seen.generation, revokeId), "published", "revoked");
      assert.deepEqual(await revoke(b, "published-first", "1", "1", revokeId),
        { status: "revoked", version: "3", generation: "1" });
      await assert.rejects(revoke(b, "published-first", "2", "2", revokeId), invalid);
      assert.equal((await complete(b, "published-first", "1", "1", id)).status, "published");
      assert.deepEqual(await file("published-first", "1"), []);
      assert(!(await list()).rows.some((row: { slug: string }) => row.slug === "published-first"));
    });
    await check("replacement is atomic and versions do not reuse URLs", async () => {
      assert.equal((await prepare("example", "2")).generation, "3");
      assert.equal((await file("example", "1")).length, 1);
      assert.deepEqual(await file("example", "3"), []);
      assert.equal((await complete(a, "example", "3", "3")).status, "published");
      assert.deepEqual(await file("example", "1"), []);
      assert.equal((await file("example", "3")).length, 1);
      const staleId = key();
      assert.deepEqual(await revoke(a, "example", "2", "1", staleId), { status: "conflict" });
      assert.deepEqual(await revoke(b, "example", "2", "1", staleId), { status: "conflict" });
      assert.equal((await file("example", "3")).length, 1);
      assert.equal((await list()).rows.find((row: { slug: string }) => row.slug === "example").generation, "3");
    });
    await check("plain pending revoke and mixed-state direct RLS under function owners", async () => {
      await prepare("pending-control");
      const id = key();
      assert.equal((await revoke(a, "pending-control", "1", "1", id)).status, "revoked");
      assert.equal((await revoke(b, "pending-control", "1", "1", id)).status, "revoked");
      assert.deepEqual(await file("pending-control", "1"), []);
      assert.equal((await prepare("pending-control", "2")).generation, "3");
      const states = (await admin.query(`SELECT slug,active_generation::text AS active,pending_generation::text AS pending
        FROM t253_showcase.slots WHERE slug IN ('example','pending-control','published-first') ORDER BY slug`)).rows;
      assert.deepEqual(states, [
        { slug: "example", active: "3", pending: null },
        { slug: "pending-control", active: null, pending: "3" },
        { slug: "published-first", active: null, pending: null },
      ]);
      for (const [role, column] of [["t253_list_owner", "active_display"], ["t253_file_owner", "object_key"]]) {
        await reader.query(`SET ROLE ${role}`);
        // No active filter in this statement: the policy itself must hide both inactive states.
        assert.deepEqual((await reader.query(`SELECT slug,${column} FROM t253_showcase.slots`)).rows.map(row => row.slug), ["example"]);
      }
      assert.deepEqual((await list()).rows.map((row: { slug: string }) => row.slug), ["example"]);
      assert.deepEqual(await file("pending-control", "3"), []);
    });
    await check("catalog confirms FORCE RLS, function ownership, and role separation", async () => {
      const relations = (await admin.query(`SELECT relname,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) owner
        FROM pg_class WHERE relnamespace='t253_showcase'::regnamespace AND relkind='r' ORDER BY relname`)).rows;
      assert.deepEqual(relations.map(row => row.relname), ["publishers", "requests", "slots", "source_images"]);
      assert(relations.every(row => row.relrowsecurity && row.relforcerowsecurity && row.owner === "t253_bootstrap"));
      const functions = (await admin.query(`SELECT proname,prosecdef,pg_get_userbyid(proowner) owner
        FROM pg_proc WHERE pronamespace='t253_showcase'::regnamespace ORDER BY proname`)).rows;
      assert.deepEqual(functions, [
        { proname: "apply_command", prosecdef: true, owner: "t253_write_owner" },
        { proname: "find_cover", prosecdef: true, owner: "t253_file_owner" },
        { proname: "list_approved", prosecdef: true, owner: "t253_list_owner" },
      ]);
      const roles = (await admin.query(`SELECT oid,rolname,rolcanlogin,rolbypassrls,rolsuper,rolcreaterole,rolcreatedb,rolreplication
        FROM pg_roles WHERE rolname IN ('t253_list','t253_file','t253_publish','t253_list_owner','t253_file_owner','t253_write_owner')`)).rows;
      assert.equal(roles.length, 6);
      assert(roles.every(r => !r.rolcanlogin && !r.rolbypassrls && !r.rolsuper && !r.rolcreaterole && !r.rolcreatedb && !r.rolreplication));
      const members = (await admin.query("SELECT * FROM pg_auth_members WHERE roleid=ANY($1::oid[]) OR member=ANY($1::oid[])",
        [roles.map(role => role.oid)])).rows;
      assert.deepEqual(members, []);
      await revoke(a, "example", "4", "3");
    });
    await check("revocation preserves a different pending or active generation", async () => {
      await prepare("overlap");
      await complete(a, "overlap", "1", "1");
      await prepare("overlap", "2");
      assert.equal((await revoke(a, "overlap", "3", "3")).status, "revoked");
      assert.equal((await file("overlap", "1")).length, 1);
      assert.equal((await complete(b, "overlap", "3", "3")).status, "conflict");
      assert.equal((await prepare("overlap", "4")).generation, "5");
      assert.equal((await revoke(a, "overlap", "5", "1")).status, "revoked");
      assert.deepEqual(await file("overlap", "1"), []);
      assert.equal((await complete(b, "overlap", "5", "5")).status, "published");
      assert.equal((await file("overlap", "5")).length, 1);
      await revoke(a, "overlap", "7", "5");
    });
    await check("changed source revision, SHA or completion status blocks activation", async () => {
      await prepare("changed-source");
      for (const change of [
        { revision: "2", sha: manifest.sourceSha, finished: true },
        { revision: "1", sha: "d".repeat(64), finished: true },
        { revision: "1", sha: manifest.sourceSha, finished: false },
      ]) {
        await admin.query("UPDATE t253_showcase.source_images SET revision=$1,sha=$2,finished=$3 WHERE owner_id=$4 AND source_id=$5",
          [change.revision, change.sha, change.finished, owner, manifest.sourceId]);
        assert.equal((await complete(b, "changed-source", "1", "1")).status, "source-unavailable");
        assert.deepEqual(await file("changed-source", "1"), []);
      }
      await admin.query("UPDATE t253_showcase.source_images SET finished=true WHERE owner_id=$1 AND source_id=$2", [owner, manifest.sourceId]);
      await revoke(a, "changed-source", "1", "1");
    });
    await check("rollback clears reservation and ledger together", async () => {
      const id = key();
      await a.query("BEGIN");
      assert.equal((await prepare("rollback", "0", id)).status, "prepared");
      await a.query("ROLLBACK");
      assert.equal((await admin.query("SELECT count(*)::int n FROM t253_showcase.requests WHERE request_id=$1", [id])).rows[0].n, 0);
      assert.equal((await admin.query("SELECT count(*)::int n FROM t253_showcase.slots WHERE slug='rollback'")).rows[0].n, 0);
      assert.equal((await prepare("rollback", "0", id)).generation, "1");
    });
    await check("epoch millisecond and ASCII sort with 25-row bound", async () => {
      const slugs = [...Array.from({ length: 23 }, (_, i) => `item-${String(i).padStart(2, "0")}`), "z-0", "z00", "z01"];
      for (const [i, slug] of slugs.toReversed().entries()) {
        await admin.query(`INSERT INTO t253_showcase.slots
          (slug,owner_id,version,active_generation,active_display,approved_ms,object_key,mime,size_bytes,sha)
          VALUES ($1,$2,1,1,$3,floor(extract(epoch FROM $5::timestamptz)*1000)::bigint,'synthetic.webp','image/webp',1024,$4)`,
        [slug, owner, manifest.display, manifest.coverSha, i % 2 ? "2024-01-01T00:00:00.123999Z" : "2024-01-01T00:00:00.123001Z"]);
      }
      const { nowMs, rows } = await list();
      assert.match(nowMs, /^\d+$/);
      assert.deepEqual(rows.map((row: { slug: string }) => row.slug), slugs.slice(0, 25));
      assert(rows.every((row: { approvedMs: string }) => row.approvedMs === "1704067200123"));
    });
  } finally {
    await Promise.allSettled(connections.map(client => client.end()));
    if (started) {
      const pidFile = join(data, "postmaster.pid");
      const pid = await readFile(pidFile, "utf8").catch(error => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (pid) {
        const lines = pid.split(/\r?\n/);
        assert.equal((await realpath(lines[1])).toLowerCase(), (await realpath(data)).toLowerCase());
        assert.equal(lines[3], String(port));
        await local("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
      }
      await assert.rejects(readFile(pidFile), { code: "ENOENT" });
      await assertListenerAbsent(port);
      await writeFile(join(root, "cleanup.json"), JSON.stringify({
        fixture: db, port, postmasterPidFileAbsent: true, loopbackConnectResult: "ECONNREFUSED",
      }, null, 2));
    }
  }
  const result = { postgres: versions[0], database: db, port, checks, lockWaits,
    sqlSha256: createHash("sha256").update(sql).digest("hex"),
    postmasterPidFileAbsent: true, loopbackConnectResult: "ECONNREFUSED" };
  await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "T253 unknown failure");
  process.exitCode = 1;
});
