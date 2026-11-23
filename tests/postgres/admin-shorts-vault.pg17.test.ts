import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { shortsVaultProjectLimit, shortsVaultPromptSetLimit } from "@/lib/reference-analysis/shorts-vault-contract";
import { createShortsVaultHttp } from "@/lib/reference-analysis/shorts-vault-http";
import { createShortsVaultStore } from "@/lib/reference-analysis/shorts-vault-store";
import { projectDocument, promptSetDocument, searchablePromptSet } from "../reference-analysis/admin-shorts-vault-fixture";

vi.mock("server-only", () => ({}));

// P1-08-SHORTS-VAULT 격리 PG17 검수. 실행: P108_PG_BIN=<PostgreSQL 17 bin> npx vitest run tests/postgres/admin-shorts-vault.pg17.test.ts
// 임시 클러스터(127.0.0.1, scram)만 쓰고 끝나면 지운다. 운영·Supabase 접속 없음.
const bin = process.env.P108_PG_BIN;
const run = promisify(execFile);
const site = "https://studio.example.invalid";
const ownerA = "20000000-0000-4000-8000-00000000000a";
const ownerB = "20000000-0000-4000-8000-00000000000b";
const secret = randomBytes(18).toString("base64url");
const appSecret = randomBytes(18).toString("base64url");
let root = "", data = "", port = 0, started = false;
let admin: Client, appPool: Pool;
let auth: ServerAuthResult = { kind: "verified", userId: ownerA, email: "a@example.invalid" };
let http: ReturnType<typeof createShortsVaultHttp>;

const exe = (name: string) => join(bin!, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("port")));
  });
});
const req = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new Request(site + path, { method, headers: { origin: site, host: "studio.example.invalid", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
const route = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (userId: string) => { auth = { kind: "verified", userId, email: "x@example.invalid" }; };

describe.skipIf(!bin)("Shorts vault on isolated PostgreSQL 17", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "dream-p108-vault-"));
    data = join(root, "data");
    const pw = join(root, "pw");
    await writeFile(pw, secret);
    await run(exe("initdb"), ["-D", data, "--username=p108_root", `--pwfile=${pw}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
    port = await freePort();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe("pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start"],
        { stdio: "ignore", windowsHide: true });
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(`pg_ctl ${code}`)));
    });
    started = true;
    admin = new Client({ host: "127.0.0.1", port, database: "postgres", user: "p108_root", password: secret });
    admin.on("error", () => undefined);
    await admin.connect();
    // 설치 역할은 슈퍼유저가 아니다(운영 Supabase의 설치 계정처럼 CREATEROLE + DB CREATE만).
    await admin.query(`CREATE ROLE p108_install LOGIN PASSWORD '${secret}' NOSUPERUSER NOBYPASSRLS CREATEROLE NOINHERIT;
      GRANT CREATE ON DATABASE postgres TO p108_install`);
    const installer = new Client({ host: "127.0.0.1", port, database: "postgres", user: "p108_install", password: secret });
    installer.on("error", () => undefined);
    await installer.connect();
    const sql = await readFile("lib/db/postgres/admin-shorts-vault/0001_install.sql", "utf8");
    await installer.query(sql);
    await expect(installer.query(sql)).rejects.toThrow(/SHORTS_VAULT_INSTALL_TARGET/);
    await installer.query("ROLLBACK");
    await installer.query(`ALTER ROLE dream_shorts_vault_app LOGIN PASSWORD '${appSecret}'`);
    await installer.end();
    appPool = new Pool({ host: "127.0.0.1", port, database: "postgres", user: "dream_shorts_vault_app", password: appSecret, max: 4 });
    appPool.on("error", () => undefined);
    const store = createShortsVaultStore(appPool);
    http = createShortsVaultHttp({ env: { DREAM_SITE_URL: site }, store: () => store, authenticate: async () => auth });
  }, 120_000);

  afterAll(async () => {
    await appPool?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (started) await run(exe("pg_ctl"), ["-D", data, "-m", "fast", "-w", "-t", "50", "stop"]).catch(() => undefined);
    if (root) await rm(root, { recursive: true, force: true });
  }, 120_000);

  it("installs forced RLS and only the intended grants", async () => {
    const { rows } = await admin.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream_shorts_vault' AND c.relkind='r' ORDER BY 1`);
    expect(rows).toEqual(["projects", "prompt_sets", "requests"].map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    const { rows: grants } = await admin.query(`SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee='dream_shorts_vault_app' ORDER BY 1,2`);
    expect(grants.map(row => `${row.table_name}:${row.privilege_type}`)).toEqual([
      "projects:DELETE", "projects:INSERT", "projects:SELECT", "prompt_sets:DELETE", "prompt_sets:INSERT", "prompt_sets:SELECT",
      "requests:DELETE", "requests:INSERT", "requests:SELECT"]);
    const { rows: [role] } = await admin.query(`SELECT rolsuper, rolbypassrls, rolcreaterole, rolinherit FROM pg_roles WHERE rolname='dream_shorts_vault_app'`);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolinherit: false });
  });

  it("refuses a pool that is not the dedicated role", async () => {
    const wrong = new Pool({ host: "127.0.0.1", port, database: "postgres", user: "p108_install", password: secret, max: 1 });
    const store = createShortsVaultStore(wrong);
    await expect(store.listPromptSets(ownerA)).rejects.toThrow(/Invalid Shorts vault role/);
    await wrong.end();
  });

  it("saves, lists, opens and deletes prompt sets per owner with request de-duplication", async () => {
    as(ownerA);
    const requestId = randomUUID();
    const first = await http.createPromptSet(req("/api/admin/shorts-vault/prompts", "POST", { requestId, document: promptSetDocument() }));
    expect(first.status).toBe(201);
    const { promptSet } = await first.json();
    expect(promptSet).toMatchObject({ title: "전후 비교 프롬프트", sceneCount: 3, hasBgm: true });
    const replay = await http.createPromptSet(req("/api/admin/shorts-vault/prompts", "POST", { requestId, document: promptSetDocument() }));
    expect(replay.status).toBe(201);
    expect((await replay.json()).promptSet.id).toBe(promptSet.id);
    const conflict = await http.createPromptSet(req("/api/admin/shorts-vault/prompts", "POST",
      { requestId, document: { ...promptSetDocument(), title: "다른 제목" } }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ code: "request_conflict" });
    const list = await (await http.listPromptSets()).json();
    expect(list.promptSets.map((set: { id: string }) => set.id)).toEqual([promptSet.id]);
    const opened = await (await http.getPromptSet(route(promptSet.id))).json();
    expect(opened.promptSet.document).toEqual(promptSetDocument());

    as(ownerB);
    expect((await (await http.listPromptSets()).json()).promptSets).toEqual([]);
    expect((await http.getPromptSet(route(promptSet.id))).status).toBe(404);
    expect((await http.deletePromptSet(req("/x", "DELETE"), route(promptSet.id))).status).toBe(404);
    const crossReplay = await http.createPromptSet(req("/api/admin/shorts-vault/prompts", "POST", { requestId, document: promptSetDocument() }));
    expect(crossReplay.status).toBe(201);
    expect((await crossReplay.json()).promptSet.id).not.toBe(promptSet.id);

    as(ownerA);
    expect((await http.deletePromptSet(req("/x", "DELETE"), route(promptSet.id))).status).toBe(204);
    expect((await http.getPromptSet(route(promptSet.id))).status).toBe(404);
  });

  it("stops at 200 prompt sets per owner without affecting another owner", async () => {
    const owner = "20000000-0000-4000-8000-0000000000c1";
    as(owner);
    await admin.query("BEGIN");
    await admin.query("SET LOCAL row_security=off");
    await admin.query(`INSERT INTO dream_shorts_vault.prompt_sets(owner_id,id,document)
      SELECT $1, gen_random_uuid(), $2::jsonb FROM generate_series(1,$3)`, [owner, JSON.stringify(promptSetDocument()), shortsVaultPromptSetLimit - 1]);
    await admin.query("COMMIT");
    expect((await http.createPromptSet(req("/p", "POST", { requestId: randomUUID(), document: promptSetDocument() }))).status).toBe(201);
    const full = await http.createPromptSet(req("/p", "POST", { requestId: randomUUID(), document: promptSetDocument() }));
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ code: "limit_reached" });
    expect((await (await http.listPromptSets()).json()).promptSets).toHaveLength(shortsVaultPromptSetLimit);
    as(ownerB);
    expect((await http.createPromptSet(req("/p", "POST", { requestId: randomUUID(), document: promptSetDocument() }))).status).toBe(201);
  });

  it("keeps projects for 30 days, versions overwrites and hides other owners", async () => {
    as(ownerA);
    const created = await http.createProject(req("/p", "POST", { requestId: randomUUID(), document: projectDocument() }));
    expect(created.status).toBe(201);
    const { project } = await created.json();
    expect(project.revision).toBe(1);
    expect(new Date(project.expiresAt).getTime() - new Date(project.createdAt).getTime()).toBe(30 * 86_400_000);
    const replaced = await http.replaceProject(req("/p", "PUT", { expectedRevision: 1, document: projectDocument(4) }), route(project.id));
    expect(replaced.status).toBe(200);
    const next = (await replaced.json()).project;
    expect(next).toMatchObject({ revision: 2, step: 4, createdAt: project.createdAt, expiresAt: project.expiresAt });
    const stale = await http.replaceProject(req("/p", "PUT", { expectedRevision: 1, document: projectDocument(5) }), route(project.id));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: "stale_revision", revision: 2 });
    expect((await (await http.getProject(route(project.id))).json()).project.document).toEqual(projectDocument(4));

    as(ownerB);
    expect((await http.getProject(route(project.id))).status).toBe(404);
    expect((await http.replaceProject(req("/p", "PUT", { expectedRevision: 2, document: projectDocument(6) }), route(project.id))).status).toBe(404);
    expect((await http.deleteProject(req("/p", "DELETE"), route(project.id))).status).toBe(404);
    as(ownerA);
    expect((await (await http.getProject(route(project.id))).json()).project.revision).toBe(2);
  });

  it("purges expired projects before every project operation and refuses to revive them", async () => {
    as(ownerA);
    const { project } = await (await http.createProject(req("/p", "POST", { requestId: randomUUID(), document: projectDocument() }))).json();
    await admin.query("BEGIN");
    await admin.query("SET LOCAL row_security=off");
    await admin.query(`UPDATE dream_shorts_vault.projects p SET created_at=t.at, expires_at=t.at+interval '30 days'
      FROM (SELECT clock_timestamp()-interval '31 days' AS at) t WHERE p.id=$1`, [project.id]);
    await admin.query("COMMIT");
    expect((await http.replaceProject(req("/p", "PUT", { expectedRevision: 1, document: projectDocument(2) }), route(project.id))).status).toBe(404);
    expect((await http.getProject(route(project.id))).status).toBe(404);
    const { projects } = await (await http.listProjects()).json();
    expect(projects.some((item: { id: string }) => item.id === project.id)).toBe(false);
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM dream_shorts_vault.projects WHERE id=$1", [project.id]);
    expect(rows[0].n).toBe(0);
    // The database itself refuses a project row that is already expired or whose expiry is not created_at + 30 days.
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dream_shorts_vault.owner_id',$1,true)", [ownerA]);
      await expect(client.query(`INSERT INTO dream_shorts_vault.projects(owner_id,id,revision,document,created_at,updated_at,expires_at)
        VALUES($1,gen_random_uuid(),1,'{}',clock_timestamp()-interval '40 days',clock_timestamp(),clock_timestamp()-interval '10 days')`, [ownerA]))
        .rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('dream_shorts_vault.owner_id',$1,true)", [ownerA]);
      await expect(client.query(`INSERT INTO dream_shorts_vault.projects(owner_id,id,revision,document,created_at,updated_at,expires_at)
        VALUES($1,gen_random_uuid(),1,'{}',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '90 days')`, [ownerA]))
        .rejects.toThrow(/check constraint/);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('dream_shorts_vault.owner_id',$1,true)", [ownerA]);
      await expect(client.query(`INSERT INTO dream_shorts_vault.prompt_sets(owner_id,id,document) VALUES($1,gen_random_uuid(),'{}')`, [ownerB]))
        .rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK");
    } finally { client.release(); }
  });

  it("stops at 100 live projects per owner", async () => {
    const owner = "20000000-0000-4000-8000-0000000000c2";
    as(owner);
    await admin.query("BEGIN");
    await admin.query("SET LOCAL row_security=off");
    await admin.query(`INSERT INTO dream_shorts_vault.projects(owner_id,id,revision,document,created_at,updated_at,expires_at)
      SELECT $1, gen_random_uuid(), 1, $2::jsonb, now(), now(), now() + interval '30 days' FROM generate_series(1,$3)`,
    [owner, JSON.stringify(projectDocument()), shortsVaultProjectLimit]);
    await admin.query("COMMIT");
    const full = await http.createProject(req("/p", "POST", { requestId: randomUUID(), document: projectDocument() }));
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ code: "limit_reached" });
  });

  it("serializes concurrent creates with the same request id", async () => {
    as(ownerA);
    const requestId = randomUUID();
    const replies = await Promise.all(Array.from({ length: 4 }, () =>
      http.createProject(req("/p", "POST", { requestId, document: projectDocument() }))));
    expect(replies.map(reply => reply.status)).toEqual([201, 201, 201, 201]);
    const ids = new Set(await Promise.all(replies.map(async reply => (await reply.json()).project.id)));
    expect(ids.size).toBe(1);
  });
  // P1-08-SHORTS-VAULT-CONTENT-SEARCH-API: 실제 SQL·RLS 위의 내용 검색. 검색어는 매개변수, 필드마다 따로, 와일드카드 문자는 글자 그대로.
  it("searches each content field case-insensitively, literally and only within the owner's sets", async () => {
    const owner = "20000000-0000-4000-8000-0000000000d1";
    const other = "20000000-0000-4000-8000-0000000000d2";
    as(owner);
    const save = async (name: string, document: ReturnType<typeof searchablePromptSet>) => {
      const reply = await http.createPromptSet(req("/api/admin/shorts-vault/prompts", "POST", { requestId: randomUUID(), document }));
      expect(reply.status, name).toBe(201);
      return (await reply.json()).promptSet.id as string;
    };
    const ids = {
      title: await save("title", searchablePromptSet({ title: "캠핑 요리 세트" })),
      idea: await save("idea", searchablePromptSet({ ideaTitle: "새벽 러닝 루틴" })),
      hook: await save("hook", searchablePromptSet({ hook: "지금 100%_off 할인 끝나요" })),
      keyword: await save("keyword", searchablePromptSet({ keyword: "Home Cafe" })),
      suno: await save("suno", searchablePromptSet({ sunoPrompt: "Lo-Fi HipHop beat, 82 BPM" })),
      summary: await save("summary", searchablePromptSet({ sceneSummary: "손글씨 메모를 클로즈업한다" })),
      image: await save("image", searchablePromptSet({ imagePrompt: "Neon sign reads OPEN_24H at night" })),
      video: await save("video", searchablePromptSet({ videoPrompt: "Slow DOLLY zoom toward the cup" })),
      backslash: await save("backslash", searchablePromptSet({ hook: "경로 C:\\clips\\raw 정리", sunoPrompt: null })),
      span: await save("span", searchablePromptSet({ title: "앞필드끝", ideaTitle: "뒷필드시작" })),
    };
    const requestRows = async () => (await admin.query("SELECT count(*)::int AS n FROM dream_shorts_vault.requests WHERE owner_id=$1", [owner])).rows[0].n as number;
    const savedRequests = await requestRows();
    const find = async (query: string) => {
      const reply = await http.searchPromptSets(req("/api/admin/shorts-vault/prompts/search", "POST", { query }));
      expect(reply.status, query).toBe(200);
      expect(reply.headers.get("cache-control")).toBe("private, no-store");
      return reply;
    };
    const idsOf = async (query: string) => ((await (await find(query)).json()).promptSets as { id: string }[]).map(item => item.id);

    // 한글과 ASCII 대소문자: 각 필드에서 따로 맞는다.
    expect(await idsOf("캠핑 요리")).toEqual([ids.title]);
    expect(await idsOf("러닝")).toEqual([ids.idea]);
    expect(await idsOf("home cafe")).toEqual([ids.keyword]);
    expect(await idsOf("HOME CAFE")).toEqual([ids.keyword]);
    expect(await idsOf("lo-fi hiphop")).toEqual([ids.suno]);
    expect(await idsOf("클로즈업")).toEqual([ids.summary]);
    expect(await idsOf("open_24h")).toEqual([ids.image]);
    expect(await idsOf("dolly ZOOM")).toEqual([ids.video]);
    // %·_·\ 는 와일드카드가 아니라 글자다.
    expect(await idsOf("100%_off")).toEqual([ids.hook]);
    expect(await idsOf("%")).toEqual([ids.hook]);
    expect(await idsOf("_")).toEqual([ids.image, ids.hook]); // 최신순: image가 hook보다 나중에 저장됨
    expect(await idsOf("100_")).toEqual([]);
    expect(await idsOf("1%f")).toEqual([]);
    expect(await idsOf("D%Y")).toEqual([]);
    expect(await idsOf("O_EN")).toEqual([]);
    expect(await idsOf("C:\\clips")).toEqual([ids.backslash]);
    expect(await idsOf("\\")).toEqual([ids.backslash]);
    // 필드를 이어 붙여 맞추지 않는다.
    expect(await idsOf("앞필드끝뒷필드시작")).toEqual([]);
    expect(await idsOf("끝 뒷")).toEqual([]);
    // 검색어를 SQL로 해석하지 않는다.
    expect(await idsOf("' OR 1=1 --")).toEqual([]);
    expect(await idsOf("없는 검색어")).toEqual([]);

    // 결과는 목록과 같은 순서·같은 요약이고, 저장한 본문(프롬프트·훅·BGM 문구)은 돌려주지 않는다.
    const listed = (await (await http.listPromptSets()).json()).promptSets as { id: string }[];
    const everything = await (await find("중립")).json();
    expect(everything.promptSets).toEqual(listed);
    expect(Object.keys(everything.promptSets[0]).sort()).toEqual(["createdAt", "hasBgm", "id", "ideaTitle", "keyword", "sceneCount", "title"]);
    const raw = await (await find("dolly")).text();
    for (const body of ["Slow DOLLY zoom", "plain frame", "static shot", "Instrumental only.", "중립 장면"]) expect(raw).not.toContain(body);
    expect(listed.find(item => item.id === ids.backslash)).toMatchObject({ hasBgm: false });

    // 다른 소유자는 같은 글자를 찾아도 이 소유자의 세트를 볼 수 없다.
    as(other);
    expect(await idsOf("캠핑 요리")).toEqual([]);
    const mine = await save("other", searchablePromptSet({ title: "캠핑 요리 세트" }));
    expect(await idsOf("캠핑 요리")).toEqual([mine]);
    as(owner);
    expect(await idsOf("캠핑 요리")).toEqual([ids.title]);

    // 검색은 쓰지 않는다: 이 소유자의 요청 기록은 저장 10번 그대로이고, 세트 수도 그대로다.
    expect(await requestRows()).toBe(savedRequests);
    expect(savedRequests).toBe(10);
    expect((await (await http.listPromptSets()).json()).promptSets).toHaveLength(10);
  });

  it("refuses unauthorized and foreign search requests before the database", async () => {
    for (const [denied, status] of [[{ kind: "denied", status: 401, code: "AUTH_REQUIRED" }, 401],
      [{ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" }, 403], [{ kind: "local" }, 401]] as [ServerAuthResult, number][]) {
      auth = denied;
      const reply = await http.searchPromptSets(req("/api/admin/shorts-vault/prompts/search", "POST", { query: "캠핑" }));
      expect(reply.status).toBe(status);
      expect(await reply.text()).not.toContain("캠핑");
    }
    as(ownerA);
    const foreign = await http.searchPromptSets(req("/s", "POST", { query: "캠핑" }, { origin: "https://foreign.invalid" }));
    expect(foreign.status).toBe(403);
    expect((await http.searchPromptSets(req("/s", "POST", { query: "" }))).status).toBe(400);
  });

  it("finds records saved before the search existed and stops at 200 newest matches", async () => {
    // 앞 시험(200개 상한)에서 저장한 소유자 c1의 세트는 기존 저장 방식 그대로의 기록이다.
    const owner = "20000000-0000-4000-8000-0000000000c1";
    as(owner);
    const old = (await (await http.listPromptSets()).json()).promptSets as { id: string }[];
    expect(old).toHaveLength(shortsVaultPromptSetLimit);
    const hit = await (await http.searchPromptSets(req("/s", "POST", { query: "전후 비교" }))).json();
    expect(hit.promptSets).toEqual(old);
    expect((await (await http.searchPromptSets(req("/s", "POST", { query: "slow DOLLY in" }))).json()).promptSets).toHaveLength(200);
    // 저장 상한을 우회해 50개를 더 넣어도(관리자 직접 입력) 검색 결과는 최신순 200개다.
    await admin.query("BEGIN");
    await admin.query("SET LOCAL row_security=off");
    await admin.query(`INSERT INTO dream_shorts_vault.prompt_sets(owner_id,id,document,created_at)
      SELECT $1, gen_random_uuid(), $2::jsonb, clock_timestamp() + make_interval(secs => g) FROM generate_series(1,50) g`,
    [owner, JSON.stringify(promptSetDocument())]);
    await admin.query("COMMIT");
    const capped = (await (await http.searchPromptSets(req("/s", "POST", { query: "전후 비교" }))).json()).promptSets as { createdAt: string }[];
    expect(capped).toHaveLength(shortsVaultPromptSetLimit);
    expect(capped).toEqual((await (await http.listPromptSets()).json()).promptSets);
    const times = capped.map(item => Date.parse(item.createdAt));
    expect(times.every((time, index) => index === 0 || times[index - 1] >= time)).toBe(true);
  });

  it("records locale behaviour and a representative large-fixture runtime", async () => {
    const owner = "20000000-0000-4000-8000-0000000000d3";
    as(owner);
    const observations: Record<string, unknown> = {};
    const { rows: [db] } = await admin.query(`SELECT datlocprovider, datcollate, datctype, pg_encoding_to_char(encoding) AS encoding
      FROM pg_database WHERE datname='postgres'`);
    observations.database = db;
    const { rows: [fold] } = await admin.query(`SELECT lower('ABC xyz') AS ascii, lower('ÉCOLE Ärger') AS latin, lower('ΣΟΦΙΑ') AS greek,
      lower('캠핑 요리') AS korean`);
    observations.lowerDefault = fold;
    expect(fold.ascii).toBe("abc xyz");
    expect(fold.korean).toBe("캠핑 요리");
    // 같은 서버에서 ICU 로캘 데이터베이스를 만들어 유니코드 대소문자 규칙을 비교한다(관찰만, 이 데이터베이스는 바로 지움).
    try {
      await admin.query("CREATE DATABASE p108_search_icu TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LOCALE 'C'");
      const icu = new Client({ host: "127.0.0.1", port, database: "p108_search_icu", user: "p108_root", password: secret });
      await icu.connect();
      observations.lowerIcu = (await icu.query("SELECT lower('ÉCOLE Ärger') AS latin, lower('ΣΟΦΙΑ') AS greek, lower('캠핑 요리') AS korean")).rows[0];
      await icu.end();
      await admin.query("DROP DATABASE p108_search_icu");
    } catch (error) { observations.lowerIcu = `unavailable: ${(error as Error).message}`; }

    // 대표 큰 기록: 200세트 × 45장면, 장면 요약 240자·이미지/영상 프롬프트 1200자(문서마다 약 120 KB, 저장 상한 256 KB 안).
    const long = (seed: string, size: number) => (seed + " ").repeat(Math.ceil(size / (seed.length + 1))).slice(0, size).trimEnd();
    const big = searchablePromptSet({ scenes: 45 });
    big.prompts = big.prompts.map(prompt => ({ ...prompt, sceneSummary: long("넓은 장면 요약", 240),
      imagePrompt: long("wide establishing shot of a quiet harbor", 1200), videoPrompt: long("gentle handheld drift across the harbor", 1200) }));
    const hitDoc = structuredClone(big);
    hitDoc.prompts[44] = { ...hitDoc.prompts[44], videoPrompt: `${long("gentle handheld drift", 1100)} final RareNeedle_7 frame` };
    await admin.query("BEGIN");
    await admin.query("SET LOCAL row_security=off");
    await admin.query(`INSERT INTO dream_shorts_vault.prompt_sets(owner_id,id,document,created_at)
      SELECT $1, gen_random_uuid(), CASE WHEN g=1 THEN $3::jsonb ELSE $2::jsonb END, clock_timestamp() - make_interval(secs => g)
      FROM generate_series(1,$4) g`, [owner, JSON.stringify(big), JSON.stringify(hitDoc), shortsVaultPromptSetLimit]);
    await admin.query("COMMIT");
    const { rows: [size] } = await admin.query(`SELECT count(*)::int AS sets, max(octet_length(document::text))::int AS largest,
      sum(octet_length(document::text))::bigint AS total FROM dream_shorts_vault.prompt_sets WHERE owner_id=$1`, [owner]);
    observations.fixture = size;
    const timed = async (query: string) => {
      const runs: number[] = [];
      let found = -1;
      for (let index = 0; index < 5; index++) {
        const start = performance.now();
        const reply = await http.searchPromptSets(req("/s", "POST", { query }));
        runs.push(Math.round(performance.now() - start));
        expect(reply.status).toBe(200);
        found = (await reply.json()).promptSets.length;
      }
      return { found, ms: runs };
    };
    observations.missFullScan = await timed("존재하지않는검색어");
    observations.lastSceneHit = await timed("rareneedle_7");
    observations.everyRowHit = await timed("HARBOR");
    expect((observations.missFullScan as { found: number }).found).toBe(0);
    expect((observations.lastSceneHit as { found: number }).found).toBe(1);
    expect((observations.everyRowHit as { found: number }).found).toBe(shortsVaultPromptSetLimit);
    for (const key of ["missFullScan", "lastSceneHit", "everyRowHit"]) {
      expect(Math.max(...(observations[key] as { ms: number[] }).ms), key).toBeLessThan(6000);
    }
    if (process.env.P108_SEARCH_OBSERVE) await writeFile(process.env.P108_SEARCH_OBSERVE, JSON.stringify(observations, null, 1));
  }, 120_000);
});
