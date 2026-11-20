import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import { credentialGroup, credentialKey, credentialModels, credentialTestMap, credentialTestResult,
  type CredentialGroup, type CredentialModels, type CredentialTest, type GeminiProgram } from "./analysis-credential-contract";

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

const role = "dream_gemini_app";
const table = "dream_gemini_credentials.credentials";
const unavailable = () => new Error("Analysis credential store unavailable");
const metadataColumns = "provider_group,models,version,updated_at,key_id,last_test";
const keyName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const encryptedKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const configShape = z.strictObject({ primary: keyName, keys: z.record(keyName, encryptedKey) });
const rowShape = z.object({
  provider_group: z.enum(["reference", "music"]), models: z.unknown(),
  version: z.number().int().min(1).max(2_147_483_647), updated_at: z.date(), key_id: keyName,
  last_test: credentialTestMap,
});
type Row = z.infer<typeof rowShape>;

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

export function createGeminiCredentialStore(pool: PoolLike, ring: KeyRing): GeminiCredentialStore {
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

  return {
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
      const { nonce, ciphertext, tag } = rows[0];
      if (!Buffer.isBuffer(nonce) || nonce.length !== 12 || !Buffer.isBuffer(ciphertext) || ciphertext.length > 256 ||
          !Buffer.isBuffer(tag) || tag.length !== 16) throw unavailable();
      const cipher = createDecipheriv("aes-256-gcm", keyFor(ring, row.key_id), nonce);
      cipher.setAAD(aad(owner.toLowerCase(), group, row.version, saved.models, row.key_id));
      cipher.setAuthTag(tag);
      const bytes = Buffer.concat([cipher.update(ciphertext), cipher.final()]);
      try { return { ...saved, apiKey: credentialKey.parse(bytes.toString("utf8")) }; }
      finally { bytes.fill(0); }
    }),
    write: (owner, { group, models, apiKey }, expectedVersion) => transaction(owner, false, async client => {
      const parsedModels = credentialModels(group, models);
      const version = expectedVersion + 1;
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keyFor(ring, ring.primary), nonce);
      cipher.setAAD(aad(owner.toLowerCase(), group, version, parsedModels, ring.primary));
      const ciphertext = Buffer.concat([cipher.update(credentialKey.parse(apiKey), "utf8"), cipher.final()]);
      const args = [owner, group, version, JSON.stringify(parsedModels), ring.primary, nonce, ciphertext, cipher.getAuthTag()];
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
}

let runtimeStore: GeminiCredentialStore | undefined;
export function openRuntimeGeminiCredentialStore(): GeminiCredentialStore | null {
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
    runtimeStore = createGeminiCredentialStore(pool, ring);
    return runtimeStore;
  } catch { throw unavailable(); }
}
