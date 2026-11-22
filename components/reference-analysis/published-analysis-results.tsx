import { MEDIA_LABEL, formatPublishedAt, type AnalysisMedia } from "@/components/admin/admin-reference-analysis-model";
import { BrandLogo } from "@/components/ui/brand-logo";
import styles from "./published-analysis-results.module.css";

// 공개 분석 결과(/analysis-results). 관리자가 공개 승인한 필드(제목·요약·생성 프롬프트·매체·공개 시각)만 평문으로 그린다.
// 원본 주소·계정·측정 원값·내부 오류는 받지도 그리지도 않는다. 링크·HTML로 해석하지 않는다(React 텍스트 노드).
export type PublishedAnalysisItem = Readonly<{ id: string; title: string; summary: string; prompt: string; media: AnalysisMedia; publishedAt: string }>;
export type PublishedAnalysisFeed = Readonly<{ kind: "ok"; items: readonly PublishedAnalysisItem[] }> | Readonly<{ kind: "unavailable" }>;

export function PublishedAnalysisResults({ feed }: { feed: PublishedAnalysisFeed }) {
  return <main id="main-content" className={styles.page}>
    <header className={styles.header}>
      {/* 공개 홈은 항상 새 문서로 연다(T-255-F1, 철회 가드). */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 의도한 전체 문서 이동 */}
      <a className={styles.brand} href="/"><BrandLogo /></a>
      <h1>콘텐츠 분석 결과</h1>
      <p className={styles.lead}>이미지·음악·영상 소스를 분석해 공개 승인한 결과와 생성 프롬프트예요.</p>
    </header>
    {feed.kind === "unavailable"
      ? <section className={styles.notice} role="status"><h2>지금은 결과를 불러올 수 없어요</h2><p>잠시 뒤 다시 열어 주세요.</p></section>
      : feed.items.length === 0
        ? <section className={styles.notice} role="status"><h2>아직 공개된 분석 결과가 없어요</h2><p>공개 승인된 결과가 생기면 여기에 보여요.</p></section>
        : <ul className={styles.list} aria-label={`공개 분석 결과 ${feed.items.length}개`}>
          {feed.items.map((item) => {
            const at = formatPublishedAt(item.publishedAt);
            return <li key={item.id}>
              <article className={styles.card} aria-labelledby={`result-${item.id}`}>
                <p className={styles.meta}><span className={styles.media}>{MEDIA_LABEL[item.media]}</span>{at && <time dateTime={item.publishedAt}>{at}</time>}</p>
                <h2 id={`result-${item.id}`}>{item.title}</h2>
                <p className={styles.plain}>{item.summary}</p>
                <section className={styles.prompt} aria-label="생성 프롬프트">
                  <h3>생성 프롬프트</h3>
                  <p className={styles.plain}>{item.prompt}</p>
                </section>
              </article>
            </li>;
          })}
        </ul>}
  </main>;
}
