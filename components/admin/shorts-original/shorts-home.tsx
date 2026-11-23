"use client";

import { SHORTS_APP, SHORTS_FLOW, SHORTS_GUIDE_HREF, type ShortsView } from "./shorts-paths";
import type { ShortsResume } from "./shorts-session";
import { ShortsProjectList } from "./shorts-step-vault";
import s from "./shorts-studio.module.css";

// P1-08 원본 src/components/studio/HomePanel.tsx(바이럴 스튜디오 홈)의 배치를 옮겼다: 상단 소개, 워크플로우 카드, 최근 프로젝트 보관함, 9:16 뷰파인더.
// 원본과 다르게 둔 곳(확인되지 않은 내용을 보이지 않기 위해):
// - '30일 안전 자동보관'·만료 일수: 서버가 돌려준 만료 시각(expiresAt)으로만 보인다. 보관함 서버가 운영에 없으면(503) 연결 전 안내만 보인다(P1-08-SHORTS-STEPS).
// - 뷰파인더의 'V/S 14.2x 초대박'·'42.8만' 같은 목업 숫자와 예시 문구는 지어낸 값이라 빼고, 화면 구성 자리만 '구성 예시'로 보인다.
// - 'shorts-onestop-studio로 바로 연결'은 이 제품에서 작업실 전달 기능이 준비 중이라 그렇게 안내한다.
const CARDS = [
  { step: 1, title: "01. 쇼츠 검색 & 떡상 탐지", body: "V/S Ratio(구독자 대비 조회수) 기준 10배↑ '초대박' 영상을 바로 찾아요." },
  { step: 2, title: "02. 바이럴 메커니즘 해체", body: "Gemini 영상 직접 분석으로 컷 전환, 무빙, 3초 락인 공식을 역설계해요." },
  { step: 3, title: "03. 킬러 훅 & 소재 6종", body: "검증된 바이럴 DNA를 옮겨 내 채널 맞춤형 새 소재 6개를 발굴해요." },
  { step: 4, title: "04. 씬당 1문장 원칙 대본", body: "시청 지속 시간을 끝까지 붙잡는 무한 루프 엔딩 대본을 완성해요." },
] as const;

/** '이어서 작업하기' 문구: 단계 번호·이름과(있으면) 제목. */
export function resumeLabel(resume: ShortsResume) {
  const flow = SHORTS_FLOW.find(item => item.id === resume.view);
  return ["이어서 작업하기", flow && `${flow.step}. ${flow.label}`, resume.title].filter(Boolean).join(" · ");
}

export function ShortsHome({ resume, goTo, onOpen, onNew, currentId, onDeleted }: {
  /** 지금 작업을 이어 갈 단계(resumeOf). null이면 단추를 그리지 않는다. 누르면 그 단계로 옮기기만 한다(요청·초기화 없음). */
  resume: ShortsResume | null; goTo: (view: ShortsView) => void;
  /** 보관함 프로젝트 열기: 실패하면 안내 문구, 성공하면 null(셸이 그 단계로 옮긴다). */
  onOpen: (id: string) => Promise<string | null>;
  /** 새 작업으로 비우고 ① 검색부터. */
  onNew: () => void;
  currentId: string | null;
  /** 보관함에서 프로젝트를 지운 뒤(ShortsProjectList onDeleted). */
  onDeleted?: (id: string) => boolean;
}) {
  return <div className={s.home}>
    <section className={s.hero} aria-labelledby="shorts-home-title">
      <div className={s.heroText}>
        <p className={s.heroBadge}><span className={s.dot} aria-hidden="true" />YOUTUBE SHORTS CREATOR STUDIO v2.0</p>
        <h2 id="shorts-home-title" className={s.heroTitle}>{SHORTS_APP.full}</h2>
        <p className={s.heroLead}>구독자 대비 조회수 10배 이상 터진 떡상 영상을 데이터로 해체하고, 바이럴 공식을 적용해 씬당 1문장 대본과 영상 연출 프롬프트까지 이어서 만들어요.</p>
      </div>
      <div className={s.heroActions}>
        <button type="button" className={s.primary} onClick={onNew}>⚡ 새 쇼츠 떡상 분석 시작</button>
        {resume && <button type="button" className={s.ghost} data-resume-step={resume.step} onClick={() => goTo(resume.view)}>{resumeLabel(resume)}</button>}
      </div>
    </section>

    <div className={s.homeGrid}>
      <div className={s.homeMain}>
        <section className={s.card} aria-labelledby="shorts-home-flow">
          <div className={s.cardHead}>
            <h3 id="shorts-home-flow">🚀 6단계 올인원 제작 워크플로우</h3>
            <span className={s.cardMeta}>왼쪽 메뉴 순서대로 진행해요</span>
          </div>
          <ol className={s.flowCards}>
            {CARDS.map(card => <li key={card.step} className={s.flowCard}>
              <p className={s.flowCardTitle}><span className={s.flowNum} aria-hidden="true">{card.step}</span>{card.title}</p>
              <p className={s.flowCardBody}>{card.body}</p>
            </li>)}
          </ol>
          <div className={s.banner}>
            <span>🎬 완성된 대본을 작업실 제작으로 보내는 기능은 준비 중이에요.</span>
            <a className={s.bannerLink} href={SHORTS_GUIDE_HREF}>매뉴얼 보기 ➔</a>
          </div>
        </section>

        <section className={s.card} aria-labelledby="shorts-home-vault">
          <div className={s.cardHead}>
            <h3 id="shorts-home-vault">📂 최근 작업 프로젝트 보관함</h3>
          </div>
          <ShortsProjectList onOpen={onOpen} currentId={currentId} onDeleted={onDeleted} />
        </section>
      </div>

      <aside className={s.viewfinderBox} aria-labelledby="shorts-home-viewfinder">
        <p id="shorts-home-viewfinder" className={s.viewfinderTitle}><span className={s.dot} aria-hidden="true" />9:16 쇼츠 뷰파인더 · 구성 예시</p>
        <div className={s.phone} role="img" aria-label="세로 9:16 쇼츠 화면의 구성 예시: 위쪽 표시, 가운데 첫 3초 훅 자막, 아래쪽 채널·설명, 오른쪽 반응 단추 자리">
          <div className={s.phoneTop} aria-hidden="true"><span>Shorts</span><span className={s.phoneTag}>구성 예시</span></div>
          <div className={s.phoneStage} aria-hidden="true">
            <span className={s.hookTag}>💥 첫 3초 시선강탈 훅</span>
            <span className={s.hookLine}>첫 장면 자막 자리</span>
            <span className={s.hookCue}>[카메라·효과음 연출 자리]</span>
          </div>
          <div className={s.phoneCaption} aria-hidden="true"><span className={s.phoneChannel}>@채널 이름</span><span>제목과 해시태그 자리</span></div>
          <div className={s.phoneRail} aria-hidden="true">
            {["👍 좋아요", "💬 댓글", "↗️ 공유", "🎵 음원"].map(item => { const [icon, label] = item.split(" "); return <span key={label} className={s.railItem}><span className={s.railIcon}>{icon}</span>{label}</span>; })}
          </div>
        </div>
      </aside>
    </div>
  </div>;
}
