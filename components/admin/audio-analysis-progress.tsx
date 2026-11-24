"use client";

// 주인님 지시(2026-11-24): 오디오 분석 중에는 아래에 움직이는 진행 막대와 지난 시간을 보여, 진행 중인지 멈췄는지 알 수 있게 한다.
// Gemini는 결과를 한 번에 돌려줘서 실제 진행률(%)을 알 수 없다. 그래서 막대는 퍼센트가 아니라 '응답을 기다리는 중'을 뜻하고,
// 1초마다 늘어나는 지난 시간을 보여 준다. 분석이 끝나거나 취소되면 이 부품이 사라진다.
// Master 검수(msg_986646bfd449): 모델 대기(120·200초)는 본문 읽기·형식 검사·큰 파일 준비를 뺀 구간 예산이라 전체 최대가 아니다.
// 경로 함수 한도(300초)도 브라우저가 그 안에 결과를 본다는 보장은 아니다(msg_c7843cd0e75d). 그래서 시간 약속 문구는 쓰지 않고,
// 지난 시간과 진행 상태만 보인다. 함수 한도를 넘기면 오래 걸린다는 사실만 알린다.
import { useEffect, useState } from "react";
import styles from "./audio-analysis-progress.module.css";

// 오디오 분석 경로(바로 분석·음악·큰 파일)의 함수 한도(시험으로 경로 maxDuration과 고정). 넘기면 '오래 걸리고 있어요'만 덧붙인다.
export const audioRouteLimitSeconds = 300;

export const elapsedLabel = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;

export function AudioAnalysisProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // 탭이 뒤로 가 타이머가 늦게 돌아도 시작 시각 기준으로 계산해 지난 시간이 틀리지 않는다.
    const start = performance.now();
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const over = elapsed >= audioRouteLimitSeconds;
  return <div className={styles.wrap}>
    <div className={styles.track} role="progressbar" aria-label="분석 진행 중" aria-valuetext={`${elapsedLabel(elapsed)} 지남`}>
      <span className={styles.bar} />
    </div>
    <p className={styles.time}>
      {`${elapsedLabel(elapsed)} 지남 · 분석 진행 중이에요.`}{over ? " 평소보다 오래 걸리고 있어요." : ""}
    </p>
  </div>;
}
