import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Callout, PageHeader } from "@/components/ui/primitives";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { ManagedProjectForm } from "@/components/cloud/managed-project-form";
import menusJson from "@/docs/spec/menus.json";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

export const metadata: Metadata = { title: "새 프로젝트 · Dream AI Studio" };

// 클라우드 새 프로젝트(T-219 → P1-02). 인증 판정 뒤, 생성 경로(POST /api/projects)가 관리형 저장소로 가는 조건
// (DREAM_PROJECT_CORE_BACKEND 지정)일 때만 생성 폼을 연다. 아니면 예전 준비 안내 그대로(입력 폼·제출 없음).
// 이 페이지는 DB·업무 파일을 읽지 않는다. 메뉴 설정은 정적으로 묶어(배포 묶음 누락 없음) 같은 검사로 읽는다.
// 저장소 연결이 틀렸으면 자료 목록·생성이 503으로 답하고, 폼은 제출을 막거나 저장 완료로 말하지 않는다.
// 폼은 확인된 자료 목록·생성·브리프를 같은 출처 HTTP로만 다룬다. 거절은 목록과 같은 로그인 이동 정책을 따른다.
export default async function CloudProjectCreatePendingPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: "/cloud/projects/new" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (auth.kind === "local") return <CloudReadLocal title="새 프로젝트" />;
  const config = process.env.DREAM_PROJECT_CORE_BACKEND !== undefined ? parseMenuConfig(JSON.stringify(menusJson)) : undefined;
  const menu = config?.ok ? config.config.menus.find(item => item.id === "shopping-shorts" && item.availability === "active") : undefined;
  if (config?.ok && menu) return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="새 프로젝트" description="쇼핑숏츠 프로젝트를 만들고 브리프를 확인해요." />
    <ManagedProjectForm snapshot={snapshotForMenu(config.config, menu)} />
  </>;
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="새 프로젝트" description="클라우드에서 새 프로젝트를 만드는 기능을 준비하고 있어요." />
    <Callout tone="info" title="아직 클라우드에서는 새 프로젝트를 만들 수 없어요">
      새 프로젝트에는 제품 사진이나 영상 자료가 필요해요. 클라우드에 자료를 올릴 수 있게 되면 여기에서 바로 만들 수 있어요.
      그동안 이미 옮긴 프로젝트는 <Link href="/cloud/projects">내 프로젝트</Link>에서 볼 수 있어요.
    </Callout>
  </>;
}
