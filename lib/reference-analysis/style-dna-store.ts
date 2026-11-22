import "server-only";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import { measureComparisonSpots, summarizeComparisonSpots } from "./style-dna-comparison";
import { styleDnaTrendLimit, type StyleDnaComparison, type StyleDnaComparisonCommand,
  type StyleDnaComparisonTrend, type StyleDnaRecord, type StyleDnaRevision, type StyleDnaSummary,
  type StyleDnaTestResult } from "./style-dna-contract";

type StoredTrend = Omit<StyleDnaComparisonTrend, "prompt">;
type StoredComparison = Omit<StyleDnaComparison, "trends"> & { trends: StoredTrend[] };
type StoredRecord = Omit<StyleDnaRecord, "comparison"> & { comparison?: StoredComparison; trendPrompts?: Record<string, string> };
type Outcome = { status: number; body: { code?: string; record?: StyleDnaRecord; test?: StyleDnaTestResult; comparison?: StyleDnaComparison } };
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

async function reserveRequest(client: PoolClient, owner: string, id: string, inputHash: string, recordAvailable = true) {
  const result = await client.query("INSERT INTO dream_style_dna.requests(owner_id,id,input_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [owner, id, inputHash]);
  if (result.rowCount) return recordAvailable ? undefined : completeRequest(client, owner, id, fail("not_found", 404));
  const { rows: [row] } = await client.query<{ input_hash: string; outcome: Outcome | null }>(
    "SELECT input_hash,outcome FROM dream_style_dna.requests WHERE owner_id=$1 AND id=$2", [owner, id]);
  if (row.input_hash !== inputHash) return fail("request_conflict", 409);
  if (!recordAvailable) return fail("not_found", 404);
  if (!row.outcome) return fail("in_progress", 202);
  return { ...row.outcome, status: row.outcome.status === 201 ? 200 : row.outcome.status };
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
      await client.query(`UPDATE dream_style_dna.requests SET outcome=$3::jsonb
        WHERE owner_id=$1 AND outcome IS NOT NULL AND
          COALESCE(outcome#>>'{body,record,id}', outcome#>>'{body,test,id}', outcome#>>'{body,comparison,baseline,testId}')=ANY($2::text[])`,
        [owner, [record.id, ...record.tests.map(test => test.id)], JSON.stringify(fail("not_found", 404))]);
      await client.query("DELETE FROM dream_style_dna.media WHERE owner_id=$1 AND record_id=$2", [owner, id]);
      await client.query("DELETE FROM dream_style_dna.records WHERE owner_id=$1 AND id=$2", [owner, id]);
      return true;
    }),
    media: (owner: string, record: string, id: string) => transaction(owner, false, async client => {
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
    reserve: (owner: string, id: string, inputHash: string, requiredRecord?: string) => transaction(owner, true, async client => {
      const recordAvailable = !requiredRecord || await lockRecord(client, owner, requiredRecord, "KEY SHARE");
      return reserveRequest(client, owner, id, inputHash, recordAvailable);
    }),
    finish: (owner: string, id: string, change: Change, requiredRecord?: string) => transaction(owner, true, async client => {
      // Lock the record before the receipt, in the same order as deletion.
      const recordAvailable = !requiredRecord || await lockRecord(client, owner, requiredRecord, "UPDATE");
      const { rows: [row] } = await client.query<{ outcome: Outcome | null }>(
        "SELECT outcome FROM dream_style_dna.requests WHERE owner_id=$1 AND id=$2 FOR UPDATE", [owner, id]);
      if (!row || row.outcome) throw new Error("Invalid Style DNA request state");
      const outcome = recordAvailable ? await saveChange(client, owner, change) : fail("not_found", 404);
      return completeRequest(client, owner, id, outcome);
    }),
  };
}

export type StyleDnaStore = ReturnType<typeof createStyleDnaStore>;
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
