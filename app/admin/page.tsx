import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/auth/account-menu";
import { ProtectedContent, SessionBoundary } from "@/components/auth/session-boundary";
import { AdminHub } from "@/components/admin/admin-hub";
import { AdminOperationsHome } from "@/components/admin/admin-operations-home";
import { loadAdminProjects } from "@/components/admin/admin-projects";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { PublicationHttpQueue } from "@/components/admin/publication-http-queue";
import styles from "@/components/admin/admin.module.css";
import { adminLoginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";
import { createAdminPublicationHttp } from "@/lib/public-showcase/admin-publication-http";

// 관리 허브(T-243). proxy가 먼저 막고, 화면도 그리기 전에 서버에서 다시 판정한다(getUser + 허용 이메일).
// 확인된 계정이 아니면 어떤 관리 정보도 읽거나 그리지 않는다.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "관리 화면 · Dream AI Studio", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: "/admin" }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  const account = auth.email;
  // T283: 관리자 인증이 확인된 뒤에만 자기 계정 프로젝트를 읽는다.
  const projects = await loadAdminProjects();
  // T297: 같은 인증 판정(getRenderAuth 캐시) 뒤에만 게시 큐 첫 목록을 읽는다. 운영 저장소가 없으면 closed(미연결 안내).
  const publications = await createAdminPublicationHttp({ resolveAuth: getRenderAuth }).list();
  return <SessionBoundary account={account}>
    <div className={styles.console}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/admin" aria-label="DREAM SCREEN 운영 관리자">
          <span className={styles.brandIdentity}>
            <span className={styles.brandMark} aria-hidden="true">✦</span>
            <span>DREAM <em>SCREEN</em></span>
          </span>
          <span className={styles.brandScope}>운영 관리자</span>
        </Link>
        <AccountMenu email={account} />
      </header>
      <main id="main-content" className="content">
        <ProtectedContent>
          <AdminHub email={account} projects={projects} home={<AdminOperationsHome publications={publications} />}
            review={<PublicationHttpQueue initial={publications} />} />
        </ProtectedContent>
      </main>
    </div>
  </SessionBoundary>;
}
