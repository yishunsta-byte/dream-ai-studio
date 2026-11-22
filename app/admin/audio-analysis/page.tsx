import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/auth/account-menu";
import { ProtectedContent, SessionBoundary } from "@/components/auth/session-boundary";
import { AudioStudio } from "@/components/admin/audio-original/audio-studio";
import { AdminStudioReturn } from "@/components/admin/admin-studio-return";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { audioAnalysisHref } from "@/components/admin/audio-analysis-path";
import styles from "@/components/admin/admin.module.css";
import { adminLoginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

// P1-07 오디오 원본(v1.15) 전용 화면(관리자 보호 경로, 운영 33ff5a0 위 선별 이식). /admin과 같은 경계: proxy가 먼저 막고, 그리기 전에 서버에서 다시 판정한다.
// 확인된 관리자 계정이 아니면 아무것도 그리지 않고 로그인으로 보낸다(로그인 뒤 이 화면으로 복귀).
// 작업 화면은 원본 셸 AudioStudio(자동·음성·음악, 상세 보고서, FLAC·큰 파일 보호 업로드). 작업실 문맥(project·scene)은 로그인 복귀에도 옮기고
// 화면의 AdminStudioReturn이 소유자 제작 조회로 다시 확인한다(일시 실패면 문맥 유지·다시 확인). 장면 저장은 Backend 공통 저장 계약이 고정될 때까지 넣지 않는다.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "오디오 분석 · Dream AI Studio", robots: { index: false, follow: false } };

export default async function AdminAudioAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: audioAnalysisHref(await searchParams) }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  const account = auth.email;
  return <SessionBoundary account={account}>
    <div className={styles.console}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/admin" prefetch={false} aria-label="DREAM SCREEN 운영 관리자">
          <span className={styles.brandMark} aria-hidden="true">✦</span>
          <span>DREAM <em>SCREEN</em></span>
          <span className={styles.brandScope}>운영 관리자</span>
        </Link>
        <AccountMenu email={account} />
      </header>
      <main id="main-content" className="content">
        <ProtectedContent>
          <h1 className="sr-only">오디오 분석</h1>
          <p><Link className={styles.link} href="/admin#admin-music-analysis" prefetch={false}>← 관리 화면 음악 분석으로</Link></p>
          <AdminStudioReturn kind="audio" />
          <AudioStudio />
        </ProtectedContent>
      </main>
    </div>
  </SessionBoundary>;
}
