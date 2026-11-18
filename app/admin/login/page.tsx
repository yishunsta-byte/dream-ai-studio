import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import styles from "@/components/auth/login.module.css";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import admin from "@/components/admin/admin.module.css";
import { adminNextPath, authMode } from "@/lib/auth/config";

// 관리자 로그인(T-243). 기존 이메일·비밀번호 로그인(/api/auth/login)을 그대로 쓰고, 로그인 뒤 /admin으로 간다.
// 새 계정·새 권한이 아니다: 들어갈 수 있는지는 서버가 getUser + 허용 이메일로 판정한다.
export const metadata: Metadata = { title: "관리자 로그인 · Dream AI Studio", robots: { index: false, follow: false } };

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
    <div className={styles.hero}>
      <span className={styles.badgeIcon} aria-hidden="true">D</span>
      <span className={styles.eyebrow}>DREAM AI STUDIO · 관리자</span>
      <h1 className={styles.title}>관리자 로그인</h1>
      <p className={styles.lead}>운영자 계정(이메일·비밀번호)으로 로그인하면 관리 화면으로 이동해요. 크리에이터 작업실 로그인과 같은 계정 체계를 써요.</p>
    </div>
    <div className={styles.panel}>
      <LoginForm next={adminNextPath(params.next)} initialError={error} initialNotice={notice} loginOnly resetContext="admin" />
      <p className={styles.note}><Link className={admin.link} href="/">← 공개 메인으로</Link></p>
    </div>
  </main>;
}
