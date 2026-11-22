import type { ReactNode } from "react";
import { AccountMenu } from "@/components/auth/account-menu";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ProtectedContent, SessionBoundary } from "@/components/auth/session-boundary";
import { currentAccountEmail } from "@/lib/auth/render";
import styles from "./cloud.module.css";

// 클라우드 읽기 전용 화면 레이아웃(T-207). StudioLayout(메뉴·시작 점검·SQLite)을 거치지 않는다.
// 루트 레이아웃은 그대로 상속한다(정적 menus.json 설정 확인은 루트에서 일어남).
export const dynamic = "force-dynamic";

export default async function CloudLayout({ children }: { children: ReactNode }) {
  const account = await currentAccountEmail();
  // T-220: 계정 표시와 보호 본문이 같은 세션 경계를 본다(계정 확인 전·변경 확정 뒤 본문 차단).
  return <SessionBoundary account={account}>
    <header className={styles.header}>
      <strong className={styles.brand}><BrandLogo /><span className="muted">· 클라우드 보기</span></strong>
      {account && <AccountMenu email={account} />}
    </header>
    <main id="main-content" className="content"><ProtectedContent>{children}</ProtectedContent></main>
  </SessionBoundary>;
}
