"use client";

// 주인님 지시(2026-11-24): 오디오 분석 중에는 아래에 움직이는 진행 막대와 지난 시간을 보여, 진행 중인지 멈췄는지 알 수 있게 한다.
// Gemini는 결과를 한 번에 돌려줘서 실제 진행률(%)을 알 수 없다. 그래서 막대는 퍼센트가 아니라 '응답을 기다리는 중'을 뜻하고,
// 1초마다 늘어나는 지난 시간을 보여 준다. 분석이 끝나거나 취소되면 이 부품이 사라진다.
// Master 검수(msg_986646bfd449): 모델 대기(120·200초)는 본문 읽기·형식 검사·큰 파일 준비를 뺀 구간 예산이라 전체 최대가 아니다.
// 그래서 숫자는 실제 상한인 경로 함수 한도(300초)만 쓴다.
import { useEffect, useState } from "react";
import styles from "./audio-analysis-progress.module.css";

// 오디오 분석 경로(바로 분석·음악·큰 파일)의 함수 한도. 이 시간 안에 결과나 안내가 반드시 돌아온다(시험으로 경로 maxDuration과 고정).
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
      {over ? `${elapsedLabel(elapsed)} 지남 · 서버 응답을 마무리하고 있어요. 곧 결과나 안내가 나와요.`
        : `${elapsedLabel(elapsed)} 지남 · 막대가 움직이면 분석이 진행 중이에요. 늦어도 ${elapsedLabel(audioRouteLimitSeconds)} 안에 결과나 안내가 나와요.`}
    </p>
  </div>;
}
