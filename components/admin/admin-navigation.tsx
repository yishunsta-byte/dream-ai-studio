"use client";

import { useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./admin.module.css";

const sections = [
  { id: "admin-overview", label: "개요", icon: "home" },
  { id: "admin-project-list", label: "내 프로젝트", icon: "folder" },
  { id: "admin-review", label: "완성본 검수·게시", icon: "check" },
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

const defaultSection = () => sections[0].id;

function currentSection() {
  try {
    const id = decodeURIComponent(window.location.hash.slice(1));
    return sections.find((section) => section.id === id)?.id ?? defaultSection();
  } catch {
    return defaultSection();
  }
}

export function AdminNavigation() {
  const current = useSyncExternalStore(subscribeLocation, currentSection, defaultSection);

  return <nav className={styles.navigation} aria-label="관리 메뉴">
    <ul>
      {sections.map(({ id, label, icon }) => <li key={id}>
        <a href={`#${id}`} aria-current={id === current ? "location" : undefined}><Icon name={icon} />{label}</a>
      </li>)}
    </ul>
  </nav>;
}
