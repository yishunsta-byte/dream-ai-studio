"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { requestLogout } from "@/lib/auth/logout-client";
import { announceSessionChange } from "@/lib/auth/session-sync";
import { useSessionWatch, type SessionView } from "./use-session-watch";
import { useSessionBoundary } from "./session-boundary";
import styles from "./login.module.css";

// 계정을 확인하지 못한 동안 보이는 문구. 이전 계정 이메일은 보여 주지 않는다(T-213).
const NOT_CONFIRMED: Record<Exclude<SessionView, "current">, string> = {
  checking: "로그인 상태를 확인하고 있어요",
  offline: "인터넷 연결이 없어 로그인 상태를 확인하지 못했어요. 연결되면 다시 확인해요.",
  unavailable: "지금은 로그인 상태를 확인하지 못했어요.",
  stale: "다른 창에서 로그인 계정이 바뀌었어요. 화면을 새로 고쳐 주세요.",
};

export function AccountMenu({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 공통 경계(SessionBoundary) 안이면 그 감시 상태를 함께 쓴다(본문과 같은 판정). 경계 밖이면 자체 감시(T-213 동작).
  const boundary = useSessionBoundary();
  const own = useSessionWatch(email, busy, !boundary);
  const { view, retry } = boundary ?? own;
  useEffect(() => { boundary?.setPaused(busy); }, [boundary, busy]);
  async function logout() {
    setBusy(true); setProblem(null);
    const result = await requestLogout();
    // 이 브라우저 로그인이 지워졌으면(완료·부분) 다른 탭에 알리고 로그인 화면으로, 남아 있으면 그대로 두고 알린다.
    if (result.state === "ended") { announceSessionChange(); window.location.assign("/login"); return; }
    if (result.state === "partial") { announceSessionChange(); window.location.assign("/login?notice=logout-partial"); return; }
    setProblem(result.message); setBusy(false);
  }
  const confirmed = view === "current";
  return <div className={styles.account}>
    {confirmed
      ? <span className={styles.email} title={email}><span className="sr-only">로그인한 계정 </span>{email}</span>
      : <span className={styles.accountNotice} role="status">{NOT_CONFIRMED[view]}</span>}
    {(view === "offline" || view === "unavailable") && <Button variant="ghost" size="sm" onClick={retry}>다시 확인</Button>}
    {view === "stale" && <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>새로 고침</Button>}
    <Button variant="ghost" size="sm" loading={busy} loadingLabel="나가는 중" onClick={logout} aria-label={confirmed ? `로그아웃 (${email})` : "로그아웃"}>{problem ? "로그아웃 다시 시도" : "로그아웃"}</Button>
    {problem && <span role="alert" className={styles.accountError}>{problem}</span>}
  </div>;
}
