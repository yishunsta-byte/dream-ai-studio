import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SessionBoundary } from "@/components/auth/session-boundary";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { shortsAnalysisPath, SHORTS_APP } from "@/components/admin/shorts-original/shorts-paths";
import { ShortsStudio } from "@/components/admin/shorts-original/shorts-studio";
import { adminLoginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

// P1-08 원본 Shorts Viral Studio v2.01 전용 화면(관리자 보호 경로). /admin과 같은 경계: proxy가 먼저 막고, 그리기 전에 서버에서 다시 판정한다.
// 확인된 관리자 계정이 아니면 아무것도 그리지 않고 로그인으로 보낸다(로그인 뒤 이 화면으로 복귀). 본문 가림(ProtectedContent)은 셸의 main 안에 있고,
// 왼쪽 메뉴의 계정 메뉴(로그아웃·다시 확인)는 가리지 않는다. ①검색·②분석은 기존 관리자 API를 쓰고, 서버가 아직 없는 ③~⑥·보관함은 '실행 준비 중'을 보인다.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${SHORTS_APP.full} · Dream AI Studio`, robots: { index: false, follow: false } };

export default async function AdminShortsAnalysisPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: shortsAnalysisPath }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  const account = auth.email;
  return <SessionBoundary account={account}>
    <ShortsStudio account={account} />
  </SessionBoundary>;
}
