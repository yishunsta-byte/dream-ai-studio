"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Callout } from "@/components/ui/primitives";
import { useSessionWatch, type SessionView } from "./use-session-watch";

// 보호 화면 공통 세션 경계(T-220, F216-1).
// 계정 표시(AccountMenu)와 보호 본문(ProtectedContent)이 같은 감시 상태를 본다. 이메일만 숨기면 sibling 본문이 남는다.
// - 확인됨(current): 본문을 그대로 보인다.
// - 의심(checking·offline·unavailable): 본문을 숨기고(hidden: 표시 없음) inert로 포커스·클릭·제출을 막는다.
//   같은 계정이 서버에서 다시 확인되면 그대로 복원한다(입력 중인 값 보존).
// - 확정(cleared: 바뀜·로그인 없음·허용 밖·15초 제한): 본문을 아예 그리지 않는다. 다시 받기·로그인 이동·새로 고침만 가능하다.
// 이 상태는 화면 표시만 바꾼다. 서버 권한은 계속 요청마다 서버가 판정하고, 이 값·알림을 권한 근거로 쓰지 않는다.
// 이미 브라우저 메모리에 내려온 데이터를 지운다고 보장하지 않는다.
type Boundary = Readonly<{ view: SessionView; cleared: boolean; retry: () => void; setPaused: (paused: boolean) => void }>;
// 시험에서 상태별 화면을 그려 보려고 내보낸다. 제품 코드는 SessionBoundary로만 값을 넣는다.
export const SessionBoundaryContext = createContext<Boundary | null>(null);

export function SessionBoundary({ account, children }: { account: string | null; children: ReactNode }) {
  if (!account) return <>{children}</>;
  return <WatchedBoundary account={account}>{children}</WatchedBoundary>;
}

function WatchedBoundary({ account, children }: { account: string; children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const { view, cleared, retry } = useSessionWatch(account, paused);
  const value = useMemo(() => ({ view, cleared, retry, setPaused }), [view, cleared, retry]);
  return <SessionBoundaryContext.Provider value={value}>{children}</SessionBoundaryContext.Provider>;
}

export function useSessionBoundary() { return useContext(SessionBoundaryContext); }

const MESSAGES: Record<Exclude<SessionView, "current">, { title: string; text: string }> = {
  checking: { title: "로그인 상태를 확인하고 있어요", text: "확인이 끝날 때까지 이 화면의 내용을 가려 두었어요." },
  offline: { title: "로그인 상태를 확인하지 못했어요", text: "인터넷 연결이 없어요. 연결되면 다시 확인하고, 그동안 이 화면의 내용은 가려 둘게요." },
  unavailable: { title: "로그인 상태를 확인하지 못했어요", text: "확인이 될 때까지 이 화면의 내용은 가려 둘게요. 잠시 뒤 다시 확인해 주세요." },
  stale: { title: "다른 창에서 로그인 계정이 바뀌었어요", text: "이전 계정의 화면 내용은 닫았어요. 화면을 새로 고쳐 지금 계정으로 다시 열어 주세요." },
};

// 경계 밖(감시가 없는 화면)에서는 그대로 통과한다.
export function ProtectedContent({ children }: { children: ReactNode }) {
  const boundary = useSessionBoundary();
  const notice = useRef<HTMLDivElement>(null);
  const shown = !boundary || boundary.view === "current";
  useEffect(() => {
    if (shown) return;
    // 가려진 본문 안에 있던 포커스는 안내로 옮긴다(숨은 요소에 포커스가 남지 않게).
    const active = document.activeElement;
    if (!active || active === document.body || !document.contains(active) || active.closest("[data-protected-content]")) notice.current?.focus();
  }, [shown, boundary?.view]);
  if (!boundary) return <>{children}</>;
  const view = boundary.view;
  if (view === "current") return <div data-protected-content="">{children}</div>;
  const message = MESSAGES[boundary.cleared && view !== "stale" ? "checking" : view];
  return <>
    <div ref={notice} tabIndex={-1} role="status" data-session-notice="" className="stack">
      <Callout tone={view === "stale" ? "warning" : "info"} title={message.title}>{message.text}</Callout>
      {(view === "offline" || view === "unavailable") && !boundary.cleared && <div><Button variant="secondary" size="sm" onClick={boundary.retry}>다시 확인</Button></div>}
      {view === "stale" && <div><Button variant="secondary" size="sm" onClick={() => window.location.reload()}>새로 고침</Button></div>}
    </div>
    {/* 의심 상태: 표시·포커스·클릭·제출 차단(hidden+inert), 같음 확인 뒤 복원. 확정 상태: 그리지 않는다. */}
    {!boundary.cleared && <div data-protected-content="" hidden inert>{children}</div>}
  </>;
}
