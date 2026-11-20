"use client";

// T-240 공개 메인 NEON SCREEN. 방문자가 공개 작품을 둘러보는 화면이다.
// 자료는 props로만 받는다(개인 프로젝트·초안·저장 파일을 읽지 않음). 재생 파일이 없으면 정지 이미지와 안내만 보여 준다.
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { SHOWCASE_FILTERS, creatorInitials, filterWorks, type ShowcaseFilter, type ShowcaseWork } from "@/lib/public-showcase/works";
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

export function NeonShowcase({ works, status = "ready", onRetry, featuredId, collectionIds, loginHref = "/login", adminHref = "/admin/login" }: NeonShowcaseProps) {
  const uid = useId();
  const ids = { main: `${uid}-main`, browse: `${uid}-browse`, creators: `${uid}-creators`, search: `${uid}-search`, status: `${uid}-status`, detailTitle: `${uid}-detail-title`, hero: `${uid}-hero` };
  const [filter, setFilter] = useState<ShowcaseFilter>("전체");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const featured = works.find((work) => work.id === featuredId) ?? works.find((work) => work.kind !== "음악") ?? works[0];
  const collection = (collectionIds ? collectionIds.map((id) => works.find((work) => work.id === id)) : works.filter((work) => work.kind === "음악"))
    .filter((work): work is ShowcaseWork => !!work).slice(0, 3);
  const visible = useMemo(() => filterWorks(works, filter, query), [works, filter, query]);
  const opened = openId ? works.find((work) => work.id === openId) ?? null : null;
  const hasSample = works.some((work) => work.sample);

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
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
    list = visible.map((work) => (
      <article key={work.id} className={styles.work}>
        <button type="button" className={styles.poster} aria-label={`${work.title} 자세히 보기`} onClick={(event) => openDetail(work, event.currentTarget)}>
          <Image src={work.image.src} alt="" width={work.image.width} height={work.image.height} sizes="(max-width: 760px) 80vw, (max-width: 1100px) 37vw, 30vw" />
          {work.sample ? <span className={styles.sample}>예시 작품</span> : null}
          <span className={styles.open} aria-hidden="true">▶</span>
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
    ));
  }

  return (
    <div className={styles.root}>
      <a href={`#${ids.main}`} className={styles.skip}>본문으로 건너뛰기</a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Dream SCREEN 처음 화면">
          <span className={styles.brandSymbol} aria-hidden="true">✦</span>DREAM <em>SCREEN</em>
        </Link>
        <nav className={styles.nav} aria-label="주 메뉴">
          <a href={`#${ids.main}`} aria-current="page" onClick={(event) => { event.preventDefault(); moveTo(ids.main); }}>발견</a>
          <a href={`#${ids.browse}`} onClick={(event) => { event.preventDefault(); moveTo(ids.browse); }}>작품</a>
          <a href={`#${ids.creators}`} onClick={(event) => { event.preventDefault(); moveTo(ids.creators); }}>크리에이터</a>
          <a href="/analysis-results">분석 결과</a>
        </nav>
        <div className={styles.search}>
          <label className={styles.srOnly} htmlFor={ids.search}>공개 작품 또는 크리에이터 검색</label>
          <span aria-hidden="true">⌕</span>
          <input ref={searchRef} id={ids.search} type="search" placeholder="작품, 종류, 크리에이터 검색" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} aria-controls={ids.browse} />
        </div>
        <Link className={`${styles.btn} ${styles.primary}`} href={loginHref}>크리에이터 로그인</Link>
      </header>
      {hasSample ? <p className={styles.notice}>지금 보이는 작품과 크리에이터는 화면을 소개하는 예시예요. 영상·음악은 아직 재생되지 않아요.</p> : null}

      <main className={styles.page} id={ids.main} tabIndex={-1}>
        {featured ? (
          <section className={styles.hero} aria-labelledby={ids.hero}>
            <Image src={featured.image.src} alt="" fill sizes="(max-width: 1536px) 100vw, 1536px" loading="eager" fetchPriority="high" className={styles.heroImage} />
            {featured.sample ? <span className={styles.heroBadge}>대표 작품 · 예시</span> : <span className={styles.heroBadge}>대표 작품</span>}
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>THE NIGHT IS JUST BEGINNING.</div>
              <h1 id={ids.hero}>{featured.title}</h1>
              <p>{featured.subtitle}</p>
              <div className={styles.byline}>{featured.creator} / {featured.format}</div>
              <div className={styles.actions}>
                <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={(event) => openDetail(featured, event.currentTarget)}>▶ 작품 자세히 보기</button>
                <a className={`${styles.btn} ${styles.ghost}`} href={`#${ids.browse}`} onClick={(event) => { event.preventDefault(); moveTo(ids.browse); }}>다른 작품 둘러보기</a>
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.heroEmpty}><h1>DREAM SCREEN</h1><p>공개된 작품이 생기면 이곳에 대표 작품을 보여 드릴게요.</p></section>
        )}

        <div className={styles.ticker}><strong>BEYOND THE ORDINARY.</strong><span>FILMS · MUSIC · VISUAL STORIES</span><span>CURATED BY DREAM</span></div>

        <section id={ids.browse} tabIndex={-1} aria-labelledby={`${ids.browse}-title`} className={styles.browse}>
          <div className={styles.sectionHeading}>
            <div>
              <div className={`${styles.eyebrow} ${styles.muted}`}>SELECTED WORKS / DISCOVER</div>
              <h2 id={`${ids.browse}-title`}>지금 만나는 오리지널</h2>
              <p>영상부터 음악까지, 크리에이터의 새로운 시선.</p>
            </div>
            <a className={styles.link} href={`#${ids.creators}`} onClick={(event) => { event.preventDefault(); moveTo(ids.creators); }}>뮤직 컬렉션 ↗</a>
          </div>
          <div className={styles.railTools}>
            <div className={styles.filters} role="group" aria-label="콘텐츠 종류">
              {SHOWCASE_FILTERS.map((item) => (
                <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
              ))}
            </div>
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

        <section className={styles.collection} id={ids.creators} tabIndex={-1} aria-labelledby={`${ids.creators}-title`}>
          <div>
            <div className={styles.eyebrow}>SOUND MEETS VISION</div>
            <h2 id={`${ids.creators}-title`}>한 장의 커버,<br />무한한 상상.</h2>
            <p>새로운 소리와 비주얼의 만남.<br />뮤직 컬렉션을 살펴보세요.</p>
          </div>
          {collection.length ? (
            <div className={styles.miniAlbums}>
              {collection.map((work) => (
                <button key={work.id} type="button" aria-label={`${work.title} 음악 작품 자세히 보기`} onClick={(event) => openDetail(work, event.currentTarget)}>
                  <Image src={work.image.src} alt="" width={work.image.width} height={work.image.height} sizes="(max-width: 760px) 30vw, 200px" />
                  <strong>{work.title}</strong>
                </button>
              ))}
            </div>
          ) : <p>공개된 음악 작품이 생기면 이곳에 모아 보여 드릴게요.</p>}
        </section>

        <footer className={styles.footer}>
          <p>DREAM · PUBLIC SHOWCASE{hasSample ? <><br />예시 작품과 크리에이터는 화면 소개용이에요.</> : null}</p>
          <div className={styles.footerLinks}>
            <Link className={styles.link} href={loginHref}>크리에이터 로그인 ↗</Link>
            <Link className={`${styles.link} ${styles.adminLink}`} href={adminHref}>관리자 로그인</Link>
          </div>
        </footer>
      </main>

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={ids.detailTitle} onClose={onDialogClose} onKeyDown={trapTab}>
        {opened ? (
          <>
            <div className={styles.detailHead}>
              <div>
                <div className={`${styles.eyebrow} ${styles.muted}`}>{opened.sample ? "PUBLIC SHOWCASE / 예시 작품" : "PUBLIC SHOWCASE"}</div>
                <h2 id={ids.detailTitle}>{opened.title}</h2>
              </div>
              <button type="button" className={styles.iconBtn} aria-label="자세히 보기 닫기" autoFocus onClick={() => dialogRef.current?.close()}>×</button>
            </div>
            <p>{opened.creator} · {opened.format} · {opened.subtitle}</p>
            <div className={`${styles.detailMedia} ${opened.kind === "음악" ? styles.audio : ""}`}>
              {opened.media?.kind === "video" ? (
                <video src={opened.media.src} poster={opened.image.src} controls preload="none" playsInline aria-label={`${opened.title} 영상`} />
              ) : (
                <Image src={opened.image.src} alt={`${opened.title} 대표 이미지`} width={opened.image.width} height={opened.image.height} sizes="(max-width: 840px) 100vw, 800px" />
              )}
            </div>
            {opened.media?.kind === "audio" ? <audio className={styles.audioPlayer} src={opened.media.src} controls preload="none" aria-label={`${opened.title} 음악`} /> : null}
            <p>{opened.description}</p>
            {opened.media ? null : (
              <div className={styles.infoNote} role="note">
                아직 재생할 수 있는 {opened.kind === "음악" ? "음악" : "영상"} 파일이 연결되지 않았어요. 지금은 대표 이미지만 볼 수 있어요.
              </div>
            )}
          </>
        ) : null}
      </dialog>
    </div>
  );
}

export default NeonShowcase;
