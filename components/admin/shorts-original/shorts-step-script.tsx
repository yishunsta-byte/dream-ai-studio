"use client";

import { useId, useRef, useState } from "react";
import { shortsScriptDurationSec, shortsScriptRequest } from "@/lib/reference-analysis/shorts-script-contract";
import { copyText, downloadText, requestScript } from "./shorts-client";
import { fileName, scriptMarkdown, timecode, type ShortsScript, type ShortsScriptConfig } from "./shorts-session";
import type { ShortsStepProps } from "./shorts-step-types";
import { Consent, CopyButton, Field, NeedsStep, RunningCard, RunStatus, useRun } from "./shorts-step-ui";
import s from "./shorts-studio.module.css";

// P1-08 원본 ScriptStep.tsx: 길이(10~180초, 15·30·60 바로 고르기)·나레이션 톤·타깃 → 씬별 1문장 나레이션 대본.
// 문구는 직접 고칠 수 있고(칸을 벗어나면 저장), 수정 요청은 이전 초안과 함께 보내 새 초안을 받는다(서버 revision).
export const SHORTS_TONES = [
  "몰입감 있고 긴박한 (Urgent & Suspenseful)",
  "도발적이고 충격적인 (Provocative & Shocking)",
  "친근하고 재치있는 (Friendly & Witty)",
  "전문적이고 신뢰감 있는 (Authoritative & Deep)",
  "감성적이고 서정적인 (Emotional & Storytelling)",
  "빠르고 에너지 넘치는 (High-energy & Hype)",
  "냉소적이고 현실적인 (Cynical & Raw)",
] as const;
const QUICK = [15, 30, 60] as const;
const LIMITS = { narration: 180, visual: 400, caption: 120 } as const;

/** 초당 약 6자 기준 말하기 길이 어림값(원본과 같음). */
export function speechSeconds(narrations: readonly string[]) {
  return Math.round(narrations.reduce((sum, text) => sum + text.replace(/\s/g, "").length, 0) / 6);
}

/** 어림 길이가 목표보다 15% 넘게 길면 줄이라고 알린다(원본 speechEstimate.totalSpeech().over와 같은 기준). 표시만 하고 생성·저장 검사는 바꾸지 않는다. */
export function speechOver(seconds: number, targetSec: number) {
  return targetSec > 0 && seconds > targetSec * 1.15;
}

/** F9: 화면에서 고친 길이·톤·타깃 중 계약에 맞는 설정만 작업 상태에 남길 값으로 바꾼다(맞지 않으면 null → 앞 값 유지).
 * 빈 타깃은 빼고, ④ 추가 기획 요청(direction)은 따로 들고 다니므로 넣지 않는다. 저장은 다음 단계 완료 때 함께 된다. */
export function draftConfig(config: ShortsScriptConfig): ShortsScriptConfig | null {
  const checked = shortsScriptRequest.shape.config.safeParse({
    durationSec: config.durationSec, tone: config.tone.trim(), ...(config.target?.trim() && { target: config.target.trim() }),
  });
  return checked.success ? checked.data : null;
}

export function ShortsScriptStep({ goTo, settingsHref, work }: ShortsStepProps) {
  const { session } = work;
  const id = useId();
  const state = useRun(work, "script");
  const [config, setLocalConfig] = useState<ShortsScriptConfig>(session.scriptConfig ?? { durationSec: 30, tone: SHORTS_TONES[0] });
  // 설정을 고칠 때마다 맞는 값이면 작업 상태에도 남긴다: 단계를 옮기거나 새로 분석하거나 생성이 실패해도 설정이 그대로다.
  const setConfig = (next: ShortsScriptConfig) => {
    setLocalConfig(next);
    const draft = draftConfig(next);
    if (draft) work.update({ scriptConfig: draft });
  };
  const [custom, setCustom] = useState(!SHORTS_TONES.includes(config.tone as (typeof SHORTS_TONES)[number]));
  const [feedback, setFeedback] = useState("");
  const before = useRef<ShortsScript | null>(null);
  const { selected, source, script } = session;
  if (!selected || !source) return <NeedsStep title="📝 15·30·60s 대본" goTo={goTo} back="select" label="4. 주제·전략 확정으로"
    text="확정한 주제가 없어요. 소재를 고르고 주제를 확정해 주세요." />;

  const durationOk = Number.isInteger(config.durationSec) && config.durationSec >= shortsScriptDurationSec.min && config.durationSec <= shortsScriptDurationSec.max;
  const tone = config.tone.trim();
  const ready = durationOk && tone.length > 0 && work.consent && !state.running;
  const sentConfig = (): ShortsScriptConfig => ({
    durationSec: config.durationSec, tone: tone.slice(0, 100),
    ...(config.target?.trim() && { target: config.target.trim().slice(0, 100) }),
    ...(session.direction.trim() && { direction: session.direction.trim().slice(0, 1000) }),
  });
  const generate = (revise: boolean) => {
    const cfg = sentConfig();
    const revision = revise && script ? { feedback: feedback.trim().slice(0, 1000), previousDurationSec: script.durationSec, previousScenes: script.scenes } : undefined;
    void state.run(signal => requestScript({ source, selectedIdea: selected, config: cfg, ...(revision && { revision }) }, signal),
      value => { work.commit({ scriptConfig: cfg, script: value.generation, scenePrompts: null }); if (revise) setFeedback(""); },
      revise ? "수정 요청을 반영한 새 대본을 만들었어요." : "대본을 만들었어요. 문구는 직접 고칠 수 있어요.");
  };

  const edit = (index: number, key: keyof typeof LIMITS, value: string) => {
    if (!script) return;
    const scenes = script.scenes.map((scene, at) => at === index
      ? { ...scene, [key]: key === "caption" ? (value.trim() ? value.slice(0, LIMITS.caption) : null) : value.slice(0, LIMITS[key]) } : scene);
    work.update({ script: { ...script, scenes } });
  };
  // 칸을 벗어날 때: 나레이션·연출을 비우면 고치기 전 문구로 되돌리고, 바뀐 것이 있으면 저장한다.
  const settle = () => {
    const previous = before.current;
    before.current = null;
    const current = work.session.script;
    if (!previous || !current) return;
    const scenes = current.scenes.map((scene, index) => ({ ...scene,
      narration: scene.narration.trim() || previous.scenes[index].narration, visual: scene.visual.trim() || previous.scenes[index].visual }));
    if (JSON.stringify(scenes) !== JSON.stringify(previous.scenes)) work.commit({ script: { ...current, scenes } });
    else work.update({ script: previous });
  };

  const speech = script ? speechSeconds(script.scenes.map(scene => scene.narration)) : 0;
  return <div className={s.stepStack}>
    <section className={s.card} aria-labelledby={`${id}-head`}>
      <div className={s.cardHead}>
        <h3 id={`${id}-head`}>{selected.title}</h3>
        <span className={s.cardMeta}>씬마다 한 문장 나레이션 원칙</span>
      </div>
      <div className={s.formGrid}>
        {/* 이름표는 숫자 칸만 가리킨다(바로 고르기 단추는 이름표 밖). */}
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-duration`}>목표 길이(초)</label>
          <span className={s.rowActions}>
            <input id={`${id}-duration`} className={s.inputShort} type="number" min={shortsScriptDurationSec.min} max={shortsScriptDurationSec.max} step={5}
              value={Number.isFinite(config.durationSec) ? config.durationSec : ""} aria-invalid={!durationOk || undefined} aria-describedby={`${id}-duration-hint`}
              onChange={event => setConfig({ ...config, durationSec: Number(event.target.value) })} />
            {QUICK.map(sec => <button key={sec} type="button" className={s.chip} aria-pressed={config.durationSec === sec}
              onClick={() => setConfig({ ...config, durationSec: sec })}>{sec}초</button>)}
          </span>
          <span id={`${id}-duration-hint`} className={s.fieldHint}>{shortsScriptDurationSec.min}~{shortsScriptDurationSec.max}초</span>
        </div>
        <Field label="나레이션 톤">
          <select className={s.input} value={custom ? "custom" : config.tone} onChange={event => {
            const next = event.target.value;
            setCustom(next === "custom");
            setConfig({ ...config, tone: next === "custom" ? "" : next });
          }}>
            {SHORTS_TONES.map(item => <option key={item} value={item}>{item}</option>)}
            <option value="custom">✏️ 직접 입력</option>
          </select>
        </Field>
        {custom && <Field label="톤 직접 입력"><input className={s.input} value={config.tone} maxLength={100} placeholder="예: 시니컬한 뉴스 앵커 톤"
          onChange={event => setConfig({ ...config, tone: event.target.value })} /></Field>}
        <Field label="타깃 시청자 (선택)"><input className={s.input} value={config.target ?? ""} maxLength={100} placeholder="예: 2030 직장인, 자취생"
          onChange={event => setConfig({ ...config, target: event.target.value })} /></Field>
      </div>
      {session.direction.trim() && <p className={s.fieldHint}>④의 추가 기획 요청도 함께 보내요: {session.direction.trim()}</p>}
      <Consent work={work} disabled={state.running} />
      <div className={s.readyActions}>
        <button type="button" className={s.primary} disabled={!ready} onClick={() => generate(false)}>
          {state.running ? "작성 중…" : script ? "대본 새로 만들기" : "대본 생성"}
        </button>
      </div>
      <RunStatus state={state} settingsHref={settingsHref} onCancel={state.cancel} />
    </section>

    {state.running && <RunningCard title="대본 작성 중…" text="장면마다 한 문장 나레이션과 연출·자막을 만들고 있어요. 지금 대본은 새 대본이 오면 바뀌어요." />}
    {script && <section className={s.card} aria-labelledby={`${id}-script`} aria-busy={state.running || undefined}>
      <div className={s.cardHead}>
        <h3 id={`${id}-script`}>{script.durationSec}초 대본 · {script.scenes.length}씬</h3>
        <span className={s.rowActions}>
          <CopyButton copy={copyText} label="나레이션 복사" text={script.scenes.map(scene => scene.narration).join("\n")} />
          <button type="button" className={s.ghost} onClick={() => downloadText(fileName(selected.title, "script"), scriptMarkdown(selected.title, script))}>📥 .md 저장</button>
        </span>
      </div>
      <p className={speechOver(speech, script.durationSec) ? s.speechOver : s.fieldHint}>
        🗣️ 나레이션 약 {speech}초 / 목표 {script.durationSec}초{speechOver(speech, script.durationSec) && " — ⚠️ 목표보다 길어요. 문장을 줄여 보세요."}
        {" "}<span className={s.speechNote}>(초당 약 6자 기준 어림값 — 실제 음성 길이는 목소리·속도에 따라 달라요)</span></p>
      <ol className={s.sceneList}>
        {script.scenes.map((scene, index) => <li key={scene.sceneNumber} className={s.sceneCard}>
          <div className={s.ideaHead}><span className={s.ideaTag}>SCENE {scene.sceneNumber}</span>
            <span className={s.cardMeta}>⏱️ {timecode(scene)}{scene.narration.trim() && ` · 말하기 약 ${speechSeconds([scene.narration])}초`}</span></div>
          {(["narration", "caption", "visual"] as const).map(key => <Field key={key} label={{ narration: "나레이션", caption: "자막", visual: "연출" }[key]}>
            <textarea className={s.textarea} rows={key === "visual" ? 3 : 2} maxLength={LIMITS[key]} value={scene[key] ?? ""} disabled={state.running}
              onFocus={() => { before.current ??= script; }} onBlur={settle} onChange={event => edit(index, key, event.target.value)} />
          </Field>)}
          {scene.sfx && <p className={s.fieldHint}>효과음: {scene.sfx}</p>}
        </li>)}
      </ol>
      <Field label="수정 요청" hint="이전 초안과 함께 보내 새 초안을 받아요. 1000자까지.">
        <textarea className={s.textarea} rows={2} maxLength={1000} value={feedback} placeholder="예: 2번 씬을 더 긴박하게, 마지막에 댓글 참여 유도 멘트 추가"
          onChange={event => setFeedback(event.target.value)} />
      </Field>
      <div className={s.splitActions}>
        <button type="button" className={s.ghost} disabled={!ready || !feedback.trim()} onClick={() => generate(true)}>수정 반영해 다시 만들기</button>
        <button type="button" className={s.primary} disabled={state.running} onClick={() => goTo("prompts")}>🎨 9:16 비주얼 프롬프트로 ➔</button>
      </div>
    </section>}
    <button type="button" className={s.inlineLink} onClick={() => goTo("select")}>← 주제 확정으로</button>
  </div>;
}
