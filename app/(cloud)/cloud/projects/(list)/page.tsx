import type { Metadata } from "next";
import Link from "next/link";
import { CloudReadLocal, CloudReadUnavailable, ProjectListReadonly, cloudWorkspaceCapability } from "@/components/cloud/project-list-readonly";
import { readCloudProjects } from "@/lib/cloud/project-read-page";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "내 프로젝트 · Dream AI Studio" };

export default async function CloudProjectsPage() {
  const result = await readCloudProjects();
  if (result.kind === "local") return <CloudReadLocal title="내 프로젝트" />;
  // T-229: 개인 관리(읽기 전용)로 가는 링크. 목록 본문 다음에 둔다(제목 h1은 목록 컴포넌트의 하나뿐).
  const manage = <p><Link href="/cloud/manage" className={styles.manageLink}>개인 관리 보기 →</Link></p>;
  // P2: 안내·링크 문구는 실제로 열리는 화면 조건(환경값·정적 메뉴 설정)만 따른다. DB·네트워크 요청을 더하지 않는다.
  const capability = cloudWorkspaceCapability();
  if (result.kind !== "ok") return <><CloudReadUnavailable retryHref="/cloud/projects" title="내 프로젝트" capability={capability} />{manage}</>;
  return <><ProjectListReadonly projects={result.data} capability={capability} />{manage}</>;
}
