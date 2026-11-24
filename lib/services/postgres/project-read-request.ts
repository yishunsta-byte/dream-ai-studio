import "server-only";
import type { Pool } from "pg";
import { AUTH_MESSAGES, authMode } from "@/lib/auth/config";
import { resolveServerAuth, type ServerAuthResult } from "@/lib/auth/resolve";
import { actorFromVerifiedUserId, type VerifiedActor } from "@/lib/db/postgres/types";
import { openManagedProjectCore } from "@/lib/cloud/managed-project-core";
import type { ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { selectProjectReadBackend } from "./project-read-backend";
import { projectReadError, projectReadFailure } from "./project-read-errors";
import { getProcessProjectReadPool } from "./project-read-pool";
import { postgresProjectReads } from "./project-reads";

type ErrorBody = { error: string; code: string };
type Failure = Readonly<{ status: 400 | 401 | 403 | 404 | 503; body: Readonly<ErrorBody>; headers: Readonly<{ "cache-control": "no-store" }> }>;
type Reply<T> = Readonly<{ status: 200; body: T; headers: Readonly<{ "cache-control": "no-store" }> }> | Failure;
type Dependencies = {
  resolveAuth: () => Promise<ServerAuthResult>;
  environment: () => Readonly<Record<string, string | undefined>>;
  getPool: (connectionString: string) => Pick<Pool, "connect">;
  openManaged: typeof openManagedProjectCore;
};
const headers = Object.freeze({ "cache-control": "no-store" as const });
function failure(status: Failure["status"], error: string, code: string): Failure {
  return Object.freeze({ status, body: Object.freeze({ error, code }), headers });
}
function authUnavailable(): Failure { return failure(503, AUTH_MESSAGES.unavailable, "AUTH_UNAVAILABLE"); }
function safeFailure(error: unknown): Failure {
  const safe = projectReadFailure(error);
  return failure(safe.status, safe.body.error, safe.body.code);
}
function denied(auth: Extract<ServerAuthResult, { kind: "denied" }>): Failure {
  if (auth.status === 401 && auth.code === "AUTH_REQUIRED") return failure(401, AUTH_MESSAGES.required, auth.code);
  if (auth.status === 403 && auth.code === "AUTH_FORBIDDEN") return failure(403, AUTH_MESSAGES.forbidden, auth.code);
  return authUnavailable();
}

// Allocate exactly once at each future request entry point; never put this object
// in a module/global cache or share it between requests. Only the Auth decision is
// memoized in this closure. Data queries/DTOs are not cached between calls.
export function createProjectReadRequest(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    resolveAuth: resolveServerAuth,
    environment: () => ({ ...process.env }),
    getPool: getProcessProjectReadPool,
    openManaged: openManagedProjectCore,
    ...overrides,
  };
  type Access = { ok: true; actor: VerifiedActor; pool: Pick<Pool, "connect">;
    prepareSession?: ActorTransactionOptions["prepareSession"] } | { ok: false; reply: Failure };
  let access: Promise<Access> | undefined;
  async function resolveAccess(): Promise<Access> {
    let auth: ServerAuthResult;
    try { auth = await dependencies.resolveAuth(); }
    catch { return { ok: false, reply: authUnavailable() }; }
    if (auth?.kind === "denied") return { ok: false, reply: denied(auth) };
    if (auth?.kind !== "verified" || typeof auth.email !== "string" || !auth.email) return { ok: false, reply: authUnavailable() };
    let actor: VerifiedActor;
    try { actor = actorFromVerifiedUserId(auth.userId); }
    catch { return { ok: false, reply: authUnavailable() }; }
    try {
      const env = dependencies.environment();
      if (env.DREAM_PROJECT_CORE_BACKEND !== undefined) {
        const managed = dependencies.openManaged(env);
        if (!managed) throw projectReadError("PROJECT_READ_UNAVAILABLE");
        return { ok: true, actor, ...managed };
      }
      const selection = selectProjectReadBackend(env, authMode(env));
      // This adapter is cloud-read-only. A local selection never calls SQLite.
      if (selection.backend !== "postgres") throw projectReadError("PROJECT_READ_UNAVAILABLE");
      return { ok: true, actor, pool: dependencies.getPool(selection.connectionString) };
    } catch (error) { return { ok: false, reply: safeFailure(error) }; }
  }
  async function execute<T>(read: (service: ReturnType<typeof postgresProjectReads>, actor: VerifiedActor) => Promise<T>): Promise<Reply<T>> {
    access ??= resolveAccess();
    const resolved = await access;
    if (!resolved.ok) return resolved.reply;
    try { return { status: 200, body: await read(postgresProjectReads(resolved.pool,resolved.prepareSession), resolved.actor), headers }; }
    catch (error) { return safeFailure(error); }
  }
  return Object.freeze({
    list: () => execute((service, actor) => service.list(actor)),
    // Future routes can pass a lazy params reader so denied requests never read
    // route params. No framework Request/context objects enter the service.
    get: (id: string | (() => Promise<string>)) => execute(async (service, actor) => service.get(actor, typeof id === "function" ? await id() : id)),
  });
}
