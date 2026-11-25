import "server-only";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import { projectAudioReport, type AudioAnalysisResponse } from "./admin-audio-details-contract";
import { adminAudioChunkBytes, type AudioCleanupStatus, type AudioUpload, type AudioUploadStart, type AudioUploadStatus } from "./admin-audio-upload-contract";
import { projectMusicModelVersion } from "./music-semantic-contract";

export type AudioUploadRow = {
  id: string; filename: string; status: AudioUploadStatus; request_hash: string; size_bytes: number; received_bytes: number;
  expires_at: Date; credential_version: number; analysis_id: string | null; analysis_hash: string | null;
  report: AudioAnalysisResponse | null; code: string | null; provider_file: string | null; cleanup: AudioCleanupStatus;
};
type Result = { status: number; row?: AudioUploadRow; code?: string; claimed?: true };
const role = "dream_audio_upload_app";
const maxActiveUploads = 2;

export function audioUploadDto(row: AudioUploadRow, expanded = false, includeModelVersion = false): AudioUpload {
  return { id: row.id, status: row.status, sizeBytes: row.size_bytes, receivedBytes: row.received_bytes,
    chunkBytes: adminAudioChunkBytes, expiresAt: row.expires_at.toISOString(), cleanup: row.cleanup,
    ...(row.report && { report: projectMusicModelVersion(projectAudioReport(row.report, expanded), includeModelVersion) }), ...(row.code && { code: row.code }) };
}

async function expire(client: PoolClient, owner: string, id?: string) {
  await client.query(`WITH expired AS (UPDATE dream_audio_upload.uploads SET status='expired',code='expired'
    WHERE owner_id=$1 AND expires_at<=clock_timestamp() AND status IN ('uploading','uploaded','analyzing')
    ${id ? "AND id=$2" : ""} RETURNING id)
    DELETE FROM dream_audio_upload.chunks c USING expired e WHERE c.owner_id=$1 AND c.upload_id=e.id`, id ? [owner, id] : [owner]);
}

async function upload(client: PoolClient, owner: string, id: string, lock = false) {
  if (lock) await expire(client, owner, id);
  const { rows: [row] } = await client.query<AudioUploadRow>(`SELECT id,filename,status,request_hash,size_bytes,received_bytes,expires_at,
    credential_version,analysis_id,analysis_hash,report,code,provider_file,cleanup
    FROM dream_audio_upload.uploads WHERE owner_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [owner, id]);
  return row;
}

const unavailable = (row?: AudioUploadRow): Result => row?.status === "expired"
  ? { status: 410, row, code: "expired" } : { status: 404, code: "not_found" };

export function createAdminAudioUploadStore(pool: Pick<Pool, "connect">) {
  async function transaction<T>(owner: string, write: boolean, action: (client: PoolClient) => Promise<T>) {
    const id = z.guid().parse(owner);
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
      await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='4s'; SET LOCAL statement_timeout='10s'");
      const identity = await client.query(`SELECT current_user=session_user AND current_user=$1 AND
        NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit) AND
        NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS ok FROM pg_roles r WHERE r.rolname=current_user`, [role]);
      if (!identity.rows[0]?.ok) throw new Error("Invalid audio upload role");
      await client.query("SELECT set_config('dream_audio_upload.owner_id',$1,true)", [id]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  const deleteChunks = (client: PoolClient, owner: string, id: string) => client.query(
    "DELETE FROM dream_audio_upload.chunks WHERE owner_id=$1 AND upload_id=$2", [owner, id]);

  return {
    start: (owner: string, id: string, input: AudioUploadStart, fingerprint: string) => transaction(owner, true, async (client): Promise<Result> => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-audio-upload:' || $1::text,0))", [owner]);
      await expire(client, owner);
      const { rows: [existing] } = await client.query<AudioUploadRow>("SELECT * FROM dream_audio_upload.uploads WHERE owner_id=$1 AND request_id=$2", [owner, input.requestId]);
      if (existing) return existing.request_hash === fingerprint ? { status: 200, row: existing } : { status: 409, code: "request_conflict" };
      const { rows: [active] } = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM dream_audio_upload.uploads
        WHERE owner_id=$1 AND status IN ('uploading','uploaded','analyzing')`, [owner]);
      if (active.count >= maxActiveUploads) return { status: 429, code: "upload_limit" };
      const { rows: [row] } = await client.query<AudioUploadRow>(`INSERT INTO dream_audio_upload.uploads
        (owner_id,id,request_id,request_hash,credential_version,filename,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [owner, id, input.requestId, fingerprint, input.credentialVersion, input.filename, input.sizeBytes]);
      return { status: 201, row };
    }),
    get: (owner: string, id: string) => transaction(owner, true, client => upload(client, owner, id, true)),
    append: (owner: string, id: string, offset: number, bytes: Buffer, credentialVersion: number) => transaction(owner, true, async (client): Promise<Result> => {
      const row = await upload(client, owner, id, true);
      if (!row || row.status === "expired") return unavailable(row);
      if (row.credential_version !== credentialVersion) return { status: 409, row, code: "stale_credential" };
      if (row.status !== "uploading" && row.status !== "uploaded") return { status: 409, row, code: "upload_closed" };
      const expectedSize = Math.min(adminAudioChunkBytes, row.size_bytes - offset);
      if (offset % adminAudioChunkBytes || offset > row.received_bytes) return { status: 409, row, code: "offset_conflict" };
      if (offset >= row.size_bytes || bytes.length !== expectedSize) return { status: 400, row, code: "chunk_size" };
      if (offset < row.received_bytes) {
        const { rows: [prior] } = await client.query<{ same: boolean }>(`SELECT data=$4::bytea AS same FROM dream_audio_upload.chunks
          WHERE owner_id=$1 AND upload_id=$2 AND offset_bytes=$3`, [owner, id, offset, bytes]);
        return prior?.same ? { status: 200, row } : { status: 409, row, code: "chunk_conflict" };
      }
      await client.query("INSERT INTO dream_audio_upload.chunks(owner_id,upload_id,offset_bytes,data) VALUES($1,$2,$3,$4)", [owner, id, offset, bytes]);
      const { rows: [updated] } = await client.query<AudioUploadRow>(`UPDATE dream_audio_upload.uploads SET received_bytes=received_bytes+$3,
        status=CASE WHEN received_bytes+$3=size_bytes THEN 'uploaded' ELSE 'uploading' END WHERE owner_id=$1 AND id=$2 RETURNING *`, [owner, id, bytes.length]);
      return { status: 200, row: updated };
    }),
    claim: (owner: string, id: string, requestId: string, fingerprint: string, credentialVersion: number) => transaction(owner, true, async (client): Promise<Result> => {
      const row = await upload(client, owner, id, true);
      if (!row || row.status === "expired") return unavailable(row);
      if (row.analysis_id === requestId && row.analysis_hash === fingerprint) {
        return { status: row.status === "analyzing" ? 202 : 200, row };
      }
      if (row.credential_version !== credentialVersion) return { status: 409, row, code: "stale_credential" };
      if (row.status !== "uploaded") return { status: 409, row, code: "analysis_conflict" };
      const { rows: [claimed] } = await client.query<AudioUploadRow>(`UPDATE dream_audio_upload.uploads SET status='analyzing',
        analysis_id=$3,analysis_hash=$4 WHERE owner_id=$1 AND id=$2 RETURNING *`, [owner, id, requestId, fingerprint]);
      return { status: 202, row: claimed, claimed: true };
    }),
    chunk: (owner: string, id: string, requestId: string, offset: number) => transaction(owner, false, async client => {
      const { rows: [row] } = await client.query<{ data: Buffer }>(`SELECT c.data FROM dream_audio_upload.chunks c JOIN dream_audio_upload.uploads u
        ON (u.owner_id,u.id)=(c.owner_id,c.upload_id) WHERE c.owner_id=$1 AND c.upload_id=$2 AND u.analysis_id=$3
        AND c.offset_bytes=$4 AND u.status='analyzing' AND u.expires_at>clock_timestamp()`, [owner, id, requestId, offset]);
      return row?.data;
    }),
    recordFile: (owner: string, id: string, requestId: string, name: string) => transaction(owner, true, async client => {
      const { rowCount } = await client.query(`UPDATE dream_audio_upload.uploads SET provider_file=$4,cleanup='pending'
        WHERE owner_id=$1 AND id=$2 AND analysis_id=$3 AND provider_file IS NULL`, [owner, id, requestId, name]);
      if (rowCount !== 1) throw new Error("Audio provider file was not recorded");
    }),
    finish: (owner: string, id: string, requestId: string, outcome: { report: AudioAnalysisResponse } | { code: string; uncertain?: boolean }) => transaction(owner, true, async client => {
      const row = await upload(client, owner, id, true);
      if (!row || row.analysis_id !== requestId) return row;
      if (row.status !== "analyzing") {
        if ("code" in outcome && outcome.uncertain && row.cleanup === "none") {
          const { rows: [changed] } = await client.query<AudioUploadRow>(`UPDATE dream_audio_upload.uploads SET cleanup='unconfirmed'
            WHERE owner_id=$1 AND id=$2 RETURNING *`, [owner, id]);
          return changed;
        }
        return row;
      }
      const ready = "report" in outcome;
      const { rows: [updated] } = await client.query<AudioUploadRow>(`UPDATE dream_audio_upload.uploads SET status=$3,report=$4::jsonb,code=$5,
        cleanup=CASE WHEN cleanup='none' AND $6 THEN 'unconfirmed' ELSE cleanup END WHERE owner_id=$1 AND id=$2 RETURNING *`,
      [owner, id, ready ? "completed" : "failed", ready ? JSON.stringify(outcome.report) : null, ready ? null : outcome.code, !ready && !!outcome.uncertain]);
      await deleteChunks(client, owner, id);
      return updated;
    }),
    cancel: (owner: string, id: string) => transaction(owner, true, async client => {
      const row = await upload(client, owner, id, true);
      if (!row || (row.status !== "uploading" && row.status !== "uploaded" && row.status !== "analyzing")) return row;
      const { rows: [updated] } = await client.query<AudioUploadRow>(`UPDATE dream_audio_upload.uploads SET status='cancelled',code='cancelled'
        WHERE owner_id=$1 AND id=$2 RETURNING *`, [owner, id]);
      await deleteChunks(client, owner, id);
      return updated;
    }),
    cleaned: (owner: string, id: string, name: string) => transaction(owner, true, async client => {
      await client.query(`UPDATE dream_audio_upload.uploads SET provider_file=NULL,cleanup='done'
        WHERE owner_id=$1 AND id=$2 AND provider_file=$3 AND status IN ('completed','failed','cancelled','expired')`, [owner, id, name]);
      return upload(client, owner, id);
    }),
  };
}

export type AdminAudioUploadStore = ReturnType<typeof createAdminAudioUploadStore>;
let configuredStore: AdminAudioUploadStore | undefined;
export function openAdminAudioUploadStore(): AdminAudioUploadStore | null {
  if (configuredStore) return configuredStore;
  const raw = process.env.DREAM_AUDIO_UPLOAD_DB_URL;
  if (!raw) return null;
  const ref = supabasePublicConfig(process.env)?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) return null;
  const url = new URL(raw);
  const { hostname } = url;
  const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
  const direct = hostname === `db.${ref}.supabase.co` && url.port === "5432" && user === role;
  const pooled = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) && ["5432", "6543"].includes(url.port) && user === `${role}.${ref}`;
  if (!["postgres:", "postgresql:"].includes(url.protocol) || (!direct && !pooled) || url.pathname !== "/postgres" ||
    !password || url.search || url.hash) return null;
  const ca = process.env.DREAM_AUDIO_UPLOAD_DB_CA?.trim();
  const pool = new Pool({ host: hostname, port: Number(url.port), database: "postgres", user, password,
    ssl: { rejectUnauthorized: true, servername: hostname, ...(ca && { ca }) }, max: 3,
    connectionTimeoutMillis: 4000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  pool.on("error", () => { /* Idle connection errors stay private. */ });
  return configuredStore = createAdminAudioUploadStore(pool);
}
