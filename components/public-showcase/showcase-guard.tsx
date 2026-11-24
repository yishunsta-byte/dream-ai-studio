// T-255-F2/F3 공개 홈 철회 가드 마크업(서버 컴포넌트, 클라이언트 번들 없음). 동작 규칙은 lib/public-showcase/showcase-guard-runtime.ts.
// 검수 F1-R: 앱 번들이 실패한 홈은 React 효과 가드가 없어 bfcache 복원 때 철회 카드가 다시 보였다.
// 검수 F2-R: 인라인 스크립트와 인라인 숨김 스타일이 CSP로 함께 막히면 승인 카드가 가드 없이 보였다.
// 그래서 초기 숨김은 스타일이 아니라 HTML `hidden` 속성으로 한다(CSS·CSP와 무관). 드러내기는 가드가 설치된 뒤에만 한다.
//   순서: 가드 스크립트 → 대체 안내(id=showcase-fallback) → 승인 영역(id=showcase-gated, hidden) → 드러내기 스크립트.
import { SHOWCASE_FALLBACK_ID, SHOWCASE_GATED_ID, SHOWCASE_GUARD_JS, SHOWCASE_REVEAL_JS } from "@/lib/public-showcase/showcase-guard-runtime";
import type { ReactNode } from "react";
import styles from "./neon-showcase.module.css";

export function ShowcaseGuard() {
  return <script dangerouslySetInnerHTML={{ __html: SHOWCASE_GUARD_JS }} />;
}

// 승인 작품 영역. 가드가 드러내기 전까지 hidden(렌더·접근성 트리 제외).
export function ShowcaseGated({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <div id={SHOWCASE_GATED_ID} hidden>{children}</div>
      <script dangerouslySetInnerHTML={{ __html: SHOWCASE_REVEAL_JS }} />
    </>
  );
}

// 가드가 없는 문서(스크립트 꺼짐·인라인 차단+번들 실패)에서 보이는 안내. CSS가 없어도 일반 링크로 동작한다. 승인 작품은 담지 않고 로그인 탐색만 둔다.
export function ShowcaseScriptFallback({ loginHref, adminHref = "/admin/login" }: Readonly<{ loginHref: string; adminHref?: string }>) {
  return (
    <div className={styles.root} id={SHOWCASE_FALLBACK_ID}>
      <header className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 의도한 전체 문서 이동(T-255-F1) */}
        <a className={styles.brand} href="/" aria-label="Dream SCREEN 처음 화면">
          <span className={styles.brandSymbol} aria-hidden="true">✦</span>DREAM <em>SCREEN</em>
        </a>
        <a className={`${styles.btn} ${styles.primary}`} href={loginHref}>크리에이터 로그인</a>
      </header>
      <main className={styles.page}>
        <div className={styles.empty}>
          <h1>공개 작품을 보여 드릴 수 없어요</h1>
          <p>이 브라우저에서 스크립트가 꺼져 있거나 실행되지 않았어요. 스크립트를 켠 뒤 새로고침해 주세요.</p>
        </div>
        <footer className={styles.footer}>
          <p>DREAM · PUBLIC SHOWCASE</p>
          <div className={styles.footerLinks}>
            <a className={styles.link} href={loginHref}>크리에이터 로그인 ↗</a>
            <a className={`${styles.link} ${styles.adminLink}`} href={adminHref}>관리자 로그인</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
