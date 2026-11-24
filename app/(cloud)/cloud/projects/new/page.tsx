import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Callout, PageHeader } from "@/components/ui/primitives";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

export const metadata: Metadata = { title: "새 프로젝트 · Dream AI Studio" };

export default async function CloudProjectCreatePendingPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: "/cloud/projects/new" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (auth.kind === "local") return <CloudReadLocal title="새 프로젝트" />;
  if (localProjectFormEnabled()) {
    const { PrivatePngProjectPage } = await import("@/components/cloud/private-png-project-page");
    return <PrivatePngProjectPage />;
  }
  return <>
    <p><Link href="/cloud/projects">← 내 프로젝트</Link></p>
    <PageHeader title="새 프로젝트" description="클라우드에서 새 프로젝트를 만드는 기능을 준비하고 있어요." />
    <Callout tone="info" title="아직 클라우드에서는 새 프로젝트를 만들 수 없어요">
      새 프로젝트에는 제품 사진이나 영상 자료가 필요해요. 클라우드에 자료를 올릴 수 있게 되면 여기에서 바로 만들 수 있어요.
      그동안 이미 옮긴 프로젝트는 <Link href="/cloud/projects">내 프로젝트</Link>에서 볼 수 있어요.
    </Callout>
  </>;
}
