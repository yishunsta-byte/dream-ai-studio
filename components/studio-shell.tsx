"use client";

import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-logo";
import { appConfig } from "@/lib/config/app";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MenuConfig } from "@/lib/menus/schema";
import { Icon, type IconName } from "./ui/Icon";
import { PhaseChip, StatusPill } from "./ui/primitives";
import styles from "./studio-shell.module.css";
import { BreadcrumbContext, type BreadcrumbValue } from "./breadcrumb";
import { AccountMenu } from "./auth/account-menu";
import { ProtectedContent, useSessionBoundary } from "./auth/session-boundary";

export type NavigationData = {
  groups: MenuConfig["groups"];
  menus: Pick<MenuConfig["menus"][number], "id" | "label" | "group" | "phase" | "availability">[];
  workspaces: Pick<MenuConfig["workspaces"][number], "id" | "label">[];
};

export function StudioShell({ navigation, sampleMode, account = null, children }: { navigation: NavigationData; sampleMode: boolean; account?: string | null; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const session = useSessionBoundary();
  // 계정 확인 전·변경 뒤에는 작업 수(계정별 데이터)도 보이지 않는다(T-220).
  const confirmed = !session || session.view === "current";
  const epoch = session?.epoch ?? 0;
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
  const [received,setCounts]=useState<{running:number;queued:number;failed:number;epoch:number}|null>(null);
  const counts=confirmed&&received&&received.epoch===epoch?received:null;
  // T-224(F221-2): 작업 수는 계정 데이터다. 확인됨일 때만 받아 오고, 의심·확정이 되면 진행 중 요청·다음 갱신을 버린다.
  // 받은 값에는 그때의 epoch를 붙여, 다른 탭 신호 이전에 받은 값이 확인 뒤 다시 보이지 않게 한다(확인 뒤 새로 받는다).
  useEffect(()=>{if(!confirmed)return;let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;async function poll(){try{const response=await fetch("/api/jobs",{cache:"no-store"});if(!response.ok)return;const data:{jobs:{status:string}[]}=await response.json();if(disposed)return;const running=data.jobs.filter(job=>job.status==="running").length,queued=data.jobs.filter(job=>job.status==="queued").length;setCounts({running,queued,failed:data.jobs.filter(job=>job.status==="failed").length,epoch});if(running+queued>0)timer=setTimeout(()=>void poll(),2000);}catch{/* 다음 화면 이동 때 다시 확인한다. */}}void poll();return()=>{disposed=true;clearTimeout(timer);};},[pathname,confirmed,epoch]);
  // 의심·확정이 되면 열린 탐색 서랍을 닫는다(서랍 안 링크·작업 수도 같은 경계).
  useEffect(()=>{if(!confirmed)drawer.current?.close();},[confirmed]);
  useEffect(() => { drawer.current?.close(); }, [pathname]);
  useEffect(() => {
    const media = matchMedia("(min-width:1024px)");
    const close = () => { if (media.matches) drawer.current?.close(); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  const close = () => drawer.current?.close();
  const names: Record<string, string> = { "/studio": "작업실", "/jobs": "작업 대기열", "/library": "자료·캐릭터", "/history": "생성·활동 기록", "/settings": "설정", "/setup": "시작 점검" };
  const currentMenu = navigation.menus.find((menu) => pathname.startsWith(`/menus/${menu.id}`));
  const currentWorkspace = navigation.workspaces.find((workspace) => pathname === `/workspaces/${workspace.id}`);
  const title = !confirmed ? "작업실" : breadcrumb?.title ?? currentMenu?.label ?? currentWorkspace?.label ?? names[pathname] ?? "작업실";
  const hasHeaderStatus = sampleMode || !!account || !!(counts && counts.running + counts.queued > 0);
  const navLink = (href: string, label: string, extra?: ReactNode, dim = false, icon?: IconName) => <Link key={href} href={href} onClick={close} className={`${styles.navLink} ${dim ? styles.dim : ""}`} aria-current={pathname === href || (href.startsWith("/menus/") && pathname.startsWith(href + "/")) ? "page" : undefined}>{icon && <Icon name={icon} />}<span>{label}</span>{extra}</Link>;
  const links = <><Link href="/studio" className={styles.brand} onClick={close}><BrandMark /><span><strong>{appConfig.name}</strong><small>나만의 콘텐츠 작업실</small></span></Link>
    <nav aria-label="주 메뉴" className={styles.nav}>
      {navLink("/studio", "작업실", undefined, false, "home")}{navLink("/jobs", "작업 대기열", counts&&(counts.running+counts.queued>0||counts.failed>0)?<span className={styles.queueNumbers}>{counts.running+counts.queued>0&&<span>{counts.running+counts.queued}</span>}{counts.failed>0&&<span className={styles.failedCount} aria-label={`실패 ${counts.failed}개`}>!{counts.failed}</span>}</span>:undefined, false, "clock")}{navLink("/library", "자료·캐릭터", undefined, false, "folder")}{navLink("/history", "생성·활동 기록", undefined, false, "clock")}
      <div className={styles.divider} />
      {[...navigation.groups].sort((a,b) => a.order-b.order).map((group) => <div key={group.id}><div className={styles.groupLabel}>{group.label}</div>{navigation.menus.filter((menu) => menu.group === group.id).map((menu) => navLink(`/menus/${menu.id}`, menu.label, menu.availability !== "active" ? <PhaseChip phase={Number(menu.phase.slice(1)) as 0|1|2|3|4|5|6|7|8} /> : undefined, menu.availability !== "active"))}</div>)}
      <div className={styles.divider} /><div className={styles.groupLabel}>업무공간 · 별도 개발</div>{navigation.workspaces.map((workspace) => navLink(`/workspaces/${workspace.id}`, workspace.label, <span className={styles.separate}>P8</span>, true, "lock"))}
      <div className={styles.divider} />{navLink("/setup", "시작 점검", undefined, false, "check")}{navLink("/settings", "설정", undefined, false, "settings")}
    </nav></>;
  return <BreadcrumbContext.Provider value={setBreadcrumb}><div className={styles.shell}><a href="#main-content" className={styles.skip}>본문으로 건너뛰기</a>
    {/* T-224: 의심·확정 동안 사이드바(메뉴·작업 수)는 보이지 않고(visibility) 포커스·클릭도 막는다(inert). 자리(폭)는 유지한다. */}
    <aside className={styles.desktop} inert={!confirmed || undefined} style={confirmed ? undefined : { visibility: "hidden" }}>{links}</aside>
    <dialog ref={drawer} className={styles.drawer} aria-label="탐색 메뉴" onClose={() => { setOpen(false); trigger.current?.focus(); }} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button'));
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }}><div className={styles.drawerInner}><button type="button" aria-label="메뉴 닫기" className={styles.closeButton} onClick={close}><Icon name="close" /></button>{links}</div></dialog>
    <div ref={main} className={styles.main}><header ref={header} className={styles.topbar}><button type="button" ref={trigger} className={styles.menuButton} aria-label="메뉴 열기" aria-expanded={open} disabled={!confirmed} onClick={() => { drawer.current?.showModal(); setOpen(true); }}><Icon name="menu" /></button><div className={styles.crumb}><span className={styles.crumbRoot}>{(confirmed&&breadcrumb?.parent)||"작업실"} / </span><strong title={title}>{title}</strong></div>{hasHeaderStatus&&<div className={styles.headerStatus} role="group" aria-label="작업 상태와 계정">{counts&&counts.running+counts.queued>0&&<Link href="/jobs" className={styles.queueCount}>진행 {counts.running} · 대기 {counts.queued}</Link>}{sampleMode && <StatusPill status="sample">샘플 모드</StatusPill>}{account && <AccountMenu email={account} />}</div>}</header><main id="main-content" tabIndex={-1} className="content"><ProtectedContent>{children}</ProtectedContent></main></div>
  </div></BreadcrumbContext.Provider>;
}
