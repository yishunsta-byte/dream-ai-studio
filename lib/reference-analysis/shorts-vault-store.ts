import "server-only";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import {
  shortsVaultProjectLimit, shortsVaultPromptSetLimit, type ShortsVaultProject, type ShortsVaultProjectDocument,
  type ShortsVaultProjectSummary, type ShortsVaultPromptSet, type ShortsVaultPromptSetDocument, type ShortsVaultPromptSetSummary,
} from "./shorts-vault-contract";

const appRole = "dream_shorts_vault_app";
export type ShortsVaultOutcome = { status: number; body: Record<string, unknown> };
const fail = (code: string, status: number): ShortsVaultOutcome => ({ status, body: { code } });
const iso = (value: Date | string) => new Date(value).toISOString();
const inputHash = (kind: string, document: unknown) => createHash("sha256").update(`${kind}\n${JSON.stringify(document)}`).digest("hex");

type PromptRow = { id: string; document: ShortsVaultPromptSetDocument; created_at: Date };
type ProjectRow = { id: string; revision: number; document: ShortsVaultProjectDocument;
  created_at: Date; updated_at: Date; expires_at: Date };

function promptSummary({ id, document, created_at }: PromptRow): ShortsVaultPromptSetSummary {
  return { id, title: document.title, ideaTitle: document.ideaTitle, keyword: document.keyword,
    sceneCount: document.prompts.length, hasBgm: document.bgmPrompt !== null, createdAt: iso(created_at) };
}
function projectSummary({ id, revision, document, created_at, updated_at, expires_at }: ProjectRow): ShortsVaultProjectSummary {
  return { id, title: document.title, keyword: document.keyword, step: document.step, revision,
    createdAt: iso(created_at), updatedAt: iso(updated_at), expiresAt: iso(expires_at) };
}
const project = (row: ProjectRow): ShortsVaultProject => ({ ...projectSummary(row), document: row.document });

const live = "expires_at > clock_timestamp()";

// P1-08-SHORTS-VAULT-CONTENT-SEARCH-API: 검색어($2)를 필드마다 따로 비교한다(필드를 이어 붙이지 않음).
// strpos는 문자 그대로의 부분 문자열 비교라 %·_·\ 같은 와일드카드 문자도 글자 그대로 찾는다. 대소문자는 양쪽 lower()로 맞춘다
// (데이터베이스 기본 정렬 규칙을 따른다: C 로캘은 ASCII만, 유니코드 로캘은 그 규칙대로). 검색어는 매개변수로만 넘긴다.
const searchHit = (field: string) => `strpos(lower(${field}), lower($2::text)) > 0`;
const promptSearchSql = `SELECT s.id::text, s.document, s.created_at FROM dream_shorts_vault.prompt_sets s WHERE s.owner_id=$1 AND (
  ${["s.document->>'title'", "s.document->>'ideaTitle'", "s.document->>'hook'", "s.document->>'keyword'",
    "s.document->'bgmPrompt'->>'sunoPrompt'"].map(searchHit).join(" OR ")}
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.document->'prompts')='array'
      THEN s.document->'prompts' ELSE '[]'::jsonb END) AS p(item)
    WHERE ${["p.item->>'sceneSummary'", "p.item->>'imagePrompt'", "p.item->>'videoPrompt'"].map(searchHit).join(" OR ")}))
  ORDER BY s.created_at DESC, s.id LIMIT ${shortsVaultPromptSetLimit}`;
const projectColumns = "id::text, revision, document, created_at, updated_at, expires_at";

export function createShortsVaultStore(pool: Pick<Pool, "connect">) {
  async function transaction<T>(owner: string, write: boolean, run: (client: PoolClient) => Promise<T>) {
    const id = z.guid().parse(owner);
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
      await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='6s'");
      const identity = await client.query(`SELECT current_user=session_user AND current_user=$1 AND
        NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit) AND
        NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS ok FROM pg_roles r WHERE r.rolname=current_user`, [appRole]);
      if (!identity.rows[0]?.ok) throw new Error("Invalid Shorts vault role");
      await client.query("SELECT set_config('dream_shorts_vault.owner_id',$1,true)", [id]);
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  /** 같은 소유자의 생성은 한 줄로 세우고, 같은 요청 ID는 처음 결과를 돌려준다(입력이 다르면 409). */
  async function once(client: PoolClient, owner: string, kind: "prompt_set" | "project", requestId: string, document: unknown,
    create: () => Promise<ShortsVaultOutcome>) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`dream_shorts_vault:${owner}`]);
    const hash = inputHash(kind, document);
    const { rows: [seen] } = await client.query<{ kind: string; input_hash: string; outcome: ShortsVaultOutcome }>(
      "SELECT kind, input_hash, outcome FROM dream_shorts_vault.requests WHERE owner_id=$1 AND id=$2", [owner, requestId]);
    if (seen) return seen.kind === kind && seen.input_hash === hash ? seen.outcome : fail("request_conflict", 409);
    const outcome = await create();
    if (outcome.status === 201) await client.query(
      "INSERT INTO dream_shorts_vault.requests(owner_id,id,kind,input_hash,outcome) VALUES($1,$2,$3,$4,$5::jsonb)",
      [owner, requestId, kind, hash, JSON.stringify(outcome)]);
    return outcome;
  }

  // 30일이 지난 프로젝트와 그 기간을 넘긴 요청 기록은 소유자의 모든 프로젝트 작업 전에 지운다.
  const purge = async (client: PoolClient, owner: string) => {
    await client.query("DELETE FROM dream_shorts_vault.projects WHERE owner_id=$1 AND expires_at <= clock_timestamp()", [owner]);
    await client.query("DELETE FROM dream_shorts_vault.requests WHERE owner_id=$1 AND created_at <= clock_timestamp() - interval '30 days'", [owner]);
  };

  return {
    listPromptSets: (owner: string) => transaction(owner, false, async client => (await client.query<PromptRow>(
      `SELECT id::text, document, created_at FROM dream_shorts_vault.prompt_sets WHERE owner_id=$1
       ORDER BY created_at DESC, id LIMIT ${shortsVaultPromptSetLimit}`, [owner])).rows.map(promptSummary)),

    /** 같은 소유자(RLS)의 프롬프트 세트 중 내용이 맞는 것만, 목록과 같은 순서·200개 상한·요약으로. */
    searchPromptSets: (owner: string, query: string) => transaction(owner, false, async client =>
      (await client.query<PromptRow>(promptSearchSql, [owner, query])).rows.map(promptSummary)),

    getPromptSet: (owner: string, id: string) => transaction(owner, false, async client => {
      const { rows: [row] } = await client.query<PromptRow>(
        "SELECT id::text, document, created_at FROM dream_shorts_vault.prompt_sets WHERE owner_id=$1 AND id=$2", [owner, id]);
      return row ? { id: row.id, createdAt: iso(row.created_at), document: row.document } satisfies ShortsVaultPromptSet : null;
    }),

    createPromptSet: (owner: string, requestId: string, document: ShortsVaultPromptSetDocument) => transaction(owner, true, client =>
      once(client, owner, "prompt_set", requestId, document, async () => {
        const { rows: [{ count }] } = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM dream_shorts_vault.prompt_sets WHERE owner_id=$1", [owner]);
        if (count >= shortsVaultPromptSetLimit) return fail("limit_reached", 409);
        const { rows: [row] } = await client.query<PromptRow>(`INSERT INTO dream_shorts_vault.prompt_sets(owner_id,id,document)
          VALUES($1,gen_random_uuid(),$2::jsonb) RETURNING id::text, document, created_at`, [owner, JSON.stringify(document)]);
        return { status: 201, body: { promptSet: promptSummary(row) } };
      })),

    deletePromptSet: (owner: string, id: string) => transaction(owner, true, async client =>
      ((await client.query("DELETE FROM dream_shorts_vault.prompt_sets WHERE owner_id=$1 AND id=$2", [owner, id])).rowCount ?? 0) > 0),

    listProjects: (owner: string) => transaction(owner, true, async client => {
      await purge(client, owner);
      return (await client.query<ProjectRow>(`SELECT ${projectColumns} FROM dream_shorts_vault.projects
        WHERE owner_id=$1 AND ${live} ORDER BY updated_at DESC, id LIMIT ${shortsVaultProjectLimit}`, [owner])).rows.map(projectSummary);
    }),

    getProject: (owner: string, id: string) => transaction(owner, true, async client => {
      await purge(client, owner);
      const { rows: [row] } = await client.query<ProjectRow>(
        `SELECT ${projectColumns} FROM dream_shorts_vault.projects WHERE owner_id=$1 AND id=$2 AND ${live}`, [owner, id]);
      return row ? project(row) : null;
    }),

    createProject: (owner: string, requestId: string, document: ShortsVaultProjectDocument) => transaction(owner, true, client =>
      once(client, owner, "project", requestId, document, async () => {
        await purge(client, owner);
        const { rows: [{ count }] } = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM dream_shorts_vault.projects WHERE owner_id=$1 AND ${live}`, [owner]);
        if (count >= shortsVaultProjectLimit) return fail("limit_reached", 409);
        const { rows: [row] } = await client.query<ProjectRow>(`INSERT INTO dream_shorts_vault.projects
          (owner_id,id,revision,document,created_at,updated_at,expires_at)
          SELECT $1,gen_random_uuid(),1,$2::jsonb,now,now,now + interval '30 days' FROM (SELECT clock_timestamp() AS now) t
          RETURNING ${projectColumns}`, [owner, JSON.stringify(document)]);
        return { status: 201, body: { project: projectSummary(row) } };
      })),

    /** 덮어쓰기는 받은 버전이 지금 버전과 같을 때만. 다르면 409 stale_revision, 없거나 만료면 404. 생성 시각·만료는 바꾸지 않는다. */
    replaceProject: (owner: string, id: string, expectedRevision: number, document: ShortsVaultProjectDocument) =>
      transaction(owner, true, async (client): Promise<ShortsVaultOutcome> => {
        await purge(client, owner);
        const { rows: [row] } = await client.query<ProjectRow>(`UPDATE dream_shorts_vault.projects
          SET revision=revision+1, document=$4::jsonb, updated_at=clock_timestamp()
          WHERE owner_id=$1 AND id=$2 AND revision=$3 AND ${live} RETURNING ${projectColumns}`,
        [owner, id, expectedRevision, JSON.stringify(document)]);
        if (row) return { status: 200, body: { project: projectSummary(row) } };
        const { rows: [current] } = await client.query<{ revision: number }>(
          `SELECT revision FROM dream_shorts_vault.projects WHERE owner_id=$1 AND id=$2 AND ${live}`, [owner, id]);
        return current ? { status: 409, body: { code: "stale_revision", revision: current.revision } } : fail("not_found", 404);
      }),

    deleteProject: (owner: string, id: string) => transaction(owner, true, async client => {
      await purge(client, owner);
      return ((await client.query(`DELETE FROM dream_shorts_vault.projects WHERE owner_id=$1 AND id=$2`, [owner, id])).rowCount ?? 0) > 0;
    }),
  };
}

export type ShortsVaultStore = ReturnType<typeof createShortsVaultStore>;
let runtimeStore: ShortsVaultStore | undefined;
/** Style DNA와 같은 연결 규칙: 같은 Supabase 프로젝트의 직접(5432) 또는 풀러(5432/6543) 주소, 전용 역할, 검증 TLS. */
export function openShortsVaultStore(env: Readonly<Record<string, string | undefined>> = process.env): ShortsVaultStore | null {
  if (runtimeStore) return runtimeStore;
  const raw = env.DREAM_SHORTS_VAULT_DB_URL;
  if (!raw) return null;
  const ref = supabasePublicConfig(env)?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const { hostname } = url;
  const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
  const direct = hostname === `db.${ref}.supabase.co` && url.port === "5432" && user === appRole;
  const pooled = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) && ["5432", "6543"].includes(url.port) && user === `${appRole}.${ref}`;
  if (!["postgres:", "postgresql:"].includes(url.protocol) || (!direct && !pooled) || url.pathname !== "/postgres" ||
    !password || url.search || url.hash) return null;
  const ca = env.DREAM_SHORTS_VAULT_DB_CA?.trim();
  const pool = new Pool({ host: hostname, port: Number(url.port), database: "postgres", user, password,
    ssl: { rejectUnauthorized: true, servername: hostname, ...(ca && { ca }) }, max: 3, idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Keep idle connection failures private. */ });
  return runtimeStore = createShortsVaultStore(pool);
}
