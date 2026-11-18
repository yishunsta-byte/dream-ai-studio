// T-266 레퍼런스 분석 합성 체험(Studio 보호 경로). 실제 전송·분석·저장 없음.
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { ReferenceAnalysisLab } from "@/components/reference-analysis/reference-analysis-lab";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
import styles from "@/components/reference-analysis/reference-analysis-lab.module.css";

export const metadata: Metadata = { title: "레퍼런스 분석 · 합성 체험" };

export default async function ReferenceAnalysisPage() {
  const blocked=await legacyPageGate();if(blocked)return blocked;
  return <>
    <PageHeader title="레퍼런스 분석" description="자료에서 확인한 근거를 살피고, 다음 작업에 쓸 프롬프트를 다듬어요." chips={<Badge variant="dashed">합성 체험</Badge>} actions={<Link className={styles.navLink} href="/studio">작업실로 돌아가기</Link>} />
    <ReferenceAnalysisLab />
  </>;
}
