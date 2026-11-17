"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import styles from "./login.module.css";

export function AccountMenu({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { window.location.assign("/login"); }
  }
  return <div className={styles.account}>
    <span className={styles.email} title={email}><span className="sr-only">로그인한 계정 </span>{email}</span>
    <Button variant="ghost" size="sm" loading={busy} loadingLabel="나가는 중" onClick={logout} aria-label={`로그아웃 (${email})`}>로그아웃</Button>
  </div>;
}
