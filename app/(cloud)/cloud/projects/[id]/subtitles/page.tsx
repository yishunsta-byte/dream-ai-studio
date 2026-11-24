import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectLocalSubtitles } from "@/components/cloud/project-local-subtitles";
import { CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { PageHeader } from "@/components/ui/primitives";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export const metadata: Metadata = { title: "자막 편집 · Dream AI Studio" };

// 로컬 PG 쇼핑숏츠 프로젝트의 자막 편집(0dbc51d API)과 승인 자막 받기(808fc01). 편집 음원·영상 만들기 페이지와 같은 인증·기능 조건을 쓴다.
export default async function LocalSubtitlesPage({ params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) notFound();
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local" || result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable title="자막 편집" retryHref="/cloud/projects" back />;
  if (result.data.menuId !== "shopping-shorts") notFound();
  return <>
    <Link href={`/cloud/projects/${result.data.id}`}>프로젝트 상세로 돌아가기</Link>
    <PageHeader title="자막 편집" />
    <ProjectLocalSubtitles key={result.data.id} projectId={result.data.id}
      reviewApproved={result.data.stages.some(stage => stage.stage === "review" && stage.status === "approved")} />
  </>;
}
