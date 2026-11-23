"use client";

import type { ComponentType } from "react";
import { SHORTS_FLOW, type ShortsStepId, type ShortsView } from "./shorts-paths";
import { ShortsIdeateStep, ShortsSelectStep } from "./shorts-step-ideate";
import { ShortsPromptsStep } from "./shorts-step-prompts";
import { ShortsScriptStep } from "./shorts-step-script";
import { ShortsAnalyzeStep, ShortsSearchStep } from "./shorts-step-search";
import { ShortsVaultStep } from "./shorts-step-vault";
import type { ShortsStepProps } from "./shorts-step-types";
import s from "./shorts-studio.module.css";

// P1-08 원본 쇼츠 단계별 화면 표. 셸은 이 표에서 지금 단계의 화면을 꺼내 그린다.
// 값이 null인 단계는 셸이 원본 단계 설명과 '실행 준비 중' 상태(ShortsReadyStep)를 대신 그린다.
// P1-08-SHORTS-STEPS: ③ 소재·④ 전략·⑤ 대본·⑥ 프롬프트·보관함을 연결했다(ShortsStepProps의 work로 단계 사이 상태를 넘김).
export type ShortsScreenView = Exclude<ShortsView, "home">;
export const shortsStepScreens: Record<ShortsScreenView, ComponentType<ShortsStepProps> | null> = {
  search: ShortsSearchStep,
  analyze: ShortsAnalyzeStep,
  ideate: ShortsIdeateStep,
  select: ShortsSelectStep,
  script: ShortsScriptStep,
  prompts: ShortsPromptsStep,
  vault: ShortsVaultStep,
};

/** 서버가 아직 없는 단계의 원본 근거(원본 IdeaSteps·ScriptStep·PromptsStep·VaultPanel의 역할)와 필요한 앞 단계. */
const READY: Record<Exclude<ShortsScreenView, "search" | "analyze">, { does: string; needs: string; back: ShortsView }> = {
  ideate: { does: "② 분석에서 찾은 바이럴 공식을 내 채널에 맞게 옮겨 새 소재 6종을 제안해요.", needs: "② 바이럴 구조 해체 결과", back: "analyze" },
  select: { does: "고른 소재의 타깃 시청층과 첫 3초 훅·전개 전략을 확정해요. 확정해야 대본 단계가 열려요.", needs: "③ 킬러 소재 발굴에서 고른 소재", back: "ideate" },
  script: { does: "15·30·60초 중 길이를 골라 씬마다 한 문장 원칙으로 나레이션 대본을 만들어요.", needs: "④ 주제·전략 확정 결과", back: "select" },
  prompts: { does: "대본의 장면마다 9:16 이미지·영상 프롬프트를 만들어 복사하거나 내려받아요.", needs: "⑤ 대본", back: "script" },
  vault: { does: "저장한 프롬프트 세트를 다시 열고 복사하거나 Markdown으로 내려받아요.", needs: "⑥ 9:16 비주얼 프롬프트에서 저장한 세트", back: "prompts" },
};

export function ShortsReadyStep({ view, goTo }: { view: Exclude<ShortsScreenView, "search" | "analyze">; goTo: (view: ShortsView) => void }) {
  const ready = READY[view];
  const flow = SHORTS_FLOW.find(item => item.id === (view as ShortsStepId));
  const back = SHORTS_FLOW.find(item => item.id === ready.back);
  return <section className={s.card} aria-labelledby={`shorts-ready-${view}`} data-ready={view}>
    <div className={s.cardHead}>
      <h3 id={`shorts-ready-${view}`}>{flow ? `${flow.icon} ${flow.label}` : "📚 프롬프트 보관함"}</h3>
      <span className={s.readyBadge}>실행 준비 중</span>
    </div>
    <p className={s.readyText}>{ready.does}</p>
    <dl className={s.readyList}>
      <div><dt>필요한 앞 단계</dt><dd>{ready.needs}</dd></div>
      <div><dt>지금 상태</dt><dd>이 단계의 서버가 아직 연결되지 않아 실행할 수 없어요. 연결되면 이 자리에서 바로 실행돼요.</dd></div>
    </dl>
    <div className={s.readyActions}>
      <button type="button" className={s.primary} disabled aria-describedby={`shorts-ready-${view}-why`}>{flow ? `${flow.label} 실행` : "보관함 열기"}</button>
      <span id={`shorts-ready-${view}-why`} className={s.readyWhy}>서버 연결 전이라 눌러도 실행되지 않아요.</span>
      {back && <button type="button" className={s.ghost} onClick={() => goTo(back.id)}>← {back.step}. {back.label}</button>}
    </div>
  </section>;
}
