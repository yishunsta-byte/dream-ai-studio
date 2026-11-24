import { Callout } from "@/components/ui/primitives";
import { AccountMenu } from "./account-menu";
import { ProtectedContent, SessionBoundary } from "./session-boundary";
import styles from "./login.module.css";

// Vercel(클라우드)에서 저장소 이전 전까지 보여 주는 화면. 로그인은 됐지만 작업실은 아직 열 수 없다는 것을 정직하게 알린다.
export function CloudPending({ account }: { account: string | null }) {
  return <main id="main-content" className={styles.page}>
    <div className={styles.panel}>
      <div className={styles.brand}><span className={styles.logo} aria-hidden="true">D</span><div><strong>Dream AI Studio</strong><span>나만의 콘텐츠 작업실</span></div></div>
      <h1 className={styles.title}>클라우드 작업실을 준비하고 있어요</h1>
      {/* T-220: 계정 확인 전·변경 뒤에는 "로그인 정상" 문구와 안내를 가리고 확인 안내만 둔다. */}
      <SessionBoundary account={account}><ProtectedContent>
      {account && <p className={styles.lead}>로그인은 정상적으로 됐어요.</p>}
      <Callout tone="info" title="작업실 기능은 아직 클라우드로 옮기지 않았어요">작품·자료·영상·작업 기록은 아직 내 PC 작업실에만 있어요. 클라우드 저장소로 옮기는 작업이 끝나면 이 주소에서 바로 작업할 수 있어요. 그동안은 내 PC 작업실에서 계속해 주세요.</Callout>
      </ProtectedContent>
      {account && <div className={styles.pendingAccount}><AccountMenu email={account} /></div>}
      </SessionBoundary>
    </div>
  </main>;
}
