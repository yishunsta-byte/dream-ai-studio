"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, CheckCircle2, Copy, Dna, ImageIcon, Layers, Sliders, Sparkles, X } from "./icons";
import { cameraFields, lightingFields, type StudioCell, type StudioRow, type StudioView } from "./studio-data";
import s from "./studio.module.css";

// P1-06 원본 components/dna의 StudioCameraLighting·StudioPalette·StudioDnaBars·StudioScanOverlay·StudioReportView·HelpGuideModal을 옮긴 화면 부품.
// 원본과 다른 점: 예시값 대신 빈 상태, 응답에 없는 칸은 '—'과 안내, 프롬프트는 HTML 주입 없이 글자로만, 도움말은 <dialog>(Esc·초점 가두기).

type Cells = Partial<Record<string, StudioCell>> | undefined;
const cellText = (cell: StudioCell | undefined) => cell?.certainty === "estimated" ? cell.description : "—";
const cellTitle = (cell: StudioCell | undefined) => cell?.certainty === "estimated" ? `근거: ${cell.basis}` : cell ? "모델이 확인하지 못했어요" : "분석 결과에 없음";

function FactCard({ emoji, title, fields, cells, analyzing, hasRecord, gold }: {
  emoji: string; title: string; fields: readonly (readonly [string, string])[]; cells: Cells; analyzing: boolean; hasRecord: boolean; gold?: string;
}) {
  // 원본: 분석 전·중에는 '---', 결과가 있는데 칸이 비면 '—'.
  const blank = analyzing || !hasRecord;
  return <section className={s.card} aria-label={title}>
    <div className={s.cardHead}><h4><span className={s.emoji} aria-hidden>{emoji}</span>{title}</h4></div>
    <dl className={s.facts}>
      {fields.map(([key, label]) => <div key={key}>
        <dt>{label}</dt>
        <dd className={key === gold ? s.gold : undefined} title={blank ? undefined : cellTitle(cells?.[key])}>{blank ? "---" : cellText(cells?.[key])}</dd>
      </div>)}
    </dl>
    {!blank && !cells && <p className={s.cardNote}>이 기록의 분석 결과에는 {title} 항목이 없어요.</p>}
  </section>;
}

export function StudioCameraLighting({ view, analyzing }: { view?: StudioView; analyzing: boolean }) {
  return <>
    <FactCard emoji="📷" title="카메라 & 렌즈" fields={cameraFields} cells={view?.camera} analyzing={analyzing} hasRecord={!!view} />
    <FactCard emoji="🔆" title="조명 환경 분석" fields={lightingFields} cells={view?.lighting} analyzing={analyzing} hasRecord={!!view} gold="timeOfDay" />
  </>;
}

export function StudioPalette({ palette, note }: { palette: { hex: string; percent: number }[]; note: string }) {
  const R = 12, C = 2 * Math.PI * R;
  const total = palette.reduce((sum, color) => sum + (color.percent || 0), 0) || 100;
  const segments = palette.reduce<{ hex: string; percent: number; len: number; offset: number }[]>((list, color) => {
    const previous = list.at(-1);
    return [...list, { ...color, len: ((color.percent || 0) / total) * C, offset: previous ? previous.offset + previous.len : 0 }];
  }, []);
  return <section className={s.card} aria-label="미학적 팔레트">
    <div className={s.cardHead}><h4><span className={s.emoji} aria-hidden>🎨</span>미학적 팔레트</h4></div>
    <div className={s.donut}>
      <svg viewBox="0 0 32 32" role="img" aria-label={palette.length ? `색상 팔레트 도넛 차트 ${palette.length}색` : "색상 팔레트 도넛 차트(비어 있음)"}>
        <circle cx="16" cy="16" r={R} fill="none" stroke="var(--donut-track)" strokeWidth="4.8" />
        {segments.map((segment, index) => <circle key={`${segment.hex}-${index}`} cx="16" cy="16" r={R} fill="none" stroke={segment.hex} strokeWidth="4.8"
          strokeDasharray={`${segment.len} ${C}`} strokeDashoffset={-segment.offset} />)}
      </svg>
      <div className={s.donutLabel} aria-hidden><span>미학적</span><strong>컬러</strong></div>
    </div>
    {palette.length ? <>
      <div className={s.bars} style={{ gridTemplateColumns: `repeat(${palette.length}, minmax(0, 1fr))` }} aria-hidden>
        {palette.map((color, index) => <span key={`bar-${color.hex}-${index}`} style={{ background: color.hex }} title={`${color.hex} (${color.percent}%)`} />)}
      </div>
      <ul className={s.swatches}>
        {palette.map((color, index) => <li key={`list-${color.hex}-${index}`}>
          <span><span className={s.dot} style={{ background: color.hex }} aria-hidden />{color.hex.toUpperCase()}</span><strong>{color.percent}%</strong>
        </li>)}
      </ul>
    </> : null}
    <p className={palette.length ? s.cardNote : s.empty}>{note}</p>
  </section>;
}

export function StudioDnaBars({ view, analyzed }: { view?: StudioView; analyzed: boolean }) {
  const bars = view?.bars ?? [];
  const keywords = view?.keywords ?? [];
  const missing = analyzed ? "이 기록의 분석 결과에 없어요." : "분석이 끝나면 표시돼요.";
  return <>
    <section className={s.card} aria-label="스타일 핵심 요소">
      <div className={s.cardHead}><h4><span className={s.emoji} aria-hidden>🧬</span>스타일 핵심 요소</h4></div>
      {bars.length ? <ul className={s.meter}>
        {bars.map(bar => <li key={bar.label}>
          <div className={s.meterHead}><span>{bar.label} /</span><strong>{bar.score}%</strong></div>
          <div className={s.track} role="meter" aria-label={bar.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar.score}>
            <span style={{ width: `${Math.min(100, Math.max(0, bar.score))}%` }} />
          </div>
        </li>)}
      </ul> : <p className={s.empty}>{missing}</p>}
      {bars.length > 0 && <p className={s.cardNote}>모델이 추정한 값이에요(측정값 아님).</p>}
    </section>
    <section className={`${s.card} ${s.score}`} aria-label="스타일 일치율">
      <p>스타일 일치율</p>
      {view?.matchRate != null ? <strong className={s.scoreValue}>{view.matchRate.toFixed(1)}%</strong>
        : <strong className={s.scoreValue} data-empty>—</strong>}
      <p>{view?.matchRate != null ? "* AI 시각적 특징 및 스타일 추출 정밀도(모델 추정)" : `* ${missing}`}</p>
    </section>
    {keywords.length > 0 && <section className={s.card} aria-label="추출된 키워드">
      <div className={s.cardHead}><h4><span className={s.emoji} aria-hidden>#</span>추출된 키워드</h4></div>
      <ul className={s.chips}>{keywords.map(keyword => <li key={keyword}>{keyword}</li>)}</ul>
    </section>}
  </>;
}

export function StudioScanOverlay({ ratio, scanning }: { ratio?: string | null; scanning: boolean }) {
  return <div className={s.overlay} aria-hidden>
    <div className={s.thirds}>{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>
    <span className={s.crossV} /><span className={s.crossH} />
    {(["tl", "tr", "bl", "br"] as const).map(at => <span key={at} className={s.corner} data-at={at} />)}
    {scanning ? <>
      <div className={s.laser} />
      <div className={s.scanDim}><div className={s.ring}><Dna size={36} /></div><p className={s.scanText}>스타일 분석 중...</p></div>
    </> : ratio ? <span className={s.ratio}>AR: {ratio}</span> : null}
  </div>;
}

export function CopyButton({ text, label, onCopied, className = s.copy }: { text?: string; label: string; onCopied: (message: string) => void; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(false), 1500); return () => clearTimeout(timer); }, [done]);
  return <button type="button" className={className} disabled={!text} aria-label={`${label} 복사`} onClick={() => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => { setDone(true); onCopied(`복사했어요: ${label}`); }, () => onCopied("복사하지 못했어요. 글을 직접 선택해 복사해 주세요."));
  }}>{done ? <Check size={14} /> : <Copy size={14} />}{done ? "복사됨" : "복사"}</button>;
}

function Rows({ rows, empty }: { rows: StudioRow[]; empty: string }) {
  if (!rows.length) return <p className={s.sourceNote}>{empty}</p>;
  return <ul className={s.facts2}>{rows.map((row, index) => <li key={`${row.label}-${index}`}><div>
    <strong>{row.label}:</strong><span>{row.unconfirmed ? "확인하지 못했어요" : row.description}</span>
    {row.basis && <span className={s.basis}>근거: {row.basis}</span>}
  </div></li>)}</ul>;
}

function Prompt({ title, text, lang, onCopied, full }: { title: string; text?: string; lang: "en" | "ko"; onCopied: (message: string) => void; full: boolean }) {
  const attached = !!text?.includes("[첨부 이미지]");
  return <section className={s.prompt} aria-label={title}>
    <div className={s.promptHead}>
      <span>{title}{attached && <span className={s.attach}>🖼️ [첨부 이미지] 참조 모드</span>}</span>
      <CopyButton text={text} label={title} onCopied={onCopied} />
    </div>
    <p className={s.promptText} lang={lang}>{text || "이 버전에는 이 언어의 프롬프트가 없어요."}</p>
    {attached && <p className={s.promptTip}>💡 <strong>활용 팁:</strong> AI 이미지 생성기{full ? "(Midjourney, Gemini, ChatGPT 등)" : ""}에 프롬프트 입력 시 <strong>원본 사진을 파일로 함께 첨부</strong>하세요.</p>}
  </section>;
}

const sourceText = { revision: "보정 버전의 값이에요.", styleDna: "", semantic: "의미 분석 결과(구도·인물·사물·동작·조명·맥락)로 채웠어요." } as const;

export function StudioReport({ view, onCopied, engine }: { view: StudioView; onCopied: (message: string) => void; engine?: string }) {
  return <section className={`${s.card} ${s.report}`} aria-label="분석 리포트">
    <div className={s.titleRow}>
      <span aria-hidden>📄</span>
      <div><p className={s.titleEn} lang="en">EN: {view.titles.en ?? view.titles.ko}</p><p className={s.titleKo}>KR: {view.titles.ko}</p>
        {engine && <small className={s.engineBasis} aria-label="실행 엔진">v{view.revision} 실행 엔진 · {engine}</small>}</div>
    </div>
    <section className={s.section} data-kind="blueprint" aria-label="구조적 청사진">
      <p className={s.sectionHead}><span aria-hidden>↗</span>구조적 청사진</p>
      <Rows rows={view.blueprint.rows} empty="분석 결과에 없어요." />
      {view.blueprint.rows.length > 0 && sourceText[view.blueprint.source] && <p className={s.sourceNote}>{sourceText[view.blueprint.source]}</p>}
    </section>
    <section className={s.section} data-kind="style" aria-label="스타일 분석">
      <p className={s.sectionHead}><span aria-hidden>ⓘ</span>스타일 분석</p>
      <Rows rows={view.style.rows} empty="분석 결과에 없어요." />
      {view.style.rows.length > 0 && sourceText[view.style.source] && <p className={s.sourceNote}>{sourceText[view.style.source]}</p>}
    </section>
    <section className={s.section} data-kind="tips" aria-label="프로의 활용 팁">
      <p className={s.sectionHead}><span aria-hidden>⚡</span>프로의 활용 팁</p>
      {view.tips.length ? <ul className={s.facts2}>{view.tips.map((tip, index) => <li key={index}><span>{tip}</span></li>)}</ul>
        : <p className={s.sourceNote}>분석 결과에 없어요.</p>}
    </section>
    {view.semanticUnavailable && <p className={s.sourceNote} role="note">이 기록은 의미 분석을 받지 못해 프롬프트가 비어 있을 수 있어요.</p>}
    <Prompt title={`마스터 프롬프트 (EN) v${view.revision}`} text={view.prompts.en} lang="en" onCopied={onCopied} full />
    <Prompt title={`마스터 프롬프트 (KO) v${view.revision}`} text={view.prompts.ko} lang="ko" onCopied={onCopied} full={false} />
  </section>;
}

export function StudioReportWaiting() {
  return <section className={`${s.card} ${s.reportWait}`} aria-label="분석 리포트">
    <strong>분석된 프롬프트 리포트 대기 중</strong>
    <p>이미지 분석이 완료되면 구조적 청사진과 마스터 프롬프트가 이곳에 출력됩니다.</p>
  </section>;
}

const HELP_STEPS = [
  { title: "이미지 업로드 및 소스 선택", desc: "분석하고 싶은 레퍼런스 이미지를 업로드 영역에 드래그하거나 클릭하여 선택합니다.", Icon: ImageIcon },
  { title: "시퀀싱 모드 및 변이 조절", desc: "'유전자 복제'로 1:1 구도와 스타일을 완전 재현하거나, '유전자 변이' 모드에서 돌연변이 레벨(0-30%: Stable, 31-70%: Hybrid, 71-100%: Chaotic)을 조절하여 창의적으로 재해석합니다.", Icon: Sliders },
  { title: "프롬프트 복사 및 [첨부 이미지] 연동", desc: "해독된 국문/영문 마스터 프롬프트를 원클릭으로 복사할 수 있습니다. '첨부 이미지 제공'을 켜면 원본 이미지를 시맨틱 스타일 앵커로 직접 참조하는 고도화된 프롬프트가 생성됩니다.", Icon: Layers },
  { title: "미세 보정 (리파이닝)", desc: "결과 화면 하단 피드백 박스에 원하는 수정사항을 입력하여 추출된 DNA와 프롬프트를 실시간으로 교정할 수 있습니다.", Icon: Sparkles },
  { title: "결과 테스트 및 이미지 합성", desc: "'결과 테스트'에서 피사체를 대입하거나 프롬프트를 직접 편집하여 즉석에서 이미지를 생성하고 원본과 색감 일치율을 비교합니다.", Icon: CheckCircle2 },
];
// 원본 첫 팁(Gemini/OpenAI/Claude 회원 키)은 이 관리자 도구와 맞지 않아 실제 동작으로 바꿨어요. 나머지는 원본 문구 그대로.
const HELP_TIPS = [
  "분석·보정·시험은 계정설정 및 API 연동에 등록한 Gemini로만 호출되고, 실행마다 따로 동의해야 나가요.",
  "유전자 변이 기능은 레벨이 높을수록 원본의 기본 구도 축만 유지한 채 완전히 새로운 질감과 미학적 DNA를 주입합니다.",
  "화면 비율(AR)은 업로드된 이미지의 실제 픽셀 비율(16:9, 1:1, 9:16 등 12종)을 자동 감지하여 프롬프트에 자연어로 자동 통합됩니다.",
];

export function StudioHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={s.help} aria-labelledby="style-dna-help-title" onClose={onClose} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={s.helpBox}>
      <div className={s.helpHead}>
        <span className={s.helpIcon}><BookOpen size={16} /></span>
        <div><h4 id="style-dna-help-title">이미지 스타일 분석기 도움말 & 가이드</h4><p>시각적 스타일 정밀 분석 및 프롬프트 재현 프레임워크</p></div>
        <button type="button" className={s.helpClose} onClick={onClose} aria-label="닫기"><X size={20} /></button>
      </div>
      <div className={s.helpBody}>
        <section className={s.helpOverview}><h5>시스템 개요</h5>
          <p>이미지 스타일 분석기는 AI를 사용하여 이미지의 시각적 요소를 정밀하게 분석하고, 이를 재현 가능한 프롬프트 프레임워크로 변환하는 전문 도구입니다. 복잡한 스타일, 조명, 구도, 카메라 설정을 수치화하여 자신만의 독창적인 생성 이미지를 만들 수 있도록 돕습니다.</p></section>
        <section><h5>단계별 사용 가이드</h5>
          <ol className={s.helpSteps}>{HELP_STEPS.map(({ title, desc, Icon }, index) => <li key={title}>
            <span className={s.helpNo}>{index + 1}</span>
            <div><strong><Icon size={14} />{title}</strong><p>{desc}</p></div>
          </li>)}</ol></section>
        <section className={s.helpTips}><h5>💡 핵심 팁 & 활용 노하우</h5>
          <ul>{HELP_TIPS.map(tip => <li key={tip}>{tip}</li>)}</ul></section>
      </div>
      <div className={s.helpFoot}><button type="button" onClick={onClose}>확인 및 닫기</button></div>
    </div>
  </dialog>;
}
