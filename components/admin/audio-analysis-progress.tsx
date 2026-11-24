"use client";

// 주인님 지시(2026-11-24): 오디오 분석 중에는 아래에 움직이는 진행 막대와 지난 시간을 보여, 진행 중인지 멈췄는지 알 수 있게 한다.
// Gemini는 결과를 한 번에 돌려줘서 실제 진행률(%)을 알 수 없다. 그래서 막대는 퍼센트가 아니라 '응답을 기다리는 중'을 뜻하고,
// 1초마다 늘어나는 지난 시간과 서버가 기다리는 최대 시간을 함께 보여 준다. 분석이 끝나거나 취소되면 이 부품이 사라진다.
import { useEffect, useState } from "react";
import styles from "./audio-analysis-progress.module.css";

// 서버가 모델 응답을 기다리는 최대 시간(admin-audio-details-server·admin-audio-gemini와 같은 값, 시험으로 고정).
export const audioWaitSeconds = { basic: 120, detailed: 200 } as const;
// 큰 파일은 Gemini가 올린 파일을 준비하는 시간(최대 50초)을 더 기다린다.
export const largeFilePreparationSeconds = 50;

export const elapsedLabel = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;

export function AudioAnalysisProgress({ limitSeconds }: { limitSeconds: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // 탭이 뒤로 가 타이머가 늦게 돌아도 시작 시각 기준으로 계산해 지난 시간이 틀리지 않는다.
    const start = performance.now();
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const over = elapsed > limitSeconds;
  return <div className={styles.wrap}>
    <div className={styles.track} role="progressbar" aria-label="분석 진행 중" aria-valuetext={`${elapsedLabel(elapsed)} 지남`}>
      <span className={styles.bar} />
    </div>
    <p className={styles.time}>
      {over ? `${elapsedLabel(elapsed)} 지남 · 서버 응답을 기다리고 있어요. 곧 결과나 안내가 나와요.`
        : `${elapsedLabel(elapsed)} 지남 · 최대 ${elapsedLabel(limitSeconds)}까지 기다려요. 막대가 움직이면 분석이 진행 중이에요.`}
    </p>
  </div>;
}
