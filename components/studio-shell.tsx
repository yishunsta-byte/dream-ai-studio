"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MenuConfig } from "@/lib/menus/schema";
import { Icon, type IconName } from "./ui/Icon";
import { PhaseChip, StatusPill } from "./ui/primitives";
import styles from "./studio-shell.module.css";
import { BreadcrumbContext, type BreadcrumbValue } from "./breadcrumb";
import { AccountMenu } from "./auth/account-menu";

export type NavigationData = {
  groups: MenuConfig["groups"];
  menus: Pick<MenuConfig["menus"][number], "id" | "label" | "group" | "phase" | "availability">[];
  workspaces: Pick<MenuConfig["workspaces"][number], "id" | "label">[];
};

export function StudioShell({ navigation, sampleMode, account = null, children }: { navigation: NavigationData; sampleMode: boolean; account?: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const main = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar=header.current,container=main.current;
    if(!bar||!container)return;
    // This variable changes scroll clearance only, never the header's own minimum height.
    const measure=()=>container.style.setProperty("--studio-header-height",`${bar.getBoundingClientRect().height}px`);
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(bar);
    return()=>{observer.disconnect();container.style.removeProperty("--studio-header-height");};
  },[]);
  const [open, setOpen] = useState(false);
  const [breadcrumb,setBreadcrumb]=useState<BreadcrumbValue>(null);
  const [counts,setCounts]=useState<{running:number;queued:number;failed:number}|null>(null);
  useEffect(()=>{let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;async function poll(){try{const response=await fetch("/api/jobs",{cache:"no-store"});if(!response.ok)return;const data:{jobs:{status:string}[]}=await response.json();if(disposed)return;const running=data.jobs.filter(job=>job.status==="running").length,queued=data.jobs.filter(job=>job.status==="queued").length;setCounts({running,queued,failed:data.jobs.filter(job=>job.status==="failed").length});if(running+queued>0)timer=setTimeout(()=>void poll(),2000);}catch{/* 다음 화면 이동 때 다시 확인한다. */}}void poll();return()=>{disposed=true;clearTimeout(timer);};},[pathname]);
  useEffect(() => { drawer.current?.close(); }, [pathname]);
  useEffect(() => {
    const media = matchMedia("(min-width:1024px)");
    const close = () => { if (media.matches) drawer.current?.close(); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  const close = () => drawer.current?.close();
  const names: Record<string, string> = { "/": "작업실", "/jobs": "작업 대기열", "/library": "자료·캐릭터", "/history": "생성·활동 기록", "/settings": "설정", "/setup": "시작 점검" };
  const currentMenu = navigation.menus.find((menu) => pathname.startsWith(`/menus/${menu.id}`));
  const currentWorkspace = navigation.workspaces.find((workspace) => pathname === `/workspaces/${workspace.id}`);
  const title = breadcrumb?.title ?? currentMenu?.label ?? currentWorkspace?.label ?? names[pathname] ?? "작업실";
  const hasHeaderStatus = sampleMode || !!account || !!(counts && counts.running + counts.queued > 0);
  const navLink = (href: string, label: string, extra?: ReactNode, dim = false, icon?: IconName) => <Link key={href} href={href} onClick={close} className={`${styles.navLink} ${dim ? styles.dim : ""}`} aria-current={pathname === href || (href.startsWith("/menus/") && pathname.startsWith(href + "/")) ? "page" : undefined}>{icon && <Icon name={icon} />}<span>{label}</span>{extra}</Link>;
  const links = <><Link href="/" className={styles.brand} onClick={close}><span className={styles.mark}>D</span><span><strong>Dream AI Studio</strong><small>나만의 콘텐츠 작업실</small></span></Link>
    <nav aria-label="주 메뉴" className={styles.nav}>
      {navLink("/", "작업실", undefined, false, "home")}{navLink("/jobs", "작업 대기열", counts&&(counts.running+counts.queued>0||counts.failed>0)?<span className={styles.queueNumbers}>{counts.running+counts.queued>0&&<span>{counts.running+counts.queued}</span>}{counts.failed>0&&<span className={styles.failedCount} aria-label={`실패 ${counts.failed}개`}>!{counts.failed}</span>}</span>:undefined, false, "clock")}{navLink("/library", "자료·캐릭터", undefined, false, "folder")}{navLink("/history", "생성·활동 기록", undefined, false, "clock")}
      <div className={styles.divider} />
      {[...navigation.groups].sort((a,b) => a.order-b.order).map((group) => <div key={group.id}><div className={styles.groupLabel}>{group.label}</div>{navigation.menus.filter((menu) => menu.group === group.id).map((menu) => navLink(`/menus/${menu.id}`, menu.label, menu.availability !== "active" ? <PhaseChip phase={Number(menu.phase.slice(1)) as 0|1|2|3|4|5|6|7|8} /> : undefined, menu.availability !== "active"))}</div>)}
      <div className={styles.divider} /><div className={styles.groupLabel}>업무공간 · 별도 개발</div>{navigation.workspaces.map((workspace) => navLink(`/workspaces/${workspace.id}`, workspace.label, <span className={styles.separate}>P8</span>, true, "lock"))}
      <div className={styles.divider} />{navLink("/setup", "시작 점검", undefined, false, "check")}{navLink("/settings", "설정", undefined, false, "settings")}
    </nav></>;
  return <BreadcrumbContext.Provider value={setBreadcrumb}><div className={styles.shell}><a href="#main-content" className={styles.skip}>본문으로 건너뛰기</a>
    <aside className={styles.desktop}>{links}</aside>
    <dialog ref={drawer} className={styles.drawer} aria-label="탐색 메뉴" onClose={() => { setOpen(false); trigger.current?.focus(); }} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button'));
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }}><div className={styles.drawerInner}><button type="button" aria-label="메뉴 닫기" className={styles.closeButton} onClick={close}><Icon name="close" /></button>{links}</div></dialog>
    <div ref={main} className={styles.main}><header ref={header} className={styles.topbar}><button type="button" ref={trigger} className={styles.menuButton} aria-label="메뉴 열기" aria-expanded={open} onClick={() => { drawer.current?.showModal(); setOpen(true); }}><Icon name="menu" /></button><div className={styles.crumb}><span className={styles.crumbRoot}>{breadcrumb?.parent??"작업실"} / </span><strong title={title}>{title}</strong></div>{hasHeaderStatus&&<div className={styles.headerStatus} role="group" aria-label="작업 상태와 계정">{counts&&counts.running+counts.queued>0&&<Link href="/jobs" className={styles.queueCount}>진행 {counts.running} · 대기 {counts.queued}</Link>}{sampleMode && <StatusPill status="sample">샘플 모드</StatusPill>}{account && <AccountMenu email={account} />}</div>}</header><main id="main-content" tabIndex={-1} className="content">{children}</main></div>
  </div></BreadcrumbContext.Provider>;
}
