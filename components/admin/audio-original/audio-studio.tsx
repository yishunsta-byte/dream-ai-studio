"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AdminAudioMode } from "@/lib/reference-analysis/admin-audio-contract";
import { AdminAudioUpload, megabytes, type UploadState } from "../admin-audio-upload";
import { AudioWaveform } from "../admin-audio-waveform";
import { AdminMusicSemantic } from "../admin-music-semantic";
import { UPLOAD_SIZE_LIMIT_LABEL } from "../admin-reference-analysis-model";
import { ADMIN_SETTINGS_HREF } from "../admin-settings-link";
import type { PublicationDraft } from "../admin-reference-analysis-model";
import { AUDIO_ACCEPT, directAudioIssue, directAudioLimit, guidance, guidanceLimit, largeAudioIssue } from "../audio-upload-client";
import { AudioGuide } from "./audio-guide";
import { Activity, ArrowRight, BookOpen, Cpu, FileAudio, Menu, Mic, Music, Sparkles, Trash2, UploadCloud, X } from "./icons";
import s from "./audio-studio.module.css";

// P1-07 A-1 Audio Analyzer 원본(v1.15) 화면 셸: 사이버 네온 다크 사이드바(브랜드·ENGINE MODE·WORKFLOW·안내 카드·설정)와
// 상단 상태 바·히어로·핵심 카드 3개·단일 업로더(모드 탭·드롭존·파형·파일 정보·사용자 컨텍스트·특별 요청)를 이 칸 안에 옮겼다
// (원본 AudioAnalyzerApp.tsx·Sidebar.tsx·AudioUploader.tsx). 사이드바와 업로더 탭은 한 모드 상태를 같이 쓰고 기본은 auto, 보고서는 상세 v2가 기본이며
// 기본 보고서(v1)도 고를 수 있다(Master msg_ddaf6d6e5f4a). 분석·동의·전송·취소·유실 보호는 기존 부품(admin-music-semantic·admin-audio-upload)을 그대로 쓴다.
// 경로: 4 MiB 이하이고 맥락·특별 요청이 비어 있으면 바로 분석, 4 MiB 초과이거나 맥락·특별 요청이 있으면 보호 업로드(접수가 시작되면 '새로 올리기' 전까지 그 경로 유지).
// 원본의 회원 키 모달·평문 키 저장·alert·로그아웃·사용 매뉴얼 페이지는 옮기지 않았다(API연동은 관리자 설정으로 연결).
// A-2: FLAC 선택·표기(서버 3580c96과 같은 audioFormatFromFilename 판정)와 큰 파일 파형(원본처럼 모든 파일을 브라우저에서 디코딩, 실패해도 재생 유지). 원본 보고서 배치는 A-3.
// A-4: 원본 Sidebar.tsx 모바일 머리 바·드로어처럼 좁은 칸(860px 미만)은 브랜드와 접힌 메뉴 단추 한 줄 → 상태 바 → 업로더·결과 순서다.
// 단추(aria-expanded)로 ENGINE MODE·WORKFLOW·설정 링크를 펼치고, 모드를 고르거나 Esc를 누르면 닫고 초점을 단추로 돌린다(설정 링크는 닫기만).
// 넓은 칸은 단추를 숨기고 256px 사이드바를 늘 펼친다. 관리자 화면 안의 칸이라 원본의 화면 고정 머리 바·전체 덮개 대신 칸 안에서 펼친다.
// A-4 보완(Tester msg_a62bae05c722·Design msg_1763f376f7ff): 칸 폭이 860px 경계를 넘어 초점 있던 사이드바 요소가 숨으면(넓어지며 메뉴 단추,
// 좁아지며 닫힌 메뉴의 모드·링크) 초점이 문서로 빠지지 않게 보이는 짝으로 잇는다. 넓으면 선택된 모드(잠겼으면 설정 링크), 좁으면 메뉴 단추.
// 계속 보이는 요소나 사이드바 밖 초점은 건드리지 않는다.
// A-5: 원본 AudioAnalyzerApp처럼 정상 완료 상세 보고서가 나오면 히어로·핵심 카드·업로더 머리·모드 탭·파일·입력·경로 안내 자리에 보고서만 보이고
// 보고서 제목에 한 번 초점을 준다. 시작·진행·실패·상세 불가는 기존 입력 흐름 그대로, 보호 업로드의 정리·새로 올리기·안내는 숨기지 않는다.
// Suno 편집·Markdown 미리보기 상자는 이 칸 안에서만 원본처럼 어두운 바탕(.run textarea).
// P1-07-AUDIO-ORIGINAL-PARITY-UI G1: 원본 Sidebar '📖 연동 & 사용 매뉴얼'·상단 바 '사용 매뉴얼'(좁은 칸에서는 원본처럼 숨김)·히어로 '사용 매뉴얼 보기'가
// 같은 이용 가이드 창(audio-guide.tsx)을 연다. 좁은 칸 메뉴에서 열면 메뉴를 닫고, 창을 닫으면 연 단추로(숨었으면 메뉴 단추로) 초점을 돌린다.
// 창 안 설정 링크로 떠나면 초점을 돌리지 않는다(사이드바 설정 링크와 같다).

type Mode = AdminAudioMode;
const engine = [
  { mode: "auto", side: "스마트 자동 판별", tab: "스마트 자동 감지", bar: "스마트 자동 감지 (Auto)", Icon: Sparkles },
  { mode: "speech", side: "음성 인텔리전스 · 회의록", tab: "음성 · 회의록", bar: "음성 인텔리전스 (Speech)", Icon: Mic },
  { mode: "music", side: "음악 분석 · Suno v6", tab: "음악 · Suno v6", bar: "음악 분석 · Suno v6 (Music)", Icon: Music },
] as const satisfies readonly { mode: Mode; side: string; tab: string; bar: string; Icon: unknown }[];
const modeHint: Record<Mode, string> = {
  auto: "먼저 음악인지 음성인지 판별하고, 판별되면 그 종류로 한 번 분석해요. 판별하지 못하면 다시 보내지 않아요.",
  speech: "말소리의 요약·주제·할 일과 화자별 전사를 분석해요.",
  music: "장르·악기·템포·구간 구조와 Suno 프롬프트를 분석해요.",
};
const flow = [
  { label: "오디오 파일 등록", description: "WAV, MP3, M4A, FLAC 등 음원 업로드" },
  { label: "Gemini 멀티모달 분석", description: "화자 분리, 포렌식, 4대 스템, Suno 역설계" },
  { label: "회의록 & 프롬프트 추출", description: "마크다운 회의록 및 프롬프트 원클릭 복사" },
];
const kpis = [
  { icon: "🤖", tone: "cyan", title: "듀얼 멀티모달 AI 엔진", text: "음성/음악 스마트 자동 감지" },
  { icon: "👥", tone: "green", title: "화자 분리 & 마크다운 회의록", text: "점유율, 액션 아이템, 원클릭 복사" },
  { icon: "✨", tone: "violet", title: "Suno v6 역설계 & 음향 포렌식", text: "Suno 프롬프트, 4대 스템, 음질 추정" },
] as const;
const idle: UploadState = { started: false, locked: false };
const visible = (node: Element | null | undefined): node is HTMLElement => !!node && node.getClientRects().length > 0;

type Props = { embedded?: boolean; onPrepare?: (draft: PublicationDraft) => void };

export function AudioStudio({ embedded = false, onPrepare }: Props = {}) {
  const settingsHref = embedded ? ADMIN_SETTINGS_HREF : `/admin${ADMIN_SETTINGS_HREF}`;
  const [mode, setMode] = useState<Mode>("auto");
  const [detail, setDetail] = useState(true);
  const [file, setFile] = useState<File>();
  const [context, setContext] = useState("");
  const [special, setSpecial] = useState("");
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reported, setReported] = useState(false);
  const [guide, setGuide] = useState(false);
  const guideFrom = useRef<HTMLElement | null>(null);
  const sideGuide = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  // A-5b(Tester msg_0a1036be4df6): 보고서가 먼저 제목에 초점을 주면 그 위치로 스크롤된 뒤 위쪽 히어로·입력이 접혀 제목이 화면 위로 사라진다.
  // 접힌 렌더가 화면에 반영된 직후(그리기 전) 여기서 한 번만 초점을 옮긴다. 다시 그려지거나 탭 이동 중에는 건드리지 않는다.
  useLayoutEffect(() => {
    if (reported) card.current?.querySelector<HTMLElement>("[data-report-heading]")?.focus();
  }, [reported]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const [upload, setUpload] = useState<{ file?: File; state: UploadState }>({ state: idle });
  const input = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const ids = useId();
  // 접수 상태는 그 파일의 것만 믿는다(파일을 바꾸면 업로드 칸이 새로 그려지고 이전 상태는 버린다).
  const state = upload.file === file ? upload.state : idle;
  const onUploadState = useCallback((next: UploadState) => setUpload({ file, state: next }), [file]);
  const locked = state.locked;

  const small = !!file && file.size <= directAudioLimit;
  const guided = !!(guidance(context) || guidance(special));
  const protectedRoute = !!file && (!small || guided || state.started);
  const issue = file && (protectedRoute ? largeAudioIssue(file) : directAudioIssue(file));
  const selected = issue ? undefined : file;
  const route = !file ? "" : !small ? "보호 업로드 · 4 MiB보다 큰 파일은 서버의 비공개 저장소에 나눠 올린 뒤 분석해요."
    : state.started && !guided ? "보호 업로드 · 접수를 시작해 ‘새로 올리기’ 전까지 이 경로로 분석해요."
    : guided ? "보호 업로드 · 사용자 컨텍스트나 특별 요청이 있어 서버의 비공개 저장소에 올린 뒤 함께 보내요."
    : "바로 분석 · 4 MiB 이하 파일을 원본 그대로 Gemini로 보내요. 컨텍스트나 요청을 적으면 보호 업로드로 바뀌어요.";

  const replace = (next?: File) => {
    if (input.current && next !== input.current.files?.[0]) input.current.value = "";
    setFile(next);
  };
  // 결과 접기도 같은 렌더에서 풀어야 다시 나타난 드롭존(파일 칸)으로 초점을 옮길 수 있다.
  const clear = () => { refocus.current = true; setReported(false); replace(undefined); };
  // 파일을 비우면 다시 나타난 드롭존(파일 칸)으로 초점을 옮긴다.
  useEffect(() => {
    if (!file && refocus.current) { refocus.current = false; input.current?.focus(); }
  }, [file]);

  useEffect(() => {
    const side = sideRef.current;
    if (!side || typeof ResizeObserver === "undefined") return;
    let last: HTMLElement | null = null;
    const enter = (event: FocusEvent) => { last = event.target as HTMLElement; };
    // 숨어서 빠진 초점(대상이 이미 안 보임)은 기억해 두고, 사용자가 다른 곳을 고른 경우만 잊는다.
    const leave = (event: FocusEvent) => { if (visible(event.target as Element)) last = null; };
    const observer = new ResizeObserver(() => {
      const active = document.activeElement;
      if (!last || visible(last) || (active !== last && active !== document.body && active !== null)) return;
      const target = [menuButton.current, side.querySelector("button[aria-pressed='true']:not(:disabled)"), side.querySelector("a[href]")].find(visible);
      last = null;
      target?.focus();
    });
    side.addEventListener("focusin", enter);
    side.addEventListener("focusout", leave);
    observer.observe(side);
    return () => { observer.disconnect(); side.removeEventListener("focusin", enter); side.removeEventListener("focusout", leave); };
  }, []);
  // 좁은 칸에서 펼친 메뉴를 닫을 때만 초점을 단추로 돌린다(넓은 칸은 단추가 숨어 있어 그대로 둔다).
  const closeMenu = (refocusButton: boolean) => {
    if (!menu) return;
    setMenu(false);
    const button = menuButton.current;
    if (refocusButton && button && getComputedStyle(button).display !== "none") button.focus();
  };
  const openGuide = (event: { currentTarget: HTMLElement }) => { guideFrom.current = event.currentTarget; closeMenu(false); setGuide(true); };
  const closeGuide = () => setGuide(false);
  const leaveGuide = () => { guideFrom.current = null; setGuide(false); };
  // 창이 닫힌 뒤(창 부품이 close를 먼저 부름) 연 단추로, 그 단추가 숨었으면 보이는 메뉴 단추·사이드바 가이드 단추로 초점을 돌린다.
  useEffect(() => {
    if (guide || !guideFrom.current) return;
    const from = guideFrom.current;
    guideFrom.current = null;
    [from, menuButton.current, sideGuide.current].find(visible)?.focus();
  }, [guide]);
  const modeButtons = (kind: "side" | "tab") => engine.map(({ mode: item, side, tab, Icon }) =>
    <button key={item} type="button" className={kind === "side" ? s.sideMode : s.tab} aria-pressed={mode === item} disabled={locked}
      onClick={() => { setMode(item); if (kind === "side") closeMenu(true); }}>
      <Icon size={kind === "side" ? 14 : 13} className={s.icon} />
      <span className={kind === "side" ? s.sideLabel : undefined}>{kind === "side" ? side : tab}</span>
      {kind === "side" && item === "auto" && <span className={s.autoBadge}>AI Auto</span>}
    </button>);

  return <div className={s.studio} data-audio-studio={embedded ? "embedded" : "standalone"}><div className={s.layout}>
    <aside ref={sideRef} className={s.side} aria-label="오디오 분석 스튜디오" data-open={menu || undefined}>
      <div className={s.brandRow}>
        <div className={s.brand}>
          <span className={s.brandIcon}><Activity size={18} /></span>
          <div className={s.brandText}>
            <p className={s.brandName}>AI Audio분석 자동화</p>
            <span className={s.version}>v1.15 AUDIO LAB</span>
          </div>
        </div>
        <button ref={menuButton} type="button" className={s.menuButton} aria-expanded={menu} aria-controls={`${ids}-menu`}
          onClick={() => setMenu(open => !open)} onKeyDown={event => { if (event.key === "Escape" && menu) { event.preventDefault(); closeMenu(true); } }}>
          {menu ? <X size={20} /> : <Menu size={20} />}<span className={s.menuLabel}>오디오 스튜디오 메뉴</span>
        </button>
      </div>
      <div id={`${ids}-menu`} className={s.menu}
        onKeyDown={event => { if (event.key === "Escape" && menu) { event.preventDefault(); closeMenu(true); } }}>
      <div className={s.sideGroup} role="group" aria-labelledby={`${ids}-engine`}>
        <p id={`${ids}-engine`} className={s.sideHead}>ENGINE MODE</p>
        <div className={s.sideModes}>{modeButtons("side")}</div>
      </div>
      <div className={s.sideGroup}>
        <p className={s.sideHead}>WORKFLOW</p>
        <ol className={s.flow}>
          {flow.map((item, index) => <li key={item.label}>
            <span className={s.flowNo} aria-hidden="true">{index + 1}</span>
            <div><p className={s.flowLabel}>{item.label}</p><p className={s.flowText}>{item.description}</p></div>
          </li>)}
        </ol>
        <div className={s.nano}>
          <p className={s.nanoHead}><Cpu size={13} className={s.icon} />나노 단위 오디오 해체</p>
          <p className={s.flowText}>고주파 포렌식부터 화자별 점유율, 회의록 및 Suno v6 역설계까지 원클릭 제공합니다.</p>
        </div>
      </div>
      <div className={`${s.sideGroup} ${s.sideFoot}`}>
        <p className={s.sideHead}>GUIDE &amp; SETTINGS</p>
        <button ref={sideGuide} type="button" className={`${s.sideLink} ${s.sideGuide}`} aria-haspopup="dialog" onClick={openGuide}>
          <BookOpen size={14} className={s.book} /><span>📖 연동 &amp; 사용 매뉴얼</span><span className={s.guideBadge} aria-hidden="true">GUIDE</span>
        </button>
        {/* 주인님 지시(2026-11-24): 왼쪽 메뉴의 API키등록·플랫폼연동 버튼은 위쪽 관리자 메뉴의 같은 항목과 겹쳐 지우고 하나로 합쳤다. */}
      </div>
      </div>
    </aside>

    <div className={s.main}>
      <div className={s.bar}>
        <p className={s.online}><span className={s.dot} aria-hidden="true" /><strong>AI Audio 분석 스튜디오 온라인</strong>
          <span className={s.sep} aria-hidden="true">|</span>
          <span className={s.engine}>엔진 모드: <strong>{engine.find(item => item.mode === mode)!.bar}</strong></span></p>
        {/* 주인님 지시(2026-11-24): 사용 매뉴얼은 왼쪽 메뉴 하나로 합치고, API 설정 버튼은 위쪽 관리자 메뉴 하나만 둔다. */}
        <div className={s.barActions}>
          {file && <button type="button" className={s.fresh} onClick={clear}>+ 새 파일 분석</button>}
        </div>
      </div>

      {!reported && <><div className={s.hero}>
        <div className={s.heroText}>
          <p className={s.chip}><span className={s.dot} aria-hidden="true" />Cyber Neon Audio Intelligence Console</p>
          <h3 className={s.heroTitle}><span aria-hidden="true">🎙️ </span>Gemini 멀티모달 오디오 인텔리전스</h3>
          <p className={s.heroLead}>음성 대화 회의록부터 Suno v6 음악 역설계, 고주파 위변조 포렌식까지. WAV, MP3 음원을 드래그앤드롭하여 사운드를 초정밀 해체하세요.</p>
        </div>
      </div>
      <ul className={s.kpis}>
        {kpis.map(item => <li key={item.title} className={s.kpi} data-tone={item.tone}>
          <span className={s.kpiIcon} aria-hidden="true">{item.icon}</span>
          <div><p className={s.kpiTitle}>{item.title}</p><p className={s.kpiText}>{item.text}</p></div>
        </li>)}
      </ul></>}

      <section ref={card} className={s.card} aria-labelledby={`${ids}-upload`} data-reported={reported || undefined}>
        {reported && <h3 id={`${ids}-upload`} className={s.srOnly}>분석 결과</h3>}
        {!reported && <><div className={s.uploaderHead}>
          <p className={s.labChip}><Sparkles size={13} className={s.icon} />Gemini 멀티모달 오디오 딥러닝 랩</p>
          <h3 id={`${ids}-upload`} className={s.uploaderTitle}>소리의 숨겨진 의미를 <span>정밀 해체하세요</span></h3>
          <p className={s.uploaderLead}>대화 음성의 맥락부터 음악의 화성학 및 음향 포렌식까지. 전문가 수준의 오디오 인사이트와 비즈니스 문서를 몇 초 만에 제공합니다.</p>
        </div>
        <div className={s.tabs} role="group" aria-label="분석 모드">{modeButtons("tab")}</div>
        <p className={s.modeHint}>{modeHint[mode]}</p>

        {!file ? <label className={s.drop} data-dragging={dragging || undefined}
          onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={event => { event.preventDefault(); setDragging(false); const dropped = event.dataTransfer.files[0]; if (dropped) replace(dropped); }}>
          <input ref={input} className={s.fileInput} type="file" accept={AUDIO_ACCEPT} onChange={event => replace(event.target.files?.[0])} />
          <span className={s.dropIcon} aria-hidden="true"><UploadCloud size={28} /></span>
          <span className={s.dropTitle}>오디오 파일을 여기에 드래그하세요</span>
          <span className={s.dropText}>또는 클릭하여 내 컴퓨터에서 탐색</span>
          <span className={s.badges}>
            <span className={s.badge}>MP3</span><span className={s.badge}>WAV</span><span className={s.badge}>M4A</span><span className={s.badge}>FLAC</span>
            <span className={s.limit}>바로 분석 {UPLOAD_SIZE_LIMIT_LABEL} · 보호 업로드 최대 100 MiB</span>
          </span>
        </label> : <div className={s.picked}>
          {selected && <AudioWaveform file={selected} />}
          <div className={s.fileBar}>
            <p className={s.fileName}><FileAudio size={16} className={s.fileIcon} /><strong>{file.name}</strong><span>({megabytes(file.size)})</span></p>
            <button type="button" className={s.swap} onClick={clear}><Trash2 size={13} className={s.icon} />파일 교체</button>
          </div>
        </div>}
        {issue && <p className={s.error} role="status">{issue}</p>}

        <div className={s.inputs}>
          <Guidance label="사용자 컨텍스트 (선택 사항)" placeholder="예: 주간 마케팅 전략 회의, K-POP 발라드 음원 데모, 1:1 심층 인터뷰 등"
            value={context} onChange={setContext} disabled={locked} />
          <Guidance label="특별 요청 사항 (선택 사항)" placeholder="예: 화자 B의 반대 의견을 중점 분석해줘, Suno v6 역설계 프롬프트와 코드 진행에 집중해줘"
            value={special} onChange={setSpecial} disabled={locked} />
          <fieldset className={s.reports} disabled={locked}>
            <legend>보고서 종류</legend>
            {([true, false] as const).map(item => <label key={String(item)}>
              <input type="radio" name={`${ids}-report`} value={item ? "detail" : "basic"} checked={detail === item} onChange={() => setDetail(item)} />
              {item ? "상세 보고서 (v2)" : "기본 보고서 (v1)"}
            </label>)}
            <p className={s.hint}>{detail ? "서버 실측·화자·질문·전사 표본·문서 정리, 음악은 화성·가사·스템 설명·음질 추정을 담아요. 분석 시간이 더 걸릴 수 있어요."
              : "요약·주제·할 일·전사 또는 장르·악기·템포·구간 구조와 Suno 프롬프트만 담아요."}</p>
            {onPrepare && <p className={s.hint}>공개 준비는 음악 모드의 기본 보고서를 바로 분석으로 만들면 사용할 수 있어요.</p>}
          </fieldset>
        </div>

        {route && <p className={s.route} aria-live="polite">{route}</p>}</>}
        <div className={s.run}>
          {selected && protectedRoute
            ? <AdminAudioUpload file={selected} mode={mode} detail={detail} context={context} special={special} onState={onUploadState} onReset={clear} onReport={setReported} settingsHref={settingsHref} />
            : <AdminMusicSemantic file={selected} mode={mode} detail={detail} onReset={clear} onReport={setReported} onPrepare={onPrepare} settingsHref={settingsHref} />}
        </div>
      </section>
      <p className={s.foot}><ArrowRight size={13} className={s.icon} />{protectedRoute
        ? "‘서버에 올리기’를 누르면 서버의 비공개 저장소에 올리고, 분석 버튼을 누를 때 Gemini로 보내요."
        : "파일은 분석 버튼을 누를 때 Gemini로 보내요."}</p>
    </div>
  </div>
  <AudioGuide id={`${ids}-guide`} open={guide} onClose={closeGuide} onNavigate={leaveGuide} settingsHref={settingsHref} />
  </div>;
}

function Guidance({ label, placeholder, value, onChange, disabled }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  const count = [...value.trim()].length;
  return <div className={s.field}>
    <label htmlFor={id}>{label}</label>
    <textarea id={id} rows={2} value={value} disabled={disabled} placeholder={placeholder} aria-describedby={`${id}-count`} aria-invalid={count > guidanceLimit}
      onChange={event => onChange(event.target.value)} />
    <p id={`${id}-count`} className={s.count}>{count.toLocaleString("ko-KR")} / {guidanceLimit.toLocaleString("ko-KR")}자 · 앞뒤 공백은 빼고 보내요.</p>
  </div>;
}
