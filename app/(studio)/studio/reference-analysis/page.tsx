import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";
import { PROJECT_PREVIEW_SAMPLE } from "@/components/reference-analysis/project-preview-sample";
import { LocalUrlAnalysis } from "@/components/reference-analysis/local-url-analysis";
import { ReferenceAnalysisLab } from "@/components/reference-analysis/reference-analysis-lab";
import { authMode } from "@/lib/auth/config";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
import styles from "@/components/reference-analysis/reference-analysis-lab.module.css";

export const metadata: Metadata = { title: "레퍼런스 분석 · Dream AI Studio" };

export default async function ReferenceAnalysisPage() {
  const blocked=await legacyPageGate();if(blocked)return blocked;
  return <>
    <PageHeader title="레퍼런스 분석" description="자료에서 확인한 근거를 살피고, 다음 작업에 쓸 프롬프트를 다듬어요." actions={<Link className={styles.navLink} href="/studio">작업실로 돌아가기</Link>} />
    {authMode() === "off" && <LocalUrlAnalysis />}
    <ReferenceAnalysisLab projectPreview={PROJECT_PREVIEW_SAMPLE} />
  </>;
}
