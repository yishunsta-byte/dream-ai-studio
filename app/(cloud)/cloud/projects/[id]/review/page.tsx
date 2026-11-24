import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectLocalReview } from "@/components/cloud/project-local-review";
import { CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { PageHeader } from "@/components/ui/primitives";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export default async function LocalReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) notFound();
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local" || result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable title="편집 검수" retryHref="/cloud/projects" back />;
  const { id, title, menuId } = result.data;
  if (menuId !== "shopping-shorts") notFound();
  return <>
    <Link href={`/cloud/projects/${id}/editing-audio`}>편집으로 돌아가기</Link>
    <PageHeader title="편집 검수" description={title} />
    <ProjectLocalReview key={id} projectId={id} />
  </>;
}
