import type { ReactNode } from "react";
import { getMenuConfig } from "@/lib/menus/server";
import { checkStartup } from "@/lib/services/startup";
import { currentAccountEmail } from "@/lib/auth/render";
import { SetupReport } from "./setup-report";
import { CloudPending } from "./auth/cloud-pending";
import { StudioShell } from "./studio-shell";

export async function StudioLayout({ children }: { children: ReactNode }) {
  const config = getMenuConfig();
  const account = await currentAccountEmail();
  // 저장 폴더·DB를 쓸 수 없으면 작업실을 열지 않는다(이전에는 루트 레이아웃에서 하던 점검).
  const health = checkStartup();
  if (!health.canStart) {
    // Vercel에는 이 PC의 저장 폴더가 없다. 데이터를 클라우드로 옮기기 전까지는 준비 중 안내를 보여 준다.
    if (process.env.VERCEL) return <CloudPending account={account} />;
    return <main id="main-content" className="content"><SetupReport {...health} /></main>;
  }
  return <StudioShell navigation={{groups:config.groups,menus:config.menus.map(({id,label,group,phase,availability})=>({id,label,group,phase,availability})),workspaces:config.workspaces.map(({id,label})=>({id,label}))}} sampleMode={process.env.MOCK_MODE !== "false"} account={account}>{children}</StudioShell>;
}
