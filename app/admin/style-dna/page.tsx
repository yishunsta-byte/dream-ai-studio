import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SessionBoundary } from "@/components/auth/session-boundary";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import { AdminStyleDnaWorkflow } from "@/components/admin/admin-style-dna-workflow";
import { adminLoginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

// P1-06 원본 Style DNA v1.39 전체 화면(관리자 보호 경로). /admin과 같은 경계: proxy가 먼저 막고, 그리기 전에 서버에서 다시 판정한다(getUser + 허용 이메일).
// 확인된 관리자 계정이 아니면 아무것도 그리지 않고 로그인으로 보낸다(로그인 뒤 이 화면으로 복귀). 화면은 공통 세션 감시(SessionBoundary·ProtectedContent)로
// 인증 만료·다른 탭 계정 변경 때 본문을 가린다. 첫 화면은 원본처럼 보관함이고, 기존 허브의 이미지 요약 칸은 그리지 않는다.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "이미지 스타일 분석기 · Dream AI Studio", robots: { index: false, follow: false } };

export default async function StyleDnaPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: "/admin/style-dna" }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  // 본문 가림(ProtectedContent)은 원본 껍데기(studio-shell)의 main 안에 있다. 사이드바의 계정 메뉴(로그아웃·다시 확인)는 가리지 않는다.
  const account = auth.email;
  return <SessionBoundary account={account}>
    <AdminStyleDnaWorkflow layout="original" account={account} />
  </SessionBoundary>;
}
