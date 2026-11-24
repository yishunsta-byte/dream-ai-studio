"use client";

// T-240 공개 메인 NEON SCREEN. 방문자가 공개 작품을 둘러보는 화면이다.
// 자료는 props로만 받는다(개인 프로젝트·초안·저장 파일을 읽지 않음). 재생 파일이 없으면 표지와 재생 미연결 안내만 보여 준다.
// 표지를 불러오는 중이거나 실패하면 깨진 그림 대신 고정 바탕과 상태 문구를 보여 준다(T360).
import Image from "next/image";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { installShowcaseGuard } from "@/lib/public-showcase/showcase-guard-runtime";
import { SHOWCASE_FILTERS, creatorInitials, filterWorks, isShowcaseFilter, type ShowcaseFilter, type ShowcaseWork } from "@/lib/public-showcase/works";
import styles from "./neon-showcase.module.css";

export type ShowcaseStatus = "ready" | "loading" | "error";

export type NeonShowcaseProps = {
  works: readonly ShowcaseWork[];
  status?: ShowcaseStatus;
  onRetry?: () => void;
  featuredId?: string;
  collectionIds?: readonly string[];
  loginHref?: string;
  adminHref?: string;
  // 주소의 ?kind= 값(검증 전). 정해진 종류만 첫 선택으로 쓰고 그 밖은 '전체'. 화면 준비 전 첫 클릭(아래 GET 폼)이 이 값으로 반영된다.
  requestedFilter?: string | readonly string[];
};

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function moveTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
}

// T360(T359 명세): 표지 이미지 상태. 화면은 같은 주소의 상태를 한곳에서 함께 쓴다(대표·카드·음악·상세).
// - 주소(작품·표지 세대)가 바뀌면 새 주소는 "loading"에서 다시 시작한다(이전 성공·실패를 이어 쓰지 않음).
// - 실패는 404·네트워크·디코딩을 구분하지 않고 같은 문구다. 실패한 주소는 이미지 요소를 빼서 다시 요청하지 않는다.
// - 브라우저 오류만으로는 미연결·철회를 알 수 없고, 지금 DTO에 미연결 신호가 없어 "미연결" 문구는 쓰지 않는다.
type CoverState = "loading" | "loaded" | "error";
type Cover = Readonly<{
  state: CoverState;
  // 서버 HTML의 이미지는 수화 전에 끝날 수 있어, 이미지가 연결될 때 이미 끝났는지 확인한다.
  attach: (image: HTMLImageElement | null) => void;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError: () => void;
}>;

function CoverPlate({ state, id, short = false }: { state: CoverState; id?: string; short?: boolean }) {
  if (state === "loaded") return null;
  const text = state === "loading" ? "표지 불러오는 중" : short ? "표지 조회 실패" : "표지를 불러오지 못했어요";
  return (
    <span className={styles.coverPlate}>
      <span className={styles.coverIcon} aria-hidden="true" />
      <span id={id} className={styles.coverText}>{text}</span>
    </span>
  );
}

// 재생 파일이 없는 상세, 또는 음악 재생 파일이 있는 상세의 표지 자리.
// 연 뒤에 표지가 늦게 실패한 경우에만 짧게 한 번 알린다(초점은 옮기지 않음, 재생 안내와 별개).
function DetailCover({ work, cover, audio }: { work: ShowcaseWork; cover: Cover; audio: boolean }) {
  const [openedWhileLoading] = useState(cover.state === "loading");
  return <>
    <div className={`${styles.detailMedia} ${audio ? styles.audio : ""}`}>
      <CoverPlate state={cover.state} />
      {cover.state === "error" ? null : (
        <Image ref={(image) => cover.attach(image)} onLoad={cover.onLoad} onError={cover.onError} unoptimized={!work.sample} src={work.image.src} alt={`${work.title} 대표 이미지`} width={work.image.width} height={work.image.height} sizes="(max-width: 840px) 100vw, 800px" />
      )}
    </div>
    <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      {openedWhileLoading && cover.state === "error" ? "표지를 불러오지 못했어요" : null}
    </div>
  </>;
}

function WorkMedia({ work, media, cover }: { work: ShowcaseWork; media: NonNullable<ShowcaseWork["media"]>; cover: Cover }) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [started, setStarted] = useState(false);
  const statusId = useId();

  useLayoutEffect(() => {
    const element = player.current;
    return () => element?.pause();
  }, []);

  function finishLoading(event: SyntheticEvent<HTMLMediaElement>) {
    if (!event.currentTarget.error) setState((current) => current === "loading" ? "idle" : current);
  }

  function buffer(event: SyntheticEvent<HTMLMediaElement>) {
    const element = event.currentTarget;
    if (!element.paused && !element.error) setState("loading");
  }

  function retry() {
    const element = player.current;
    if (!element) return;
    element.focus();
    setState("loading");
    element.preload = "auto";
    element.load();
  }

  const playerProps = {
    src: media.src,
    controls: true,
    preload: "none",
    tabIndex: 0,
    "aria-describedby": statusId,
    onPlay: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget.readyState < 3) buffer(event);
    },
    onWaiting: buffer,
    onPlaying: (event: SyntheticEvent<HTMLMediaElement>) => {
      setStarted(true);
      finishLoading(event);
    },
    onCanPlay: finishLoading,
    onPause: finishLoading,
    onError: () => setState("error"),
  };

  return <>
    {media.kind === "video" ? (
      <div className={styles.detailMedia}>
        {/* poster 요청 실패는 영상 재생 오류가 아니다(재생 상태는 영상 자체 이벤트로만 정한다).
            T360-F1: 이미 실패한 표지 주소는 poster로 다시 요청하지 않는다. 대체 바탕은 영상 위에 올리되 조작 줄은 비우고
            누름은 영상으로 통과시킨다(pointer-events 없음). 실제 재생이 시작되면 내린다. 플레이어·재생 오류는 그대로다. */}
        {cover.state === "error" && !started ? <span className={styles.mediaPlate}><CoverPlate state="error" /></span> : null}
        <video {...playerProps} ref={(element) => { player.current = element; }} poster={cover.state === "error" ? undefined : work.image.src} playsInline aria-label={`${work.title} 영상`} />
      </div>
    ) : <DetailCover work={work} cover={cover} audio />}
    {media.kind === "audio" ? (
      <audio {...playerProps} ref={(element) => { player.current = element; }} className={styles.audioPlayer} aria-label={`${work.title} 음악`} />
    ) : null}
    <div className={state === "idle" ? undefined : styles.mediaFeedback}>
      <div id={statusId} role="status" aria-live="polite" aria-atomic="true">
        {state === "loading" ? "재생 파일을 불러오고 있어요." : null}
        {state === "error" ? "재생 파일을 불러오지 못했어요. 다시 시도해 주세요." : null}
      </div>
      {state === "error" ? <button type="button" className={styles.btn} onClick={retry}>재생 파일 다시 불러오기</button> : null}
    </div>
  </>;
}

export function NeonShowcase({ works, status = "ready", onRetry, featuredId, collectionIds, loginHref = "/login", adminHref = "/admin/login", requestedFilter }: NeonShowcaseProps) {
  const uid = useId();
  const ids = { main: `${uid}-main`, browse: `${uid}-browse`, collection: `${uid}-collection`, search: `${uid}-search`, status: `${uid}-status`, detailTitle: `${uid}-detail-title`, hero: `${uid}-hero` };
  const [filter, setFilter] = useState<ShowcaseFilter>(() => (isShowcaseFilter(requestedFilter) ? requestedFilter : "전체"));
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [coverStates, setCoverStates] = useState<ReadonlyMap<string, CoverState>>(() => new Map());

  // 실패는 그 주소에서 되돌리지 않는다(자동 재요청 없음). 같은 값이면 상태를 바꾸지 않는다.
  const settleCover = useCallback((src: string, next: "loaded" | "error") => {
    setCoverStates((current) => {
      const previous = current.get(src);
      if (previous === next || previous === "error") return current;
      return new Map(current).set(src, next);
    });
  }, []);
  function coverFor(src: string): Cover {
    return {
      state: coverStates.get(src) ?? "loading",
      attach: (image) => {
        if (image?.complete && image.currentSrc) settleCover(src, image.naturalWidth > 0 ? "loaded" : "error");
      },
      onLoad: (event) => settleCover(src, event.currentTarget.naturalWidth > 0 ? "loaded" : "error"),
      onError: () => settleCover(src, "error"),
    };
  }

  const featured = works.find((work) => work.id === featuredId) ?? works.find((work) => work.kind !== "음악") ?? works[0];
  const collection = (collectionIds ? collectionIds.map((id) => works.find((work) => work.id === id)) : works.filter((work) => work.kind === "음악"))
    .filter((work): work is ShowcaseWork => !!work).slice(0, 3);
  const visible = useMemo(() => filterWorks(works, filter, query), [works, filter, query]);
  const opened = openId ? works.find((work) => work.id === openId) ?? null : null;
  const heroCover = featured ? coverFor(featured.image.src) : null;

  // T-255-F1/F2/F3: 홈을 오가는 링크는 모두 일반 <a>(새 문서)다. bfcache 복원 가드는 먼저 문서 인라인 스크립트가 설치한다.
  // 인라인 스크립트가 CSP로 막혀도 이 번들이 돌면 같은 가드를 설치한 뒤에만 승인 영역을 드러낸다(중복 설치 없음).
  useEffect(() => { installShowcaseGuard(window); }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (opened && !dialog.open) dialog.showModal();
    if (!opened && dialog.open) dialog.close();
  }, [opened]);

  function openDetail(work: ShowcaseWork, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setOpenId(work.id);
  }

  // 닫으면 연 버튼으로 돌려준다. 그 버튼이 사라졌으면(필터 변경 등) 작품 영역으로 보낸다.
  function onDialogClose() {
    setOpenId(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger?.isConnected && trigger.getClientRects().length > 0) trigger.focus();
    else document.getElementById(ids.browse)?.focus();
  }

  function trapTab(event: ReactKeyboardEvent<HTMLDialogElement>) {
    // The browser manages the tab order inside native media controls.
    if (event.key !== "Tab" || opened?.media) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function pauseDetailMedia() {
    dialogRef.current?.querySelector<HTMLMediaElement>("video, audio")?.pause();
  }

  function chooseFilter(item: ShowcaseFilter) {
    setFilter(item);
    const url = new URL(window.location.href);
    if (url.searchParams.has("kind")) {
      url.searchParams.delete("kind");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  function resetFilters() {
    setFilter("전체");
    setQuery("");
    searchRef.current?.focus();
  }

  function scrollRail(direction: 1 | -1) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.75, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  const statusText = status === "loading" ? "작품을 불러오고 있어요" : status === "error" ? "작품 목록을 불러오지 못했어요" : `작품 ${visible.length}개`;
  // T357(F255-R2): 대표·음악 영역의 빈 자리 문구도 목록과 같은 상태를 말한다(장애를 "아직 작품 없음"으로 보이지 않게).
  const heroEmptyText = status === "loading" ? "대표 작품을 불러오고 있어요." : status === "error" ? "지금은 공개 작품을 불러오지 못했어요. 잠시 뒤 다시 찾아 주세요." : "공개된 작품이 생기면 이곳에 대표 작품을 보여 드릴게요.";
  const collectionEmptyText = status === "loading" ? "음악 작품을 불러오고 있어요." : status === "error" ? "음악 작품도 지금은 불러오지 못했어요." : "공개된 음악 작품이 생기면 이곳에 모아 보여 드릴게요.";

  let list: ReactNode;
  if (status === "loading") {
    list = <div className={styles.empty}><h3>작품을 불러오고 있어요</h3><p>잠시만 기다려 주세요.</p></div>;
  } else if (status === "error") {
    list = (
      <div className={styles.empty}>
        <h3>작품 목록을 불러오지 못했어요</h3>
        <p>잠시 뒤 다시 시도해 주세요.</p>
        {onRetry ? <button type="button" className={styles.btn} onClick={onRetry}>다시 시도</button> : null}
      </div>
    );
  } else if (!works.length) {
    list = <div className={styles.empty}><h3>아직 공개된 작품이 없어요</h3><p>새 작품이 공개되면 이곳에 보여 드릴게요.</p></div>;
  } else if (!visible.length) {
    list = (
      <div className={styles.empty}>
        <h3>찾는 작품이 없어요</h3>
        <p>다른 작품명이나 종류로 찾아보세요.</p>
        <button type="button" className={styles.btn} onClick={resetFilters}>검색·종류 초기화</button>
      </div>
    );
  } else {
    list = visible.map((work) => {
      const cover = coverFor(work.image.src);
      const coverId = `${uid}-card-cover-${work.id}`;
      return (
      <article key={work.id} className={styles.work}>
        <button type="button" className={styles.poster} aria-label={`${work.title} 자세히 보기`} aria-describedby={cover.state === "error" ? coverId : undefined} onClick={(event) => openDetail(work, event.currentTarget)}>
          <CoverPlate state={cover.state} id={coverId} />
          {cover.state === "error" ? null : (
            <Image ref={(image) => cover.attach(image)} onLoad={cover.onLoad} onError={cover.onError} unoptimized={!work.sample} src={work.image.src} alt="" width={work.image.width} height={work.image.height} sizes="(max-width: 760px) 80vw, (max-width: 1100px) 37vw, 30vw" />
          )}
          <span className={styles.open} aria-hidden="true">↗</span>
        </button>
        <div className={styles.workCopy}>
          <span className={styles.creatorDot} aria-hidden="true">{creatorInitials(work.creator)}</span>
          <div>
            <span className={styles.kind}>{work.format}</span>
            <h3>{work.title}</h3>
            <p>{work.creator} · {work.kind}</p>
          </div>
        </div>
      </article>
      );
    });
  }

  return (
    <div className={styles.root}>
      <a href={`#${ids.main}`} className={styles.skip}>본문으로 건너뛰기</a>
      <header className={styles.header}>
        {/* 홈은 항상 새 문서로 연다(T-255-F1). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 의도한 전체 문서 이동 */}
        <a className={styles.brand} href="/" aria-label="Dream SCREEN 처음 화면">
          <span className={styles.brandSymbol} aria-hidden="true">✦</span>DREAM <em>SCREEN</em>
        </a>
        <nav className={styles.nav} aria-label="주 메뉴">
          <a href={`#${ids.main}`} aria-current="page" onClick={(event) => { event.preventDefault(); moveTo(ids.main); }}>발견</a>
          <a href={`#${ids.browse}`} onClick={(event) => { event.preventDefault(); moveTo(ids.browse); }}>작품</a>
          <a href={`#${ids.collection}`} onClick={(event) => { event.preventDefault(); moveTo(ids.collection); }}>뮤직 컬렉션</a>
          {/* 공개 승인된 콘텐츠 분석 결과(별도 페이지). 새 문서로 연다. */}
          <a href="/analysis-results">분석 결과</a>
        </nav>
        <div className={styles.search}>
          <label className={styles.srOnly} htmlFor={ids.search}>공개 작품 또는 크리에이터 검색</label>
          <span aria-hidden="true">⌕</span>
          <input ref={searchRef} id={ids.search} type="search" placeholder="작품, 종류, 크리에이터 검색" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} aria-controls={ids.browse} />
        </div>
        <a className={`${styles.btn} ${styles.primary}`} href={loginHref}>크리에이터 로그인</a>
      </header>

      <main className={styles.page} id={ids.main} tabIndex={-1}>
        {featured && heroCover ? (
          <section className={`${styles.hero} ${heroCover.state === "loaded" ? "" : styles.heroFallback}`} aria-labelledby={ids.hero}>
            {heroCover.state === "error" ? null : (
              <Image ref={(image) => heroCover.attach(image)} onLoad={heroCover.onLoad} onError={heroCover.onError} unoptimized={!featured.sample} src={featured.image.src} alt="" fill sizes="(max-width: 1536px) 100vw, 1536px" loading="eager" fetchPriority="high" className={styles.heroImage} />
            )}
            <span className={styles.heroBadge}>대표 작품</span>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>THE NIGHT IS JUST BEGINNING.</div>
              <h1 id={ids.hero}>{featured.title}</h1>
              <p>{featured.subtitle}</p>
              <div className={styles.byline}>{featured.creator} / {featured.format}</div>
              {/* 표지 상태는 제목·설명 아래 한 줄. 자리를 미리 잡아 두어 상태가 바뀌어도 버튼이 움직이지 않는다. */}
              <div id={`${uid}-hero-cover`} className={styles.coverStatus}>
                {heroCover.state === "loading" ? "표지 불러오는 중" : heroCover.state === "error" ? "표지를 불러오지 못했어요" : null}
              </div>
              <div className={styles.actions}>
                <button type="button" className={`${styles.btn} ${styles.primary}`} aria-describedby={heroCover.state === "error" ? `${uid}-hero-cover` : undefined} onClick={(event) => openDetail(featured, event.currentTarget)}>작품 자세히 보기</button>
                <a className={`${styles.btn} ${styles.ghost}`} href={`#${ids.browse}`} onClick={(event) => { event.preventDefault(); moveTo(ids.browse); }}>다른 작품 둘러보기</a>
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.heroEmpty}><h1>DREAM SCREEN</h1><p>{heroEmptyText}</p></section>
        )}

        <div className={styles.ticker}><strong>BEYOND THE ORDINARY.</strong><span>FILMS · MUSIC · VISUAL STORIES</span><span>CURATED BY DREAM</span></div>

        <section id={ids.browse} tabIndex={-1} aria-labelledby={`${ids.browse}-title`} className={styles.browse}>
          <div className={styles.sectionHeading}>
            <div>
              <div className={`${styles.eyebrow} ${styles.muted}`}>SELECTED WORKS / DISCOVER</div>
              <h2 id={`${ids.browse}-title`}>지금 만나는 오리지널</h2>
              <p>영상부터 음악까지, 크리에이터의 새로운 시선.</p>
            </div>
            <a className={styles.link} href={`#${ids.collection}`} onClick={(event) => { event.preventDefault(); moveTo(ids.collection); }}>뮤직 컬렉션 <span aria-hidden="true">↗</span></a>
          </div>
          <div className={styles.railTools}>
            {/* 첫 클릭 미반영(T369 Tester abb0f20): 화면 준비 전에는 버튼이 GET 폼을 제출해 서버가 ?kind=로 걸러 그린다.
                준비 뒤에는 제출을 막고 화면 안에서 바로 바꾼다. 남은 ?kind=는 지워서 새로고침 때 옛 선택이 되살아나지 않게 한다. */}
            <form className={styles.filters} role="group" aria-label="콘텐츠 종류" method="get" action={`#${ids.browse}`}>
              {SHOWCASE_FILTERS.map((item) => (
                <button key={item} type="submit" name="kind" value={item} aria-pressed={filter === item} onClick={(event) => { event.preventDefault(); chooseFilter(item); }}>{item}</button>
              ))}
            </form>
            {status === "ready" && visible.length > 1 ? (
              <div className={styles.railControls}>
                <button type="button" className={styles.iconBtn} aria-label="이전 작품 보기" onClick={() => scrollRail(-1)}>←</button>
                <button type="button" className={styles.iconBtn} aria-label="다음 작품 보기" onClick={() => scrollRail(1)}>→</button>
              </div>
            ) : null}
          </div>
          <div id={ids.status} className={styles.srOnly} role="status" aria-live="polite">{statusText}</div>
          <div ref={railRef} className={styles.rail} aria-busy={status === "loading"}>{list}</div>
        </section>

        {/* 디자인 9299c2d: 주 메뉴 '뮤직 컬렉션'과 본문 '뮤직 컬렉션 ↗'은 모두 이 섹션에 도착하고, 도착 제목도 같은 이름이다.
            음악 카드가 0개여도 제목과 빈 목록 안내는 보인다. */}
        <section className={styles.collection} id={ids.collection} tabIndex={-1} aria-labelledby={`${ids.collection}-title`}>
          <div>
            <div className={styles.eyebrow}>SOUND MEETS VISION</div>
            <h2 id={`${ids.collection}-title`}>뮤직 컬렉션</h2>
            <p>한 장의 커버, 무한한 상상.</p>
          </div>
          {collection.length ? (
            <div className={styles.miniAlbums}>
              {collection.map((work) => {
                const cover = coverFor(work.image.src);
                const coverId = `${uid}-music-cover-${work.id}`;
                return (
                <button key={work.id} type="button" aria-label={`${work.title} 음악 작품 자세히 보기`} aria-describedby={cover.state === "error" ? coverId : undefined} onClick={(event) => openDetail(work, event.currentTarget)}>
                  <span className={styles.coverBox}>
                    <CoverPlate state={cover.state} id={coverId} short />
                    {cover.state === "error" ? null : (
                      <Image ref={(image) => cover.attach(image)} onLoad={cover.onLoad} onError={cover.onError} unoptimized={!work.sample} src={work.image.src} alt="" width={work.image.width} height={work.image.height} sizes="(max-width: 760px) 30vw, 200px" />
                    )}
                  </span>
                  <strong>{work.title}</strong>
                </button>
                );
              })}
            </div>
          ) : <p>{collectionEmptyText}</p>}
        </section>

        <footer className={styles.footer}>
          <p>DREAM · PUBLIC SHOWCASE</p>
          <div className={styles.footerLinks}>
            <a className={styles.link} href={loginHref}>크리에이터 로그인 ↗</a>
            <a className={`${styles.link} ${styles.adminLink}`} href={adminHref}>관리자 로그인</a>
          </div>
        </footer>
      </main>

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={ids.detailTitle} onCancel={pauseDetailMedia} onClose={onDialogClose} onKeyDown={trapTab}>
        {opened ? (
          <>
            <div className={styles.detailHead}>
              <div>
                <div className={`${styles.eyebrow} ${styles.muted}`}>PUBLIC SHOWCASE</div>
                <h2 id={ids.detailTitle}>{opened.title}</h2>
              </div>
              <button type="button" className={styles.iconBtn} aria-label="자세히 보기 닫기" autoFocus onClick={() => {
                pauseDetailMedia();
                dialogRef.current?.close();
              }}>×</button>
            </div>
            <p>{opened.creator} · {opened.format} · {opened.subtitle}</p>
            {opened.media ? (
              <WorkMedia key={JSON.stringify([opened.id, opened.media.kind, opened.media.src])} work={opened} media={opened.media} cover={coverFor(opened.image.src)} />
            ) : (
              <DetailCover key={JSON.stringify([opened.id, opened.image.src])} work={opened} cover={coverFor(opened.image.src)} audio={opened.kind === "음악"} />
            )}
            <p>{opened.description}</p>
            {/* 재생 안내는 표지 상태와 따로 말한다(대표 이미지가 있다고 전제하지 않음). */}
            {opened.media ? null : (
              <div className={styles.infoNote} role="note">
                재생할 수 있는 {opened.kind === "음악" ? "음악" : "영상"} 파일이 아직 연결되지 않았어요.
              </div>
            )}
          </>
        ) : null}
      </dialog>
    </div>
  );
}

export default NeonShowcase;
