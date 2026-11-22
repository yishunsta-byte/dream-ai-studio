"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/auth/account-menu";
import { ProtectedContent, useSessionBoundary } from "@/components/auth/session-boundary";
import { BookOpen, Dna, FlaskConical, KeyRound, LayoutDashboard, Menu, Microscope, Wand2, X } from "./icons";
import s from "./studio-shell.module.css";

// P1-06 원본 Style DNA v1.39 (dashboard) layout + components/layout/Sidebar.tsx를 관리자 보호 경로(/admin/style-dna)에 옮긴 껍데기.
// 원본은 페이지 주소(/dashboard·/analyze·/refine·/test)로 단계를 나누지만, 이 화면은 한 작업 상태(진행 중 요청·동의·편집 칸)를 지키려고
// 같은 주소 안에서 단계를 바꾼다. 데스크톱(768px 이상)은 256px 고정 좌측 바, 모바일은 상단 바 + 펼침 메뉴(원본과 같은 구성).
// 하단 '로그인 계정'은 관리자 공통 계정 메뉴(같은 세션 감시·로그아웃)를 그대로 쓴다. 매뉴얼·API키등록은 기존 관리자 허브의 해당 칸으로 연다.
// 세션: 공통 작업실 껍데기(components/studio-shell.tsx)처럼 본문은 main 안 ProtectedContent로 가리고, 확인 전에는 브랜드·단계·링크를 숨기고(inert)
// 계정 메뉴(다시 확인·새로 고침·로그아웃)만 남긴다.
export type StudioStep = "library" | "analyze" | "refine" | "test";
export const APP_NAME = "이미지 스타일 분석기";
export const APP_VERSION = "v1.39";

const FLOW = [
  { step: 1, value: "analyze", label: "이미지 분석", description: "카메라·조명·색상·스타일 → 마스터 프롬프트", Icon: Microscope },
  { step: 2, value: "refine", label: "프롬프트 보정", description: "피드백으로 프롬프트 미세 조정", Icon: Wand2 },
  { step: 3, value: "test", label: "결과 테스트", description: "프롬프트로 이미지 생성·원본과 비교", Icon: FlaskConical },
] as const;

type Props = {
  step: StudioStep;
  onStep: (step: StudioStep) => void;
  account: string;
  guideHref: string;
  settingsHref: string;
  embedded?: boolean;
  children: ReactNode;
};

function Brand({ onStep, confirmed }: { onStep: () => void; confirmed: boolean }) {
  return <div className={s.brandBox} inert={!confirmed || undefined} style={confirmed ? undefined : { visibility: "hidden" }}>
    <button type="button" className={s.brand} onClick={onStep} aria-label={`${APP_NAME} ${APP_VERSION} 보관함으로`}>
      <span className={s.brandIcon}><Dna size={20} /></span>
      <span className={s.brandText}>
        <span className={s.brandName}>{APP_NAME}</span>
        <span className={s.brandMeta}><span className={s.version}>{APP_VERSION}</span><span className={s.lab}>DNA LAB</span></span>
      </span>
    </button>
  </div>;
}

function NavBody({ step, onStep, account, guideHref, settingsHref, confirmed, embedded }: Omit<Props, "children"> & { confirmed: boolean }) {
  return <nav className={s.nav} aria-label={`${APP_NAME} 메뉴`}>
    <div className={s.group} inert={!confirmed || undefined} style={confirmed ? undefined : { visibility: "hidden" }}>
      <button type="button" className={s.overview} aria-current={step === "library" ? "page" : undefined} onClick={() => onStep("library")}>
        <LayoutDashboard size={16} /><span>보관함</span>
      </button>
      <div className={s.flow}>
        <p className={s.flowTitle}>작업 워크플로우</p>
        <div className={s.steps}>
          {FLOW.map(({ step: number, value, label, description, Icon }, index) => {
            const active = step === value;
            return <button key={value} type="button" className={s.step} aria-current={active ? "step" : undefined} onClick={() => onStep(value)}>
              <span className={s.rail} aria-hidden="true">
                <span className={s.badge}>{number}</span>
                {index < FLOW.length - 1 && <span className={s.line} />}
              </span>
              <span className={s.stepBody}>
                <span className={s.stepLabel}><Icon size={14} /><span>{label}</span></span>
                <span className={s.stepDesc}>{description}</span>
              </span>
            </button>;
          })}
        </div>
      </div>
      <div className={s.utility}>
        <a className={`${s.util} ${s.guide}`} href={guideHref}><BookOpen size={15} /><span>📖 연동 &amp; 사용 매뉴얼</span></a>
        <a className={s.util} href={settingsHref}><KeyRound size={15} /><span>🔑 API키등록·플랫폼연동</span></a>
      </div>
    </div>
    {!embedded && <div className={s.account}>
      <div className={s.accountBox}>
        <p className={s.accountLabel}>로그인 계정</p>
        <AccountMenu email={account} />
      </div>
    </div>}
  </nav>;
}

export function StudioShell({ children, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const session = useSessionBoundary();
  const confirmed = !session || session.view === "current";
  const go = (next: StudioStep) => { props.onStep(next); };
  // 모바일 펼침 메뉴: 고르면 닫고 메뉴 단추로 초점을 돌린다. Esc로도 닫는다.
  const pick = (next: StudioStep) => { go(next); setOpen(false); toggle.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const Content = props.embedded ? "div" : "main";
  return <div className={props.embedded ? `${s.app} ${s.embedded}` : s.app} data-dna-shell={props.embedded ? "embedded" : ""}>
    <aside className={s.side} aria-label={`${APP_NAME} 사이드바`}>
      <Brand onStep={() => go("library")} confirmed={confirmed} />
      <NavBody {...props} onStep={go} confirmed={confirmed} />
    </aside>
    <div className={s.mobile}>
      <div className={s.mobileBar}>
        <button type="button" className={s.mobileBrand} onClick={() => pick("library")} aria-label={`${APP_NAME} ${APP_VERSION} 보관함으로`} disabled={!confirmed}>
          <span className={s.mobileIcon}><Dna size={15} /></span>
          <span className={s.brandName}>{APP_NAME}</span>
          <span className={s.version}>{APP_VERSION}</span>
        </button>
        <button ref={toggle} type="button" className={s.menuButton} aria-label={open ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={open} aria-controls={menuId}
          onClick={() => setOpen(value => !value)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && <div id={menuId} className={s.drawer}>
        <Brand onStep={() => pick("library")} confirmed={confirmed} />
        <NavBody {...props} onStep={pick} confirmed={confirmed} />
      </div>}
    </div>
    <Content className={s.main} id={props.embedded ? undefined : "main-content"}>
      <div className={s.inner}>{props.embedded ? children : <ProtectedContent>{children}</ProtectedContent>}</div>
    </Content>
  </div>;
}
