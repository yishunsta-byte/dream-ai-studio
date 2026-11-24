// 공개 분석 결과 화면 브라우저 시험 진입점(서버·DB 없음, 합성 목록만). ?state=ok|empty|down|long로 상태를 고른다.
import { createRoot } from "react-dom/client";
import { PublishedAnalysisResults, type PublishedAnalysisFeed } from "../../components/reference-analysis/published-analysis-results";
import "../../app/globals.css";

const at = "2026-11-20T03:00:00.000Z";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const items = [
  { id: id(1), media: "image" as const, title: "이미지 분석 결과", summary: "이미지 소스에서 관찰 근거 1개를 측정했어요.", prompt: "푸른 색이 넓게 퍼진 장면", publishedAt: at },
  { id: id(2), media: "music" as const, title: "음악 분석 결과", summary: "음악 소스에서 추정 템포 120 BPM를 측정했어요.", prompt: "120 BPM의 경쾌한 배경 음악", publishedAt: at },
  { id: id(3), media: "video" as const, title: "영상 분석 결과 <b>굵게</b>", summary: "줄1\n줄2", prompt: "<script>window.__xss = 1</script>", publishedAt: at },
];
const long = [{ id: id(4), media: "video" as const, title: "가".repeat(80), summary: "https://example.invalid/" + "a".repeat(560),
  prompt: "긴프롬프트".repeat(400), publishedAt: at }];
const state = new URLSearchParams(window.location.search).get("state");
const feed: PublishedAnalysisFeed = state === "down" ? { kind: "unavailable" } : { kind: "ok", items: state === "empty" ? [] : state === "long" ? long : items };
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<PublishedAnalysisResults feed={feed} />);
