import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import { authMode } from "../auth/config";
import { resolveServerAuth, type ServerAuthResult } from "../auth/resolve";
import { withActorTransaction } from "../db/postgres/transaction";
import { actorFromVerifiedUserId } from "../db/postgres/types";
import { selectProjectReadBackend } from "../services/postgres/project-read-backend";
import { getProcessProjectReadPool } from "../services/postgres/project-read-pool";
import { ownedStorageAsset } from "../storage/supabase/object-key";
import { referenceFileByteLimit } from "./input";

const uuid = z.guid().transform(value => value.toLowerCase());
const selectionSchema = z.strictObject({ projectId: uuid, assetId: z.uuidv7().transform(value => value.toLowerCase()) });
const positivePgInteger = z.union([z.number().int(), z.bigint(), z.string().regex(/^[1-9][0-9]{0,15}$/)])
  .transform(Number).pipe(z.number().int().positive().safe());
const rowSchema = z.strictObject({
  owner_id: uuid, project_id: uuid, asset_id: uuid, kind: z.enum(["image", "video"]), mime: z.string(),
  object_key: z.string(), sha256: z.string(), size_bytes: positivePgInteger, storage_generation: positivePgInteger,
});

type Dependencies = {
  resolveAuth: () => Promise<ServerAuthResult>;
  environment: () => Readonly<Record<string, string | undefined>>;
  getPool: (connectionString: string) => Pick<Pool, "connect">;
};
type Observation =
  | {
    status: "observed"; analysisAuthority: "unavailable";
    registration: { media: "image" | "video"; mime: string; sizeBytes: number; registeredSha256: string; storageGeneration: number };
  }
  | { status: "unavailable"; reason: "authentication_required" | "authentication_denied" | "authentication_unavailable" |
      "invalid_selection" | "local_ownership_unavailable" | "managed_unavailable" | "not_visible" };

const query = `SELECT a.owner_id, p.id AS project_id, a.id AS asset_id, a.kind, a.mime,
    a.file_path AS object_key, a.sha256, a.size_bytes, o.active_generation AS storage_generation
  FROM dream.projects p
  JOIN dream.assets a ON a.owner_id = p.owner_id AND a.id = $3
  JOIN dream.asset_receipt_state s ON s.owner_id = a.owner_id AND s.asset_id = a.id
  JOIN dream.storage_objects o ON o.owner_id = s.owner_id AND o.id = s.object_id AND o.registered_asset_id = a.id
  JOIN dream.storage_verification_receipts r ON r.owner_id = s.owner_id
    AND r.id = s.current_receipt_id AND r.object_id = o.id AND r.asset_id = a.id
  WHERE p.owner_id = $1 AND p.id = $2 AND p.archived_at IS NULL AND a.archived_at IS NULL
    AND a.is_mock = 0 AND a.kind IN ('image', 'video') AND s.status = 'ready' AND o.lifecycle = 'registered'
    AND o.object_key = a.file_path AND o.sha256 = a.sha256 AND o.size_bytes = a.size_bytes
    AND o.kind = a.kind AND o.mime = a.mime AND r.identity_digest = o.identity_digest
    AND r.generation = o.active_generation AND r.verified_at <= CURRENT_TIMESTAMP AND r.not_after > CURRENT_TIMESTAMP
    AND EXISTS (
      SELECT 1 FROM dream.project_assets l WHERE l.owner_id = p.owner_id AND l.project_id = p.id AND l.asset_id = a.id
    )`;

/**
 * One server-only observation of a registered object under the current verified owner.
 * A storage verification generation only describes the object. This result grants no analysis or apply authority.
 */
export async function readRegisteredReferenceAuthority(input: unknown, overrides: Partial<Dependencies> = {}): Promise<Observation> {
  const dependencies = {
    resolveAuth: resolveServerAuth, environment: () => ({ ...process.env }),
    getPool: getProcessProjectReadPool, ...overrides,
  } satisfies Dependencies;
  let auth: ServerAuthResult;
  try { auth = await dependencies.resolveAuth(); }
  catch { return { status: "unavailable", reason: "authentication_unavailable" }; }
  if (auth?.kind === "denied") {
    const reason = auth.code === "AUTH_REQUIRED" ? "authentication_required" :
      auth.code === "AUTH_FORBIDDEN" ? "authentication_denied" : "authentication_unavailable";
    return { status: "unavailable", reason };
  }
  if (auth?.kind === "local") return { status: "unavailable", reason: "local_ownership_unavailable" };
  if (auth?.kind !== "verified" || !auth.email) return { status: "unavailable", reason: "authentication_unavailable" };
  let actor;
  try { actor = actorFromVerifiedUserId(auth.userId); }
  catch { return { status: "unavailable", reason: "authentication_unavailable" }; }

  const selection = selectionSchema.safeParse(input);
  if (!selection.success) return { status: "unavailable", reason: "invalid_selection" };
  try {
    const env = dependencies.environment();
    const backend = selectProjectReadBackend(env, authMode(env));
    if (backend.backend !== "postgres") return { status: "unavailable", reason: "local_ownership_unavailable" };
    const pool = dependencies.getPool(backend.connectionString);
    const { projectId, assetId } = selection.data;
    return await withActorTransaction(pool, actor, async tx => {
      const result = await tx.query(query, [tx.actorId, projectId, assetId]);
      if (result.rows.length !== 1) return { status: "unavailable", reason: "not_visible" };
      const parsed = rowSchema.safeParse(result.rows[0]);
      if (!parsed.success || parsed.data.owner_id !== tx.actorId ||
        parsed.data.project_id !== projectId || parsed.data.asset_id !== assetId) {
        return { status: "unavailable", reason: "not_visible" };
      }
      const row = parsed.data;
      try {
        const registered = ownedStorageAsset(actor, {
          ownerId: row.owner_id, id: row.asset_id, kind: row.kind, mime: row.mime,
          objectKey: row.object_key, sha256: row.sha256, sizeBytes: row.size_bytes,
        }, referenceFileByteLimit);
        return { status: "observed", analysisAuthority: "unavailable", registration: {
          media: registered.kind, mime: registered.mime, sizeBytes: registered.sizeBytes,
          registeredSha256: registered.sha256, storageGeneration: row.storage_generation,
        } };
      } catch { return { status: "unavailable", reason: "not_visible" }; }
    }, { mode: "read-only-repeatable-read" });
  } catch { return { status: "unavailable", reason: "managed_unavailable" }; }
}
