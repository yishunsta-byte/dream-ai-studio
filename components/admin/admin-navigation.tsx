"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./admin.module.css";
import { apiPlatformLabel, homeSectionId, imageAnalysisSection, imageShareSection, reviewSectionId, styleDnaPath } from "./admin-paths";

// 이전 이미지 북마크는 독립 Style DNA 화면으로, 상단 이미지 분석 메뉴는 관리자 본문의 작업실로 연결한다.
export const analysisPrograms = [
  { id: imageAnalysisSection, label: "이미지 분석", icon: "flask" },
  { id: "admin-music-analysis", label: "오디오 분석", icon: "clock" },
  { id: "admin-shorts-analysis", label: "영상 분석", icon: "play" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

const legacyImageIds = new Set<string>(["admin-style-dna", "admin-reference-analysis"]);
function isLegacyImageHash(hash: string) {
  try { return legacyImageIds.has(decodeURIComponent(hash.slice(1))); } catch { return false; }
}
const legacyOverviewHash = "#admin-overview";
export const analysisResultsSection = "admin-analysis-results";
export const accountSettingsId = "admin-account";
const apiIntegrationsId = "admin-api-integrations";
const operations = [
  ...analysisPrograms,
  { id: "admin-project-list", label: "내 프로젝트", icon: "folder" },
  { id: "admin-review", label: "완성본 검수·게시", icon: "check" },
  { id: "admin-render-queue", label: "렌더 대기열", icon: "clock" },
  { id: accountSettingsId, label: apiPlatformLabel, icon: "settings" },
  { id: "admin-operations-availability", label: "운영 연결 범위", icon: "lock" },
  { id: "admin-manual", label: "사용매뉴얼", icon: "info" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

const sections = [...operations, { id: homeSectionId }, { id: analysisResultsSection }, { id: imageShareSection }];

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
    if (id === apiIntegrationsId) return accountSettingsId;
    return sections.find((section) => section.id === id)?.id ?? defaultSection();
  } catch {
    return defaultSection();
  }
}

function focusSection(id: string) {
  const section = document.getElementById(id);
  const heading = id === imageAnalysisSection ? section : section?.querySelector<HTMLElement>("h2, h3") ?? section;
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
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

export function AdminNavigation() {
  const hash = useSyncExternalStore(subscribeLocation, browserHash, serverHash);
  const current = sectionFromHash(hash);
  const currentMenu = current === imageShareSection || current === analysisResultsSection ? reviewSectionId : current;
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
