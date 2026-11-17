import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode, safeNextPath } from "@/lib/auth/config";
import { LoginForm } from "@/components/auth/login-form";
import styles from "@/components/auth/login.module.css";

export const metadata: Metadata = { title: "로그인 · Dream AI Studio" };

const ERRORS: Record<string, string> = {
  link: "로그인 링크가 만료됐거나 이미 사용됐어요. 새 링크를 받아 주세요.",
  forbidden: "이 계정은 사용할 수 없어요. 허용된 이메일로 로그인해 주세요.",
  unavailable: "로그인 설정이 아직 끝나지 않았어요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (authMode() === "off") redirect("/");
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] ?? ERRORS.link : undefined;
  return <main id="main-content" className={styles.page}>
    <div className={styles.panel}>
      <div className={styles.brand}><span className={styles.logo} aria-hidden="true">D</span><div><strong>Dream AI Studio</strong><span>나만의 콘텐츠 작업실</span></div></div>
      <h1 className={styles.title}>로그인</h1>
      <p className={styles.lead}>이메일로 로그인 링크를 보내 드려요. 비밀번호는 필요 없어요.</p>
      <LoginForm next={safeNextPath(params.next)} initialError={error} />
    </div>
  </main>;
}
