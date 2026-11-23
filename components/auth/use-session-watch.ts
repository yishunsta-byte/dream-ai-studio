"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminLoginPath, isAdminPath, loginPath } from "@/lib/auth/config";
import { checkSession, decideSession, onSessionSignal, reloadOnce } from "@/lib/auth/session-sync";

// 화면에 보이는 계정이 지금 로그인과 같은지 지켜본다(T-213, F209-1).
// - 다른 탭 알림·실제 pageshow 복원: 이전 계정을 바로 숨기고 서버에 다시 묻는다(의심 상태).
// - focus·보이기 전환·online 복귀: 표시는 그대로 두고 조용히 다시 묻는다. 숨은 탭을 주기적으로 묻지 않는다.
// - 서버 답: 같음 → 표시 / 바뀜 → 전체 문서 다시 받기(1회 제한) / 로그인 없음·허용 밖 → 로그인 화면으로 전체 이동
//   / 확인 불가·오프라인 → 의심 상태면 숨긴 채 정직하게 알리고, 아니면 표시 유지.
export type SessionView = "current" | "checking" | "offline" | "unavailable" | "stale";

// cleared(T-220, F216-1): 서버가 계정 변경·로그인 없음·허용 밖을 확정했다. 이전 화면 본문은 다시 보여 주지 않는다
// (다시 받기·로그인 이동·수동 새로 고침만). 의심 상태(checking·offline·unavailable)는 같음 확인 뒤에만 복원한다.
// enabled=false면 듣지 않는다(공통 경계가 이미 감시할 때 AccountMenu가 중복 감시하지 않게).
export function useSessionWatch(account: string, paused = false, enabled = true) {
  const [view, setView] = useState<SessionView>("current");
  const [cleared, setCleared] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const suspect = useRef(false), running = useRef(false), again = useRef(false), last = useRef(0), pausedRef = useRef(paused);
  const clearedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const verify = useCallback(async (reason: "signal" | "return") => {
    if (pausedRef.current) return;
    if (reason === "signal") { suspect.current = true; setView("checking"); setEpoch((value) => value + 1); }
    else if (!suspect.current && Date.now() - last.current < 3_000) return;
    // 확인 중에 알림이 또 오면 끝난 뒤 한 번 더 묻는다(알림 전에 보낸 요청의 "같음"으로 이전 계정을 되살리지 않게).
    if (running.current) { if (reason === "signal") again.current = true; return; }
    running.current = true; last.current = Date.now();
    try {
      const decision = decideSession(await checkSession(account), suspect.current);
      if (again.current) return;
      if (decision.view === "keep") return;
      // 한 번 변경이 확정된 문서는 같은 답이 와도 이전 본문을 되살리지 않는다(새로 고침으로만 해소).
      if (clearedRef.current && decision.view === "current") { setView("stale"); return; }
      suspect.current = decision.view !== "current";
      if (decision.go) { clearedRef.current = true; setCleared(true); }
      if (decision.go === "reload") { setView(reloadOnce() ? "checking" : "stale"); return; }
      setView(decision.view);
      if (decision.go) {
        const { pathname, search } = window.location;
        const login = isAdminPath(pathname) ? adminLoginPath : loginPath;
        window.location.assign(login(decision.go === "forbidden" ? { error: "forbidden" } : { next: `${pathname}${search}` }));
      }
    } finally {
      running.current = false;
      if (again.current) { again.current = false; void verify("signal"); }
    }
  }, [account]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [verify, enabled]);

  return { view, cleared, epoch, retry: useCallback(() => { void verify("signal"); }, [verify]) };
}
