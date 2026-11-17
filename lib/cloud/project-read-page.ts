import "server-only";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";
import { stageOrder, type Stage, type StageStatus } from "@/lib/domain/stages";
import { createProjectReadRequest } from "@/lib/services/postgres/project-read-request";

// 클라우드 읽기 전용 화면의 판정·표시값 변환(T-207, 명세 T-206).
// - owner는 서버가 확인한 계정 UUID뿐이다(adapter가 getRenderAuth 결과로 actor를 만든다).
// - adapter는 요청(화면 그리기)마다 새로 만들고, 인증은 React cache(getRenderAuth)를 레이아웃과 함께 쓴다.
// - legacy(SQLite·시작 점검·업무 파일) 서비스는 import하지 않는다.

export const STAGE_LABELS: Record<Stage, string> = {
  intake: "등록", brief: "요구 확인", plan: "기획", produce: "장면 제작", edit: "수정·조립", review: "검수", export: "내보내기",
};
export const STAGE_STATUS: Record<StageStatus, { label: string; pill: "locked" | "queued" | "running" | "approval" | "done" | "failed" }> = {
  locked: { label: "잠김", pill: "locked" }, todo: { label: "할 일", pill: "queued" }, in_progress: { label: "진행 중", pill: "running" },
  needs_approval: { label: "승인 대기", pill: "approval" }, approved: { label: "승인됨", pill: "done" }, failed: { label: "실패", pill: "failed" },
};

export type CloudProjectCard = Readonly<{ id: string; title: string; menuLabel: string; aspect: string; lengthSec: number; updatedAt: string; status: "warning" | "running" | "approval" | "done" | "queued"; nextStageLabel: string }>;
export type CloudProjectDetail = Readonly<{ id: string; title: string; menuLabel: string; aspect: string; lengthSec: number; updatedAt: string; stages: readonly Readonly<{ stage: Stage; label: string; status: StageStatus }>[] }>;
export type CloudRead<T> = { kind: "local" } | { kind: "unavailable" } | { kind: "notFound" } | { kind: "ok"; data: T };

type Reply = { status: number; body: unknown };
type ListRow = { id: string; title: string; menuLabel: string; aspect: string; lengthSec: number; updatedAt: string; status: CloudProjectCard["status"]; nextStage: Stage };
type DetailBody = { project: { id: string; title: string; aspect: string; lengthSec: number; updatedAt: string }; snapshot: { menu: { label: string }; stages?: { id: string; label: string }[] }; states: { stage: Stage; status: StageStatus }[] };

// 인증 판정. 거절은 proxy·T-200 gate와 같은 의미로 로그인 화면으로 보낸다.
async function access(nextPath: string): Promise<"local" | "verified"> {
  const auth = await getRenderAuth();
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: nextPath }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  return auth.kind === "local" ? "local" : "verified";
}
function failure<T>(reply: Reply, nextPath: string): CloudRead<T> {
  const code = (reply.body as { code?: unknown } | null)?.code;
  if (reply.status === 400 || reply.status === 404) return { kind: "notFound" };
  if (code === "AUTH_REQUIRED") redirect(loginPath({ next: nextPath }));
  if (code === "AUTH_FORBIDDEN") redirect(loginPath({ error: "forbidden" }));
  if (code === "AUTH_UNAVAILABLE") redirect(loginPath({ error: "unavailable" }));
  return { kind: "unavailable" };
}
const request = () => createProjectReadRequest({ resolveAuth: getRenderAuth });

export async function readCloudProjects(): Promise<CloudRead<CloudProjectCard[]>> {
  if (await access("/cloud/projects") === "local") return { kind: "local" };
  const reply = await request().list() as Reply;
  if (reply.status !== 200) return failure(reply, "/cloud/projects");
  // 표시할 값만 새 객체로 고른다(원본 행·owner·inputs는 화면으로 넘기지 않는다).
  return { kind: "ok", data: (reply.body as ListRow[]).map((row) => Object.freeze({
    id: row.id, title: row.title, menuLabel: row.menuLabel, aspect: row.aspect, lengthSec: row.lengthSec, updatedAt: row.updatedAt,
    status: row.status, nextStageLabel: STAGE_LABELS[row.nextStage] ?? row.nextStage,
  })) };
}

// id는 인증을 통과한 뒤에만 읽는다(lazy).
export async function readCloudProject(readId: () => Promise<string>): Promise<CloudRead<CloudProjectDetail>> {
  if (await access("/cloud/projects") === "local") return { kind: "local" };
  const reply = await request().get(readId) as Reply;
  if (reply.status !== 200) return failure(reply, "/cloud/projects");
  const { project, snapshot, states } = reply.body as DetailBody;
  const labels = new Map((snapshot.stages ?? []).map((stage) => [stage.id, stage.label]));
  return { kind: "ok", data: Object.freeze({
    id: project.id, title: project.title, menuLabel: snapshot.menu.label, aspect: project.aspect, lengthSec: project.lengthSec, updatedAt: project.updatedAt,
    stages: stageOrder.map((stage) => ({ stage, label: labels.get(stage) ?? STAGE_LABELS[stage], status: states.find((row) => row.stage === stage)!.status })),
  }) };
}
