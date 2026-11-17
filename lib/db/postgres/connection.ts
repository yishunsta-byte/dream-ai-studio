import "server-only";
import { Pool } from "pg";
import { PostgresAccessError } from "./types";

export type PostgresConnectionOptions = {
  connectionString: string;
  max?: number;
  ca?: string;
  // Only for an explicitly provisioned, loopback synthetic test database.
  localTestWithoutTls?: boolean;
};

export function createPostgresPool(options: PostgresConnectionOptions): Pool {
  let target: URL;
  try { target = new URL(options.connectionString); } catch { throw new PostgresAccessError("PG_CONFIG"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.username || !target.password || !target.port ||
    !target.hostname || target.pathname.length < 2 || target.search || target.hash ||
    (options.localTestWithoutTls && (!local || !/^\/dream_test_[a-z0-9_]+$/.test(target.pathname))) ||
    !Number.isInteger(options.max ?? 4) || (options.max ?? 4) < 1 || (options.max ?? 4) > 20) {
    throw new PostgresAccessError("PG_CONFIG");
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    application_name: "dream-backend",
    options: "-c search_path=pg_catalog",
    sslnegotiation: "postgres",
    client_encoding: "UTF8",
    ssl: options.localTestWithoutTls ? false : { rejectUnauthorized: true, ...(options.ca ? { ca: options.ca } : {}) },
  });
  // pg removes failed idle clients. Consume the event without disclosing driver
  // details or allowing an idle connection error to crash the process.
  pool.on("error", () => {});
  return pool;
}
