"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./admin.module.css";
import { apiPlatformLabel, homeSectionId, imageShareSection, reviewSectionId, styleDnaPath } from "./admin-paths";

// P1-06: 이미지 타일은 원본 Style DNA v1.39 전체 화면(관리자 보호 경로)으로 연다.
// 사용자 재확인(2026-11-22, Master msg_a94edde8a427): 기존 이미지 주소(#admin-style-dna·#admin-reference-analysis: 북마크·로그인 뒤 복귀·매뉴얼 링크)도
// 같은 원본 화면으로 보낸다. 지금 기록 칸을 바꿔(location.replace) 뒤로 가기가 다시 이 주소로 돌아와 되튀지 않게 하고, 옮기는 동안 구 이미지 칸은 활성으로 그리지 않는다.
// 기존 이미지 분석 결과 공개 준비(ImageWorkspace·onPrepare)는 '완성본 검수·게시'의 링크에서 #admin-image-publication으로만 연다(Master msg_a1ce2d023258).
// 경로 상수는 서버 컴포넌트도 쓰므로 admin-paths.ts(지시어 없음)에 둔다.
// 관리자 홈 2안(Master msg_d8399b51662f·msg_5ec7848cc1ad): /admin 기본 칸과 '콘텐츠 분석기' 메뉴는 운영 현황 홈(#admin-home)으로 연다.
// 홈에서는 분석 프로그램 줄을 숨기고 하단 배너 세 개만 진입점으로 둔다. 기존 #admin-analysis-results(분석 결과 공개 준비·게시·철회)와
// 프로그램 칸(#admin-music-analysis·#admin-shorts-analysis)은 같은 주소·뒤로 가기·즐겨찾기로 그대로 열리고, 메뉴에서는 '콘텐츠 분석기'가 현재로 보인다.
export const analysisPrograms = [
  { id: "admin-style-dna", label: "이미지 분석", detail: "색감·조명·구도 분석과 한영 프롬프트", icon: "flask", href: styleDnaPath },
  { id: "admin-music-analysis", label: "음악 분석", detail: "장르·악기·템포 분석과 Suno 프롬프트", icon: "clock" },
  { id: "admin-shorts-analysis", label: "쇼츠 분석", detail: "첫 장면·영상 구성 분석과 연출 프롬프트", icon: "play" },
] as const satisfies readonly { id: string; label: string; detail: string; icon: IconName; href?: string }[];

const legacyImageIds = new Set<string>(["admin-style-dna", "admin-reference-analysis"]);
function isLegacyImageHash(hash: string) {
  try { return legacyImageIds.has(decodeURIComponent(hash.slice(1))); } catch { return false; }
}
const legacyOverviewHash = "#admin-overview";
const programNavigationId = "admin-program-navigation";
export const analysisResultsSection = "admin-analysis-results";
export const accountSettingsId = "admin-account";
const apiIntegrationsId = "admin-api-integrations";
const operations = [
  { id: homeSectionId, label: "콘텐츠 분석기", icon: "flask" },
  { id: "admin-project-list", label: "내 프로젝트", icon: "folder" },
  { id: "admin-review", label: "완성본 검수·게시", icon: "check" },
  { id: "admin-render-queue", label: "렌더 대기열", icon: "clock" },
  { id: accountSettingsId, label: apiPlatformLabel, icon: "settings" },
  { id: "admin-operations-availability", label: "운영 연결 범위", icon: "lock" },
  { id: "admin-manual", label: "사용매뉴얼", icon: "info" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

const sections = [...analysisPrograms, ...operations, { id: analysisResultsSection }, { id: imageShareSection }];

function isAnalysisSection(id: string) {
  return id === analysisResultsSection || analysisPrograms.some(program => program.id === id);
}

function subscribeLocation(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const defaultSection = () => homeSectionId;

const serverHash = () => "";
const browserHash = () => window.location.hash;

function sectionFromHash(hash: string) {
  try {
    const id = decodeURIComponent(hash.slice(1));
    // 원본 화면으로 옮기는 동안에는 구 이미지 칸 대신 콘텐츠 분석기를 현재로 둔다.
    if (legacyImageIds.has(id)) return analysisResultsSection;
    if (id === apiIntegrationsId) return accountSettingsId;
    return sections.find((section) => section.id === id)?.id ?? defaultSection();
  } catch {
    return defaultSection();
  }
}

function focusSection(id: string) {
  const section = document.getElementById(id);
  const heading = section?.querySelector<HTMLElement>("h2, h3") ?? section;
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  const programNavigation = isAnalysisSection(id)
    ? document.getElementById(programNavigationId)
    : null;
  if (programNavigation) {
    const top = programNavigation.getBoundingClientRect().top;
    const bottom = heading.getBoundingClientRect().bottom;
    const offset = parseFloat(getComputedStyle(programNavigation).scrollMarginTop) || 0;
    const height = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
    if (bottom - top + offset <= height) {
      if (top < offset || bottom > height) programNavigation.scrollIntoView({ block: "start" });
      return;
    }
  }
  heading.scrollIntoView({ block: "start" });
}

export function navigateAdminSection(id: string) {
  const oldURL = location.href;
  const hash = `#${id}`;
  if (location.hash === hash) {
    focusSection(id);
    return;
  }
  history.pushState(history.state, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
}

export function useAdminSection() {
  return sectionFromHash(useSyncExternalStore(subscribeLocation, browserHash, serverHash));
}

export function AdminProgramNavigation() {
  const current = useAdminSection();
  return <nav id={programNavigationId} className={styles.programNavigation} aria-label="분석 프로그램" hidden={!isAnalysisSection(current)}>
    <ul className={styles.programLinks}>
      {analysisPrograms.map((program) => <li key={program.id}>
        <a href={"href" in program ? program.href : `#${program.id}`} aria-current={program.id === current ? "location" : undefined}>
          <Icon name={program.icon} /><span><strong>{program.label}</strong><small>{program.detail}</small></span>
        </a>
      </li>)}
    </ul>
  </nav>;
}

export function AdminNavigation() {
  const hash = useSyncExternalStore(subscribeLocation, browserHash, serverHash);
  const current = sectionFromHash(hash);
  const currentMenu = isAnalysisSection(current) ? homeSectionId : current === imageShareSection ? reviewSectionId : current;
  const visitedSection = useRef(false);
  const navigation = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const menu = navigation.current;
    const workspace = menu?.parentElement;
    if (!menu || !workspace) return;

    const viewport = window.visualViewport;
    let focusFrame = 0;
    let viewportHeight = window.innerHeight;
    let checkViewport = false;
    const revealFocusedControl = () => {
      focusFrame = 0;
      const resized = checkViewport;
      checkViewport = false;
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || !workspace.contains(element) || menu.contains(element)) return;
      const header = menu.getBoundingClientRect();
      const target = element.getBoundingClientRect();
      const covered = menu.dataset.sticky === "true" && header.top <= 1 && target.top < header.bottom && target.bottom > header.top;
      if (covered || (resized && (target.top < 0 || target.bottom > viewportHeight))) {
        element.scrollIntoView({ block: "start", inline: "nearest" });
      }
    };
    const scheduleReveal = () => {
      if (!focusFrame) focusFrame = requestAnimationFrame(revealFocusedControl);
    };
    const updateOffset = () => {
      const height = Math.ceil(menu.getBoundingClientRect().height);
      viewportHeight = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      const sticky = height > 0 && height <= viewportHeight / 2;
      menu.dataset.sticky = String(sticky);
      workspace.style.setProperty("--admin-nav-height", `${sticky ? height : 0}px`);
      checkViewport = true;
      scheduleReveal();
    };

    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(menu);
    window.addEventListener("resize", updateOffset);
    viewport?.addEventListener("resize", updateOffset);
    workspace.addEventListener("focusin", scheduleReveal);
    const followSectionLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      const id = link?.hash.slice(1);
      if (!id || (id !== apiIntegrationsId && !sections.some(section => section.id === id))) return;
      event.preventDefault();
      navigateAdminSection(id);
    };
    workspace.addEventListener("click", followSectionLink);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      viewport?.removeEventListener("resize", updateOffset);
      workspace.removeEventListener("focusin", scheduleReveal);
      workspace.removeEventListener("click", followSectionLink);
      cancelAnimationFrame(focusFrame);
      workspace.style.removeProperty("--admin-nav-height");
      delete menu.dataset.sticky;
    };
  }, []);

  useLayoutEffect(() => {
    const workspace = navigation.current?.parentElement;
    const section = document.getElementById(current);
    if (!workspace || !section) return;
    workspace.setAttribute("data-admin-ready", "true");
    section.setAttribute("data-active-section", "true");
    return () => { section.removeAttribute("data-active-section"); };
  }, [current]);

  useLayoutEffect(() => {
    if (isLegacyImageHash(hash)) window.location.replace(styleDnaPath);
  }, [hash]);

  useEffect(() => {
    if (isLegacyImageHash(hash)) return;
    if (hash === legacyOverviewHash) {
      history.replaceState(history.state, "", `#${current}`);
    }
    const destination = hash === `#${apiIntegrationsId}` ? apiIntegrationsId : current;
    if (hash && window.location.hash !== `#${destination}`) return;
    if (!hash && !visitedSection.current) return;
    visitedSection.current = true;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => focusSection(destination));
    });
    return () => cancelAnimationFrame(frame);
  }, [current, hash]);

  return <nav ref={navigation} className={styles.navigation} aria-label="관리 메뉴">
    <ul className={styles.operationLinks} aria-label="운영 메뉴">
      {operations.map(({ id, label, icon }) => <li key={id}>
        <a href={`#${id}`} aria-current={id === currentMenu ? "location" : undefined}>
          <Icon name={icon} />{label}
        </a>
      </li>)}
    </ul>
  </nav>;
}
