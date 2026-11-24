import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { ProjectPlanDraft } from "@/components/cloud/project-plan-draft";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export default async function LocalPlanPage({ params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) notFound();
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local" || result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable retryHref="/cloud/projects" title="기획 단계" back />;
  const { id, title, menuId, stages } = result.data;
  if (menuId !== "shopping-shorts" || !stages.some(s => s.stage === "brief" && s.status === "approved") ||
      !stages.some(s => s.stage === "plan" && s.status !== "locked")) notFound();
  return <><Link href={`/cloud/projects/${id}`}>프로젝트 상세로 돌아가기</Link>
    <PageHeader title="기획 단계" description={title} />
    <ProjectPlanDraft key={id} projectId={id} />
  </>;
}
