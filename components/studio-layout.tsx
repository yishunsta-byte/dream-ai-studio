import type { ReactNode } from "react";
import { getMenuConfig } from "@/lib/menus/server";
import { checkStartup } from "@/lib/services/startup";
import { currentAccountEmail } from "@/lib/auth/render";
import { SetupReport } from "./setup-report";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
import { StudioShell } from "./studio-shell";

export async function StudioLayout({ children }: { children: ReactNode }) {
  // 클라우드·postgres·알 수 없는 설정이면 이 PC 저장소 점검(checkStartup)·메뉴 읽기 전에 준비 중 화면을 돌려준다(T-200).
  // 같은 판별을 각 페이지 입구도 한다(레이아웃과 페이지는 함께 그려지므로). 인증은 getRenderAuth로 1번만.
  const blocked = await legacyPageGate();
  if (blocked) return blocked;
  const config = getMenuConfig();
  const account = await currentAccountEmail();
  // 저장 폴더·DB를 쓸 수 없으면 작업실을 열지 않는다(이전에는 루트 레이아웃에서 하던 점검).
  const health = checkStartup();
  if (!health.canStart) return <main id="main-content" className="content"><SetupReport {...health} /></main>;
  return <StudioShell navigation={{groups:config.groups,menus:config.menus.map(({id,label,group,phase,availability})=>({id,label,group,phase,availability})),workspaces:config.workspaces.map(({id,label})=>({id,label}))}} sampleMode={process.env.MOCK_MODE !== "false"} account={account}>{children}</StudioShell>;
}
