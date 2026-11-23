"use client";

import { useId, useState } from "react";
import { shortsIdeaPhases } from "@/lib/reference-analysis/shorts-ideas-contract";
import { requestIdeas } from "./shorts-client";
import { afterIdeas, afterSelection, selectionOf, type ShortsIdea, type ShortsSelection, type ShortsSession } from "./shorts-session";
import type { ShortsStepProps } from "./shorts-step-types";
import { Consent, Field, NeedsStep, RunningCard, RunStatus, useRun } from "./shorts-step-ui";
import s from "./shorts-studio.module.css";

// P1-08 원본 IdeaSteps.tsx(③ 소재 6개 발굴, ④ 주제 확정 + 추가 기획 요청)를 옮겼다.
// 원본의 잠재점수·예상 완청은 모델이 낸 추정값만 '모델 추정'으로 보이고, 없으면 숨긴다(지어낸 숫자 없음).
export const phaseLabels: Record<(typeof shortsIdeaPhases)[number], string> = {
  opening: "도입 · 첫 3초", setup: "설정", development: "전개", payoff: "결말 · 반전",
};

/** ④에서 고른 소재의 원래 제안(③ 목록)을 찾는다. 제목과 첫 훅이 같은 첫 제안. 없으면 null(지어내지 않음). */
export function proposalOf(ideas: readonly ShortsIdea[], selected: Pick<ShortsSelection, "title" | "openingHook">) {
  return ideas.find(idea => idea.title === selected.title && idea.openingHook === selected.openingHook) ?? null;
}

/** 모델이 낸 추정값 문구. 값이 있는 것만 잇고 끝에 '모델 추정'을 붙인다. 둘 다 없으면 null(앞뒤에 남는 구분 기호 없음).
 * short: ③ 카드 머리(원본 '잠재점수 N점 · 완청 N%'), 기본: ④ 확정 화면('잠재력 N점 · 예상 완청 N%'). */
export function estimateText(assessment: ShortsIdea["assessment"], short = false) {
  if (!assessment) return null;
  const parts = [
    assessment.potentialScore !== null && `${short ? "잠재점수" : "잠재력"} ${assessment.potentialScore}점`,
    assessment.expectedRetentionPercent !== null && `${short ? "완청" : "예상 완청"} ${assessment.expectedRetentionPercent}%`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} · 모델 추정` : null;
}

/** ③ 소재 카드의 단추: 이미 고른 소재면 결과를 지우지 않고 ④로 옮기기만 하고(keep), 다른 소재를 고를 때만 대본·프롬프트를 비운다(choose). */
export const ideaAction = (session: Pick<ShortsSession, "selected">, idea: Pick<ShortsSelection, "title" | "openingHook">): "keep" | "choose" =>
  session.selected?.title === idea.title && session.selected.openingHook === idea.openingHook ? "keep" : "choose";

export function ShortsIdeateStep({ pick, goTo, settingsHref, work, newerMulti = null }: ShortsStepProps) {
  const { session } = work;
  const id = useId();
  const [keyword, setKeyword] = useState(session.keyword || pick?.query || "");
  const state = useRun(work, "ideate");
  const context = session.context;
  if (!context) return <NeedsStep title="💡 킬러 소재 발굴" goTo={goTo} back="analyze" label="2. 바이럴 구조 해체로"
    text="먼저 ② 바이럴 구조 해체에서 영상을 분석해야 소재를 발굴할 수 있어요." />;

  // F6: 이 근거보다 나중에 묶음 분석을 했으면 옛 단건 근거로 새 소재를 만들거나 고른 소재를 저장하지 않는다.
  const blocked = newerMulti !== null;
  const ready = keyword.trim().length > 0 && work.consent && !state.running && !blocked;
  const run = () => {
    if (blocked) return;
    const sent = keyword.trim().slice(0, 100);
    void state.run(signal => requestIdeas({ keyword: sent, context }, signal),
      value => work.commit({ keyword: sent, source: value.source, ideas: value.generation.ideas, ...afterIdeas }),
      "새 소재 6개를 만들었어요. 마음에 드는 소재를 골라 주세요.");
  };

  return <div className={s.stepStack}>
    <section className={s.card} aria-labelledby={`${id}-head`}>
      <div className={s.cardHead}>
        <h3 id={`${id}-head`}>분석한 성공 공식으로 새 소재 6개</h3>
        <span className={s.cardMeta}>근거 영상 {context.videoId}</span>
      </div>
      <p className={s.readyText}>{context.summary}</p>
      {blocked && <div className={s.nextBar} role="alert">
        <p className={s.nextText}>방금 영상 {newerMulti.videoIds.length}개를 묶음으로 분석했어요. 묶음 결과는 아직 소재로 이어지지 않아서,
          그 전에 분석한 영상({context.videoId})으로 소재를 만들거나 저장하지 않도록 막았어요. 소재를 만들려면 ②에서 영상 1개를 분석해 주세요.</p>
        <button type="button" className={s.ghost} onClick={() => goTo("analyze")}>← 2. 바이럴 구조 해체로</button>
      </div>}
      <div className={s.formGrid}>
        <Field label="내 채널 키워드" hint="소재를 옮길 내 채널 주제예요. 100자까지.">
          <input className={s.input} value={keyword} maxLength={100} onChange={event => setKeyword(event.target.value)} />
        </Field>
      </div>
      <Consent work={work} disabled={state.running} />
      <div className={s.readyActions}>
        <button type="button" className={s.primary} disabled={!ready} onClick={run}>
          {state.running ? "발굴 중…" : session.ideas.length ? "소재 다시 발굴하기" : "소재 6개 발굴하기"}
        </button>
      </div>
      <RunStatus state={state} settingsHref={settingsHref} onCancel={state.cancel} />
    </section>

    {state.running && <RunningCard title="새 소재 발굴 중…" text="분석한 성공 공식으로 소재 6개를 만들고 있어요. 앞 소재는 새 결과가 오면 바뀌어요." />}
    {session.ideas.length > 0 && <ol className={s.ideaGrid} aria-label="제안된 소재" aria-busy={state.running || undefined}>
      {session.ideas.map((idea, index) => {
        const chosen = ideaAction(session, idea) === "keep";
        const head = estimateText(idea.assessment, true);
        return <li key={`${index}-${idea.title}`} className={s.ideaCard} data-chosen={chosen || undefined}>
          <div className={s.ideaHead}>
            <span className={s.ideaTag}>IDEA #{index + 1}</span>
            {head && <span className={s.cardMeta}>{head}</span>}
          </div>
          <h4 className={s.ideaTitle}>{idea.title}</h4>
          <div className={s.hookBox}>
            <span className={s.hookLabel}>⚡ 1초 킬러 훅</span>
            <p className={s.hookText}>&ldquo;{idea.openingHook}&rdquo;</p>
            <p className={s.fieldHint}>공식: {idea.hookStrategy}</p>
          </div>
          <p className={s.ideaBody}><strong>고른 이유:</strong> {idea.selectionReason}</p>
          <button type="button" className={s.primary} disabled={state.running || (blocked && !chosen)} onClick={() => {
            // 이미 고른 소재: 저장도 초기화도 없이 ④로만 옮긴다(F4). 다른 소재: 고른 소재를 바꾸고 대본·프롬프트를 비운 뒤 저장한다.
            if (!chosen) work.commit({ selected: selectionOf(idea), ...afterSelection });
            goTo("select");
          }}>{chosen ? "고른 소재 · 전략 보기 →" : "이 주제로 기획 확정 →"}</button>
        </li>;
      })}
    </ol>}
  </div>;
}

export function ShortsSelectStep({ goTo, work }: ShortsStepProps) {
  const { session } = work;
  const id = useId();
  const idea = session.selected;
  // 원본 SelectStep의 '성공 요인'과 잠재력·예상 완청: 서버가 이 소재에 준 고른 이유·모델 추정만 보인다(없으면 칸 없음).
  const proposal = idea ? proposalOf(session.ideas, idea) : null;
  const estimate = estimateText(proposal?.assessment ?? null);
  if (!idea) return <NeedsStep title="🎯 주제·전략 확정" goTo={goTo} back="ideate" label="3. 킬러 소재 발굴로"
    text="고른 소재가 없어요. ③ 킬러 소재 발굴에서 소재를 하나 골라 주세요." />;
  return <section className={s.card} aria-labelledby={`${id}-head`}>
    <div className={s.cardHead}>
      <h3 id={`${id}-head`}>{idea.title}</h3>
      {estimate && <span className={s.estimate}>{estimate}</span>}
    </div>
    <div className={s.detailGrid}>
      <div className={s.hookBox}>
        <span className={s.hookLabel}>🔥 1초 킬러 훅</span>
        <p className={s.hookText}>&ldquo;{idea.openingHook}&rdquo;</p>
      </div>
      <div className={s.hookBox}>
        <span className={s.hookLabel}>🎯 훅 · 전개 전략</span>
        <p className={s.ideaBody}>{idea.hookStrategy}</p>
      </div>
      {proposal && <div className={`${s.hookBox} ${s.detailWide}`}>
        <span className={s.hookLabel}>🧠 성공 요인 · 이 소재를 고른 이유</span>
        <p className={s.ideaBody}>{proposal.selectionReason}</p>
        {proposal.assessment && <p className={s.fieldHint}>모델 추정 근거: {proposal.assessment.rationale}</p>}
      </div>}
    </div>
    <h4 className={s.subTitle}>구간별 스토리 전개 로드맵</h4>
    <ol className={s.beatList}>
      {idea.beats.map(beat => <li key={beat.phase}><span className={s.ideaTag}>{phaseLabels[beat.phase]}</span><p>{beat.action}</p></li>)}
    </ol>
    <Field label="✍️ 추가 기획 요청 (선택)" hint="대본을 만들 때 함께 보내요. 1000자까지.">
      <textarea className={s.textarea} value={session.direction} maxLength={1000} rows={4}
        placeholder="예: 2030 직장인이 공감할 톤으로, 첫 문장은 충격적인 질문으로"
        onChange={event => work.update({ direction: event.target.value })} />
    </Field>
    <div className={s.splitActions}>
      <button type="button" className={s.inlineLink} onClick={() => goTo("ideate")}>← 다른 소재 고르기</button>
      <button type="button" className={s.primary} onClick={() => { work.commit({}); goTo("script"); }}>이 전략으로 대본 만들기 ➔</button>
    </div>
  </section>;
}
