import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode, safeNextPath } from "@/lib/auth/config";
import { LoginForm } from "@/components/auth/login-form";
import styles from "@/components/auth/login.module.css";

export const metadata: Metadata = { title: "로그인 · Dream AI Studio" };

const ERRORS: Record<string, string> = {
  link: "메일 링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요.",
  forbidden: "이 계정은 사용할 수 없어요. 허용된 이메일로 로그인해 주세요.",
  unavailable: "로그인 설정이 아직 끝나지 않았어요.",
};
const NOTICES: Record<string, string> = {
  password: "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.",
  "password-partial": "비밀번호를 바꿨고 이 브라우저의 로그인은 지웠어요. 다른 기기의 로그인까지 끝났는지는 확인하지 못했으니, 다른 기기를 쓰셨다면 그 기기에서도 로그아웃해 주세요.",
  "logout-partial": "이 브라우저의 로그인은 지웠어요. 다른 기기의 로그인까지 끝났는지는 확인하지 못했어요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  if (authMode() === "off") redirect("/");
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] ?? ERRORS.link : undefined;
  const notice = params.notice ? NOTICES[params.notice] : undefined;
  return <main id="main-content" className={styles.page}>
    <div className={styles.hero}>
      <span className={styles.badgeIcon} aria-hidden="true">D</span>
      <span className={styles.eyebrow}>DREAM AI STUDIO</span>
      <h1 className={styles.title}>나만의 콘텐츠 작업실</h1>
      <p className={styles.lead}>Dream AI Studio 계정(이메일·비밀번호)으로 로그인하세요.</p>
    </div>
    <div className={styles.panel}>
      <LoginForm next={safeNextPath(params.next)} initialError={error} initialNotice={notice} />
    </div>
  </main>;
}
