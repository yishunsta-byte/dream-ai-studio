import "server-only";
import { Pool } from "pg";
import { authMode, supabasePublicConfig } from "@/lib/auth/config";
import type { ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { sceneResultRole, sceneResultSession } from "@/lib/cloud/managed-scene-result";

// P2 managed scene result registration (HTTP candidate). The dedicated LOGIN dream_scene_result_app
// (managed-scene-result 0001-0002, EXECUTE on dream_scene_result.register() only), selected only by
// DREAM_SCENE_RESULT_BACKEND; the same Supabase project and host rules as the managed scene selection. Every transaction
// re-checks the installation and the login's scope (sceneResultSession) before the function runs.
type Env = Readonly<Record<string, string | undefined>>;
const backend = "supabase-postgres";

function boundPublicKey(key: string, ref: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) return true;
  if (key.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const value = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return value?.role === "anon" && value.ref === ref;
  } catch { return false; }
}

export function managedSceneResultConfig(env: Env) {
  if (env.DREAM_SCENE_RESULT_BACKEND !== backend || authMode(env) !== "supabase") return null;
  const auth = supabasePublicConfig(env);
  const ref = auth?.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  const raw = env.DREAM_SCENE_RESULT_DB_URL;
  if (!auth || !ref || !raw || !boundPublicKey(auth.anonKey, ref)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname, user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const direct = host === "db." + ref + ".supabase.co" && user === sceneResultRole;
    const session = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === sceneResultRole + "." + ref;
    if ((!direct && !session) || !["postgresql:", "postgres:"].includes(url.protocol) || url.port !== "5432" ||
      url.pathname !== "/postgres" || !password || url.search || url.hash) return null;
    const ca = env.DREAM_SCENE_RESULT_DB_CA?.trim();
    return { ref, host, port: 5432, user, password, database: "postgres",
      ssl: { rejectUnauthorized: true, servername: host, ...(ca && { ca }) } };
  } catch { return null; }
}

export type ManagedSceneResultConnection = { pool: Pick<Pool, "connect">; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> };
let runtime: { signature: string; connection: ManagedSceneResultConnection } | undefined;

export function openManagedSceneResult(env: Env = process.env): ManagedSceneResultConnection | null {
  const config = managedSceneResultConfig(env);
  if (!config) return null;
  const signature = JSON.stringify(config);
  if (runtime) return runtime.signature === signature ? runtime.connection : null;
  const { ref, ...credentials } = config;
  const pool = new Pool({ ...credentials, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 4000, allowExitOnIdle: true });
  pool.on("error", () => { /* Idle connection failures are private. */ });
  runtime = { signature, connection: { pool, prepareSession: sceneResultSession(ref) } };
  return runtime.connection;
}
