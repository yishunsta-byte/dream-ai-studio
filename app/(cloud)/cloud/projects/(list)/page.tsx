import type { Metadata } from "next";
import { CloudReadLocal, CloudReadUnavailable, ProjectListReadonly } from "@/components/cloud/project-list-readonly";
import { readCloudProjects } from "@/lib/cloud/project-read-page";

export const metadata: Metadata = { title: "내 프로젝트 · Dream AI Studio" };

export default async function CloudProjectsPage() {
  const result = await readCloudProjects();
  if (result.kind === "local") return <CloudReadLocal title="내 프로젝트" />;
  if (result.kind !== "ok") return <CloudReadUnavailable retryHref="/cloud/projects" title="내 프로젝트" />;
  return <ProjectListReadonly projects={result.data} />;
}
