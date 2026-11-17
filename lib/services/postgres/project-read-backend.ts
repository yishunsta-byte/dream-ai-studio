import "server-only";
import { projectReadError } from "./project-read-errors";

type Selection = Readonly<{ backend: "sqlite" }> | Readonly<{ backend: "postgres"; connectionString: string }>;
// Pure validation: no process.env default, import-time I/O, pool, Auth, SQLite,
// or connection attempts. The future adapter owns secret environment access.
export function selectProjectReadBackend(env: Readonly<Record<string, string | undefined>>, authMode: "off" | "supabase"): Selection {
  const selected = env.DREAM_PROJECT_READ_BACKEND;
  if (selected === undefined || selected === "sqlite") {
    if (env.VERCEL) throw projectReadError("PROJECT_READ_UNAVAILABLE");
    return Object.freeze({ backend: "sqlite" });
  }
  if (selected !== "postgres") throw projectReadError("PROJECT_READ_UNAVAILABLE");
  if (authMode !== "supabase") throw projectReadError("AUTH_UNAVAILABLE");
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ""); } catch { throw projectReadError("PROJECT_READ_UNAVAILABLE"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.port ||
    url.pathname.length < 2 || url.search || url.hash) throw projectReadError("PROJECT_READ_UNAVAILABLE");
  return Object.freeze({ backend: "postgres", connectionString: env.DATABASE_URL! });
}
