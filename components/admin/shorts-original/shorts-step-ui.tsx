"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { replyMessage, type Reply } from "./shorts-client";
import type { ShortsView } from "./shorts-paths";
import type { ShortsWork } from "./shorts-work";
import s from "./shorts-studio.module.css";

// P1-08 ③~⑥ 단계 공용 부품.
// useRun: 한 번에 요청 하나. 다시 누르면 앞 요청을 취소하고, 화면을 떠나면(언마운트) 취소한다.
// 끝난 응답은 '지금도 그 요청이 마지막이고 같은 작업(epoch)일 때만' 반영해서, 늦은 응답이 뒤에 고른 값을 덮지 않는다.
// checkKey: Gemini 호출이 실패(model_error)했을 때 키·모델 확인 링크를 함께 보인다(F3).
// Tester D4: step을 주면, 만들던 중 화면을 떠나 요청이 끊긴 것을 셸(work.interrupted)에 남기고 돌아왔을 때 한 번 알린다.
// 같은 작업일 때만 남긴다(새 작업·다른 프로젝트로 바뀌어 끊긴 요청은 알리지 않음).
export type RunState = { running: boolean; message: string; notConfigured: boolean; checkKey?: boolean };

/** 실패 응답 → 실행 상태(문구, 설정 링크 종류). */
export function failedState(reply: Exclude<Reply<unknown>, { kind: "ok" }>): RunState {
  const code = reply.kind === "failed" ? reply.code : "";
  return { running: false, message: replyMessage(reply), notConfigured: code === "not_configured", checkKey: code === "model_error" };
}

export const interruptedText = "다른 단계로 옮겨서 만들던 결과가 취소됐어요. 다시 만들어 주세요.";
export const leaveHint = "다른 단계로 가면 만들던 결과가 취소돼요.";

export function useRun(work: Pick<ShortsWork, "alive" | "interrupted">, step?: string) {
  const active = useRef<AbortController | null>(null);
  const activeAlive = useRef<() => boolean>(() => false);
  const note = useRef({ interrupted: work.interrupted, step });
  const [state, setState] = useState<RunState>({ running: false, message: "", notConfigured: false });
  // 셸에 이 단계가 만드는 중인지 알린다(step이 없으면 알리지 않음).
  const report = useCallback((on: boolean) => { const { interrupted, step: name } = note.current; if (name) interrupted?.running(name, on); }, []);
  useEffect(() => {
    const { interrupted, step: name } = note.current;
    if (name && interrupted?.take(name)) setState(current => current.running ? current : { ...current, message: interruptedText });
    return () => {
      if (!active.current) return;
      if (!active.current.signal.aborted && name && activeAlive.current()) interrupted?.mark(name);
      active.current.abort();
      active.current = null;
      report(false);
    };
  }, [report]);

  // done: 성공 문구. 결과에 따라 달라지면(⑥ BGM만 실패) 함수로 받는다.
  const run = useCallback(async <T,>(task: (signal: AbortSignal) => Promise<Reply<T>>, apply: (value: T) => void, done: string | ((value: T) => string)) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const alive = work.alive();
    activeAlive.current = alive;
    setState({ running: true, message: "", notConfigured: false });
    report(true);
    const reply = await task(controller.signal);
    // 다시 누르기·취소·떠나기는 각자 정리했다. 마지막 요청이면 여기서 끝을 알린다.
    if (active.current !== controller) return;
    active.current = null;
    report(false);
    if (controller.signal.aborted) return;
    // 새 작업·다른 프로젝트로 바뀌었으면 결과를 버리고 진행 표시만 끈다.
    if (!alive()) { setState({ running: false, message: "", notConfigured: false }); return; }
    if (reply.kind === "ok") {
      apply(reply.value);
      setState({ running: false, message: typeof done === "function" ? done(reply.value) : done, notConfigured: false });
    } else setState(failedState(reply));
  }, [work, report]);

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    report(false);
    setState({ running: false, message: "취소했어요.", notConfigured: false });
  }, [report]);
  return { ...state, run, cancel };
}

/** 생성 요청 동의. 단계마다 보이지만 값은 셸 하나를 같이 쓴다(처음엔 비어 있다). */
export function Consent({ work, disabled }: { work: Pick<ShortsWork, "consent" | "setConsent">; disabled?: boolean }) {
  return <label className={s.consent}>
    <input type="checkbox" checked={work.consent} disabled={disabled} onChange={event => work.setConsent(event.target.checked)} />
    <span>분석 요약과 앞 단계 결과를 Gemini에 보내 새 결과를 만드는 데 동의해요.</span>
  </label>;
}

export const runningDefault = "Gemini가 만들고 있어요. 최대 40초쯤 걸려요.";

/** 실행 상태. 요청 하나로 끝나는 단계는 기본 문구, 여러 번 나눠 보내는 단계(⑥)는 runningText로 요청마다의 상한을 따로 알린다. */
export function RunStatus({ state, settingsHref, onCancel, runningText = runningDefault }:
  { state: RunState; settingsHref: string; onCancel: () => void; runningText?: string }) {
  return <div className={s.runStatus}>
    <p role="status" className={s.statusText}>{state.running ? `${runningText} ${leaveHint}` : state.message}</p>
    {state.running && <button type="button" className={s.ghost} onClick={onCancel}>취소</button>}
    {state.notConfigured && <a className={s.inlineLink} href={settingsHref}>API키등록·플랫폼연동 열기</a>}
    {!state.running && state.checkKey && <a className={s.inlineLink} href={settingsHref}>Gemini 키·쇼츠 모델 확인하기</a>}
  </div>;
}

/** 앞 단계 결과가 없을 때. */
export function NeedsStep({ title, text, back, label, goTo }: { title: string; text: string; back: ShortsView; label: string; goTo: (view: ShortsView) => void }) {
  const id = useId();
  return <section className={s.card} aria-labelledby={id}>
    <div className={s.cardHead}><h3 id={id}>{title}</h3></div>
    <p className={s.readyText}>{text}</p>
    <div className={s.readyActions}><button type="button" className={s.primary} onClick={() => goTo(back)}>← {label}</button></div>
  </section>;
}

/** 복사 단추: 결과를 잠깐 보인다. */
export function CopyButton({ text, label, copy }: { text: string; label: string; copy: (text: string) => Promise<boolean> }) {
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(""), 2000);
    return () => clearTimeout(timer);
  }, [done]);
  return <button type="button" className={s.ghost} onClick={async () => setDone(await copy(text) ? "ok" : "fail")}>
    {done === "ok" ? "✅ 복사됨" : done === "fail" ? "복사하지 못했어요" : label}
  </button>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className={s.field}><span className={s.fieldLabel}>{label}</span>{children}{hint && <span className={s.fieldHint}>{hint}</span>}</label>;
}

/** 실행 중 카드(원본 LoadingCard). 읽어 주는 상태 문구는 RunStatus 하나만 내고, 여기는 진행 막대로만 알린다.
 * total을 주면 실제로 받은 부분 수로 채우고(⑥), 없으면 끝을 모르는 진행 막대다(③⑤). 앞 결과는 숨기지 않고 aria-busy로 흐리게 둔다. */
export function RunningCard({ title, text, done, total }: { title: string; text: string; done?: number; total?: number }) {
  const known = total !== undefined && total > 0 && done !== undefined;
  const value = known ? Math.min(Math.max(done, 0), total) : 0;
  return <div className={`${s.card} ${s.runningCard}`}>
    <span className={s.spinner} aria-hidden="true" />
    <div className={s.runningBody}>
      <p className={s.runningTitle}>{title}</p>
      <p className={s.fieldHint}>{text}</p>
      <div className={s.progress} role="progressbar" aria-label={title}
        {...(known ? { "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": value, "aria-valuetext": `${total}개 부분 중 ${value}개 받음` } : {})}>
        <span className={s.progressBar} data-indeterminate={known ? undefined : ""} style={known ? { width: `${Math.round(value / total * 100)}%` } : undefined} />
      </div>
      {known && <p className={s.fieldHint}>{total}개 부분 중 {value}개 받음</p>}
    </div>
  </div>;
}
