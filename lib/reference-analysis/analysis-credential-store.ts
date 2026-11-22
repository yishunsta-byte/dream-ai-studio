import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import { credentialGroup, credentialKey, credentialModels, credentialTestMap, credentialTestResult, modelId,
  type CredentialGroup, type CredentialModels, type CredentialTest, type GeminiProgram } from "./analysis-credential-contract";
import { isStyleDnaEngineModel, styleDnaEngine, type StyleDnaEngine, type StyleDnaEngineBasis, type StyleDnaEngineCredentialMetadata,
  type StyleDnaEngineCredentialWrite } from "./style-dna-engine-credential-contract";

type PoolLike = Pick<Pool, "connect">;
type KeyRing = { primary: string; keys: Readonly<Record<string, Buffer>> };
type Metadata = { group: CredentialGroup; models: CredentialModels; version: number; updatedAt: string;
  lastTest: Partial<Record<GeminiProgram, CredentialTest>> };
type Opened = Metadata & { apiKey: string };
export type GeminiCredentialStore = {
  metadata(owner: string): Promise<Metadata[]>;
  open(owner: string, group: CredentialGroup): Promise<Opened | undefined>;
  write(owner: string, value: Pick<Opened, "group" | "models" | "apiKey">, expectedVersion: number): Promise<boolean>;
  recordTest(owner: string, group: CredentialGroup, version: number, program: GeminiProgram, code: CredentialTest["code"]): Promise<CredentialTest | undefined>;
};
type RegisteredEngine = Extract<StyleDnaEngineCredentialMetadata, { configured: true }>;
export type StyleDnaEngineCredentialStore = {
  metadata(owner: string): Promise<Partial<Record<StyleDnaEngine, RegisteredEngine>>>;
  open(owner: string, provider: StyleDnaEngine): Promise<(RegisteredEngine & { apiKey: string }) | undefined>;
  isCurrent(owner: string, engine: StyleDnaEngineBasis): Promise<boolean>;
  whileCurrent<T>(owner: string, engine: StyleDnaEngineBasis, run: () => Promise<T>): Promise<T | undefined>;
  write(owner: string, input: StyleDnaEngineCredentialWrite): Promise<RegisteredEngine | "stale" | "invalid_input">;
};

const role = "dream_gemini_app";
const table = "dream_gemini_credentials.credentials";
const engineTable = "dream_gemini_credentials.style_dna_engine_credentials";
const unavailable = () => new Error("Analysis credential store unavailable");
const metadataColumns = "provider_group,models,version,updated_at,key_id,last_test";
const keyName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const encryptedKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const configShape = z.strictObject({ primary: keyName, keys: z.record(keyName, encryptedKey) });
const keyRow = z.object({
  version: z.number().int().min(1).max(2_147_483_647), updated_at: z.date(), key_id: keyName,
});
const rowShape = keyRow.extend({ provider_group: z.enum(["reference", "music"]), models: z.unknown(),
  last_test: credentialTestMap });
type Row = z.infer<typeof rowShape>;
const engineColumns = "provider,model_id,version,updated_at,key_id";
const engineRow = keyRow.extend({ provider: styleDnaEngine, model_id: modelId })
  .refine(row => isStyleDnaEngineModel(row.provider, row.model_id));

export function readGeminiCredentialKeyRing(value: string): KeyRing {
  if (value.length > 4096) throw unavailable();
  const { primary, keys } = configShape.parse(JSON.parse(value));
  if (!Object.hasOwn(keys, primary) || Object.keys(keys).length > 4) throw unavailable();
  return { primary, keys: Object.fromEntries(Object.entries(keys).map(([id, encoded]) => {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== encoded) throw unavailable();
    return [id, bytes];
  })) };
}

function keyFor(ring: KeyRing, id: string) {
  if (!Object.hasOwn(ring.keys, id)) throw unavailable();
  return ring.keys[id];
}

function metadata(row: Row, ring: KeyRing): Metadata {
  keyFor(ring, row.key_id);
  return { group: row.provider_group, models: credentialModels(row.provider_group, row.models),
    version: row.version, updatedAt: row.updated_at.toISOString(), lastTest: row.last_test };
}

const aad = (owner: string, group: CredentialGroup, version: number, models: CredentialModels, keyId: string) =>
  Buffer.from(JSON.stringify(["dream-gemini-credential-v1", owner, group, version, models, keyId]));

const engineAad = (owner: string, provider: StyleDnaEngine, version: number, model: string, keyId: string) =>
  Buffer.from(JSON.stringify(["dream-style-dna-engine-credential-v1", owner.toLowerCase(), provider, version, model, keyId]));

function sealKey(apiKey: string, ring: KeyRing, associatedData: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(ring, ring.primary), nonce);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(credentialKey.parse(apiKey), "utf8"), cipher.final()]);
  return [ring.primary, nonce, ciphertext, cipher.getAuthTag()] as const;
}

function openKey({ nonce, ciphertext, tag }: Record<string, unknown>, key: Buffer, associatedData: Buffer) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12 || !Buffer.isBuffer(ciphertext) || ciphertext.length > 256 ||
      !Buffer.isBuffer(tag) || tag.length !== 16) throw unavailable();
  const cipher = createDecipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData);
  cipher.setAuthTag(tag);
  const bytes = Buffer.concat([cipher.update(ciphertext), cipher.final()]);
  try { return credentialKey.parse(bytes.toString("utf8")); }
  finally { bytes.fill(0); }
}

function engineMetadata(row: z.infer<typeof engineRow>, ring: KeyRing): RegisteredEngine {
  keyFor(ring, row.key_id);
  return { configured: true, modelId: row.model_id, version: row.version, updatedAt: row.updated_at.toISOString() };
}

function openEngineKey(owner: string, raw: Record<string, unknown>, row: z.infer<typeof engineRow>, ring: KeyRing) {
  return openKey(raw, keyFor(ring, row.key_id), engineAad(owner, row.provider, row.version, row.model_id, row.key_id));
}

async function currentEngine(client: PoolClient, owner: string, engine: StyleDnaEngineBasis, lock = false) {
  const result = await client.query(`SELECT 1 FROM ${engineTable} WHERE owner_id=$1 AND provider=$2 AND model_id=$3 AND version=$4${lock ? " FOR SHARE" : ""}`,
    [owner, engine.provider, engine.modelId, engine.credentialVersion]);
  return result.rowCount === 1;
}

export function createAnalysisCredentialStores(pool: PoolLike, ring: KeyRing) {
  async function transaction<T>(owner: string, readOnly: boolean, run: (client: PoolClient) => Promise<T>) {
    let client: PoolClient | undefined;
    let broken = false;
    try {
      const id = z.guid().parse(owner).toLowerCase();
      client = await pool.connect();
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query("SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = '3s'; SET LOCAL lock_timeout = '2s'");
      const identity = await client.query(`SELECT current_user = session_user AND current_user = $1
        AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS allowed
        FROM pg_roles r WHERE r.rolname = current_user`, [role]);
      if (identity.rows[0]?.allowed !== true) throw unavailable();
      await client.query("SELECT set_config('dream_gemini.owner_id',$1,true)", [id]);
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch {
      if (client) {
        try { await client.query("ROLLBACK"); }
        catch { broken = true; }
      }
      throw unavailable();
    } finally { client?.release(broken); }
  }

  const gemini: GeminiCredentialStore = {
    metadata: owner => transaction(owner, true, async client => {
      const { rows } = await client.query(`SELECT ${metadataColumns} FROM ${table} WHERE owner_id=$1`, [owner]);
      return rows.map(row => metadata(rowShape.parse(row), ring));
    }),
    open: (owner, group) => transaction(owner, true, async client => {
      const { rows } = await client.query(`SELECT ${metadataColumns},nonce,ciphertext,tag FROM ${table}
        WHERE owner_id=$1 AND provider_group=$2`, [owner, group]);
      if (!rows[0]) return undefined;
      const row = rowShape.parse(rows[0]);
      const saved = metadata(row, ring);
      return { ...saved, apiKey: openKey(rows[0], keyFor(ring, row.key_id),
        aad(owner.toLowerCase(), group, row.version, saved.models, row.key_id)) };
    }),
    write: (owner, { group, models, apiKey }, expectedVersion) => transaction(owner, false, async client => {
      const parsedModels = credentialModels(group, models);
      const version = expectedVersion + 1;
      const sealed = sealKey(apiKey, ring, aad(owner.toLowerCase(), group, version, parsedModels, ring.primary));
      const args = [owner, group, version, JSON.stringify(parsedModels), ...sealed];
      const result = expectedVersion === 0
        ? await client.query(`INSERT INTO ${table}(owner_id,provider_group,version,models,key_id,nonce,ciphertext,tag)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (owner_id,provider_group) DO NOTHING`, args)
        : await client.query(`UPDATE ${table} SET version=$3,models=$4,key_id=$5,nonce=$6,ciphertext=$7,tag=$8,
            last_test='{}'::jsonb,updated_at=clock_timestamp() WHERE owner_id=$1 AND provider_group=$2 AND version=$9`, [...args, expectedVersion]);
      return result.rowCount === 1;
    }),
    recordTest: (owner, group, version, program, code) => transaction(owner, false, async client => {
      if (credentialGroup(program) !== group) throw unavailable();
      const { rows } = await client.query(`UPDATE ${table}
        SET last_test=last_test || jsonb_build_object($4::text,jsonb_build_object(
          'version',version,'status',$5::text,'code',$6::text,
          'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        WHERE owner_id=$1 AND provider_group=$2 AND version=$3 RETURNING last_test->($4::text) AS result`,
      [owner, group, version, program, code ? "failed" : "verified", code]);
      return rows[0] ? credentialTestResult.parse(rows[0].result) : undefined;
    }),
  };
  const engines: StyleDnaEngineCredentialStore = {
    metadata: owner => transaction(owner, true, async client => {
      const { rows } = await client.query(`SELECT ${engineColumns} FROM ${engineTable} WHERE owner_id=$1`, [owner]);
      return Object.fromEntries(rows.map(raw => {
        const row = engineRow.parse(raw);
        return [row.provider, engineMetadata(row, ring)];
      }));
    }),
    open: (owner, provider) => transaction(owner, true, async client => {
      const { rows: [raw] } = await client.query(`SELECT ${engineColumns},nonce,ciphertext,tag FROM ${engineTable}
        WHERE owner_id=$1 AND provider=$2`, [owner, provider]);
      if (!raw) return;
      const row = engineRow.parse(raw);
      return { ...engineMetadata(row, ring), apiKey: openEngineKey(owner, raw, row, ring) };
    }),
    isCurrent: (owner, engine) => transaction(owner, true, client => currentEngine(client, owner, engine)),
    // Hold the key/settings row until the Style DNA result transaction commits.
    whileCurrent: (owner, engine, run) => transaction(owner, false, async client => {
      if (await currentEngine(client, owner, engine, true)) return run();
    }),
    write: (owner, { provider, modelId, apiKey, expectedVersion }) => transaction(owner, false, async client => {
      let key = apiKey;
      if (key === undefined) {
        const { rows: [raw] } = await client.query(`SELECT ${engineColumns},nonce,ciphertext,tag FROM ${engineTable}
          WHERE owner_id=$1 AND provider=$2 AND version=$3`, [owner, provider, expectedVersion]);
        if (!raw) return "stale";
        const current = engineRow.parse(raw);
        key = openEngineKey(owner, raw, current, ring);
      }
      if (modelId.includes(key)) return "invalid_input";
      const version = expectedVersion + 1;
      const args = [owner, provider, modelId, version, ...sealKey(key, ring, engineAad(owner, provider, version, modelId, ring.primary))];
      const result = expectedVersion === 0
        ? await client.query(`INSERT INTO ${engineTable}(owner_id,provider,model_id,version,key_id,nonce,ciphertext,tag)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (owner_id,provider) DO NOTHING RETURNING ${engineColumns}`, args)
        : await client.query(`UPDATE ${engineTable} SET model_id=$3,version=$4,key_id=$5,nonce=$6,ciphertext=$7,tag=$8,
            updated_at=clock_timestamp() WHERE owner_id=$1 AND provider=$2 AND version=$9 RETURNING ${engineColumns}`, [...args, expectedVersion]);
      return result.rows[0] ? engineMetadata(engineRow.parse(result.rows[0]), ring) : "stale";
    }),
  };
  return { gemini, engines };
}

export function createGeminiCredentialStore(pool: PoolLike, ring: KeyRing): GeminiCredentialStore {
  return createAnalysisCredentialStores(pool, ring).gemini;
}

let runtimeStore: ReturnType<typeof createAnalysisCredentialStores> | undefined;
function openRuntimeAnalysisCredentialStores() {
  if (runtimeStore) return runtimeStore;
  const env = process.env;
  const raw = env.DREAM_ANALYSIS_CREDENTIALS_DB_URL;
  const keys = env.DREAM_ANALYSIS_CREDENTIALS_KEYS;
  if (raw === undefined && keys === undefined) return null;
  try {
    const project = supabasePublicConfig(env)?.url;
    const ref = project?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
    if (!raw || !keys || !ref) throw unavailable();
    const url = new URL(raw);
    const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const hostname = url.hostname;
    const direct = hostname === `db.${ref}.supabase.co` && url.port === "5432" && user === role;
    const pooled = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) &&
      ["5432", "6543"].includes(url.port) && user === `${role}.${ref}`;
    if (!["postgres:", "postgresql:"].includes(url.protocol) || (!direct && !pooled) ||
        url.pathname !== "/postgres" || !password || url.search || url.hash) throw unavailable();
    const ring = readGeminiCredentialKeyRing(keys);
    const ca = env.DREAM_ANALYSIS_CREDENTIALS_DB_CA?.trim();
    const pool = new Pool({ host: hostname, port: Number(url.port), database: "postgres", user, password,
      ssl: { rejectUnauthorized: true, servername: hostname, ...(ca && { ca }) },
      max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 4_000, allowExitOnIdle: true });
    pool.on("error", () => { /* Drop idle connections without exposing server or credential details. */ });
    runtimeStore = createAnalysisCredentialStores(pool, ring);
    return runtimeStore;
  } catch { throw unavailable(); }
}

export function openRuntimeGeminiCredentialStore(): GeminiCredentialStore | null {
  return openRuntimeAnalysisCredentialStores()?.gemini ?? null;
}

export function openRuntimeStyleDnaEngineCredentialStore(): StyleDnaEngineCredentialStore | null {
  return openRuntimeAnalysisCredentialStores()?.engines ?? null;
}
