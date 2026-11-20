import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, StatusPill } from "@/components/ui/primitives";
import { AdminAnalysisGuide, AdminApiIntegrations } from "./admin-analysis-tools";
import { AdminProjectsSection, type AdminProjects } from "./admin-projects";
import { AdminNavigation } from "./admin-navigation";
import { AdminReferenceAnalysis } from "./admin-reference-analysis";
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

export function AdminHub({ email, projects, review }: { email: string; projects: AdminProjects; review: ReactNode }) {
  return <div className={styles.workspace}>
    <AdminNavigation />
    <h1 className={styles.consoleTitle}>관리 화면</h1>
    <div className={styles.sections}>
      <section id="admin-overview" tabIndex={-1} aria-label="개요" className={`${styles.target} ${styles.overview}`}>
        <h2 tabIndex={-1}>개요</h2>
        <div className={styles.overviewLinks}>
          <Link className={styles.link} href="/cloud/manage">클라우드 개인 관리 <Icon name="arrow" /></Link>
          {(projects.kind === "unlinked" || projects.kind === "failed") &&
            <Link className={styles.link} href="/cloud/projects">내 프로젝트 전체 화면 <Icon name="arrow" /></Link>}
        </div>
      </section>

      <div id="admin-project-list" role="group" aria-label="내 프로젝트" className={`${styles.target} ${styles.defaultPanel}`} tabIndex={-1}>
        <AdminProjectsSection state={projects} />
      </div>
      <div id="admin-reference-analysis" role="group" aria-label="콘텐츠 프롬프트 분석기" className={`${styles.target} ${styles.analysisDeck}`} tabIndex={-1}>
        <div className={styles.analysisMain}><AdminReferenceAnalysis /></div>
        <AdminAnalysisGuide />
      </div>
      <div id="admin-review" role="group" aria-label="완성본 검수·게시" className={styles.target} tabIndex={-1}>
        {review}
      </div>

      <section id="admin-api-integrations" tabIndex={-1} aria-labelledby="admin-api-integrations-title" className={`${styles.target} ${styles.section}`}>
        <AdminApiIntegrations />
      </section>

      <section id="admin-render-queue" tabIndex={-1} aria-labelledby="admin-render-queue-heading" className={`${styles.target} ${styles.section}`}>
        <AdminRenderQueue />
      </section>

      <section id="admin-account" tabIndex={-1} aria-labelledby="admin-menu" className={`${styles.target} ${styles.section}`}>
        <h2 id="admin-menu" tabIndex={-1}>계정 설정</h2>
        <Card className={styles.accountCard}>
          <p className={styles.note}>로그인 계정 <strong>{email}</strong></p>
          <Link className={styles.link} href="/account/password">비밀번호 바꾸기 <Icon name="arrow" /></Link>
        </Card>
      </section>

      {/* 디자인 75657a7: 미연결 부가 기능은 접힌 한 묶음으로 둔다(기본 details/summary, Enter·Space 뒤 초점 유지).
          개수는 실제 목록 길이이고, 0개면 영역을 생략한다. 프로젝트·게시 카드의 상태와 복구 조작은 위에 그대로 있다. */}
      {unavailable.length > 0 && <section aria-labelledby="admin-unlinked" className={styles.section}>
        <h2 id="admin-unlinked">운영 연결 범위</h2>
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
      </section>}
    </div>
  </div>;
}
