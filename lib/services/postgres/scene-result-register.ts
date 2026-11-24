import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import { AUTH_MESSAGES } from "@/lib/auth/config";
import { resolveServerAuth, type ServerAuthResult } from "@/lib/auth/resolve";
import { openManagedProjectCore } from "@/lib/cloud/managed-project-core";
import { isSceneResultError, registerManagedSceneResult, type SceneResultCode } from "@/lib/cloud/managed-scene-result";
import { openManagedSceneResult } from "@/lib/cloud/managed-scene-result-connection";
import { readLimitedText, rejectForeignWrite } from "@/lib/public-showcase/admin-publication-http";
import { withActorTransaction, type ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";

// P2 managed scene result registration (HTTP candidate). POST /api/projects/[id]/scene-results.
// Order: Auth (no body or params read before it) -> same-origin JSON -> both managed backends -> params -> bounded body ->
// (1) the server-held identity of the caller's own asset: its stored sha256, read as the project-core login under the
// owner's RLS (a client never sends a hash, an owner or receipt data; strict body) -> (2) one call of
// dream_scene_result.register() as the registration login. The function answers a repeated request from its receipt first,
// then re-checks project, revision, approved plan, produce stage, scene and the asset's current receipt closure (the same
// T368 conditions as the project-core asset choices, expiry included) under lock, and writes all rows or none.
// Local SQLite is never opened here; without both managed backends the answer is 503.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sceneResultRegisterMaxBytes = 2048;
export const sceneResultRegisterBodySchema = z.strictObject({
  requestId: z.uuid(), revision: z.number().int().min(1).max(9007199254740990), sceneId: z.uuid(), assetId: z.uuid(),
});
export type SceneResultRegisterView = { projectId: string; sceneId: string; assetId: string; versionId: string; version: number;
  outcome: "created" | "replayed" };
type Status = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 415 | 503;
type Reply = Readonly<{ status: Status; body: SceneResultRegisterView | Readonly<{ error: string; code: string }>; headers: Readonly<{ "cache-control": "no-store" }> }>;
const headers = Object.freeze({ "cache-control": "no-store" as const });
const failure = (status: Status, error: string, code: string): Reply => Object.freeze({ status, body: Object.freeze({ error, code }), headers });
const authUnavailable = () => failure(503, AUTH_MESSAGES.unavailable, "AUTH_UNAVAILABLE");
const unavailable = () => failure(503, "장면 결과를 지금 등록할 수 없어요. 잠시 뒤 다시 시도해 주세요.", "SCENE_RESULT_UNAVAILABLE");
const invalid = () => failure(400, "등록 요청 값을 확인해 주세요.", "INVALID_INPUT");
const notFound = () => failure(404, "장면이나 결과 파일을 찾을 수 없어요.", "NOT_FOUND");
const REFUSAL: Record<SceneResultCode, Reply> = {
  INVALID_INPUT: invalid(),
  NOT_FOUND: notFound(),
  CONFLICT: failure(409, "다른 변경이 먼저 저장됐거나 같은 요청 번호로 다른 내용을 보냈어요. 새로고침한 뒤 다시 시도해 주세요.", "CONFLICT"),
  PLAN_NOT_APPROVED: failure(409, "현재 기획을 승인해 주세요.", "PLAN_NOT_APPROVED"),
  STAGE_LOCKED: failure(409, "장면 제작 단계가 닫혀 있어요.", "STAGE_LOCKED"),
  ASSET_NOT_READY: failure(409, "검증이 끝난 결과 파일만 등록할 수 있어요.", "ASSET_NOT_READY"),
};
function denied(auth: Extract<ServerAuthResult, { kind: "denied" }>): Reply {
  if (auth.status === 401 && auth.code === "AUTH_REQUIRED") return failure(401, AUTH_MESSAGES.required, auth.code);
  if (auth.status === 403 && auth.code === "AUTH_FORBIDDEN") return failure(403, AUTH_MESSAGES.forbidden, auth.code);
  return authUnavailable();
}
const fromResponse = async (response: Response): Promise<Reply> => {
  const body = await response.json() as { error: string; code: string };
  return failure(response.status as Status, body.error, body.code);
};

type Managed = { pool: Pick<Pool, "connect">; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> };
type Dependencies = {
  resolveAuth: () => Promise<ServerAuthResult>;
  environment: () => Readonly<Record<string, string | undefined>>;
  openCore: (env: Readonly<Record<string, string | undefined>>) => Managed | null;
  openResult: (env: Readonly<Record<string, string | undefined>>) => Managed | null;
};

export function createSceneResultRegisterRequest(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = { resolveAuth: resolveServerAuth, environment: () => ({ ...process.env }),
    openCore: openManagedProjectCore, openResult: openManagedSceneResult, ...overrides };
  return Object.freeze({
    async post(request: Request, projectId: () => Promise<string>): Promise<Reply> {
      let auth: ServerAuthResult;
      try { auth = await dependencies.resolveAuth(); } catch { return authUnavailable(); }
      if (auth?.kind === "denied") return denied(auth);
      if (auth?.kind !== "verified" || typeof auth.email !== "string" || !auth.email) return authUnavailable();
      let actor: VerifiedActor;
      try { actor = actorFromVerifiedUserId(auth.userId); } catch { return authUnavailable(); }
      if (!isVerifiedActor(actor)) return authUnavailable();
      try {
        const env = dependencies.environment();
        const foreign = rejectForeignWrite(request, env);
        if (foreign) return await fromResponse(foreign);
        const core = env.DREAM_PROJECT_CORE_BACKEND === undefined ? null : dependencies.openCore(env);
        const result = env.DREAM_SCENE_RESULT_BACKEND === undefined ? null : dependencies.openResult(env);
        if (!core || !result) return unavailable();
        const target = await projectId();
        if (typeof target !== "string" || !uuid.test(target)) return invalid();
        const text = await readLimitedText(request, sceneResultRegisterMaxBytes).catch(() => "invalid" as const);
        if (text === "too-large") return failure(413, "등록 요청이 너무 커요.", "PAYLOAD_TOO_LARGE");
        if (text === "invalid") return invalid();
        let parsed: z.infer<typeof sceneResultRegisterBodySchema> | undefined;
        try { parsed = sceneResultRegisterBodySchema.safeParse(JSON.parse(text)).data; } catch { parsed = undefined; }
        if (!parsed) return invalid();
        const body = parsed, project = target.toLowerCase(), sceneId = body.sceneId.toLowerCase(), assetId = body.assetId.toLowerCase();
        // (1) Server-held identity: the caller's own asset row only (RLS owner scope); another owner's asset is not visible.
        const stored = await withActorTransaction(core.pool, actor, async tx => {
          const { rows } = await tx.query<{ sha256: string }>(
            "SELECT a.sha256::text AS sha256 FROM dream.assets a WHERE a.owner_id=$1 AND a.id=$2", [tx.actorId, assetId]);
          return rows.length === 1 ? rows[0].sha256 : null;
        }, { mode: "read-only-repeatable-read", prepareSession: core.prepareSession });
        if (stored === null) return notFound();
        if (typeof stored !== "string" || !/^[0-9a-f]{64}$/.test(stored)) return unavailable();
        // (2) The registration function holds the whole contract (see managed-scene-result 0002).
        const saved = await withActorTransaction(result.pool, actor, tx => registerManagedSceneResult(tx,
          { requestId: body.requestId.toLowerCase(), projectId: project, sceneId, assetId, sha256: stored, revision: body.revision }),
        { prepareSession: result.prepareSession, preserveDomainError: isSceneResultError });
        if (!uuid.test(saved.versionId) || !Number.isSafeInteger(saved.version) || saved.version < 1) return unavailable();
        return { status: saved.duplicate ? 200 : 201, headers, body: { projectId: project, sceneId, assetId,
          versionId: saved.versionId.toLowerCase(), version: saved.version, outcome: saved.duplicate ? "replayed" : "created" } };
      } catch (error) {
        if (isSceneResultError(error) && Object.hasOwn(REFUSAL, error.code)) return REFUSAL[error.code];
        return unavailable();
      }
    },
  });
}

export function sceneResultRegisterHandler(make: () => ReturnType<typeof createSceneResultRegisterRequest> = () => createSceneResultRegisterRequest()) {
  return async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const reply = await make().post(request, async () => (await context.params).id);
    return Response.json(reply.body, { status: reply.status, headers: reply.headers });
  };
}
