"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AccountMenu } from "@/components/auth/account-menu";
import { ProtectedContent, useSessionBoundary } from "@/components/auth/session-boundary";
import { ShortsHome } from "./shorts-home";
import { resumeOf, type ShortsContext } from "./shorts-session";
import { SHORTS_APP, SHORTS_FLOW, SHORTS_GUIDE_HREF, SHORTS_SETTINGS_HREF, type ShortsView } from "./shorts-paths";
import type { ShortsSourceAnalysis, ShortsSourceMultiAnalysis, ShortsSourcePick, ShortsSourceSnapshot } from "../shorts-source-steps/source-step-data";
import { shortsStepScreens, ShortsReadyStep } from "./shorts-steps";
import { readShortsTab, shortsTabStorage, writeShortsTab } from "./shorts-tab-store";
import { ShortsSaveBar, useShortsWork } from "./shorts-work";
import s from "./shorts-studio.module.css";

// P1-08 원본 Shorts Viral Studio v2.01의 (dashboard) layout + components/layout/Sidebar.tsx를 관리자 보호 경로(/admin/shorts-analysis)에 옮긴 셸.
// 원본은 페이지 주소(/search·/analyze·…)로 단계를 나누지만, 이 화면은 진행 중 요청·동의·입력 칸을 지키려고 같은 주소 안에서 단계를 바꾼다(Style DNA 셸과 같음).
// 넓은 화면(1024px 이상, 원본 lg)은 256px 고정 왼쪽 메뉴, 좁은 화면은 위쪽 바 + 펼침 메뉴. 아래쪽 계정은 관리자 공통 계정 메뉴(세션 감시·로그아웃).
// 세션: 본문은 main 안 ProtectedContent로 가리고, 확인 전에는 브랜드·단계·링크를 숨기고(inert) 계정 메뉴만 남긴다.
// 단계 화면은 shorts-steps.tsx의 표(shortsStepScreens)에서 꺼낸다. 비어 있는 단계는 원본 설명과 '실행 준비 중'을 보인다.
// P1-08-SHORTS-EMBED-SHELL: layout="embedded"는 이미 보호된 관리자 페이지(경계·main·ProtectedContent·계정 메뉴가 있는 곳) 안에 끼우는 모드다.
// 부모 보호를 그대로 쓰므로 main·계정 메뉴·본문 가림·숨은 h1·'관리자 홈으로'를 그리지 않고, 화면 높이 고정·sticky·창 맨 위 스크롤을 하지 않는다.
// 넓은 메뉴는 화면 폭이 아니라 작업실 상자 폭(컨테이너 1024px)으로 정한다. 기본(page) 모드는 바뀌지 않는다.
export type ShortsStudioLayout = "page" | "embedded";
const SETTINGS_HASH = "#admin-api-integrations";

function Brand({ onHome, confirmed }: { onHome: () => void; confirmed: boolean }) {
  return <div className={s.brandBox} inert={!confirmed || undefined} style={confirmed ? undefined : { visibility: "hidden" }}>
    <button type="button" className={s.brand} onClick={onHome} aria-label={`${SHORTS_APP.full} ${SHORTS_APP.version} 홈으로`}>
      <span className={s.brandIcon} aria-hidden="true">▶</span>
      <span className={s.brandText}>
        <span className={s.brandName}>{SHORTS_APP.line1}</span>
        <span className={s.brandMeta}><span className={s.brandSub}>{SHORTS_APP.line2}</span><span className={s.version}>{SHORTS_APP.version}</span></span>
      </span>
    </button>
  </div>;
}

function NavBody({ view, onView, account, confirmed, embedded }:
  { view: ShortsView; onView: (view: ShortsView) => void; account?: string; confirmed: boolean; embedded: boolean }) {
  return <nav className={s.nav} aria-label={`${SHORTS_APP.full} 메뉴`}>
    <div className={s.group} inert={!confirmed || undefined} style={confirmed ? undefined : { visibility: "hidden" }}>
      <button type="button" className={s.overview} aria-current={view === "home" ? "page" : undefined} onClick={() => onView("home")}>
        <span aria-hidden="true">🏠</span><span>바이럴 스튜디오 홈</span>
      </button>
      <div className={s.flow}>
        <p className={s.flowTitle}>쇼츠 바이럴 파이프라인</p>
        <ol className={s.steps}>
          {SHORTS_FLOW.map(item => {
            const ready = shortsStepScreens[item.id] !== null;
            return <li key={item.id}>
              <button type="button" className={s.step} aria-current={view === item.id ? "step" : undefined} onClick={() => onView(item.id)}>
                <span className={s.badge} aria-hidden="true">{item.step}</span>
                <span className={s.stepBody}>
                  <span className={s.stepLabel}><span aria-hidden="true">{item.icon}</span> {item.label}</span>
                  <span className={s.stepDesc}>{item.desc}{ready ? "" : " · 준비 중"}</span>
                </span>
              </button>
            </li>;
          })}
        </ol>
      </div>
      <div className={s.utility}>
        <p className={s.flowTitle}>설정 및 가이드</p>
        <a className={s.util} href={SHORTS_SETTINGS_HREF}><span aria-hidden="true">🔑</span><span>API키등록·플랫폼연동</span></a>
        <a className={s.util} href={SHORTS_GUIDE_HREF}><span aria-hidden="true">📖</span><span>연동 &amp; 사용 매뉴얼</span></a>
        <button type="button" className={s.util} aria-current={view === "vault" ? "page" : undefined} onClick={() => onView("vault")}>
          <span aria-hidden="true">📚</span><span>프롬프트 보관함</span>
        </button>
        {!embedded && <a className={s.util} href="/admin"><span aria-hidden="true">←</span><span>관리자 홈으로</span></a>}
      </div>
    </div>
    {!embedded && account && <div className={s.account}>
      <p className={s.accountLabel}>로그인 계정</p>
      <AccountMenu email={account} />
    </div>}
  </nav>;
}

/** page: 전용 보호 화면(/admin/shorts-analysis)의 전체 셸. embedded: 보호된 관리자 페이지 안의 작업실(계정은 부모가 그린다). */
/** 확인된 계정(owner)이 탭 저장을 맞춘 계정(tabOwner)과 다르면, 화면의 작업은 앞 계정 것이다(새 계정으로 맞추기 전). 둘 중 하나라도 없으면 아니다. */
export const tabOwnerStale = (owner: string | null, tabOwner: string | null) => owner !== null && tabOwner !== null && owner !== tabOwner;

export function ShortsStudio(props: { account: string; layout?: "page" } | { layout: "embedded"; account?: string }) {
  const { account } = props;
  const embedded = props.layout === "embedded";
  const root = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ShortsView>("home");
  // P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: 고른 영상은 고른 순서의 목록(최대 3개). 첫 영상은 예전 pick 자리(③ 검색어·홈 이어서 작업하기)에 쓴다.
  const [picks, setPicks] = useState<ShortsSourcePick[]>([]);
  const pick = picks[0] ?? null;
  const setPick = useCallback((value: ShortsSourcePick | null) => setPicks(value ? [value] : []), []);
  const [sourceSnapshot, setSourceSnapshot] = useState<ShortsSourceSnapshot | null>(null);
  const [sourceAnalysis, setSourceAnalysis] = useState<ShortsSourceAnalysis | null>(null);
  // 묶음 분석 결과: 화면 메모리에만 두고 저장·③ 연결 없음. 단계를 옮겼다 돌아오면 같은 묶음일 때 다시 보인다.
  const [sourceMulti, setSourceMulti] = useState<ShortsSourceMultiAnalysis | null>(null);
  // F6: 묶음 분석이 끝난 순간의 단건 근거(context). 그 뒤 새 단건 분석·프로젝트 열기·새 작업으로 근거가 바뀌기 전까지는
  // ③이 이 옛 근거로 소재를 만들거나 저장하지 않게 막는다(근거 출처를 묶음으로 바꿔 적지도 않는다).
  const [multiOver, setMultiOver] = useState<ShortsContext | null>(null);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const session = useSessionBoundary();
  const confirmed = !session || session.view === "current";
  const work = useShortsWork();
  // F1: 탭 저장(sessionStorage)에서 되살리고, 그 뒤로는 바뀔 때마다 남긴다. 로그인 확인이 '바뀜·로그아웃'으로 확정되면 남긴 작업을 지운다.
  // P1-08-SHORTS-SESSION-RESTORE-OWNER: 탭 저장의 주인은 서버가 확인한 로그인 계정(account)이고, 세션 경계가 지금 '확인됨'일 때만 쓴다.
  // 계정을 모르거나(경계 밖·계정 미전달), 확인 전·의심(checking·offline·unavailable)·확정 해제 동안에는 읽지도 쓰지도 않는다.
  const owner = account && session?.view === "current" && !session.cleared ? account : null;
  // 탭 저장을 맞춘(되살렸거나, 맞지 않아 지운) 계정. 같은 계정이 다시 확인되면 다시 되살리지 않는다(진행 중 요청을 끊지 않게).
  const [tabOwner, setTabOwner] = useState<string | null>(null);
  const synced = useRef<string | null>(null);

  const goTo = useCallback((next: ShortsView) => { moved.current = true; setView(next); }, []);
  // Tester D4: 어떤 단계가 Gemini 결과를 만드는 중(work.busy)이면, 사용자가 다른 단계·홈·보관함으로 옮기기 전에 묻는다.
  // 머무르기: 요청과 화면을 그대로 둔다. 취소하고 이동: 옮기면 단계 화면이 사라지며 요청을 끊고, 옮긴 화면에서 취소를 알린다.
  // 프로젝트 열기·새 작업처럼 작업 자체를 바꾸는 흐름은 원래대로 바로 옮긴다(그 단계의 늦은 응답은 alive로 버린다).
  const [leave, setLeave] = useState<ShortsView | null>(null);
  const [leftNote, setLeftNote] = useState(false);
  const stayButton = useRef<HTMLButtonElement>(null);
  // 묻는 동안 만들기가 끝나면 더 물을 것이 없다.
  if (leave !== null && !work.busy) setLeave(null);
  const requestView = useCallback((next: ShortsView) => {
    if (work.busy && next !== view) { setLeave(next); return; }
    setLeftNote(false);
    goTo(next);
  }, [work.busy, view, goTo]);
  const stay = useCallback(() => { setLeave(null); heading.current?.focus({ preventScroll: true }); }, []);
  const leaveNow = () => {
    if (leave === null) return;
    setLeave(null);
    setLeftNote(true);
    goTo(leave);
  };
  useEffect(() => {
    if (leave === null) return;
    stayButton.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") stay(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [leave, stay]);
  // 단계를 바꾸면 맨 위로 올리고 단계 제목에 초점을 둔다(첫 화면에서는 옮기지 않음).
  // 끼운 모드는 창 맨 위가 아니라, 작업실 상자 위쪽이 화면 위로 지나갔을 때만 상자 처음으로 옮긴다.
  useEffect(() => {
    if (!moved.current) return;
    if (!embedded) window.scrollTo({ top: 0 });
    else if (root.current && root.current.getBoundingClientRect().top < 0) root.current.scrollIntoView({ block: "start" });
    heading.current?.focus({ preventScroll: embedded });
  }, [view, embedded]);
  // 좁은 화면 펼침 메뉴: 고르면 닫는다. 다른 단계면 위 효과가 새 단계 제목으로 초점을 옮기고, 같은 단계면 메뉴 단추로 돌린다(닫힌 메뉴에 초점이 남지 않게). Esc로도 닫는다.
  const pickView = (next: ShortsView) => { setOpen(false); if (next === view) toggle.current?.focus(); else requestView(next); };
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  // 재사용하는 관리자 부품의 'API연동 보기'는 같은 화면 해시(#admin-api-integrations)로 가리킨다. 이 전용 화면에는 그 칸이 없으므로
  // 그 해시가 되면 관리자 허브의 같은 칸으로 옮긴다(요청 없음, 주소 이동만).
  // 끼운 모드는 부모 관리자 페이지가 그 칸을 가지므로 옮기지 않는다.
  useEffect(() => {
    if (embedded) return;
    const follow = () => { if (window.location.hash === SETTINGS_HASH) window.location.assign(SHORTS_SETTINGS_HREF); };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [embedded]);

  const clearSource = useCallback(() => { setPicks([]); setSourceSnapshot(null); setSourceAnalysis(null); setSourceMulti(null); setMultiOver(null); }, []);
  const { restore, reset: resetWork, project: currentProject } = work;
  useEffect(() => {
    if (!owner || synced.current === owner) return;
    // 다른 화면(settings-panel)과 같이 한 박자 뒤(microtask)에 되살린다. 그사이 화면이 사라지면 아무것도 하지 않는다.
    // 되살리기는 화면 상태만 바꾸고 분석·저장 요청은 보내지 않는다.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const previous = synced.current;
      synced.current = owner;
      // 같은 화면에서 확인된 계정이 바뀌었으면 앞 계정의 작업을 먼저 비운다(앞 계정 작업이 새 계정 이름으로 남지 않게).
      if (previous !== null) { resetWork(); clearSource(); setView("home"); }
      const raw = shortsTabStorage.read();
      const saved = readShortsTab(raw, owner);
      if (saved) {
        restore(saved.session, saved.project);
        setPicks(saved.picks); setSourceSnapshot(saved.snapshot); setSourceAnalysis(saved.analysis); setSourceMulti(saved.multi);
        setMultiOver(saved.multiOver ? saved.session.context : null);
        setView(saved.view);
      } else if (raw !== null) {
        // 다른 계정·주인 없는 예전 글·만료·깨진 글은 되살리지 않고 지운다.
        shortsTabStorage.clear();
      }
      setTabOwner(owner);
    });
    return () => { active = false; };
  }, [owner, restore, resetWork, clearSource]);
  const cleared = !!session?.cleared;
  useEffect(() => { if (cleared) shortsTabStorage.clear(); }, [cleared]);
  useEffect(() => {
    // 확인된 주인과 맞춘 뒤에만 남긴다(되살리기 전의 빈 첫 화면이 남긴 작업을 덮지 않게, 확인 전·의심 동안에는 남기지 않게).
    if (!owner || tabOwner !== owner) return;
    // 저장 결과(work.save)가 바뀌면 프로젝트 버전도 바뀌었으므로 다시 남긴다.
    shortsTabStorage.write(writeShortsTab({ view, session: work.session, project: currentProject(), picks, snapshot: sourceSnapshot, analysis: sourceAnalysis,
      multi: sourceMulti, multiOver: multiOver !== null && multiOver === work.session.context }, owner));
  }, [owner, tabOwner, view, work.session, work.save, currentProject, picks, sourceSnapshot, sourceAnalysis, sourceMulti, multiOver]);

  // 같은 화면에서 확인된 계정이 바뀐 직후(아직 새 계정으로 맞추기 전)에는 앞 계정의 작업 화면을 그리지 않는다.
  // 비우기는 effect에서 하지만, 이 판단은 그리는 그 순간에 하므로 새 계정이 반영된 커밋에 앞 계정 표시가 DOM에 남지 않는다.
  const stale = tabOwnerStale(owner, tabOwner);
  const flow = SHORTS_FLOW.find(item => item.id === view);
  const Screen = view === "home" ? null : shortsStepScreens[view];
  const onSourceMulti = useCallback((value: ShortsSourceMultiAnalysis) => { setSourceMulti(value); setMultiOver(work.snapshot().context); }, [work]);
  // F10: 새 검색이 성공하면(실패·취소는 이 알림이 오지 않음) 앞 분석·소재·대본·프롬프트를 지금 작업에서 비운다(원본 SearchStep).
  // 저장된 프로젝트는 보관함에 그대로 남고, 아직 끝나지 않은 저장·생성의 늦은 응답은 버린다(work.reset의 epoch).
  const onSourceSnapshot = useCallback((value: ShortsSourceSnapshot) => {
    setSourceSnapshot(value); setSourceAnalysis(null); setSourceMulti(null); setMultiOver(null);
    const current = work.snapshot();
    if (current.context || work.projectId) work.reset();
  }, [work]);
  // F7: 지운 프로젝트가 지금 작업이면 작업과 ①② 화면 상태를 비운다. 다른 프로젝트를 지웠으면 아무것도 바꾸지 않는다.
  const onDeleted = useCallback((id: string) => {
    if (!work.forget(id)) return false;
    clearSource();
    return true;
  }, [work, clearSource]);
  // 저장된 프로젝트를 열면 이전 프로젝트의 검색과 분석 화면 상태를 넘기지 않는다.
  const openProject = useCallback(async (id: string) => {
    const opened = await work.open(id);
    if ("view" in opened) { clearSource(); goTo(opened.view); return null; }
    // F7: 여는 동안 지금 프로젝트가 지워져 작업을 비웠으면 ①② 화면 상태도 비운다.
    if (opened.cleared) clearSource();
    return opened.message;
  }, [work, clearSource, goTo]);
  const startNew = () => { work.reset(); clearSource(); goTo("search"); };
  const stepProps = {
    pick, goTo: requestView, settingsHref: SHORTS_SETTINGS_HREF, work,
    onPick: setPick, picks, onPicks: setPicks, sourceSnapshot, onSourceSnapshot, sourceAnalysis, onSourceAnalysis: setSourceAnalysis,
    sourceMulti, onSourceMulti,
    newerMulti: multiOver !== null && multiOver === work.session.context ? sourceMulti : null,
  };
  // 홈 '이어서 작업하기'는 영상을 여러 개 골랐으면 첫 영상 이름에 개수를 붙인다(단계는 ② 그대로).
  const resumePick = pick && picks.length > 1 ? { title: `${pick.title} 외 ${picks.length - 1}개` } : pick;
  const title = view === "home" ? "바이럴 스튜디오 홈" : flow ? `${flow.step}. ${flow.label}` : "프롬프트 보관함";

  const body = stale ? <p role="status" data-owner-sync="">로그인 계정이 바뀌어 작업 화면을 새 계정에 맞추고 있어요.</p> : <>
    <div className={s.viewHead} data-view={view}>
      <h2 ref={heading} tabIndex={-1} className={view === "home" ? "sr-only" : s.viewTitle}>{flow && <span aria-hidden="true">{flow.icon} </span>}{title}</h2>
      {flow && <p className={s.viewDesc}>{flow.desc}</p>}
    </div>
    {leave !== null && <div className={s.leaveBox} role="alertdialog" aria-labelledby={`${menuId}-leave`} aria-describedby={`${menuId}-leave-text`}>
      <p id={`${menuId}-leave`} className={s.leaveTitle}>지금 Gemini가 결과를 만들고 있어요.</p>
      <p id={`${menuId}-leave-text`} className={s.leaveText}>다른 화면으로 가면 만들던 결과가 취소돼요. 이미 보낸 요청의 사용량은 돌려받지 못할 수 있어요.</p>
      <div className={s.leaveActions}>
        <button ref={stayButton} type="button" className={s.primary} onClick={stay}>머무르기</button>
        <button type="button" className={s.ghost} onClick={leaveNow}>취소하고 이동</button>
      </div>
    </div>}
    <p role="status" className={leftNote ? s.leaveNote : "sr-only"}>{leftNote ? "만들던 결과를 취소하고 옮겼어요. 그 단계로 돌아가 다시 만들 수 있어요." : ""}</p>
    {view !== "home" && <ShortsSaveBar work={work} onOpen={id => void openProject(id)} />}
    {view === "home" ? <ShortsHome resume={resumeOf(work.session, resumePick)} goTo={requestView} onOpen={openProject} onNew={startNew} currentId={work.projectId} onDeleted={onDeleted} />
      : Screen ? <Screen {...stepProps} />
      : <ShortsReadyStep view={view as "ideate" | "select" | "script" | "prompts" | "vault"} goTo={requestView} />}
  </>;
  const shell = <div ref={root} className={embedded ? `${s.app} ${s.embedded}` : s.app} data-shorts-shell="" data-layout={embedded ? "embedded" : "page"}>
    <aside className={s.side} aria-label={`${SHORTS_APP.full} 사이드바`}>
      <Brand onHome={() => requestView("home")} confirmed={confirmed} />
      <NavBody view={view} onView={requestView} account={account} confirmed={confirmed} embedded={embedded} />
    </aside>
    <div className={s.mobile}>
      <div className={s.mobileBar}>
        <button type="button" className={s.mobileBrand} onClick={() => pickView("home")} aria-label={`${SHORTS_APP.full} ${SHORTS_APP.version} 홈으로`} disabled={!confirmed}>
          <span className={s.mobileIcon} aria-hidden="true">▶</span>
          <span className={s.mobileName}>{SHORTS_APP.line1} {SHORTS_APP.line2}</span>
          <span className={s.version}>{SHORTS_APP.version}</span>
        </button>
        <button ref={toggle} type="button" className={s.menuButton} aria-label={open ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={open} aria-controls={menuId}
          onClick={() => setOpen(value => !value)}>
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
      </div>
      {open && <div id={menuId} className={s.drawer}>
        <NavBody view={view} onView={pickView} account={account} confirmed={confirmed} embedded={embedded} />
      </div>}
    </div>
    {embedded ? <div className={s.main}>
      <section className={s.inner} aria-label={SHORTS_APP.full}>{body}</section>
    </div> : <main className={s.main} id="main-content">
      <div className={s.inner}><ProtectedContent>
        <h1 className="sr-only">{SHORTS_APP.full}</h1>
        {body}
      </ProtectedContent></div>
    </main>}
  </div>;
  return embedded ? <div className={s.embedHost}>{shell}</div> : shell;
}
