import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { BrandLogo } from "@/components/ui/brand-logo";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { adminNextPath, authMode } from "@/lib/auth/config";
import { appConfig } from "@/lib/config/app";
import styles from "./page.module.css";

// 관리자 로그인(T-243). 기존 이메일·비밀번호 로그인(/api/auth/login)을 그대로 쓰고, 로그인 뒤 /admin으로 간다.
// 새 계정·새 권한이 아니다: 들어갈 수 있는지는 서버가 getUser + 허용 이메일로 판정한다.
export const metadata: Metadata = { title: `관리자 로그인 · ${appConfig.name}`, robots: { index: false, follow: false } };

// 오류 문구는 계정이 있는지·허용됐는지를 드러내지 않는 기존 문구와 같은 수준으로 둔다.
const ERRORS: Record<string, string> = {
  forbidden: "이 계정으로는 관리 화면을 열 수 없어요. 허용된 이메일로 로그인해 주세요.",
  unavailable: "로그인 설정이 아직 끝나지 않았어요.",
};
// 비밀번호를 새로 정하고 돌아왔을 때(T-245). 일반 로그인 화면과 같은 문구.
const NOTICES: Record<string, string> = {
  password: "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.",
  "password-partial": "비밀번호를 바꿨고 이 브라우저의 로그인은 지웠어요. 다른 기기의 로그인까지 끝났는지는 확인하지 못했으니, 다른 기기를 쓰셨다면 그 기기에서도 로그아웃해 주세요.",
};

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  // 이 PC 실행(로그인 꺼짐)은 관리자 인증으로 올리지 않는다. 설정 안내만 보인다.
  if (authMode() === "off") return <AdminLocalNotice />;
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] ?? ERRORS.unavailable : undefined;
  const notice = params.notice ? NOTICES[params.notice] : undefined;
  return <main id="main-content" className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.brand}>
        <BrandLogo markSize={34} />
      </header>
      <div className={styles.split}>
        <div className={styles.poster} aria-hidden="true">
          <div className={styles.posterCopy}>
            <p className={styles.posterTitle}>NEON<br /><span>AFTER HOURS</span></p>
            <p className={styles.credit}>{appConfig.name} · MUSIC FILM</p>
          </div>
        </div>
        <section className={styles.login} aria-labelledby="admin-login-title">
          <div className={styles.intro}>
            <h1 id="admin-login-title">관리자 로그인</h1>
            <p className={styles.lead}>운영자 계정으로 로그인해 관리 화면을 열어 주세요.</p>
          </div>
          <LoginForm next={adminNextPath(params.next)} initialError={error} initialNotice={notice} loginOnly resetContext="admin" />
          {/* T-255-F1: 공개 홈은 앱 안 이력 복원 없이 항상 새 문서로 연다(철회 즉시 반영). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 의도한 전체 문서 이동 */}
          <a className={styles.home} href="/">← 공개 메인으로</a>
        </section>
      </div>
    </div>
  </main>;
}
