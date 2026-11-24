import Link from "next/link";
import { notFound } from "next/navigation";
import { CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { ProjectProductionScenes } from "@/components/cloud/project-production-scenes";
import { PageHeader } from "@/components/ui/primitives";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export default async function LocalProductionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) notFound();
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local" || result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable retryHref="/cloud/projects" title="장면 제작" back />;
  const { id, title, menuId, stages } = result.data;
  if (menuId !== "shopping-shorts" || !stages.some(stage => stage.stage === "plan" && stage.status === "approved") ||
      !stages.some(stage => stage.stage === "produce" && stage.status !== "locked")) notFound();

  return <>
    <Link href={`/cloud/projects/${id}/plan`}>기획으로 돌아가기</Link>
    <PageHeader title="장면 제작" description={title} />
    <ProjectProductionScenes key={id} projectId={id} />
  </>;
}
