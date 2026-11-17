"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { requestLogout } from "@/lib/auth/logout-client";
import styles from "./login.module.css";

export function AccountMenu({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function logout() {
    setBusy(true); setProblem(null);
    const result = await requestLogout();
    // 이 브라우저 로그인이 지워졌으면(완료·부분) 로그인 화면으로, 남아 있으면 그대로 두고 알린다.
    if (result.state === "ended") { window.location.assign("/login"); return; }
    if (result.state === "partial") { window.location.assign("/login?notice=logout-partial"); return; }
    setProblem(result.message); setBusy(false);
  }
  return <div className={styles.account}>
    <span className={styles.email} title={email}><span className="sr-only">로그인한 계정 </span>{email}</span>
    <Button variant="ghost" size="sm" loading={busy} loadingLabel="나가는 중" onClick={logout} aria-label={`로그아웃 (${email})`}>{problem ? "로그아웃 다시 시도" : "로그아웃"}</Button>
    {problem && <span role="alert" className={styles.accountError}>{problem}</span>}
  </div>;
}
