import "server-only";
import type { Pool } from "pg";
import type { VerifiedActor } from "@/lib/db/postgres/types";
import type { PrivateObjectReader } from "@/lib/storage/supabase/reader";
import { StorageReadError } from "@/lib/storage/supabase/errors";
import { postgresAssetAvailability } from "./asset-availability";
import { postgresProjectCreate } from "./project-create";

// Trusted server composition only. No environment, default reader/config, Auth
// resolution or API activation. Budget stays below the existing pool's 15s idle
// transaction limit; request signals/controllers never live in shared state.
export function postgresProjectCreateWithStorage(pool: Pick<Pool, "connect">, reader: PrivateObjectReader, options: Readonly<{ ioTimeoutMs: number }>) {
  const budget = options.ioTimeoutMs;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10000) throw new StorageReadError("STORAGE_CONFIG");
  const available = postgresAssetAvailability(reader);
  return Object.freeze({
    async create(actor: VerifiedActor, menuId: string, input: unknown, serverSnapshot: unknown, signal?: AbortSignal) {
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new StorageReadError("STORAGE_INPUT");
      const controller = new AbortController(), abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, budget);
      const scopedPool = {
        async connect() {
          if (controller.signal.aborted) throw new StorageReadError("STORAGE_ABORTED");
          const client = await pool.connect();
          if (controller.signal.aborted) { client.release(); throw new StorageReadError("STORAGE_ABORTED"); }
          return new Proxy(client, {
            get(target, property) {
              if (property === "query") return (sql: string, values?: unknown[]) => {
                // Cancellation before any new statement (including COMMIT)
                // must still allow the real transaction helper's ROLLBACK.
                if (controller.signal.aborted && sql !== "ROLLBACK") return Promise.reject(new StorageReadError("STORAGE_ABORTED"));
                return target.query(sql, values);
              };
              const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
      try {
        return await postgresProjectCreate(scopedPool, { assetAvailable: (asset, verifiedActor) => available(asset, verifiedActor, controller.signal) })
          .create(actor, menuId, input, serverSnapshot);
      } finally { clearTimeout(timer);signal?.removeEventListener("abort", abort);controller.abort(); }
      // No post-COMMIT cancellation error: a confirmed committed ID stays valid.
      // In-flight COMMIT uncertainty remains the existing transaction contract.
    },
  });
}
