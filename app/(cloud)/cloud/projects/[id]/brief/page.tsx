import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Callout, PageHeader } from "@/components/ui/primitives";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { ManagedBriefPanel } from "@/components/cloud/managed-brief-panel";
import { cloudPlanPath } from "@/components/cloud/managed-plan-requests";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

export const metadata: Metadata = { title: "브리프 확인 · Dream AI Studio" };

// P1-02 클라우드 브리프 확인·승인. 인증을 통과한 뒤에만 id를 읽고, 형식이 틀리면 404(남의 것·없음과 같은 모양).
// 내용·단계·승인은 화면이 같은 출처 GET/POST /api/projects/:id/brief로만 다룬다(이 페이지는 DB를 읽지 않음).
// P2-MANAGED-BRIEF-CORE-CAPABILITY: 브리프 API가 관리형 저장소로 가는 조건(DREAM_PROJECT_CORE_BACKEND 지정)일 때만 패널을 연다.
// 아니면 기획·장면과 같이 준비 안내만 보여 주고 요청을 보내지 않는다(설정이 없으면 API가 항상 503이라 다시 불러와도 풀리지 않음).
export default async function CloudProjectBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <CloudReadLocal title="브리프 확인" />;
  const id = z.uuidv7().safeParse((await params).id);
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: id.success ? `/cloud/projects/${id.data.toLowerCase()}/brief` : "/cloud/projects" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (!id.success) notFound();
  const projectId = id.data.toLowerCase();
  // P1-08: 기획 API가 관리형으로 가는 조건일 때만 승인 뒤 기획 링크를 준다(아니면 기존처럼 프로젝트 보기만).
  const planHref = process.env.DREAM_PROJECT_PLAN_BACKEND !== undefined ? cloudPlanPath(projectId) : undefined;
  // P2-MANAGED-BRIEF-UNAVAILABLE-HEADER: 브리프 저장소(코어)가 꺼져 있으면 머리말도 준비 상태만 말하고 승인·기획을 약속하지 않는다.
  const coreReady = process.env.DREAM_PROJECT_CORE_BACKEND !== undefined;
  // P2: 머리 안내도 같은 조건으로 고른다. 클라우드 기획 화면이 없으면 승인 뒤 기획을 여기서 이어 간다고 말하지 않는다.
  const description = !coreReady ? "클라우드 브리프 확인은 아직 준비 중이에요. 진행 상태는 프로젝트 보기에서 확인할 수 있어요."
    : planHref ? "등록한 내용을 살펴보고 승인하면 기획 단계가 열려요."
    : "등록한 내용을 살펴보고 승인해요. 클라우드 기획 화면은 아직 준비 중이라 승인 뒤에는 프로젝트 보기에서 단계 상태를 확인할 수 있어요.";
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="브리프 확인" description={description} />
    {!coreReady
      ? <Callout tone="info" title="아직 클라우드에서는 브리프를 확인할 수 없어요">
          브리프를 확인할 수 있게 되면 여기에서 등록한 내용을 살펴보고 승인할 수 있어요. <Link href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link>
        </Callout>
      : <ManagedBriefPanel projectId={projectId} planHref={planHref} />}
  </>;
}
