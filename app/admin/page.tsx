import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/auth/account-menu";
import { ProtectedContent, SessionBoundary } from "@/components/auth/session-boundary";
import { AdminHub } from "@/components/admin/admin-hub";
import { AdminLocalNotice } from "@/components/admin/admin-local-notice";
import styles from "@/components/admin/admin.module.css";
import { adminLoginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";

// 관리 허브(T-243). proxy가 먼저 막고, 화면도 그리기 전에 서버에서 다시 판정한다(getUser + 허용 이메일).
// 확인된 계정이 아니면 어떤 관리 정보도 읽거나 그리지 않는다.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "관리 화면 · Dream AI Studio", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const auth = await getRenderAuth();
  if (auth.kind === "local") return <AdminLocalNotice />;
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(adminLoginPath({ next: "/admin" }));
    redirect(adminLoginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  const account = auth.email;
  return <SessionBoundary account={account}>
    <header className={styles.header}>
      <strong><Link className={styles.link} href="/admin">Dream AI Studio <span className="muted">· 관리</span></Link></strong>
      <AccountMenu email={account} />
    </header>
    <main id="main-content" className="content"><ProtectedContent><AdminHub email={account} /></ProtectedContent></main>
  </SessionBoundary>;
}
