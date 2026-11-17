"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
// epoch: 다른 탭 신호를 받을 때마다 늘어난다. 이전 epoch에 받은 계정 데이터(예: 작업 수)를 다시 쓰지 않게 한다.
type Boundary = Readonly<{ view: SessionView; cleared: boolean; epoch: number; retry: () => void; setPaused: (paused: boolean) => void }>;
// 시험에서 상태별 화면을 그려 보려고 내보낸다. 제품 코드는 SessionBoundary로만 값을 넣는다.
export const SessionBoundaryContext = createContext<Boundary | null>(null);

export function SessionBoundary({ account, children }: { account: string | null; children: ReactNode }) {
  if (!account) return <>{children}</>;
  return <WatchedBoundary account={account}>{children}</WatchedBoundary>;
}

function WatchedBoundary({ account, children }: { account: string; children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const { view, cleared, epoch, retry } = useSessionWatch(account, paused);
  const value = useMemo(() => ({ view, cleared, epoch, retry, setPaused }), [view, cleared, epoch, retry]);
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
// T-224(F221-1): 확인됨↔의심 사이에서 본문은 같은 자리의 같은 div로 둔다(안내는 그 앞의 별도 자리).
//   그래서 React가 본문을 다시 만들지 않고 입력 값·DOM 노드·선택 위치가 그대로 남는다. 의심 동안은 hidden+inert만 켠다.
//   본문을 지우는 것은 확정(cleared)일 때뿐이다.
export function ProtectedContent({ children }: { children: ReactNode }) {
  const boundary = useSessionBoundary();
  const notice = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  // 본문 안에서 마지막으로 포커스를 받은 요소. 같은 계정 확인 뒤 포커스를 돌려줄 때만 쓴다.
  const lastFocus = useRef<HTMLElement | null>(null), moved = useRef(false);
  const shown = !boundary || boundary.view === "current";
  useLayoutEffect(() => {
    if (!boundary) return;
    const active = document.activeElement;
    if (!shown) {
      // 가려진 본문 안에 있던(또는 이미 잃은) 포커스는 안내로 옮긴다.
      const inBody = !!active && !!body.current?.contains(active);
      if (inBody || !active || active === document.body) { moved.current = inBody || !!lastFocus.current; notice.current?.focus(); }
      return;
    }
    // 같은 계정 확인 뒤: 안내로 옮겼던 포커스만 원래 입력으로 돌려준다(입력 칸의 선택 위치는 요소에 남아 있다).
    const target = lastFocus.current;
    if (moved.current && target && target.isConnected && body.current?.contains(target) && (!active || active === document.body)) target.focus({ preventScroll: true });
    moved.current = false;
  }, [shown, boundary]);
  if (!boundary) return <>{children}</>;
  const view = boundary.view;
  const message = shown ? null : MESSAGES[boundary.cleared && view !== "stale" ? "checking" : view as Exclude<SessionView, "current">];
  return <>
    {message && <div ref={notice} tabIndex={-1} role="status" data-session-notice="" className="stack">
      <Callout tone={view === "stale" ? "warning" : "info"} title={message.title}>{message.text}</Callout>
      {(view === "offline" || view === "unavailable") && !boundary.cleared && <div><Button variant="secondary" size="sm" onClick={boundary.retry}>다시 확인</Button></div>}
      {view === "stale" && <div><Button variant="secondary" size="sm" onClick={() => window.location.reload()}>새로 고침</Button></div>}
    </div>}
    {/* 확인됨·의심: 같은 div(의심이면 hidden+inert로 표시·포커스·클릭·제출 차단). 확정: 그리지 않는다. */}
    {!boundary.cleared && <div ref={body} data-protected-content="" hidden={!shown || undefined} inert={!shown || undefined} onFocus={(event) => { if (event.target instanceof HTMLElement) lastFocus.current = event.target; }}>{children}</div>}
  </>;
}
