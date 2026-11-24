import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Callout, PageHeader } from "@/components/ui/primitives";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { ManagedScenePanel } from "@/components/cloud/managed-scene-panel";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

export const metadata: Metadata = { title: "장면 결과 · Dream AI Studio" };

// P2-MANAGED-SOURCE-SCENE-PANEL 클라우드 장면 결과. 인증을 통과한 뒤에만 id를 읽고, 형식이 틀리면 404(남의 것·없음과 같은 모양).
// 장면 조회가 관리형 저장소로 가는 조건(DREAM_SCENE_READ_BACKEND 지정)일 때만 화면을 연다. 아니면 준비 안내(요청 없음).
// 등록 버튼은 등록 경로 조건(DREAM_SCENE_RESULT_BACKEND + 자료를 읽는 DREAM_PROJECT_CORE_BACKEND), 선택 버튼은 DREAM_SCENE_SELECT_BACKEND일 때만 보인다.
// 내용·등록·선택은 화면이 같은 출처 GET /scenes · POST /scene-results · POST /scene-selection으로만 다룬다(이 페이지는 DB를 읽지 않음).
export default async function CloudProjectScenesPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <CloudReadLocal title="장면 결과" />;
  const id = z.uuidv7().safeParse((await params).id);
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: id.success ? `/cloud/projects/${id.data.toLowerCase()}/scenes` : "/cloud/projects" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (!id.success) notFound();
  const projectId = id.data.toLowerCase();
  const register = process.env.DREAM_SCENE_RESULT_BACKEND !== undefined && process.env.DREAM_PROJECT_CORE_BACKEND !== undefined;
  const select = process.env.DREAM_SCENE_SELECT_BACKEND !== undefined;
  // RECOVERY: 결과 모름 작업 보관 범위. 서버가 확인한 계정 번호(소유자 판정과 같은 값)와 프로젝트로만 만들고, 원문은 화면에 넘기지 않는다.
  const pendingScope = createHash("sha256").update(`dream-scene-pending/v1
${auth.userId}
${projectId}`).digest("hex");
  // P2-MANAGED-UI-SCENE-PAGE-CAPABILITY-COPY: 머리말은 이 화면이 실제로 여는 동작(조회·등록·선택)만 말한다. 조회가 꺼져 있으면 동작을 약속하지 않고,
  // 등록·선택은 패널 쓰기 가림(writeGate: 기획 승인 + 장면 제작 시작 전·진행 중)과 확인된 자료 조건을 함께 밝힌다. 새로 만들기·편집·렌더는 계속 내 PC 일이다.
  const readOpen = process.env.DREAM_SCENE_READ_BACKEND !== undefined;
  const work = !readOpen ? "승인된 기획의 장면별 결과를 보는 화면이에요."
    : register && select ? "승인된 기획의 장면마다 이미 있는 결과를 보고, 확인된 내 자료를 결과로 등록하거나 쓸 결과를 고를 수 있어요."
    : register ? "승인된 기획의 장면마다 이미 있는 결과를 보고, 확인된 내 자료를 결과로 등록할 수 있어요."
    : select ? "승인된 기획의 장면마다 이미 있는 결과를 보고 쓸 결과를 고를 수 있어요."
    : "승인된 기획의 장면마다 이미 있는 결과를 볼 수 있어요.";
  const action = readOpen && register && select ? "등록·선택" : readOpen && register ? "등록" : readOpen && select ? "선택" : "";
  const when = action ? ` ${action}은 기획이 승인되고 장면 제작 단계가 시작 전이거나 진행 중일 때만 돼요.` : "";
  return <>
    <p><Link href={`/cloud/projects/${projectId}`}>← 프로젝트 보기</Link></p>
    <PageHeader title="장면 결과" description={`${work}${when} 결과를 새로 만드는 장면 제작과 편집·렌더는 아직 클라우드에 연결되지 않아 내 PC 작업실에서 해 주세요.`} />
    {!readOpen
      ? <Callout tone="info" title="아직 클라우드에서는 장면 결과를 볼 수 없어요">
          지금은 장면 결과를 내 PC 작업실에서 확인해 주세요. <Link href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link>
        </Callout>
      : <ManagedScenePanel projectId={projectId} register={register} select={select} pendingScope={pendingScope} />}
  </>;
}
