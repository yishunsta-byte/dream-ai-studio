import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloudReadLocal, CloudReadUnavailable, cloudWorkspaceCapability } from "@/components/cloud/project-list-readonly";
import { ProjectDetailReadonly } from "@/components/cloud/project-detail-readonly";
import { readCloudProject } from "@/lib/cloud/project-read-page";
import { cloudBriefPath } from "@/components/cloud/managed-project-requests";
import { cloudPlanPath } from "@/components/cloud/managed-plan-requests";
import { cloudScenesPath } from "@/components/cloud/managed-scene-requests";

export const metadata: Metadata = { title: "프로젝트 보기 · Dream AI Studio" };

export default async function CloudProjectPage({ params }: { params: Promise<{ id: string }> }) {
  // id는 인증을 통과한 뒤에만 읽는다.
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local") return <CloudReadLocal title="프로젝트 보기" />;
  // 형식 오류·없음·남의 것·보관을 같은 404로 보인다.
  if (result.kind === "notFound") notFound();
  // P2: 안내 문구는 실제로 열리는 화면 조건(환경값·정적 메뉴 설정)만 따른다. DB·네트워크 요청을 더하지 않는다.
  const capability = cloudWorkspaceCapability();
  if (result.kind !== "ok") return <CloudReadUnavailable retryHref="/cloud/projects" title="프로젝트 보기" back capability={capability} />;
  // P1-02: 관리형 저장소(생성·브리프 경로가 같은 조건)에서 브리프가 확인 전이면 브리프 확인 링크를 준다.
  const briefOpen = process.env.DREAM_PROJECT_CORE_BACKEND !== undefined && result.data.stages.some(row => row.stage === "brief" && row.status === "todo");
  // P1-08: 관리형 기획(기획 API가 같은 조건)에서 브리프가 승인되고 기획 단계가 열려 있으면 기획 링크를 준다.
  const planOpen = process.env.DREAM_PROJECT_PLAN_BACKEND !== undefined && result.data.stages.some(row => row.stage === "brief" && row.status === "approved")
    && result.data.stages.some(row => row.stage === "plan" && row.status !== "locked");
  // P2-MANAGED-SOURCE-SCENE-PANEL: 관리형 장면 조회(같은 조건의 GET /scenes)가 열려 있고 장면 제작 단계가 열려 있으면 장면 링크를 준다.
  const scenesOpen = process.env.DREAM_SCENE_READ_BACKEND !== undefined && result.data.stages.some(row => row.stage === "produce" && row.status !== "locked");
  return <ProjectDetailReadonly project={result.data} briefHref={briefOpen ? cloudBriefPath(result.data.id) : undefined}
    planHref={planOpen ? cloudPlanPath(result.data.id) : undefined} scenesHref={scenesOpen ? cloudScenesPath(result.data.id) : undefined} capability={capability} />;
}
