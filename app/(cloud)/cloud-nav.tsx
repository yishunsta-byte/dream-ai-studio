"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./cloud.module.css";

// 로그인한 클라우드 화면의 공통 길잡이: 내 프로젝트·콘텐츠 분석. 현재 위치는 aria-current로 알린다.
export const cloudNavItems = [
  { href: "/cloud/projects", label: "내 프로젝트" },
  { href: "/cloud/reference-analysis", label: "콘텐츠 분석" },
] as const;

export function CloudNav() {
  const pathname = usePathname() ?? "";
  return <nav className={styles.nav} aria-label="클라우드 메뉴">
    <ul>{cloudNavItems.map(item => {
      const here = pathname === item.href || pathname.startsWith(`${item.href}/`);
      return <li key={item.href}><Link href={item.href} aria-current={here ? "page" : undefined}>{item.label}</Link></li>;
    })}</ul>
  </nav>;
}
