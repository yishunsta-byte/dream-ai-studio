import { ProjectBrief } from "@/components/cloud/project-brief";
import Link from "next/link";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { PrivateWavPanel } from "@/components/cloud/private-wav-panel";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloudReadLocal, CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { ProjectDetailReadonly } from "@/components/cloud/project-detail-readonly";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export const metadata: Metadata = { title: "프로젝트 보기 · Dream AI Studio" };

export default async function CloudProjectPage({ params }: { params: Promise<{ id: string }> }) {
  // id는 인증을 통과한 뒤에만 읽는다.
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local") return <CloudReadLocal title="프로젝트 보기" />;
  // 형식 오류·없음·남의 것·보관을 같은 404로 보인다.
  if (result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable retryHref="/cloud/projects" title="프로젝트 보기" back />;
  const project = result.data;
  const produceOpen = project.stages.some(stage => stage.stage === "plan" && stage.status === "approved") &&
    project.stages.some(stage => stage.stage === "produce" && stage.status !== "locked");
  return <><ProjectDetailReadonly project={project} />
    {localProjectFormEnabled() && project.menuId === "shopping-shorts" && <>
      {produceOpen && <div><Link className="action-link" href={`/cloud/projects/${project.id}/produce`}>장면 제작으로 이동</Link></div>}
      <ProjectBrief key={project.id} projectId={project.id} />
      <PrivateWavPanel projectId={project.id} />
      <Link className="action-link" href={`/cloud/projects/${project.id}/editing-audio`}>편집 음원 선택</Link>
      <Link className="action-link" href={`/cloud/projects/${project.id}/subtitles`}>자막 편집</Link>
      <Link className="action-link" href={`/cloud/projects/${project.id}/render`}>영상 만들기</Link>
      <Link className="action-link" href={`/cloud/projects/${project.id}/editing-zip`}>재편집 ZIP</Link>
    </>}
  </>;
}
