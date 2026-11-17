import "server-only";
import type { Pool } from "pg";
import { createPostgresPool, type PostgresConnectionOptions } from "@/lib/db/postgres/connection";
import { PostgresAccessError } from "@/lib/db/postgres/types";

// One explicitly configured pool per manager lifetime. Configuration
// changes require a new manager/process, never an automatic second target.
export function createProjectReadPoolManager(options: Omit<PostgresConnectionOptions, "connectionString"> = {}) {
  const config = Object.freeze({ ...options });
  let pool: Pool | undefined;
  let target: string | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  return Object.freeze({
    get(connectionString: string): Pool {
      if (closed) throw new PostgresAccessError("PG_UNAVAILABLE");
      if (pool && target !== connectionString) throw new PostgresAccessError("PG_CONFIG");
      if (!pool) {
        pool = createPostgresPool({ ...config, connectionString });
        target = connectionString;
      }
      return pool;
    },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      closing = pool ? pool.end().catch(() => { throw new PostgresAccessError("PG_UNAVAILABLE"); }) : Promise.resolve();
      return closing;
    },
  });
}

// The symbol slot survives server module reloads/bundle copies in the same Node
// process. It contains only this manager, never user/actor/request state.
const processSlot = Symbol.for("dream.project-read-pool.v1");
const runtime = globalThis as typeof globalThis & { [processSlot]?: ReturnType<typeof createProjectReadPoolManager> };
if (!runtime[processSlot]) Object.defineProperty(runtime, processSlot, { value: createProjectReadPoolManager(), enumerable: false });
const processPools = runtime[processSlot]!;
export const getProcessProjectReadPool = (connectionString: string) => processPools.get(connectionString);
// Explicit host shutdown hook. No signal handlers, timers, eager connection,
// environment reads or automatic shutdown are installed by importing this module.
export const closeProcessProjectReadPool = () => processPools.close();
