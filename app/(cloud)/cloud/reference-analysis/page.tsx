import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { StudioRegisteredAnalysisPage } from "@/components/reference-analysis/studio-registered-analysis-page";
import { PageHeader } from "@/components/ui/primitives";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";
import type { ServerAuthResult } from "@/lib/auth/resolve";

export const metadata: Metadata = { title: "콘텐츠 분석 · Dream AI Studio" };

// T317 · T316 단계 1: 서버 렌더는 인증·로컬 판정만 하고 등록 자료 목록을 조회하거나 props에 싣지 않는다.
// 기존 목록 로더·연결·분석 API·DB 계약과 활성화 플래그는 그대로 두며, 이 페이지는 항상 자료 없는 셸만 보낸다.
export default async function CloudReferenceAnalysisPage() {
  let auth: ServerAuthResult;
  try {
    auth = await getRenderAuth();
  } catch {
    auth = { kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" };
  }
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: "/cloud/reference-analysis" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (auth.kind === "local") return <CloudReadLocal title="콘텐츠 분석" />;

  return <>
    <PageHeader title="콘텐츠 분석" />
    <StudioRegisteredAnalysisPage />
  </>;
}
