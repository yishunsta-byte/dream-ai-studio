import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Callout, PageHeader } from "@/components/ui/primitives";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { ManagedPlanEditor } from "@/components/cloud/managed-plan-editor";
import { cloudScenesPath } from "@/components/cloud/managed-scene-requests";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

export const metadata: Metadata = { title: "기획 · Dream AI Studio" };

// P1-08 클라우드 기획(Backend 4fba696). 인증을 통과한 뒤에만 id를 읽고, 형식이 틀리면 404(남의 것·없음과 같은 모양).
// 기획 API가 관리형 저장소로 가는 조건(DREAM_PROJECT_PLAN_BACKEND 지정)일 때만 편집 화면을 연다. 아니면 준비 안내(요청 없음).
// 내용·저장·승인은 화면이 같은 출처 GET/POST /api/projects/:id/plan으로만 다룬다(이 페이지는 DB를 읽지 않음).
export default async function CloudProjectPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <CloudReadLocal title="기획" />;
  const id = z.uuidv7().safeParse((await params).id);
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: id.success ? `/cloud/projects/${id.data.toLowerCase()}/plan` : "/cloud/projects" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (!id.success) notFound();
  const projectId = id.data.toLowerCase();
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="기획" description="대본과 장면 구성을 저장하고, 살펴본 뒤 승인해요." />
    {process.env.DREAM_PROJECT_PLAN_BACKEND === undefined
      ? <Callout tone="info" title="아직 클라우드에서는 기획을 편집할 수 없어요">
          기획을 저장할 수 있게 되면 여기에서 대본과 장면을 고치고 승인할 수 있어요. <Link href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link>
        </Callout>
      // P2-MANAGED-SOURCE-SCENE-PANEL: 관리형 장면 조회가 열려 있을 때만 승인 뒤 장면 링크를 준다.
      : <ManagedPlanEditor projectId={projectId} scenesHref={process.env.DREAM_SCENE_READ_BACKEND !== undefined ? cloudScenesPath(projectId) : undefined} />}
  </>;
}
