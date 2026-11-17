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
  return <ProjectDetailReadonly project={result.data} />;
}
