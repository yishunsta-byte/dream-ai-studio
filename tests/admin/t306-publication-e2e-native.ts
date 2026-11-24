import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Client } from "pg";
import sharp from "sharp";

// T306 관리자 게시 → 공개 홈 → 철회 종단 시험의 DB 실행기(시험 전용).
// 본인 소유 루프백 PG17 임시 클러스터에 고정 해시의 T253·T293·T295 SQL을 원문 그대로 적용하고, 합성 작품·권리·원본·표지를 넣는다.
// 격리 Next 사본은 이 실행기가 쓴 설정 파일(T306_CONFIG)로 같은 DB에 붙는다. 실행기는 루프백 조작 창구를 열고,
// T326: 서버 모드 제어 창구 POST /cover?slug=&generation= 은 재게시용 세대별 합성 표지를 준비한다.
// POST /done을 받거나 30분이 지나면 Next 연결을 끊은 뒤 클러스터·리스너·임시 폴더를 지운다.
// 실행: node --conditions=react-server --import tsx tests/admin/t306-publication-e2e-native.ts [--scenarios]
//   인자 없음: 격리 Next 사본용 DB 서버 모드. --scenarios: T306-F1 권리 대조 시나리오를 실제 서비스+저장소로 실행하고 끝낸다.
//   --cover-check: T326-F1 세대별 합성 표지 준비(/cover와 같은 함수)의 병렬·다른 바이트 보존·오류 뒤 연결 회귀를 실행하고 끝낸다.
assert.equal(process.platform, "win32");
const mode = process.argv[2] ?? "server";
assert(process.argv.length <= 3 && (mode === "server" || mode === "--scenarios" || mode === "--cover-check"), "Only the fixed loopback PG17 fixture is supported");
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
  await ps("$sig=Get-AuthenticodeSignature -LiteralPath $env:T306_TOOL; if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected binary signature' }", { T306_TOOL: path });
  assert.match((await tools(tool, ["--version"])).stdout.trim(), /\(PostgreSQL\) 17\.12$/);
}

const sqlFiles = ["../fixtures/postgres/t253-showcase-publication.sql", "../public-showcase/t293-admin-publication.sql", "../public-showcase/t295-publication-rights.sql"];
const [t253, t293, t295] = await Promise.all(sqlFiles.map(async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replaceAll("\r\n", "\n")));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
assert.equal(hash(t253), "7b9a252ec3093df0c7e7b900555d081baa1e5a5a8a20a2f18ce27c7c03f2b46c");
assert.equal(hash(t293), "4c855c28d42b42f74283ed452e23f801bb23ac377723f2987a1a0ab81002f7ea");
assert.equal(hash(t295), "9577cb43749f5edbd3cd1bafe774b3af5d88f10d1623c29f728d0ed18eb08216");

const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#2a8c7a" } }).webp().toBuffer();
const sha = hash(image);
const ownerA = "10000000-0000-4000-8000-0000000000a1"; // t293.actor()가 t293_actor_a 로그인에 고정한 값
const ownerB = "10000000-0000-4000-8000-0000000000b1";
const db = "t253_" + randomUUID().replaceAll("-", "");
const bootstrap = "t293_bootstrap";
const password = randomBytes(32).toString("hex");
async function freePort() {
  const listener = createServer();
  await new Promise<void>((ok, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", ok); });
  const address = listener.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((ok, fail) => listener.close((error) => error ? fail(error) : ok()));
  return address.port;
}
const port = await freePort();
const temp = await realpath(tmpdir());
const root = await mkdtemp(join(temp, "dream-t306-"));
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
      launcher.once("exit", (code) => code === 0 ? ok() : fail(new Error("Owned PG17 start failed")));
    });
  } finally { await log.close(); }
}
async function checkListener() {
  const [pid, dir, , actualPort] = (await readFile(join(data, "postmaster.pid"), "utf8")).split(/\r?\n/);
  assert(samePath(dir, data) && Number(actualPort) === port && /^[1-9][0-9]*$/.test(pid));
  await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T306_PID)
  $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T306_PORT) -ErrorAction SilentlyContinue)
  if (!$p -or $p.ExecutablePath -ine $env:T306_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T306_DATA) -or
      $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T306_PID -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'Listener ownership failed' }`,
  { T306_PID: pid, T306_PORT: String(port), T306_PG: join(bin, "postgres.exe"), T306_DATA: data });
}
async function connect(user = bootstrap, secret = password, database = db) {
  const client = new PgClient({ host: "127.0.0.1", port, database, user, password: secret, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 12_000 });
  await client.connect();
  clients.add(client);
  assert.deepEqual((await client.query(`SELECT current_database() db,current_setting('server_version_num') version,
    host(inet_server_addr()) host,inet_server_port() port,session_user login`)).rows[0],
  { db: database, version: "170012", host: "127.0.0.1", port, login: user });
  return client;
}

// T306-F1 fixture 전용 읽기 함수(공유 SQL 파일은 그대로). 기존 t295_writer 권한(본인 행 정책 writer_scope)으로
// 같은 세대의 고정 manifest·활성 권리를 읽기만 한다. 쓰기 권한·다른 소유자 행·공개 리더 함수는 주지 않는다.
// 종료 시각은 extract(epoch)(PG17에서 numeric, 정확한 10진)×1000으로 ms를 만들고, 자투리 µs가 있으면 "frac:"로 돌려준다.
// T326 · T326-F1: 재게시용 세대별 합성 표지 준비(/cover 제어 창구와 --cover-check가 같은 함수를 쓴다).
// - 시드 slug만, "안전한 다음 세대"(준비 중이면 그 세대, 아니면 리비전+1, 2 이상)만 허용한다.
// - 객체 키·바이트는 이 실행기의 합성 표지(image·sha)로만 만든다. 요청에서 키·바이트를 받지 않는다.
// - 요청마다 전용 연결 하나에서 한 트랜잭션: 작품 행 FOR UPDATE → 표지 행 INSERT … ON CONFLICT DO NOTHING → 저장된 바이트 비교 →
//   같으면 재사용, 다르면 보존하고 409 롤백 → 증빙 cover.objectKey 갱신 → COMMIT. 연결은 성공·실패와 상관없이 닫는다.
//   (공유 admin 연결에 BEGIN을 걸던 T326 구현은 동시 요청이 한 세션 트랜잭션에 섞였다: T326-R F326-1)
const seededSlugs = new Set(["neon-alley", "timed-coast", "drift-dune", "b-harbor"]);
async function prepareCover(slug: string, generationText: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!seededSlugs.has(slug) || !/^[1-9][0-9]{0,8}$/.test(generationText)) return { status: 400, body: { error: "invalid slug or generation" } };
  const generation = Number(generationText);
  const client = await connect();
  try {
    await client.query("BEGIN");
    try {
      const { rows: [work] } = await client.query("SELECT owner_id::text AS owner, state FROM t293.works WHERE slug=$1 FOR UPDATE", [slug]);
      const pending = work?.state?.review?.generation;
      const allowed = pending != null ? Number(pending) : Number(work?.state?.revision) + 1;
      if (!work || generation < 2 || generation !== allowed) {
        await client.query("ROLLBACK");
        return { status: 409, body: { error: "generation is not the safe next generation", allowed } };
      }
      const objectKey = `${slug}/${generation}/${sha}.webp`;
      const inserted = await client.query("INSERT INTO t293.cover_objects VALUES($1,$2,$3) ON CONFLICT (owner_id, object_key) DO NOTHING",
        [work.owner, objectKey, image]);
      const { rows: [stored] } = await client.query("SELECT bytes FROM t293.cover_objects WHERE owner_id=$1 AND object_key=$2", [work.owner, objectKey]);
      if (!stored || !Buffer.from(stored.bytes).equals(image)) {
        await client.query("ROLLBACK");
        return { status: 409, body: { error: "different bytes already stored; preserved" } };
      }
      await client.query("UPDATE t293.evidence SET value=jsonb_set(value,'{cover,objectKey}',to_jsonb($3::text)) WHERE owner_id=$1 AND slug=$2",
        [work.owner, slug, objectKey]);
      await client.query("COMMIT");
      return { status: 200, body: { slug, generation, objectKey, reused: inserted.rowCount === 0 } };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    clients.delete(client);
    await client.end();
  }
}

const t306Sql = `
CREATE SCHEMA t306;
REVOKE ALL ON SCHEMA t306 FROM PUBLIC;
GRANT USAGE ON SCHEMA t306 TO t293_app;
CREATE FUNCTION t306.exact_ms(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN ms = trunc(ms) THEN trunc(ms)::bigint::text ELSE 'frac:' || ms::text END
  FROM (SELECT extract(epoch FROM value) * 1000 AS ms) x
$$;
CREATE FUNCTION t306.rights_state(target_slug text, target_generation bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT jsonb_build_object(
    'frozen', (SELECT jsonb_build_object('rights_ref', m.rights_ref, 'manifest', m.manifest, 'mode', m.mode, 'expires_ms', t306.exact_ms(m.expires_at))
      FROM t295.frozen_manifest m WHERE m.owner_id = t293.actor() AND m.slug = target_slug AND m.generation = target_generation),
    'activation', (SELECT jsonb_build_object('rights_ref', a.rights_ref, 'mode', a.mode, 'expires_ms', t306.exact_ms(a.expires_at),
        'approved_ms', a.approved_ms::text)
      FROM t295.activation a WHERE a.owner_id = t293.actor() AND a.slug = target_slug AND a.generation = target_generation))
$$;
ALTER FUNCTION t306.rights_state(text,bigint) OWNER TO t295_writer;
REVOKE ALL ON FUNCTION t306.rights_state(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t306.rights_state(text,bigint) TO t293_app;
GRANT USAGE ON SCHEMA t306 TO t295_writer;
GRANT EXECUTE ON FUNCTION t306.exact_ms(timestamptz) TO t295_writer;
`;

const display = (title: string) => ({ kind: "광고", title, subtitle: "합성 시험 작품", creator: "합성 작업실", genre: "디자인",
  format: "이미지", description: "격리 종단 시험용 합성 완성본이에요.", width: 8, height: 6 });
type SeedOptions = { evidenceMs?: number | null; attestation?: string | null; manifest?: Record<string, unknown> };
async function seed(admin: Client, owner: string, slug: string, title: string, options: SeedOptions = {}) {
  const workId = randomUUID();
  const artifactId = randomUUID();
  const sourceSha = "a".repeat(64);
  const proof = { ownerId: owner, workId, artifactId, artifactRevision: "1", sourceSha };
  const rightsRef = `t306-${slug}`;
  const work = { id: workId, ownerId: owner, slug, revision: "0", media: "image",
    artifact: { id: artifactId, revision: "1", sha: sourceSha, status: "complete" }, display: display(title), review: null, active: null };
  const manifest = { sourceId: artifactId, sourceRevision: "1", sourceSha, rightsRef, coverSha: sha, coverBytes: image.length, display: display(title) };
  const objectKey = `${slug}/1/${sha}.webp`;
  await admin.query("INSERT INTO t293.works VALUES($1,$2,$3)", [owner, slug, work]);
  await admin.query("INSERT INTO t253_showcase.source_images VALUES($1,$2,1,$3,true)", [owner, artifactId, sourceSha]);
  const attestation = options.attestation ?? null; // ISO 문자열(µs까지 정확히 파싱) 또는 null=무기한
  await admin.query("INSERT INTO t295.attestations VALUES($1,$2,$3,$4,$5,$6::timestamptz)",
    [owner, slug, rightsRef, { ...manifest, ...options.manifest }, attestation === null ? "perpetual" : "timed", attestation]);
  await admin.query("INSERT INTO t293.evidence VALUES($1,$2,$3)", [owner, slug, {
    source: { ...proof, status: "complete" },
    rights: { ...proof, status: "confirmed", scope: "public_showcase", reference: rightsRef, expiresAtMs: options.evidenceMs ?? null },
    cover: { ...proof, status: "verified", mime: "image/webp", sha, sizeBytes: image.length, width: 8, height: 6, objectKey },
  }]);
  await admin.query("INSERT INTO t293.cover_objects VALUES($1,$2,$3)", [owner, objectKey, image]);
}

// 기존 역할 우회가 없는지: 공개 읽기 로그인은 쓰기 불가, 계정 로그인은 공개 읽기 함수·남의 작품 불가.
async function roleChecks(logins: Map<string, string>) {
  const login = async (name: string) => { const secret = logins.get(name); assert(secret); return connect(name, secret); };
  const [a, b, list, file] = await Promise.all([login("t293_actor_a"), login("t293_actor_b"), login("t295_read_list"), login("t295_read_file")]);
  const code = async (client: Client, sql: string, args: unknown[] = []) => {
    try { await client.query(sql, args); return "ok"; } catch (error) { return (error as { code?: string }).code ?? "error"; }
  };
  const results = {
    listApply: await code(list, "SELECT t295.apply(gen_random_uuid(),'prepare','neon-alley',0,NULL,'x')"),
    fileList: await code(file, "SELECT t295.list_approved()"),
    listFind: await code(list, "SELECT * FROM t295.find_cover('neon-alley',1)"),
    listLegacy: await code(list, "SELECT t253_showcase.list_approved()"),
    actorList: await code(a, "SELECT t295.list_approved()"),
    actorWriteActivation: await code(a, "INSERT INTO t295.activation VALUES($1,'neon-alley',9,1,'x','perpetual',NULL)", [ownerA]),
    bTouchesA: await (async () => {
      await b.query("BEGIN"); await b.query("SELECT set_config('t293.actor',$1,true)", [ownerB]);
      const result = await code(b, "SELECT t295.apply(gen_random_uuid(),'prepare','neon-alley',0,NULL,'t306-neon-alley')");
      await b.query("ROLLBACK"); return result;
    })(),
    bReadsA: (await (async () => {
      await b.query("BEGIN"); await b.query("SELECT set_config('t293.actor',$1,true)", [ownerB]);
      const rows = (await b.query("SELECT slug FROM t293.works")).rows.map((row) => row.slug);
      await b.query("ROLLBACK"); return rows;
    })()),
  };
  await Promise.all([a, b, list, file].map(async (client) => { clients.delete(client); await client.end(); }));
  return results;
}

let adminTail: Promise<void> = Promise.resolve();
function acquireAdmin(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const ready = adminTail.then(() => release);
  adminTail = adminTail.then(() => next);
  return ready;
}

let finish!: () => void;
const finished = new Promise<void>((resolve) => { finish = resolve; });
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
  for (const sql of [t253, t293, t295, t306Sql]) await admin.query(sql);
  const users = [["t293_actor_a", "t293_app"], ["t293_actor_b", "t293_app"], ["t295_read_list", "t295_list"], ["t295_read_file", "t295_file"]];
  const logins = new Map<string, string>();
  for (const [user, role] of users) {
    const secret = randomBytes(24).toString("hex");
    await admin.query(`CREATE ROLE ${user} LOGIN INHERIT NOBYPASSRLS PASSWORD '${secret}'; GRANT ${role} TO ${user}`);
    logins.set(user, secret);
  }
  await admin.query("INSERT INTO t253_showcase.publishers VALUES($1),($2)", [ownerA, ownerB]);
  if (mode === "--cover-check") {
    // T326-F1 회귀: 소유 루프백 클러스터의 합성 데이터만 쓴다.
    for (const [slug, title] of [["neon-alley", "네온 골목 포스터"], ["timed-coast", "기한 있는 해안"], ["drift-dune", "권리 불일치 사구"]]) {
      await seed(admin, ownerA, slug, title);
    }
    // 합성 상태: 리비전 3(다음 안전 세대 4). timed-coast 세대 4 키에는 미리 다른 합성 바이트를 넣어 둔다(보존 확인용).
    await admin.query(`UPDATE t293.works SET state=jsonb_set(state,'{revision}','"3"') WHERE slug = ANY($1)`, [["neon-alley", "timed-coast", "drift-dune"]]);
    const other = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#8c2a4f" } }).webp().toBuffer();
    assert(!other.equals(image));
    await admin.query("INSERT INTO t293.cover_objects VALUES($1,$2,$3)", [ownerA, `timed-coast/4/${sha}.webp`, other]);
    await admin.query("COMMIT");
    const rows = async (key: string) => (await admin.query("SELECT bytes FROM t293.cover_objects WHERE object_key=$1", [key])).rows;
    const evidenceKey = async (slug: string) => (await admin.query("SELECT value->'cover'->>'objectKey' AS key FROM t293.evidence WHERE slug=$1", [slug])).rows[0].key;
    const backends = async () => {
      for (let i = 0; ; i++) {
        const count = Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [db])).rows[0].count);
        if (count === 0 || i >= 40) return count;
        await new Promise((ok) => setTimeout(ok, 50));
      }
    };
    const report: Record<string, unknown> = {};

    // 1) 같은 세대·같은 바이트 12건 병렬 → 모두 200, 생성 1·재사용 11, 행 1개, 증빙 갱신
    const same = await Promise.all(Array.from({ length: 12 }, () => prepareCover("neon-alley", "4")));
    const sameKey = `neon-alley/4/${sha}.webp`;
    assert(same.every((r) => r.status === 200), JSON.stringify(same));
    assert.equal(same.filter((r) => r.body.reused === false).length, 1);
    assert.equal((await rows(sameKey)).length, 1);
    assert(Buffer.from((await rows(sameKey))[0].bytes).equals(image));
    assert.equal(await evidenceKey("neon-alley"), sameKey);
    report.sameGeneration = { requests: 12, ok: 12, created: 1, reused: 11, rows: 1 };

    // 2) 다른 바이트가 있는 키에 6건 병렬 → 모두 409, 기존 바이트와 증빙 보존
    const timedBefore = await evidenceKey("timed-coast");
    const differ = await Promise.all(Array.from({ length: 6 }, () => prepareCover("timed-coast", "4")));
    assert(differ.every((r) => r.status === 409 && /preserved/.test(String(r.body.error))), JSON.stringify(differ));
    const kept = await rows(`timed-coast/4/${sha}.webp`);
    assert.equal(kept.length, 1); assert(Buffer.from(kept[0].bytes).equals(other));
    assert.equal(await evidenceKey("timed-coast"), timedBefore);
    report.differentBytes = { requests: 6, conflict409: 6, bytesPreserved: true, evidenceUnchanged: timedBefore === `timed-coast/1/${sha}.webp` };

    // 3) 오류 뒤에도 정상: 위험한 세대·모르는 slug 거절 직후 섞인 병렬 요청이 정상 처리, 공유 연결도 정상
    const unsafe = await prepareCover("drift-dune", "9");
    const unknown = await prepareCover("not-seeded", "4");
    assert.equal(unsafe.status, 409); assert.equal(unknown.status, 400);
    const mixed = await Promise.all([...Array.from({ length: 4 }, () => prepareCover("drift-dune", "4")), prepareCover("neon-alley", "4"), prepareCover("timed-coast", "4")]);
    assert.deepEqual(mixed.map((r) => r.status), [200, 200, 200, 200, 200, 409]);
    assert.equal(mixed.slice(0, 4).filter((r) => r.body.reused === false).length, 1);
    assert.equal(mixed[4].body.reused, true);
    assert.equal((await admin.query("SELECT 1 AS ok")).rows[0].ok, 1);
    report.afterErrors = { unsafe: unsafe.status, unknown: unknown.status, mixed: mixed.map((r) => `${r.status}${r.body.reused === undefined ? "" : r.body.reused ? ":reused" : ":created"}`), sharedConnection: "ok" };

    // 4) 전용 연결이 모두 닫혔는지(남은 백엔드 0)
    report.leftoverBackends = await backends();
    assert.equal(report.leftoverBackends, 0);
    console.log(JSON.stringify({ coverCheck: "passed", report }));
  } else if (mode === "--scenarios") {
    await admin.query("COMMIT");
    const { runScenarios } = await import("./t306-publication-e2e-scenarios");
    await runScenarios({ admin, port, database: db, logins, ownerA, ownerB, seed: (owner, slug, title, options) => seed(admin, owner, slug, title, options) });
    // 남은 풀 연결을 끊어야 클러스터를 멈출 수 있다.
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [db]);
  } else {
  await seed(admin, ownerA, "neon-alley", "네온 골목 포스터");
  await seed(admin, ownerA, "timed-coast", "기한 있는 해안");
  await seed(admin, ownerA, "drift-dune", "권리 불일치 사구");
  await seed(admin, ownerB, "b-harbor", "B의 항구");
  await admin.query("COMMIT");

  const config = {
    port, database: db, timeoutMs: 3000,
    actors: {
      A: { id: ownerA, user: "t293_actor_a", password: logins.get("t293_actor_a"), email: "a@example.invalid" },
      B: { id: ownerB, user: "t293_actor_b", password: logins.get("t293_actor_b"), email: "b@example.invalid" },
    },
    list: logins.get("t295_read_list"), file: logins.get("t295_read_file"), imageBase64: image.toString("base64"), sha,
  };
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify(config), { flag: "wx", mode: 0o600 });
  const roles = await roleChecks(logins);

  const one = async (sql: string, args: unknown[] = []) => (await admin.query(sql, args)).rows;
  const control = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const reply = (body: unknown, status = 200) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
    // T326-F1: /cover는 전용 연결을 쓰고, 공유 admin 연결을 쓰는 나머지 경로는 한 번에 하나씩만 실행한다.
    const release = url.pathname === "/cover" ? () => undefined : await acquireAdmin();
    try {
      if (request.method === "GET" && url.pathname === "/state") {
        return reply({
          works: await one(`SELECT slug, state->>'revision' AS revision, state->'review'->>'generation' AS review,
            state->'active'->>'generation' AS active, (state->'active'->>'rightsUntilMs') AS until FROM t293.works ORDER BY slug`),
          activation: await one("SELECT slug, generation::text, mode, expires_at::text FROM t295.activation ORDER BY slug, generation"),
          slots: await one("SELECT slug, active_generation::text AS active FROM t253_showcase.slots ORDER BY slug"),
          counts: (await one(`SELECT (SELECT count(*) FROM t293.app_requests)::int app, (SELECT count(*) FROM t293.audit)::int audit,
            (SELECT count(*) FROM t295.requests)::int t295, (SELECT count(*) FROM t253_showcase.requests)::int t253,
            (SELECT count(*) FROM t293.manifests)::int manifests`))[0],
          requests: await one(`SELECT r.slug, r.entry->'outcome'->>'status' AS status, r.request_id::text AS id,
            (SELECT count(*) FROM t293.audit a WHERE a.request_id=r.request_id)::int AS audits,
            (SELECT count(*) FROM t295.requests q WHERE q.request_id=r.request_id)::int AS t295
            FROM t293.app_requests r ORDER BY r.slug, r.request_id`),
          roles,
        });
      }
      if (request.method === "POST" && url.pathname === "/expire") {
        // 준비 전에만: 저장된 권리 만료(attestation)와 앱 증빙의 만료를 일치(match) 또는 불일치(perpetual-evidence)로 둔다.
        const slug = url.searchParams.get("slug") ?? "";
        const seconds = Number(url.searchParams.get("seconds"));
        assert(/^[a-z-]+$/.test(slug) && Number.isInteger(seconds) && seconds > 0 && seconds < 600);
        const [{ cutoff, ms }] = await one(`SELECT (date_trunc('milliseconds', clock_timestamp()) + make_interval(secs=>$1))::text AS cutoff,
          floor(extract(epoch FROM date_trunc('milliseconds', clock_timestamp()) + make_interval(secs=>$1))*1000)::bigint::text AS ms`, [seconds]);
        await admin.query("UPDATE t295.attestations SET mode='timed', expires_at=$2::timestamptz WHERE slug=$1", [slug, cutoff]);
        const evidenceMs = url.searchParams.get("evidence") === "perpetual" ? null : Number(ms);
        await admin.query("UPDATE t293.evidence SET value=jsonb_set(value,'{rights,expiresAtMs}',$2::jsonb) WHERE slug=$1", [slug, JSON.stringify(evidenceMs)]);
        return reply({ slug, cutoff, evidenceMs });
      }
      if (request.method === "POST" && url.pathname === "/publisher") {
        const actor = url.searchParams.get("actor") === "B" ? ownerB : ownerA;
        if (url.searchParams.get("allowed") === "1") await admin.query("INSERT INTO t253_showcase.publishers VALUES($1) ON CONFLICT DO NOTHING", [actor]);
        else await admin.query("DELETE FROM t253_showcase.publishers WHERE actor=$1", [actor]);
        return reply({ publishers: (await one("SELECT actor::text FROM t253_showcase.publishers ORDER BY actor")).map((row) => row.actor) });
      }
      if (request.method === "POST" && url.pathname === "/cover") {
        const result = await prepareCover(url.searchParams.get("slug") ?? "", url.searchParams.get("generation") ?? "");
        return reply(result.body, result.status);
      }
      if (request.method === "POST" && url.pathname === "/done") { reply({ done: true }); finish(); return; }
      reply({ error: "not found" }, 404);
    } catch (error) { reply({ error: String(error).slice(0, 200) }, 500); } finally { release(); }
  });
  await new Promise<void>((ok) => control.listen(0, "127.0.0.1", ok));
  const controlAddress = control.address();
  assert(controlAddress && typeof controlAddress !== "string");
  console.log(JSON.stringify({ ready: true, configPath, controlPort: controlAddress.port, pgPort: port }));
  const timer = setTimeout(finish, 30 * 60_000);
  await finished;
  clearTimeout(timer);
  await new Promise<void>((ok) => control.close(() => ok()));
  // 남은 앱 연결(격리 Next)을 끊어야 클러스터를 멈출 수 있다.
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [db]);
  }
} finally {
  await Promise.allSettled([...clients].map((client) => client.end()));
  const pidfile = join(data, "postmaster.pid");
  const exists = await access(pidfile).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
  if (startAttempted && exists) {
    await checkListener();
    await tools("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "25", "stop"]);
  }
  await assert.rejects(access(pidfile), { code: "ENOENT" });
  if (startAttempted) await ps("if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T306_PORT) -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Unexpected leftover listener' }", { T306_PORT: String(port) });
  const cleanup = await realpath(root);
  assert(samePath(dirname(cleanup), temp) && basename(cleanup).startsWith("dream-t306-"));
  await rm(cleanup, { recursive: true, force: false });
  console.log("Owned PG17 listener and temporary cluster removed");
}
