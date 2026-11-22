import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, StatusPill } from "@/components/ui/primitives";
import { AdminApiIntegrations } from "./admin-analysis-tools";
import { AdminProjectsSection, type AdminProjects } from "./admin-projects";
import { AdminManual } from "./admin-manual";
import { AdminNavigation } from "./admin-navigation";
import { apiPlatformLabel, homeSectionId, imageShareSection, styleDnaPath } from "./admin-paths";
import { AdminPremierePrograms } from "./admin-premiere-programs";
import { AdminRenderQueue } from "./admin-render-queue";
import styles from "./admin.module.css";

const unavailable = [
  { title: "작업 대기열", detail: "운영 연결과 취소·재시도" },
  { title: "자료 관리", detail: "원본·렌더·ZIP의 사용량과 권리 기록" },
  { title: "백업·복원", detail: "최근 백업 결과와 복원 진행 상태" },
  { title: "운영 로그", detail: "오류·활동·요청 기록" },
  { title: "회원 관리", detail: "다른 회원의 계정과 권한 조회" },
  { title: "서비스 상태", detail: "작업 처리기 응답과 파일 저장소 점검" },
] as const;

/** home: 관리자 홈 2안(운영 현황) 내용. review처럼 페이지가 같은 인증 뒤 읽은 첫 목록으로 만들어 넘긴다. */
export function AdminHub({ email, projects, review, home }: { email: string; projects: AdminProjects; review: ReactNode; home: ReactNode }) {
  return <div className={styles.workspace}>
    <h1 className="sr-only">관리 화면</h1>
    <AdminNavigation />
    <div className={styles.sections}>
      {/* 관리자 홈 2안: /admin 기본 칸. 기존 분석 결과 공개 준비(#admin-analysis-results)와 다른 칸이다. */}
      <section id={homeSectionId} tabIndex={-1} aria-labelledby="admin-home-heading" className={`${styles.target} ${styles.section} ${styles.defaultPanel}`}>
        {home}
      </section>
      <div id="admin-project-list" role="group" aria-label="내 프로젝트" className={styles.target} tabIndex={-1}>
        <AdminProjectsSection state={projects} />
      </div>
      <AdminPremierePrograms />
      <div id="admin-review" role="group" aria-label="완성본 검수·게시" className={styles.target} tabIndex={-1}>
        {/* P1-06: 이미지 분석은 원본 전체 화면으로 옮겼고, 기존 이미지 분석 결과 공개 준비는 여기서 연다. */}
        <nav aria-label="이미지 분석 결과 공개" className={styles.reviewLinks}>
          <a className={styles.link} href={`#${imageShareSection}`}>이미지 분석 결과 공개 준비 <Icon name="arrow" /></a>
          <a className={styles.link} href={styleDnaPath}>이미지 스타일 분석기 열기 <Icon name="arrow" /></a>
        </nav>
        {review}
      </div>

      <section id="admin-render-queue" tabIndex={-1} aria-labelledby="admin-render-queue-heading" className={`${styles.target} ${styles.section}`}>
        <AdminRenderQueue />
      </section>

      <section id="admin-account" tabIndex={-1} aria-labelledby="admin-menu" className={`${styles.target} ${styles.section}`}>
        <h2 id="admin-menu" tabIndex={-1}>{apiPlatformLabel}</h2>
        <Card className={styles.accountCard}>
          <p className={styles.note}>로그인 계정 <strong>{email}</strong></p>
          <Link className={styles.link} href="/account/password">비밀번호 바꾸기 <Icon name="arrow" /></Link>
        </Card>
        <section id="admin-api-integrations" tabIndex={-1} aria-labelledby="admin-api-integrations-title" className={`${styles.section} ${styles.subsection}`}>
          <AdminApiIntegrations />
        </section>
      </section>

      <section id="admin-operations-availability" tabIndex={-1} aria-labelledby="admin-unlinked" className={`${styles.target} ${styles.section}`}>
        <h2 id="admin-unlinked" tabIndex={-1}>운영 연결 범위</h2>
        <p className={styles.note}>현재 이 화면에서 제공하지 않는 운영 기능이에요.</p>
        <details className={styles.unlinkedGroup}>
          <summary>
            <span className={styles.whenClosed}>미연결 기능 {unavailable.length}개 보기</span>
            <span className={styles.whenOpen}>미연결 기능 {unavailable.length}개 접기</span>
          </summary>
          <Card padding="none">
            <ul className={styles.unavailableList}>
              {unavailable.map(({ title, detail }) => <li key={title}>
                <h3>{title}</h3>
                <StatusPill status="locked">미연결</StatusPill>
                <p>{detail}</p>
              </li>)}
            </ul>
          </Card>
        </details>
      </section>
      <AdminManual />
    </div>
  </div>;
}
