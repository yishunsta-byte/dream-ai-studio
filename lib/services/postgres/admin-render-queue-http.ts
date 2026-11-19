import "server-only";
import { authMode } from "@/lib/auth/config";
import { resolveServerAuth } from "@/lib/auth/resolve";
import { readAdminRenderQueue } from "./admin-render-queue";
import { selectProjectReadBackend } from "./project-read-backend";
import { getProcessProjectReadPool } from "./project-read-pool";
import { projectReadError } from "./project-read-errors";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function serveAdminRenderQueue(request: Request) {
  const result = await readAdminRenderQueue({
    resolveAuth: resolveServerAuth,
    getPool: () => {
      const env = process.env;
      if (env.VERCEL || env.NODE_ENV === "production" || !loopback.has(new URL(request.url).hostname)) {
        throw projectReadError("PROJECT_READ_UNAVAILABLE");
      }
      const backend = selectProjectReadBackend(env, authMode(env));
      if (backend.backend !== "postgres") throw projectReadError("PROJECT_READ_UNAVAILABLE");
      const target = new URL(backend.connectionString);
      if (!loopback.has(target.hostname) || !/^\/dream_test_[a-z0-9_]+$/.test(target.pathname)) {
        throw projectReadError("PROJECT_READ_UNAVAILABLE");
      }
      return getProcessProjectReadPool(backend.connectionString);
    },
  });
  const denied = "code" in result.body && result.body.code.startsWith("AUTH_");
  return Response.json(result.body, { status: result.status, headers: denied ? { "cache-control": "no-store" } : result.headers });
}
