"use client";

import Link from "next/link";
import { useId } from "react";
import { StudioRegisteredAnalysis, type RegisteredAnalysisProvider } from "./studio-registered-analysis";
import styles from "./studio-registered-analysis-page.module.css";

/** 서버 목록 조회 결과 형식. lib 로더 계약용 타입이며, T317부터 페이지 props로는 쓰지 않는다. */
export type StudioRegisteredAnalysisPageProps =
  | { kind: "connected"; materials: RegisteredAnalysisProvider["materials"] }
  | { kind: "disconnected" | "unavailable" };

// 분석 종류와 등록 자료 예시 형식. 클라우드 연결 실측은 등록 PNG뿐이라 나머지는 목표 범위로만 적는다(운영 지원 단정 금지).
// 실제 자료명·결과·실행 버튼은 두지 않는 고정 안내다.
const kinds = [
  { name: "이미지", example: "예: PNG", scope: "클라우드 연결 시험에서 확인" },
  { name: "음악", example: "예: M4A", scope: "목표 범위" },
  { name: "영상·쇼츠", example: "예: MP4", scope: "목표 범위" },
] as const;

/**
 * T317 · T316 단계 1: 클라우드 분석 페이지 셸.
 * 서버 렌더(HTML·인라인 RSC·Flight·프리페치)에는 자료 ID·라벨·선택·결과가 실리지 않도록 props를 받지 않는다.
 * 목록을 따로 요청하는 클라이언트 경로는 아직 승인되지 않았으므로 여기서는 요청을 만들지 않고
 * 미연결 안내와 "연결되지 않음" 빈 화면(분석 실행 비활성)만 그린다.
 */
export function StudioRegisteredAnalysisPage() {
  const id = useId();
  return <div className={styles.page}>
    <p>프로젝트에 등록한 자료에서 관찰 근거를 확인하고 초안을 다듬어요.</p>
    <section className={styles.guide} aria-labelledby={`${id}-guide`}>
      <h2 id={`${id}-guide`}>분석 준비 상태</h2>
      <p className={styles.state}><strong>등록 자료 분석을 준비 중이에요.</strong> 아직 분석을 실행할 수 없고, 지금은 자료를 보내거나 결과를 만들지 않아요.</p>
      <h3 id={`${id}-kinds`}>분석 종류와 등록 자료 예시 형식</h3>
      <ul className={styles.kinds} aria-labelledby={`${id}-kinds`}>
        {kinds.map(kind => <li key={kind.name}><strong>{kind.name}</strong> · {kind.example} · {kind.scope}</li>)}
      </ul>
      <p>연결되면 내 프로젝트에 등록하고 사용 권한을 확인한 자료 한 개를 골라 분석해요.</p>
      <h3>게시물 주소는 지원하지 않아요</h3>
      <p>YouTube·Instagram·TikTok 같은 게시물 주소로는 분석하지 않아요. 사용 권한이 있는 파일을 프로젝트에 등록해 두면 연결 뒤 바로 고를 수 있어요.</p>
      <p><Link href="/cloud/projects">내 프로젝트로 이동</Link></p>
    </section>
    <StudioRegisteredAnalysis />
  </div>;
}
