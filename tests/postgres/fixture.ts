import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createPostgresPool } from "@/lib/db/postgres/connection";

export const A = "00000000-0000-4000-8000-000000000001";
export const B = "00000000-0000-4000-8000-000000000002";
export const PA = "00000000-0000-4000-8000-000000000010";
export const PB = "00000000-0000-4000-8000-000000000020";
export const raw = ' { "synthetic": true } ';

// Refuse arbitrary/default environment targets. An operator must provision a new
// local test cluster and an empty dream_test_* database before invoking this.
export async function syntheticPostgresFixture() {
  const input = process.env.DREAM_PG_TEST_ADMIN_URL;
  let target: URL;
  try { target = new URL(input ?? ""); } catch { throw new Error("Explicit synthetic Postgres test DSN required"); }
  if (target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" ||
    !/^\/dream_test_[a-z0-9_]+$/.test(target.pathname) || target.username !== "dream_test_admin" ||
    !target.port || target.search || target.hash) throw new Error("Refusing non-synthetic Postgres target");
  const admin = createPostgresPool({ connectionString: target.toString(), localTestWithoutTls: true, max: 2 });
  let pool: Pool | undefined;
  try {
    const existing = await admin.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('dream','auth') UNION ALL SELECT 1 FROM pg_tables WHERE schemaname='public'");
    if (existing.rowCount !== 0) throw new Error("Test database must be empty; no existing schema may be overwritten");
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
    await admin.query("INSERT INTO auth.users VALUES ($1),($2)", [A, B]);
    for (const filename of ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql"]) {
      await admin.query(await readFile(new URL(`../../lib/db/postgres/${filename}`, import.meta.url), "utf8"));
    }
    await admin.query("CREATE ROLE dream_test_api_login LOGIN PASSWORD 'b3-synthetic-api-only' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT dream_api TO dream_test_api_login");
    const apiTarget = new URL(target);
    apiTarget.username = "dream_test_api_login";
    apiTarget.password = "b3-synthetic-api-only";
    pool = createPostgresPool({ connectionString: apiTarget.toString(), localTestWithoutTls: true, max: 2 });
    const one = createPostgresPool({ connectionString: apiTarget.toString(), localTestWithoutTls: true, max: 1 });
    return { admin, pool, one, async close() { await Promise.all([pool!.end(), one.end(), admin.end()]); } };
  } catch {
    await Promise.all([admin.end(), ...(pool ? [pool.end()] : [])]);
    throw new Error("Synthetic Postgres fixture setup failed; inspect only the owned local cluster log");
  }
}
