import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectLocalEditingZip } from "@/components/cloud/project-local-editing-zip";
import { CloudReadUnavailable } from "@/components/cloud/project-list-readonly";
import { PageHeader } from "@/components/ui/primitives";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readCloudProject } from "@/lib/cloud/project-read-page";

export const metadata: Metadata = { title: "재편집 ZIP · Dream AI Studio" };

// 로컬 PG 쇼핑숏츠 프로젝트의 재편집 ZIP 만들기·목록·받기. 영상 만들기 페이지와 같은 인증·기능 조건을 쓴다.
export default async function LocalEditingZipPage({ params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) notFound();
  const result = await readCloudProject(async () => (await params).id);
  if (result.kind === "local" || result.kind === "notFound") notFound();
  if (result.kind !== "ok") return <CloudReadUnavailable title="재편집 ZIP" retryHref="/cloud/projects" back />;
  if (result.data.menuId !== "shopping-shorts") notFound();
  return <>
    <Link href={`/cloud/projects/${result.data.id}`}>프로젝트 상세로 돌아가기</Link>
    <PageHeader title="재편집 ZIP" />
    <ProjectLocalEditingZip key={result.data.id} projectId={result.data.id} />
  </>;
}
