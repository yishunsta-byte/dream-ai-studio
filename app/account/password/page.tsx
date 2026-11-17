import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth/config";
import { currentAccountEmail } from "@/lib/auth/server";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import styles from "@/components/auth/login.module.css";

export const metadata: Metadata = { title: "새 비밀번호 · Dream AI Studio" };

// 비밀번호 찾기 메일 링크로 들어와 새 비밀번호를 정하는 화면(T-184). 로그인 확인은 proxy가 한다.
export default async function NewPasswordPage() {
  if (authMode() === "off") redirect("/");
  const email = await currentAccountEmail();
  return <main id="main-content" className={styles.page}>
    <div className={styles.hero}>
      <span className={styles.badgeIcon} aria-hidden="true">D</span>
      <span className={styles.eyebrow}>DREAM AI STUDIO</span>
      <h1 className={styles.title}>새 비밀번호 정하기</h1>
      {email && <p className={styles.lead}>{email} 계정의 비밀번호를 새로 정해요.</p>}
    </div>
    <div className={styles.panel}><NewPasswordForm /></div>
  </main>;
}
