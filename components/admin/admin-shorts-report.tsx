"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { ShortsAnalysisResult } from "@/lib/reference-analysis/shorts-analysis-contract";
import styles from "./admin-shorts-report.module.css";

// Shorts Viral Studio v1.01의 단계·리포트 화면을 지금 서버(/api/admin/shorts-analysis 단건 URL)가 주는 값만으로 옮긴다.
// 검색·지표·댓글·소재·대본·프롬프트 단계는 서버가 생길 때까지 잠근다. 근거 종류는 응답의 evidence 값으로만 표시한다.

export const SHORTS_STEPS = ["쇼츠 주소", "바이럴 분석", "소재 발굴", "주제 확정", "대본 생성", "이미지·영상 프롬프트"] as const;
const OPEN_STEPS = 2; // 지금 서버로 할 수 있는 단계 수

export function ShortsSteps({ current }: { current: 0 | 1 }) {
  const id = useId();
  return <div className={styles.stepBlock}><ol className={styles.steps} aria-label="쇼츠 분석 단계" aria-describedby={`${id}-locked`}>
    {SHORTS_STEPS.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined}
      data-state={index < OPEN_STEPS ? (index < current ? "done" : index === current ? "current" : "next") : "locked"}>
      <span className={styles.stepNo} aria-hidden="true">{index + 1}</span>
      <span>{label}{index >= OPEN_STEPS && <span className={styles.srOnly}> (준비 중)</span>}</span>
    </li>)}
  </ol>
  <p id={`${id}-locked`} className={styles.note}>{OPEN_STEPS + 1}~{SHORTS_STEPS.length}단계({SHORTS_STEPS[OPEN_STEPS]}부터)는 준비 중이에요. 서버가 연결되면 열려요.</p></div>;
}

// 근거 종류. 응답이 확인한 값만 보여 주고, 영상 직접 분석이 아닌 근거를 직접 분석처럼 쓰지 않는다.
const evidenceLabels: Record<string, { label: string; detail: string }> = {
  youtube_video: { label: "영상 직접 분석", detail: "Gemini가 공개 영상을 보고 낸 추정이에요. 공개하기 전에 원본과 대조하세요." },
  metadata: { label: "메타데이터 추정", detail: "영상을 직접 보지 않고 제목·설명 같은 정보로 추정한 내용이에요." },
};
export const evidenceLabel = (evidence: string) => evidenceLabels[evidence];

export const shortsWatchUrl = (videoId: string) => `https://www.youtube.com/shorts/${videoId}`;

/** 리포트를 Markdown으로 쓴다(복사·내려받기 공용). */
export function shortsMarkdown(videoId: string, result: ShortsAnalysisResult) {
  const { findings } = result;
  const evidence = evidenceLabel(result.evidence);
  const line = (value: string | null) => value ?? "미확인";
  return [
    "# 쇼츠 분석 리포트",
    "",
    `- 영상: ${shortsWatchUrl(videoId)}`,
    `- 근거: ${evidence ? `${evidence.label} (Gemini 추정)` : "확인되지 않은 근거"}`,
    "",
    "## 요약", findings.summary, "",
    "## 첫 장면", line(findings.hook), "",
    "## 화면 구성", line(findings.composition), "",
    "## 소리", line(findings.sound), "",
    "## 시간대별 근거",
    ...(findings.segments.length ? findings.segments.map(segment => `- ${segment.timestamp} · ${segment.evidence}`) : ["미확인"]), "",
    "## 새 영상 연출 초안", line(findings.draftPrompt), "",
  ].join("\n");
}

export function ShortsReport({ result, videoId, onPrepare }: {
  result: ShortsAnalysisResult; videoId: string; onPrepare?: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState("");
  const { findings } = result;
  const evidence = evidenceLabel(result.evidence);
  const markdown = () => shortsMarkdown(videoId, result);

  async function copy() {
    try { await navigator.clipboard.writeText(markdown()); setStatus("리포트를 Markdown으로 복사했어요."); }
    catch { setStatus("복사하지 못했어요. 내려받기를 써 주세요."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `shorts-analysis-${videoId}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus(`shorts-analysis-${videoId}.md 파일로 내려받았어요.`);
  }
  const card = (title: string, value: string | null) => <section className={styles.card} aria-label={title}>
    <h5>{title}</h5>
    {value ? <p>{value}</p> : <p className={styles.note}>영상에서 확인하지 못했어요.</p>}
  </section>;

  return <div className={styles.report} aria-labelledby={`${id}-title`}>
    <section className={styles.target} aria-label="분석한 영상">
      <div>
        <h4 id={`${id}-title`}>분석한 영상</h4>
        <p className={styles.mono}>{videoId}</p>
      </div>
      {evidence && <p className={styles.evidence}><span className={styles.badge}>{evidence.label}</span> {evidence.detail}</p>}
      <a className={styles.open} href={shortsWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">YouTube에서 열기<span className={styles.srOnly}> (새 창)</span></a>
    </section>
    <section className={styles.card} aria-label="요약">
      <h5>요약</h5>
      <p>{findings.summary}</p>
    </section>
    <div className={styles.grid}>
      {card("첫 장면", findings.hook)}
      {card("화면 구성", findings.composition)}
      {card("소리", findings.sound)}
    </div>
    <section className={styles.card} aria-label="시간대별 근거">
      <h5>시간대별 근거</h5>
      {findings.segments.length ? <ol className={styles.timeline}>
        {findings.segments.map((segment, index) => <li key={`${segment.timestamp}-${index}`}>
          <span className={styles.mono}>{segment.timestamp}</span><p>{segment.evidence}</p>
        </li>)}
      </ol> : <p className={styles.note}>영상에서 확인하지 못했어요.</p>}
    </section>
    {card("새 영상 연출 초안", findings.draftPrompt)}
    <div className={styles.actions}>
      <Button type="button" variant="secondary" onClick={() => void copy()}>Markdown 복사</Button>
      <Button type="button" variant="secondary" onClick={download}>Markdown 내려받기</Button>
      {onPrepare && <Button type="button" variant="secondary" onClick={onPrepare}>공개 준비</Button>}
    </div>
    <p role="status" className={styles.note}>{status}</p>
  </div>;
}
