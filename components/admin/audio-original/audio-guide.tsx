"use client";

import { useEffect, useRef, type ComponentType, type KeyboardEvent } from "react";
import { CheckCircle2, HelpCircle, KeyRound, Mic, Music, ShieldCheck, X, Zap } from "./icons";
import s from "./audio-studio.module.css";

// P1-07-AUDIO-ORIGINAL-PARITY-UI G1: 원본 GuideModal.tsx(AI Audio분석 자동화 이용 가이드 · 소개 · 음성 4항목 · 음악/Suno 4항목 · 키 안내 · 확인 및 닫기)를
// 오디오 스튜디오 칸 안의 <dialog> 하나로 옮겼다. 원본의 별도 /guide 페이지와 사이드바·상단 바·히어로 링크는 모두 이 창을 연다.
// 원본과 다른 점: 회원 본인 키(Rule 00) 안내 대신 관리자 API연동(서버 암호화 보관)과 실행마다 받는 전송 동의를 적는다.
// 지금 화면이 실제로 하는 일과 다른 원본 문장(전문 전사·고주파 Cut-off 감지·똑같은 재현·스템 분리처럼 읽히는 문장)만 고쳐 쓰고 나머지는 원본 문구 그대로 둔다.
// 창은 showModal로 열어 바깥을 가리고, Tab·Shift+Tab은 창 안에서 돈다. Esc·닫기·확인 및 닫기는 onClose, 설정 링크는 onNavigate(초점을 돌리지 않음).
type Item = { title: string; text: string; Icon: ComponentType<{ size?: number; className?: string }>; tone: "ok" | "amber" | "blue" };
export const GUIDE_SPEECH: readonly Item[] = [
  { title: "화자 분리 및 점유율 시각화", text: "대화에 참여한 화자별 역할, 화법 스타일, 핵심 기여도 및 발언 점유율을 정밀 분석합니다.", Icon: CheckCircle2, tone: "ok" },
  { title: "타임라인 전사 및 질문 추출", text: "시각과 함께 대화를 구간별로 기록하고, 제기된 핵심 질문과 맥락을 뽑아요. 상세 보고서의 전사는 최대 80구간 표본이에요.", Icon: CheckCircle2, tone: "ok" },
  { title: "감정 어조 & 비언어적 요소", text: "대화의 전체 분위기, 말의 속도와 리듬, 침묵(휴지기), 추임새(Filler words)까지 포착합니다.", Icon: CheckCircle2, tone: "ok" },
  { title: "원클릭 회의록 & 인터뷰 보고서", text: "실행 과제 중심 회의록 또는 질문·화법 중심 인터뷰 기록을 Markdown으로 만들어 복사하거나 내려받아요.", Icon: CheckCircle2, tone: "ok" },
];
export const GUIDE_MUSIC: readonly Item[] = [
  { title: "Suno AI v6 Reverse Prompt", text: "음원의 장르, 악기, 분위기, 템포를 역설계해 Suno v6에서 비슷한 느낌을 재현할 수 있는 프롬프트를 제안해요. 화면에서 고쳐 쓰고 복사할 수 있어요.", Icon: Zap, tone: "amber" },
  { title: "오디오 포렌식 & 음질 추정", text: "모델이 고주파 대역과 압축 흔적을 듣고 업스케일 의심 여부, 압축 품질, 편집 흔적을 추정해요. 확정 판정이 아니라서 근거를 함께 보여요.", Icon: ShieldCheck, tone: "blue" },
  { title: "4대 스템(Stem) 청각 묘사", text: "보컬(리버브/음역), 베이스(서브/슬랩), 드럼(톤/그루브), 기타 악기를 모델이 들은 대로 설명해요. 스템 파일을 나누어 만들지는 않아요.", Icon: CheckCircle2, tone: "ok" },
  { title: "곡 구조 & 코드 진행 채보", text: "[Intro]-[Verse]-[Chorus] 구조 타임라인과 Key/Scale, 코드 진행(Chord Progression)을 텍스트 악보로 제공합니다. 조성·코드·채보는 상세 보고서에 있어요.", Icon: CheckCircle2, tone: "ok" },
];
export const GUIDE_KEY_TEXT = "이 화면에서는 키를 직접 입력하지 않아요. Gemini 키는 관리자 설정의 API키등록·플랫폼연동에 등록하고, 서버가 암호화해 보관해요. "
  + "분석 버튼을 누르면 파일을 Gemini로 보내요. 4 MiB보다 큰 파일이나 사용자 컨텍스트·특별 요청이 있으면 서버의 비공개 저장소에 올린 뒤 분석해요.";

type Props = { id: string; open: boolean; onClose: () => void; onNavigate: () => void; settingsHref: string };

/** 창 안에서 Tab으로 갈 수 있고 보이는 요소들(순서대로). */
function stops(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex='0']")].filter(node => node.getClientRects().length > 0);
}

export function AudioGuide({ id, open, onClose, onNavigate, settingsHref }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); closeButton.current?.focus(); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => () => { if (ref.current?.open) ref.current.close(); }, []);
  const trap = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = stops(event.currentTarget);
    const first = items[0], last = items.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = !!active && event.currentTarget.contains(active) && active !== event.currentTarget;
    if (event.shiftKey && (!inside || active === first)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (!inside || active === last)) { event.preventDefault(); first.focus(); }
  };
  const group = (kind: "speech" | "music", Icon: Item["Icon"], items: readonly Item[]) => <section className={s.guideGroup} aria-labelledby={`${id}-${kind}`}>
    <h3 id={`${id}-${kind}`} className={s.guideGroupTitle}><Icon size={15} />
      <span>{kind === "speech" ? "1. 음성 인텔리전스 (Speech Intelligence)" : "2. 음악 분석 & Suno v6 역설계 (Music Lab)"}</span></h3>
    <ul className={s.guideItems}>{items.map(({ title, text, Icon: Mark, tone }) => <li key={title} className={s.guideItem}>
      <h4><span className={s.guideMark} data-tone={tone}><Mark size={13} /></span><span>{title}</span></h4>
      <p>{text}</p>
    </li>)}</ul>
  </section>;
  return <dialog ref={ref} id={id} className={s.guide} aria-labelledby={`${id}-title`} aria-describedby={`${id}-lead`}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={trap}>
    <div className={s.guideBox}>
      <div className={s.guideHead}>
        <span className={s.guideIcon}><HelpCircle size={16} /></span>
        <div><h2 id={`${id}-title`}>AI Audio분석 자동화 이용 가이드</h2><p>Version v1.15</p></div>
        <button ref={closeButton} type="button" className={s.guideClose} onClick={onClose} aria-label="이용 가이드 닫기"><X size={16} /></button>
      </div>
      <div className={s.guideBody} tabIndex={0} role="region" aria-label="이용 가이드 내용">
        <section className={s.guideIntro} aria-labelledby={`${id}-intro`}>
          <h3 id={`${id}-intro`}>소리의 숨겨진 통찰을 발견하는 AI Audio 랩</h3>
          <p id={`${id}-lead`}>Google Gemini 멀티모달 오디오 AI로 회의·인터뷰 음성의 맥락부터 음악의 화성과 음질 추정까지 자세히 분석해요. 결과는 모델 추정이고,
            상세 보고서에는 서버가 직접 잰 길이·샘플레이트·채널을 따로 표시해요.</p>
        </section>
        {group("speech", Mic, GUIDE_SPEECH)}
        {group("music", Music, GUIDE_MUSIC)}
        <section className={s.guideKey} aria-labelledby={`${id}-key`}>
          <h3 id={`${id}-key`}><ShieldCheck size={14} /><span>관리자 키 연동 원칙</span></h3>
          <p>{GUIDE_KEY_TEXT}</p>
          <a className={s.guideLink} href={settingsHref} onClick={onNavigate}><KeyRound size={14} />API키등록·플랫폼연동 열기</a>
        </section>
      </div>
      <div className={s.guideFoot}><button type="button" onClick={onClose}>확인 및 닫기</button></div>
    </div>
  </dialog>;
}
