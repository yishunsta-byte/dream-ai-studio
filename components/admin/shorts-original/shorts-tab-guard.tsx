"use client";

import { useEffect } from "react";
import { useSessionBoundary } from "@/components/auth/session-boundary";
import { shortsTabStorage } from "./shorts-tab-store";

// P1-08-SHORTS-SESSION-RESTORE-OWNER-2: 관리 허브는 보호 본문(ProtectedContent)이 AdminHub 전체를 감싼다.
// 로그인 확인이 '바뀜·로그아웃'으로 확정(cleared)되면 보호 본문이 쇼츠 작업실을 먼저 내려서, 작업실 안의 지우기가 실행되지 않는다.
// 그래서 보호 본문 밖(세션 경계 바로 안)에서 확정을 보고 쇼츠 탭 기록을 지운다. 화면에는 아무것도 그리지 않고 요청도 보내지 않는다.
export function ShortsTabGuard() {
  const cleared = !!useSessionBoundary()?.cleared;
  useEffect(() => { if (cleared) shortsTabStorage.clear(); }, [cleared]);
  return null;
}
