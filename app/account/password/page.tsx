import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode, passwordContext } from "@/lib/auth/config";
import { currentAccountEmail } from "@/lib/auth/render";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { BrandMark } from "@/components/ui/brand-logo";
import { appConfig } from "@/lib/config/app";
import styles from "@/components/auth/login.module.css";

export const metadata: Metadata = { title: `새 비밀번호 · ${appConfig.name}` };

// 비밀번호 찾기 메일 링크로 들어와 새 비밀번호를 정하는 화면(T-184). 로그인 확인은 proxy가 한다.
export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ context?: string }> }) {
  if (authMode() === "off") redirect("/studio");
  // T-245: 정해 둔 이름(admin)만 받는다. 그 밖의 값은 일반 흐름이다.
  const context = passwordContext((await searchParams).context);
  const email = await currentAccountEmail();
  return <main id="main-content" className={styles.page}>
    <div className={styles.hero}>
      <BrandMark size={64} />
      <span className={styles.eyebrow}>{appConfig.name}{context === "admin" && " · 관리자"}</span>
      <h1 className={styles.title}>새 비밀번호 정하기</h1>
      {email && <p className={styles.lead}>{email} 계정의 비밀번호를 새로 정해요.</p>}
    </div>
    <div className={styles.panel}><NewPasswordForm context={context} /></div>
  </main>;
}
