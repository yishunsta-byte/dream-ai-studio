"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./admin.module.css";

const sections = [
  { id: "admin-overview", label: "개요", icon: "home" },
  { id: "admin-project-list", label: "내 프로젝트", icon: "folder" },
  { id: "admin-review", label: "완성본 검수·게시", icon: "check" },
  { id: "admin-reference-analysis", label: "콘텐츠 분석·공개", icon: "flask" },
  { id: "admin-api-integrations", label: "API 연동", icon: "settings" },
  { id: "admin-render-queue", label: "렌더 대기열", icon: "clock" },
  { id: "admin-account", label: "계정 설정", icon: "settings" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

function subscribeLocation(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const defaultSection = () => "admin-project-list" as const;

function currentSection() {
  try {
    const id = decodeURIComponent(window.location.hash.slice(1));
    return sections.find((section) => section.id === id)?.id ?? defaultSection();
  } catch {
    return defaultSection();
  }
}

function focusSection(id: string) {
  const section = document.getElementById(id);
  const heading = section?.querySelector<HTMLElement>("h2") ?? section;
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({ block: "start" });
}

export function useAdminSection() {
  return useSyncExternalStore(subscribeLocation, currentSection, defaultSection);
}

export function AdminNavigation() {
  const current = useAdminSection();
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
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      viewport?.removeEventListener("resize", updateOffset);
      workspace.removeEventListener("focusin", scheduleReveal);
      cancelAnimationFrame(focusFrame);
      workspace.style.removeProperty("--admin-nav-height");
      delete menu.dataset.sticky;
    };
  }, []);

  useEffect(() => {
    if (!window.location.hash || !sections.some(section => window.location.hash === "#" + section.id)) return;
    const frame = requestAnimationFrame(() => focusSection(current));
    return () => cancelAnimationFrame(frame);
  }, [current]);
  return <nav ref={navigation} className={styles.navigation} aria-label="관리 메뉴">
    <ul>
      {sections.map(({ id, label, icon }) => <li key={id}>
        <a href={`#${id}`} aria-current={id === current ? "location" : undefined}
          onClick={() => { if (window.location.hash === "#" + id) requestAnimationFrame(() => focusSection(id)); }}><Icon name={icon} />{label}</a>
      </li>)}
    </ul>
  </nav>;
}
