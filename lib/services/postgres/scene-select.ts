import "server-only";
import type { Pool } from "pg";
import { v7 } from "uuid";
import { z } from "zod";
import { AUTH_MESSAGES } from "@/lib/auth/config";
import { resolveServerAuth, type ServerAuthResult } from "@/lib/auth/resolve";
import { openManagedSceneSelect } from "@/lib/cloud/managed-scene-select";
import { readLimitedText, rejectForeignWrite } from "@/lib/public-showcase/admin-publication-http";
import { withActorTransaction, type ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";

// P2 managed scene version selection (candidate). POST /api/projects/[id]/scene-selection. Order: Auth (no body or
// params read before it) -> same-origin JSON -> managed backend -> params -> bounded body -> one call of
// dream_scene_select.select_version() as the selection login. The function holds the whole contract (see its SQL);
// this layer only maps its outcome. Local SQLite is never opened here; without the managed backend the answer is 503.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sceneSelectMaxBytes = 2048;
export const sceneSelectBodySchema = z.strictObject({
  requestId: z.uuid(), revision: z.number().int().min(1).max(9007199254740990),
  sceneId: z.uuid(), versionId: z.uuid(), expectedVersionId: z.uuid().nullable(),
});
export type SceneSelectView = { projectId: string; sceneId: string; selectedVersionId: string; revision: number; outcome: "selected" | "unchanged" | "replayed" };
type Status = 200 | 400 | 401 | 403 | 404 | 409 | 413 | 415 | 503;
type Reply = Readonly<{ status: Status; body: SceneSelectView | Readonly<{ error: string; code: string }>; headers: Readonly<{ "cache-control": "no-store" }> }>;
const headers = Object.freeze({ "cache-control": "no-store" as const });
const failure = (status: Status, error: string, code: string): Reply => Object.freeze({ status, body: Object.freeze({ error, code }), headers });
const authUnavailable = () => failure(503, AUTH_MESSAGES.unavailable, "AUTH_UNAVAILABLE");
const unavailable = () => failure(503, "장면 결과를 지금 선택할 수 없어요. 잠시 뒤 다시 시도해 주세요.", "SCENE_SELECT_UNAVAILABLE");
const invalid = () => failure(400, "선택 요청 값을 확인해 주세요.", "INVALID_INPUT");
const OUTCOME: Record<string, Reply | "ok"> = {
  SELECTED: "ok", UNCHANGED: "ok", REPLAYED: "ok",
  INVALID_INPUT: invalid(),
  NOT_FOUND: failure(404, "장면을 찾을 수 없어요.", "NOT_FOUND"),
  STALE_REVISION: failure(409, "다른 변경이 먼저 저장됐어요. 새로고침한 뒤 다시 시도해 주세요.", "CONFLICT"),
  SELECTION_CHANGED: failure(409, "다른 선택이 먼저 저장됐어요. 새로고침해 주세요.", "CONFLICT"),
  REQUEST_REUSED: failure(409, "같은 요청 번호로 다른 선택을 저장할 수 없어요.", "REQUEST_REUSED"),
  PLAN_NOT_APPROVED: failure(409, "현재 기획을 승인해 주세요.", "PLAN_NOT_APPROVED"),
  STAGE_LOCKED: failure(409, "작업 단계 기록을 확인해 주세요.", "STAGE_LOCKED"),
  INVALID_VERSION: failure(409, "완료된 결과 파일을 확인한 뒤 선택해 주세요.", "INVALID_VERSION"),
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

type Dependencies = {
  resolveAuth: () => Promise<ServerAuthResult>;
  environment: () => Readonly<Record<string, string | undefined>>;
  openManaged: (env: Readonly<Record<string, string | undefined>>) => { pool: Pick<Pool, "connect">; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> } | null;
  logId: () => string;
};

export function createSceneSelectRequest(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = { resolveAuth: resolveServerAuth, environment: () => ({ ...process.env }), openManaged: openManagedSceneSelect, logId: v7, ...overrides };
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
        const managed = env.DREAM_SCENE_SELECT_BACKEND === undefined ? null : dependencies.openManaged(env);
        if (!managed) return unavailable();
        const target = await projectId();
        if (typeof target !== "string" || !uuid.test(target)) return invalid();
        const text = await readLimitedText(request, sceneSelectMaxBytes).catch(() => "invalid" as const);
        if (text === "too-large") return failure(413, "선택 요청이 너무 커요.", "PAYLOAD_TOO_LARGE");
        if (text === "invalid") return invalid();
        let parsed: z.infer<typeof sceneSelectBodySchema> | undefined;
        try { parsed = sceneSelectBodySchema.safeParse(JSON.parse(text)).data; } catch { parsed = undefined; }
        if (!parsed) return invalid();
        const body = parsed, project = target.toLowerCase(), logId = dependencies.logId();
        const row = await withActorTransaction(managed.pool, actor, async tx => {
          const { rows } = await tx.query<{ r_outcome: string; r_revision: string | number | null }>(
            "SELECT r_outcome, r_revision FROM dream_scene_select.select_version($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7::uuid)",
            [body.requestId, project, body.sceneId, body.versionId, body.expectedVersionId, body.revision, logId]);
          return rows.length === 1 ? rows[0] : null;
        }, { prepareSession: managed.prepareSession });
        const mapped = row ? OUTCOME[row.r_outcome] : undefined;
        if (!row || !mapped) return unavailable();
        if (mapped !== "ok") return mapped;
        const revision = Number(row.r_revision);
        if (!Number.isSafeInteger(revision) || revision < 1) return unavailable();
        return { status: 200, headers, body: { projectId: project, sceneId: body.sceneId.toLowerCase(), selectedVersionId: body.versionId.toLowerCase(),
          revision, outcome: row.r_outcome === "SELECTED" ? "selected" : row.r_outcome === "UNCHANGED" ? "unchanged" : "replayed" } };
      } catch { return unavailable(); }
    },
  });
}

export function sceneSelectHandler(make: () => ReturnType<typeof createSceneSelectRequest> = () => createSceneSelectRequest()) {
  return async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const reply = await make().post(request, async () => (await context.params).id);
    return Response.json(reply.body, { status: reply.status, headers: reply.headers });
  };
}
