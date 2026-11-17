import type { ReactNode } from "react";
import { AccountMenu } from "@/components/auth/account-menu";
import { currentAccountEmail } from "@/lib/auth/render";
import styles from "./cloud.module.css";

// 클라우드 읽기 전용 화면 레이아웃(T-207). StudioLayout(메뉴·시작 점검·SQLite)을 거치지 않는다.
// 루트 레이아웃은 그대로 상속한다(정적 menus.json 설정 확인은 루트에서 일어남).
export const dynamic = "force-dynamic";

export default async function CloudLayout({ children }: { children: ReactNode }) {
  const account = await currentAccountEmail();
  return <>
    <header className={styles.header}>
      <strong>Dream AI Studio <span className="muted">· 클라우드 보기</span></strong>
      {account && <AccountMenu email={account} />}
    </header>
    <main id="main-content" className="content">{children}</main>
  </>;
}
