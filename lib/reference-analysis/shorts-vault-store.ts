import "server-only";
import { createHash, X509Certificate } from "node:crypto";
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

/** 전용 역할 확인 실패. 진단에서 고정 이름으로만 구분한다(메시지는 기록하지 않는다). */
class ShortsVaultRoleError extends Error {
  constructor() { super("Invalid Shorts vault role"); }
}

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
      if (!identity.rows[0]?.ok) throw new ShortsVaultRoleError();
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
type ShortsVaultEnv = Readonly<Record<string, string | undefined>>;

/** P1-08-SHORTS-VAULT-STORAGE-DIAGNOSTICS: 연결 설정 거절 이유. 값·주소·계정은 담지 않는 고정 이름만 쓴다. */
export type ShortsVaultConfigIssue = "url_missing" | "public_config_missing" | "url_unparseable" | "url_protocol" |
  "url_host" | "url_user" | "url_path" | "url_password_missing" | "url_extra";
type ShortsVaultConnection = { hostname: string; port: number; user: string; password: string };

/** Style DNA와 같은 연결 규칙: 같은 Supabase 프로젝트의 직접(5432) 또는 풀러(5432/6543) 주소, 전용 역할, 쿼리·해시 없음. */
function readShortsVaultConnection(env: ShortsVaultEnv): { connection: ShortsVaultConnection } | { issue: ShortsVaultConfigIssue } {
  const raw = env.DREAM_SHORTS_VAULT_DB_URL;
  if (!raw) return { issue: "url_missing" };
  const ref = supabasePublicConfig(env)?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) return { issue: "public_config_missing" };
  let url: URL, user: string, password: string;
  try {
    url = new URL(raw);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { return { issue: "url_unparseable" }; }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return { issue: "url_protocol" };
  const { hostname } = url;
  const directTarget = hostname === `db.${ref}.supabase.co` && url.port === "5432";
  const pooledTarget = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) && ["5432", "6543"].includes(url.port);
  if (!directTarget && !pooledTarget) return { issue: "url_host" };
  if (user !== (directTarget ? appRole : `${appRole}.${ref}`)) return { issue: "url_user" };
  if (url.pathname !== "/postgres") return { issue: "url_path" };
  if (!password) return { issue: "url_password_missing" };
  if (url.search || url.hash) return { issue: "url_extra" };
  return { connection: { hostname, port: Number(url.port), user, password } };
}

const readCa = (env: ShortsVaultEnv) => env.DREAM_SHORTS_VAULT_DB_CA?.trim() || undefined;

/** 진단 전용: 설정 거절 이유와 CA 상태(없음·읽힘·못 읽음). 저장소 동작은 바꾸지 않는다. */
export function inspectShortsVaultConfig(env: ShortsVaultEnv = process.env):
  { issue: ShortsVaultConfigIssue | null; ca: "absent" | "parsed" | "unparseable" } {
  const read = readShortsVaultConnection(env);
  const ca = readCa(env);
  let caState: "absent" | "parsed" | "unparseable" = "absent";
  if (ca) { try { new X509Certificate(ca); caState = "parsed"; } catch { caState = "unparseable"; } }
  return { issue: "issue" in read ? read.issue : null, ca: caState };
}

export type ShortsVaultFailure = { stage: "tls" | "network" | "auth" | "database" | "role_check" | "other"; reason: string };
const tlsVerifyCodes = new Set(["UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE", "CERT_REJECTED", "HOSTNAME_MISMATCH", "ERR_TLS_CERT_ALTNAME_INVALID"]);
// Map 조회라 constructor·__proto__ 같은 상속 이름은 맞지 않고 기타로 떨어진다.
const networkReasons = new Map<string, string>([["ENOTFOUND", "dns"], ["EAI_AGAIN", "dns"], ["ECONNREFUSED", "refused"],
  ["ECONNRESET", "reset"], ["EPIPE", "reset"], ["ETIMEDOUT", "timeout"], ["EHOSTUNREACH", "unreachable"], ["ENETUNREACH", "unreachable"]]);
const sqlstateReasons = new Map<string, ShortsVaultFailure>([
  ["28P01", { stage: "auth", reason: "password_rejected" }], ["28000", { stage: "auth", reason: "authorization_rejected" }],
  ["3D000", { stage: "database", reason: "database_missing" }], ["3F000", { stage: "database", reason: "schema_missing" }],
  ["42P01", { stage: "database", reason: "table_missing" }], ["42501", { stage: "database", reason: "permission_denied" }],
  ["53300", { stage: "database", reason: "too_many_connections" }], ["57014", { stage: "database", reason: "statement_timeout" }],
  ["55P03", { stage: "database", reason: "lock_timeout" }], ["XX000", { stage: "database", reason: "internal_error" }],
]);

/** 진단 전용: 오류를 표준 code allowlist로만 나눈다. 메시지·스택·값은 보지 않고, 모르는 것은 other로 둔다. */
export function classifyShortsVaultFailure(error: unknown): ShortsVaultFailure {
  if (error instanceof ShortsVaultRoleError) return { stage: "role_check", reason: "role_mismatch" };
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
  if (tlsVerifyCodes.has(code)) return { stage: "tls", reason: code.toLowerCase() };
  if (/^ERR_(TLS|SSL|OSSL)_[A-Z0-9_]+$/.test(code)) return { stage: "tls", reason: "tls_library_error" };
  const network = networkReasons.get(code);
  if (network) return { stage: "network", reason: network };
  const sqlstate = sqlstateReasons.get(code);
  if (sqlstate) return { ...sqlstate };
  if (/^08[0-9A-Z]{3}$/.test(code)) return { stage: "network", reason: "connection_exception" };
  if (/^[0-9A-Z]{5}$/.test(code)) return { stage: "database", reason: "other_sqlstate" };
  return { stage: "other", reason: "unclassified" };
}

/** 같은 Supabase 프로젝트의 전용 역할만, 검증 TLS로 연다. 규칙은 readShortsVaultConnection 하나에만 둔다. */
export function openShortsVaultStore(env: ShortsVaultEnv = process.env): ShortsVaultStore | null {
  if (runtimeStore) return runtimeStore;
  const read = readShortsVaultConnection(env);
  if (!("connection" in read)) return null;
  const { hostname, port, user, password } = read.connection;
  const ca = readCa(env);
  const pool = new Pool({ host: hostname, port, database: "postgres", user, password,
    ssl: { rejectUnauthorized: true, servername: hostname, ...(ca && { ca }) }, max: 3, idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Keep idle connection failures private. */ });
  return runtimeStore = createShortsVaultStore(pool);
}
