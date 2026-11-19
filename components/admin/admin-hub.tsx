import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader, StatusPill } from "@/components/ui/primitives";
import { AdminProjectsSection, type AdminProjects } from "./admin-projects";
import { AdminNavigation } from "./admin-navigation";
import styles from "./admin.module.css";

const unavailable = [
  { title: "작업 대기열", detail: "대기·실행·실패 상태와 취소·재시도" },
  { title: "자료 관리", detail: "원본·렌더·ZIP의 사용량과 권리 기록" },
  { title: "백업·복원", detail: "최근 백업 결과와 복원 진행 상태" },
  { title: "운영 로그", detail: "오류·활동·요청 기록" },
  { title: "회원 관리", detail: "다른 회원의 계정과 권한 조회" },
  { title: "서비스 상태", detail: "작업 처리기 응답과 파일 저장소 점검" },
] as const;

export function AdminHub({ email, projects, review }: { email: string; projects: AdminProjects; review: ReactNode }) {
  return <div className={styles.workspace}>
    <AdminNavigation />
    <div className={styles.sections}>
      <section id="admin-overview" tabIndex={-1} aria-label="개요" className={`${styles.target} ${styles.overview}`}>
        <PageHeader title="관리 화면" description="내 계정의 프로젝트를 보고, 완성본의 검수·게시 상태를 확인해요." />
        <div className={styles.overviewLinks}>
          <Link className={styles.link} href="/cloud/manage">클라우드 개인 관리 <Icon name="arrow" /></Link>
          {(projects.kind === "unlinked" || projects.kind === "failed") &&
            <Link className={styles.link} href="/cloud/projects">내 프로젝트 전체 화면 <Icon name="arrow" /></Link>}
        </div>
      </section>

      <div id="admin-project-list" role="group" aria-label="내 프로젝트" className={styles.target} tabIndex={-1}>
        <AdminProjectsSection state={projects} />
      </div>
      <div id="admin-review" role="group" aria-label="완성본 검수·게시" className={styles.target} tabIndex={-1}>
        {review}
      </div>

      <section id="admin-account" tabIndex={-1} aria-labelledby="admin-menu" className={`${styles.target} ${styles.section}`}>
        <h2 id="admin-menu">계정 설정</h2>
        <Card className={styles.accountCard}>
          <p className={styles.note}>로그인 계정 <strong>{email}</strong></p>
          <Link className={styles.link} href="/account/password">비밀번호 바꾸기 <Icon name="arrow" /></Link>
        </Card>
      </section>

      <section aria-labelledby="admin-unlinked" className={styles.section}>
        <h2 id="admin-unlinked">운영 연결 범위</h2>
        <p className={styles.note}>현재 이 화면에서 제공하지 않는 운영 기능이에요.</p>
        <Card padding="none">
          <ul className={styles.unavailableList}>
            {unavailable.map(({ title, detail }) => <li key={title}>
              <h3>{title}</h3>
              <StatusPill status="locked">미연결</StatusPill>
              <p>{detail}</p>
            </li>)}
          </ul>
        </Card>
      </section>
    </div>
  </div>;
}
