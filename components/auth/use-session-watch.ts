"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkSession, decideSession, onSessionSignal, reloadOnce } from "@/lib/auth/session-sync";

// 화면에 보이는 계정이 지금 로그인과 같은지 지켜본다(T-213, F209-1).
// - 다른 탭 알림·실제 pageshow 복원: 이전 계정을 바로 숨기고 서버에 다시 묻는다(의심 상태).
// - focus·보이기 전환·online 복귀: 표시는 그대로 두고 조용히 다시 묻는다. 숨은 탭을 주기적으로 묻지 않는다.
// - 서버 답: 같음 → 표시 / 바뀜 → 전체 문서 다시 받기(1회 제한) / 로그인 없음·허용 밖 → 로그인 화면으로 전체 이동
//   / 확인 불가·오프라인 → 의심 상태면 숨긴 채 정직하게 알리고, 아니면 표시 유지.
export type SessionView = "current" | "checking" | "offline" | "unavailable" | "stale";

export function useSessionWatch(account: string, paused = false) {
  const [view, setView] = useState<SessionView>("current");
  const suspect = useRef(false), running = useRef(false), again = useRef(false), last = useRef(0), pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const verify = useCallback(async (reason: "signal" | "return") => {
    if (pausedRef.current) return;
    if (reason === "signal") { suspect.current = true; setView("checking"); }
    else if (!suspect.current && Date.now() - last.current < 3_000) return;
    // 확인 중에 알림이 또 오면 끝난 뒤 한 번 더 묻는다(알림 전에 보낸 요청의 "같음"으로 이전 계정을 되살리지 않게).
    if (running.current) { if (reason === "signal") again.current = true; return; }
    running.current = true; last.current = Date.now();
    try {
      const decision = decideSession(await checkSession(account), suspect.current);
      if (again.current) return;
      if (decision.view === "keep") return;
      suspect.current = decision.view !== "current";
      if (decision.go === "reload") { setView(reloadOnce() ? "checking" : "stale"); return; }
      setView(decision.view);
      if (decision.go) {
        const here = `${window.location.pathname}${window.location.search}`;
        window.location.assign(decision.go === "forbidden" ? "/login?error=forbidden" : `/login?next=${encodeURIComponent(here)}`);
      }
    } finally {
      running.current = false;
      if (again.current) { again.current = false; void verify("signal"); }
    }
  }, [account]);

  useEffect(() => {
    const stop = onSessionSignal(() => { void verify("signal"); });
    const onReturn = () => { if (document.visibilityState === "visible") void verify("return"); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void verify("signal"); };
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stop();
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [verify]);

  return { view, retry: () => { void verify("signal"); } };
}
