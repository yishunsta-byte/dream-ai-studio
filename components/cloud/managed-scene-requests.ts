import { z } from "zod";
import type { Status } from "@/lib/ui/status";

// P2-MANAGED-SOURCE-SCENE-PANEL: 관리형 장면 화면의 같은 출처 요청·응답 판정(순수 함수, 화면·시험이 같이 쓴다).
// - GET  /api/projects/:id/scenes                       → 장면 목록·선택·최근 결과(scene-reads 후보 계약)
// - GET  /api/projects/:id/scenes?scene=&cursor=        → 그 장면의 이전 결과 한 쪽
// - POST /api/projects/:id/scene-results  {requestId, revision, sceneId, assetId}            → 확인된 자료를 결과 버전으로 등록
// - POST /api/projects/:id/scene-selection {requestId, revision, sceneId, versionId, expectedVersionId} → 결과 버전 선택
// 요청 번호는 본문 requestId(UUID)다.
// RETRY(독립 검수 5df82e92 5절 1·2): 결과를 모르는 쓰기는 '작업'(종류+장면)별로 처음 보낸 요청 번호와 내용(개정 포함)을 그대로 보존한다.
// 다른 장면 조작·개정 갱신 뒤에도 그 작업을 다시 확인하면 원래 번호·내용으로 보낸다 → 서버가 처리했으면 replayed, 처리 안 했으면 409(옛 개정)로 끝난다.
// 자동 재전송은 없다(사용자가 '같은 요청으로 다시 확인'을 누를 때만).

export const cloudScenesPath = (id: string) => `/cloud/projects/${id}/scenes`;
export const scenesApiPath = (id: string) => `/api/projects/${id}/scenes`;
export const olderVersionsApiPath = (id: string, sceneId: string, cursor: string) =>
  `/api/projects/${id}/scenes?scene=${encodeURIComponent(sceneId)}&cursor=${encodeURIComponent(cursor)}`;
export const sceneResultsApiPath = (id: string) => `/api/projects/${id}/scene-results`;
export const sceneSelectionApiPath = (id: string) => `/api/projects/${id}/scene-selection`;

const stage = z.enum(["locked", "todo", "in_progress", "needs_approval", "approved", "failed"]);
const version = z.object({
  id: z.uuid(), version: z.number().int().positive(), kind: z.enum(["image", "video", "speech"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]), origin: z.enum(["job", "direct"]),
  planId: z.uuid(), resultAssetId: z.uuid().nullable(), createdAt: z.string(),
});
const scene = z.object({
  id: z.uuid(), position: z.number().int().nonnegative(), selectedVersionId: z.uuid().nullable(), selectedVersion: version.nullable(),
  recentVersions: z.array(version).max(5), olderCursor: z.string().max(256).nullable(),
});
const scenesSchema = z.object({
  projectId: z.uuid(), revision: z.number().int().positive(), approvedPlanId: z.uuid().nullable(), approvedPlanVersion: z.number().int().positive().nullable(),
  stages: z.object({ plan: stage, produce: stage }), scenes: z.array(scene).max(200),
});
const olderSchema = z.object({ projectId: z.uuid(), sceneId: z.uuid(), revision: z.number().int().positive(), versions: z.array(version).max(50), olderCursor: z.string().max(256).nullable() });
export type SceneVersion = z.infer<typeof version>;
export type SceneRow = z.infer<typeof scene>;
export type ProjectScenes = z.infer<typeof scenesSchema>;

const codeOf = (body: unknown) => body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";

export type ScenesRead = { kind: "ok"; view: ProjectScenes } | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "unlinked" } | { kind: "limit" } | { kind: "failed" };
/** 503은 '연결 전·잠시 장애'(다시 시도 가능), 422는 장면 수 한도(다시 시도해도 같음). */
export function classifyScenes(status: number, body: unknown): ScenesRead {
  if (status === 200) { const parsed = scenesSchema.safeParse(body); return parsed.success ? { kind: "ok", view: parsed.data } : { kind: "failed" }; }
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 503) return { kind: "unlinked" };
  if (status === 422) return { kind: "limit" };
  return { kind: "failed" };
}

export type OlderRead = { kind: "ok"; versions: SceneVersion[]; olderCursor: string | null; revision: number } | { kind: "reload" } | { kind: "login" } | { kind: "failed" };
/** 400 INVALID_CURSOR·404는 목록이 바뀐 것이라 전체를 다시 읽게 한다. */
export function classifyOlder(status: number, body: unknown, sceneId: string): OlderRead {
  if (status === 200) {
    const parsed = olderSchema.safeParse(body);
    return parsed.success && parsed.data.sceneId === sceneId.toLowerCase()
      ? { kind: "ok", versions: parsed.data.versions, olderCursor: parsed.data.olderCursor, revision: parsed.data.revision } : { kind: "failed" };
  }
  if (status === 400 || status === 404) return { kind: "reload" };
  if (status === 401 || status === 403) return { kind: "login" };
  return { kind: "failed" };
}

/** 같은 ID는 한 번만, 버전 번호 내림차순(최근 → 이전). */
export function mergeVersions(current: readonly SceneVersion[], next: readonly SceneVersion[]): SceneVersion[] {
  const byId = new Map<string, SceneVersion>();
  for (const item of [...current, ...next]) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.version - a.version);
}

export type WriteOutcome =
  | { kind: "done"; replayed: boolean }
  | { kind: "conflict"; code: string; message: string }   // 409: 최신 상태를 다시 읽고 다시 확인
  | { kind: "reused" }                                    // 409 REQUEST_REUSED: 새 번호로 다시
  | { kind: "missing" } | { kind: "login" } | { kind: "forbidden" }
  | { kind: "invalid"; message: string }
  | { kind: "unknown" };                                  // 연결 끊김·503: 결과 모름, 같은 번호로 다시 보낼 수 있음

const conflictText: Record<string, string> = {
  CONFLICT: "다른 변경이 먼저 저장됐어요. 최신 상태를 다시 불러왔으니 확인한 뒤 다시 시도해 주세요.",
  PLAN_NOT_APPROVED: "기획이 승인된 상태가 아니에요. 기획 화면에서 상태를 확인해 주세요.",
  STAGE_LOCKED: "장면 제작 단계가 열려 있지 않아요. 프로젝트 보기에서 단계 상태를 확인해 주세요.",
  ASSET_NOT_READY: "이 자료는 지금 쓸 수 없어요(확인 만료·보관·미확인). 자료를 다시 확인한 뒤 골라 주세요.",
  INVALID_VERSION: "완료된 결과만 선택할 수 있어요. 최신 상태를 다시 불러왔어요.",
};

function classifyWrite(status: number, body: unknown, ok: (body: unknown) => { replayed: boolean } | null): WriteOutcome {
  if (status === 200 || status === 201) { const done = ok(body); return done ? { kind: "done", ...done } : { kind: "unknown" }; }
  const code = codeOf(body);
  if (status === 409 && code === "REQUEST_REUSED") return { kind: "reused" };
  if (status === 409) return { kind: "conflict", code, message: conflictText[code] ?? conflictText.CONFLICT };
  if (status === 404) return { kind: "missing" };
  if (status === 401) return { kind: "login" };
  if (status === 403) return code === "AUTH_FORBIDDEN" ? { kind: "forbidden" } : { kind: "invalid", message: "같은 화면에서 다시 시도해 주세요." };
  if (status === 400 || status === 413 || status === 415) return { kind: "invalid", message: "요청 값을 확인해 주세요. 화면을 새로고침한 뒤 다시 시도해 주세요." };
  return { kind: "unknown" };
}

const registered = z.object({ sceneId: z.uuid(), versionId: z.uuid(), version: z.number().int().positive(), outcome: z.enum(["created", "replayed"]) });
/** 등록: 201 created · 200 replayed만 완료, 같은 장면이어야 한다. */
export function classifyRegister(status: number, body: unknown, sceneId: string): WriteOutcome {
  return classifyWrite(status, body, value => {
    const parsed = registered.safeParse(value);
    return parsed.success && parsed.data.sceneId === sceneId.toLowerCase() && (status === 201) === (parsed.data.outcome === "created")
      ? { replayed: parsed.data.outcome === "replayed" } : null;
  });
}

const selected = z.object({ sceneId: z.uuid(), selectedVersionId: z.uuid(), revision: z.number().int().positive(), outcome: z.enum(["selected", "unchanged", "replayed"]) });
/** 선택: 200이고 고른 버전이 선택된 것으로 돌아올 때만 완료. */
export function classifySelect(status: number, body: unknown, sceneId: string, versionId: string): WriteOutcome {
  return classifyWrite(status === 201 ? 0 : status, body, value => {
    const parsed = selected.safeParse(value);
    return parsed.success && parsed.data.sceneId === sceneId.toLowerCase() && parsed.data.selectedVersionId === versionId.toLowerCase()
      ? { replayed: parsed.data.outcome === "replayed" } : null;
  });
}

/** 쓰기 내용(요청 번호 제외). 결과 모름 작업에는 이 문자열을 처음 보낸 그대로 보존한다. */
export const registerContent = (revision: number, sceneId: string, assetId: string) => JSON.stringify({ revision, sceneId, assetId });
export const selectContent = (revision: number, sceneId: string, versionId: string, expectedVersionId: string | null) =>
  JSON.stringify({ revision, sceneId, versionId, expectedVersionId });
/** 보낼 본문: 내용 + 요청 번호. */
export const withRequestId = (requestId: string, content: string) => JSON.stringify({ requestId, ...JSON.parse(content) as object });

export const kindLabel: Record<SceneVersion["kind"], string> = { image: "이미지", video: "영상", speech: "음성" };
export const versionStatusLabel: Record<SceneVersion["status"], string> = { queued: "대기", running: "만드는 중", succeeded: "완료", failed: "실패", canceled: "취소됨" };
export const versionPill: Record<SceneVersion["status"], Status> = {
  queued: "queued", running: "running", succeeded: "done", failed: "failed", canceled: "canceled",
};

/** 장면 제작 단계 표시 이름. */
export const stageLabel: Record<ProjectScenes["stages"]["produce"], string> = {
  locked: "잠김", todo: "시작 전", in_progress: "진행 중", needs_approval: "승인 대기", approved: "승인됨(닫힘)", failed: "실패",
};

/**
 * 이 화면의 쓰기(결과 등록·선택)를 보일지. 기획이 승인됐고 장면 제작 단계가 '시작 전·진행 중'일 때만.
 * - 등록 함수는 이 두 상태만 받는다(그 밖은 409 STAGE_LOCKED).
 * - 선택 함수는 단계를 따로 막지 않지만 선택하면 장면 제작을 '진행 중'으로 되돌리고 뒤 단계 승인을 지운다. 닫힌 단계에서 그 일을 이 화면이 하지 않도록 같이 가린다.
 */
export function writeGate(view: Pick<ProjectScenes, "approvedPlanId" | "stages">): boolean {
  return view.approvedPlanId !== null && view.stages.plan === "approved" && (view.stages.produce === "todo" || view.stages.produce === "in_progress");
}

export type WriteKind = "register" | "select";
/** 결과를 모르는 쓰기 하나. 처음 보낸 요청 번호와 내용을 바꾸지 않고 보존한다. */
export type PendingWrite = Readonly<{ kind: WriteKind; sceneId: string; requestId: string; content: string; target: string; label: string }>;
export type PendingWrites = Readonly<Record<string, PendingWrite>>;
export const pendingKey = (kind: WriteKind, sceneId: string) => `${kind}:${sceneId.toLowerCase()}`;
const sceneResultsPath = sceneResultsApiPath, sceneSelectionPath = sceneSelectionApiPath;

export type WriteRequest = Readonly<{ kind: WriteKind; sceneId: string; content: string; target: string; label: string }>;
/** held: 결과를 확정하지 못해 기록을 그대로 둠(결과 모름, 401·403 인증·권한 거절). */
export type WriteRun = Readonly<{ outcome: WriteOutcome; pendings: PendingWrites; sent: PendingWrite; retried: boolean; held: boolean }>;
type Fetcher = (input: string, init: RequestInit) => Promise<Pick<Response, "status" | "json">>;

/**
 * 쓰기 한 번. 같은 작업에 결과 모름 기록이 있으면 새 내용을 무시하고 그 기록(원래 번호·내용)을 다시 보낸다.
 * 보내기 전 기록을 남기고(응답 전 상태), 결과가 정해지면(완료·409·404·400류) 지운다. 결과 모름이면 그대로 둔다.
 * RECOVERY-AUTH: 401(로그인 끝남)·403(계정 거절·출처 거절)은 서버가 처리 전에 막은 것이라 처음 요청의 결과를 알려 주지 않는다.
 * 그래서 기록을 그대로 두고, 다시 로그인한 같은 계정·프로젝트(같은 보관 범위)에서 사용자가 원래 번호로 다시 확인하게 한다.
 * target: 등록은 assetId, 선택은 versionId(응답 확인용).
 */
export async function runWrite(projectId: string, pendings: PendingWrites, request: WriteRequest, fetcher: Fetcher, newId: () => string,
  persist?: (pendings: PendingWrites) => void): Promise<WriteRun> {
  const key = pendingKey(request.kind, request.sceneId);
  const existing = pendings[key];
  const sent: PendingWrite = existing ?? { kind: request.kind, sceneId: request.sceneId.toLowerCase(), requestId: newId(), content: request.content, target: request.target, label: request.label };
  const before: PendingWrites = { ...pendings, [key]: sent };
  persist?.(before); // RECOVERY: 보내기 전에 보관해 응답 전에 새로고침해도 같은 번호가 남는다.
  let outcome: WriteOutcome;
  let status = 0;
  try {
    const response = await fetcher(sent.kind === "register" ? sceneResultsPath(projectId) : sceneSelectionPath(projectId), {
      method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: withRequestId(sent.requestId, sent.content) });
    status = response.status;
    const body = await response.json().catch(() => null);
    outcome = sent.kind === "register" ? classifyRegister(response.status, body, sent.sceneId) : classifySelect(response.status, body, sent.sceneId, sent.target);
  } catch { outcome = { kind: "unknown" }; }
  if (outcome.kind === "unknown" || status === 401 || status === 403) return { outcome, pendings: before, sent, retried: !!existing, held: true };
  const after = { ...before };
  delete after[key];
  return { outcome, pendings: after, sent, retried: !!existing, held: false };
}
