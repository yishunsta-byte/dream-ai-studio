import "server-only";
import type { VerifiedActor } from "@/lib/db/postgres/types";
import type { PrivateObjectReader } from "@/lib/storage/supabase/reader";
import { StorageReadError } from "@/lib/storage/supabase/errors";

// Trusted server adapter input must contain actual DB owner_id and MIME. The
// current B12 DTO lacks them: do not assert/copy actor.id or infer MIME to fill it.
// Not wired to B12/default API. No metadata-only or always-true fallback.
export function postgresAssetAvailability(reader: PrivateObjectReader) {
  return async (asset: unknown, actor: VerifiedActor, signal?: AbortSignal): Promise<boolean> => {
    try { await reader.verify(actor, asset, signal); return true; }
    catch (error) {
      if (error instanceof StorageReadError && ["STORAGE_INPUT", "STORAGE_OWNER", "STORAGE_NOT_FOUND", "STORAGE_INTEGRITY", "STORAGE_TYPE", "STORAGE_LIMIT", "STORAGE_PRIVATE"].includes(error.code)) return false;
      throw new StorageReadError(error instanceof StorageReadError ? error.code : "STORAGE_UNAVAILABLE");
    }
  };
}
