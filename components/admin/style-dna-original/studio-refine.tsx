"use client";

// P1-06 2단계: 원본 Style DNA v1.39 '프롬프트 보정' 화면(app/(dashboard)/refine/page.tsx)을 옮겼다.
// 원본 구성: 단계 머리(2·프롬프트 보정·설명) → 왼쪽 카드(썸네일·제목 두 줄·마스터 프롬프트 EN/KO 상자) · 오른쪽(추론 인터페이스 카드, 보정 기록 카드).
// 제품 차이: 보정 AI는 등록한 엔진(Gemini·OpenAI·Anthropic)만 고를 수 있고 1단계와 같은 선택을 쓴다(모델은 등록된 것 하나), 따로 동의 없이 단추 옆에 보낼 내용 안내(CMD-044),
// 프롬프트 상자에 버전 번호와 그 버전의 실제 실행 엔진, 보정 기록마다 실행 엔진과 '이 버전으로 시험'.
// 요청·멈춤·오류 안내는 작업실(admin-style-dna-workflow)이 그대로 맡고, 이 부품은 화면만 그린다.
import type { FormEvent } from "react";
import { FlaskConical, Loader2, Wand2 } from "./icons";
import { CopyButton } from "./studio-parts";
import type { StudioView } from "./studio-data";
import type { EngineChoice } from "../style-dna-client";
import r from "./studio-refine.module.css";

export const REFINE_QUICK = ["색감을 더 따뜻하게", "조명을 더 부드럽게", "배경을 단순하게", "질감과 디테일을 더 강조", "더 시네마틱한 분위기로",
  "변이 강도 50% 적용 (Hybrid)", "변이 강도 80% 적용 (Chaotic)", "사이버네틱 네온 질감 주입", "브루탈리즘 건축 미학 적용"];

type Revision = { revision: number; feedback?: string | null; note?: string | null; createdAt: string; prompts: { en?: string; ko?: string }; engineText?: string };
type Engine = { value: EngineChoice; short: string; model: string | null; choices: { value: EngineChoice; label: string; disabled: boolean }[]; warn: string | null;
  onChange: (value: EngineChoice) => void };

function PromptBox({ label, text, lang, onCopied }: { label: string; text?: string; lang: "en" | "ko"; onCopied: (message: string) => void }) {
  return <section className={r.promptBox} aria-label={label}>
    <div className={r.promptHead}><h6>{label}</h6><CopyButton text={text} label={label} onCopied={onCopied} className={r.copy} /></div>
    <p lang={lang}>{text || "이 버전에는 이 언어의 프롬프트가 없어요."}</p>
  </section>;
}

export function StudioRefine({ id, image, view, revisions, feedback, limit, quick, busy, running, ready, engine, onFeedback, onQuick, onClear, onSubmit, onTest, onCopied, when }: {
  id: string; image: string; view: StudioView; revisions: Revision[]; feedback: string; limit: number; quick: readonly string[];
  busy: boolean; running: boolean; ready: boolean; engine: Engine;
  onFeedback: (value: string) => void; onQuick: (value: string) => void; onClear: () => void;
  onSubmit: (event: FormEvent) => void; onTest: (revision: number) => void; onCopied: (message: string) => void; when: (iso: string) => string;
}) {
  const latest = revisions.at(-1)!;
  const refined = revisions.filter(item => item.revision > 1);
  const count = [...feedback].length;
  const canRun = ready && !!feedback.trim() && count <= limit && !busy;
  return <div className={r.page} role="region" aria-label="프롬프트 보정">
    <header className={r.stepHead}>
      <div className={r.stepTitle}><span className={r.stepNo} aria-hidden="true">2</span><h4>프롬프트 보정</h4></div>
      <p>결과가 마음에 들지 않는 부분을 말로 적으면 AI가 마스터 프롬프트를 미세하게 고칩니다. 고친 결과는 보관함에 바로 저장됩니다.</p>
    </header>

    <div className={r.grid}>
      <section className={r.card} aria-label="현재 프롬프트">
        <div className={r.titleRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" width={56} height={56} />
          <div><p className={r.titleKo}>{view.titles.ko}</p>{view.titles.en && <p className={r.titleEn} lang="en">{view.titles.en}</p>}</div>
        </div>
        {latest.engineText && <p className={r.basis} aria-label="실행 엔진">v{latest.revision} 실행 엔진 · {latest.engineText}</p>}
        <PromptBox label={`마스터 프롬프트 (EN) v${latest.revision}`} text={latest.prompts.en} lang="en" onCopied={onCopied} />
        <PromptBox label={`마스터 프롬프트 (KO) v${latest.revision}`} text={latest.prompts.ko} lang="ko" onCopied={onCopied} />
      </section>

      <div className={r.side}>
        <form className={r.card} aria-label="추론 인터페이스" onSubmit={onSubmit} aria-busy={busy || undefined}>
          <h5>추론 인터페이스</h5>
          <label className={r.feedback}><span className={r.srOnly}>보정 피드백</span>
            <textarea value={feedback} maxLength={limit} onChange={event => onFeedback(event.target.value)} aria-describedby={`${id}-refine-count`}
              placeholder="DNA 보정을 위한 피드백 입력... 예: 배경 한옥을 더 흐리게, 색감은 더 따뜻하게" />
            <span className={r.count} id={`${id}-refine-count`}>{count} / {limit}</span></label>
          <div className={r.chips} role="group" aria-label="빠른 피드백">
            {quick.map(text => <button key={text} type="button" disabled={busy} onClick={() => onQuick(text)}>{text}</button>)}
          </div>
          <div className={r.engine}>
            <label>보정 AI<select value={engine.value} disabled={busy} aria-describedby={`${id}-refine-engine`} onChange={event => engine.onChange(event.target.value as EngineChoice)}>
              {engine.choices.map(choice => <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>)}</select></label>
            <label>모델<select value={engine.model ?? ""} disabled aria-describedby={`${id}-refine-engine`}><option value={engine.model ?? ""}>{engine.model ?? "등록 안 됨"}</option></select></label>
          </div>
          {engine.warn && <p className={r.warn} role="note">{engine.warn}</p>}
          <p className={r.note} id={`${id}-refine-engine`}>API키등록·플랫폼연동에 등록한 {engine.short} 키로 호출되며 요금은 그 계정에 청구돼요.</p>
          <p className={r.consent}>'미세 보정 요청'을 누르면 현재 버전 {latest.revision}의 프롬프트와 피드백을 {engine.short}({engine.model ?? "모델 미등록"})에 보내 새 보정 버전을 만들어요(호출 1건).</p>
          <button type="submit" className={r.primary} disabled={!canRun}>
            {running ? <Loader2 size={16} className={r.spin} /> : <Wand2 size={16} />}{running ? "보정 중" : "미세 보정 요청"}</button>
          <p className={r.note}>보정 1회마다 AI 호출 1건(유료)이 발생합니다. 영어·한국어 프롬프트가 함께 고쳐집니다.</p>
        </form>

        <section className={r.card} aria-label="보정 기록">
          <h5>보정 기록 ({refined.length})</h5>
          {!refined.length ? <p className={r.empty}>아직 보정한 적이 없습니다.</p> : <ol className={r.history}>
            {[...refined].reverse().map(item => <li key={item.revision}>
              <p className={r.request}><span className={r.version}>버전 {item.revision}</span>요청: {item.feedback}</p>
              {item.note && <p className={r.answer}>→ {item.note}</p>}
              {item.engineText && <p className={r.itemEngine}>실행 엔진 · {item.engineText}</p>}
              <div className={r.itemFoot}><time dateTime={item.createdAt}>{when(item.createdAt)}</time>
                <button type="button" disabled={busy} onClick={() => onTest(item.revision)}>이 버전으로 시험</button></div>
            </li>)}
          </ol>}
          <div className={r.historyActions}>
            <button type="button" className={r.ghost} disabled={!feedback || busy} onClick={onClear}>입력 지우기</button>
            <button type="button" className={r.ghost} disabled={busy} onClick={() => onTest(1)}><FlaskConical size={14} />처음 분석(버전 1)으로 시험</button>
          </div>
        </section>
      </div>
    </div>
  </div>;
}
