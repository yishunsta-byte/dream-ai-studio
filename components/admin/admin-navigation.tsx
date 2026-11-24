"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./admin.module.css";

const sections = [
  { id: "admin-overview", label: "개요", icon: "home" },
  { id: "admin-project-list", label: "내 프로젝트", icon: "folder" },
  { id: "admin-review", label: "완성본 검수·게시", icon: "check" },
  { id: "admin-reference-analysis", label: "콘텐츠 분석·공개", icon: "flask" },
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

  useEffect(() => {
    if (!window.location.hash || !sections.some(section => window.location.hash === "#" + section.id)) return;
    const frame = requestAnimationFrame(() => focusSection(current));
    return () => cancelAnimationFrame(frame);
  }, [current]);
  return <nav className={styles.navigation} aria-label="관리 메뉴">
    <ul>
      {sections.map(({ id, label, icon }) => <li key={id}>
        <a href={`#${id}`} aria-current={id === current ? "location" : undefined}
          onClick={() => { if (window.location.hash === "#" + id) requestAnimationFrame(() => focusSection(id)); }}><Icon name={icon} />{label}</a>
      </li>)}
    </ul>
  </nav>;
}
