import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectLocalReview } from "@/components/cloud/project-local-review";
import { ProjectAudioPicker } from "@/components/cloud/project-audio-picker";
import { ProjectAudioTimelineSave } from "@/components/cloud/project-audio-timeline-save";
import { ProjectInitialTimelineSave } from "@/components/cloud/project-initial-timeline-save";
import { CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { PageHeader } from "@/components/ui/primitives";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export default async function EditingAudioPage({ params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) notFound();
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local" || result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable title="편집 음원 선택" retryHref="/cloud/projects" back />;
  if (result.data.menuId !== "shopping-shorts") notFound();
  return <>
    <Link href={`/cloud/projects/${result.data.id}`}>프로젝트 상세로 돌아가기</Link>
    <PageHeader title="편집 음원 선택" />
    <ProjectAudioPicker key={result.data.id} projectId={result.data.id} />
    <ProjectInitialTimelineSave key={`initial-${result.data.id}`} projectId={result.data.id} basis={result.data.editBasis}
      produceApproved={result.data.stages.some(stage => stage.stage === "produce" && stage.status === "approved")} />
    <ProjectAudioTimelineSave key={`timeline-${result.data.id}`} projectId={result.data.id} basis={result.data.editBasis}
      produceApproved={result.data.stages.some(stage => stage.stage === "produce" && stage.status === "approved")} />
    <ProjectLocalReview key={`review-${result.data.id}-${result.data.editBasis?.contentRevision}`} projectId={result.data.id} entry />
  </>;
}
