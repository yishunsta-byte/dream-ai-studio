import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type Client, type PoolConfig } from "pg";
import sharp from "sharp";
import { createGeminiCredentialHttp } from "../../lib/reference-analysis/analysis-credential-http";
import { createGeminiCredentialStore, readGeminiCredentialKeyRing } from "../../lib/reference-analysis/analysis-credential-store";
import { currentGeminiSettings } from "../../lib/reference-analysis/analysis-gemini-settings";
import { createAdminReferenceHttp } from "../../lib/reference-analysis/admin-reference-http";
import { geminiImageAnalyzer } from "../../lib/reference-analysis/image-semantic-gemini";
import { analyzeLocalMediaUpload } from "../../lib/reference-analysis/local-media-url";
import { createMusicSemanticHttp, musicProviderFromSettings } from "../../lib/reference-analysis/music-semantic-server";
import { createShortsAnalysisHttp } from "../../lib/reference-analysis/shorts-analysis-http";

const origin = "http://127.0.0.1:41417";
const fakeRef = "synthetic_reference_key_00000001";
const fakeMusic = "AQ.synthetic_music_key_000000001";
const rotatedRef = "AQ.synthetic_reference_key_00000002";
const badKey = "synthetic_rejected_key_00000001";
const key1 = randomBytes(32).toString("base64url");
const key2 = randomBytes(32).toString("base64url");
const ring = (primary: string) => readGeminiCredentialKeyRing(JSON.stringify({ primary, keys: { key1, key2 } }));
const env = { DREAM_SITE_URL: origin, DREAM_REFERENCE_GEMINI_API_KEY: "synthetic_environment_key",
  DREAM_REFERENCE_GEMINI_MODEL: "gemini-environment", DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "gemini-shorts-environment" };
const selected = { image: "gemini-image-2.5", shorts: "gemini-shorts-2.5", music: "gemini-music-2.5" };
const modelOutput = {
  [selected.image]: { findings: { composition: { description: "장면 구성", basis: "보이는 단서" } }, ko: "이미지 창작 프롬프트", en: "Image creation prompt" },
  [selected.music]: { genre: "앰비언트", instruments: null, tempoBpm: null, structure: null, sunoPrompt: "새 음악 생성 프롬프트" },
  [selected.shorts]: { summary: "장면 요약", hook: null, composition: null, sound: null, segments: [], draftPrompt: "새 영상 생성 프롬프트" },
};
const calls: { method: string; model: string; key: string }[] = [];
let probeUnavailable = false;
const provider: typeof fetch = async (input, options) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://generativelanguage.googleapis.com");
  assert.equal(url.search, "");
  assert.equal(options?.redirect, "error");
  const key = new Headers(options?.headers).get("x-goog-api-key");
  assert.ok(key);
  const match = url.pathname.match(/^\/v1beta\/models\/([^:]+)(?::generateContent)?$/);
  assert.ok(match && options?.method);
  const model = match[1];
  calls.push({ method: options.method, model, key });
  if (key === badKey) return Response.json({ error: { details: [{ reason: "API_KEY_INVALID" }] } }, { status: 400 });
  if (model === "gemini-unknown") return Response.json({ error: { message: "fixture unknown" } }, { status: 404 });
  if (probeUnavailable && options.method === "GET") return Response.json({}, { status: 429 });
  if (options.method === "GET") return Response.json({ name: `models/${model}`, supportedGenerationMethods: ["generateContent"] });
  assert.equal(options.method, "POST");
  return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(modelOutput[model]) }] } }] });
};

function request(body: unknown | Buffer | Uint8Array, options: { method?: string; headers?: Record<string, string> } = {}) {
  const binary = ArrayBuffer.isView(body);
  const bytes = binary ? Uint8Array.from(body as Uint8Array).buffer : JSON.stringify(body);
  return new Request(origin + "/api/admin/analysis-credentials", {
    method: options.method ?? "PUT", headers: { host: new URL(origin).host, origin, "sec-fetch-site": "same-origin",
      "content-type": binary ? "application/octet-stream" : "application/json", ...options.headers },
    body: bytes,
  });
}

function wav() {
  const bytes = Buffer.alloc(300);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(292, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(256, 40);
  return bytes;
}

export async function verifyAdminGeminiCredentialStore(admin: Client, config: PoolConfig, ownerA: string, ownerB: string) {
  assert.deepEqual((await admin.query("SELECT current_database() AS db, current_user AS actor")).rows,
    [{ db: "dream_test_t358", actor: "t358_bootstrap" }]);
  const install = await readFile(new URL("../../lib/db/postgres/analysis-credentials/0001_install.sql", import.meta.url), "utf8");
  await admin.query(install);
  const password = randomBytes(20).toString("hex");
  await admin.query(`ALTER ROLE dream_gemini_app LOGIN PASSWORD '${password}'`);
  const poolOptions = { ...config, user: "dream_gemini_app", password, max: 2 };
  const first = new Pool(poolOptions);
  const second = new Pool(poolOptions);
  try {
    const store = createGeminiCredentialStore(first, ring("key1"));
    const auth = (userId: string) => async () => ({ kind: "verified" as const, userId, email: "synthetic@example.invalid" });
    const a = createGeminiCredentialHttp({ authenticate: auth(ownerA), env, store: () => store, send: provider });
    const b = createGeminiCredentialHttp({ authenticate: auth(ownerB), env, store: () => store, send: provider });
    const anonymous = createGeminiCredentialHttp({ authenticate: async () => ({ kind: "local" }), env, store: () => store, send: provider });
    assert.equal((await anonymous.put(request({}))).status, 401);
    const initial = await (await a.get()).json();
    assert.equal(initial.programs.image.source, "environment");
    assert.equal(initial.groups.reference.version, 0);
    const refWrite = { group: "reference", expectedVersion: 0, apiKey: fakeRef, models: { image: selected.image, shorts: selected.shorts } };
    assert.equal((await a.put(request(refWrite, { headers: { origin: "https://outside.example.invalid" } }))).status, 403);
    assert.equal(calls.length, 0);
    const missing = await a.put(request({ ...refWrite, apiKey: undefined }));
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).field, "apiKey");
    const rejected = await a.put(request({ ...refWrite, apiKey: badKey }));
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).code, "invalid_key");
    const unknown = await a.put(request({ ...refWrite, models: { image: "gemini-unknown", shorts: selected.shorts } }));
    assert.equal(unknown.status, 422);
    assert.equal((await unknown.json()).field, "models.image");
    assert.deepEqual(await store.metadata(ownerA), []);

    const firstSaved = await a.put(request(refWrite));
    assert.equal(firstSaved.status, 200);
    const content = await firstSaved.text();
    assert.ok(!content.includes(fakeRef) && !content.includes(fakeRef.slice(-5)));
    assert.equal(JSON.parse(content).groups.reference.version, 1);
    const music = await a.put(request({ group: "music", expectedVersion: 0, apiKey: fakeMusic, models: { music: selected.music } }));
    assert.equal(music.status, 200);
    const imageTest = request({ program: "image", group: "reference", version: 1 }, { method: "POST" });
    const test = await a.test(imageTest);
    assert.equal(test.status, 200);
    const verified = await test.json();
    assert.equal(verified.program, "image");
    assert.equal(verified.status, "verified");
    assert.equal(verified.version, 1);
    probeUnavailable = true;
    try {
      const unavailable = await a.test(request({ program: "music", group: "music", version: 1 }, { method: "POST" }));
      assert.equal(unavailable.status, 200);
      assert.equal((await unavailable.json()).code, "provider_error");
    } finally { probeUnavailable = false; }
    assert.equal(calls.filter(call => call.method === "POST").length, 0);
    assert.equal((await b.get().then(r => r.json())).groups.reference.version, 0);
    assert.equal(await store.open(ownerB, "reference"), undefined);

    const cipherRows = (await admin.query("SELECT ciphertext,nonce,tag,key_id FROM dream_gemini_credentials.credentials ORDER BY provider_group")).rows;
    assert.equal(cipherRows.length, 2);
    assert.ok(cipherRows.every(row => Buffer.isBuffer(row.ciphertext) && row.nonce.length === 12 && row.tag.length === 16));
    const persisted = JSON.stringify(cipherRows);
    assert.ok(!persisted.includes(fakeRef) && !persisted.includes(fakeMusic));
    assert.deepEqual((await first.query("SELECT provider_group FROM dream_gemini_credentials.credentials")).rows, []);
    assert.equal((await admin.query("SELECT has_schema_privilege('authenticated','dream_gemini_credentials','USAGE') AS allowed")).rows[0].allowed, false);

    await first.end();
    const restarted = createGeminiCredentialStore(second, ring("key2"));
    const next = createGeminiCredentialHttp({ authenticate: auth(ownerA), env, store: () => restarted, send: provider });
    const durable = await next.get().then(r => r.json());
    assert.equal(durable.groups.reference.version, 1);
    assert.equal(durable.programs.image.lastTest.checkedAt, verified.checkedAt);
    assert.equal(durable.programs.music.lastTest.code, "provider_error");
    assert.equal((await restarted.open(ownerA, "reference"))?.apiKey, fakeRef);
    assert.equal((await restarted.open(ownerA, "music"))?.apiKey, fakeMusic);
    const replace = { ...refWrite, expectedVersion: 1, apiKey: rotatedRef };
    const competing = await Promise.all([next.put(request(replace)), next.put(request(replace))]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    const changed = (await admin.query("SELECT key_id FROM dream_gemini_credentials.credentials WHERE provider_group='reference'")).rows[0];
    assert.equal(changed.key_id, "key2");
    const saved = await next.put(request({ ...replace, expectedVersion: 2, apiKey: undefined }));
    assert.equal(saved.status, 200);
    const metadata = await saved.json();
    assert.equal(metadata.groups.reference.version, 3);
    assert.equal(metadata.programs.image.lastTest, null);
    assert.equal(metadata.programs.music.lastTest.version, 1);
    assert.equal(await restarted.recordTest(ownerA, "reference", 2, "image", null), undefined);
    const stale = await next.test(request({ program: "image", group: "reference", version: 1 }, { method: "POST" }));
    assert.equal(stale.status, 409);

    const read = (owner: string, program: "image" | "music" | "shorts") => currentGeminiSettings(owner, program, restarted, env);
    const image = createAdminReferenceHttp({ authenticate: auth(ownerA), env, analyzeUpload: analyzeLocalMediaUpload,
      async loadImageSemantics(owner) { const choice = await read(owner, "image"); return choice && geminiImageAnalyzer(choice, provider); } });
    const musicAnalysis = createMusicSemanticHttp({ authenticate: auth(ownerA), env,
      async provider(owner) { const choice = await read(owner, "music"); return choice && musicProviderFromSettings(choice, provider); } });
    const shorts = createShortsAnalysisHttp({ authenticate: auth(ownerA), env, fetch: provider, loadSettings: owner => read(owner, "shorts") });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    const imageRequest = request(png, { method: "POST", headers: { "x-dream-media": "image", "x-dream-filename": "fixture.png", "x-dream-semantic": "image" } });
    const audioRequest = request(wav(), { method: "POST", headers: { "x-dream-filename": "fixture.wav", "x-dream-music-external-consent": "true" } });
    const shortsRequest = request({ url: "https://www.youtube.com/shorts/aBcDeFgHiJ0", authorized: true }, { method: "POST" });
    const results = await Promise.all([image.analyze(imageRequest), musicAnalysis.post(audioRequest), shorts.post(shortsRequest)]);
    assert.deepEqual(results.map(r => r.status), [200, 200, 200]);
    const [im, mu, sh] = await Promise.all(results.map(r => r.json()));
    assert.equal(im.semantic.prompts.ko, "이미지 창작 프롬프트");
    assert.equal(mu.semantic.report.sunoPrompt, "새 음악 생성 프롬프트");
    assert.equal(sh.result.findings.draftPrompt, "새 영상 생성 프롬프트");
    const generated = calls.filter(call => call.method === "POST").map(call => [call.model, call.key]);
    assert.deepEqual(new Map(generated as [string, string][]), new Map([
      [selected.image, rotatedRef], [selected.music, fakeMusic], [selected.shorts, rotatedRef],
    ]));
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
  }
  console.log("Gemini credentials PG17: auth/origin, encrypted restart/rotation/CAS, owner isolation, provider validation and three fake analysis outputs passed");
}

// ── P2-02 Seedream 생성 키·기본 연결: 격리 TLS PostgreSQL 17 + 실제 Next(개발 서버) + 합성 공급자 ─────────────────────────────
// 실행(작업공간): P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/admin-analysis-credentials.pg17.ts --generation-runtime
// Windows에서는 TEMP/TMP를 node_modules와 같은 드라이브에 둔다. "stage":"seed"는 클러스터 관리자 SQL(기록 시드·장애 주입·대조),
// "stage":"http"는 실제 Next 요청이다. 외부 공급자(BytePlus·OpenAI·Google)와 Supabase Auth는 Next 프로세스 안 합성 전송으로 대체하고
// 그 밖의 바깥 요청은 거절한다. 키는 모두 시험 안에서 만든 합성 값이다.
type Call = (path: string, options?: { method?: string; actor?: 0 | 1 | null; body?: unknown }) =>
  Promise<{ status: number; text: string; body: Record<string, unknown> }>;

async function runGenerationRuntime() {
  const { execFile, spawn } = await import("node:child_process");
  const { createHash, createHmac, randomUUID } = await import("node:crypto");
  const fs = await import("node:fs/promises");
  const { createServer: createHttpsServer } = await import("node:https");
  const { createServer: createNetServer } = await import("node:net");
  const { tmpdir } = await import("node:os");
  const { basename, dirname, join } = await import("node:path");
  const { checkServerIdentity } = await import("node:tls");
  const { setTimeout: delay } = await import("node:timers/promises");
  const { fileURLToPath } = await import("node:url");
  const { promisify } = await import("node:util");
  const pg = (await import("pg")).default;
  const run = promisify(execFile);
  const out = (check: string, value: Record<string, unknown>) => console.log(JSON.stringify({ check, ...value }));
  const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const loopback = "127.0.0.1", ref = "abcdefghijklmnopqrst", dbHost = `db.${ref}.supabase.co`, authHost = `${ref}.supabase.co`;
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const bin = await fs.realpath(process.env.P102_PG_BIN ?? "");
  const openssl = process.env.P102_OPENSSL || join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe");
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive|userprofile)$/i.test(name))) as NodeJS.ProcessEnv;
  const pgBin = (name: string) => join(bin, name + (process.platform === "win32" ? ".exe" : ""));
  const pgExec = (name: string, args: string[]) => run(pgBin(name), args,
    { env: baseEnv, windowsHide: true, timeout: 120_000 });
  assert.match((await pgExec("postgres", ["--version"])).stdout, /\(PostgreSQL\) 17\./);
  const freePort = async () => {
    const server = createNetServer();
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, loopback, resolve));
    const { port } = server.address() as { port: number };
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
  };

  const parent = await fs.realpath(tmpdir());
  const appParent = process.env.P202_APP_TMP ? await fs.realpath(process.env.P202_APP_TMP) : parent;
  const root = await fs.mkdtemp(join(parent, "dream-p202g-"));
  const data = join(root, "cluster"), adminPassword = randomBytes(24).toString("hex"), port = await freePort();
  let appRoot = root, modules = join(root, "app", "node_modules");
  let started = false, linked = false;
  let admin: Client | undefined;
  let authServer: ReturnType<typeof createHttpsServer> | undefined;
  try {
    // Windows webpack needs the application and its junction target on the same drive.
    if (appParent !== parent) appRoot = await fs.mkdtemp(join(appParent, "dream-p202g-web-"));
    const app = join(appRoot, "app");
    modules = join(app, "node_modules");
    // 1) 클러스터(TLS, 인증서 SAN = Supabase DB·Auth 주소), 선행 설치: auth.users, 분석 키 0001~0003, Style DNA 0001~0002.
    const pw = join(root, "bootstrap.txt");
    await fs.writeFile(pw, adminPassword + "\n", { flag: "wx" });
    await pgExec("initdb", ["-D", data, "--username=p202_root", "--pwfile=" + pw, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
    await fs.rm(pw);
    const certFile = join(data, "server.crt"), keyFile = join(data, "server.key"), cfg = join(root, "openssl.cnf");
    await fs.writeFile(cfg, "[req]\ndistinguished_name=dn\n[dn]\n");
    await run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "1", "-config", cfg, "-subj", "/CN=P202 generation isolated",
      "-addext", `subjectAltName=IP:${loopback},DNS:${dbHost},DNS:${authHost}`, "-keyout", keyFile, "-out", certFile], { env: baseEnv, windowsHide: true });
    started = true;
    const launch = await fs.open(join(root, "postgres-launch.log"), "wx");
    try {
      await new Promise<void>((resolve, reject) => {
        // On Windows the server can inherit pg_ctl's output handles and keep execFile pipes open.
        const child = spawn(pgBin("pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"),
          "-o", `-h ${loopback} -p ${port} -c ssl=on`, "-w", "-t", "30", "start"],
        { env: baseEnv, windowsHide: true, timeout: 40_000, stdio: ["ignore", launch.fd, launch.fd] });
        child.once("error", reject);
        child.once("exit", code => code === 0 ? resolve() : reject(new Error("Isolated PostgreSQL startup failed")));
      });
    } finally { await launch.close(); }
    const cert = await fs.readFile(certFile, "utf8");
    const ssl = { ca: cert, servername: dbHost, rejectUnauthorized: true, checkServerIdentity };
    admin = new pg.Client({ host: loopback, port, database: "postgres", user: "p202_root", password: adminPassword, ssl });
    await admin.connect();
    const db = admin;
    const { rows: [tls] } = await db.query("SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl");
    await db.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN");
    const sqlFile = (path: string) => fs.readFile(new URL(`../../lib/db/postgres/${path}`, import.meta.url), "utf8");
    const hashes: Record<string, string> = {};
    for (const file of ["analysis-credentials/0001_install.sql", "analysis-credentials/0002_youtube.sql", "analysis-credentials/0003_style_dna_engines.sql",
      "style-dna/0001_install.sql", "style-dna/0002_library_delete.sql", "style-dna/0003_generation_recovery.sql", "style-dna/0004_generation_request_model.sql"]) {
      const text = await sqlFile(file);
      await db.query(text);
      hashes[file] = sha(text.replaceAll("\r\n", "\n"));
    }
    const secrets = { gemini: randomBytes(24).toString("hex"), style: randomBytes(24).toString("hex") };
    await db.query(`ALTER ROLE dream_gemini_app LOGIN PASSWORD '${secrets.gemini}'`);
    await db.query(`ALTER ROLE dream_style_dna_app LOGIN PASSWORD '${secrets.style}'`);
    const users = [1, 2].map(i => ({ id: `20000000-0000-4000-8000-00000000000${i}`, email: `gen-fixture-${i}@example.invalid` }));
    const [A, B] = users.map(user => user.id);
    await db.query("INSERT INTO auth.users VALUES ($1),($2)", [A, B]);

    // 기록 시드(A 소유, 리비전 2, 원본 WebP). 결과 테스트는 이 기록에 붙는다.
    const recordId = "0190b0b0-0000-7000-8000-00000000d001";
    const originalWebp = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#aa5500" } }).webp().toBuffer();
    const href = `/api/admin/style-dna/${recordId}/media/original`;
    const document = { id: recordId, title: "합성 기록", revision: 2, mode: "replicate", createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z",
      original: { mime: "image/webp", width: 96, height: 64, sha256: sha(originalWebp), palette: [], href },
      options: { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel: "seedream-5.5" },
      result: { schemaVersion: 1, status: "ready", media: "image", proposals: [] },
      semantic: { status: "partial", provider: "gemini", findings: [], prompts: { en: "A warm alley at dusk with [INSERT SUBJECT HERE]." } },
      revisions: [{ revision: 1, prompts: { en: "An old prompt with [INSERT SUBJECT HERE]." }, createdAt: "2026-11-25T00:00:00.000Z" },
        { revision: 2, prompts: { en: "A warm alley at dusk with [INSERT SUBJECT HERE]." }, createdAt: "2026-11-25T00:00:01.000Z" }], tests: [] };
    await db.query("INSERT INTO dream_style_dna.records(owner_id,id,revision,document) VALUES($1,$2,2,$3::jsonb)", [A, recordId, JSON.stringify(document)]);
    await db.query("INSERT INTO dream_style_dna.media(owner_id,record_id,id,image) VALUES($1,$2,$2,$3)", [A, recordId, originalWebp]);
    out("seed", { stage: "seed", postgres: (await db.query("SHOW server_version")).rows[0].server_version, tls: tls.version, installed: hashes,
      generationTable: "not installed yet", record: "owner A, revision 2" });

    // 2) 합성 Auth(HTTPS)와 Next 사본(작업 트리를 git이 커밋할 모습 그대로, 임시 색인 사용).
    const authOrigin = `https://${authHost}`, publicKey = "sb_publishable_p202_fixture_only_key";
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const actors = users.map(user => {
      const now = Math.floor(Date.now() / 1000);
      const raw = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: user.id, iss: `${authOrigin}/auth/v1`, aud: "authenticated", role: "authenticated",
        email: user.email, iat: now, exp: now + 3600 });
      const token = raw + "." + createHmac("sha256", "p202-synthetic-only").update(raw).digest("base64url");
      const profile = { ...user, aud: "authenticated", role: "authenticated" };
      return { profile, token, cookie: `sb-${ref}-auth-token=base64-` + b64({ access_token: token, refresh_token: "synthetic", expires_at: now + 3600,
        expires_in: 3600, token_type: "bearer", user: profile }) };
    });
    const auth = createHttpsServer({ cert, key: await fs.readFile(keyFile) }, (req, res) => {
      const actor = req.url === "/auth/v1/user" && req.headers.apikey === publicKey ? actors.find(a => req.headers.authorization === `Bearer ${a.token}`) : undefined;
      res.writeHead(actor ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(actor?.profile ?? { message: "Synthetic unauthorized" }));
    });
    authServer = auth;
    await new Promise<void>((resolve, reject) => auth.once("error", reject).listen(0, loopback, resolve));
    await fs.mkdir(app);
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const fixedHead = process.argv.includes("--fixed-head");
    let tree = (await run("git", ["rev-parse", `${head}^{tree}`], { cwd: repo })).stdout.trim();
    if (!fixedHead) {
      const indexEnv = { ...process.env, GIT_INDEX_FILE: join(root, "copy.index") };
      await run("git", ["add", "-A"], { cwd: repo, env: indexEnv });
      tree = (await run("git", ["write-tree"], { cwd: repo, env: indexEnv })).stdout.trim();
    }
    const runtimePaths = ["app", "components", "config", "lib", "pages", "render", "scripts", "worker",
      "docs/design/tokens.css", "docs/spec", "instrumentation.ts", "next.config.ts", "package.json", "proxy.ts", "tsconfig.json"];
    await run("git", ["archive", "--format=tar", "-o", join(root, "source.tar"), tree, ...(fixedHead ? ["--", ...runtimePaths] : [])], { cwd: repo });
    const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    await run(tar, ["-xf", join(root, "source.tar"), "-C", app]);
    await fs.symlink(join(repo, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
    linked = true;
    // 합성 공급자 응답: 1024x1024 PNG, 호출 기록(키는 sha256 앞 16자만), 지연 조절 파일.
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#1576c0" } }).png().toBuffer();
    await fs.writeFile(join(root, "seedream.b64"), png.toString("base64"));
    const control = join(root, "control.json"), calls = join(root, "calls.jsonl");
    await fs.writeFile(control, JSON.stringify({ delayMs: 0 }));
    await fs.writeFile(calls, "");
    await fs.writeFile(join(app, "g-preload.cjs"), preloadSource);
    await fs.writeFile(join(app, "g-start.cjs"), `const port=Number(process.env.PORT);
const app=require("next")({dev:true,webpack:true,hostname:"127.0.0.1",port});
app.prepare().then(()=>require("node:http").createServer(app.getRequestHandler()).listen(port,"127.0.0.1",()=>console.log("G READY")));
`);
    out("next-copy", { stage: "seed", source: `git archive of tree ${tree} (HEAD ${head})`, mode: "next dev (webpack)" });

    const seedreamKeys = ["0f3c2a1e-9b7d-4c55-8e21-6a0b9c8d7e6f", "ark-synthetic_Rotated.0123456789AB", "0f3c2a1e-9b7d-4c55-8e21-00000000b0b0"];
    // BFL 문서 형식 bfl_<random-string>을 흉내 낸 합성 키. 셋째는 대역이 거절하는 키다.
    const bflKeys = ["bfl_SyntheticKey0123456789abcdefXYZ", "bfl_SyntheticRotated_9876543210zyx", "bfl_SyntheticUnknown_000000000000"];
    // OpenAI 생성 키(합성). 분석 엔진 OpenAI 키(synthetic_openai_key_…)는 대역 허용 목록에 없어, 생성이 그 키를 쓰면 401로 드러난다.
    const openaiGenKeys = ["sk-synthetic_GenKey0123456789abcdef", "sk-synthetic_GenRotated_0123456789", "sk-synthetic_GenUnknown_000000000"];
    const keyring = JSON.stringify({ primary: "k1", keys: { k1: randomBytes(32).toString("base64url") } });
    const dsn = (role: string, secret: string) => `postgresql://${role}:${secret}@${dbHost}:5432/postgres`;
    const readCalls = async () => (await fs.readFile(calls, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    const keyTag = (value: string) => sha(value).slice(0, 16);

    async function withNext(profile: Record<string, string | null>, verify: (call: Call) => Promise<void>) {
      const appPort = await freePort(), origin = `http://${loopback}:${appPort}`;
      const env: NodeJS.ProcessEnv = { ...baseEnv, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", PORT: String(appPort),
        NODE_OPTIONS: `--require=${join(app, "g-preload.cjs")}`, DREAM_AUTH_MODE: "supabase", DREAM_SITE_URL: origin,
        NEXT_PUBLIC_SUPABASE_URL: authOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey, DREAM_ALLOWED_EMAILS: users.map(u => u.email).join(","),
        DREAM_ANALYSIS_CREDENTIALS_DB_URL: dsn("dream_gemini_app", secrets.gemini), DREAM_ANALYSIS_CREDENTIALS_DB_CA: cert,
        DREAM_ANALYSIS_CREDENTIALS_KEYS: keyring, DREAM_STYLE_DNA_DB_URL: dsn("dream_style_dna_app", secrets.style), DREAM_STYLE_DNA_DB_CA: cert,
        P202_SYNTHETIC: JSON.stringify({ authOrigin, appOrigin: origin, dbHost, dbPort: port, authPort: (auth.address() as { port: number }).port,
          cert: certFile, control, calls, png: join(root, "seedream.b64"), keys: [...seedreamKeys.slice(0, 2), ...bflKeys.slice(0, 2), ...openaiGenKeys.slice(0, 2)].map(keyTag) }) };
      for (const [name, value] of Object.entries(profile)) if (value === null) delete env[name]; else env[name] = value;
      const child = spawn(process.execPath, ["g-start.cjs"], { cwd: app, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
      let logs = "";
      let allLogs = "";
      for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { logs = (logs + bytes).slice(-20000); allLogs += bytes; });
      const call: Call = async (path, { method = "GET", actor = 0, body } = {}) => {
        const response = await fetch(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(180_000),
          headers: { ...(actor !== null && { cookie: actors[actor].cookie }),
            ...(method !== "GET" && { origin, "sec-fetch-site": "same-origin" }),
            ...(body !== undefined && { "content-type": "application/json" }) },
          ...(body !== undefined && { body: JSON.stringify(body) }) });
        const text = await response.text();
        let parsed: Record<string, unknown>;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { unparsed: text.slice(0, 200) }; }
        return { status: response.status, text, body: parsed };
      };
      try {
        for (let i = 0; !logs.includes("G READY"); i++) {
          assert(i < 1200 && child.exitCode === null, "Next startup failed: " + logs.slice(-2000));
          await delay(100);
        }
        await verify(call);
        for (const key of seedreamKeys) assert(!logs.includes(key), "key in Next output");
        assert(!/uncaughtException|unhandledRejection/.test(allLogs), "uncaught error in Next: " + allLogs.match(/.*(?:uncaughtException|unhandledRejection).*/)?.[0]);
      } catch (error) { console.error(logs.slice(-4000)); throw error; }
      finally {
        if (child.exitCode === null) child.kill();
        out("next-exit", { stage: "http", ...(await exited as object), stoppedBy: "test" });
      }
    }

    const genPath = "/api/admin/style-dna/generation-credentials", listPath = "/api/admin/style-dna", testPath = `/api/admin/style-dna/${recordId}/test-image`;
    const code = (r: { status: number; body: Record<string, unknown> }) => `${r.status}:${String(r.body.code ?? "")}`;
    const seedream = (credentialVersion: number, requestId: string = randomUUID(), extra: Record<string, unknown> = {}) => ({ requestId, authorized: true,
      credentialVersion, revision: 2, model: "seedream-5.5", subject: "a red bicycle", expectedCostMicros: 20_000, ...extra });
    const generation = (r: { body: Record<string, unknown> }) => (r.body.settings as { generationModels?: { credentialVersion: number }[] }).generationModels;
    const testsOf = async () => ((await db.query("SELECT document FROM dream_style_dna.records WHERE id=$1", [recordId])).rows[0].document.tests as { id: string }[]).length;
    const receiptOf = async (id: string) => (await db.query("SELECT outcome FROM dream_style_dna.requests WHERE id=$1", [id])).rows[0]?.outcome;
    const byteplusCalls = async () => (await readCalls()).filter(entry => entry.kind === "byteplus");

    // 3) 키 저장소 환경이 없는 서버: 생성 키 GET 503, 목록 줄 없음, 생성 요청 not_configured(공급자 호출 0).
    await withNext({ DREAM_ANALYSIS_CREDENTIALS_DB_URL: null, DREAM_ANALYSIS_CREDENTIALS_DB_CA: null, DREAM_ANALYSIS_CREDENTIALS_KEYS: null }, async call => {
      const get = await call(genPath);
      const list = await call(listPath);
      const post = await call(testPath, { method: "POST", body: seedream(1) });
      assert.deepEqual([code(get), list.status, generation(list), code(post)], ["503:storage_unavailable", 200, [], "503:not_configured"], list.text);
      assert.equal((await byteplusCalls()).length, 0);
      out("no-credential-store", { stage: "http", generationGet: code(get), listGenerationModels: generation(list), seedreamTest: code(post), providerCalls: 0 });
    });

    await withNext({}, async call => {
      // 4) 0004 미설치: 생성 키 GET·PUT 503, 목록은 줄 없음(기존 Gemini·엔진 칸 그대로), 생성 요청 storage_unavailable(공급자 0).
      //    기존 Gemini 키·분석 엔진 키 등록은 그대로 동작한다(합성 Google·OpenAI 확인).
      const gemini = await call("/api/admin/analysis-credentials", { method: "PUT", body: { group: "reference", expectedVersion: 0,
        apiKey: "synthetic_reference_key_00000001", models: { image: "gemini-image-2.5", shorts: "gemini-shorts-2.5" } } });
      const engine = await call("/api/admin/style-dna/engine-credentials", { method: "PUT", body: { provider: "openai", modelId: "gpt-fixture",
        expectedVersion: 0, apiKey: "synthetic_openai_key_00000000001" } });
      assert.deepEqual([gemini.status, engine.status], [200, 200], gemini.text + engine.text);
      const before = { get: await call(genPath), put: await call(genPath, { method: "PUT", body: { provider: "byteplus", expectedVersion: 0, apiKey: seedreamKeys[0] } }),
        list: await call(listPath), post: await call(testPath, { method: "POST", body: seedream(1) }) };
      const settings = before.list.body.settings as Record<string, unknown>;
      assert.deepEqual([code(before.get), code(before.put), before.list.status, generation(before.list), code(before.post)],
        ["503:storage_unavailable", "503:storage_unavailable", 200, [], "503:storage_unavailable"]);
      assert.deepEqual([settings.credentialVersion, settings.engineStorage, (settings.analysisEngines as { provider: string; configured: boolean }[]).map(e => `${e.provider}:${e.configured}`)],
        [1, "ready", ["gemini:true", "openai:true", "anthropic:false"]]);
      assert.equal((await byteplusCalls()).length, 0);
      out("not-installed", { stage: "http", generationGet: code(before.get), generationPut: code(before.put), listGenerationModels: generation(before.list),
        seedreamTest: code(before.post), geminiPut: gemini.status, enginePut: engine.status, analysisEngines: settings.analysisEngines, providerCalls: 0 });

      // 5) 0004 설치(관리자 SQL). 미등록: GET 미등록, 목록 줄 없음, 생성 not_configured. 다른 계정도 미등록.
      const install = await sqlFile("analysis-credentials/0004_style_dna_generation.sql");
      await db.query(install);
      const { rows: grants } = await db.query(`SELECT privilege_type, column_name FROM information_schema.column_privileges
        WHERE table_schema='dream_gemini_credentials' AND table_name='style_dna_generation_credentials' AND grantee='dream_gemini_app' ORDER BY 2,1`);
      out("install-0004", { stage: "seed", sha256: sha(install.replaceAll("\r\n", "\n")), appColumnPrivileges: grants.length });
      const unregistered = { get: await call(genPath), list: await call(listPath), post: await call(testPath, { method: "POST", body: seedream(1) }),
        otherGet: await call(genPath, { actor: 1 }) };
      assert.deepEqual([unregistered.get.body, generation(unregistered.list), code(unregistered.post), unregistered.otherGet.body],
        [{ providers: { byteplus: { configured: false, version: 0, updatedAt: null }, bfl: { configured: false, version: 0, updatedAt: null }, openai: { configured: false, version: 0, updatedAt: null } } }, [], "503:not_configured",
          { providers: { byteplus: { configured: false, version: 0, updatedAt: null }, bfl: { configured: false, version: 0, updatedAt: null }, openai: { configured: false, version: 0, updatedAt: null } } }]);

      // 6) 등록(A): 형식 오류 422, 정상 200(공급자 호출 없음). B는 여전히 미등록이고 목록 줄도 없다.
      const badKey = await call(genPath, { method: "PUT", body: { provider: "byteplus", expectedVersion: 0, apiKey: `${seedreamKeys[0]} ` } });
      const callsBeforePut = (await readCalls()).length;
      const saved = await call(genPath, { method: "PUT", body: { provider: "byteplus", expectedVersion: 0, apiKey: seedreamKeys[0] } });
      assert.equal(code(badKey), "422:invalid_key");
      assert.equal(saved.status, 200, saved.text);
      assert.deepEqual([saved.body.provider, (saved.body.setting as { version: number }).version], ["byteplus", 1]);
      assert.equal((await readCalls()).length, callsBeforePut, "no provider call on registration");
      const other = { get: await call(genPath, { actor: 1 }), list: await call(listPath, { actor: 1 }), post: await call(testPath, { actor: 1, method: "POST", body: seedream(1) }) };
      assert.deepEqual([(other.get.body.providers as { byteplus: { configured: boolean } }).byteplus.configured, generation(other.list), code(other.post)],
        [false, [], "404:not_found"]);
      // 저장 행: 암호문(키 원문 없음)·키링 ID. 앱 역할은 B 설정으로 A 행을 읽지도 고치지도 못한다(RLS).
      const { rows: [row] } = await db.query("SELECT owner_id, version, key_id, nonce, ciphertext, tag FROM dream_gemini_credentials.style_dna_generation_credentials");
      assert.equal(row.ciphertext.includes(Buffer.from(seedreamKeys[0])), false);
      const appClient = new pg.Client({ host: loopback, port, database: "postgres", user: "dream_gemini_app", password: secrets.gemini, ssl });
      await appClient.connect();
      try {
        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('dream_gemini.owner_id',$1,true)", [B]);
        const asB = (await appClient.query("SELECT count(*)::int AS n FROM dream_gemini_credentials.style_dna_generation_credentials")).rows[0].n;
        const writeOther = await appClient.query("UPDATE dream_gemini_credentials.style_dna_generation_credentials SET version=version+1");
        await appClient.query("ROLLBACK");
        assert.deepEqual([asB, writeOther.rowCount], [0, 0]);
      } finally { await appClient.end(); }
      const listA = await call(listPath);
      assert.deepEqual(generation(listA)?.map(item => item.credentialVersion), [1]);
      out("register", { stage: "http+seed", badKey: code(badKey), saved: "200 version 1", providerCallsOnRegister: 0, otherAccount: { get: "unconfigured",
        listGenerationModels: [], seedreamTest: code(other.post) }, stored: { keyId: row.key_id, nonce: row.nonce.length, tag: row.tag.length, plaintextInRow: false },
        rlsOtherOwner: { rows: 0, updated: 0 }, listA: generation(listA) });

      // 7) 생성(A, 버전 1): 201, 공급자 1회(키 1), 같은 번호 재요청 200(호출 없음).
      const firstId = randomUUID();
      const created = await call(testPath, { method: "POST", body: seedream(1, firstId) });
      assert.equal(created.status, 201, created.text);
      assert.equal(created.body.model, "seedream-5.5");
      const replay = await call(testPath, { method: "POST", body: seedream(1, firstId) });
      assert.deepEqual([replay.status, replay.body], [200, created.body]);
      assert.deepEqual((await byteplusCalls()).map(entry => entry.key), [keyTag(seedreamKeys[0])]);
      assert.equal(await testsOf(), 1);
      for (const key of seedreamKeys) assert(!created.text.includes(key));

      // 8) 회전: 버전 1→2(다른 형식 키). 옛 버전 PUT 409, 옛 버전 생성 409 stale_credential(호출 없음), 회전 전 번호는 회전 전 결과 그대로.
      const rotated = await call(genPath, { method: "PUT", body: { provider: "byteplus", expectedVersion: 1, apiKey: seedreamKeys[1] } });
      const stalePut = await call(genPath, { method: "PUT", body: { provider: "byteplus", expectedVersion: 1, apiKey: seedreamKeys[2] } });
      const staleTest = await call(testPath, { method: "POST", body: seedream(1) });
      const oldReplay = await call(testPath, { method: "POST", body: seedream(1, firstId) });
      assert.deepEqual([rotated.status, code(stalePut), code(staleTest), oldReplay.status], [200, "409:stale", "409:stale_credential", 200]);
      assert.equal((await byteplusCalls()).length, 1);
      const fresh = await call(testPath, { method: "POST", body: seedream(2) });
      assert.equal(fresh.status, 201, fresh.text);
      assert.deepEqual((await byteplusCalls()).map(entry => entry.key), [keyTag(seedreamKeys[0]), keyTag(seedreamKeys[1])]);
      assert.deepEqual(generation(await call(listPath))?.map(item => item.credentialVersion), [2]);
      out("rotation", { stage: "http", rotate: "200 version 2", oldVersionPut: code(stalePut), oldVersionTest: code(staleTest), oldRequestReplay: oldReplay.status,
        newVersionTest: fresh.status, providerKeys: "v1 key then v2 key", tests: await testsOf() });

      // 9) 생성 도중 회전: 공급자 응답을 늦춘 사이 버전 2→3. 결과는 저장하지 않고 409 stale_credential(같은 번호도 같은 답, 재호출 없음).
      await fs.writeFile(control, JSON.stringify({ delayMs: 6000 }));
      const midId = randomUUID(), testsBefore = await testsOf();
      const pending = call(testPath, { method: "POST", body: seedream(2, midId) });
      // Keep the original HTTP error attached if a concurrent assertion fails before awaiting this request.
      void pending.catch(() => undefined);
      for (let i = 0; (await byteplusCalls()).length < 3; i++) { assert(i < 600, "provider call not seen"); await delay(50); }
      const statusPath = (id: string) => testPath + "?requestId=" + id;
      const discovered = await call(testPath);
      const observedPending = { code: "in_progress", requestId: midId, model: "seedream-5.5" };
      assert.deepEqual([discovered.status, discovered.body], [202, observedPending]);
      const specific = await call(statusPath(midId));
      assert.deepEqual([specific.status, specific.body], [202, observedPending]);
      assert.equal(code(await call(statusPath(randomUUID()))), "404:not_found");
      assert.equal(await receiptOf(midId), null);
      const newTabId = randomUUID();
      const blocked = await call(testPath, { method: "POST", body: seedream(2, newTabId) });
      assert.deepEqual([blocked.status, blocked.body, await receiptOf(newTabId)],
        [409, { code: "generation_in_progress", requestId: midId, model: "seedream-5.5" }, undefined]);
      assert.deepEqual([code(await call(statusPath(midId), { actor: 1 })), code(await call(statusPath(midId), { actor: null }))],
        ["404:not_found", "401:AUTH_REQUIRED"]);
      const midRotate = await call(genPath, { method: "PUT", body: { provider: "byteplus", expectedVersion: 2, apiKey: seedreamKeys[0] } });
      const mid = await pending;
      await fs.writeFile(control, JSON.stringify({ delayMs: 0 }));
      const midReplay = await call(testPath, { method: "POST", body: seedream(2, midId) });
      assert.deepEqual([mid.body.model, midReplay.body.model], ["seedream-5.5", "seedream-5.5"]);
      assert.deepEqual([midRotate.status, code(mid), code(midReplay), await testsOf(), (await byteplusCalls()).length],
        [200, "409:stale_credential", "409:stale_credential", testsBefore, 3]);
      const idle = await call(testPath);
      const resolved = await call(statusPath(midId));
      assert.deepEqual([idle.status, idle.body, resolved.status, resolved.body],
        [200, { pending: false }, 409, { code: "stale_credential", requestId: midId, model: "seedream-5.5", settled: true }]);
      out("generation-status", { stage: "http", discovery: 202, newTab: 409, nonOwner: 404, unauthenticated: 401, completed: "409:stale_credential" });
      out("rotation-during-generation", { stage: "http", rotateWhileProviderPending: "200 version 3", result: code(mid), replay: code(midReplay), saved: false, providerCalls: 3 });

      // 10) 두 DB 확정 경계(실제 거래). (a) 결과 저장 자체가 실패: 명확한 실패로 기록(503 storage_unavailable, 같은 번호 같은 답).
      //     (b) 결과가 커밋된 뒤 키 거래 연결이 끊겨 키 쪽 커밋이 실패: 같은 요청 영수증으로 확정 결과(201)를 돌려주고 다시 쓰지 않는다.
      const failId = randomUUID(), commitId = randomUUID();
      await db.query(`CREATE FUNCTION public.p202_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
        IF NEW.id='${failId}'::uuid AND NEW.outcome->>'status'='201' THEN RAISE EXCEPTION 'p202 synthetic save fault'; END IF;
        IF NEW.id='${commitId}'::uuid AND NEW.outcome->>'status'='201' THEN PERFORM pg_sleep(3); END IF;
        RETURN NEW; END $f$`);
      await db.query("CREATE TRIGGER p202_fault BEFORE UPDATE ON dream_style_dna.requests FOR EACH ROW EXECUTE FUNCTION public.p202_fault()");
      const t0 = await testsOf();
      const saveFault = await call(testPath, { method: "POST", body: seedream(3, failId) });
      const saveFaultReplay = await call(testPath, { method: "POST", body: seedream(3, failId) });
      assert.deepEqual([code(saveFault), code(saveFaultReplay), await testsOf(), (await receiptOf(failId))?.status],
        ["503:storage_unavailable", "503:storage_unavailable", t0, 503]);
      const savedFailure = await call(statusPath(failId));
      assert.deepEqual([savedFailure.status, savedFailure.body],
        [503, { code: "storage_unavailable", requestId: failId, model: "seedream-5.5", settled: true }]);
      const commitPending = call(testPath, { method: "POST", body: seedream(3, commitId) });
      let terminated = 0;
      for (let i = 0; !terminated; i++) {
        assert(i < 600, "key transaction not seen");
        const { rows } = await db.query(`SELECT k.pid FROM pg_stat_activity k WHERE k.usename='dream_gemini_app' AND k.state='idle in transaction'
          AND EXISTS (SELECT 1 FROM pg_stat_activity s WHERE s.usename='dream_style_dna_app' AND s.wait_event='PgSleep')`);
        for (const { pid } of rows) if ((await db.query("SELECT pg_terminate_backend($1) AS ok", [pid])).rows[0].ok) terminated++;
        if (!terminated) await delay(50);
      }
      const committed = await commitPending;
      const committedReplay = await call(testPath, { method: "POST", body: seedream(3, commitId) });
      const committedStatus = await call(statusPath(commitId));
      assert.equal(committed.status, 201, committed.text);
      assert.deepEqual([committedReplay.status, committedReplay.body, await testsOf(), (await receiptOf(commitId))?.status], [200, committed.body, t0 + 1, 201]);
      assert.deepEqual([committedStatus.status, committedStatus.body],
        [200, { ...committed.body, requestId: commitId, settled: true }]);
      assert.equal((await byteplusCalls()).length, 5);
      await db.query("DROP TRIGGER p202_fault ON dream_style_dna.requests; DROP FUNCTION public.p202_fault()");
      out("commit-boundary", { stage: "http+seed", saveFault: code(saveFault), saveFaultReplay: code(saveFaultReplay), saveFaultReceipt: 503,
        keyTransactionTerminatedAfterResultCommit: terminated, answer: committed.status, replay: committedReplay.status, receipt: 201, testsAdded: 1, providerCalls: 5 });

      const unconfirmedId = randomUUID();
      await db.query(`CREATE FUNCTION public.p202_unconfirmed() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
        IF NEW.id='${unconfirmedId}'::uuid THEN RAISE EXCEPTION 'p202 synthetic outcome fault'; END IF;
        RETURN NEW; END $f$`);
      await db.query("CREATE TRIGGER p202_unconfirmed BEFORE UPDATE ON dream_style_dna.requests FOR EACH ROW EXECUTE FUNCTION public.p202_unconfirmed()");
      const callsBeforeUnconfirmed = (await byteplusCalls()).length;
      const failed = await call(testPath, { method: "POST", body: seedream(3, unconfirmedId) });
      assert.equal(code(failed), "503:result_unconfirmed");
      assert.equal(failed.body.model, "seedream-5.5");
      assert.equal(await receiptOf(unconfirmedId), null);
      const status = await call(statusPath(unconfirmedId));
      assert.deepEqual([status.status, status.body], [202, { code: "in_progress", requestId: unconfirmedId, model: "seedream-5.5" }]);
      const duplicateIds = [randomUUID(), randomUUID()];
      const attempts = await Promise.all(duplicateIds.map(id => call(testPath, { method: "POST", body: seedream(3, id) })));
      for (const attempt of attempts) {
        assert.deepEqual([attempt.status, attempt.body], [409, { code: "generation_in_progress", requestId: unconfirmedId, model: "seedream-5.5" }]);
      }
      const count = (await db.query("SELECT count(*)::int AS n FROM dream_style_dna.requests WHERE id=ANY($1::uuid[])", [duplicateIds])).rows[0].n;
      assert.deepEqual([count, (await byteplusCalls()).length - callsBeforeUnconfirmed], [0, 1]);
      await db.query("DROP TRIGGER p202_unconfirmed ON dream_style_dna.requests; DROP FUNCTION public.p202_unconfirmed()");
      out("unconfirmed-generation-guard", { stage: "http+seed", original: code(failed), status: status.status,
        attemptedNewIds: attempts.map(code), newReceipts: count, providerCalls: (await byteplusCalls()).length - callsBeforeUnconfirmed });

      // 11) 정상 목록과 기존 Gemini·엔진 상태 재확인, 영수증·호출 기록에서 합성 키 0건, 거절된 바깥 요청 0건.
      const finalList = await call(listPath);
      const finalSettings = finalList.body.settings as Record<string, unknown>;
      const engines = await call("/api/admin/style-dna/engine-credentials");
      const geminiState = await call("/api/admin/analysis-credentials");
      assert.deepEqual([finalList.status, (finalList.body.items as unknown[]).length, finalSettings.credentialVersion, generation(finalList)?.map(item => item.credentialVersion),
        (engines.body.providers as { openai: { version: number } }).openai.version, geminiState.status], [200, 1, 1, [3], 1, 200]);
      const record = (await call(`/api/admin/style-dna/${recordId}`)).body.record as { tests: { model: string; generation?: { billing: string } }[] };
      assert.deepEqual(record.tests.map(test => `${test.model}:${test.generation?.billing}`), Array(await testsOf()).fill("seedream-5.5:unconfirmed"));
      const dump = JSON.stringify((await db.query("SELECT outcome FROM dream_style_dna.requests")).rows) + await fs.readFile(calls, "utf8");
      for (const key of seedreamKeys) assert(!dump.includes(key));
      // Next 개발 서버의 새 버전 확인(registry.npmjs.org)은 제품 요청이 아니라 따로 센다(거절됨, 응답 영향 없음).
      const refused = (await readCalls()).filter(entry => entry.kind === "refused");
      const devUpdateChecks = refused.filter(entry => entry.origin === "https://registry.npmjs.org").length;
      assert.equal(refused.length - devUpdateChecks, 0, JSON.stringify(refused));
      out("final-state", { stage: "http", listItems: 1, geminiCredentialVersion: 1, openaiEngineVersion: 1, generationModels: generation(finalList),
        recordTests: record.tests.length, keysInReceiptsOrCallLog: 0, refusedProductOutbound: 0, refusedNextDevUpdateChecks: devUpdateChecks,
        providerCalls: (await byteplusCalls()).length });

      const fluxRecord = "0190b0b0-0000-7000-8000-00000000d002", fluxRequest = randomUUID();
      const fluxPath = `/api/admin/style-dna/${fluxRecord}/test-image`;
      await db.query("INSERT INTO dream_style_dna.records(owner_id,id,revision,document) VALUES($1,$2,2,$3::jsonb)",
        [A, fluxRecord, JSON.stringify({ ...document, id: fluxRecord })]);
      await db.query("INSERT INTO dream_style_dna.requests(owner_id,id,input_hash,generation_record_id,generation_model) VALUES($1,$2,$3,$4,$5)",
        [A, fluxRequest, sha(fluxRequest), fluxRecord, "flux-2-pro"]);
      const fluxPending = { code: "in_progress", requestId: fluxRequest, model: "flux-2-pro" };
      for (const path of [fluxPath, fluxPath + "?requestId=" + fluxRequest]) {
        const response = await call(path);
        assert.deepEqual([response.status, response.body], [202, fluxPending]);
      }
      for (const response of [await call(statusPath(fluxRequest)), await call(fluxPath + "?requestId=" + fluxRequest, { actor: 1 })]) {
        assert.deepEqual([response.status, response.body], [404, { code: "not_found" }]);
      }
      assert.equal(await receiptOf(fluxRequest), null);
      const deleted = await call(`/api/admin/style-dna/${fluxRecord}`, { method: "DELETE" });
      assert.equal(deleted.status, 204, deleted.text);
      const deletedReceipt = await call(fluxPath + "?requestId=" + fluxRequest);
      assert.deepEqual([deletedReceipt.status, deletedReceipt.body],
        [404, { code: "not_found", requestId: fluxRequest, model: "flux-2-pro", settled: true }]);
      out("flux-model-recovery", { stage: "http+seed", discovery: 202, exact: 202, wrongRecord: 404, wrongOwner: 404, deletedReceipt: 404, readOnly: true });

      // 12) BFL 키(P2-02-STYLE-DNA-FLUX2-CREDENTIAL-SERVER). 0005 전: bfl PUT은 DB 제약으로 저장되지 않는다(503, 행 0, 공급자 0).
      const bflCalls = async () => (await readCalls()).filter(entry => entry.kind === "bfl");
      const flux = (credentialVersion: number, requestId: string = randomUUID()) => ({ ...seedream(credentialVersion, requestId),
        model: "flux-2-pro", expectedCostMicros: 30_000 });
      const bflRows = async () => (await db.query("SELECT owner_id, provider, version FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider='bfl'")).rows;
      const byteplusVersion = async () => ((await call(genPath)).body.providers as { byteplus: { version: number } }).byteplus.version;
      const byteplusBefore = await byteplusVersion();
      const before0005 = await call(genPath, { method: "PUT", body: { provider: "bfl", expectedVersion: 0, apiKey: bflKeys[0] } });
      assert.deepEqual([code(before0005), (await bflRows()).length, (await bflCalls()).length], ["503:storage_unavailable", 0, 0]);
      const install5 = await sqlFile("analysis-credentials/0005_bfl_generation.sql");
      // 범위: 0005는 0004 기본 제약과 자기 제약만 바꾼다. provider를 참조하는 다른 CHECK(시험용)는 설치·롤백 뒤에도 남아야 한다.
      const checksOf = async () => (await db.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='dream_gemini_credentials.style_dna_generation_credentials'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%provider%'
        ORDER BY conname`)).rows.map(row => `${row.conname}=${row.def}`);
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials ADD CONSTRAINT p202_provider_probe CHECK (provider <> 'probe')");
      // Tester 반례와 같은 모양: provider와 version을 함께 보는 별도 제약.
      await db.query(`ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials
        ADD CONSTRAINT tester_byteplus_version_ceiling CHECK (provider <> 'byteplus' OR version < 1000000)`);
      const checks0004 = await checksOf();
      const ceiling = "tester_byteplus_version_ceiling=CHECK (((provider <> 'byteplus'::text) OR (version < 1000000)))";
      assert.deepEqual(checks0004, ["p202_provider_probe=CHECK ((provider <> 'probe'::text))",
        "style_dna_generation_credentials_provider_check=CHECK ((provider = 'byteplus'::text))", ceiling]);
      await db.query(install5);
      await db.query(install5); // 다시 실행해도 같은 상태
      const checks0005 = await checksOf();
      assert.deepEqual(checks0005, ["p202_provider_probe=CHECK ((provider <> 'probe'::text))",
        "style_dna_generation_provider=CHECK ((provider = ANY (ARRAY['byteplus'::text, 'bfl'::text])))", ceiling]);
      const providerChecks = [{ def: checks0005[1].split("=").slice(1).join("=") }];
      const grantsAfter = (await db.query(`SELECT privilege_type, column_name FROM information_schema.column_privileges
        WHERE table_schema='dream_gemini_credentials' AND table_name='style_dna_generation_credentials' AND grantee='dream_gemini_app' ORDER BY 2,1`)).rows;
      assert.equal(grantsAfter.length, grants.length);
      // 등록: 형식 오류 422, 정상 200(공급자 호출 0). BytePlus 키 버전은 그대로이고 다른 계정은 미등록.
      const bflBad = await call(genPath, { method: "PUT", body: { provider: "bfl", expectedVersion: 0, apiKey: `${bflKeys[0]}\n` } });
      const callsBeforeBfl = (await readCalls()).length;
      const bflSaved = await call(genPath, { method: "PUT", body: { provider: "bfl", expectedVersion: 0, apiKey: bflKeys[0] } });
      assert.deepEqual([code(bflBad), bflSaved.status, bflSaved.body.provider, (bflSaved.body.setting as { version: number }).version], ["422:invalid_key", 200, "bfl", 1]);
      assert.equal((await readCalls()).length, callsBeforeBfl, "no provider call on BFL registration");
      const bothGet = (await call(genPath)).body.providers as Record<string, { configured: boolean; version: number }>;
      assert.deepEqual([bothGet.byteplus.version, bothGet.bfl.configured, bothGet.bfl.version, await byteplusVersion()], [byteplusBefore, true, 1, byteplusBefore]);
      const otherBfl = ((await call(genPath, { actor: 1 })).body.providers as Record<string, { configured: boolean }>).bfl.configured;
      assert.equal(otherBfl, false);
      const [bflRow] = (await db.query("SELECT ciphertext FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider='bfl'")).rows;
      assert.equal(bflRow.ciphertext.includes(Buffer.from(bflKeys[0])), false);
      const listWithFlux = generation(await call(listPath)) as unknown as { id: string; credentialVersion: number }[];
      assert.deepEqual(listWithFlux.map(item => `${item.id}:${item.credentialVersion}`).sort(), [`flux-2-pro:1`, `seedream-5.5:${byteplusBefore}`]);
      // 생성(FLUX.2, 버전 1): 201, BFL 대역 POST 1회(그 키), BytePlus 호출 수는 그대로. 같은 번호 재요청 200(호출 없음).
      const byteplusCallsBefore = (await byteplusCalls()).length;
      // 앞 단계의 미확정 Seedream 생성이 기존 기록을 막고 있으므로(설계대로 409) 새 기록에서 생성한다.
      const bflRecord = "0190b0b0-0000-7000-8000-00000000d003", bflTestPath = `/api/admin/style-dna/${bflRecord}/test-image`;
      await db.query("INSERT INTO dream_style_dna.records(owner_id,id,revision,document) VALUES($1,$2,2,$3::jsonb)",
        [A, bflRecord, JSON.stringify({ ...document, id: bflRecord })]);
      const fluxId = randomUUID();
      const fluxCreated = await call(bflTestPath, { method: "POST", body: flux(1, fluxId) });
      assert.equal(fluxCreated.status, 201, fluxCreated.text);
      assert.equal(fluxCreated.body.model, "flux-2-pro");
      const fluxReplay = await call(bflTestPath, { method: "POST", body: flux(1, fluxId) });
      assert.deepEqual([fluxReplay.status, fluxReplay.body], [200, fluxCreated.body]);
      const submitted = (await bflCalls()).filter(entry => entry.step === "submit");
      assert.deepEqual([submitted.map(entry => entry.key), (await byteplusCalls()).length], [[keyTag(bflKeys[0])], byteplusCallsBefore]);
      for (const key of bflKeys) assert(!fluxCreated.text.includes(key));
      // 회전: BFL 1→2. 옛 버전 FLUX 요청은 409 stale_credential(호출 없음), 새 버전은 새 키로 1회. BytePlus 버전은 그대로.
      const bflRotated = await call(genPath, { method: "PUT", body: { provider: "bfl", expectedVersion: 1, apiKey: bflKeys[1] } });
      const fluxStale = await call(bflTestPath, { method: "POST", body: flux(1) });
      assert.deepEqual([bflRotated.status, code(fluxStale), (await bflCalls()).filter(entry => entry.step === "submit").length], [200, "409:stale_credential", 1]);
      const fluxFresh = await call(bflTestPath, { method: "POST", body: flux(2) });
      assert.equal(fluxFresh.status, 201, fluxFresh.text);
      assert.deepEqual([(await bflCalls()).filter(entry => entry.step === "submit").map(entry => entry.key), await byteplusVersion()],
        [[keyTag(bflKeys[0]), keyTag(bflKeys[1])], byteplusBefore]);
      // 대역이 모르는 키: provider_rejected(키 원문 없음).
      await call(genPath, { method: "PUT", body: { provider: "bfl", expectedVersion: 2, apiKey: bflKeys[2] } });
      const fluxRejected = await call(bflTestPath, { method: "POST", body: flux(3) });
      assert.equal(code(fluxRejected).split(":")[0], "502", fluxRejected.text);
      assert(!fluxRejected.text.includes(bflKeys[2]));
      // 롤백: BFL 키가 남아 있으면 멈추고(바뀜 없음), 키를 지운 뒤에는 0004 목록으로 돌아간다. BytePlus 키는 그대로 쓸 수 있다.
      const rollback5 = await sqlFile("analysis-credentials/rollback_0005.sql");
      await assert.rejects(db.query(rollback5), /STYLE_DNA_GENERATION_ROLLBACK_BFL_KEYS/);
      await db.query("ROLLBACK").catch(() => undefined);
      assert.equal((await bflRows()).length, 1);
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials NO FORCE ROW LEVEL SECURITY");
      await db.query("DELETE FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider='bfl'");
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials FORCE ROW LEVEL SECURITY");
      await db.query(rollback5);
      const afterRollback = await checksOf();
      const rolledGet = (await call(genPath)).body.providers as Record<string, { configured: boolean; version: number }>;
      const rolledPut = await call(genPath, { method: "PUT", body: { provider: "bfl", expectedVersion: 0, apiKey: bflKeys[0] } });
      assert.deepEqual([afterRollback, rolledGet.byteplus.version, rolledGet.bfl.configured, code(rolledPut)],
        [checks0004, byteplusBefore, false, "503:storage_unavailable"]);
      await assert.rejects(db.query(rollback5), /STYLE_DNA_GENERATION_ROLLBACK_NOT_INSTALLED/); // 설치되지 않은 상태에서 되돌리기는 멈춘다
      await db.query("ROLLBACK").catch(() => undefined);
      assert.deepEqual(await checksOf(), checks0004);
      await db.query(install5); // 다시 설치
      assert.deepEqual(await checksOf(), checks0005);
      // 기본 제약 정의가 예상과 다르면 설치는 아무것도 바꾸지 않고 멈춘다.
      await db.query(rollback5);
      await db.query(`ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT style_dna_generation_credentials_provider_check,
        ADD CONSTRAINT style_dna_generation_credentials_provider_check CHECK (provider IN ('byteplus','other'))`);
      const oddBase = await checksOf();
      await assert.rejects(db.query(install5), /STYLE_DNA_GENERATION_0005_UNEXPECTED_BASE_CHECK/);
      await db.query("ROLLBACK").catch(() => undefined);
      assert.deepEqual(await checksOf(), oddBase);
      await db.query(`ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT style_dna_generation_credentials_provider_check,
        ADD CONSTRAINT style_dna_generation_credentials_provider_check CHECK (provider IN ('byteplus'))`);
      await db.query(install5);
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT p202_provider_probe, DROP CONSTRAINT tester_byteplus_version_ceiling");
      out("bfl-credential", { stage: "http+seed", before0005: code(before0005), install0005: sha(install5.replaceAll("\r\n", "\n")),
        rollback0005: sha(rollback5.replaceAll("\r\n", "\n")), reinstallIdempotent: true, providerCheck: providerChecks[0].def, appColumnPrivileges: grantsAfter.length,
        register: { badKey: code(bflBad), saved: "200 version 1", providerCallsOnRegister: 0, byteplusVersionUnchanged: byteplusBefore, otherAccount: "unconfigured" },
        generate: { created: fluxCreated.status, replay: fluxReplay.status, staleOldVersion: code(fluxStale), rotatedNewKey: fluxFresh.status,
          unknownKey: code(fluxRejected), bflSubmits: 2, byteplusCallsAdded: 0 },
        rollback: { blockedWithBflKeys: "STYLE_DNA_GENERATION_ROLLBACK_BFL_KEYS", afterKeysRemoved: afterRollback, bflPutAfterRollback: code(rolledPut),
          notInstalled: "STYLE_DNA_GENERATION_ROLLBACK_NOT_INSTALLED" },
        scope: { before: checks0004, afterInstall: checks0005, unrelatedProviderCheckKept: true, unexpectedBase: "STYLE_DNA_GENERATION_0005_UNEXPECTED_BASE_CHECK" } });

      // 13) GPT Image 2.6(P2-02 GPT Image 서버 계약). 키 표 0006 전: openai PUT은 저장되지 않는다(503, 행 0, 공급자 0).
      const gptCalls = async () => (await readCalls()).filter(entry => entry.kind === "openai-image");
      const gpt = (credentialVersion: number, requestId: string = randomUUID(), extra: Record<string, unknown> = {}) => ({ requestId, authorized: true,
        credentialVersion, revision: 2, model: "gpt-image-2.6", subject: "a red bicycle", billing: "usage_based", ...extra });
      const openaiRows = async () => (await db.query("SELECT version FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider='openai'")).rows;
      const engineVersion = async () => ((await call("/api/admin/style-dna/engine-credentials")).body.providers as { openai: { version: number } }).openai.version;
      const engineBefore = await engineVersion(), bflAfter = (await bflRows()).length;
      const before0006 = await call(genPath, { method: "PUT", body: { provider: "openai", expectedVersion: 0, apiKey: openaiGenKeys[0] } });
      assert.deepEqual([code(before0006), (await openaiRows()).length, (await gptCalls()).length], ["503:storage_unavailable", 0, 0]);
      const install6 = await sqlFile("analysis-credentials/0006_openai_generation.sql");
      const rollback6 = await sqlFile("analysis-credentials/rollback_0006.sql");
      await db.query(`ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials
        ADD CONSTRAINT tester_byteplus_version_ceiling CHECK (provider <> 'byteplus' OR version < 1000000)`);
      const checks0005Live = await checksOf();
      await assert.rejects(db.query(rollback6), /STYLE_DNA_GENERATION_ROLLBACK_0006_NOT_INSTALLED/);
      await db.query("ROLLBACK").catch(() => undefined);
      await db.query(install6);
      await db.query(install6);
      const checks0006 = await checksOf();
      const ceiling6 = "tester_byteplus_version_ceiling=CHECK (((provider <> 'byteplus'::text) OR (version < 1000000)))";
      assert.deepEqual(checks0006, ["style_dna_generation_provider=CHECK ((provider = ANY (ARRAY['byteplus'::text, 'bfl'::text, 'openai'::text])))", ceiling6]);
      assert.deepEqual(checks0005Live, ["style_dna_generation_provider=CHECK ((provider = ANY (ARRAY['byteplus'::text, 'bfl'::text])))", ceiling6]);
      const grants6 = (await db.query(`SELECT privilege_type, column_name FROM information_schema.column_privileges
        WHERE table_schema='dream_gemini_credentials' AND table_name='style_dna_generation_credentials' AND grantee='dream_gemini_app' ORDER BY 2,1`)).rows;
      assert.equal(grants6.length, grants.length);
      // 등록: 형식 오류 422, 정상 200(공급자 호출 0). 분석 엔진 OpenAI 키 버전·BytePlus 버전은 그대로, 다른 계정은 미등록.
      const openaiBad = await call(genPath, { method: "PUT", body: { provider: "openai", expectedVersion: 0, apiKey: `${openaiGenKeys[0]}\n` } });
      const callsBeforeOpenai = (await readCalls()).length;
      const openaiSaved = await call(genPath, { method: "PUT", body: { provider: "openai", expectedVersion: 0, apiKey: openaiGenKeys[0] } });
      assert.deepEqual([code(openaiBad), openaiSaved.status, openaiSaved.body.provider, (openaiSaved.body.setting as { version: number }).version],
        ["422:invalid_key", 200, "openai", 1]);
      assert.equal((await readCalls()).length, callsBeforeOpenai, "no provider call on OpenAI generation key registration");
      const threeGet = (await call(genPath)).body.providers as Record<string, { configured: boolean; version: number }>;
      assert.deepEqual([Object.keys(threeGet), threeGet.openai.configured, threeGet.openai.version, threeGet.byteplus.version, await engineVersion()],
        [["byteplus", "bfl", "openai"], true, 1, byteplusBefore, engineBefore]);
      assert.equal(((await call(genPath, { actor: 1 })).body.providers as Record<string, { configured: boolean }>).openai.configured, false);
      const [openaiRow] = (await db.query("SELECT ciphertext FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider='openai'")).rows;
      assert.equal(openaiRow.ciphertext.includes(Buffer.from(openaiGenKeys[0])), false);
      const listWithGpt = generation(await call(listPath)) as unknown as { id: string; credentialVersion: number; estimate: Record<string, unknown> }[];
      const gptRow = listWithGpt.find(item => item.id === "gpt-image-2.6");
      assert.deepEqual([listWithGpt.map(item => item.id).sort(), gptRow?.credentialVersion, gptRow?.estimate],
        [["gpt-image-2.6", "seedream-5.5"], 1, { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11-27", currency: "USD", unit: "micros" }]);
      // 원장 0005(Style DNA) 전: 생성 요청은 예약 단계에서 막혀 공급자에 가지 않는다.
      const gptRecord = "0190b0b0-0000-7000-8000-00000000d004", gptTestPath = `/api/admin/style-dna/${gptRecord}/test-image`;
      await db.query("INSERT INTO dream_style_dna.records(owner_id,id,revision,document) VALUES($1,$2,2,$3::jsonb)",
        [A, gptRecord, JSON.stringify({ ...document, id: gptRecord })]);
      const beforeLedger = await call(gptTestPath, { method: "POST", body: gpt(1) });
      assert.equal(beforeLedger.status >= 500, true, beforeLedger.text);
      assert.equal((await gptCalls()).length, 0);
      const ledger5 = await sqlFile("style-dna/0005_gpt_image_request_model.sql");
      await db.query(ledger5);
      await db.query(ledger5);
      // 생성(버전 1): 201, OpenAI 대역 1회(생성 키, 분석 엔진 키 아님), 금액 재확인 없음, 실제 금액은 usage로만. 같은 번호 재요청 200.
      const gptId = randomUUID();
      const gptCreated = await call(gptTestPath, { method: "POST", body: gpt(1, gptId) });
      assert.equal(gptCreated.status, 201, gptCreated.text);
      const made = (gptCreated.body.test as { generation: Record<string, unknown> }).generation;
      assert.deepEqual([gptCreated.body.model, made.provider, made.modelId, made.usage, made.estimate, made.actualCostMicros, made.billing],
        ["gpt-image-2.6", "openai", "gpt-image-2.6-sunburst", { generatedImages: 1, inputTokens: 100, inputImageTokens: 20, outputTokens: 1000 },
          { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11-27", currency: "USD", unit: "micros", referenceCount: 0 },
          100 * 5 + 20 * 8 + 1000 * 30, "unconfirmed"]);
      const gptReplay = await call(gptTestPath, { method: "POST", body: gpt(1, gptId) });
      assert.deepEqual([gptReplay.status, gptReplay.body], [200, gptCreated.body]);
      const sentGpt = await gptCalls();
      assert.deepEqual(sentGpt.map(entry => [entry.key, entry.path, entry.model]), [[keyTag(openaiGenKeys[0]), "/v1/images/generations", "gpt-image-2.6-sunburst"]]);
      for (const secret of [...openaiGenKeys, "synthetic_openai_key_00000000001"]) assert(!gptCreated.text.includes(secret));
      const ledgerRow = (await db.query("SELECT generation_model FROM dream_style_dna.requests WHERE id=$1", [gptId])).rows;
      assert.deepEqual(ledgerRow, [{ generation_model: "gpt-image-2.6" }]);
      // 금액 칸 혼용은 400(호출 0). 회전 1→2: 옛 버전 409, 새 키 201. 대역이 모르는 키는 502. 참조(edits) 경로는 vitest HTTP 결합 시험이 맡는다(합성 기록에 원본 미디어 없음).
      const mixed = await call(gptTestPath, { method: "POST", body: gpt(1, randomUUID(), { expectedCostMicros: 0 }) });
      const gptRotated = await call(genPath, { method: "PUT", body: { provider: "openai", expectedVersion: 1, apiKey: openaiGenKeys[1] } });
      const gptStale = await call(gptTestPath, { method: "POST", body: gpt(1) });
      assert.deepEqual([code(mixed), gptRotated.status, code(gptStale), (await gptCalls()).length], ["400:invalid_input", 200, "409:stale_credential", 1]);
      const gptFresh = await call(gptTestPath, { method: "POST", body: gpt(2) });
      assert.equal(gptFresh.status, 201, gptFresh.text);
      assert.equal(((gptFresh.body.test as { generation: { estimate: { referenceCount: number } } }).generation.estimate.referenceCount), 0);
      assert.deepEqual((await gptCalls()).map(entry => [entry.key, entry.path, entry.images]),
        [[keyTag(openaiGenKeys[0]), "/v1/images/generations", 0], [keyTag(openaiGenKeys[1]), "/v1/images/generations", 0]]);
      await call(genPath, { method: "PUT", body: { provider: "openai", expectedVersion: 2, apiKey: openaiGenKeys[2] } });
      const gptRejected = await call(gptTestPath, { method: "POST", body: gpt(3) });
      assert.equal(code(gptRejected), "502:provider_rejected", gptRejected.text);
      assert(!gptRejected.text.includes(openaiGenKeys[2]));
      assert.deepEqual([await engineVersion(), await byteplusVersion(), (await bflRows()).length], [engineBefore, byteplusBefore, bflAfter]);
      // 롤백: 원장은 gpt-image-2.6 기록이 있으면 멈추고, 키 표는 OpenAI 키가 있으면 멈춘다(둘 다 바뀜 없음).
      const ledgerRollback = await sqlFile("style-dna/rollback_0005_gpt_image_request_model.sql");
      await assert.rejects(db.query(ledgerRollback), /STYLE_DNA_GPT_IMAGE_HAS_HISTORY/);
      await db.query("ROLLBACK").catch(() => undefined);
      await assert.rejects(db.query(rollback6), /STYLE_DNA_GENERATION_ROLLBACK_OPENAI_KEYS/);
      await db.query("ROLLBACK").catch(() => undefined);
      assert.deepEqual([await checksOf(), (await openaiRows()).length], [checks0006, 1]);
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials NO FORCE ROW LEVEL SECURITY");
      await db.query("DELETE FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider='openai'");
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials FORCE ROW LEVEL SECURITY");
      await db.query(rollback6);
      const afterRollback6 = await checksOf();
      const rolled6 = (await call(genPath)).body.providers as Record<string, { configured: boolean }>;
      const rolledPut6 = await call(genPath, { method: "PUT", body: { provider: "openai", expectedVersion: 0, apiKey: openaiGenKeys[0] } });
      assert.deepEqual([afterRollback6, rolled6.openai.configured, code(rolledPut6), await byteplusVersion()],
        [checks0005Live, false, "503:storage_unavailable", byteplusBefore]);
      await db.query(install6);
      assert.deepEqual(await checksOf(), checks0006);
      await db.query("ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT tester_byteplus_version_ceiling");
      out("gpt-image", { stage: "http+seed", before0006: code(before0006), install0006: sha(install6.replaceAll("\r\n", "\n")),
        rollback0006: sha(rollback6.replaceAll("\r\n", "\n")), ledger0005: sha(ledger5.replaceAll("\r\n", "\n")),
        ledgerRollback0005: sha(ledgerRollback.replaceAll("\r\n", "\n")), checksAfter0006: checks0006, appColumnPrivileges: grants6.length,
        register: { badKey: code(openaiBad), saved: "200 version 1", providerCallsOnRegister: 0, engineOpenaiVersionUnchanged: engineBefore,
          byteplusVersionUnchanged: byteplusBefore, otherAccount: "unconfigured" },
        list: gptRow?.estimate, beforeLedger0005: code(beforeLedger),
        generate: { created: gptCreated.status, replay: gptReplay.status, actualCostMicros: made.actualCostMicros, mixedCost: code(mixed),
          staleOldVersion: code(gptStale), rotatedNewKey: gptFresh.status, unknownKey: code(gptRejected), openaiSubmits: 2,
          usedEngineKey: false },
        rollback: { ledgerBlocked: "STYLE_DNA_GPT_IMAGE_HAS_HISTORY", keysBlocked: "STYLE_DNA_GENERATION_ROLLBACK_OPENAI_KEYS",
          notInstalled: "STYLE_DNA_GENERATION_ROLLBACK_0006_NOT_INSTALLED", afterKeysRemoved: afterRollback6, openaiPutAfterRollback: code(rolledPut6) } });
    });
    console.log(JSON.stringify({ result: "PASS", scope: "style-dna-generation-runtime" }));
  } catch (error) {
    const log = await fs.readFile(join(root, "postgres.log"), "utf8").catch(() => "");
    console.error(log.split(/\r?\n/).filter(line => / (?:ERROR|FATAL):/.test(line)).slice(-12).join("\n"));
    throw error;
  } finally {
    await new Promise<void>(resolve => { if (!authServer) return resolve(); authServer.closeAllConnections?.(); authServer.close(() => resolve()); });
    if (linked) await fs.unlink(modules);
    await admin?.end().catch(() => undefined);
    if (started) await pgExec("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "50", "stop"]);
    if (appRoot !== root) {
      const actualAppRoot = await fs.realpath(appRoot);
      assert.equal(dirname(actualAppRoot), appParent);
      assert.match(basename(actualAppRoot), /^dream-p202g-web-[A-Za-z0-9]+$/);
      await fs.rm(actualAppRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
    const actual = await fs.realpath(root);
    assert.equal(dirname(actual), parent);
    assert.match(basename(actual), /^dream-p202g-[A-Za-z0-9]+$/);
    await fs.rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    console.log(JSON.stringify({ check: "cleanup", clusterStopped: started, junctionRemoved: linked, tempRemoved: true }));
  }
}

// Next 프로세스 안 합성 전송: DB 주소는 격리 클러스터로, Auth는 HTTPS 대역으로, 공급자 세 곳은 합성 응답으로, 나머지 바깥 요청은 거절.
const preloadSource = `const net=require("node:net"),https=require("node:https"),fs=require("node:fs"),crypto=require("node:crypto");
const setup=JSON.parse(process.env.P202_SYNTHETIC);
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  if(args[0]&&typeof args[0]==="object"&&args[0].host===setup.dbHost&&Number(args[0].port)===5432){args[0]={...args[0],host:"127.0.0.1",port:setup.dbPort};}
  else if(args[1]===setup.dbHost&&Number(args[0])===5432){args[0]=setup.dbPort;args[1]="127.0.0.1";}
  return connect.apply(this,args);
};
const original=globalThis.fetch;
const log=entry=>fs.appendFileSync(setup.calls,JSON.stringify(entry)+"\\n");
const keyOf=request=>{const v=(request.headers.get("authorization")||"").replace(/^Bearer /,"")||request.headers.get("x-goog-api-key")||request.headers.get("x-key")||"";return crypto.createHash("sha256").update(v).digest("hex").slice(0,16);};
globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.origin===setup.appOrigin)return original(input,init);
  if(url.origin==="https://ark.ap-southeast.bytepluses.com"&&url.pathname==="/api/v3/images/generations"&&request.method==="POST"){
    const body=JSON.parse(await request.text());
    const c=JSON.parse(fs.readFileSync(setup.control,"utf8"));
    log({kind:"byteplus",key:keyOf(request),model:body.model,size:body.size,hasImage:typeof body.image==="string",prompt:String(body.prompt||"").length});
    if(c.delayMs)await new Promise(r=>setTimeout(r,c.delayMs));
    if(!setup.keys.includes(keyOf(request)))return Response.json({error:{code:"AuthenticationError"}},{status:401});
    return Response.json({model:body.model,created:1784696685,usage:{generated_images:1,output_tokens:4096},data:[{b64_json:fs.readFileSync(setup.png,"utf8"),size:"1024x1024",output_format:"png"}]});
  }
  if(url.origin==="https://api.bfl.ai"&&url.pathname==="/v1/flux-2-pro"&&request.method==="POST"){
    const body=JSON.parse(await request.text());
    log({kind:"bfl",step:"submit",key:keyOf(request),width:body.width,height:body.height,hasImage:typeof body.input_image==="string"});
    if(!setup.keys.includes(keyOf(request)))return Response.json({detail:"Not authenticated"},{status:403});
    const id=crypto.randomUUID();
    return Response.json({id,polling_url:"https://api.bfl.ai/v1/get_result?id="+id});
  }
  if(url.origin==="https://api.bfl.ai"&&url.pathname==="/v1/get_result"&&request.method==="GET"){
    log({kind:"bfl",step:"poll",key:keyOf(request)});
    const id=url.searchParams.get("id");
    return Response.json({id,status:"Ready",result:{sample:"https://delivery.eu1.bfl.ai/results/"+id+"/sample.png?sig=synthetic"}});
  }
  if(url.origin==="https://delivery.eu1.bfl.ai"&&request.method==="GET"){
    log({kind:"bfl",step:"download",key:keyOf(request)});
    return new Response(Buffer.from(fs.readFileSync(setup.png,"utf8"),"base64"),{headers:{"content-type":"image/png"}});
  }
  if(url.origin==="https://api.openai.com"&&(url.pathname==="/v1/images/generations"||url.pathname==="/v1/images/edits")&&request.method==="POST"){
    const body=JSON.parse(await request.text());
    log({kind:"openai-image",key:keyOf(request),path:url.pathname,model:body.model,size:body.size,images:Array.isArray(body.images)?body.images.length:0});
    if(!setup.keys.includes(keyOf(request)))return Response.json({error:{code:"invalid_api_key",type:"invalid_request_error"}},{status:401});
    return Response.json({created:1795000000,data:[{b64_json:fs.readFileSync(setup.png,"utf8")}],
      usage:{input_tokens:120,input_tokens_details:{text_tokens:100,image_tokens:20},output_tokens:1000,total_tokens:1120}});
  }
  if(url.origin==="https://api.openai.com"&&url.pathname.startsWith("/v1/models/")&&request.method==="GET"){
    log({kind:"openai",key:keyOf(request)});return Response.json({id:decodeURIComponent(url.pathname.slice(11))});
  }
  if(url.origin==="https://generativelanguage.googleapis.com"&&/^\\/v1beta\\/models\\/[^:]+$/.test(url.pathname)&&request.method==="GET"){
    log({kind:"google",key:keyOf(request)});const model=url.pathname.split("/").pop();return Response.json({name:"models/"+model,supportedGenerationMethods:["generateContent"]});
  }
  if(url.origin!==setup.authOrigin||url.pathname!=="/auth/v1/user"||request.method!=="GET"){log({kind:"refused",origin:url.origin});throw new Error("Outbound fetch refused by the synthetic transport");}
  return await new Promise((resolve,reject)=>{
    const outgoing=https.request({hostname:"127.0.0.1",port:setup.authPort,servername:url.hostname,path:url.pathname,method:"GET",
      ca:fs.readFileSync(setup.cert),rejectUnauthorized:true,agent:false,headers:Object.fromEntries(request.headers)},response=>{
      const chunks=[];response.on("data",c=>chunks.push(c));response.once("error",reject);
      response.once("end",()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
    outgoing.setTimeout(5000,()=>outgoing.destroy(new Error("auth timeout")));outgoing.once("error",reject);outgoing.end();
  });
};
`;

if (process.argv.includes("--generation-runtime")) await runGenerationRuntime();
