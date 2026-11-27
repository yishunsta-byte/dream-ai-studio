import "server-only";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import { measureComparisonSpots, summarizeComparisonSpots } from "./style-dna-comparison";
import { styleDnaGenerationRequestModel, styleDnaTrendLimit, type StyleDnaGenerationRequestModel, type StyleDnaComparison, type StyleDnaComparisonCommand,
  type StyleDnaComparisonTrend, type StyleDnaRecord, type StyleDnaRevision, type StyleDnaSummary,
  type StyleDnaTestResult } from "./style-dna-contract";

type StoredTrend = Omit<StyleDnaComparisonTrend, "prompt">;
type StoredComparison = Omit<StyleDnaComparison, "trends"> & { trends: StoredTrend[] };
type StoredRecord = Omit<StyleDnaRecord, "comparison"> & { comparison?: StoredComparison; trendPrompts?: Record<string, string> };
type Outcome = { status: number; body: { code?: string; requestId?: string; model?: StyleDnaGenerationRequestModel; record?: StyleDnaRecord;
  test?: StyleDnaTestResult; comparison?: StyleDnaComparison } };
type RequestReceipt = { input_hash: string; outcome: Outcome | null; generation_record_id: string | null; generation_model: string | null };
// Row-to-JSON keeps reads and ordinary non-paid writes compatible with the pre-0004 table.
const requestModelColumn = "to_jsonb(q)->>'generation_model' AS generation_model";
type Change = { kind: "analysis"; record: StyleDnaRecord; original: Buffer } |
  { kind: "refine"; recordId: string; baseRevision: number; revision: StyleDnaRevision } |
  { kind: "test"; recordId: string; test: StyleDnaTestResult; image: Buffer } |
  { kind: "failure"; outcome: Outcome };
const fail = (code: string, status: number): Outcome => ({ status, body: { code } });
const comparisonResult = (comparison: StoredComparison): Outcome => ({ status: 200, body: { comparison } });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const appRole = "dream_style_dna_app";
export const styleDnaLibraryLimit = 100;

async function recordFor(client: PoolClient, owner: string, id: string, lock = false) {
  const { rows: [row] } = await client.query<{ document: StoredRecord }>(
    `SELECT document FROM dream_style_dna.records WHERE owner_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [owner, id]);
  return row?.document;
}

async function lockRecord(client: PoolClient, owner: string, id: string, mode: "KEY SHARE" | "UPDATE") {
  const result = await client.query(`SELECT 1 FROM dream_style_dna.records WHERE owner_id=$1 AND id=$2 FOR ${mode}`, [owner, id]);
  return result.rowCount === 1;
}

const trendKey = (trend: Pick<StoredTrend, "testId" | "spotVersion">) => `${trend.testId}:${trend.spotVersion}`;

// Only the current owner read may combine the retained UI strings with evidence.
// Response receipts can outlive the twenty comparison entries.
function responseRecord(record: StoredRecord, includeTrendPrompts = false): StyleDnaRecord {
  const { trendPrompts, comparison, ...detail } = record;
  if (!comparison) return detail;
  if (!includeTrendPrompts || !trendPrompts) return { ...detail, comparison };
  const trends = comparison.trends.map(trend => {
    const prompt = trendPrompts[trendKey(trend)];
    return prompt === undefined ? trend : { ...trend, prompt };
  });
  return { ...detail, comparison: { ...comparison, trends } };
}

function withRequestModel(outcome: Outcome, stored: unknown): Outcome {
  const model = styleDnaGenerationRequestModel.safeParse(stored).data;
  const body = { ...outcome.body };
  delete body.model;
  return { status: outcome.status, body: model ? { ...body, model } : body };
}

function replayRequest(row: RequestReceipt, inputHash: string, recordAvailable: boolean, record?: string) {
  const result = row.input_hash !== inputHash ? fail("request_conflict", 409)
    : !recordAvailable ? fail("not_found", 404)
    : !row.outcome ? fail("in_progress", 202)
    : { ...row.outcome, status: row.outcome.status === 201 ? 200 : row.outcome.status };
  return withRequestModel(result, record?.toLowerCase() === row.generation_record_id ? row.generation_model : null);
}

async function requestFor(client: PoolClient, owner: string, id: string) {
  const { rows: [row] } = await client.query<RequestReceipt>(
    `SELECT q.input_hash,q.outcome,to_jsonb(q)->>'generation_record_id' AS generation_record_id,${requestModelColumn}
      FROM dream_style_dna.requests q WHERE q.owner_id=$1 AND q.id=$2`, [owner, id]);
  return row;
}

async function reserveRequest(client: PoolClient, owner: string, id: string, inputHash: string, recordAvailable = true,
  generation?: { record: string; model: StyleDnaGenerationRequestModel }) {
  const result = generation
    ? await client.query(
      `INSERT INTO dream_style_dna.requests(owner_id,id,input_hash,generation_record_id,generation_model) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (owner_id,id) DO NOTHING`, [owner, id, inputHash, generation.record, generation.model])
    : await client.query("INSERT INTO dream_style_dna.requests(owner_id,id,input_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [owner, id, inputHash]);
  if (result.rowCount) return recordAvailable ? undefined : completeRequest(client, owner, id, fail("not_found", 404));
  return replayRequest(await requestFor(client, owner, id), inputHash, recordAvailable, generation?.record);
}

async function completeRequest(client: PoolClient, owner: string, id: string, outcome: Outcome) {
  await client.query("UPDATE dream_style_dna.requests SET outcome=$3::jsonb WHERE owner_id=$1 AND id=$2", [owner, id, JSON.stringify(outcome)]);
  return outcome;
}

async function saveRecord(client: PoolClient, owner: string, record: StoredRecord) {
  await client.query("UPDATE dream_style_dna.records SET revision=$3,document=$4::jsonb WHERE owner_id=$1 AND id=$2",
    [owner, record.id, record.revision, JSON.stringify(record)]);
}

async function saveComparison(client: PoolClient, owner: string, record: StoredRecord, command: StyleDnaComparisonCommand): Promise<Outcome> {
  const { id } = record;
  const test = record.tests.find(test => test.id === command.testId);
  if (!test) return fail("not_found", 404);
  const { testId, originalSha256, resultSha256, spotVersion } = command;
  if (record.original.sha256 !== originalSha256 || test.original.sha256 !== originalSha256 || test.image.sha256 !== resultSha256) {
    return fail("comparison_media_mismatch", 409);
  }

  const prior = record.comparison;
  if ((prior?.spotVersion ?? 0) !== spotVersion) return fail("stale_spot_version", 409);
  if (command.action === "record-trend" && !prior?.spots.length) return fail("comparison_unmeasured", 422);
  if (command.action === "record-trend" && prior?.recordedTestIds.includes(testId)) return comparisonResult(prior);
  if (command.action === "save-spots" && prior?.baseline.testId === testId &&
      prior.frame.width === command.frame.width && prior.frame.height === command.frame.height &&
      prior.spots.length === command.spots.length && prior.spots.every(({ x, y }, index) =>
        x === command.spots[index].x && y === command.spots[index].y)) return comparisonResult(prior);

  const frame = command.action === "save-spots" ? command.frame : prior?.frame;
  const points = command.action === "save-spots" ? command.spots : prior?.spots;
  if (!frame || !points) return fail("comparison_unmeasured", 422);
  const { rows } = await client.query<{ id: string; image: Buffer }>(`SELECT id,image FROM dream_style_dna.media
    WHERE owner_id=$1 AND record_id=$2 AND id IN ($2,$3)`, [owner, id, testId]);
  const original = rows.find(row => row.id === id)?.image;
  const image = rows.find(row => row.id === testId)?.image;
  if (!original || !image) return fail("not_found", 404);
  if (hash(original) !== originalSha256 || hash(image) !== resultSha256) return fail("comparison_media_mismatch", 409);
  const spots = await measureComparisonSpots(original, image, frame, points);
  const at = new Date().toISOString();
  const basis = { testId, originalSha256, resultSha256, at };
  let comparison: StoredComparison;
  if (command.action === "save-spots") {
    if (spotVersion === Number.MAX_SAFE_INTEGER) return fail("limit_reached", 409);
    comparison = { source: "stored_webp_rgb_5x5", spotVersion: spotVersion + 1, frame, baseline: basis, spots, updatedAt: at,
      trends: prior?.trends ?? [], recordedTestIds: [] };
  } else {
    const metrics = summarizeComparisonSpots(spots);
    if (!prior || !metrics) return fail("comparison_unmeasured", 422);
    const trend = { ...basis, ...metrics, spotVersion, revision: test.revision, frame, spots };
    comparison = { ...prior, updatedAt: at, trends: [...prior.trends, trend].slice(-styleDnaTrendLimit),
      recordedTestIds: [...prior.recordedTestIds, testId] };
    if (command.prompt || record.trendPrompts) {
      const prompts = { ...record.trendPrompts, ...(command.prompt && { [trendKey(trend)]: command.prompt }) };
      const retained = comparison.trends.map(trendKey).filter(key => Object.hasOwn(prompts, key));
      if (retained.length) record.trendPrompts = Object.fromEntries(retained.map(key => [key, prompts[key]]));
      else delete record.trendPrompts;
    }
  }
  record.comparison = comparison;
  record.updatedAt = at;
  await saveRecord(client, owner, record);
  return comparisonResult(comparison);
}

export function createStyleDnaStore(pool: Pick<Pool, "connect">) {
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
      if (!identity.rows[0]?.ok) throw new Error("Invalid Style DNA role");
      await client.query("SELECT set_config('dream_style_dna.owner_id',$1,true)", [id]);
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  async function saveChange(client: PoolClient, owner: string, change: Change): Promise<Outcome> {
    if (change.kind === "failure") return change.outcome;
    if (change.kind === "analysis") {
      const { record } = change;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [owner]);
      const { rows: [rows] } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM dream_style_dna.records WHERE owner_id=$1", [owner]);
      if (rows.count >= styleDnaLibraryLimit) return fail("limit_reached", 409);
      await client.query("INSERT INTO dream_style_dna.records(owner_id,id,revision,document) VALUES($1,$2,1,$3::jsonb)", [owner, record.id, JSON.stringify(record)]);
      await client.query("INSERT INTO dream_style_dna.media(owner_id,record_id,id,image) VALUES($1,$2,$2,$3)", [owner, record.id, change.original]);
      return { status: 201, body: { record } };
    }
    const record = await recordFor(client, owner, change.recordId, true);
    if (!record) return fail("not_found", 404);
    if (change.kind === "refine") {
      if (record.revision !== change.baseRevision) return fail("stale_revision", 409);
      if (record.revisions.length >= styleDnaLibraryLimit) return fail("limit_reached", 409);
      record.revision = change.revision.revision;
      record.updatedAt = change.revision.createdAt;
      record.revisions.push(change.revision);
    } else {
      if (record.tests.length >= styleDnaLibraryLimit) return fail("limit_reached", 409);
      record.updatedAt = change.test.createdAt;
      record.tests.push(change.test);
      await client.query("INSERT INTO dream_style_dna.media(owner_id,record_id,id,image) VALUES($1,$2,$3,$4)", [owner, record.id, change.test.id, change.image]);
    }
    await saveRecord(client, owner, record);
    return { status: 201, body: change.kind === "refine" ? { record: responseRecord(record) } : { test: change.test } };
  }

  return {
    list: (owner: string) => transaction(owner, false, async client => {
      const { rows } = await client.query<{ item: StyleDnaSummary }>(`SELECT jsonb_build_object('id',id,'title',document->'title',
        'revision',revision,'mode',document->'mode','original',document->'original','createdAt',document->'createdAt','updatedAt',document->'updatedAt') AS item
        FROM dream_style_dna.records WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2`, [owner, styleDnaLibraryLimit]);
      return rows.map(row => row.item);
    }),
    get: (owner: string, id: string, includeTrendPrompts = false) => transaction(owner, false, async client => {
      const record = await recordFor(client, owner, id);
      return record && responseRecord(record, includeTrendPrompts);
    }),
    remove: (owner: string, id: string) => transaction(owner, true, async client => {
      const record = await recordFor(client, owner, id, true);
      if (!record) return false;
      // Keep request fingerprints for replay and discard results that describe the deleted record.
      // Old receipts have no separate record reference. Test and comparison receipts identify a test in this record.
      await client.query(`UPDATE dream_style_dna.requests q SET outcome=$3::jsonb
        WHERE q.owner_id=$1 AND ((to_jsonb(q)->>'generation_record_id'=$4::uuid::text AND to_jsonb(q)->>'generation_model' IS NOT NULL)
          OR (q.outcome IS NOT NULL AND
          COALESCE(q.outcome#>>'{body,record,id}', q.outcome#>>'{body,test,id}', q.outcome#>>'{body,comparison,baseline,testId}')=ANY($2::text[])))`,
        [owner, [record.id, ...record.tests.map(test => test.id)], JSON.stringify(fail("not_found", 404)), id]);
      await client.query("DELETE FROM dream_style_dna.media WHERE owner_id=$1 AND record_id=$2", [owner, id]);
      await client.query("DELETE FROM dream_style_dna.records WHERE owner_id=$1 AND id=$2", [owner, id]);
      return true;
    }),
    media: (owner: string, record: string, id: string) => transaction<Buffer | undefined>(owner, false, async client => {
      const { rows: [row] } = await client.query<{ image: Buffer }>("SELECT image FROM dream_style_dna.media WHERE owner_id=$1 AND record_id=$2 AND id=$3", [owner, record, id]);
      return row?.image;
    }),
    compare: (owner: string, id: string, command: StyleDnaComparisonCommand) => transaction(owner, true, async client => {
      const record = await recordFor(client, owner, id, true);
      if (!record) return fail("not_found", 404);
      const { requestId, ...intent } = command;
      const previous = await reserveRequest(client, owner, requestId, hash(JSON.stringify(["comparison-v1", id, intent])));
      if (previous) return previous;
      const outcome = await saveComparison(client, owner, record, command);
      return completeRequest(client, owner, requestId, outcome);
    }),
    reserve: (owner: string, id: string, inputHash: string, requiredRecord?: string, generationModel?: StyleDnaGenerationRequestModel) => transaction(owner, true, async client => {
      if (generationModel !== undefined) {
        if (!requiredRecord) throw new Error("Missing Style DNA generation record");
        const model = styleDnaGenerationRequestModel.parse(generationModel);
        // Serialize paid reservations with finalization and removal. Replay the same request before checking a different pending one.
        const recordAvailable = await lockRecord(client, owner, requiredRecord, "UPDATE");
        const prior = await requestFor(client, owner, id);
        if (prior) return replayRequest(prior, inputHash, recordAvailable, requiredRecord);
        if (!recordAvailable) return fail("not_found", 404);
        const { rows: [pending] } = await client.query<{ id: string; generation_model: string | null }>(
          `SELECT q.id,${requestModelColumn} FROM dream_style_dna.requests q
          WHERE q.owner_id=$1 AND q.generation_record_id=$2 AND q.outcome IS NULL`, [owner, requiredRecord]);
        if (pending) return withRequestModel({ status: 409, body: { code: "generation_in_progress", requestId: pending.id } }, pending.generation_model);
        return reserveRequest(client, owner, id, inputHash, true, { record: requiredRecord, model });
      }
      const recordAvailable = !requiredRecord || await lockRecord(client, owner, requiredRecord, "KEY SHARE");
      return reserveRequest(client, owner, id, inputHash, recordAvailable);
    }),
    generationStatus: (owner: string, recordId: string, requestId?: string) => transaction(owner, false, async client => {
      const fields = `q.id,q.outcome,${requestModelColumn}`;
      const { rows: [row] } = await client.query<{ id: string | null; outcome: Outcome | null; generation_model: string | null; record_exists: boolean }>(
        requestId ? `SELECT ${fields},r.id IS NOT NULL AS record_exists
          FROM dream_style_dna.requests q LEFT JOIN dream_style_dna.records r ON r.owner_id=q.owner_id AND r.id=q.generation_record_id
          WHERE q.owner_id=$1 AND q.generation_record_id=$2 AND q.id=$3`
          : `SELECT ${fields},true AS record_exists FROM dream_style_dna.records r LEFT JOIN dream_style_dna.requests q
            ON q.owner_id=r.owner_id AND q.generation_record_id=r.id AND q.outcome IS NULL WHERE r.owner_id=$1 AND r.id=$2`,
        requestId ? [owner, recordId, requestId] : [owner, recordId]);
      const model = styleDnaGenerationRequestModel.safeParse(row?.generation_model).data;
      if (!row || (!row.record_exists && !model)) return { kind: "missing" as const };
      if (!row.id) return { kind: "idle" as const };
      const outcome = row.record_exists ? row.outcome : fail("not_found", 404);
      return { kind: "request" as const, requestId: row.id, ...(model && { model }),
        outcome: outcome && withRequestModel(outcome, model) };
    }),
    // 같은 요청 번호의 영수증만 다시 읽는다(쓰기 없음). 결과 저장 뒤 다른 거래가 실패했을 때 이미 확정됐는지 확인한다.
    receipt: (owner: string, id: string) => transaction(owner, false, async client => {
      const row = await requestFor(client, owner, id);
      if (!row) return undefined;
      const model = styleDnaGenerationRequestModel.safeParse(row.generation_model).data;
      return { outcome: row.outcome && withRequestModel(row.outcome, model), ...(model && { model }) };
    }),
    finish: (owner: string, id: string, change: Change, requiredRecord?: string) => transaction(owner, true, async client => {
      // Lock the record before the receipt, in the same order as deletion.
      const recordAvailable = !requiredRecord || await lockRecord(client, owner, requiredRecord, "UPDATE");
      const { rows: [row] } = await client.query<RequestReceipt>(
        `SELECT q.outcome,to_jsonb(q)->>'generation_record_id' AS generation_record_id,${requestModelColumn}
          FROM dream_style_dna.requests q WHERE q.owner_id=$1 AND q.id=$2 FOR UPDATE`, [owner, id]);
      if (!row || row.outcome || (row.generation_record_id && row.generation_record_id !== requiredRecord?.toLowerCase())) {
        throw new Error("Invalid Style DNA request state");
      }
      const outcome = recordAvailable ? await saveChange(client, owner, change) : fail("not_found", 404);
      return withRequestModel(await completeRequest(client, owner, id, outcome), row.generation_model);
    }),
  };
}

// 영수증 조회(receipt)는 생성 확정 경계에서만 쓰는 선택 메서드다. 주입 저장소에 없으면 '확인하지 못함'으로 본다.
type FullStyleDnaStore = ReturnType<typeof createStyleDnaStore>;
type GenerationRead = "receipt" | "generationStatus";
export type StyleDnaStore = Omit<FullStyleDnaStore, GenerationRead> & Partial<Pick<FullStyleDnaStore, GenerationRead>>;
let runtimeStore: StyleDnaStore | undefined;
export function openStyleDnaStore(): StyleDnaStore | null {
  if (runtimeStore) return runtimeStore;
  const raw = process.env.DREAM_STYLE_DNA_DB_URL;
  if (!raw) return null;
  const ref = supabasePublicConfig(process.env)?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) return null;
  const url = new URL(raw);
  const { hostname } = url;
  const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
  const direct = hostname === `db.${ref}.supabase.co` && url.port === "5432" && user === appRole;
  const pooled = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) && ["5432", "6543"].includes(url.port) && user === `${appRole}.${ref}`;
  if (!["postgres:", "postgresql:"].includes(url.protocol) || (!direct && !pooled) || url.pathname !== "/postgres" ||
    !password || url.search || url.hash) return null;
  const ca = process.env.DREAM_STYLE_DNA_DB_CA?.trim();
  const pool = new Pool({ host: hostname, port: Number(url.port), database: "postgres", user, password,
    ssl: { rejectUnauthorized: true, servername: hostname, ...(ca && { ca }) }, max: 3, idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Keep idle connection failures private. */ });
  return runtimeStore = createStyleDnaStore(pool);
}
