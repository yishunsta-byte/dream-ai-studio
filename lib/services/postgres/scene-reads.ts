import "server-only";
import type { Pool } from "pg";
import { AUTH_MESSAGES } from "@/lib/auth/config";
import { resolveServerAuth, type ServerAuthResult } from "@/lib/auth/resolve";
import { openManagedSceneRead } from "@/lib/cloud/managed-scene-read";
import { withActorTransaction, type ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, isVerifiedActor, PostgresAccessError, type ActorTransaction, type VerifiedActor } from "@/lib/db/postgres/types";
import { isProjectReadError, projectReadError, projectReadFailure } from "./project-read-errors";

// P2 managed scene read (candidate): scene ids, project revision and scene versions of one owner's open project.
// Same Auth decision, error codes and read-only repeatable-read transaction as the managed project read; a separate
// read-only login (managed-scene-read 0001). The DTO carries states and identifiers only: no titles or text, no asset
// paths/keys/hashes, no version input snapshots or request receipts. Local SQLite is never opened here.
//
// Bounded responses (read pagination candidate):
// - GET /api/projects/[id]/scenes: every open scene (at most `scenes`) with its selected version and its `recent` newest
//   versions (version number descending) and, when older versions exist, an `olderCursor`.
// - GET /api/projects/[id]/scenes?scene=<uuid>&cursor=<olderCursor>: the next `page` older versions of that scene,
//   version number descending, and the next cursor or null. Version numbers are unique per scene, so the order is fixed;
//   versions added after the first read have higher numbers and never shift an older page.
// - More open scenes than `scenes`: 422 SCENE_READ_LIMIT (not retryable). A database failure stays 503
//   PROJECT_READ_UNAVAILABLE (retryable). A cursor that is malformed or bound to another project or scene: 400 INVALID_CURSOR.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stageStatuses = new Set(["locked", "todo", "in_progress", "needs_approval", "approved", "failed"]);
const versionStatuses = new Set(["queued", "running", "succeeded", "failed", "canceled"]);
const kinds = new Set(["image", "video", "speech"]);
export const sceneReadLimits = Object.freeze({ scenes: 200, recent: 5, page: 50, cursorLength: 256 });

export type SceneVersionView = { id: string; version: number; kind: string; status: string; origin: "job" | "direct";
  planId: string; resultAssetId: string | null; createdAt: string };
export type SceneView = { id: string; position: number; selectedVersionId: string | null; selectedVersion: SceneVersionView | null;
  recentVersions: SceneVersionView[]; olderCursor: string | null };
export type ProjectScenesView = { projectId: string; revision: number; approvedPlanId: string | null; approvedPlanVersion: number | null;
  stages: { plan: string; produce: string }; scenes: SceneView[] };
export type OlderVersionsView = { projectId: string; sceneId: string; revision: number; versions: SceneVersionView[]; olderCursor: string | null };

// Scene-read-only domain errors (the shared project read codes stay unchanged).
const sceneDefinitions = {
  INVALID_CURSOR: { status: 400, error: "이전 결과 위치가 올바르지 않아요. 장면 목록을 다시 불러와 주세요." },
  SCENE_READ_LIMIT: { status: 422, error: "장면이 너무 많아 한 번에 불러올 수 없어요. 관리자에게 알려 주세요." },
} as const;
const issued = new WeakSet<object>();
class SceneReadError extends Error {
  readonly status: 400 | 422;
  constructor(readonly code: keyof typeof sceneDefinitions) {
    super(sceneDefinitions[code].error);
    this.name = "SceneReadError";
    this.status = sceneDefinitions[code].status;
    issued.add(this);
    Object.freeze(this);
  }
}
const isSceneReadError = (error: unknown): error is SceneReadError => typeof error === "object" && error !== null && issued.has(error);
const isDomainError = (error: unknown): error is Error => isProjectReadError(error) || isSceneReadError(error);

type Row = Record<string, unknown>;
const text = (value: unknown) => { if (typeof value !== "string") throw new PostgresAccessError("PG_DATA"); return value; };
const id = (value: unknown) => { const v = text(value); if (!uuid.test(v)) throw new PostgresAccessError("PG_DATA"); return v.toLowerCase(); };
const optionalId = (value: unknown) => value === null ? null : id(value);
function count(value: unknown, min: number) {
  if (!(typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))) throw new PostgresAccessError("PG_DATA");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min) throw new PostgresAccessError("PG_DATA");
  return result;
}
const instant = (value: unknown) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new PostgresAccessError("PG_DATA");
  return value.toISOString();
};
const member = (set: Set<string>, value: unknown) => { const v = text(value); if (!set.has(v)) throw new PostgresAccessError("PG_DATA"); return v; };
const versionView = (row: Row): SceneVersionView => ({ id: id(row.id), version: count(row.version, 1), kind: member(kinds, row.kind),
  status: member(versionStatuses, row.status), origin: row.from_job === true ? "job" : "direct", planId: id(row.plan_id),
  resultAssetId: optionalId(row.result_asset_id), createdAt: instant(row.created_at) });
const versionColumns = "v.id,v.scene_id,v.version,v.plan_id,v.kind,v.status,(v.job_id IS NOT NULL OR v.generation_id IS NOT NULL) AS from_job,v.result_asset_id,v.created_at";

// Cursor: base64url JSON {v:1, p:project, s:scene, b:version}; the next page holds versions numbered below b.
// It carries only identifiers the caller already received; ownership is decided again by the database on every read.
type Cursor = { projectId: string; sceneId: string; before: number };
const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify({ v: 1, p: cursor.projectId, s: cursor.sceneId, b: cursor.before }), "utf8").toString("base64url");
function decodeCursor(raw: string): Cursor {
  if (raw.length > sceneReadLimits.cursorLength || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new SceneReadError("INVALID_CURSOR");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch { throw new SceneReadError("INVALID_CURSOR"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SceneReadError("INVALID_CURSOR");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "b,p,s,v" || record.v !== 1 || typeof record.p !== "string" || !uuid.test(record.p)
    || typeof record.s !== "string" || !uuid.test(record.s) || typeof record.b !== "number" || !Number.isSafeInteger(record.b) || record.b < 2)
    throw new SceneReadError("INVALID_CURSOR");
  if (encodeCursor({ projectId: record.p.toLowerCase(), sceneId: record.s.toLowerCase(), before: record.b }) !== raw) throw new SceneReadError("INVALID_CURSOR");
  return { projectId: record.p.toLowerCase(), sceneId: record.s.toLowerCase(), before: record.b };
}

async function readProject(tx: ActorTransaction, projectId: string) {
  const { rows: [project] } = await tx.query(`SELECT id,content_revision,approved_plan_id FROM dream.projects
    WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL`, [tx.actorId, projectId]);
  return project as Row | undefined;
}

async function readScenes(tx: ActorTransaction, projectId: string): Promise<ProjectScenesView | null> {
  const keys = [tx.actorId, projectId];
  const project = await readProject(tx, projectId);
  if (!project) return null;
  const { rows: stageRows } = await tx.query("SELECT stage,status FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2 AND stage IN ('plan','produce')", keys);
  const plan = stageRows.filter(row => row.stage === "plan"), produce = stageRows.filter(row => row.stage === "produce");
  if (plan.length !== 1 || produce.length !== 1) throw new PostgresAccessError("PG_DATA");
  const approvedPlanId = optionalId(project.approved_plan_id);
  let approvedPlanVersion: number | null = null;
  if (approvedPlanId) {
    const { rows: [approved] } = await tx.query("SELECT version FROM dream.plans WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND status='approved'",
      [...keys, approvedPlanId]);
    if (!approved) throw new PostgresAccessError("PG_DATA");
    approvedPlanVersion = count(approved.version, 1);
  }
  const { rows: sceneRows } = await tx.query(`SELECT id,position,selected_version_id FROM dream.scenes
    WHERE owner_id=$1 AND project_id=$2 AND archived_at IS NULL ORDER BY position,id LIMIT ${sceneReadLimits.scenes + 1}`, keys);
  if (sceneRows.length > sceneReadLimits.scenes) throw new SceneReadError("SCENE_READ_LIMIT");
  // Newest `recent` + 1 versions per scene (the extra row only says that older versions exist), through the unique
  // (owner_id, scene_id, version) index: at most scenes × (recent + 1) rows whatever the history length.
  const { rows: recentRows } = await tx.query(`SELECT ${versionColumns}
    FROM dream.scenes s CROSS JOIN LATERAL (SELECT x.id,x.scene_id,x.version,x.plan_id,x.kind,x.status,x.job_id,x.generation_id,x.result_asset_id,x.created_at
      FROM dream.scene_versions x WHERE x.owner_id=s.owner_id AND x.scene_id=s.id
      ORDER BY x.version DESC LIMIT ${sceneReadLimits.recent + 1}) v
    WHERE s.owner_id=$1 AND s.project_id=$2 AND s.archived_at IS NULL ORDER BY v.scene_id,v.version DESC`, keys);
  const selectedIds = (sceneRows as Row[]).map(row => optionalId(row.selected_version_id)).filter((value): value is string => value !== null);
  const { rows: selectedRows } = selectedIds.length === 0 ? { rows: [] } : await tx.query(`SELECT ${versionColumns}
    FROM dream.scene_versions v WHERE v.owner_id=$1 AND v.id=ANY($2::uuid[])`, [tx.actorId, selectedIds]);
  const recentByScene = new Map<string, SceneVersionView[]>();
  for (const row of recentRows as Row[]) {
    const sceneId = id(row.scene_id), list = recentByScene.get(sceneId) ?? [];
    list.push(versionView(row));
    recentByScene.set(sceneId, list);
  }
  const selectedById = new Map((selectedRows as Row[]).map(row => [id(row.id), { sceneId: id(row.scene_id), view: versionView(row) }]));
  const scenes = (sceneRows as Row[]).map(row => {
    const sceneId = id(row.id), selectedVersionId = optionalId(row.selected_version_id);
    const newest = recentByScene.get(sceneId) ?? [];
    const selected = selectedVersionId ? selectedById.get(selectedVersionId) : undefined;
    if (selectedVersionId && selected?.sceneId !== sceneId) throw new PostgresAccessError("PG_DATA");
    const recentVersions = newest.slice(0, sceneReadLimits.recent);
    const olderCursor = newest.length > sceneReadLimits.recent
      ? encodeCursor({ projectId, sceneId, before: recentVersions[recentVersions.length - 1].version }) : null;
    return { id: sceneId, position: count(row.position, 0), selectedVersionId, selectedVersion: selected?.view ?? null, recentVersions, olderCursor };
  });
  return { projectId: id(project.id), revision: count(project.content_revision, 1), approvedPlanId, approvedPlanVersion,
    stages: { plan: member(stageStatuses, plan[0].status), produce: member(stageStatuses, produce[0].status) }, scenes };
}

async function readOlder(tx: ActorTransaction, projectId: string, cursor: Cursor): Promise<OlderVersionsView | null> {
  const project = await readProject(tx, projectId);
  if (!project) return null;
  const { rows: [scene] } = await tx.query("SELECT id FROM dream.scenes WHERE owner_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL",
    [tx.actorId, projectId, cursor.sceneId]);
  if (!scene) return null;
  const { rows } = await tx.query(`SELECT ${versionColumns} FROM dream.scene_versions v
    WHERE v.owner_id=$1 AND v.scene_id=$2 AND v.version<$3::bigint ORDER BY v.version DESC LIMIT ${sceneReadLimits.page + 1}`,
  [tx.actorId, cursor.sceneId, String(cursor.before)]);
  const views = (rows as Row[]).map(row => { if (id(row.scene_id) !== cursor.sceneId) throw new PostgresAccessError("PG_DATA"); return versionView(row); });
  const versions = views.slice(0, sceneReadLimits.page);
  if (versions.some((v, i) => v.version >= (i === 0 ? cursor.before : versions[i - 1].version))) throw new PostgresAccessError("PG_DATA");
  const olderCursor = views.length > sceneReadLimits.page
    ? encodeCursor({ projectId, sceneId: cursor.sceneId, before: versions[versions.length - 1].version }) : null;
  return { projectId: id(project.id), sceneId: cursor.sceneId, revision: count(project.content_revision, 1), versions, olderCursor };
}

type Query = { kind: "scenes" } | { kind: "older"; cursor: Cursor };
// Only ?scene=<uuid>&cursor=<cursor> (each once, both together) or no query at all; the cursor must name this project and scene.
function parseQuery(search: URLSearchParams, projectId: string): Query {
  const names = [...search.keys()];
  if (names.length === 0) return { kind: "scenes" };
  if (names.length !== 2 || names.sort().join(",") !== "cursor,scene") throw projectReadError("INVALID_INPUT");
  const scene = search.get("scene") ?? "";
  if (!uuid.test(scene)) throw projectReadError("INVALID_INPUT");
  const cursor = decodeCursor(search.get("cursor") ?? "");
  if (cursor.projectId !== projectId || cursor.sceneId !== scene.toLowerCase()) throw new SceneReadError("INVALID_CURSOR");
  return { kind: "older", cursor };
}

type Failure = Readonly<{ status: 400 | 401 | 403 | 404 | 422 | 503; body: Readonly<{ error: string; code: string }>; headers: Readonly<{ "cache-control": "no-store" }> }>;
type Reply = Readonly<{ status: 200; body: ProjectScenesView | OlderVersionsView; headers: Readonly<{ "cache-control": "no-store" }> }> | Failure;
type Dependencies = {
  resolveAuth: () => Promise<ServerAuthResult>;
  environment: () => Readonly<Record<string, string | undefined>>;
  openManaged: (env: Readonly<Record<string, string | undefined>>) => { pool: Pick<Pool, "connect">; prepareSession: NonNullable<ActorTransactionOptions["prepareSession"]> } | null;
};
const headers = Object.freeze({ "cache-control": "no-store" as const });
const failure = (status: Failure["status"], error: string, code: string): Failure => Object.freeze({ status, body: Object.freeze({ error, code }), headers });
const authUnavailable = () => failure(503, AUTH_MESSAGES.unavailable, "AUTH_UNAVAILABLE");
const safeFailure = (error: unknown): Failure => {
  if (isSceneReadError(error)) return failure(error.status, error.message, error.code);
  const safe = projectReadFailure(error);
  return failure(safe.status, safe.body.error, safe.body.code);
};
function denied(auth: Extract<ServerAuthResult, { kind: "denied" }>): Failure {
  if (auth.status === 401 && auth.code === "AUTH_REQUIRED") return failure(401, AUTH_MESSAGES.required, auth.code);
  if (auth.status === 403 && auth.code === "AUTH_FORBIDDEN") return failure(403, AUTH_MESSAGES.forbidden, auth.code);
  return authUnavailable();
}

// One object per request (same rule as createProjectReadRequest): Auth first, then the backend, then route params, then the query.
export function createSceneReadRequest(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = { resolveAuth: resolveServerAuth, environment: () => ({ ...process.env }), openManaged: openManagedSceneRead, ...overrides };
  return Object.freeze({
    async get(projectId: () => Promise<string>, search: () => URLSearchParams = () => new URLSearchParams()): Promise<Reply> {
      let auth: ServerAuthResult;
      try { auth = await dependencies.resolveAuth(); } catch { return authUnavailable(); }
      if (auth?.kind === "denied") return denied(auth);
      if (auth?.kind !== "verified" || typeof auth.email !== "string" || !auth.email) return authUnavailable();
      let actor: VerifiedActor;
      try { actor = actorFromVerifiedUserId(auth.userId); } catch { return authUnavailable(); }
      try {
        const env = dependencies.environment();
        const managed = env.DREAM_SCENE_READ_BACKEND === undefined ? null : dependencies.openManaged(env);
        if (!managed) throw projectReadError("PROJECT_READ_UNAVAILABLE");
        const target = await projectId();
        if (!uuid.test(target)) throw projectReadError("INVALID_INPUT");
        const project = target.toLowerCase();
        const query = parseQuery(search(), project);
        if (!isVerifiedActor(actor)) throw projectReadError("AUTH_REQUIRED");
        let view: ProjectScenesView | OlderVersionsView | null;
        try {
          view = await withActorTransaction<ProjectScenesView | OlderVersionsView | null>(managed.pool, actor,
            tx => query.kind === "scenes" ? readScenes(tx, project) : readOlder(tx, project, query.cursor), {
              mode: "read-only-repeatable-read", preserveDomainError: isDomainError, prepareSession: managed.prepareSession });
        } catch (error) {
          if (isDomainError(error)) throw error;
          throw projectReadError("PROJECT_READ_UNAVAILABLE");
        }
        if (!view) throw projectReadError("NOT_FOUND");
        return { status: 200, body: view, headers };
      } catch (error) { return safeFailure(error); }
    },
  });
}

export function sceneReadHandler(make: () => ReturnType<typeof createSceneReadRequest> = () => createSceneReadRequest()) {
  return async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const reply = await make().get(async () => (await context.params).id, () => new URL(request.url).searchParams);
    return Response.json(reply.body, { status: reply.status, headers: reply.headers });
  };
}
