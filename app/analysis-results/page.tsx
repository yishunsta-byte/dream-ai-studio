import type { Metadata } from "next";
import { PublishedAnalysisResults } from "@/components/reference-analysis/published-analysis-results";
import { listPublishedReferenceAnalyses } from "@/lib/reference-analysis/admin-reference-publications";

// 공개 분석 결과. 요청마다 서버에서 공개 승인된 결과만 새로 읽는다(캐시 없음).
// 화면에는 승인된 필드(제목·요약·생성 프롬프트·매체·공개 시각)만 넘긴다. 저장소 미연결·실패는 안내만 보인다.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
  title: "콘텐츠 분석 결과 · DREAM SCREEN",
  description: "이미지·음악·영상 소스를 분석해 공개 승인한 결과와 생성 프롬프트예요.",
};

export default async function AnalysisResultsPage() {
  let feed: Awaited<ReturnType<typeof listPublishedReferenceAnalyses>>;
  try { feed = await listPublishedReferenceAnalyses(); } catch { feed = { kind: "unavailable" }; }
  if (feed.kind !== "ok") return <PublishedAnalysisResults feed={{ kind: "unavailable" }} />;
  const items = feed.items.filter((item) => item.status === "published")
    .map(({ id, title, summary, prompt, media, publishedAt }) => ({ id, title, summary, prompt, media, publishedAt }));
  return <PublishedAnalysisResults feed={{ kind: "ok", items }} />;
}
