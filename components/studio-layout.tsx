import type { ReactNode } from "react";
import { getMenuConfigState } from "@/lib/menus/server";
import { checkStartup } from "@/lib/services/startup";
import { currentAccountEmail } from "@/lib/auth/render";
import { SetupReport } from "./setup-report";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
import { StudioShell } from "./studio-shell";
import { SessionBoundary } from "./auth/session-boundary";

export async function StudioLayout({ children }: { children: ReactNode }) {
  // 클라우드·postgres·알 수 없는 설정이면 이 PC 저장소 점검(checkStartup)·메뉴 읽기 전에 준비 중 화면을 돌려준다(T-200).
  // 같은 판별을 각 페이지 입구도 한다(레이아웃과 페이지는 함께 그려지므로). 인증은 getRenderAuth로 1번만.
  const blocked = await legacyPageGate();
  if (blocked) return blocked;
  // 메뉴 설정 검증(T-241에서 루트 레이아웃에서 옮김): 설정이 깨졌으면 작업실을 열지 않고 고칠 항목을 보여 준다.
  // 공개 메인·로그인 화면은 이 레이아웃을 쓰지 않으므로 설정 항목이 그쪽에 나오지 않는다.
  const state = getMenuConfigState();
  if (!state.ok) {
    return (
      <main id="main-content" className="content">
        <h1>메뉴 설정을 확인해 주세요</h1>
        <p>설정 오류로 작업실을 시작할 수 없습니다. 아래 항목을 수정한 뒤 서버를 다시 시작해 주세요.</p>
        <ul style={{ overflowWrap: "anywhere" }}>{state.issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul>
      </main>
    );
  }
  const config = structuredClone(state.config);
  const account = await currentAccountEmail();
  // 저장 폴더·DB를 쓸 수 없으면 작업실을 열지 않는다(이전에는 루트 레이아웃에서 하던 점검).
  const health = checkStartup();
  if (!health.canStart) return <main id="main-content" className="content"><SetupReport {...health} /></main>;
  // T-220: 계정 표시·작업 수·본문이 같은 세션 경계를 본다.
  return <SessionBoundary account={account}><StudioShell navigation={{groups:config.groups,menus:config.menus.map(({id,label,group,phase,availability})=>({id,label,group,phase,availability})),workspaces:config.workspaces.map(({id,label})=>({id,label}))}} sampleMode={process.env.MOCK_MODE !== "false"} account={account}>{children}</StudioShell></SessionBoundary>;
}
